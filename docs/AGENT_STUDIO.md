# Agent Designer Studio

The platform's entry point for composing an agent, built against the Agent
Creation Module specification (v1.0): eight capability categories, a dependency
map, a validation engine that fails closed, and activation that refuses to lie
about what will run.

Dock → **Studio**. Everything you see there is either your draft or a live probe
of this deployment.

```
lib/agent-studio/
  types.ts        categories, capabilities, availability, permissions, issues
  catalogue.ts    what this build can actually do, with its limits
  validate.ts     pure validation: blockers, warnings, verdicts, features
  draft.ts        pure draft operations, templates, diff, versioning
  probe.ts        server probe: providers, browser, memory, runtimes, speech
  store.ts        versioned activation records (atomic JSON on disk)
components/agent-studio/
  agent-studio.tsx      the studio shell: palette, map, inspector, validation
  studio-graph.tsx      the composition map (real dependency edges)
  holo-backdrop.tsx     the animated holographic plate
app/api/agents/studio/  capabilities probe, activation, versions, state
```

## 1. The holographic backdrop

The studio sits on an animated holographic plate — the neural-scan image you
supplied, rendered as a living background rather than a static picture.

**How it is made.** One full-screen fragment shader samples the plate and gives
it depth: luminance decides how far each pixel sits from the glass, so the bright
subject drifts against the dark room, gains a radial chromatic fringe, a second
"ghost" layer behind it, a laser sweep, a travelling refresh band, scanline
materials and sparse data motes. It reads as a hologram because the layers move
at different rates — nothing wobbles at random, and the pointer parallax settles
instead of snapping.

**The 30% contract.** The image is composited at **exactly 30% opacity**, held in
one uniform (`HOLO_OPACITY = 0.3`) and asserted by the UI test
(`data-holo-opacity="0.3"`). Two details make that 30% actually visible:

- the plate is a dark photograph (mean luminance ≈ 21%), so it is tone-mapped
  (a modest gain plus a gamma lift) before compositing — the *alpha* is still 30%;
- the canvas blends premultiplied (`ONE, ONE_MINUS_SRC_ALPHA`). The first version
  blended `SRC_ALPHA` on an unpremultiplied buffer, which made the compositor
  apply alpha twice and rendered the plate at ~9% — the effect looked switched
  off. That is fixed and documented in the component so it is not reintroduced.

**It is decoration, and it says so.** The clip is `aria-hidden`, never
interactive, and the only number it shows is its own loop timecode, labelled
*ambient plate*. It never claims to be agent activity.

**It behaves itself.**

| Condition | Behaviour |
|---|---|
| Tab hidden / governor says hidden | No frames drawn |
| Power profile `saver` | Frame budget drops to the governor's cap (20 fps) |
| `prefers-reduced-motion` | One still frame, same 30% opacity, no loop (`data-holo-reduced="true"`), and the CSS textures stop too |
| No WebGL | `data-holo="static"` — the plate is not faked, it is simply absent |
| Panel closed | Canvas unmounted; context, texture and program released |

## 2. Composition

Eight categories from §7 of the specification, each a slot on the map:
framework/runtime, AI brain, memory, behaviour & autonomy, interaction, tools &
connectors, knowledge, permissions.

- **Component cards** show name, plain-language purpose, availability word,
  dependencies, permission scopes and known limitations. Status is a *word plus a
  glyph*, never colour alone.
- **Single-select categories** (runtime, model, behaviour, memory, permissions
  gate) replace each other instead of stacking two runtimes by accident.
- **Edges are dependencies**, not decoration: a line exists only where a
  capability's `requires` names a selected capability. Selecting a node opens its
  configuration; the inspector explains what is not usable and why.
- **Model routing** uses the console's real catalogue — 137+ models with provider
  credentials state — so an unconfigured provider is visible before activation.
- **Templates** (Research brief, Daily workflow, Document intake, Site monitor)
  are starting points, validated like any other draft.

## 3. Validation

A capability is usable only when **every** layer supports it (§8.1). The engine is
a pure function over (draft, probe), so the same rules run in the UI and in the
server's activation check.

Blockers: no runtime, two runtimes, no behaviour, no channel, missing dependency,
uninstalled runtime, unreachable provider, missing permission scope, unconfigured
model, a channel the routed model cannot support, role requirements (a research
agent without the browser tool), and any unknown component.

Warnings that must be **acknowledged** before activation: unproven compatibility
(`check-required` never silently passes), an incompatible fallback, and memory
that is not persistent.

Honest states, exactly as the specification distinguishes them: `Ready`,
`Needs setup`, `Check required`, `Unsupported`, `Unavailable`. A probe can
confirm a capability, lower it, or leave it unproven — it can never raise a
static `unsupported`, and an absence of information is a warning, never a pass.

## 4. Activation and history

`Activate` is disabled while anything blocks. Opening it shows the
**pre-activation review**: capabilities, data access, limits, verified features.
Confirming calls `POST /api/agents/studio/agents`, where the server **re-runs the
validation against a fresh probe** — the browser's opinion is not evidence.

An accepted activation writes a versioned record:

```json
{
  "agentId": "agent-…", "version": 1, "state": "active",
  "selected": { … }, "granted": ["execute", "read"],
  "validation": { "activatable": true, "blockers": 0, "warnings": 0, "acknowledged": ["memory:session-only"] },
  "runtime": { "connected": true, "note": "framework.task-runner is connected; this version is the one new runs use." }
}
```

Records live in `AGENT_STUDIO_DIR` (default `./.nexus/agents`), one JSON document
per agent with up to 25 versions, written atomically (temp file + rename). Editing
an active agent creates a **new version** rather than mutating the old one, and
the diff is computed before saving. Pause / resume / archive change the latest
version's state and say plainly that no runtime started or stopped.

## 5. Accessibility

- Every map node is a real `<button>` with a label including its availability; the
  SVG edge layer is `aria-hidden`.
- Below `lg` the studio becomes a three-pane drawer — palette, map, inspector —
  one pane at a time with `role="tablist"` tabs, so a phone never gets three
  cramped columns or a stack of collapsed scroll boxes. Picking a component
  jumps to its configuration.
- Status is never colour-only (word + glyph), focus rings come from the console's
  own tokens, and the validation panel is a live region.
- Escape closes the review sheet first, then the studio.

## 6. API and configuration

| Endpoint | Purpose |
|---|---|
| `GET /api/agents/studio/capabilities` | live probe: providers, models, browser, memory, runtimes, speech, FTP, scheduler |
| `GET /api/agents/studio/agents` | saved configurations (latest version each) |
| `POST /api/agents/studio/agents` | activate — re-validates, `409 configuration-blocked` with blockers when it cannot |
| `GET /api/agents/studio/agents/:id` | every version (audit history) |
| `POST /api/agents/studio/agents/:id` | `pause` \| `resume` \| `archive` |
| `DELETE /api/agents/studio/agents/:id` | remove the record |

| Variable | Effect |
|---|---|
| `AGENT_STUDIO_DIR` | Where activation records are stored |
| `AGENT_RUNTIME_LANGGRAPH_URL` / `_CREWAI_` / `_AG2_` / `_OPENCLAW_` | Make that runtime `Ready` |
| `MEMORY_SUPERLOCAL_URL` | Makes SuperLocalMemory `Ready` |
| `INGEST_MARKITDOWN_URL` | Makes MarkItDown `Ready` |
| `AGENT_STUDIO_SCHEDULER=1` | Marks the scheduled behaviour `Ready` |
| `FTP_ALLOWED_HOSTS` | Makes the FTP publish tool `Ready` |

## 7. Verification

```bash
npm run test:studio   # 43 checks — catalogue, draft, validation, store
npm run test:ui       # 22 checks — the built studio in a real browser
```

**43 studio checks** cover: catalogue integrity (unique ids, real dependencies,
honest availability notes), single-select replacement, defaults, acknowledgements,
versioning and diff, the empty-draft blockers, an uninstalled runtime blocking
with its exact fix, a complete configuration becoming activatable, unacknowledged
warnings blocking, session memory never claiming persistence, unconfigured
provider routes, missing permission scopes, dependency and role requirements,
unproven capabilities staying warnings, audio channels refused on models without
audio, incompatible fallbacks, feature/verdict propagation, zero limits, unknown
components failing closed, probe-lowering and probe-confirming, all four
templates, the activation summary's disclosures, and the atomic versioned store
(write, rewrite, append, pause, list, delete).

**UI checks** (in the 20-check suite) cover: the dock entry, the studio opening
with `data-holo="webgl"` at `0.3`, the live probe reporting both `Ready` and
`Needs setup`, a template filling the map and the validation reacting, and
activation being refused with `409 configuration-blocked` plus blockers while the
configuration is incomplete, the reduced-motion still frame with its textures
stopped, and a 390 px viewport getting one pane at a time without sideways
scrolling.

### BLOCKED in this environment

- **A successful activation.** No model provider has credentials here, so the
  model route cannot validate — which is the correct, honest outcome. The refusal
  path is tested end to end; the success path needs a configured provider (or a
  custom OpenAI-compatible endpoint via `CUSTOM_LLM_BASE_URL`).
- **Running a composed agent.** No agent runtime is installed. Every record says
  `runtime.connected` honestly, and the studio says outright that this deployment
  has nothing to execute with. Wiring an executor is the next block of work, not a
  claim this module makes.
- **SuperLocalMemory / MarkItDown.** Neither is installed; both are `Needs setup`
  with their exact environment variable and the licence caveats (AGPL-3.0 review
  required for SuperLocalMemory).
- **Reduced motion on a real phone.** Emulated media features are verified; the
  OS-level switch is not exercised here.
- **Real GPU quality for the clip.** This sandbox renders through SwiftShader, so
  the plate's frame cost here says nothing about a real device. The governor path
  is exercised; the GPU numbers are not reported.
