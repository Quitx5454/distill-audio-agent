// ── Distill Audio — x402 HTTP server ──────────────────────────────────────
// Wraps the pipeline behind a single paid endpoint:
//
//   POST /generate   { brief, asmr? }   →  audio/mpeg  (2.00 USDC, Base Mainnet)
//
// Pure Express (not Lucid): the response body is a binary mp3, which Lucid's
// JSON-envelope entrypoints can't carry. The x402 paywall is the SAME stack
// Refine uses — @x402/express paymentMiddleware backed by the Coinbase CDP
// facilitator, plus the Bazaar discovery extension so CDP indexes the resource.
import express from "express";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { getAuthHeaders } from "@coinbase/cdp-sdk/auth";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import agentCard from "../agent-card.json" with { type: "json" };
import { runPipeline } from "./pipeline.js";
import { isAsmrOption, type AsmrOption } from "./lib/asmr.js";
import { parseEnvelope, wrapResponse } from "./lib/envelope.js";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const PAY_TO = (process.env.PAYMENTS_RECEIVABLE_ADDRESS ??
  "0x104b5768FE505c400dd98F447665CB5c6fca388A") as `0x${string}`;
const PRICE = "$2.00";
const ROUTE = "/generate";
// Internal safety check only — the fixed price already covers cost.
const COST_WARN_THRESHOLD_USD = 1.0;

const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
if (!anthropicApiKey) console.warn("[boot] ANTHROPIC_API_KEY is not set — /generate will error.");
if (!elevenLabsApiKey) console.warn("[boot] ELEVENLABS_API_KEY is not set — /generate will error.");

// ── x402 facilitator (Coinbase CDP) — identical wiring to Refine ───────────
const CDP_HOST = "api.cdp.coinbase.com";
const CDP_BASE = "/platform/v2/x402";
const cdpKeyId = process.env.CDP_API_KEY_ID;
const cdpKeySecret = process.env.CDP_API_KEY_SECRET;
if (!cdpKeyId || !cdpKeySecret)
  console.warn("[boot] CDP_API_KEY_ID / CDP_API_KEY_SECRET not set — the paywall cannot issue 402 challenges.");

const facilitator = new HTTPFacilitatorClient({
  url: `https://${CDP_HOST}${CDP_BASE}`,
  createAuthHeaders: async () => {
    const [verify, settle, supported] = await Promise.all([
      getAuthHeaders({ apiKeyId: cdpKeyId!, apiKeySecret: cdpKeySecret!, requestMethod: "POST", requestHost: CDP_HOST, requestPath: `${CDP_BASE}/verify` }),
      getAuthHeaders({ apiKeyId: cdpKeyId!, apiKeySecret: cdpKeySecret!, requestMethod: "POST", requestHost: CDP_HOST, requestPath: `${CDP_BASE}/settle` }),
      getAuthHeaders({ apiKeyId: cdpKeyId!, apiKeySecret: cdpKeySecret!, requestMethod: "GET",  requestHost: CDP_HOST, requestPath: `${CDP_BASE}/supported` }),
    ]);
    return {
      verify:    { Authorization: verify.Authorization },
      settle:    { Authorization: settle.Authorization },
      supported: { Authorization: supported.Authorization },
    };
  },
});
const resourceServer = new x402ResourceServer(facilitator);
registerExactEvmScheme(resourceServer);
// Bazaar discovery extension — registered BEFORE the payment middleware so the
// CDP facilitator indexes /generate into the Bazaar catalog.
resourceServer.registerExtension(bazaarResourceServerExtension);

const app = express();

// CORS first — before the paywall — so browsers can read PAYMENT-REQUIRED and
// OPTIONS preflights short-circuit instead of hitting the wall.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, PAYMENT-SIGNATURE, X-Payment");
  res.header("Access-Control-Expose-Headers",
    "PAYMENT-REQUIRED, PAYMENT-RESPONSE, WWW-Authenticate, " +
    "X-Distill-Session-Id, X-Distill-Mode, X-Distill-Voice, X-Distill-Asmr, X-Distill-Asmr-Applied");
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

// Public, unpaid routes.
app.get("/", (_req, res) => res.json({ name: "Distill Audio", status: "ok", route: ROUTE, price: PRICE }));
app.get("/.well-known/agent-card.json", (_req, res) =>
  res.type("application/json").send(JSON.stringify(agentCard)));

// Railway terminates TLS at the edge and forwards plain HTTP, so Express sees
// req.protocol === "http". The x402 middleware builds the discovery/settlement
// resource URL from req.protocol — it MUST be the public https URL or CDP drops
// it from the Bazaar. Honour X-Forwarded-Proto (Railway sets "https").
app.use((req: any, _res: any, next: any) => {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() || "https";
  Object.defineProperty(req, "protocol", { value: proto, configurable: true });
  next();
});

// Decode the PAYMENT-REQUIRED header into the 402 body for crawlers like xgate
// (expects resource + accepts[].{resource,description,maxAmountRequired}).
app.use((_req: any, res: any, next: any) => {
  const origJson = res.json.bind(res);
  res.json = function (body: any) {
    if (res.statusCode === 402 && (!body || Object.keys(body).length === 0)) {
      const header = (res.getHeader("PAYMENT-REQUIRED") ?? res.getHeader("payment-required")) as string | undefined;
      if (header) {
        try {
          const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
          const resourceUrl: string = typeof decoded.resource === "string" ? decoded.resource : decoded.resource?.url ?? "";
          const resourceDesc: string = decoded.resource?.description ?? "";
          return origJson({
            x402Version: decoded.x402Version,
            resource: resourceUrl,
            accepts: (decoded.accepts ?? []).map((a: any) => ({
              scheme: a.scheme, network: a.network, asset: a.asset, payTo: a.payTo,
              maxAmountRequired: a.amount ?? a.maxAmountRequired, maxTimeoutSeconds: a.maxTimeoutSeconds,
              resource: resourceUrl, description: resourceDesc, mimeType: a.mimeType ?? "audio/mpeg",
              input: { method: "POST", type: "http", bodyType: "json" },
            })),
          });
        } catch {}
      }
    }
    return origJson(body);
  };
  next();
});

// ── x402 paywall on /generate ──────────────────────────────────────────────
app.use(paymentMiddleware({
  [ROUTE]: {
    accepts: [{ scheme: "exact", price: PRICE, network: "eip155:8453", payTo: PAY_TO }],
    description: "Generate a warm narration/explainer mp3 from a script or topic, with an optional ASMR background layer.",
    extensions: declareDiscoveryExtension({
      bodyType: "json",
      input: { brief: "How do I get off zero and build a daily habit?", asmr: "rain" },
      inputSchema: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {
          brief: { type: "string", description: "A ready script, or a topic/question to research and narrate." },
          asmr: {
            type: ["string", "null"],
            enum: ["rain", "fire_crackling", "forest", "ocean_waves", "white_noise", "coffee_shop", null],
            description: "Optional ambient background layer (one only), or null for none.",
          },
        },
        required: ["brief"],
        additionalProperties: false,
      },
      output: { example: "<binary audio/mpeg>", schema: { type: "string", contentMediaType: "audio/mpeg" } },
    }),
  },
}, resourceServer));

// ── Handler (runs only after payment settles) ──────────────────────────────
app.post(ROUTE, express.json({ limit: "2mb" }), async (req, res) => {
  const { payload, sessionId, agentId } = parseEnvelope<{ brief?: unknown; asmr?: unknown }>(req.body);

  const brief = payload?.brief;
  if (typeof brief !== "string" || brief.trim().length === 0) {
    return res.status(400).json(wrapResponse({ error: "Missing or empty 'brief' (string)." }, sessionId, agentId, "error"));
  }
  let asmr: AsmrOption | null = null;
  if (payload.asmr !== undefined && payload.asmr !== null) {
    if (!isAsmrOption(payload.asmr)) {
      return res.status(400).json(wrapResponse(
        { error: "Invalid 'asmr'. Choices: rain, fire_crackling, forest, ocean_waves, white_noise, coffee_shop, or null." },
        sessionId, agentId, "error"));
    }
    asmr = payload.asmr;
  }

  if (!anthropicApiKey || !elevenLabsApiKey) {
    return res.status(500).json(wrapResponse({ error: "Server is missing ANTHROPIC_API_KEY or ELEVENLABS_API_KEY." }, sessionId, agentId, "error"));
  }

  const outputPath = join(tmpdir(), `distill-audio-${sessionId}.mp3`);
  try {
    const result = await runPipeline(brief, {
      anthropicApiKey,
      elevenLabsApiKey,
      voice: process.env.ELEVENLABS_VOICE_ID,
      modelId: process.env.ELEVENLABS_MODEL_ID,
      freeTierCredits: process.env.FREE_TIER_CREDITS ? Number(process.env.FREE_TIER_CREDITS) : undefined,
      render: true,
      outputPath,
      asmr,
      costWarnThresholdUsd: COST_WARN_THRESHOLD_USD,
    });

    const o = result.output;
    if (!o.render) {
      return res.status(500).json(wrapResponse({ error: "Render did not produce a file." }, sessionId, agentId, "error"));
    }

    const bytes = await readFile(outputPath);
    res.setHeader("X-Distill-Session-Id", result.session_id);
    res.setHeader("X-Distill-Mode", o.spec.mode);
    res.setHeader("X-Distill-Voice", o.render.voice_name);
    res.setHeader("X-Distill-Asmr", o.render.asmr ? o.render.asmr.option : "none");
    res.setHeader("X-Distill-Asmr-Applied", String(o.render.asmr?.applied ?? false));
    res.type("audio/mpeg").send(bytes);
  } catch (err) {
    console.error("[generate] error:", err);
    return res.status(500).json(wrapResponse(
      { error: err instanceof Error ? err.message : "Generation failed." }, sessionId, agentId, "error"));
  } finally {
    await rm(outputPath, { force: true }).catch(() => {});
  }
});

app.listen(PORT, () => {
  console.log(`Distill Audio server listening on port ${PORT} — POST ${ROUTE} (${PRICE}, eip155:8453, payTo ${PAY_TO})`);
});
