// ── Topic research → sourced script (Mode 2) ──────────────────────────────
// When the brief gives only a topic, this writes the script ourselves. Runs on
// Sonnet 4.6 with the server-side web_search tool and adaptive thinking. The
// model researches, verifies specifics, and returns a finished narration script
// plus a per-claim sources block — the same quality bar as a hand-written one.
import Anthropic from "@anthropic-ai/sdk";
import type { AudioSpec, ScriptResult } from "../types.js";
import { researchSystemPrompt } from "../prompts/research.js";

const RESEARCH_MODEL = "claude-sonnet-4-6";
const MAX_CONTINUATIONS = 6; // bound the server-side web-search loop

export async function researchScript(
  client: Anthropic,
  spec: AudioSpec,
): Promise<ScriptResult> {
  const system = researchSystemPrompt(spec);

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        `Research and write the script for this topic:\n\n${spec.source_text}\n\n` +
        `Hold the tone "${spec.tone_direction}" throughout. Remember the output ` +
        `format: script, then a line with only ===SOURCES===, then the sources.`,
    },
  ];

  let finalText = "";
  for (let i = 0; i < MAX_CONTINUATIONS; i++) {
    const response = await client.messages.create({
      model: RESEARCH_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      tools: [{ type: "web_search_20260209", name: "web_search" }],
      system,
      messages,
    });

    // Server-side tool loop hit its iteration cap — resume by re-sending.
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    finalText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (response.stop_reason === "refusal") {
      throw new Error("Research step was refused by the safety system.");
    }
    break;
  }

  if (!finalText) {
    throw new Error("Research step produced no script text.");
  }

  // Split the script from the sources on the ===SOURCES=== sentinel.
  const [scriptPart, sourcesPart = ""] = finalText.split(/^={3,}SOURCES={3,}\s*$/m);

  return {
    script: scriptPart.trim(),
    sources_markdown: sourcesPart.trim(),
    origin: "topic_research",
  };
}
