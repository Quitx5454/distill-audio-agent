// ── Live end-to-end test of the async /generate flow (real x402 payment) ───
// Pays POST /generate (2.00 USDC) -> gets a task_id -> polls the free status
// endpoint -> fetches the mp3 from the free result endpoint. Uses a
// topic_research brief on purpose, to exercise the slow path that previously
// timed out (Cloudflare 524) under the old synchronous design.
//
//   AGENT_WALLET_PRIVATE_KEY=0x... bun run scripts/test-async-live.ts
import { writeFile } from "node:fs/promises";
import { createPublicClient, http as viemHttp } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { toClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";

const BASE = process.env.AUDIO_BASE ?? "https://distill-audio-agent-production.up.railway.app";
const RPC_URL = process.env.RPC_URL ?? "https://mainnet.base.org";

const raw = process.env.WALLET_PRIVATE_KEY ?? process.env.AGENT_WALLET_PRIVATE_KEY;
if (!raw) {
  console.error("Set AGENT_WALLET_PRIVATE_KEY (a Base wallet holding USDC).");
  process.exit(1);
}
const pk = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
const account = privateKeyToAccount(pk);
const publicClient = createPublicClient({ chain: base, transport: viemHttp(RPC_URL) });
const signer = toClientEvmSigner(
  { address: account.address, signTypedData: (m) => account.signTypedData(m as any) },
  publicClient,
);
const client = new x402Client();
registerExactEvmScheme(client, { signer });
const fetch402 = wrapFetchWithPayment(fetch, client);

const body = JSON.stringify({
  brief:
    "Make a short, calm 2-minute explainer on why the sky is blue — Rayleigh " +
    "scattering, plainly. Warm, sourced per claim, no hype.",
  asmr: null,
});

console.log("Payer:   ", account.address);
console.log("POST     ", BASE + "/generate", "(2.00 USDC, Base mainnet)\n");

// 1. Pay + queue (x402 flow automated: 402 -> sign -> retry -> 202).
const res = await fetch402(BASE + "/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});
console.log("HTTP", res.status);
const payResp = res.headers.get("payment-response");
if (payResp) {
  try {
    const d = JSON.parse(Buffer.from(payResp, "base64").toString("utf-8"));
    console.log("settlement tx:", d.transaction ?? d.txHash ?? "(see PAYMENT-RESPONSE)");
  } catch {}
}
const job = (await res.json()) as any;
console.log("task_id:", job.task_id, "| status:", job.status);
if (res.status !== 202 || !job.task_id) {
  console.error("Unexpected response:", JSON.stringify(job));
  process.exit(1);
}

const statusUrl = BASE + (job.status_url || `/generate/status/${job.task_id}`);
const resultUrl = BASE + (job.result_url || `/generate/result/${job.task_id}`);

// 2. Poll the free status endpoint until terminal.
let status = job.status as string;
for (let i = 0; i < 100 && status !== "completed" && status !== "failed"; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const s = (await (await fetch(statusUrl, { cache: "no-store" })).json()) as any;
  status = s.status;
  console.log(`  poll ${i + 1}: ${status}${s.voice ? " · " + s.voice : ""}`);
  if (status === "failed") {
    console.error("FAILED:", s.error);
    process.exit(1);
  }
}
if (status !== "completed") {
  console.error("Timed out waiting for completion.");
  process.exit(1);
}

// 3. Fetch the mp3 from the free result endpoint.
const r = await fetch(resultUrl, { cache: "no-store" });
console.log("\nresult HTTP", r.status, "| content-type:", r.headers.get("content-type"));
console.log(
  "X-Distill — mode:", r.headers.get("x-distill-mode"),
  "| voice:", r.headers.get("x-distill-voice"),
  "| asmr:", r.headers.get("x-distill-asmr"),
);
const buf = Buffer.from(await r.arrayBuffer());
const out = "/tmp/async-live-result.mp3";
await writeFile(out, buf);
console.log(`saved ${buf.length} bytes -> ${out}`);
console.log("\n✓ Live async flow OK: pay -> 202 task_id -> poll -> result mp3.");
