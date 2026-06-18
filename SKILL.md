---
name: distill-audio
description: Generate warm, sourced, non-robotic explainer/narration audio from a finished script or just a topic. Use when a task asks for a voiced audio guide, explainer.mp3, narration, or "turn this into audio" — especially marketplace/TaskMarket audio bounties with a tone, length, and NOT-THIS list. Handles two modes (ready text, topic research), estimates cost and declines unprofitable paid jobs, and renders via ElevenLabs with a named, defensible voice.
---

# Distill Audio

Produce a finished audio explainer — `explainer.mp3` plus `script.md` and `sources.md` — that is warm, plain-spoken, and sourced per claim. Never a flat AI read, a guru pep-talk, a generic meditation, or a lofi loop with advice over it.

## When to use

- A brief asks for a voiced audio guide / narration / explainer, or names `explainer.mp3` as a deliverable.
- A TaskMarket bounty asks for audio with a tone, a length, a path, and a NOT-THIS list.
- You have a finished script and want it narrated well (Mode 1), **or** only a topic and need it researched + written + narrated (Mode 2).

## How it works

1. **Brief → spec.** `briefToSpec()` reads the unstructured brief (handles messy, capitalized marketplace descriptions) and emits a structured `AudioSpec`: `mode`, a *namable* `tone_direction`, target length, `format_requirements`, `avoid_list`, `one_idea`, `source_text`.
2. **Acquire script.**
   - `ready_text` → use the supplied script verbatim.
   - `topic_research` → `researchScript()` runs Sonnet 4.6 + the `web_search` tool to write a sourced script (one link per claim; correct popular distortions; cite primary sources, not influencers).
3. **Cost gate** (`src/lib/cost.ts`): `estimateCost()` → credits + free/paid split + LLM spend + ×2 margin. For paid jobs, `shouldDecline(script, rewardUsd, …)` declines when `reward < cost × margin`. `freeTierWarning()` warns only when a render exceeds the free monthly credit allowance. (briefToSpec runs on Haiku 4.5 — note it does **not** support the `effort` param.)
4. **Render** (`src/lib/tts.ts`): strip `[pacing notes]` + markdown, verify the voice id against the live `/v1/voices` library, render via ElevenLabs `eleven_multilingual_v2`, write the mp3.
5. **ASMR layer** (optional, `src/lib/asmr.ts`): one of six fixed ambient beds (rain, fire_crackling, forest, ocean_waves, white_noise, coffee_shop). A 10s Sound Effects clip is looped to length and mixed under the narration at −18 dB via ffmpeg. Requires ffmpeg; if absent, the narration still renders and the layer self-skips.

All output is wrapped in the Distill Standard Envelope.

## Live x402 service (Part 2)

Deployed on Railway, callable via x402 on Base Mainnet:

- **URL:** https://distill-audio-agent-production.up.railway.app
- **Endpoint:** `POST /generate` → returns `audio/mpeg` (or a Distill envelope error)
- **Body:** `{ "brief": "<script or topic>", "asmr": "rain" | … | null }`
- **Price:** flat **2.00 USDC** per request (any mode, with or without ASMR) · payTo `0x104b5768…388A` · agentId 54502
- Stack: pure Express + `@x402/express` (CDP facilitator) + Bazaar discovery extension. Public `/.well-known/agent-card.json`. ffmpeg ships in the Docker image.

## Quality rules (non-negotiable)

- **Commit to a tone you can name and defend** (e.g. "the steady register of a night-shift nurse, not a coach"). A flat read does not place.
- **Source every claim.** Prefer primary/peer-reviewed work over secondary podcasts. Where a popular idea is a distortion, cite both the distortion and the correction.
- **Honor the avoid_list.** Check the script against the brief's NOT-THIS items.
- **No over-promising.** Concrete first actions a beginner can take immediately beat grand claims.

## Voices

Curated, warm narration voices in `src/lib/voices.ts` (default **George**, `JBFqnCBsd6RMkjVDRZzb`). Settings tuned for an even, un-performed read: high stability, zero style exaggeration, slightly slowed pacing. Render short samples in 2–3 voices and **listen before committing** — voice is typically ~25% of an audio rubric.

## Commands

```bash
bun run voices                                          # live voice library
bun run generate --brief-file brief.md                  # dry run (spec + estimate)
bun run generate --brief-file task.md --reward 6        # + decline gate
bun run generate --brief-file brief.md --render --out deliverables/out.mp3 --voice george
bun run generate --brief-file brief.md --render --out deliverables/out.mp3 --asmr rain   # + ASMR bed
bun run start                                          # x402 HTTP server (POST /generate)
```

## Cost & licensing

ElevenLabs Starter = $6/mo / 30,000 credits ($0.0002/credit); free tier = 10,000 credits/mo at $0. `eleven_multilingual_v2` = 1 credit/char. **The free tier has no commercial license** — for paid work, upgrade to Starter or accept free-tier terms before publishing.
