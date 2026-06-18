// ── ASMR background layer ──────────────────────────────────────────────────
// Optional, one-per-request ambient bed mixed UNDER the narration. A fixed
// 10-second clip is generated via the ElevenLabs Sound Effects API, then looped
// to the narration's length and ducked to -18 dB so it never competes with the
// voice. The whole layer is opt-in: if no option is requested, none of this
// runs (no extra cost, no extra latency).
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

// The six exposed options. The user picks one of these keys; the string is the
// prompt sent to the Sound Effects API. No freeform input — predictable, and
// cheaper to reason about.
export const ASMR_OPTIONS = {
  rain: "steady gentle rain, soft and continuous, no thunder",
  fire_crackling: "cozy fireplace crackling, soft pops and embers",
  forest: "calm forest ambience, distant birds and rustling leaves",
  ocean_waves: "gentle ocean waves lapping on a shore, slow and even",
  white_noise: "smooth steady white noise, even and unobtrusive",
  coffee_shop: "quiet coffee shop ambience, soft murmur and clinks",
} as const;

export type AsmrOption = keyof typeof ASMR_OPTIONS;

// Sound Effects billing: 40 credits/sec × 10 sec = 400 credits per generation.
export const ASMR_CLIP_SECONDS = 10;
export const ASMR_CREDITS = 400;

// Default ducking: background sits 18 dB below the narration.
const DEFAULT_VOLUME_DB = -18;

// The ffmpeg binary. Defaults to "ffmpeg" (on PATH in the Railway image); set
// FFMPEG_PATH to an absolute path when it lives off-PATH (e.g. Homebrew on macOS
// at /opt/homebrew/bin/ffmpeg).
const FFMPEG_BIN = process.env.FFMPEG_PATH ?? "ffmpeg";

export function isAsmrOption(v: unknown): v is AsmrOption {
  return typeof v === "string" && v in ASMR_OPTIONS;
}

// True if ffmpeg is callable on this host. The mix step needs it; callers
// should check before promising an ASMR layer.
export function ffmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(FFMPEG_BIN, ["-version"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });
}

// Generate the fixed-length ambient clip and return its mp3 bytes.
export async function generateAsmrClip(
  apiKey: string,
  option: AsmrOption,
): Promise<Uint8Array> {
  const res = await fetch(
    "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128",
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: ASMR_OPTIONS[option],
        duration_seconds: ASMR_CLIP_SECONDS,
        prompt_influence: 0.3,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Sound Effects API failed: ${res.status} ${res.statusText} — ${await res.text()}`,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG_BIN, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", (e) =>
      reject(new Error(`ffmpeg could not be spawned (is it installed?): ${e.message}`)),
    );
    p.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg exited ${code}:\n${stderr.slice(-1500)}`)),
    );
  });
}

// Loop `asmrPath` under `narrationPath`, duck it to `volumeDb`, and write the
// mix to `outputPath`. The mix ends exactly when the narration ends
// (amix duration=first); normalize=0 keeps the voice at full level rather than
// letting amix halve both inputs.
export async function mixUnderNarration(
  narrationPath: string,
  asmrPath: string,
  outputPath: string,
  opts: { volumeDb?: number } = {},
): Promise<void> {
  const volumeDb = opts.volumeDb ?? DEFAULT_VOLUME_DB;
  await mkdir(dirname(outputPath), { recursive: true });
  await runFfmpeg([
    "-y",
    "-i", narrationPath,
    "-stream_loop", "-1", "-i", asmrPath, // loop the ambient bed indefinitely
    "-filter_complex",
    `[1:a]volume=${volumeDb}dB[bg];` +
      `[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`,
    "-map", "[a]",
    // Force stereo at a fixed 128 kbps so the ambient bed keeps its width and
    // the output matches the source narration's quality (amix otherwise
    // collapses to the narration's layout and VBR can land far too low).
    "-c:a", "libmp3lame", "-b:a", "128k", "-ac", "2",
    outputPath,
  ]);
}

export interface AsmrResult {
  option: AsmrOption;
  prompt: string;
  credits: number;
  outputPath: string;
  bytes: number;
}

// End-to-end: generate the clip, mix it under an existing narration mp3, and
// overwrite/return the final mixed file. Uses a temp file for the raw clip and
// a temp file for the mix so we never clobber the input mid-encode.
export async function applyAsmrLayer(
  apiKey: string,
  option: AsmrOption,
  narrationPath: string,
  outputPath: string,
  opts: { volumeDb?: number } = {},
): Promise<AsmrResult> {
  const clip = await generateAsmrClip(apiKey, option);
  const tmpClip = join(tmpdir(), `distill-asmr-${option}-${crypto.randomUUID()}.mp3`);
  // Mix to a temp path first so outputPath === narrationPath is safe.
  const tmpMix = join(tmpdir(), `distill-mix-${crypto.randomUUID()}.mp3`);
  try {
    await writeFile(tmpClip, clip);
    await mixUnderNarration(narrationPath, tmpClip, tmpMix, opts);
    const mixed = await readFile(tmpMix);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, mixed);
    return {
      option,
      prompt: ASMR_OPTIONS[option],
      credits: ASMR_CREDITS,
      outputPath,
      bytes: mixed.length,
    };
  } finally {
    await rm(tmpClip, { force: true }).catch(() => {});
    await rm(tmpMix, { force: true }).catch(() => {});
  }
}
