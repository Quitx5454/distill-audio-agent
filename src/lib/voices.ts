// ── Voice registry + live verification ────────────────────────────────────
// We commit to a small set of *namable, defensible* narration voices rather
// than picking blind. The default is George — a warm, calm, mature audiobook
// narrator, the "night-shift nurse, not a coach" register the brief asks for.
// Every id here is a real ElevenLabs premade voice; verifyVoice() confirms it
// still exists in the account's live /v1/voices library before a render.

export interface VoiceProfile {
  id: string;
  name: string;
  // Why this voice fits warm, unhurried, non-robotic narration.
  register: string;
  // Default voice settings tuned for steady long-form reading (see tts.ts).
  settings: {
    stability: number;
    similarity_boost: number;
    style: number;
    use_speaker_boost: boolean;
    speed: number;
  };
}

// High stability + low style keeps the delivery even and un-performed — no
// pep-talk lift, no breathy meditation softness. speed slightly under 1.0 for
// the "a little slow" pacing the brief calls for.
const STEADY_NARRATION = {
  stability: 0.55,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: true,
  speed: 0.96,
};

// Curated candidates. George is the default; the others are alternates so a
// listener can pick after hearing a sample (voice is 25% of the bounty rubric).
export const VOICES: Record<string, VoiceProfile> = {
  george: {
    id: "JBFqnCBsd6RMkjVDRZzb",
    name: "George",
    register: "warm, calm, mature British audiobook narrator — kind and steady",
    settings: { ...STEADY_NARRATION },
  },
  matilda: {
    id: "XrExE9yKIg1WjnnlVkGX",
    name: "Matilda",
    register: "warm, friendly female narrator — gentle without being soft-spoken",
    settings: { ...STEADY_NARRATION },
  },
  lily: {
    id: "pFZP5JQG7iQjIQuC4Bku",
    name: "Lily",
    register: "warm, measured British female — calm and reassuring",
    settings: { ...STEADY_NARRATION },
  },
  brian: {
    id: "nPczCjzI2devNBz1zQrb",
    name: "Brian",
    register: "deep, resonant American narrator — grounded, unhurried",
    settings: { ...STEADY_NARRATION, stability: 0.6 },
  },
};

export const DEFAULT_VOICE = VOICES.george;

// Resolve a voice by env override, key, or fall back to the default.
export function resolveVoice(idOrKey?: string): VoiceProfile {
  if (!idOrKey) return DEFAULT_VOICE;
  const byKey = VOICES[idOrKey.toLowerCase()];
  if (byKey) return byKey;
  const byId = Object.values(VOICES).find((v) => v.id === idOrKey);
  if (byId) return byId;
  // An id we don't have a profile for — use it with default settings so callers
  // can point at any voice in their library.
  return {
    id: idOrKey,
    name: idOrKey,
    register: "custom voice (no curated profile)",
    settings: { ...STEADY_NARRATION },
  };
}

interface ElevenVoice {
  voice_id: string;
  name: string;
  category?: string;
}

// Fetch the account's live voice library. Used by `bun run voices` and by the
// pipeline to confirm the chosen voice id is real before spending credits.
export async function listVoices(apiKey: string): Promise<ElevenVoice[]> {
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey },
  });
  if (!res.ok) {
    throw new Error(
      `ElevenLabs /v1/voices failed: ${res.status} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { voices: ElevenVoice[] };
  return body.voices;
}

// Confirm a voice id exists in the live library. Returns the matching voice, or
// null if the account can't see it (premade voices may need to be "added" to
// the library from the shared catalog first).
export async function verifyVoice(
  apiKey: string,
  voiceId: string,
): Promise<ElevenVoice | null> {
  const voices = await listVoices(apiKey);
  return voices.find((v) => v.voice_id === voiceId) ?? null;
}
