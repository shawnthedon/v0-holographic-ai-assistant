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

## On-device models — offline, in the browser

The console can also run a model **on the user's own machine**, with no network after install.
Open the dock → **Local AI** (`OFFLINE MODEL BAY`):

- **Import** any `.gguf` file, or **download** a preset (SmolLM2 135M/360M, Qwen2.5 0.5B,
  Llama 3.2 1B/3B, DeepSeek-R1-Distill 1.5B) — or resolve the *current* filename and size for
  any Hugging Face repo before downloading.
- **Validation is real**: the GGUF container is parsed (magic, version, metadata, tensor table,
  architecture), so a renamed file is rejected. Partial downloads are never installed.
- **Streamed downloads** to origin-private storage with measured progress, pause/cancel and
  resume — resume is only offered when the host actually supports byte ranges.
- **Load / unload / delete** with explicit persisted states, a memory ceiling check, and
  deletion that verifies the bytes are gone.
- Pick a local model in the model catalogue and it becomes the chat engine — or keep a cloud
  model. **A local failure never falls back to the cloud.**

Runtime: `@wllama/wllama` (llama.cpp → WebAssembly, MIT), served from this origin in two builds —
JSPI/MEMORY64 for current engines, Asyncify compat for Safari and older browsers. Both are copied
from the pinned dependency at build time; nothing is fetched from a CDN.

Honest limits, shown in the panel rather than hidden: a browser tab has no background service
(closing the tab stops a download), inference is CPU-only, and **local image generation is not
implemented** — there is no diffusion runtime, so the UI reports it as unavailable instead of
faking an image. Full report, verification evidence and the PASS/BLOCKED matrix:
[`docs/ON_DEVICE_AI.md`](docs/ON_DEVICE_AI.md).

```bash
npm run test:device-ai   # 35 executed checks: GGUF parser, rejection paths, URL/path guards
```

## Agent browser — long-running tasks

Dock → **Browser** opens the live observation panel. A task has an objective, a plan, a
deadline, success criteria and a budget; the runner keeps working while you are away and
stops honestly when it cannot continue.

- **Real Chromium**, not a parser: bundled `@sparticuz/chromium` driven by `puppeteer-core`,
  with per-task browser contexts, fixed locale/viewport, accessibility-tree targeting,
  cookie + `localStorage` capture, screenshots and downloads.
- **Watchdog**: last action, last verified milestone, current operation, consecutive
  failures, repeats and time-to-deadline are all tracked. A page that stays open is *not*
  progress — the task enters `RECOVERING` instead of waiting forever.
- **Bounded recovery**: wait → reload → re-inspect → re-locate → different interaction
  method → authorised alternative → defer → stop. No retry repeats itself unchanged.
- **Safe retries**: a sensitive step (payment, submission, account change) is checked for
  effect before any retry — if it already happened it is not repeated.
- **Loop detection**: same click on an unchanged page, A↔B ping-pong, identical results,
  repeated errors, and any repeat after a block.
- **Checkpoints that survive**: tasks persist to disk, and after a crash or restart they
  come back as `RECOVERING`, inspect the checkpointed page, and only then continue.
- **Honest states only**: `QUEUED → RUNNING → RECOVERING → WAITING_FOR_USER → COMPLETED`
  plus `FAILED / BLOCKED / CANCELLED / TIMED_OUT`. `COMPLETED` requires every success
  criterion to verify against the live page, with evidence captured.

```bash
npm run test:browser        # 31 checks — AT-15 … AT-26 on a scripted engine
npm run test:browser:live   #  7 checks — real Chromium, fixture site, SIGKILL recovery
npm run test:ui             # 15 checks — the built console driven in a real browser
```

Design, the stealth limitations we do **not** claim, deployment variables and the full
PASS/BLOCKED matrix: [`docs/BROWSER_AGENT.md`](docs/BROWSER_AGENT.md).

## Artifacts, file manager and FTP

Agents produce files; the console keeps them. Dock → **Artifacts** opens a file manager over
IndexedDB with five kinds (`code`, `config`, `report`, `data`, `custom`) derived from the
extension, honest previews (text and tables render, PDF/DOCX/XLSX say "download only"),
inline rename, delete, download, paste-create, disk import, SHA-256 per file and a
storage/quota readout.

Fenced blocks in an agent reply (`python analyze.py`, `json pipeline.json`) are captured
automatically — at most 8 per message, deduplicated, prose ignored.

**FTP to a remote host** runs server-side (a browser cannot open a raw socket) behind a
mandatory allowlist: set `FTP_ALLOWED_HOSTS` before you rely on it. Every result is
explicit: success names the host and directory, and every failure is a code plus a fix
(`ftp-auth-failed`, `ftp-host-blocked`, `ftp-timeout`, …). Passwords stay in memory and
`sessionStorage` for the tab, never in IndexedDB, the queue or the logs.

## Offline-first and battery

- **Offline works**: the shell is precached by a service worker, artifacts and the task
  queue live in IndexedDB, and a queued FTP upload survives a reload — including a reload
  while still offline — then drains by itself on reconnect with byte-identical content.
- **Degradation is visible, not silent**: the SYSTEM strip reports the real connection,
  the real pending/failed count, the battery profile and whether the worker is installed.
- **Battery-aware**: one governor sets every cadence — 60/45/20 fps, 5/4/1 Hz telemetry,
  ambient motion paused in saver mode, pixel ratio dropping before frame rate. Missing
  Battery Status API is reported as unsupported, not faked.
- **Split, deferred, offloaded**: settings/model/local-AI/artifact panels are lazy-loaded,
  maintenance runs through `requestIdleCallback`, and hashing/extraction run in a worker.

```bash
node scripts/test-artifacts.mjs   # 36 checks — naming, kinds, extraction, FTP guard, queue
node scripts/test-ftp.mjs         # 7 checks — real ftp-srv upload, auth failure, allowlist
```

Full design, env vars, verification matrix and the BLOCKED items:
[`docs/ARTIFACTS.md`](docs/ARTIFACTS.md).

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
| `BROWSER_EXECUTABLE_PATH` | Use a system Chrome/Chromium instead of the bundled browser |
| `BROWSER_WS_ENDPOINT` | Connect the agent to a remote browser service |
| `BROWSER_TASK_DIR` | Task records, checkpoints and evidence screenshots (default `./.nexus/browser`) |
| `FTP_ALLOWED_HOSTS` | Required allowlist for artifact uploads, e.g. `ftp.example.com,*.mirror.example` |
| `FTP_ALLOW_ANY` | `1` disables the allowlist — only for a trusted private deployment |
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