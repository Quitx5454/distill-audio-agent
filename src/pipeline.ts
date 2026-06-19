// ── Distill Audio pipeline ────────────────────────────────────────────────
// The mode router. brief → spec → [research] → script → cost gate → TTS.
// Both modes (ready_text, topic_research) run through the same spine; only the
// script-acquisition step differs. Everything returns inside the Distill
// Standard Envelope so this drops into the wider ecosystem (x402 wrapping is
// Part 2).
import Anthropic from "@anthropic-ai/sdk";
import { briefToSpec } from "./lib/briefToSpec.js";
import { researchScript } from "./lib/research.js";
import { estimateCost, shouldDecline, freeTierWarning, USD_PER_CREDIT } from "./lib/cost.js";
import { renderToFile, DEFAULT_MODEL_ID } from "./lib/tts.js";
import { resolveVoice, verifyVoice } from "./lib/voices.js";
import { applyAsmrLayer, ffmpegAvailable, ASMR_CREDITS, type AsmrOption } from "./lib/asmr.js";
import { wrapResponse, type DistillResponse } from "./lib/envelope.js";
import type {
  AudioSpec,
  ScriptResult,
  CostEstimate,
  DeclineDecision,
} from "./types.js";

export interface PipelineOptions {
  anthropicApiKey: string;
  elevenLabsApiKey?: string; // required only when render === true
  // When set, the job is treated as a paid bounty and run through the decline
  // gate before any spend.
  rewardUsd?: number;
  voice?: string; // voice key or id
  modelId?: string;
  freeTierCredits?: number;
  safetyMargin?: number;
  // Produce the mp3. When false, the pipeline stops after the cost estimate —
  // useful for dry-running a bounty before committing credits.
  render: boolean;
  outputPath?: string; // required when render === true
  // Optional ambient bed mixed under the narration (one of the six options).
  // Requires ffmpeg; when ffmpeg is unavailable the narration still renders and
  // the layer is skipped (reported in render.asmr).
  asmr?: AsmrOption | null;
  // Internal safety check for paid x402 calls: when the estimated cost (TTS +
  // LLM + ASMR) exceeds this, log a warning and proceed anyway — NOT a decline.
  costWarnThresholdUsd?: number;
}

export interface PipelineOutput {
  spec: AudioSpec;
  script: ScriptResult;
  estimate: CostEstimate;
  free_tier_warning: string | null;
  decision: DeclineDecision | null; // populated when rewardUsd was supplied
  render: {
    output_path: string;
    voice_id: string;
    voice_name: string;
    model_id: string;
    spoken_chars: number;
    bytes: number;
    asmr: {
      option: AsmrOption;
      applied: boolean;
      credits: number;
      reason?: string; // why it was skipped, when applied === false
    } | null;
  } | null;
}

export async function runPipeline(
  brief: string,
  opts: PipelineOptions,
): Promise<DistillResponse<PipelineOutput>> {
  const sessionId = crypto.randomUUID();
  // maxRetries: 1 (SDK default is 2). The research step runs the server-side
  // web_search tool; a silent SDK retry on a transient error re-runs every
  // search already performed in that call, multiplying cost. Keep retries low.
  const client = new Anthropic({ apiKey: opts.anthropicApiKey, maxRetries: 1 });
  const modelId = opts.modelId ?? DEFAULT_MODEL_ID;

  // 1. Brief → structured spec (handles messy NL, sets the mode).
  const spec = await briefToSpec(client, brief);

  // 2. Acquire the script. Mode 1 uses the caller's text verbatim; Mode 2
  //    researches and writes it.
  const script: ScriptResult =
    spec.mode === "ready_text"
      ? { script: spec.source_text, sources_markdown: "", origin: "ready_text" }
      : await researchScript(client, spec);

  // 3. Estimate cost and check the free-tier ceiling.
  const estimate = estimateCost(script.script, {
    mode: spec.mode,
    modelId,
    freeTierCredits: opts.freeTierCredits,
    safetyMargin: opts.safetyMargin,
  });
  const ftWarning = freeTierWarning(estimate);

  // 3b. Server-side cost warning for paid x402 calls. The price already covers
  //     the cost, so this never declines — it just flags an unexpectedly pricey
  //     job in the logs BEFORE we spend on TTS.
  const asmrUsd = opts.asmr ? ASMR_CREDITS * USD_PER_CREDIT : 0;
  const totalWithAsmr = estimate.total_usd + asmrUsd;
  if (
    opts.costWarnThresholdUsd !== undefined &&
    totalWithAsmr > opts.costWarnThresholdUsd
  ) {
    console.warn(
      `[cost-gate] estimated cost $${totalWithAsmr.toFixed(4)} ` +
        `(TTS+LLM $${estimate.total_usd.toFixed(4)}${opts.asmr ? ` + ASMR $${asmrUsd.toFixed(4)}` : ""}) ` +
        `exceeds warn threshold $${opts.costWarnThresholdUsd.toFixed(2)} — proceeding (price covers it).`,
    );
  }

  // 4. Decline gate (only for paid jobs).
  const decision =
    opts.rewardUsd !== undefined
      ? shouldDecline(script.script, opts.rewardUsd, {
          mode: spec.mode,
          modelId,
          freeTierCredits: opts.freeTierCredits,
          safetyMargin: opts.safetyMargin,
        })
      : null;

  const base: PipelineOutput = {
    spec,
    script,
    estimate,
    free_tier_warning: ftWarning,
    decision,
    render: null,
  };

  // 5. Render — unless we're declining, or this is a dry run.
  if (decision?.decline) {
    return wrapResponse(base, sessionId, null, "ok");
  }
  if (!opts.render) {
    return wrapResponse(base, sessionId, null, "ok");
  }

  if (!opts.elevenLabsApiKey) {
    throw new Error("render requested but ELEVENLABS_API_KEY is not set.");
  }
  if (!opts.outputPath) {
    throw new Error("render requested but no outputPath was provided.");
  }

  // Confirm the chosen voice is real in the live library before spending.
  const voice = resolveVoice(opts.voice);
  const live = await verifyVoice(opts.elevenLabsApiKey, voice.id);
  if (!live) {
    throw new Error(
      `Voice "${voice.name}" (${voice.id}) is not in your ElevenLabs voice ` +
        `library. Add it from the shared catalog, or pass a voice you own.`,
    );
  }

  const result = await renderToFile(script.script, {
    apiKey: opts.elevenLabsApiKey,
    voice,
    modelId,
    outputPath: opts.outputPath,
  });

  base.render = {
    output_path: result.outputPath,
    voice_id: result.voice.id,
    voice_name: result.voice.name,
    model_id: result.modelId,
    spoken_chars: result.spokenChars,
    bytes: result.bytes,
    asmr: null,
  };

  // 6. Optional ASMR layer. Mixed in-place over the rendered narration. If
  //    ffmpeg isn't on this host, skip the layer rather than fail the whole
  //    (paid) render — the narration is still a complete deliverable.
  if (opts.asmr) {
    if (await ffmpegAvailable()) {
      const asmr = await applyAsmrLayer(
        opts.elevenLabsApiKey,
        opts.asmr,
        result.outputPath,
        result.outputPath,
      );
      base.render.bytes = asmr.bytes;
      base.render.asmr = {
        option: opts.asmr,
        applied: true,
        credits: asmr.credits,
      };
    } else {
      base.render.asmr = {
        option: opts.asmr,
        applied: false,
        credits: 0,
        reason: "ffmpeg not available on this host; narration returned without ASMR.",
      };
    }
  }

  return wrapResponse(base, sessionId, null, "ok");
}
