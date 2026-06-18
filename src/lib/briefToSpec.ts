// ── Brief-to-spec ─────────────────────────────────────────────────────────
// Turns an unstructured natural-language brief into a structured AudioSpec via
// Claude with constrained JSON output. Runs on Haiku 4.5 — extraction is
// cheap and doesn't need a larger model. This step is mode-agnostic and
// reusable for any future task: it's the front door of the whole pipeline.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AudioSpecSchema, type AudioSpec } from "../types.js";
import { BRIEF_TO_SPEC_SYSTEM } from "../prompts/briefToSpec.js";

const BRIEF_TO_SPEC_MODEL = "claude-haiku-4-5";

export async function briefToSpec(
  client: Anthropic,
  brief: string,
): Promise<AudioSpec> {
  const response = await client.messages.parse({
    model: BRIEF_TO_SPEC_MODEL,
    max_tokens: 4000,
    system: BRIEF_TO_SPEC_SYSTEM,
    // Structured extraction via constrained output. NOTE: Haiku 4.5 does not
    // support the `effort` parameter (Opus/Sonnet-only), so it's omitted here.
    output_config: {
      format: zodOutputFormat(AudioSpecSchema),
    },
    messages: [
      {
        role: "user",
        content: `Here is the brief. Produce the production spec.\n\n---\n${brief}\n---`,
      },
    ],
  });

  const spec = response.parsed_output;
  if (!spec) {
    throw new Error(
      `brief-to-spec produced no parseable spec (stop_reason: ${response.stop_reason}).`,
    );
  }
  return spec;
}
