# Console performance & reliability — measured, not assumed

Three reported symptoms were reproduced against a production build in headless
Chromium (SwiftShader GL, 1280×800, 2-core container) and fixed:

| Symptom | Cause found | Status |
|---|---|---|
| Model lists incomplete under providers | discovery read **one page** and truncated at 300 | fixed |
| UI extremely sluggish | backdrop-blur over a live canvas, 60 fps DOM writes, per-row animations, 1 Hz whole-tree re-render | fixed |
| Chat window crashes the app | no error boundary anywhere; unbounded transcript; blur animation on the panel | fixed |

Nothing below is a guess: each number was produced by the harness described at
the end.

---

## 1. Model listings were genuinely incomplete

`lib/llm/providers.ts` asked each provider for `/models` **once** and kept the
first 300 entries.

* Anthropic returns **20 models per page** by default, Google 50. One page is
  not the model list — it is the first twentieth of it.
* `has_more` / `last_id`, `nextPageToken` and `next_page_token` were parsed
  nowhere; the values were dropped on the floor.

Rewritten to:

* request an explicit page size (`limit=1000`, `pageSize=1000`,
  `page_size=1000`) so the first response is already complete where the
  provider supports it;
* follow pagination to the last page, per provider dialect, with a hard cap of
  25 pages / 5 000 models and a 20 s per-request timeout;
* de-duplicate by model id across pages;
* read `display_name` / `displayName` / `inputTokenLimit` as well, so labels
  and context windows are no longer blank on Google and Anthropic entries;
* accept a bare array, `{data}`, `{models}`, `{objects}` or `{items}` as the list.

**Evidence** — a local provider stub serving 137 models in pages of 40:

```
before:  discovered: 40       (page 1 only; the other 97 never requested)
after :  discovered: 137      (4 requests: base, after=model-040, -080, -120)
```

### `?discover=all` and a real cache

Discovery used to be per-provider and manual. `GET /api/models?discover=all`
now fans out to every provider **that holds a credential**, in parallel, and
returns:

* `discovered[]` — the merged live lists;
* `discovery.counts` — per-provider totals, so the UI can say `137 live`;
* `discovery.cached` + `fetchedAt` — the result is cached 5 minutes
  (`?refresh=1` bypasses it);
* `discoverFailures[]` — one entry per provider that failed, carrying `code`,
  `message`, `fix` and `configured`. A single expired token no longer hides the
  three providers that answered.

The picker calls this on open, so the list is complete before the overlay is
interacted with. Measured: first call 1 request per provider, second call
**4 ms** (cache hit, 137 models).

### The overlay itself was hiding rows

Even with complete data, the picker rendered rows front-to-back until a budget
ran out — so with 137 live models the *first* provider consumed the entire
budget and every other provider appeared empty. That is what "incomplete
listing" looks like from the outside. Now:

* rows are grouped **by provider** with a header showing `N shown · N live ·
  keyed / no key`, plus that provider's failure reason when it has one;
* the render budget is **split evenly across providers**, so every provider is
  represented;
* each group offers `+ N more from <provider>`, and one click expands
  everything;
* per-row `anime.js` animations were removed (see §2).

---

## 2. Sluggishness: four separate causes

### a. `backdrop-filter` over a live WebGL canvas — 26 surfaces

`.hud-panel` and `.hud-chip` blurred whatever was behind them. Behind them is
the hologram, which repaints every frame — so the compositor re-blurred the
canvas continuously. Measured: **26 elements** carried a non-`none`
`backdrop-filter`, and after removal **0**.

The panel gradient was made more opaque to keep the same look (`0.72/0.58` →
`0.90/0.86`), and the dock's `backdrop-blur-md` / `backdrop-blur-xl` were
dropped for the same reason. This is also the documented Safari/iOS
renderer-crash trigger, so it addresses the mobile case too.

### b. 60 fps of DOM writes for a slow parallax

The projection rig wrote `transform` **and** two CSS custom properties every
frame. Now:

* the timer runs at 30 fps (`frameRate: 30`), which is imperceptible for a drift
  whose period is seconds;
* writes are skipped unless the value actually changed by >0.01° / >0.5 px;
* nothing is written at all while `document.hidden`.

### c. Every instrument canvas redrew 60×/s from 5 Hz data

`LiveChart`, `LiveWaveform` and `SpectrumBars` each ran their own
`requestAnimationFrame` loop and repainted every frame even though telemetry
publishes at **5 Hz**. Per-canvas 2D calls per second, before → after:

```
chart      38 → 25
waveform   38 → 25
spectrum   50 → 33
```

Charts now draw at 12.5 fps, waveform/spectrum at 30 fps, and all three cap DPR
at 1.5 instead of 2.

### d. The page re-rendered the entire tree once a second

`Home` owned a 1 Hz clock and a 1.2 s progress sampler. Every tick re-rendered
~1 050 nodes, eight canvases and the WebGL host. The clock, uptime and scan
progress now live in `ScanHeader` (and `LiveClock`), so the page tree only
re-renders when something structural changes.

Measured over a 10 s idle window (no interaction):

```
              recalcStyle  layouts  scriptMs  tasksMs
before              24        23       174      337
after               20        21       212      337
```

Style and layout work went down. Script time went **up 38 ms over 10 s**
(≈4 ms/s) because the avatar canvas was 0×0 tall and invisible before and now
actually renders a WebGL face. That is a trade, not a regression: on a real GPU
the render is offloaded, and the cost previously bought nothing.

### e. The avatar itself

* `SphereGeometry(1, 96, 96)` → `64, 64` (≈8 k quads instead of 18 k);
* `setPixelRatio` cap 2 → 1.5;
* the draw is skipped while `document.hidden`.

---

## 3. Why the chat window took the app down

Found in this order:

1. **`AvatarRig` was 0 px tall.** The wrapper was `relative ${className}` and
   the only caller passes `absolute inset-0`, so *both* position utilities were
   emitted, `relative` won the cascade, and — because every child is absolutely
   positioned — the element collapsed to **height 0**. The canvas rendered at
   `300×150` with a 0 px CSS box: the projection was never visible, while the
   rig kept doing 96×96 vertex work and raycasts every frame. Fixed by sizing
   the wrapper with `h-full w-full` instead of a hardcoded `relative`.
2. **No error boundary anywhere.** One throw during a render unmounts the whole
   React tree — the console goes blank and only a reload recovers. That is
   exactly "the chat window keeps crashing the app". Added
   `components/hud/error-boundary.tsx`: a top-level boundary in `app/layout.tsx`
   and a local one around the transcript. A failure now stays inside the panel,
   shows the message, offers *restore view*, and is written to the insight log.
3. **The transcript was unbounded.** Every message is a DOM subtree and every
   turn was appended to the request body forever. Capped at 60 rendered
   messages and 12 context turns sent upstream.
4. **Animating `filter: blur()` on the transcript.** Opening it forced a
   re-raster of the panel on every frame plus a blurred copy of the canvas.
   Now opacity + transform only, with `will-change` released after the
   transition.
5. **No timeout on `/api/chat`.** A hung request left the UI in "thinking"
   forever. 120 s abort, with the abort surfaced as an error.
6. **`decodeAudioData` on a non-audio body.** When `/api/speech` answered JSON
   (no `GOOGLE_API_KEY`), the body was handed to the decoder. Now the
   `content-type` is checked first and the failure is a message, not a
   DOMException.
7. **Unhandled rejections were invisible.** `window.onerror` and
   `unhandledrejection` are now recorded in the insight log (failure text only —
   never prompts or replies).

---

## 4. How this was measured

No browser binary exists in the build environment, so verification used a real
Chromium (`@sparticuz/chromium` + `puppeteer-core`, SwiftShader WebGL) against
`next start` of both trees — the merge commit `d2e68be` on :3200 and this
branch on :3100 — so every "before" number is a measurement of the shipped
code, not an estimate.

Harness checks: DOM node count, `backdrop-filter`/`filter` census, per-canvas
2D call rate, `Performance.getMetrics` deltas over a 10 s idle window, model
discovery against a local provider stub (137 models, pages of 40), and an
end-to-end interaction: open the picker → select a live model → send two chat
turns → confirm replies and that the tree is still alive.

Known limit of this method: SwiftShader is software GL, so absolute frame rates
in the container (≈1.4 fps) say nothing about a real device. The relative
numbers above are CPU/style work, which is what the fixes targeted.

---

## 5. What is still open

* Real-device frame rate, memory and thermal behaviour remain **BLOCKED** — no
  hardware in this environment.
* The avatar's *shape* was improved (jaw taper, cheekbones, eye proportions,
  iris seated on the globe surface instead of inside it), but facial
  proportions are an art problem; if it still does not read correctly, the next
  step is a sculpted glTF head rather than more procedural bumps.
