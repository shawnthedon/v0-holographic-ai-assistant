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