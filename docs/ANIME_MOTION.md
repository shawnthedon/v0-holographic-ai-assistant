# anime.js motion system — NEXUS holographic console

This document records how `anime.js v4` is wired into the interface, which
module owns which animation, and the rules every new animation must follow.

---

## 1. Library setup

```bash
npm install animejs@^4.5.0
```

`anime.js` v4 ships ESM with tree-shakeable sub-paths, so the console imports
only the functions it uses:

```ts
import { animate, createTimeline, createTimer, stagger, utils } from 'animejs';
import { svg } from 'animejs';        // drawables
import type { JSAnimation } from 'animejs';
```

Loaded from `node_modules` (not a CDN) so the animation runtime participates in
the normal Next.js bundling and is version-pinned in `package.json`:

```json
"animejs": "^4.5.0"
```

---

## 2. Motion language

All timing flows through one token set (`lib/hud/motion.ts`) so the whole
console feels like a single machine.

| Token | Value | Used for |
|---|---|---|
| `EASE.out` | `outExpo` | panel + text reveals, state changes |
| `EASE.glide` | `outQuart` | gauges, counters, long spatial moves |
| `EASE.smooth` | `inOutSine` | ambient breathing loops |
| `EASE.spring` | `outElastic(1, .55)` | magnetic release, latch feedback |
| `EASE.linear` | `linear` | continuous orbits / sweeps |

Durations: `press 120ms`, `micro 180ms`, `panel 240ms`, `reveal 620ms`,
`boot 1100ms`.

Two non-negotiable rules:

1. **Animate `transform` and `opacity` only.** Canvas work is the one exception,
   and it runs from a single timer loop.
2. **Never restart a loop to change its speed.** `animation.stretch(duration)`
   retimes a live loop, so the orbital assembly keeps its phase when the
   microphone channel opens instead of snapping.

---

## 3. Component map

| Surface | File | anime.js technique |
|---|---|---|
| Cold boot | `components/hud/boot-sequence.tsx` | `createTimeline` — wordmark stagger through blur, boot lines, bar + counter, iris-out `.call()` |
| Shell reveal | `boot-sequence.tsx` (`Reveal`) | staggered `animate` on opacity / translateY / filter |
| Scan header | `hud/chrome.tsx` | mode label blur-in, progress segments stagger, `Metric` counters |
| Hologram rig | `hud/hologram-stage.tsx` | 4 counter-rotating orbit loops, scan sweep `alternate`, beam strands stagger, spark field, `createTimer` parallax rig |
| Deep scan | `hud/hologram-stage.tsx` | click → burst ring scale/opacity + 24 radial ticks staggered from centre |
| Speaking | `hud/hologram-stage.tsx` | interval-driven chromatic `steps(4)` glitch on the projection |
| Waveform | `instruments/live-waveform.tsx` | single RAF canvas loop reading the live analyser; no React state |
| Spectrum bars | `instruments/spectrum-bars.tsx` | RAF canvas loop over the live FFT with decaying peak-hold |
| Sparklines | `instruments/live-chart.tsx` | RAF canvas loop over a telemetry history series |
| Radial gauge | `instruments/arc-gauge.tsx` | `strokeDashoffset` eased from the shown value + numeric counter |
| Radar cluster | `instruments/ring-cluster.tsx` | orbit loops, `stagger(from:'random')`, `stretch()` on state change |
| Insight log | `hud/insight-log.tsx` | newest row enters with `translateX` + `opacity` |
| Command dock | `hud/dock.tsx` | magnetic hover (`outExpo`), spring release, click ripple ring |
| Transcript | `hud/console-panel.tsx` | panel slide/scale/blur, message entry |
| Backdrop | `hud/backdrop.tsx` | vertical grid drift, bloom breathing |

---

## 4. Accessibility & performance

- `prefers-reduced-motion` is read through `useReducedMotion()`; when it is on,
  every instrument is set to its **final** state with `utils.set()` and nothing
  loops. Content is never gated behind an animation.
- The boot overlay auto-dismisses after 6.5 s even if a tween fails.
- Canvas respects `devicePixelRatio` capped at 2; one timer per canvas.
- Only `transform`, `opacity`, `stroke-dashoffset` and filter primitives are
  animated; no layout properties.
- Loops are paused in effect cleanup, and `stretch()` (never a restart) is used
  to change loop speed at runtime.


---

## 9. Live data × motion

Instruments no longer animate canned demo numbers. `lib/hud/telemetry.ts`
publishes a measured snapshot at 5 Hz; HUD components subscribe with
`useMetric(key)` (`hooks/use-hud-telemetry.ts`, backed by
`useSyncExternalStore`) and animate *from the value they are already showing*,
never from zero:

```ts
animate(arc, { strokeDashoffset: target, duration: 900, ease: EASE.glide });
```

Drawing surfaces that need per-frame data (sparklines, spectrum, oscilloscope)
run a single `requestAnimationFrame` loop of their own and read the store
directly — no React state, no re-render, and the loop is skipped entirely under
`prefers-reduced-motion` (one static draw instead).

Rules that keep it coherent:

1. **One owner per property.** anime.js owns transforms/opacity on HUD chrome;
   canvas code owns canvas pixels; three.js owns the avatar. Nothing
   cross-writes another system's properties.
2. **Retime, never restart.** Live loops use `animation.stretch(factor)` so a
   state change reads as acceleration instead of a phase jump.
3. **Motion encodes data.** Sweep speed follows the microphone envelope, ring
   rotations follow listening state, counters ease toward the measured value.
4. **Fallbacks are static.** Reduced motion, no WebGL, or a lost context falls
   back to a still frame rather than a half-animated one.
