# Agent Browser — stealth, resilience and autonomous recovery

The console can run browser tasks that outlive a single interaction: an objective,
a plan, a deadline, and a runner that keeps working, recovers from ordinary
failures, and stops honestly when it cannot continue.

Everything in this document describes code that runs. The verification matrix at
the end says which claims were executed here and which are blocked in this
environment, and why.

```
lib/browser/
  types.ts            task/checkpoint/evidence/timeline vocabulary
  watchdog.ts         stalled-action and no-progress detection (pure)
  loops.ts            repeated-action, ping-pong, identical-result, error loops (pure)
  progress.ts         "is this a meaningful change" — volatile text ignored
  criteria.ts         declarative success criteria, evaluated live
  restrictions.ts     CAPTCHA / bot-check / 403 / 429 / login-wall detection
  recovery.ts         bounded recovery ladder + sensitive-action policy
  task.ts             the runner: state machine, checkpoints, resource limits
  store.ts            durable task store (atomic JSON on disk, memory fallback)
  engine.ts           engine contract (launch, navigate, click, snapshot, screenshot…)
  chromium.ts         bundled Chromium + shared-library bootstrap
  puppeteer-engine.ts the real engine (Puppeteer + @sparticuz/chromium)
  service.ts          process-wide registry, restore-on-boot, controls
app/api/browser/      tasks API, per-task controls, evidence screenshots
components/hud/browser-panel.tsx  live observation + controls
```

## 1. Browser compatibility and identity

| Capability | How it is handled |
|---|---|
| Modern JS / dynamic pages | Real Chromium (Puppeteer), not an HTML parser. SPA navigations are observed through the accessibility tree, not the initial response. |
| Consistent identity | Locale (`--lang=en-US`), viewport (1440×900), timezone and user agent are fixed for the life of a task. **No randomisation, no fingerprint forging.** |
| Normal interaction | Clicks use the mouse path by default; `dom` and `keyboard` paths exist so a retry can use a *different* method. |
| Accessibility targeting | Elements are matched by role + accessible name (aria-label, labelledby, alt, placeholder, text), with a CSS selector as fallback. A match is tagged `data-nexus-target` so it can be re-located after a reload. |
| Cookies / cache / storage | One browser context per task; cookies and `localStorage` are captured into checkpoints and re-applied on restore. |
| Session persistence | `storageState` is written with each verified checkpoint; a restore re-applies it before the first step. |
| Redirects & SPAs | `page.url()` after navigation is the source of truth; a redirect is reported, never assumed. |
| Downloads | CDP `Browser.setDownloadBehavior` into a per-task directory; `content-disposition: attachment` responses are recorded. |
| Proxy | `BROWSER_PROXY` is honoured **for deployments that legitimately require one**. It is not used to defeat regional blocks. |
| Automation restrictions | Detected and reported (§7), never circumvented. |
| Screenshots | Captured at milestone/evidence points and served from `/api/browser/tasks/:id/screenshot/:shotId`. |
| Isolation | Separate browser contexts per profile; closing a task closes its context (a shared remote browser is disconnected, not killed). |

**We do not claim any engine is undetectable**, and nothing here tries to be. The
agent identifies as itself, obeys `robots`-style access decisions the site makes,
and stops when refused.

## 2. Autonomous progress watchdog

`inspectWatchdog()` answers one question: is this task still making progress?
It is evaluated on every tick, in priority order:

1. **deadline** — the task reaches `TIMED_OUT`;
2. **action timeout** — the current operation exceeded its budget (10 s actions,
   25 s navigation by default);
3. **no progress** — nothing *verified* for `progressIntervalMs` (90 s default).

The runner tracks last successful action, last meaningful state change, last
verified milestone, current URL/tab, the running operation and its start time,
consecutive failures, repeats, and time remaining.

When the watchdog fires the runner captures the page state, cancels the operation
through an `AbortController` (and a runner-side deadline race, so an engine that
never settles cannot hang the task), re-inspects, and enters `RECOVERING`.
**An open page is not evidence of progress** — `progress.ts` compares URL, title
and accessibility digest with volatile text (clocks, "N minutes ago", percentages)
removed, so a ticking clock cannot fake a milestone.

## 3. Retry and recovery

Bounded, state-aware, and never identical twice:

```
wait-for-state → reload → re-inspect a11y tree → re-locate target →
alternate interaction method (mouse → dom → keyboard) → authorised alternative URL →
defer the step and continue → stop honestly
```

A retry always changes something. Before any retry of a **sensitive** step
(purchase, payment, account change, submission) the runner evaluates the step's
declared `expect` criteria against the live page:

- effect present → the step is recorded as done and **not repeated**;
- effect absent and verified → retry allowed;
- effect unverifiable → the task goes `WAITING_FOR_USER` with the reason.

## 4. Loop detection

`loops.ts` flags: repeated action on an unchanged page, A↔B navigation
ping-pong, identical search results, the same browser error N times, repeated
downloads of the same file, and any repeat after a recorded block. On a finding
the runner stops the repeated action, records it in the timeline, and changes
strategy — a different interaction method, a different route, or a stop with
`loop-detected`.

## 5. Task lifecycle

```
QUEUED → RUNNING → RECOVERING → RUNNING → COMPLETED
              ↘ WAITING_FOR_USER ↗
              ↘ FAILED / BLOCKED / CANCELLED / TIMED_OUT
```

`PAUSED` is an addition to the spec's list, because the UI offers pause/resume.

Each task carries a unique id, objective, plan, success criteria, deadline, retry
budget, consecutive-failure ceiling, recovery budget, progress timestamp,
checkpoints, status and final outcome. Checkpoints are written at verified
milestones (≤ 40 kept) with the page observation, criteria results and storage
state.

**Restoring is not repeating.** After a crash or a service restart the task comes
back as `RECOVERING`, reopens the checkpointed URL, compares the live digest with
the checkpointed one, and only then decides whether to continue. If the
interrupted step's effect is already visible, it is not repeated.

## 6. Restrictions and alternatives

`restrictions.ts` recognises CAPTCHA widgets, bot checks, 403/429, "access
denied", login walls and region blocks, from status codes and page text. A soft
block that a human can clear (CAPTCHA, expired session) → `WAITING_FOR_USER` with
the exact instruction. A hard block → `BLOCKED`, with the restriction and its fix
kept on the record. If the spec names an authorised alternative URL, it is tried
once before giving up — and the original restriction stays visible so the
operator knows where the result came from.

Solving CAPTCHAs, extracting credentials, forging fingerprints or dodging access
controls are **not** recovery strategies here; there is no code path for them.

## 7. Resource and session resilience

Every step checks the browser: tab count (extra tabs are closed at the limit),
JS heap (above `maxHeapMb` the browser is recycled from the checkpoint; repeated
recycling blocks the task with `resource-limit`), liveness, screenshots and the
downloads directory. CPU is reported as `null` when the platform cannot measure
it — never invented. An expired session asks for reauthentication; a crashed
browser is restarted up to twice, then the task blocks with the reason.

## 8. What the operator sees

`BrowserPanel` (dock → **Browser**) shows the current task and objective, the
current site, the last successful action, the last verified milestone, time since
meaningful progress, recovery attempts, retries, loop flags, checkpoints, browser
health, the current blocker with its fix, the outcome, per-criterion results, the
evidence screenshot, and the full recovery history. Controls: pause, resume,
stop, inspect. A stalled task says **stalled** — the panel never animates
activity the agent does not have.

## 9. API

| Route | Purpose |
|---|---|
| `GET /api/browser/tasks` | tasks + live views + engine availability |
| `POST /api/browser/tasks` | `{ spec }` → queue a task (validated before it exists) |
| `GET /api/browser/tasks/:id` | one task, live |
| `POST /api/browser/tasks/:id` | `{ action: pause \| resume \| cancel \| inspect }` |
| `GET /api/browser/tasks/:id/screenshot/:shotId` | evidence PNG |

A spec without success criteria is rejected (`invalid-plan`): a task that cannot
be verified must not be startable.

## 10. Deployment

| Variable | Purpose |
|---|---|
| `BROWSER_EXECUTABLE_PATH` | Use a system Chrome/Chromium instead of the bundled build |
| `BROWSER_WS_ENDPOINT` | Connect to a remote browser service instead of launching locally |
| `BROWSER_PROXY` | Proxy for deployments where one is legitimately required |
| `BROWSER_TASK_DIR` | Where task records, checkpoints and screenshots live (default `./.nexus/browser`) |

The bundled engine is `@sparticuz/chromium` + `puppeteer-core`, kept out of the
Next bundle via `serverExternalPackages`. Its shared libraries are extracted from
the package's brotli archive into a temp dir and added to `LD_LIBRARY_PATH` at
launch, so a plain Linux container works without a system Chrome.

## 11. Verification

```bash
npx tsc --noEmit                    # 0 errors
npx pnpm@10 run build               # 27 routes
npm run test:browser                # 31 checks — AT-15 … AT-26, scripted engine
npm run test:browser:live           #  7 checks — real Chromium against a fixture site
```

| Requirement | Scripted suite | Live (real Chromium) |
|---|---|---|
| AT-15 stalled navigation | PASS | PASS — a route that never responds is cancelled, task ends explicitly |
| AT-16 repeated actions / loops | PASS | PASS — a button the site ignores never advances the plan |
| AT-17 browser crash recovery | PASS | PASS — `SIGKILL` on the browser process → restart → checkpoint match → COMPLETED |
| AT-18 session expiry | PASS | PASS — `WAITING_FOR_USER`, `session-expired` |
| AT-19 blocked website | PASS | PASS — 403 requested **once**, `access-denied` recorded |
| AT-20 long-running task | PASS (40 steps, hours of virtual time) | PASS — 40-step crawl, then **service killed and restarted mid-run** |
| AT-21 deadline enforcement | PASS | — (covered by the scripted clock) |
| AT-22 progress evidence | PASS | PASS — every checkpoint carries a URL + digest; completion carries a real PNG |
| AT-23 safe retries | PASS | — |
| AT-24 restart recovery | PASS | PASS — task restored from checkpoint 2 of 40 and finished all 40 steps |
| AT-25 resource limits | PASS | — (tab/heap ceilings exercised on the scripted engine) |
| AT-26 honest completion | PASS | PASS — criteria verified against the live page before `COMPLETED` |

Additional executed evidence: a real task created through the HTTP API navigated,
clicked a real button through the accessibility tree, verified `Report ready`, and
its evidence screenshot is the actual page after the click.

### BLOCKED in this environment

- **Multi-hour runs on a serverless host.** The browser lives inside one function
  invocation; Vercel-style serverless cannot host a 30-minute task. Every task
  created there carries that limitation explicitly. Use a long-running Node host
  (container/VPS) or `BROWSER_WS_ENDPOINT` for real long runs.
- **Site-side bot defences.** Whether a specific site detects an automated
  browser is not something this repo can verify (and not something it claims).
  The agent reports blocks it recognises; it does not test evasion.
- **Remote-browser mode (`BROWSER_WS_ENDPOINT`).** The code path exists and is
  used by `launch()`, but no remote browser service was available to exercise it.
- **Downloads end to end.** The download directory and CDP behaviour are wired and
  `download-begun` criteria exist, but no fixture served an attachment in this
  run, so the file-on-disk assertion is untested here.
