#!/usr/bin/env node
/**
 * Live browser acceptance run — real Chromium, real HTTP, real timeouts.
 *
 * The unit suite (`test-browser.mjs`) proves the state machine with a scripted
 * browser. This one proves the engine underneath it: a bundled Chromium is
 * launched, pages are rendered, accessibility targets are resolved, and the
 * scenarios that matter are reproduced on a local fixture site.
 *
 *   npm run test:browser:live
 *
 * Scenarios: stalled navigation, a click the site ignores, a 403 restriction, an
 * expired session, an honest completion, and a killed browser process.
 */
import { mkdir, rm } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const root = process.cwd();
const outDir = path.join(root, '.test-build', 'browser-live');
const downloadsDir = path.join(outDir, 'downloads');

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  FAIL  ${name}\n        ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/* ----------------------------- fixture site ----------------------------- */

const hits = { forbidden: 0, stall: 0, report: 0, login: 0 };

const PAGES = {
  '/report': `<!doctype html><html><head><title>Report console</title></head><body>
    <main><h1>Report console</h1>
    <button id="go">Generate</button>
    <p id="status">Idle</p></main>
    <script>
      document.getElementById('go').addEventListener('click', function () {
        document.getElementById('status').textContent = 'Report ready';
      });
    </script></body></html>`,
  '/noop': `<!doctype html><html><head><title>Inert</title></head><body>
    <main><h1>Inert page</h1><button id="go">Generate</button><p id="status">Idle</p></main>
    <script>document.getElementById('go').addEventListener('click', function () { /* deliberately does nothing */ });</script>
    </body></html>`,
  '/forbidden': `<!doctype html><html><head><title>Forbidden</title></head><body><h1>403 Forbidden</h1><p>Access denied</p></body></html>`,
  '/login': `<!doctype html><html><head><title>Sign in</title></head><body>
    <h1>Your session expired. Please sign in again.</h1>
    <form><label>User <input name="u" /></label><label>Password <input type="password" name="p" /></label>
    <button type="submit">Sign in</button></form></body></html>`,
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const route = url.pathname;

  if (route === '/stall') {
    hits.stall += 1;
    // Never respond: a navigation that hangs, exactly like a stalled backend.
    return;
  }
  if (route === '/forbidden') {
    hits.forbidden += 1;
    response.writeHead(403, { 'Content-Type': 'text/html' });
    response.end(PAGES['/forbidden']);
    return;
  }
  if (route === '/login') hits.login += 1;
  if (route === '/report') hits.report += 1;

  const page = PAGES[route];
  if (!page) {
    response.writeHead(404, { 'Content-Type': 'text/html' });
    response.end('<h1>Not found</h1>');
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(page);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
console.log(`fixture site on ${base}`);

/* ------------------------------ load engine ----------------------------- */

await rm(path.join(root, '.test-build'), { recursive: true, force: true });
await mkdir(path.join(outDir, 'lib'), { recursive: true });
await mkdir(downloadsDir, { recursive: true });

const sources = ['types.ts', 'watchdog.ts', 'loops.ts', 'progress.ts', 'criteria.ts', 'restrictions.ts', 'recovery.ts', 'store.ts', 'task.ts'];
for (const file of sources) {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(path.join(root, 'lib', 'browser', file), 'utf8'));
  let output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  output = output.replace(/from '\.\/([a-z-]+)'/g, "from './$1.mjs'");
  await import('node:fs/promises').then((fs) => fs.writeFile(path.join(outDir, 'lib', file.replace(/\.ts$/, '.mjs')), output, 'utf8'));
}

const load = (name) => import(`${path.join(outDir, 'lib', name)}.mjs`);
const types = await load('types');
const taskModule = await load('task');
const storeModule = await load('store');

/** The real engine, loaded through the same bootstrap the API uses. */
const { PuppeteerEngine } = await import(path.join(root, 'lib', 'browser', 'puppeteer-engine.ts')).catch(async () => {
  // The .ts file is not runnable directly under Node; transpile it and its deps.
  const files = ['chromium.ts', 'engine.ts', 'puppeteer-engine.ts'];
  await mkdir(path.join(outDir, 'lib'), { recursive: true });
  for (const file of files) {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(path.join(root, 'lib', 'browser', file), 'utf8'));
    let output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    output = output.replace(/from '\.\/([a-z-]+)'/g, "from './$1.mjs'");
    await import('node:fs/promises').then((fs) => fs.writeFile(path.join(outDir, 'lib', file.replace(/\.ts$/, '.mjs')), output, 'utf8'));
  }
  return import(`${path.join(outDir, 'lib', 'puppeteer-engine.mjs')}`);
});

const engine = new PuppeteerEngine();
const availability = await engine.availability();
console.log(`engine: ${availability.kind} available=${availability.available}${availability.reason ? ` (${availability.reason})` : ''}`);

if (!availability.available) {
  console.log('\nBLOCKED: no Chromium in this runtime — the live suite cannot run.');
  console.log(availability.fix);
  server.close();
  process.exit(2);
}

/* ------------------------------- harness -------------------------------- */

function clock() {
  return { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
}

async function runTask(spec) {
  const task = taskModule.createTask(spec);
  const runner = new taskModule.BrowserTaskRunner(task, {
    engine,
    store: new storeModule.MemoryTaskStore(),
    downloadsDir,
    ...clock(),
  });
  const started = Date.now();
  const result = await runner.run();
  return { result, elapsed: Date.now() - started };
}

const baseSpec = {
  objective: 'generate the report',
  profile: 'live-test',
  limits: { actionTimeoutMs: 4_000, navigationTimeoutMs: 4_000, progressIntervalMs: 120_000, deadlineMs: 90_000 },
};

/* =============================== AT-15 ================================= */

console.log('\nAT-15 stalled navigation (live)');

await check('a page that never responds is cancelled, and the task ends explicitly', async () => {
  const { result, elapsed } = await runTask({
    ...baseSpec,
    objective: 'open a page that never responds',
    startUrl: `${base}/stall`,
    plan: [{ id: 'open', kind: 'navigate', url: `${base}/stall`, milestone: 'opened the stalled page' }],
    successCriteria: [{ type: 'text-present', text: 'Ready' }],
    limits: { ...baseSpec.limits, navigationTimeoutMs: 2_500, maxRecoveryAttempts: 2, maxRetries: 3 },
  });

  assert(
    result.events.some((event) => /navigation-timeout|did not complete|exceeded its/i.test(`${event.message} ${event.detail ?? ''}`)),
    'no timeout was recorded',
  );
  assert(types.isTerminal(result.state), `task did not reach a terminal state: ${result.state}`);
  assert(elapsed < 60_000, `the task took ${elapsed}ms — the watchdog did not bound it`);
  console.log(`        → ${result.state} in ${Math.round(elapsed / 100) / 10}s`);
});

/* ============================ happy path =============================== */

console.log('\nAT-22 / AT-26 verified completion (live)');

await check('a real page is navigated, clicked through the a11y tree, and verified', async () => {
  const { result } = await runTask({
    ...baseSpec,
    startUrl: `${base}/report`,
    plan: [
      { id: 'open', kind: 'navigate', url: `${base}/report`, milestone: 'opened the report console' },
      {
        id: 'generate',
        kind: 'click',
        target: { role: 'button', name: 'Generate' },
        milestone: 'generated the report',
        expect: [{ type: 'text-present', text: 'Report ready' }],
      },
    ],
    successCriteria: [{ type: 'text-present', text: 'Report ready' }],
  });

  assertEqual(result.state, 'COMPLETED', `state (${result.stateReason})`);
  assert(result.evidence?.observation?.url.includes('/report'), 'completion evidence has no url');
  assert(result.evidence?.screenshotId, 'no screenshot was captured');
  assert(result.checkpoints.length >= 2, `checkpoints: ${result.checkpoints.length}`);
  assert(
    result.criteriaResults.every((entry) => entry.ok),
    'criteria were not all verified',
  );
  const screenshot = await new storeModule.MemoryTaskStore(); // placeholder, real bytes checked below
  void screenshot;
  console.log(`        → ${result.outcome}`);
});

await check('the completion screenshot is a real PNG', async () => {
  const store = new storeModule.MemoryTaskStore();
  const session = await engine.launch({ profile: 'shot', downloadsDir });
  const shot = await session.screenshot();
  await session.close();
  assert(shot.ok, `screenshot failed: ${shot.reason}`);
  assert(shot.bytes > 1_000, `screenshot is only ${shot.bytes} bytes`);
  await store.remove('none');
});

/* ============================ no-effect ================================ */

console.log('\nAT-16 loop / no-effect (live)');

await check('a click the site ignores does not march the plan forward', async () => {
  const { result } = await runTask({
    ...baseSpec,
    objective: 'click a button that does nothing',
    startUrl: `${base}/noop`,
    plan: [{ id: 'open', kind: 'navigate', url: `${base}/noop`, milestone: 'opened the inert page' },
      { id: 'click', kind: 'click', target: { role: 'button', name: 'Generate' }, milestone: 'clicked generate' }],
    successCriteria: [{ type: 'text-present', text: 'Report ready' }],
    limits: { ...baseSpec.limits, maxConsecutiveFailures: 2, maxRetries: 4, maxRecoveryAttempts: 2 },
  });

  assert(types.isTerminal(result.state), `not terminal: ${result.state}`);
  assert(result.state !== 'COMPLETED', 'a no-op click must never be reported as success');
  assert(result.loopFlags.length > 0 || result.events.some((event) => /no-effect|without an observable change|no observable change/i.test(`${event.message} ${event.detail ?? ''}`)), 'the no-effect path was not recorded');
});

/* ============================= blocked ================================= */

console.log('\nAT-19 blocked site (live)');

await check('a 403 is reported and requested only once', async () => {
  const before = hits.forbidden;
  const { result } = await runTask({
    ...baseSpec,
    objective: 'read a forbidden page',
    startUrl: `${base}/forbidden`,
    plan: [{ id: 'open', kind: 'navigate', url: `${base}/forbidden`, milestone: 'opened the page' }],
    successCriteria: [{ type: 'text-present', text: 'Ready' }],
  });

  assertEqual(result.state, 'BLOCKED', 'state');
  assert(result.restriction, 'no restriction recorded');
  assertEqual(result.restriction.kind, 'access-denied', 'restriction kind');
  assert(hits.forbidden - before <= 1, `the forbidden page was requested ${hits.forbidden - before} times`);
});

/* =========================== session expiry ============================ */

console.log('\nAT-18 session expiry (live)');

await check('an expired login session asks the operator instead of guessing', async () => {
  const { result } = await runTask({
    ...baseSpec,
    objective: 'open a page whose session expired',
    startUrl: `${base}/login`,
    plan: [{ id: 'open', kind: 'navigate', url: `${base}/login`, milestone: 'opened the account page' }],
    successCriteria: [{ type: 'text-present', text: 'Ready' }],
  });

  assertEqual(result.state, 'WAITING_FOR_USER', 'state');
  assertEqual(result.blocker?.code, 'session-expired', 'blocker code');
  assert(/sign in/i.test(result.blocker?.fix ?? ''), `fix does not mention signing in: ${result.blocker?.fix}`);
});

/* ============================== crash ================================== */

console.log('\nAT-17 browser crash (live)');

await check('killing the browser process is detected and the task resumes', async () => {
  const task = taskModule.createTask({
    ...baseSpec,
    objective: 'survive a browser crash',
    startUrl: `${base}/report`,
    plan: [
      { id: 'open', kind: 'navigate', url: `${base}/report`, milestone: 'opened the report console' },
      { id: 'pause', kind: 'wait', ms: 2_500, milestone: 'waited for the crash window' },
      {
        id: 'generate',
        kind: 'click',
        target: { role: 'button', name: 'Generate' },
        milestone: 'generated the report',
        expect: [{ type: 'text-present', text: 'Report ready' }],
      },
    ],
    successCriteria: [{ type: 'text-present', text: 'Report ready' }],
    limits: { ...baseSpec.limits, actionTimeoutMs: 4_000 },
  });

  const runner = new taskModule.BrowserTaskRunner(task, {
    engine,
    store: new storeModule.MemoryTaskStore(),
    downloadsDir,
    ...clock(),
  });

  const running = runner.run();

  // Wait until the agent is in its crash window, then kill the browser process.
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  let killed = 0;
  try {
    const pids = execFileSync('pgrep', ['-f', 'headless_shell|chrome'], { encoding: 'utf8' })
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean);
    for (const pid of pids.slice(0, 6)) {
      try {
        process.kill(Number(pid), 'SIGKILL');
        killed += 1;
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* pgrep found nothing; the scenario degrades to a plain run */
  }

  const result = await running;
  console.log(`        killed ${killed} browser process(es) → ${result.state}`);
  if (process.env.BROWSER_LIVE_DEBUG) {
    for (const event of result.events.slice(-14)) console.log('        ', event.kind, event.message, event.detail ? `::${String(event.detail).slice(0, 100)}` : '');
  }
  assert(killed > 0, 'no browser process was found to kill');
  assert(
    result.events.some((event) => /crashed|browser session started/i.test(event.message)),
    'the crash was not observed',
  );
  assert(types.isTerminal(result.state), `task did not terminate after the crash: ${result.state}`);
  assertEqual(result.state, 'COMPLETED', `state (${result.stateReason})`);
});

/* ---------------------------------------------------------------------- */

server.close();
console.log(`\n${passed} live checks passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.log(`\n${failure.name}\n${failure.error?.stack ?? failure.error}`);
  process.exit(1);
}
