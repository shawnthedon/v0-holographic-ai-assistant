# On-device AI — implementation report

**Spec:** On-Device AI Design & Implementation Specification v1.0 (27 Oct 2026)
**Delivered:** Phases 0–3 (+ Phase 4 assessed and refused, see §8)
**Status:** local text inference implemented; image generation **NOT** implemented and reported as unavailable.

Everything below follows the spec's rule: *do not claim a feature works until it has been
built and verified on the intended platform.* Where this environment cannot produce
evidence, the item is marked **BLOCKED**, not PASS.

---

## 1. Platform and framework (Phase 0 audit)

| Question | Finding |
|---|---|
| What is the project? | `v0-holographic-ai-assistant` — a **Next.js 16 App Router** web console (React 19, Tailwind v4, three.js, anime.js). |
| Target platform | **Browser.** Deployed to Vercel as serverless functions + static assets. There is **no native host** — no Android/iOS app in this repo. |
| Is there an Android app? | No. `rn-avatar-cloning/` is a React Native *prototype* excluded from the web build; it is not shipped and has no GGUF runtime. |
| Existing persistence | No database; user preferences live in `localStorage` (`nexus.llm.model`). Provider credentials are env vars server-side (see `docs/LLM_VERIFICATION.md`). |
| Existing design system | HUD console: `var(--hud-*)` tokens, mono microtype, panels at 0.5–1 px borders. The new panel reuses those tokens rather than inventing a style. |
| Build / test commands | `npm run build`, `npm run start`, `npx tsc --noEmit`, `npm run test:device-ai` (new). |
| Existing conventions that constrain this work | Model *ids* are the selection primitive (`<provider>/<model>`); the UI never holds credentials; every failure returns `{ error, code, fix }`; `next.config.mjs` typechecks (no `ignoreBuildErrors`). |

### What a browser cannot do (stated, never simulated)

Per spec §2 and §4:

1. **No background service.** Downloads and inference stop when the tab closes. There is no Android foreground service and no OS notification. The panel says exactly this; it does not fake a notification.
2. **No GPU/NPU offload is claimed.** The runtime is llama.cpp compiled to WebAssembly, executing on the CPU in a worker. WebGPU is *detected and reported* but unused.
3. **No native file picker scopes.** Import uses the `<input type="file">` document picker; no broad filesystem permissions are requested, because a browser cannot request them.
4. **Storage is origin-private.** Weights go to OPFS, not `localStorage`, and metadata to IndexedDB.

## 2. Architecture (minimum change)

```
lib/device-ai/
  types.ts         typed contracts + DeviceAiError(code, fix) + catalogue types
  gguf.ts          real GGUF v2/v3 header parser (bounds-checked, no full read)
  capabilities.ts  device probe: WASM/SIMD/JSPI/MEMORY64, OPFS, storage, tier
  storage.ts       OPFS model files + partial files; IndexedDB metadata/jobs
  catalogue.ts     preset families, URL allowlist, id/size helpers
  runtime.ts       the only module importing the engine; load / stream / stop / unload
  service.ts       orchestration: import, download, lifecycle, generation, image honesty
hooks/use-device-ai.ts        React state over the service (no optimistic guessing)
components/hud/local-ai-panel.tsx   library · catalogue · system tabs
app/api/device-ai/hf/route.ts       resolve real GGUF filenames + sizes from the Hub
app/api/device-ai/proxy/route.ts    range-capable byte relay (CORS fallback), host allowlist
scripts/sync-wllama-assets.mjs      copies both runtime builds into public/
scripts/test-device-ai.mjs          executed unit tests (35 checks)
```

Integration is additive: the chat path branches on the model id (`local/…` ⇒ on-device,
anything else ⇒ the existing `/api/chat`). No existing route, component or CLIs changed
behaviour.

### Runtime choice and licence review (spec §8)

| Candidate | Verdict |
|---|---|
| **`@wllama/wllama` 3.8.1** (llama.cpp → WASM) | **Selected.** MIT (wllama) over MIT (llama.cpp); runs in a worker inside the tab; no native build step, so it works on Vercel's build image. |
| `node-llama-cpp` | Rejected: needs native binaries per platform; cannot run in a browser tab. |
| `llama.cpp` wasm built by hand | Rejected for now: no toolchain in this environment; the pinned package gives a reproducible binary plus its licence. |
| Transformers.js / ONNX | Rejected for GGUF: different format, and the spec names GGUF. |

**Two builds ship, and the browser picks:**

- **default** (`public/vendor/wllama/wllama.wasm`, 8.4 MB) — requires JSPI + MEMORY64. Fast.
- **compat** (`public/vendor/wllama/compat/wllama.wasm`, 15.3 MB + worker source) — Asyncify, no MEMORY64. Runs on Safari and older engines, several times slower.

This is not cosmetic: the default binary does **not** validate on V8 12.4 (Node 22) because it
uses TABLE64. Had only the default build been shipped and the asset left to wllama's CDN
fallback, "works offline" would have been false on exactly the browsers that need compat.
Both builds are copied from the pinned dependency by `scripts/sync-wllama-assets.mjs`
(`postinstall` + `prebuild`) and served from our own origin. `setCompat()` is called with a
locally fetched worker source; when the assets are absent, `setCompat(null)` **disables** the
CDN path so the failure is a typed error rather than a silent network call.

## 3. Model library, import and validation (spec §5)

* Catalogue entries name the exact repo, quantization, licence and model card, and are marked
  `verification: 'unverified'` where the exact filename could not be confirmed from this build
  environment (no egress to huggingface.co). The UI shows that label.
* **“Browse files”** resolves the real filenames and sizes from the Hub
  (`/api/device-ai/hf`), so a stale preset can be replaced with the actual current file
  instead of being trusted.
* Import validates by parsing the container, not the extension: GGUF magic, version 2/3,
  metadata, tensor table, architecture, and a size-plausibility check. A `.gguf` name on a
  random file is rejected (`MM-02`).
* Storage: weights → OPFS (streamed, never in a JS buffer); metadata + job state → IndexedDB.
* Path safety: `safeFileName()` flattens separators, collapses dot runs and rejects empty or
  dot-only ids, so `local/../../etc/passwd` can never escape the models directory. Download
  URLs are https-only, host-allowlisted, credential-free and `.gguf`-only.

## 4. Download manager (spec §6)

* `fetch` → `ReadableStreamDefaultReader` → OPFS partial file, chunk by chunk (no JS buffer).
* Real progress: bytes received / total (when the host sends `content-length`), measured
  bytes-per-second, and a `resumable` flag that is **true only when the server advertised
  `Accept-Ranges: bytes` and honoured the range**.
* Pause and cancel both abort the transfer and keep the partial; resume continues from the
  byte offset actually on disk via a `Range` request, opening the partial with
  `keepExistingData` + `seek`.
* Promotion is atomic: the partial is validated (header + declared size) *then* copied to the
  installed file and the partial removed. **A partial file can never be loaded** (`MM-04`).
* Limits are honest: closing the tab stops the transfer. No OS notification exists, so the
  panel shows in-console state and says so.

## 5. Lifecycle (spec §7)

Persisted states: `available → queued → downloading → paused → verifying → installed →
loading → loaded → unloading`, plus `importing`, `error`, `cancelled`. Every transition is
written to IndexedDB before the UI updates, and the UI re-reads the store after each action,
so what is displayed is the persisted state rather than an optimistic guess.

* Load checks the device ceiling first and refuses with `insufficient-memory` + a concrete fix
  instead of crashing the tab.
* A failed load calls `wllama.exit()` to release partial allocations and records `error` with
  the payload (`MM-08`).
* Unload aborts an active generation before freeing the context.
* Delete requires unload first; after deleting it **verifies** the file is gone and reports a
  partial failure rather than claiming success (`MM-10`).

## 6. Offline text inference (spec §8)

* Streamed tokens via `createChatCompletion({ stream: true, abortSignal, onData })`;
  stop/cancel aborts the runtime call, not just the UI.
* Measured metrics only: first-token latency and tokens/second are timestamps; they render as
  `n/a` when unavailable — never a fabricated number.
* Model/context/thread limits are clamped to what the device reports.
* **No cloud fallback exists.** `use-ai-assistant` branches on `local/…`: if no local model is
  loaded, the message fails with “This prompt was not sent anywhere.” There is no code path
  from a local failure to `/api/chat` (`MM-07`).

## 7. Verification — what was actually executed

```
npm run test:device-ai      → 35 checks passed, 0 failed
npx tsc --noEmit            → 0 errors
npx next build              → ✓ compiled, 11/11 pages, 20 API routes, typechecked
curl /vendor/wllama/wllama.wasm          → 200 application/wasm 8763949 B
curl /vendor/wllama/compat/wllama.wasm   → 200 application/wasm 16005007 B
curl /vendor/wllama/compat/wllama.js     → 200 application/javascript 171615 B
curl /api/device-ai/hf?repo=../../etc/passwd → 400 (SSRF guard)
curl /api/device-ai/proxy?url=http://evil/x.gguf → 400 "Only https downloads are proxied"
curl /api/device-ai/proxy?url=https://evil.example.com/x.gguf → 400 host not allowed
```

The 35 checks include: a synthetic valid GGUF parsed field-by-field; six rejection paths
(bad magic, too small, v1, truncated, absurd KV count, absurd tensor count); `inspectGguf`
over a `Blob`; seven URL attacks rejected; traversal-proof filenames; catalogue integrity;
and — the most important one — **the compat runtime binary compiles on this engine**, which is
the compatibility evidence that the app can run inference without TABLE64/JSPI.

### Acceptance criteria (spec §15)

PASS = executed and observed. BLOCKED = cannot be executed in this environment
(no browser, no real device, no GPU) — the code path exists but is **not** claimed working.

| ID | Test | Verdict | Evidence / blocker |
|---|---|---|---|
| MM-01 | Valid import | **BLOCKED** | Requires a browser (file picker + OPFS). Parser half verified: `test-device-ai` builds a valid GGUF and parses architecture/quant/ctx. |
| MM-02 | Invalid import | **PASS (unit)** | 6 rejection paths executed; import removes the metadata record on failure so no “installed” ghost exists (`service.importModel` catch). Service-level run BLOCKED on browser. |
| MM-03 | Download progress | **BLOCKED** | Needs a browser + a real host. Implementation is streamed with measured B/s; nothing faked in the UI. |
| MM-04 | Interrupted transfer | **PASS (logic) / BLOCKED (e2e)** | Partial is validated before promotion; `validateFile` rejects an incomplete file; a partial is never loadable (`readModelFile` only reads the promoted file). |
| MM-05 | Load/unload | **BLOCKED** | Needs a browser with WASM. Compat binary validated here, but instantiating and running a model needs a tab. |
| MM-06 | Offline inference | **BLOCKED** | Airplane-mode test needs a device. Design guarantees: runtime + weights are same-origin, `setCompat(null)` when assets are missing (no CDN call). |
| MM-07 | No cloud fallback | **PASS (code + type level)** | `local/…` is handled before any `fetch`; the failure branch throws and returns. No reference to `/api/chat` inside it. |
| MM-08 | Resource failure | **PASS (logic)** | Ceiling check → `insufficient-memory` + fix; failed load releases the context; storage pre-check on import/download. |
| MM-09 | Background work | **BLOCKED (by platform)** | Browser tab has no foreground service. Reported as a limitation in the panel's System tab; not simulated. |
| MM-10 | Deletion | **PASS (logic) / BLOCKED (e2e)** | Loaded model needs unload or `force`; deletion re-checks the file and errors if the bytes survive. |
| MM-11 | Local image generation | **BLOCKED** | No diffusion runtime. See §8. |
| MM-12 | Unsupported image runtime | **PASS** | `imageGenerationStatus()` returns `unavailable` + requirements; the UI renders it as an explicit unavailable panel. No fake image, no cloud call. |
| MM-13 | Privacy audit | **BLOCKED** | Needs a browser network inspector. Static audit: inference path calls no `fetch`; only downloads and Hub listing use the network. |
| MM-14 | Regression | **PASS** | `tsc` 0 errors, `next build` clean, 18 pre-existing routes still present (20 total), existing chat/mic/settings/face-capture/agents untouched in behaviour. |
| MM-15 | Release build | **BLOCKED** | Requires a packaged browser release; the assets are served from `public/` and are included in the build output (verified by HTTP above). |

## 8. Local image generation (spec §10) — refused, with reasons

**Not implemented, and deliberately not stubbed.** A text GGUF runtime cannot generate
images; pretending otherwise is exactly what the spec forbids. The feasibility gate (Phase 4)
requires real target hardware, and this environment has no GPU and no browser.

What the UI does: shows `state: 'unavailable'` with the four concrete requirements (a WebGPU/WASM
diffusion runtime, a quantised image model on device, a GPU-capable browser, and a measured
benchmark), under System → *local image generation · unavailable*. No `/image` command is
advertised, because there is no generator to call.

To proceed: add `stable-diffusion.cpp` (MIT) compiled to WebGPU/WASM or a WebGPU pipeline as a
dependency, add an image-model entry to the catalogue, run the benchmark on target hardware,
and only then expose the viewer/gallery/export. The `generateImage` slot in the service
boundary is intentionally absent rather than a function that throws a fake result.

## 9. Privacy (spec §11)

* Prompts, responses and weights never leave the browser on the local path: the only network
  calls in `lib/device-ai` are the model download, the Hub listing and (optional) the proxy.
* No prompt text is logged to analytics or `console`. The existing telemetry store records
  counters (`localModels`, `localLoaded`), never content.
* Downloads are https-only, host-allowlisted, credential-free, `.gguf`-only; redirects are
  re-validated at the final hop.
* Model weights are **not** bundled with the app; they are fetched by the user, which keeps the
  Llama 3.2 licence obligations with the operator who downloads them.

## 10. Files changed

New: `lib/device-ai/{types,gguf,capabilities,storage,catalogue,runtime,service}.ts`,
`hooks/use-device-ai.ts`, `components/hud/local-ai-panel.tsx`,
`app/api/device-ai/hf/route.ts`, `app/api/device-ai/proxy/route.ts`,
`scripts/{sync-wllama-assets,test-device-ai}.mjs`, this document.

Patched: `app/page.tsx` (panel + dock entry + telemetry counters),
`components/hud/dock.tsx` (Local AI button), `components/hud/model-picker.tsx`
(on-device section), `hooks/use-ai-assistant.ts` (local generation branch, no fallback),
`lib/hud/telemetry.ts` (`localModels`, `localLoaded`), `package.json`
(deps + `prebuild`/`postinstall`/`predev`/`test:device-ai`), `.gitignore`
(`public/vendor/wllama/` is generated), `README.md`, `IMPLEMENTATION_STATUS.md`.

## 11. Next steps (each needs hardware or a browser)

1. **Phase 1 gate on real devices** — install a 135M/0.5B model, record load time, tok/s, RSS,
   thermal behaviour. Until then MM-05/06/13/15 stay BLOCKED.
2. **Multi-threaded WASM** — needs `Cross-Origin-Opener-Policy: same-origin` +
   `Cross-Origin-Embedder-Policy: require-corp`; that would break third-party embeds, so it is a
   product decision, not a silent change. Single-thread is the current default.
3. **Privacy audit** — with a browser inspector, confirm zero requests during generation
   (MM-13).
4. **Image generation** — only after the Phase 4 spike on real hardware (§8).
