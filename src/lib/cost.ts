// ── Cost estimation + decline gate ────────────────────────────────────────
// Real, callable functions — not comments. The pipeline calls estimateCost()
// before any TTS render, and shouldDecline() before accepting a paid job
// (e.g. a TaskMarket bounty). On the free tier the first FREE_TIER_CREDITS
// credits/month are $0; we warn only when a render would exceed that.
import type { AudioMode, CostEstimate, DeclineDecision } from "../types.js";

// ElevenLabs economics (checked against elevenlabs.io/pricing, June 2026):
//   Starter = $6/mo for 30,000 credits  →  $0.0002 / credit.
//   eleven_multilingual_v2: 1 credit per character.
//   eleven_flash_v2_5 / eleven_turbo_v2_5: 0.5 credit per character.
//   Free tier: 10,000 credits/month at $0 (NO commercial license — see README).
export const USD_PER_CREDIT = 6 / 30_000; // 0.0002
export const DEFAULT_FREE_TIER_CREDITS = 10_000;

// Credits consumed per spoken character, by model.
const CREDITS_PER_CHAR: Record<string, number> = {
  eleven_multilingual_v2: 1,
  eleven_v3: 1,
  eleven_flash_v2_5: 0.5,
  eleven_turbo_v2_5: 0.5,
};

// Rough Claude spend per stage, in USD. Brief-to-spec is a small Sonnet call;
// topic research is an Opus call with web search (more in+out tokens). These
// are deliberately generous so the ×2 safety margin stays honest.
const LLM_USD_BRIEF_TO_SPEC = 0.03; // ~Sonnet 4.6, short structured output
const LLM_USD_RESEARCH = 0.4; // ~Opus 4.8 + web search, full sourced script

// Strip everything that is NOT spoken before counting characters: [bracketed
// pacing notes], markdown headers/bold/italics/links, and HTML comments. This
// is the same normalization tts.ts applies before sending to ElevenLabs, so the
// estimate matches what actually gets billed.
export function countBillableChars(script: string): number {
  const spoken = script
    .replace(/<!--[\s\S]*?-->/g, "") // HTML comments
    .replace(/\[[^\]]*\]/g, "") // [pacing notes]
    .replace(/^#{1,6}\s.*$/gm, "") // markdown headers
    .replace(/^---+$/gm, "") // horizontal rules
    .replace(/^\s*\*+\s*$/gm, "") // bullet-only lines
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/\*([^*]+)\*/g, "$1") // italics
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links/images → label
    .replace(/\s+/g, " ") // collapse whitespace
    .trim();
  return spoken.length;
}

// Estimate the full cost of a render. `mode` decides whether research LLM spend
// is included. `freeTierCredits` is the remaining free allowance this month.
export function estimateCost(
  script: string,
  opts: {
    mode: AudioMode;
    modelId?: string;
    freeTierCredits?: number;
    safetyMargin?: number;
  },
): CostEstimate {
  const modelId = opts.modelId ?? "eleven_multilingual_v2";
  const freeTier = opts.freeTierCredits ?? DEFAULT_FREE_TIER_CREDITS;
  const margin = opts.safetyMargin ?? 2;

  const billableChars = countBillableChars(script);
  const creditsPerChar = CREDITS_PER_CHAR[modelId] ?? 1;
  const credits = Math.ceil(billableChars * creditsPerChar);

  // Free tier covers the first `freeTier` credits this month; only the excess
  // is charged. On the free plan with headroom, paidCredits is 0 → $0.
  const freeUsed = Math.min(credits, Math.max(freeTier, 0));
  const paidCredits = Math.max(credits - freeUsed, 0);
  const elevenlabsUsd = paidCredits * USD_PER_CREDIT;

  const llmUsd =
    LLM_USD_BRIEF_TO_SPEC +
    (opts.mode === "topic_research" ? LLM_USD_RESEARCH : 0);

  const totalUsd = elevenlabsUsd + llmUsd;

  return {
    billable_chars: billableChars,
    elevenlabs_credits: credits,
    elevenlabs_usd: Number(elevenlabsUsd.toFixed(4)),
    free_credits_used: freeUsed,
    paid_credits: paidCredits,
    llm_usd: Number(llmUsd.toFixed(4)),
    total_usd: Number(totalUsd.toFixed(4)),
    total_usd_with_margin: Number((totalUsd * margin).toFixed(4)),
    exceeds_free_tier: credits > freeTier,
  };
}

// Decline gate for a paid job. `rewardUsd` is the bounty (already net of any
// platform fee if you want to be strict). Declines when reward < cost × margin,
// i.e. when total_usd_with_margin would not be comfortably covered.
export function shouldDecline(
  script: string,
  rewardUsd: number,
  opts: {
    mode: AudioMode;
    modelId?: string;
    freeTierCredits?: number;
    safetyMargin?: number;
  },
): DeclineDecision {
  const estimate = estimateCost(script, opts);

  if (rewardUsd < estimate.total_usd_with_margin) {
    return {
      decline: true,
      reason:
        `Reward $${rewardUsd.toFixed(2)} is below estimated cost ` +
        `$${estimate.total_usd.toFixed(2)} × ${opts.safetyMargin ?? 2} = ` +
        `$${estimate.total_usd_with_margin.toFixed(2)}. Not worth taking.`,
      estimate,
    };
  }

  return {
    decline: false,
    reason:
      `Reward $${rewardUsd.toFixed(2)} comfortably covers estimated cost ` +
      `$${estimate.total_usd.toFixed(2)} (×${opts.safetyMargin ?? 2} margin = ` +
      `$${estimate.total_usd_with_margin.toFixed(2)}).`,
    estimate,
  };
}

// Convenience: warn (don't decline) when a render would spill past the free
// allowance. The pipeline surfaces this to the operator before spending.
export function freeTierWarning(estimate: CostEstimate): string | null {
  if (!estimate.exceeds_free_tier) return null;
  return (
    `⚠️  This render needs ${estimate.elevenlabs_credits} ElevenLabs credits — ` +
    `${estimate.paid_credits} beyond the free monthly allowance ` +
    `(~$${estimate.elevenlabs_usd.toFixed(2)} of paid credits). ` +
    `On the free tier this will fail once the allowance is exhausted; ` +
    `upgrade to Starter or trim the script.`
  );
}
