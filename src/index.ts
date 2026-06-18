// ── Distill Audio — CLI entry ─────────────────────────────────────────────
// Usage:
//   bun run generate --brief "<text>"            # estimate only (dry run)
//   bun run generate --brief-file path.md        # read brief from a file
//   bun run generate --brief "..." --render --out deliverables/out.mp3
//   bun run generate --brief "..." --reward 6    # run the decline gate
//
// Flags: --voice <key|id>  --model <id>  --free <credits>  --margin <n>
import { readFile } from "node:fs/promises";
import { runPipeline, type PipelineOptions } from "./pipeline.js";
import { isAsmrOption } from "./lib/asmr.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const briefInline = arg("brief");
  const briefFile = arg("brief-file");
  if (!briefInline && !briefFile) {
    console.error(
      "Provide a brief: --brief \"<text>\" or --brief-file <path>.\n" +
        "See the header of src/index.ts for usage.",
    );
    process.exit(1);
  }
  const brief = briefInline ?? (await readFile(briefFile!, "utf8"));

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    console.error("ANTHROPIC_API_KEY is not set (see .env.example).");
    process.exit(1);
  }

  const render = flag("render");
  const reward = arg("reward");
  const opts: PipelineOptions = {
    anthropicApiKey,
    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
    rewardUsd: reward !== undefined ? Number(reward) : undefined,
    voice: arg("voice") ?? process.env.ELEVENLABS_VOICE_ID,
    modelId: arg("model") ?? process.env.ELEVENLABS_MODEL_ID,
    freeTierCredits: arg("free")
      ? Number(arg("free"))
      : process.env.FREE_TIER_CREDITS
        ? Number(process.env.FREE_TIER_CREDITS)
        : undefined,
    safetyMargin: arg("margin") ? Number(arg("margin")) : undefined,
    render,
    outputPath: arg("out") ?? "deliverables/explainer.mp3",
    asmr: (() => {
      const a = arg("asmr");
      if (!a) return undefined;
      if (!isAsmrOption(a)) {
        console.error(`Unknown --asmr "${a}". Choices: rain, fire_crackling, forest, ocean_waves, white_noise, coffee_shop.`);
        process.exit(1);
      }
      return a;
    })(),
  };

  const res = await runPipeline(brief, opts);
  const o = res.output;

  console.log("\n── Spec ───────────────────────────────");
  console.log(`mode:   ${o.spec.mode}`);
  console.log(`tone:   ${o.spec.tone_direction}`);
  console.log(`length: ${o.spec.target_minutes_min}–${o.spec.target_minutes_max} min`);
  if (o.spec.avoid_list.length) console.log(`avoid:  ${o.spec.avoid_list.join("; ")}`);

  console.log("\n── Cost estimate ──────────────────────");
  console.log(`spoken chars:  ${o.estimate.billable_chars}`);
  console.log(`EL credits:    ${o.estimate.elevenlabs_credits} (free used: ${o.estimate.free_credits_used}, paid: ${o.estimate.paid_credits})`);
  console.log(`EL cost:       $${o.estimate.elevenlabs_usd}`);
  console.log(`LLM cost:      $${o.estimate.llm_usd}`);
  console.log(`total:         $${o.estimate.total_usd}  (×margin: $${o.estimate.total_usd_with_margin})`);
  if (o.free_tier_warning) console.log(o.free_tier_warning);

  if (o.decision) {
    console.log("\n── Decline gate ───────────────────────");
    console.log(`${o.decision.decline ? "DECLINE" : "ACCEPT"}: ${o.decision.reason}`);
  }

  if (o.render) {
    console.log("\n── Render ─────────────────────────────");
    console.log(`voice:  ${o.render.voice_name} (${o.render.voice_id})`);
    console.log(`model:  ${o.render.model_id}`);
    console.log(`file:   ${o.render.output_path} (${(o.render.bytes / 1024).toFixed(0)} KB)`);
  } else if (!o.decision?.decline) {
    console.log("\n(dry run — pass --render --out <path> to produce the mp3)");
  }

  // Emit the full envelope as JSON for programmatic callers.
  if (flag("json")) console.log("\n" + JSON.stringify(res, null, 2));
}

main().catch((err) => {
  console.error("\nPipeline error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
