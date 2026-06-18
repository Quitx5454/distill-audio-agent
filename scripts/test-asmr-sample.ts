// ── Raw ElevenLabs Sound Effects API smoke test ───────────────────────────
// Verifies /v1/sound-generation works BEFORE we wire ASMR into the pipeline.
// No ffmpeg, no pipeline — just one 10-second clip to disk so we can listen.
//
//   bun run scripts/test-asmr-sample.ts            # default: rain
//   bun run scripts/test-asmr-sample.ts forest     # any of the 6 prompts
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const PROMPTS: Record<string, string> = {
  rain: "steady gentle rain, soft and continuous, no thunder",
  fire_crackling: "cozy fireplace crackling, soft pops and embers",
  forest: "calm forest ambience, distant birds and rustling leaves",
  ocean_waves: "gentle ocean waves lapping on a shore, slow and even",
  white_noise: "smooth steady white noise, even and unobtrusive",
  coffee_shop: "quiet coffee shop ambience, soft murmur and clinks",
};

const DURATION_SECONDS = 10; // fixed per spec (40 credits/sec × 10 = 400 credits)
const OUT_DIR = join(homedir(), "Desktop", "audio-getoffzero", "asmr-samples");

async function main() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    console.error("ELEVENLABS_API_KEY is not set.");
    process.exit(1);
  }
  const which = (process.argv[2] ?? "rain").toLowerCase();
  const prompt = PROMPTS[which];
  if (!prompt) {
    console.error(`Unknown ASMR option "${which}". Choices: ${Object.keys(PROMPTS).join(", ")}`);
    process.exit(1);
  }

  console.log(`Generating ${DURATION_SECONDS}s "${which}" via /v1/sound-generation ...`);
  const res = await fetch(
    "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128",
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: prompt,
        duration_seconds: DURATION_SECONDS,
        prompt_influence: 0.3,
      }),
    },
  );

  if (!res.ok) {
    console.error(`Sound Effects API failed: ${res.status} ${res.statusText}`);
    console.error(await res.text());
    process.exit(1);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  await mkdir(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, `${which}.mp3`);
  await writeFile(out, bytes);
  console.log(`OK — wrote ${out} (${(bytes.length / 1024).toFixed(0)} KB)`);
}

main().catch((e) => {
  console.error("Error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
