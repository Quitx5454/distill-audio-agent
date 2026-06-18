// ── Distill Audio — shared types & schemas ────────────────────────────────
// The AudioSpec is the contract between brief-to-spec (which produces it from
// unstructured natural language) and the rest of the pipeline (which consumes
// it). Keeping it a Zod schema lets the brief-to-spec LLM step emit it via
// structured output and lets every downstream step trust its shape.
import { z } from "zod";

// Two ways a job can arrive. `ready_text` = the caller already wrote a script;
// `topic_research` = the caller gave only a topic/question and we must research
// and write the script ourselves before narrating.
export const AudioModeSchema = z.enum(["ready_text", "topic_research"]);
export type AudioMode = z.infer<typeof AudioModeSchema>;

// The structured brief. Extracted from a free-text brief (a TaskMarket task
// description, a one-line request, anything). Every field is something the
// pipeline actually acts on — no decorative metadata.
export const AudioSpecSchema = z.object({
  mode: AudioModeSchema,
  // One short, *namable and defensible* tone direction. Not "engaging" —
  // something like "the steady, unhurried register of a night-shift nurse".
  tone_direction: z.string().min(1),
  // Target spoken length. We derive a character budget from this.
  target_minutes_min: z.number().positive(),
  target_minutes_max: z.number().positive(),
  // Format requirements pulled from the brief (e.g. "numbered first steps,
  // each with a why and a first action; soft close"). Free-text, one per item.
  format_requirements: z.array(z.string()).default([]),
  // Things to explicitly NOT do — the brief's NOT-THIS list. The script and
  // any research must avoid these.
  avoid_list: z.array(z.string()).default([]),
  // For ready_text: the verbatim script. For topic_research: the topic/question.
  // The pipeline branches on `mode` to decide how to read this.
  source_text: z.string().min(1),
  // Optional explicit deliverable list parsed from the brief.
  deliverables: z.array(z.string()).default([]),
  // One-line restatement of what the listener should walk away able to do.
  one_idea: z.string().default(""),
});
export type AudioSpec = z.infer<typeof AudioSpecSchema>;

// A finished, narration-ready script plus its sourcing. Mode 1 fills `script`
// from the caller's text and leaves `sources` empty; Mode 2 produces both.
export interface ScriptResult {
  // The full script, INCLUDING any [bracketed pacing notes]. The TTS layer is
  // responsible for stripping those before sending audio to ElevenLabs.
  script: string;
  // Markdown sources block ("one link per claim"), or "" in ready_text mode.
  sources_markdown: string;
  // Where the script came from, for the TOP SHEET / provenance.
  origin: AudioMode;
}

// Output of the cost estimator — a real object the decline gate consumes.
export interface CostEstimate {
  // Spoken characters after stripping pacing notes / markdown.
  billable_chars: number;
  // ElevenLabs credits (== chars for multilingual_v2; 0.5×chars for flash/turbo).
  elevenlabs_credits: number;
  // Dollar cost of those credits OUTSIDE the free allowance.
  elevenlabs_usd: number;
  // How many of the credits fall inside the remaining free-tier allowance.
  free_credits_used: number;
  // Credits that exceed the free allowance (the part that actually costs money).
  paid_credits: number;
  // Estimated Claude spend (brief-to-spec + optional research), in USD.
  llm_usd: number;
  // Total estimated USD (elevenlabs_usd + llm_usd).
  total_usd: number;
  // total_usd × the safety margin — the figure the decline gate compares against.
  total_usd_with_margin: number;
  // True when this render would push past the free-tier credit allowance.
  exceeds_free_tier: boolean;
}

// Verdict from the decline gate for a paid job (e.g. a TaskMarket bounty).
export interface DeclineDecision {
  decline: boolean;
  reason: string;
  estimate: CostEstimate;
}
