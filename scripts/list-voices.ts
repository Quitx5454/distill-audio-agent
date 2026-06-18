// List the account's live ElevenLabs voice library and flag our curated picks.
//   bun run voices
import { listVoices, VOICES } from "../src/lib/voices.js";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error("ELEVENLABS_API_KEY is not set (see .env.example).");
  process.exit(1);
}

const curatedIds = new Set(Object.values(VOICES).map((v) => v.id));

const voices = await listVoices(apiKey);
console.log(`\n${voices.length} voices in your library:\n`);
for (const v of voices) {
  const mark = curatedIds.has(v.voice_id) ? " ★ (Distill pick)" : "";
  console.log(`  ${v.name.padEnd(20)} ${v.voice_id}  [${v.category ?? "?"}]${mark}`);
}

console.log("\nDistill curated narration voices:");
for (const [key, v] of Object.entries(VOICES)) {
  const present = voices.some((lv) => lv.voice_id === v.id);
  console.log(`  ${key.padEnd(10)} ${v.id}  ${present ? "✓ in library" : "✗ NOT in library — add it"}  — ${v.register}`);
}
