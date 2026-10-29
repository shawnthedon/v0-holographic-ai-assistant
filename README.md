# Holographic AI assistant

*Automatically synced with your [v0.app](https://v0.app) deployments*

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com/johnny-bads-projects/v0-holographic-ai-assistant)
[![Built with v0](https://img.shields.io/badge/Built%20with-v0.app-black?style=for-the-badge)](https://v0.app/chat/eDhlkkGK2Uq)

## The interface — NEXUS console

The UI is a single full-bleed holographic console rather than a dashboard of
cards: a volumetric subject projection standing on an emitter array, framed by
scan telemetry that responds to the assistant's real state.

**Layout** — scan header (mode selector, segmented progress, live clock) ·
left rail (sensor array, streaming neural log, neural flux) · centre stage
(orbital assembly, reticle, scan sweep, projector cone, pedestal) · right rail
(cerebral activation, output level, duplex carrier + voiceprint) · bottom
telemetry strip flanking the command dock · transcript overlay.

**Interaction** — the dock is magnetic and physical (press scale `0.96`, spring
release). Opening the microphone channel spins up the orbital assembly, pushes
the scan sweep hotter, switches the accent from cyan to lime and drives every
meter/oscilloscope. Clicking the subject fires a deep scan burst.

**Motion** — every animation is [anime.js v4](https://animejs.com) driven:
`createTimeline` for the cold-boot sequence, `stagger` for entrances, and
`animation.stretch()` to retime live orbits without losing their phase. Canvas
instruments run their own single RAF loop and read the telemetry store
directly, so 5 Hz data never re-renders the page. Full breakdown: [`docs/ANIME_MOTION.md`](docs/ANIME_MOTION.md).

`prefers-reduced-motion` is honoured everywhere — instruments snap to their
final state and nothing loops.

## Live instrumentation

Every readout on the console is measured, not invented. `lib/hud/telemetry.ts`
is a single external store that samples the running application and publishes at
5 Hz; components subscribe to one metric each through `useMetric()` so a value
change never re-renders the page.

| Readout | Source |
| --- | --- |
| render engine (fps, frame, worst frame, jank) | `requestAnimationFrame` timing + `PerformanceObserver` long tasks |
| runtime (heap, limit, DOM nodes) | `performance.memory`, `document.querySelectorAll('*')` |
| api uplink (latency, rtt, downlink, failures) | real `fetch('/api/health')` probe every 9s + `navigator.connection` |
| input channel (level, peak, dB, sample rate) | `AnalyserNode` on the real microphone stream |
| spectrum bars | `getByteFrequencyData` from that same analyser (falls back to frame-time history when the mic is closed) |
| microphone trace | live `getByteTimeDomainData` oscilloscope |
| insight log | health transitions, long tasks, channel open/close, duplex socket, operator actions |
| session counters | eased odometers over inputs / messages / scans / agents |

## Models — pick any inference core

The console is not tied to one vendor. `lib/llm/` holds a provider-agnostic
adapter layer: **OpenAI-compatible** (OpenRouter, OpenAI, Groq, Mistral, DeepSeek,
Together, Hugging Face, Ollama, vLLM, LiteLLM, any custom endpoint), **Anthropic**
(`/v1/messages` + `x-api-key`), **Google Gemini** (`:generateContent`) and
**Cohere** (`/v2/chat`). AWS Bedrock is declared unsupported and refuses locally
instead of being sent a request it cannot understand.

Open the model catalogue from the dock (`modes` → model) or Settings → Models.
Every entry shows where inference runs (`cloud` / `self-hosted` / `on-device`),
its roles, context window, whether this deployment holds a credential, and a
`verified` badge once that model has actually answered. **`list`** asks a
provider what it really serves and merges the result into the list (`live`), so
a newly released model is selectable without a code change. **`verify all`** runs
the system-wide sweep in the browser and tags each model `pass`, `fail` + error
code, or `blocked`.

The selection is a model id sent per request (`POST /api/chat { model }`) and
resolved server-side — the browser never holds a provider credential. With no
model named the server uses `DEFAULT_LLM_MODEL`, else the last model that
answered, else the first provider that has a key.

| what | where |
|---|---|
| provider registry + adapters | `lib/llm/providers.ts` |
| curated catalogue | `lib/llm/catalogue.ts` |
| credentials (env → user override → none) | `lib/llm/credentials.ts` |
| resolution, chat, streaming, sweep | `lib/llm/service.ts` |
| routes | `/api/models`, `/api/chat`, `/api/llm/verify` |
| CLI sweep | `node scripts/verify-llm.mjs --base <url> --probe` |

Every failure is a machine-readable contract — `{ error, code, fix }`:
`no-credential` (503), `unknown-model` (404), `auth-failed` (401),
`rate-limited` (429), `unsupported-provider` (501), `provider-error` (502). The
full audit, the issues found and the remediation for each are in
[`docs/LLM_VERIFICATION.md`](docs/LLM_VERIFICATION.md).

## The avatar

`lib/hud/avatar-face.ts` drives a three.js face rig rendered into the projector
lens: a procedurally sculpted skull (13 gaussian bumps for brow ridge, sockets,
nose, cheekbones, philtrum, chin, temples), eyeballs with iris/pupil/glare,
swinging lid shells, tube brows and a torus mouth. Facial features are placed by
raycasting onto the finished skull, so they always sit on the surface.

Behaviour is spring-damped and state driven — saccades with overshoot, blink
state machine (double blinks, saccade coupling, suppressed while thinking),
vestibulo-ocular lead, pupil dilation from cognitive load, breathing, and a jaw
driven by the live microphone envelope so the lips move with speech. Assistant
state maps straight through: `idle → listening → thinking → speaking`.

WebGL unavailable, a lost context, or a throwing render loop degrades to the
still portrait, so the stage never blanks.

## Overview

This repository will stay in sync with your deployed chats on [v0.app](https://v0.app).
Any changes you make to your deployed app will be automatically pushed to this repository from [v0.app](https://v0.app).

## Deployment

Live console: **https://v0-holographic-ai-assistant-two.vercel.app**

Vercel project: [v0-holographic-ai-assistant](https://vercel.com/shawnthedon2013-gmailcoms-projects/v0-holographic-ai-assistant)
(team `shawnthedon2013-gmailcoms-projects`, Next.js preset, region `iad1`).

Runtime env (both optional — the console runs standalone without them):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | WebSocket endpoint for full-duplex audio streaming |
| Gateway/provider keys | used by the `/api/*` routes for chat, speech and voice cloning |

Deploy from the repo root with `vercel` or by connecting the GitHub repo; the
project builds with the default `next build` command and no custom output dir.

## Build your app

Continue building your app on:

**[https://v0.app/chat/eDhlkkGK2Uq](https://v0.app/chat/eDhlkkGK2Uq)**

## How It Works

1. Create and modify your project using [v0.app](https://v0.app)
2. Deploy your chats from the v0 interface
3. Changes are automatically pushed to this repository
4. Vercel deploys the latest version from this repository