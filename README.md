# Distill Audio

> Warm, sourced, non-robotic narration & explainer audio. Part of the **Distill** x402 / ERC-8004 agent suite (*"Pure signal, no noise."*).

Distill Audio turns a brief — or just a topic — into a finished, well-paced, **human-sounding** audio explainer with a script and per-claim sources. It does not do flat AI reads, guru pep-talks, or lofi-with-advice. It commits to a tone you can *name and defend*.

This is **Part 1**: the generation pipeline + CLI. **Part 2** (planned) adds an ASMR layer and x402 wrapping so it can be sold per-call like Refine, Shield, and Trace.

---

## What it does

Two modes, both first-class:

- **Mode 1 — ready text.** You hand it a finished script. It extracts tone/length/format/avoid-list from your (possibly messy) natural-language brief, strips pacing notes, and renders the audio.
- **Mode 2 — topic only.** You hand it a topic or question. It researches with web search, writes a properly **sourced** script (one link per claim, distortions corrected), then renders the same way.

The pipeline spine:

```
 brief (free text)
      │
      ▼
 brief-to-spec ──→ AudioSpec { mode, tone, length, format[], avoid[], one_idea, source_text }
      │
      ├─ ready_text ─────────────→ use the supplied script
      └─ topic_research ─→ web-search + write ─→ sourced script
      │
      ▼
 cost gate (estimate + free-tier check + decline-if-unprofitable)
      │
      ▼
 ElevenLabs TTS (named voice, tuned for steady narration) ──→ explainer.mp3
```

Everything returns inside the **Distill Standard Envelope** (`{ distill_version, agent_id, session_id, status, output, processed_at }`), the same contract the other agents use — so Part 2's x402 wrapping drops straight in.

---

## Provider & cost

**TTS:** [ElevenLabs](https://elevenlabs.io) via the official REST API. Default model `eleven_multilingual_v2` (10,000 char/request, best voice consistency for long-form, 1 credit/char). Default voice **George** (`JBFqnCBsd6RMkjVDRZzb`) — warm, calm, mature audiobook narrator.

**LLM:** Claude via `@anthropic-ai/sdk` — `claude-sonnet-4-6` for brief-to-spec (cheap, structured), `claude-opus-4-8` for topic research (quality + web search).

**Cost gate** (`src/lib/cost.ts` — real callable functions, not comments):

- `estimateCost(script, …)` → spoken chars, ElevenLabs credits, free-vs-paid split, LLM spend, total × safety margin.
- `shouldDecline(script, rewardUsd, …)` → for paid jobs (e.g. TaskMarket bounties), declines when `reward < cost × margin` (default ×2).
- `freeTierWarning(estimate)` → warns only when a render would exceed the free monthly credit allowance.

ElevenLabs economics baked in: $6/mo Starter = 30,000 credits → $0.0002/credit; free tier = 10,000 credits/month at $0.

> ### ⚠️ Licensing note (read before commercial use)
> The ElevenLabs **free tier does not include a commercial license** and typically requires attribution. A commercial license starts at the **Starter** tier (~$6/mo). For paid work (e.g. a TaskMarket bounty), the render may fit the free *character* allowance at $0, but the **license** to use it commercially does not. Decide before publishing: upgrade to Starter, or accept the free-tier terms.

---

## Setup

```bash
cd distill-audio-agent
bun install
cp .env.example .env      # then fill in the two keys
```

Put your keys in `.env`:

```
ELEVENLABS_API_KEY=...     # required to render audio
ANTHROPIC_API_KEY=...      # reuse the same key as the other Distill agents
```

Check your live voice library (confirms the chosen voice id is real before spending):

```bash
bun run voices
```

---

## Usage

```bash
# Dry run — brief-to-spec + cost estimate, no audio:
bun run generate --brief "Explain compound interest for total beginners, ~5 min, warm and plain."

# Read the brief from a file:
bun run generate --brief-file brief.md

# Run the decline gate against a bounty reward:
bun run generate --brief-file task.md --reward 6

# Full render to an mp3:
bun run generate --brief-file brief.md --render --out deliverables/out.mp3 --voice george
```

Flags: `--voice <key|id>` · `--model <id>` · `--free <credits>` · `--margin <n>` · `--reward <usd>` · `--json`.

---

## Repo layout

```
src/
  index.ts            CLI orchestrator
  pipeline.ts         mode router: brief → spec → [research] → cost gate → TTS
  types.ts            AudioSpec, CostEstimate, ScriptResult (zod)
  lib/
    briefToSpec.ts    NL brief → structured AudioSpec (Sonnet, structured output)
    research.ts       Mode 2: Opus + web_search → sourced script
    tts.ts            ElevenLabs REST render (strips pacing notes, chunks, writes mp3)
    cost.ts           estimateCost / shouldDecline / freeTierWarning
    voices.ts         curated voice registry + live /v1/voices verification
    envelope.ts       Distill Standard Envelope (shared contract)
  prompts/
    briefToSpec.ts    intake-producer system prompt
    research.ts       writer-researcher system prompt
scripts/
  list-voices.ts      `bun run voices`
  win-getoffzero.ts   render the live bounty deliverables + TOP SHEET
```

---

## Part 2 (planned)

- **ASMR layer** — optional gentle ambience / binaural option for the wind-down end of the audio space.
- **x402 wrapping** — expose `POST /entrypoints/audio/invoke` behind the CDP facilitator paywall + x402 Bazaar discovery + A2A agent card, register on Base Mainnet, list on TaskMarket. Then Distill Audio sells per-call like Refine.

---

*Distill — stateless middleware agents for the x402/ERC-8004 agent economy.*
