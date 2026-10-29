# Artifacts, Offline-First, and Battery/Perf

Everything below is shipped and exercised by the commands at the end. Nothing in
this document describes a mock, a placeholder, or a planned feature.

## 1. What an artifact is

An artifact is a file an agent (or the operator) produced that is worth keeping:
source, config, report, data table, or a format we do not recognise. The kind is
derived from the file extension only — never guessed from content — so an unknown
extension lands in `custom` instead of being mislabelled.

| Kind | Examples | Preview |
|---|---|---|
| `code` | `.py .js .ts .tsx .go .rs .java .c .cpp .sh .sql` | text with language tag |
| `config` | `.json .yaml .yml .toml .ini .env .xml` | text |
| `report` | `.md .html .pdf .docx .txt` | markdown / HTML / plain text; PDF & DOCX are binary → **download only**, and the panel says so |
| `data` | `.csv .tsv .jsonl .xlsx .xls .parquet` | text table for CSV/TSV/JSONL; binary spreadsheets → download only |
| `custom` | anything else | binary → download only |

Rules that hold everywhere:

- `safeName()` keeps only the last path segment and strips traversal
  (`../../etc/passwd` → `passwd.txt`), control characters, Windows-hostile
  characters, and over-long stems.
- Sizes are validated against a **32 MB** ceiling before anything is written
  (`artifact-too-large`, `invalid-size`).
- Bodies are inline text below **512 KB**, otherwise a blob in IndexedDB keyed by
  artifact id. `sha256` is computed from the bytes, so duplicate detection is by
  content, not by name.
- One message can yield at most **8** drafts; duplicates inside a message are
  folded into `a-2.js`-style names. Prose is never captured — only fenced blocks
  with a filename/extension hint, whole-reply JSON, or whole-reply CSV.
- A rename re-derives kind, MIME, extension and language from the new name and
  keeps the stored bytes and hash untouched. Renaming a published file clears the
  remote marker and warns, because FTP has no rename in our client and the copy
  on the host still has the old name.

## 2. File manager

`ArtifactPanel` (lazy-loaded, `next/dynamic` `ssr:false`) provides: list with kind
filter + search, inline rename, delete, download, paste-to-create, import from
disk, storage/quota readout, per-artifact SHA-256 and size, remote publish state,
and reclaim of orphaned blobs. Every mutation re-reads IndexedDB and dispatches
`nexus:artifacts`, so two open panels never disagree.

## 3. FTP to a remote host

A browser cannot open a raw TCP socket, so FTP runs server-side in
`app/api/ftp/route.ts` and the UI states that fact where it matters. This is not a
limitation we can design away.

- **Allowlist is mandatory.** Set `FTP_ALLOWED_HOSTS=host1,host2` (wildcards such
  as `*.mirror.example` match exactly one label and never the parent domain). The
  only way to disable it is the explicit `FTP_ALLOW_ANY=1`, because an
  unconstrained server-side FTP endpoint is an internal port-scan primitive.
- **Explicit outcomes.** Every failure carries a code and a `fix` string —
  `ftp-host-blocked`, `ftp-invalid-port`, `ftp-invalid-password`,
  `ftp-batch-too-large`, `ftp-auth-failed`, `ftp-connect-failed`, `ftp-timeout`,
  `ftp-permission-denied`, `ftp-upload-failed`. The panel renders the code next to
  the message so an operator can look it up instead of guessing.
- **No silent downgrade.** FTPS uses `rejectUnauthorized: true`; asking for TLS
  never falls back to plain FTP.
- **Passwords never touch disk.** They live in memory and `sessionStorage` for the
  tab only. A queued upload that resumes after the tab was closed fails with an
  explicit "credentials are no longer in this tab — open Artifacts and upload
  again", rather than retrying forever.
- **Bounded batches**: at most 12 files per request, 15 s connect timeout, 30 s
  per operation.

## 4. Offline-first

- **Local data**: artifacts, blobs and the task queue live in IndexedDB
  (`nexus-offline`), separate from the on-device-AI database. `/api/models` and
  other GETs go through a network-first-with-stale-fallback cache.
- **Background sync**: `lib/offline/queue.ts` persists a task *before* the first
  attempt, keys it deterministically (`kind:key`) so repeated clicks cannot stack,
  and backs off 5 s → 10 s → 20 s … capped at 300 s for 6 attempts. Failed tasks
  are parked for a manual **retry**, never silently dropped.
- **Replay**: reconnect, tab-visibility, and an explicit `sync now` all drain the
  queue; deferred tasks only run when the app is idle and on mains power.
- **Visible degradation**: the SYSTEM strip (and the archive header) report the
  real online flag, the real pending/failed count, the battery profile and whether
  the service worker is installed. Before the client has read those facts the
  strip prints a neutral `sync` instead of guessing — which is also what removed
  the hydration mismatch this panel used to cause.
- **PWA**: `public/sw.js` + `app/manifest.ts`. The shell is precached, navigations
  fall back to `/offline`, and the worker also serves download requests written by
  the page. The worker is registered in production, or in dev with `?sw=1` — a
  dev-registered worker serves one stale shell and is impossible to reason about.

## 5. Battery & performance

`lib/perf/governor.ts` is the single cadence source. Everything animated asks it,
nothing invents its own timer.

| Profile | Frame cap | Telemetry notify | Ambient orbit |
|---|---|---|---|
| `full` (mains / ≥ 50 %) | 60 fps | 5 Hz | on |
| `balanced` (20–50 %) | 45 fps | 4 Hz | on |
| `saver` (< 20 %, not charging) | 20 fps | 1 Hz | paused (CSS `data-power='saver'`) |

- Missing Battery Status API reports `supported: false` rather than fabricating a
  level. `document.hidden` stops the loop entirely.
- Resolution drops before frames do: the avatar rig calls `setQuality(profile)`
  (pixel ratio 1.5 → 1.25 → 1.0).
- Charts, waveform and spectrum take `Math.max(base, getGovernor().getFrameIntervalMs())`.
- **Code splitting**: Settings, Model picker, Local AI and Artifacts are
  `next/dynamic` with `ssr: false`; none of them is in the first-paint bundle.
- **Background work**: `scheduleTask({priority})` defers pruning, healing and cache
  warming through `requestIdleCallback` (1200 ms fallback).
- **Worker offload**: hashing, name derivation and extraction run in
  `public/workers/artifact.worker.js` so a 20 MB import does not block input.

## 6. Verification

```bash
npx tsc --noEmit                       # 0 errors
npx pnpm@10 run build                  # 24 routes
node scripts/test-artifacts.mjs        # 36 checks — classify/extract/guard/queue
node scripts/test-ftp.mjs              # 7 checks against a real ftp-srv on 127.0.0.1:2121
```

`test-ftp.mjs` starts `ftp-srv@4.6.3` on loopback, uploads real bytes, and compares
the SHA-256 of the file on disk with the hash the client reports. Wrong passwords
must fail with `ftp-auth-failed` and must not leak the password into the message.

Browser run (production build) — all 22 checks pass:

| Check | Result |
|---|---|
| load with no hydration/page errors | PASS |
| service worker active | PASS |
| create → success notice | PASS |
| inline rename → kind re-derived `report → config` | PASS |
| FTP connect test reports the real host/dir | PASS |
| FTP upload lands byte-identical on the FTP server | PASS |
| wrong password → `ftp-auth-failed` + fix | PASS |
| offline → strip shows OFFLINE, submit queues | PASS |
| pending count visible while offline | PASS |
| reload while offline still boots the console | PASS |
| reconnect drains the queue, file appears on the host byte-exact | PASS |
| delete removes the row | PASS |

**BLOCKED / not verifiable in this sandbox**

- Real-device FPS, memory and thermal behaviour: the container only has
  SwiftShader software GL, so frame numbers there are meaningless. The governor is
  verified by its decision logic and by the profile sweeps, not by device FPS.
- A genuine remote FTP host with FTPS: loopback plain FTP is verified end to end;
  FTPS is implemented but has no certificate authority to test against here.
- Standalone install (add-to-home-screen) prompts: the manifest and worker are
  correct, but install UX cannot be exercised headlessly.
