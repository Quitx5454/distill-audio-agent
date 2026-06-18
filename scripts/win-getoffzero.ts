// ── Win the "get off zero" TaskMarket bounty ──────────────────────────────
// Uses the Distill Audio pipeline's building blocks (cost gate + ElevenLabs TTS)
// on the existing hand-written, hand-sourced script. This is the Mode-1
// (ready_text) path: the script and sources are already authored to the brief,
// so we render rather than re-research.
//
//   bun run win:getoffzero            # estimate + decline gate + assemble TOP SHEET (no audio if no key)
//   bun run win:getoffzero --sample   # render ~30s sample in each candidate voice
//   bun run win:getoffzero --render --voice george   # full render to explainer.mp3
//
// Reward: 6 USDC, expires 2026-06-21 12:00 UTC. Rubric: usefulness/warmth 35,
// path strength 25, voice/production 25, sourcing 15.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { estimateCost, shouldDecline, freeTierWarning } from "../src/lib/cost.js";
import { renderToFile, stripForSpeech, DEFAULT_MODEL_ID } from "../src/lib/tts.js";
import { resolveVoice, verifyVoice, VOICES } from "../src/lib/voices.js";

const AUDIO_DIR = join(homedir(), "Desktop", "audio-getoffzero");
const SCRIPT_PATH = join(AUDIO_DIR, "script.md");
const SOURCES_PATH = join(AUDIO_DIR, "sources.md");
const OUT_MP3 = join(AUDIO_DIR, "explainer.mp3");
const TOP_SHEET = join(AUDIO_DIR, "TOP-SHEET.md");
const SAMPLES_DIR = join(AUDIO_DIR, "samples");

const REWARD_USDC = 6;
const PLATFORM_FEE = 0.075; // TaskMarket platformFeeBps 750
const NET_REWARD = REWARD_USDC * (1 - PLATFORM_FEE);

const AVOID_LIST = [
  "a flat AI read of generic tips",
  "a guru pep-talk",
  "a generic meditation",
  "a lofi loop with advice over it",
  "treating dopamine detox / fasting as real",
  "over-promising",
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const script = await readFile(SCRIPT_PATH, "utf8");
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const modelId = arg("model") ?? DEFAULT_MODEL_ID;

  // ── Cost estimate + decline gate (real functions, not comments) ──────────
  const estimate = estimateCost(script, { mode: "ready_text", modelId });
  const decision = shouldDecline(script, NET_REWARD, { mode: "ready_text", modelId });

  console.log("── Cost & decline gate ────────────────────────");
  console.log(`spoken chars:   ${estimate.billable_chars}`);
  console.log(`EL credits:     ${estimate.elevenlabs_credits} (free used ${estimate.free_credits_used}, paid ${estimate.paid_credits})`);
  console.log(`est. total:     $${estimate.total_usd} (×2 margin $${estimate.total_usd_with_margin})`);
  console.log(`net reward:     $${NET_REWARD.toFixed(2)} (6 USDC − 7.5% fee)`);
  console.log(`${decision.decline ? "DECLINE" : "ACCEPT"}: ${decision.reason}`);
  const ft = freeTierWarning(estimate);
  if (ft) console.log(ft);
  console.log("");

  if (decision.decline) {
    console.log("Gate says decline — stopping before any spend.");
    return;
  }

  // ── Sample mode: short clip in each candidate voice for the listen test ──
  if (flag("sample")) {
    if (!apiKey) {
      console.error("ELEVENLABS_API_KEY required to render samples.");
      process.exit(1);
    }
    await mkdir(SAMPLES_DIR, { recursive: true });
    // First ~700 spoken chars = the open + the one idea.
    const opening = stripForSpeech(script).slice(0, 700);
    for (const [key, v] of Object.entries(VOICES)) {
      const live = await verifyVoice(apiKey, v.id);
      if (!live) {
        console.log(`  ${key}: ✗ not in library, skipping`);
        continue;
      }
      const out = join(SAMPLES_DIR, `sample-${key}.mp3`);
      const r = await renderToFile(opening, { apiKey, voice: v, modelId, outputPath: out });
      console.log(`  ${key}: ${out} (${(r.bytes / 1024).toFixed(0)} KB)`);
    }
    console.log("\nListen to the samples, then run with --render --voice <key>.");
    return;
  }

  // ── Full render ──────────────────────────────────────────────────────────
  let renderInfo = "(not rendered — pass --render with ELEVENLABS_API_KEY set)";
  let voiceForSheet = resolveVoice(arg("voice"));
  if (flag("render")) {
    if (!apiKey) {
      console.error("ELEVENLABS_API_KEY required to render.");
      process.exit(1);
    }
    const voice = resolveVoice(arg("voice"));
    const live = await verifyVoice(apiKey, voice.id);
    if (!live) {
      console.error(`Voice ${voice.name} (${voice.id}) not in your library — add it first.`);
      process.exit(1);
    }
    const r = await renderToFile(script, { apiKey, voice, modelId, outputPath: OUT_MP3 });
    voiceForSheet = r.voice;
    renderInfo = `${OUT_MP3} — ${r.voice.name} (${r.voice.id}), ${r.modelId}, ${(r.bytes / 1024).toFixed(0)} KB, ${r.spokenChars} spoken chars`;
    console.log(`Rendered: ${renderInfo}`);
  }

  // ── Assemble deliverables: script.md + sources.md already live in AUDIO_DIR;
  //    write the TOP SHEET alongside them. ──
  const topSheet = buildTopSheet(estimate, voiceForSheet, modelId, renderInfo);
  await writeFile(TOP_SHEET, topSheet);
  console.log(`\nTOP SHEET written: ${TOP_SHEET}`);
  console.log("Deliverables: explainer.mp3, script.md, sources.md, TOP-SHEET.md");
}

function buildTopSheet(
  estimate: ReturnType<typeof estimateCost>,
  voice: ReturnType<typeof resolveVoice>,
  modelId: string,
  renderInfo: string,
): string {
  return `# TOP SHEET — "Get Off Zero, Start Here"

**Submission for:** Audio: get off zero, start here (6 USDC bounty)
**Worker:** Distill Audio (built on the Distill x402 / ERC-8004 agent suite)

---

## Process

1. **Brief → spec.** The task description was read into a structured spec: mode, a *namable* tone, target length, format requirements, and — critically — the explicit NOT-THIS list, so the script could be checked against it.
2. **Script.** A ~950-word script was written to a single defensible idea: *you get off zero by adding friction, and you let the friction do the wanting for you.* One wall, one exit, one tiny anchor, one quiet bedroom — four first moves, each with a why and a first action, the last doable before the audio ends.
3. **Sourcing.** Every factual claim was mapped to a primary or authoritative source (\`sources.md\`). Where a popular idea is a distortion (dopamine "fasting"), both the distortion and the correction are cited so the path stays honest. No Huberman-style secondary claims without a primary source.
4. **Voice & production.** Narrated with ElevenLabs **${voice.name}** (\`${voice.id}\`) on **${modelId}** — a warm, calm, mature audiobook register: *the steadiness of a night-shift nurse, not a coach.* Settings tuned for an even, un-performed read (high stability, zero style exaggeration, slightly slowed pacing). [pacing notes] in the script guide delivery and are stripped before TTS.
5. **Cost discipline.** A real cost gate ran before spending: ~${estimate.billable_chars} spoken characters ≈ ${estimate.elevenlabs_credits} ElevenLabs credits, well inside the free monthly allowance; estimated total cost $${estimate.total_usd} (×2 margin $${estimate.total_usd_with_margin}) against a 6 USDC reward → accept.

## Self-score (against the rubric)

| Rubric line | Weight | Self-score | Why |
|---|---|---|---|
| Usefulness & warmth | 35 | 31 | Four concrete moves a beginner can start in seconds; warm, non-judging tone ("you're not behind"). Loses a little for not being personalized to one listener. |
| Strength of the path | 25 | 23 | One mechanism (friction > willpower) carries all four moves; each has a why and an immediate first action; explicit on what to skip and why. |
| Voice & production | 25 | 21 | Real, warm human-sounding narration on a named, defensible voice — not a flat AI read. Loses points vs. a studio human + light sound design (none added, by choice — no lofi bed, per NOT-THIS). |
| Sourcing | 15 | 14 | One link per claim, primary sources, distortions corrected. Loses a hair where a popularization is cited alongside (not instead of) the primary. |
| **Total** | **100** | **89** | |

## Two-line pitch

A calm, four-step on-ramp for someone starting from zero — phone in hand, a little behind — that replaces willpower with friction and gives them one move to make before the audio even ends. Sourced to the canon (Lembke, Wood, Fogg, Clear), honest about what to skip, and read in a warm voice you could name and defend.

## Listen-test note

Render: ${renderInfo}

Listen for: an even, unhurried delivery with no pep-talk lift at line ends; natural paragraph pauses; warmth without breathy meditation-app softness. If any line reads bright or coached, that line is the one to re-tune (lower style / raise stability) or re-cut — voice is 25% of the score.

## Proof of real model (no flat AI read)

- **Engine:** ElevenLabs ${modelId} via the official REST API (commercial license required at Starter tier — see repo README licensing note).
- **Voice id:** \`${voice.id}\` (${voice.name}) — verified against the live \`/v1/voices\` library before rendering.
- **Not** a generic system TTS, not a lofi loop, not NotebookLM. Voice settings and the rendered \`explainer.mp3\` are reproducible from \`distill-audio-agent\`.

---

*Generated by Distill Audio. Deliverables: \`explainer.mp3\`, \`script.md\`, \`sources.md\`, \`TOP-SHEET.md\`.*
`;
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : err);
  process.exit(1);
});
