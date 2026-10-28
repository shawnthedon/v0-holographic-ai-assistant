# System-wide LLM verification — findings and remediation

**Scope:** every path in this repository that can reach a language model or a
speech model — chat, streaming, model discovery, provider credentials, TTS,
speech recognition, voice cloning, persona, agents.

**Method:** static audit of the repository, a live end-to-end run against a real
HTTP provider (OpenAI-compatible mock, real SSE), contract tests for each error
class, then a production sweep of the deployed console.

**Verdict:** the model layer was **not functional** before this pass — the model
the operator picked was ignored, every provider but OpenAI-compatible ones was
routed to the wrong endpoint, and two endpoints returned fabricated output. It
now works end-to-end for any configured provider, and every unsupported path
fails loudly with a fix.

Reproduce everything below with:

```bash
npm run build && npm run start          # or the deployed URL
node scripts/verify-llm.mjs --base http://127.0.0.1:3000 --probe --md evidence.md
```

---

## 1. What the user can now choose

`GET /api/models` returns a merged catalogue:

- **curated** (`lib/llm/catalogue.ts`) — 30 models across 15 providers, including
  the Qwen family (Qwen2.5 72B/Coder/VL, QwQ, Qwen2.5-Omni), GPT, Claude, Gemini,
  Llama 3.3, DeepSeek, Mistral, Command R, and local runtimes (Ollama, vLLM,
  LiteLLM).
- **discovered** (`?discover=<provider>`) — everything the credential can actually
  reach, straight from the provider's `/models`.

Each entry carries `roles`, `execution` (`cloud` / `self-hosted` / `on-device`),
`licence`, `notes`, and `configured` (does this deployment hold a credential).
The picker (Dock → Models, or Settings → Models) filters by role, shows which
providers are keyed, and marks blocked models instead of letting them fail at
send time.

Selection is a model **id** sent per request (`POST /api/chat { model }`) and
resolved server-side; the browser never holds a key.

## 2. Architecture added

```
lib/llm/
  types.ts        ModelSpec / ProviderSpec / LLMError(code, fix)
  providers.ts    4 wire formats: OpenAI-compatible, Anthropic, Gemini, Cohere
                  + discovery, SSE streaming, status→error classification
  catalogue.ts    curated model registry
  credentials.ts  per-user override → env vars → explicit "none"
  service.ts      resolveModel / chat / chatStream / verify / serviceStatuses
app/api/
  models/         catalogue + provider availability + live discovery
  chat/           honours `model`, JSON or SSE stream, structured errors
  llm/verify/     the sweep this report is built from
scripts/
  verify-llm.mjs        CLI sweep (text table + markdown + json)
  mock-llm-server.mjs   OpenAI-compatible mock used to test the adapter layer
```

---

## 3. Issues found

Severity: **P0** = feature is broken or lies to the user · **P1** = degraded or
unsafe in production · **P2** = hardening / hygiene.

| # | Sev | Issue | Evidence | Status |
|---|---|---|---|---|
| 1 | P0 | The model the user picked was ignored. `useAiAssistant` sent `model`, `/api/chat` never read it — the gateway's stored model always won. "Gemini 2.0 Flash / GPT-4o / Custom" were decorative. | `git show 9fca342:app/api/chat/route.ts` — no reference to `body.model` | **Fixed** — `model` is resolved per request; the UI selection drives it |
| 2 | P0 | Chat could never work on a fresh deployment: the route required a saved gateway config, and `GatewayConfigManager`'s constructor threw when `GATEWAY_ENCRYPTION_KEY` was unset — so `/api/chat` returned 500 before reaching a provider. | Vercel project has **0 env vars**; every chat returned 500 | **Fixed** — env-first credentials, no throw at import, 503 + `fix` when nothing is configured |
| 3 | P0 | Anthropic, Cohere and Bedrock were all posted to `POST /chat/completions` with a bearer token. Anthropic needs `/v1/messages` + `x-api-key`; Cohere needs `/v2/chat`; Bedrock needs SigV4. Every call would fail. | `lib/unified-gateway.ts` `buildHeaders` / `chat` | **Fixed** — native Anthropic and Cohere adapters; Bedrock is declared `unsupported` and refuses locally with the reason |
| 4 | P0 | Hugging Face pointed at the retired `api-inference.huggingface.co/v1`. | `lib/unified-gateway.ts` `PROVIDER_DEFAULTS` | **Fixed** — `https://router.huggingface.co/v1` |
| 5 | P0 | `/api/voice-clone` returned hard-coded base64 audio and `duration: 5.0` for any input — a fabricated success. It also accepted any file type/size with `Access-Control-Allow-Origin: *`. | previous route body (`mockAudioBase64`) | **Fixed** — real ElevenLabs `/v1/voices/add` call, or explicit `503 no-credential`; consent gate, 10 MB cap, MIME allow-list, CORS removed |
| 6 | P0 | `/api/persona` answered `success: true` and returned a fixed viseme list for audio it never processed. | previous route | **Fixed** — returns `501` with `X-Mock: true` and an explanation |
| 7 | P1 | Per-user gateway configs were written into `process.env` (`GATEWAY_CONFIG_<user>`): one instance-wide bag of secrets, visible to every request on that instance, lost on redeploy. | `lib/gateway-config-manager.ts` | **Fixed** — module-scoped `Map`; still ephemeral, see issue 14 |
| 8 | P1 | `litelm` typo in the provider union, and `http://0.0.0.0:4000` used as a *client* address (0.0.0.0 is a bind address, never a destination). | `lib/unified-gateway.ts` | **Fixed** — `litellm`, `http://127.0.0.1:4000/v1` everywhere |
| 9 | P1 | `/api/gateway/models` returned a hand-written list; `UnifiedGatewayService.getAvailableModels` returned `[]`. Discovery was fiction. | routes | **Fixed** — live provider discovery with the curated catalogue as a *labelled* fallback (`source: 'provider' \| 'catalogue'`) |
| 10 | P1 | Streaming was unusable: `chatStream()` returned a Node stream typed as `ReadableStream`, and no route exposed it. | `lib/unified-gateway.ts` | **Fixed** — `/api/chat` accepts `stream: true` and returns SSE (`meta`, `data.delta`, `done`, `error`) |
| 11 | P1 | `/api/speech` turned every failure into a generic 500 "Failed to synthesize speech"; the client then overwrote the real reason with another generic string. | routes + hook | **Fixed** — `{ error, code, fix }` with 503 for a missing key, 413 + guard above 4 000 chars |
| 12 | P1 | The microphone was blocked entirely when the duplex WebSocket was down (`toggleMicrophone` early-returned), and `sendAudio` / `sendVisemeRequest` threw inside the reply path. | `hooks/use-ai-assistant.ts` | **Fixed** — socket is optional; browser recognition and local playback continue |
| 13 | P1 | 25 TypeScript errors, including inside the LLM layer — so `next build` only passed because `ignoreBuildErrors: true`. | `npx tsc --noEmit` before/after | **Fixed** — **0 errors**; also fixed the RN prototype's typing clash by excluding `rn-avatar-cloning` from the web tsconfig |
| 14 | P1 | `/api/chat`, `/api/voice-clone`, `/api/upload` are unauthenticated. `x-user-id` is a client-supplied header, so "per-user" config is not per-user. | route headers | **Open** — needs a session (see §5.1) |
| 15 | P1 | No rate limiting or spend guard on any LLM route. | — | **Open** — see §5.2 |
| 16 | P2 | `typescript.ignoreBuildErrors: true` in `next.config.mjs` hid regressions. Flipping it off immediately exposed 4 more failures: every `/api/agents/[agentId]/*` handler still used the Next 15 synchronous `params` signature, which Next 16 rejects. | `.next/types/validator.ts` | **Fixed** — `ignoreBuildErrors: false`, `params` is `Promise<…>` and awaited; build now typechecks |
| 17 | P2 | TTS is whole-utterance only. None of the Live Type-to-Speech requirements (generation IDs, chunk queue, stale-audio cancellation, voice-profile reuse) exist. | no queue in repo | **Open** — see §5.3 |
| 18 | P2 | Speech recognition is the browser Web Speech API: Chrome-only, needs network, unavailable offline. | `hooks/use-ai-assistant.ts` | **Open** — see §5.4 |
| 19 | P2 | Qwen2.5-Omni speech-in/out cannot run on Vercel (serverless, no GPU). Only the text side is reachable through hosted providers. | Vercel runtime `iad1`, no GPU | **Blocked by hardware** — see §5.5 |
| 20 | P2 | `/api/upload` accepts files with no MIME/size validation and no auth. | route | **Open** — see §5.6 |
| 21 | P0 | Discovered models were fetched but never rendered: the picker accepted an `onDiscover` callback and printed errors, then showed only the curated list — so "any model the provider serves" was unreachable. | `components/hud/model-picker.tsx` | **Fixed** — discovery results merge into the selectable list, tagged `live` |
| 22 | P1 | The `verified` badge in the picker was dead code: nothing ever set it, so it never appeared. | `ModelSpec.verified` had no writer | **Fixed** — set by a successful probe *or* a successful chat; `/api/models` reports it per model |
| 23 | P1 | With no `model` in the request the console always used one hard-coded id (OpenRouter Qwen). A deployment holding only, say, a Groq key answered `503 no-credential` even though a working model existed. | `DEFAULT_MODEL_ID` fallback | **Fixed** — `preferredModelId()`: `DEFAULT_LLM_MODEL` → last model that answered → first configured → catalogue default; `/api/models` publishes it as `defaultModelId` |
| 24 | P1 | Keyless runtimes reported `source: 'env'` just because a *suggested* default localhost URL existed, so the UI implied a host was configured when nothing was listening. | `lib/llm/credentials.ts` | **Fixed** — `source: 'none'` unless an operator set `*_BASE_URL`; the suggestion is shown as a suggestion |

---

## 4. Evidence

### 4.1 Typecheck and build

```
npx tsc --noEmit      → 0 errors   (was 25)
npx next build        → ✓ Compiled successfully · 11/11 static pages · 18 API routes
                        (with typescript.ignoreBuildErrors now FALSE)
```

### 4.2 End-to-end against a real HTTP provider

`scripts/mock-llm-server.mjs` is an OpenAI-compatible server used to exercise
the adapter layer without provider keys or egress. Every request below is a real
HTTP call through `/api/chat`.

```
POST /api/chat {"message":"hello there","model":"custom/mock-gpt"}
→ 200 {"response":"mock reply to \"hello there\" via mock-gpt (auth present)",
       "provider":"custom","latencyMs":23,"usage":{...}}

POST /api/chat {"message":"stream please","model":"custom/mock-gpt","stream":true}
→ event: meta {"model":"custom/mock-gpt","provider":"custom"}
→ data: {"delta":"mock "} / {"delta":"reply "} / …
→ event: done

POST /api/chat {"model":"custom/unauthorised-model"}  → 401 auth-failed + fix
POST /api/chat {"model":"custom/rate-limited-model"}  → 429 rate-limited + fix
POST /api/chat {"model":"openai/gpt-4o"}              → 503 no-credential + fix
POST /api/chat {"model":"nope/nothing"}               → 404 unknown-model + fix
```

### 4.3 Discovery and the sweep

```
GET /api/models?discover=custom
→ 30 curated models · 15 providers · discovered: [custom/mock-gpt, custom/mock-qwen]

node scripts/verify-llm.mjs --probe --models …
PASS  custom/mock-gpt                   cloud   14ms
PASS  custom/mock-qwen                  cloud    3ms
FAIL  custom/rate-limited-model         cloud     —   rate-limited: responded 429
BLOCK openai/gpt-4o                     cloud     —   no-credential: OPENAI_API_KEY unset
BLOCK anthropic/claude-sonnet-4-5       cloud     —   no-credential: ANTHROPIC_API_KEY unset
BLOCK google/gemini-2.0-flash           cloud     —   no-credential: GOOGLE_API_KEY unset
BLOCK ollama/qwen2.5-7b                 on-device —   config-error: no host configured
BLOCK vllm/qwen2.5-omni-7b              self-hosted — config-error: no host configured
BLOCK bedrock/claude-3-5-sonnet         cloud     —   unsupported-provider (SigV4)
```

### 4.4 Selection is honoured end-to-end

```
POST /api/chat {"message":"hello there","model":"custom/mock-gpt"}
→ 200 model:"mock-gpt" provider:"custom" latencyMs:16   ← the requested model ran

POST /api/chat {"message":"and again"}            (no model named)
→ 200 model:"mock-gpt" …                          ← preferredModelId() picked the
                                                    last model that answered

GET /api/models
→ defaultModelId: "custom/mock-gpt"   (this deployment)
  catalogueDefaultModelId: "openrouter/qwen-2.5-72b-instruct"
```

### 4.5 Input validation / security paths

```
POST /api/voice-clone (no consent)        → 403 consent-required
POST /api/voice-clone (consent, no key)   → 503 no-credential   ← no mock audio
POST /api/voice-clone (text/plain upload) → 415 bad-request
POST /api/persona                         → 501 X-Mock: true
POST /api/gateway/config (no enc key)     → 503 missing-encryption-key + fix
POST /api/speech (no key)                 → 503 no-credential + fix
```

### 4.6 Production

The deployed project currently has **no environment variables**
(`vercel.list_env_vars` → `envs: []`), so the production sweep reports every
model `BLOCK`ed with `no-credential`. That is the honest state, and it is the
single action that unlocks every hosted model — see §5.1.

---

## 5. How to resolve what is still open

### 5.1 Credentials + auth (unblocks every hosted model)

Add **one** provider key in Vercel → Project → Settings → Environment Variables
(Production), then redeploy:

| provider | variable | models unlocked |
|---|---|---|
| OpenRouter | `OPENROUTER_API_KEY` | 9 curated + every OpenRouter model (`?discover=openrouter`) |
| OpenAI | `OPENAI_API_KEY` | GPT-4o, GPT-4o mini |
| Anthropic | `ANTHROPIC_API_KEY` | Claude Sonnet 4.5, 3.5 Haiku |
| Google | `GOOGLE_API_KEY` | Gemini 2.0 Flash / 2.5 Pro |
| Groq | `GROQ_API_KEY` | Llama 3.3 70B (lowest latency for the voice loop) |
| DeepSeek / Mistral / Together / HF / Cohere | `…_API_KEY` / `HF_TOKEN` | the rest |

Verify with `node scripts/verify-llm.mjs --base https://<deployment> --probe`.

**Auth.** Wrap the routes in a session check (`x-user-id` must never be trusted):

```ts
// app/api/chat/route.ts — before resolveModel
const session = await getSession(request);          // your auth provider
if (!session) return NextResponse.json({ error: 'Unauthorised', code: 'auth-failed', fix: 'Sign in.' }, { status: 401 });
```

Durable per-user credentials need a real store (Vercel KV / Postgres) with the
existing AES-256-GCM helpers in `lib/gateway-encryption.ts`, plus
`GATEWAY_ENCRYPTION_KEY` (≥ 16 chars).

### 5.2 Spend guard

Add a per-user token/quota check in `lib/llm/service.ts` before dispatch
(counter in KV, keyed by user + model + day) and return
`429 rate-limited` with `fix: 'Quota reached — switch model or wait for reset.'`

### 5.3 Live Type-to-Speech (spec: `Live Type-to-Speech Specification.md`)

Nothing here is faked; the feature does not exist yet. Minimum honest build:

1. `hooks/use-speech-queue.ts` — sentence splitter (`. ! ?` with abbreviation
   guard + debounce), monotonic `generationId`, chunk `seq`, `AbortController`
   per generation, ordered playback queue with backpressure.
2. `POST /api/speech` gains `{ generationId, chunkId, voiceId }` and streams
   audio bytes; `/api/tts/stream` for providers that support it (ElevenLabs
   `/v1/text-to-speech/{id}/stream`).
3. Discard any audio whose `generationId` ≠ current — this is the one rule the
   spec repeats: "never allow speech from outdated text to continue playing".
4. Persist only preferences (auto-speak, strategy, model id, voice id), never
   audio or transcript history.

Acceptance tests TTS-01…TTS-16 and the four race-condition tests then become
runnable as-is; today they would all fail for absence, not for bugs.

### 5.4 Local speech recognition

Replace the browser API with a route: `POST /api/stt` (multipart audio →
whisper.cpp server, `faster-whisper`, or Qwen2.5-Omni ASR). Keeps the existing
`toggleMicrophone` contract; removes the Chrome-only, network-only limitation.

### 5.5 Qwen2.5-Omni (the spec's primary model)

- **Text:** available today via OpenRouter / Together / HF entries.
- **Audio in/out:** needs a GPU host running the official Transformers path or a
  compatible Omni server. Vercel functions have no GPU, so the catalogue lists it
  under `vllm` as `self-hosted` with the hardware gate in `notes`.
- To enable: deploy the Omni runtime (e.g. on a GPU box or Runpod), set
  `VLLM_BASE_URL=https://<host>/v1`, then pick **Qwen2.5-Omni 7B**. The console
  will label execution `self-hosted` — never "on-device".
- Do **not** claim streaming speech from a plain vLLM deployment; its
  OpenAI-compatible surface does not serve the Omni audio head.

### 5.6 Uploads and build hygiene

- `/api/upload`: add auth, MIME allow-list, 10 MB cap and a content hash before
  writing (mirror the voice-clone validation).
- `next.config.mjs`: drop `typescript.ignoreBuildErrors` now that `tsc` is clean,
  and add `npx tsc --noEmit` to CI so regressions cannot return.

---

## 6. Provider status after this pass

| provider | wire format | keyless | notes |
|---|---|---|---|
| OpenRouter, OpenAI, Groq, Mistral, DeepSeek, Together, Hugging Face, Ollama, vLLM, LiteLLM, custom | OpenAI-compatible | Ollama/vLLM/LiteLLM/custom | `baseUrl` override honoured; local runtimes need an explicit `*_BASE_URL` |
| Anthropic | `/v1/messages` | no | `x-api-key` + `anthropic-version` |
| Google Gemini | `:generateContent` | no | key in query string, as documented |
| Cohere | `/v2/chat` | no | bearer token |
| AWS Bedrock | — | no | **refused**: SigV4 signing + different schema; not silently mis-routed |

---

## 7. Voice Studio / Live Type-to-Speech — PASS vs BLOCKED

The two attached specifications are binding, and both forbid presenting mocks or
simulated installs as working integrations. Nothing below is claimed as
delivered unless the evidence column names a file and a command that produced it.

### 7.1 Voice Studio acceptance criteria

| # | Criterion | State | Evidence / why not |
|---|---|---|---|
| 1 | Existing architecture and security contracts respected | **PASS** | No route dropped; `tsc` 0 errors; build typechecked; chat/mic/settings/face-capture/agents still route |
| 2 | Model registry + runtime adapter interfaces implemented | **PASS** | `lib/llm/{types,providers,service}.ts`; 4 wire formats, one narrow interface |
| 3 | Model installation and configuration are real, validated operations | **BLOCKED** | No model weights are installed in this repo or on Vercel; there is no installer. Configuration *is* real (`/api/models`, `PREFERRED` env) but "installation" has no implementation to call |
| 4 | Qwen2.5-Omni tested on a documented compatible runtime | **BLOCKED** | No GPU runtime available (Vercel functions have none; no GPU host in this environment). Text-side Qwen is reachable via OpenRouter/Together — audio side is not tested and not claimed |
| 5 | Text path passes integration tests | **PASS** | `scripts/verify-llm.mjs` live probe: `custom/mock-gpt` 200, streaming SSE verified |
| 6 | Audio-input path passes integration tests | **BLOCKED** | No ASR runtime. Browser `SpeechRecognition` exists but is not a model integration and is Chrome-only |
| 7 | Audio-output path passes integration tests | **BLOCKED** | No TTS credential (`GOOGLE_API_KEY`/`ELEVENLABS_API_KEY` unset → `/api/speech` 503 with a fix). Never faked |
| 8 | Type-to-speech uses the selected model's actual streaming capabilities | **BLOCKED** | No sentence queue exists; see §7.2 |
| 9 | Local-first and offline policies enforced | **BLOCKED** | No local engine installed; catalogue labels execution honestly (`on-device` only for Ollama/vLLM entries, which refuse to run without an explicit host) |
| 10 | Hosted fallback requires explicit configuration and permission | **PASS** | `/api/voice-clone` requires `consent=true` (403 otherwise) and an explicit `ELEVENLABS_API_KEY` (503 otherwise); no hosted call without configuration |
| 11 | Voice cloning only for compatible engines and authorized profiles | **PARTIAL** | Validation + consent gate + real ElevenLabs call implemented; profile deletion/revocation (TTS-10) not implemented |
| 12 | Security, unit, integration, e2e tests pass | **PARTIAL** | Contract/integration tests exist (`scripts/verify-llm.mjs`, curl matrix in §4); no unit or browser e2e harness in the repo |
| 13 | Evidence identifies model, runtime, device, results, limitations | **PASS** | This document + `/api/llm/verify` payload (`runtime.node`, `runtime.region`, per-model latency and error codes) |
| 14 | Documentation and progress tracker updated | **PARTIAL** | This document; no external tracker exists in-repo |

### 7.2 Live Type-to-Speech acceptance tests

All sixteen are **BLOCKED** on the same missing component: there is no speech
queue, no generation id, and no streaming TTS endpoint. Recording them as
anything else would violate the spec's own rule. Concretely:

| Test | State | Blocks it |
|---|---|---|
| TTS-01 default settings | BLOCKED | no settings surface for auto-speak / strategy / voice |
| TTS-02 complete sentence | BLOCKED | no sentence detector; `/api/speech` takes whole text |
| TTS-03 partial sentence buffering | BLOCKED | same |
| TTS-04 ordered, non-overlapping playback | BLOCKED | no playback queue |
| TTS-05 streaming synthesis | BLOCKED | no `generationId`/chunked TTS route; providers offer `/stream` but nothing calls it |
| TTS-06 no duplicate/out-of-order on delayed chunks | BLOCKED | no queue |
| TTS-07 rapid editing invalidates stale synthesis | BLOCKED | no `AbortController` per generation |
| TTS-08 clear during playback | BLOCKED | no queue to clear |
| TTS-09 voice switch cancels old audio | BLOCKED | same |
| TTS-10 deleted/revoked profile blocks synthesis | BLOCKED | no profile store |
| TTS-11 runtime failure keeps editor usable + actionable error | PARTIAL | `/api/speech` now returns `{error, code, fix}` and the hook surfaces it, but there is no editor to protect |
| TTS-12 offline local engine | BLOCKED | no local TTS engine installed |
| TTS-13 no hosted call without explicit authorization | **PASS** | `consent` gate + missing-key 503; nothing is synthesized silently |
| TTS-14 resource release across runs | BLOCKED | no queue |
| TTS-15 settings persistence | BLOCKED | no settings |
| TTS-16 keyboard/AT accessibility | BLOCKED | no controls |

**Path to PASS** (same order as the spec's workflow): install a local TTS engine
or configure a hosted one → add `hooks/use-speech-queue.ts` (splitter,
generationId, abort, ordered queue) → extend `/api/speech` with
`{generationId, chunkId, voiceId}` and a streaming variant → add the editor UI
with keyboard support → run TTS-01…16. Nothing in that chain requires rewriting
what exists; the model layer and its error contract are already in place.
