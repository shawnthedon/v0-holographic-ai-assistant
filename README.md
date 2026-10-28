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
`createTimeline` for the cold-boot sequence, `stagger` for entrances, SVG
drawables for the sparklines, motion-free single-timer RAF loops for the
oscilloscopes, and `animation.stretch()` to retime live orbits without losing
their phase. Full breakdown: [`docs/ANIME_MOTION.md`](docs/ANIME_MOTION.md).

`prefers-reduced-motion` is honoured everywhere — instruments snap to their
final state and nothing loops.

## Overview

This repository will stay in sync with your deployed chats on [v0.app](https://v0.app).
Any changes you make to your deployed app will be automatically pushed to this repository from [v0.app](https://v0.app).

## Deployment

Your project is live at:

**[https://vercel.com/johnny-bads-projects/v0-holographic-ai-assistant](https://vercel.com/johnny-bads-projects/v0-holographic-ai-assistant)**

## Build your app

Continue building your app on:

**[https://v0.app/chat/eDhlkkGK2Uq](https://v0.app/chat/eDhlkkGK2Uq)**

## How It Works

1. Create and modify your project using [v0.app](https://v0.app)
2. Deploy your chats from the v0 interface
3. Changes are automatically pushed to this repository
4. Vercel deploys the latest version from this repository