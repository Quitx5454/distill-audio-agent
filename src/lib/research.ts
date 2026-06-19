// ── Topic research → sourced script (Mode 2) ──────────────────────────────
// When the brief gives only a topic, this writes the script ourselves. Runs on
// Haiku 4.5 with the server-side web_search tool (search + summarize doesn't
// need Sonnet-level reasoning, and Haiku is ~3× cheaper, which also caps the
// blast radius per search cycle). The model researches, verifies specifics, and
// returns a finished narration script plus a per-claim sources block.
// NOTE: Haiku 4.5 does not support adaptive thinking or the effort param — see
// the create() call below.
import Anthropic from "@anthropic-ai/sdk";
import type { AudioSpec, ScriptResult } from "../types.js";
import { researchSystemPrompt } from "../prompts/research.js";

const RESEARCH_MODEL = "claude-haiku-4-5";
// Hard cap on web searches PER request. A short narration brief needs only a
// few fact-checks (simple queries use 1–3). Without this the server-side
// web_search tool is UNCAPPED — a single call can fire dozens of searches, then
// re-fire them on every pause_turn continuation and every silent SDK retry.
// Exceeding the cap returns a max_uses_exceeded tool error and the model stops
// searching, so this bounds total searches per request.
const WEB_SEARCH_MAX_USES = 5;
// Continuation cap for the pause_turn resume loop. This bounds API round-trips,
// NOT searches (max_uses does that). With max_uses=5 < the server loop's
// 10-iteration pause threshold, the model stops searching and ends the turn
// well before this — so 3 is ample for finishing a paused turn (was 6).
const MAX_CONTINUATIONS = 3;

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
  let totalSearches = 0;
  let calls = 0;
  for (let i = 0; i < MAX_CONTINUATIONS; i++) {
    calls++;
    // Haiku 4.5 does NOT support adaptive thinking or the effort param (Models
    // API: thinking.adaptive=false, effort.supported=false) — sending either
    // 400s. Run it plain: search + write, no extended thinking.
    const response = await client.messages.create({
      model: RESEARCH_MODEL,
      max_tokens: 16000,
      // allowed_callers: ["direct"] — web_search_20260209 defaults to requiring
      // programmatic tool calling (for dynamic filtering, which needs the
      // code-execution tool we don't enable). Haiku 4.5 doesn't support PTC, so
      // force direct invocation; basic search works, no dynamic filtering.
      tools: [{
        type: "web_search_20260209",
        name: "web_search",
        max_uses: WEB_SEARCH_MAX_USES,
        allowed_callers: ["direct"],
      }],
      system,
      messages,
    });

    // The API reports billed searches in usage.server_tool_use.web_search_requests
    // (one per search). Accumulate across continuations for real per-request visibility.
    const used =
      (response.usage as { server_tool_use?: { web_search_requests?: number } })
        .server_tool_use?.web_search_requests ?? 0;
    totalSearches += used;

    // Server-side tool loop paused mid-work — resume by re-sending.
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

  // Visibility going forward — so search volume shows up in logs, not just the
  // billing dashboard.
  console.log(
    `[research] web_search_requests=${totalSearches} across ${calls} model call(s) ` +
      `(max_uses=${WEB_SEARCH_MAX_USES}/call, continuation cap=${MAX_CONTINUATIONS})`,
  );

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
