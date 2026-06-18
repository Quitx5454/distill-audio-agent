// ── ElevenLabs TTS ────────────────────────────────────────────────────────
// Takes an annotated script (with [pacing notes] and markdown), strips it down
// to spoken text, and renders an mp3 via the ElevenLabs REST API. Direct fetch,
// no SDK dependency — keeps the tree lean and the license story clean.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveVoice, type VoiceProfile } from "./voices.js";

export const DEFAULT_MODEL_ID = "eleven_multilingual_v2";

// eleven_multilingual_v2 caps at 10,000 characters per request. Stay under it
// with headroom; longer scripts are chunked on paragraph boundaries.
const MAX_CHARS_PER_REQUEST = 9000;

// Turn the annotated script into spoken text: drop [pacing notes], markdown
// headers/bold/italics/links, and rules — but KEEP paragraph breaks, which the
// model renders as natural pauses. Mirrors cost.countBillableChars' removals.
export function stripForSpeech(script: string): string {
  return script
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[[^\]]*\]/g, "") // [pacing notes]
    .replace(/^#{1,6}\s.*$/gm, "") // headers
    .replace(/^---+$/gm, "") // horizontal rules
    .replace(/^\s*\*+\s*$/gm, "") // bullet-only lines
    .replace(/\*\*([^*]+)\*\*/g, "$1") // bold
    .replace(/\*([^*]+)\*/g, "$1") // italics
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links → label
    .replace(/[ \t]+/g, " ") // collapse intra-line whitespace
    .replace(/\n{3,}/g, "\n\n") // collapse big gaps to a paragraph break
    .trim();
}

// Split spoken text into <=maxChars chunks on paragraph, then sentence,
// boundaries so we never cut mid-word.
function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const para of text.split(/\n\n+/)) {
    if ((current + "\n\n" + para).length <= maxChars) {
      current = current ? `${current}\n\n${para}` : para;
      continue;
    }
    if (current) chunks.push(current);
    if (para.length <= maxChars) {
      current = para;
    } else {
      // A single paragraph longer than the cap — split on sentences.
      let sent = "";
      for (const s of para.split(/(?<=[.!?])\s+/)) {
        if ((sent + " " + s).length <= maxChars) {
          sent = sent ? `${sent} ${s}` : s;
        } else {
          if (sent) chunks.push(sent);
          sent = s;
        }
      }
      current = sent;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export interface RenderOptions {
  apiKey: string;
  voice?: VoiceProfile | string;
  modelId?: string;
  outputPath: string;
}

export interface RenderResult {
  outputPath: string;
  voice: VoiceProfile;
  modelId: string;
  spokenChars: number;
  chunks: number;
  bytes: number;
}

// Render one chunk to mp3 bytes.
async function renderChunk(
  apiKey: string,
  voice: VoiceProfile,
  modelId: string,
  text: string,
): Promise<Uint8Array> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice.id}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: voice.settings,
      }),
    },
  );

  if (!res.ok) {
    throw new Error(
      `ElevenLabs TTS failed: ${res.status} ${res.statusText} — ${await res.text()}`,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

// Render a full annotated script to an mp3 file on disk.
export async function renderToFile(
  script: string,
  opts: RenderOptions,
): Promise<RenderResult> {
  const voice =
    typeof opts.voice === "string" || opts.voice === undefined
      ? resolveVoice(opts.voice)
      : opts.voice;
  const modelId = opts.modelId ?? DEFAULT_MODEL_ID;

  const spoken = stripForSpeech(script);
  const chunks = chunkText(spoken, MAX_CHARS_PER_REQUEST);

  const buffers: Uint8Array[] = [];
  for (const chunk of chunks) {
    buffers.push(await renderChunk(opts.apiKey, voice, modelId, chunk));
  }

  // Concatenate mp3 segments. For same-encoding adjacent CBR segments this
  // produces a valid, playable file; a single chunk is the common case.
  const total = buffers.reduce((n, b) => n + b.length, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) {
    combined.set(b, offset);
    offset += b.length;
  }

  await mkdir(dirname(opts.outputPath), { recursive: true });
  await writeFile(opts.outputPath, combined);

  return {
    outputPath: opts.outputPath,
    voice,
    modelId,
    spokenChars: spoken.length,
    chunks: chunks.length,
    bytes: total,
  };
}
