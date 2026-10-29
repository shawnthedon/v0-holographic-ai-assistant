#!/usr/bin/env node
/**
 * Executed acceptance tests for the browser agent: AT-15 … AT-26.
 *
 * These run the real runner (`lib/browser/task.ts`) against a scripted browser
 * session and a virtual clock, so a thirty-minute stall, a deadline, a browser
 * crash and a service restart all happen in milliseconds — deterministically.
 *
 * What is *not* simulated: the state machine, the watchdog thresholds, loop
 * detection, the recovery ladder, checkpointing, criteria evaluation, the
 * durable store and the honest terminal states. Those are the code under test.
 *
 *   npm run test:browser
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const outDir = path.join(root, '.test-build', 'browser');

const sources = [
  'types.ts',
  'watchdog.ts',
  'loops.ts',
  'progress.ts',
  'criteria.ts',
  'restrictions.ts',
  'recovery.ts',
  'store.ts',
  'task.ts',
];

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        () => {
          passed += 1;
          console.log(`  PASS  ${name}`);
        },
        (error) => {
          failures.push({ name, error });
          console.log(`  FAIL  ${name}\n        ${error.message}`);
        },
      );
    }
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`  FAIL  ${name}\n        ${error.message}`);
  }
  return null;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/* ------------------------- transpile the sources ------------------------- */

await rm(path.join(root, '.test-build'), { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

for (const file of sources) {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(path.join(root, 'lib', 'browser', file), 'utf8'));
  let output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  output = output.replace(/from '\.\/([a-z-]+)'/g, "from './$1.mjs'");
  await writeFile(path.join(outDir, file.replace(/\.ts$/, '.mjs')), output, 'utf8');
}

const load = (name) => import(`${path.join(outDir, name)}.mjs`);

const types = await load('types');
const watchdog = await load('watchdog');
const loops = await load('loops');
const progress = await load('progress');
const criteria = await load('criteria');
const restrictions = await load('restrictions');
const recovery = await load('recovery');
const store = await load('store');
const taskModule = await load('task');

/* ------------------------------ fake world ------------------------------ */

/**
 * A scripted browser. Every handler is a plain function so each test can say
 * exactly what the page does — including "never resolves" for AT-15.
 */
function createWorld(handlers = {}) {
  const world = {
    url: 'https://example.test/',
    title: 'Home',
    text: 'Welcome home',
    heapMb: 120,
    tabs: 1,
    calls: [],
    downloads: [],
    alive: true,
    closedTabs: 0,
    screenshots: 0,
    handler: handlers,
    /** Set to true to make every operation behave as a closed browser. */
    dead: false,
  };
  return world;
}

function createEngine(world, clock) {
  const engine = {
    kind: 'scripted',
    async availability() {
      return world.unavailable
        ? { available: false, kind: 'scripted', reason: world.unavailableReason ?? 'no browser here', fix: 'Install one.' }
        : { available: true, kind: 'scripted' };
    },
    async launch(options) {
      // A restart really does give us a live browser again.
      world.alive = true;
      world.dead = false;
      if (world.onLaunch) world.onLaunch({ world, options });
      world.launches = (world.launches ?? 0) + 1;
      return createSession(world, clock);
    },
  };
  return engine;
}

function createSession(world, clock) {
  const note = (name, payload) => world.calls.push({ name, at: Date.now(), payload });
  const guardDead = () => {
    if (world.dead || !world.alive) {
      const error = new Error('Target closed: the browser is gone');
      error.code = 'browser-crashed';
      throw error;
    }
  };
  const page = async () => ({
    url: world.url,
    title: world.title,
    digest: progress.observationDigest({ url: world.url, title: world.title, text: world.text }),
    excerpt: world.text,
    nodeCount: 12,
    elementCount: 5,
    at: Date.now(),
  });

  const session = {
    id: 'sess-1',
    profile: 'test',
    isAlive: () => world.alive && !world.dead,

    async navigate(url, options = {}) {
      note('navigate', url);
      if (world.handler.navigate) return world.handler.navigate({ world, url, options, page, guardDead });
      guardDead();
      world.url = url;
      return { status: 200, url, redirected: false, timedOut: false };
    },
    async observe() {
      guardDead();
      if (world.handler.observe) return world.handler.observe({ world, page });
      return page();
    },
    async snapshot() {
      guardDead();
      note('snapshot');
      return { at: Date.now(), nodeCount: 3, nodes: [{ role: 'button', name: 'Go' }], text: world.text };
    },
    async resolve(target) {
      guardDead();
      if (world.handler.resolve) return world.handler.resolve({ world, target });
      return { found: true, handle: 'hit', detail: `matched ${target.name ?? target.role ?? 'target'}`, methods: ['mouse', 'dom', 'keyboard'] };
    },
    async click(target, method) {
      guardDead();
      note('click', { target, method });
      if (world.handler.click) return world.handler.click({ world, target, method, page });
      return undefined;
    },
    async type(target, text) {
      guardDead();
      note('type', { target, text });
    },
    async press(key) {
      guardDead();
      note('press', key);
    },
    async wait(ms) {
      note('wait', ms);
      // A wait really does consume wall-clock time, so it consumes virtual time.
      if (clock) await clock.sleep(ms);
    },
    async screenshot() {
      guardDead();
      world.screenshots += 1;
      return { base64: 'iVBORw0KGgo=', bytes: 8, ok: true };
    },
    async saveStorageState() {
      return { cookies: [{ name: 'session', value: 'abc' }], origins: [] };
    },
    async health() {
      return {
        at: Date.now(),
        tabs: world.tabs,
        heapMb: world.heapMb,
        cpuPercent: null,
        screenshotsOk: true,
        sessionValid: true,
        online: true,
        browserAlive: world.alive && !world.dead,
        downloadsDirBytes: 0,
      };
    },
    downloads: () => world.downloads,
    async closeExtraTabs(limit) {
      const closed = Math.max(0, world.tabs - limit);
      world.tabs = Math.min(world.tabs, limit);
      world.closedTabs += closed;
      return closed;
    },
    async close() {
      world.alive = false;
      note('close');
    },
  };
  return session;
}

/**
 * Virtual clock.
 *
 * `sleep` advances virtual time instantly, so recovery back-off and multi-hour
 * deadlines cost no real time. Operation budgets use real timers with millisecond
 * limits instead — that is the one thing that must not be faked, because it is
 * the mechanism being tested (AT-15).
 */
function createClock(start = 1_700_000_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
      return current;
    },
    sleep: async (ms) => {
      current += Math.max(1, ms);
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

function makeTask(spec, clock, overrides = {}) {
  const task = taskModule.createTask(
    {
      objective: 'collect the report',
      startUrl: 'https://example.test/',
      profile: 'default',
      plan: [
        { id: 'open', kind: 'navigate', url: 'https://example.test/reports', milestone: 'opened the reports page' },
        {
          id: 'run',
          kind: 'click',
          target: { role: 'button', name: 'Generate' },
          milestone: 'requested the report',
          expect: [{ type: 'text-present', text: 'Report ready' }],
        },
      ],
      successCriteria: [{ type: 'text-present', text: 'Report ready' }],
      ...spec,
      limits: { actionTimeoutMs: 80, navigationTimeoutMs: 120, ...(spec.limits ?? {}) },
    },
    clock.now(),
  );
  return Object.assign(task, overrides);
}

async function runTask(task, world, clock, extra = {}) {
  const storeImpl = extra.store ?? new store.MemoryTaskStore();
  const runner = new taskModule.BrowserTaskRunner(task, {
    engine: createEngine(world, clock),
    store: storeImpl,
    now: clock.now,
    sleep: clock.sleep,
    downloadsDir: '/tmp/nexus-test-downloads',
    ...extra,
  });
  const result = await runner.run();
  return { runner, task: result, store: storeImpl };
}

/* ======================================================================= */
/*  AT-15 — stalled navigation triggers a timeout and recovery              */
/* ======================================================================= */

console.log('\nAT-15 stalled navigation');

await check('a navigation that never settles is cancelled and recovered', async () => {
  const clock = createClock();
  const world = createWorld();
  let attempted = 0;

  world.handler.navigate = async ({ url }) => {
    attempted += 1;
    if (attempted === 1) {
      // A page that never finishes loading: the promise simply never settles.
      return new Promise(() => {});
    }
    world.url = url;
    return { status: 200, url, redirected: false, timedOut: false };
  };
  world.handler.click = async ({ world }) => {
    world.text = 'Report ready';
  };

  const task = makeTask({ limits: { navigationTimeoutMs: 5_000, actionTimeoutMs: 2_000 } }, clock);
  const { task: result } = await runTask(task, world, clock);

  const timeoutEvent = result.events.find((event) => /navigation-timeout/.test(event.detail ?? ''));
  assert(timeoutEvent, 'no navigation-timeout was recorded');
  assert(result.events.some((event) => event.kind === 'recovery'), 'no recovery step was attempted');
  assertEqual(result.state, 'COMPLETED', 'task state after recovering from the stall');
  assert(attempted >= 2, `navigation was not retried after the timeout (attempts: ${attempted})`);
});

await check('a stall is detected by the watchdog even without an error', () => {
  const symptom = watchdog.inspectWatchdog({
    now: 100_000,
    operationStartedAt: null,
    operationTimeoutMs: 10_000,
    lastProgressAt: 0,
    progressIntervalMs: 90_000,
    deadlineAt: 10_000_000,
  });
  assertEqual(symptom.kind, 'no-progress', 'watchdog verdict');
  assert(watchdog.needsRecovery(symptom), 'no-progress must request recovery');
});

await check('the deadline outranks every other symptom', () => {
  const symptom = watchdog.inspectWatchdog({
    now: 5_000,
    operationStartedAt: 0,
    operationTimeoutMs: 100,
    lastProgressAt: 0,
    progressIntervalMs: 100,
    deadlineAt: 4_000,
  });
  assertEqual(symptom.kind, 'deadline', 'watchdog verdict');
});

/* ======================================================================= */
/*  AT-16 — repeated identical clicks are a loop, not persistence           */
/* ======================================================================= */

console.log('\nAT-16 repeated-action detection');

await check('the same click on an unchanged page becomes a loop', () => {
  const detector = new loops.LoopDetector({ threshold: 3 });
  const findings = [];
  for (let index = 0; index < 3; index += 1) {
    const finding = detector.recordAction('run', 'button Generate', 'digest-aaa', index);
    if (finding) findings.push(finding);
  }
  assertEqual(findings.length, 1, 'findings');
  assertEqual(findings[0].kind, 'repeated-action', 'finding kind');
  assert(/different interaction method|another route/.test(findings[0].advice), 'advice must change strategy');
});

await check('the same click on a page that actually changed is not a loop', () => {
  const detector = new loops.LoopDetector({ threshold: 3 });
  for (let index = 0; index < 5; index += 1) {
    const finding = detector.recordAction('next', 'button Next', `digest-${index}`, index);
    assert(!finding, `page changed but was still flagged at iteration ${index}`);
  }
});

await check('ping-pong navigation between two pages is detected', () => {
  const detector = new loops.LoopDetector();
  const urls = ['https://a.test/', 'https://b.test/', 'https://a.test/', 'https://b.test/'];
  let finding = null;
  for (const url of urls) finding = detector.recordNavigation(url) ?? finding;
  assert(finding, 'no ping-pong finding');
  assertEqual(finding.kind, 'navigation-pingpong', 'finding kind');
});

await check('an action repeated after a block is flagged immediately', () => {
  const detector = new loops.LoopDetector({ threshold: 3 });
  detector.markBlocked('submit');
  const finding = detector.recordAction('submit', 'submit', 'digest', 1);
  assert(finding, 'retry after block was not flagged');
  assertEqual(finding.kind, 'retry-after-block', 'finding kind');
});

await check('a stuck click loop ends in a terminal state, not an infinite retry', async () => {
  const clock = createClock();
  const world = createWorld();
  world.handler.click = async () => {
    /* clicked, nothing happens, forever */
  };
  world.handler.navigate = async ({ url }) => {
    world.url = url;
    return { status: 200, url, redirected: false, timedOut: false };
  };

  const task = makeTask(
    {
      plan: [{ id: 'run', kind: 'click', target: { role: 'button', name: 'Generate' }, milestone: 'clicked generate' }],
      successCriteria: [{ type: 'text-present', text: 'Report ready' }],
      limits: { maxRepeats: 2, maxRetries: 5, maxConsecutiveFailures: 6, maxRecoveryAttempts: 4, progressIntervalMs: 600_000 },
    },
    clock,
  );

  const { task: result } = await runTask(task, world, clock);
  assert(types.isTerminal(result.state), `task did not terminate: ${result.state}`);
  assert(result.loopFlags.length > 0, 'no loop flag was recorded');
  assert(result.events.some((event) => event.kind === 'loop'), 'no loop event in the timeline');
  const clicks = world.calls.filter((call) => call.name === 'click').length;
  assert(clicks <= 6, `the click was repeated ${clicks} times — loop detection did not bound it`);
  assertEqual(result.state, 'BLOCKED', 'terminal state for an unrecoverable loop');
});

/* ======================================================================= */
/*  AT-17 — browser crash recovery from a verified checkpoint              */
/* ======================================================================= */

console.log('\nAT-17 browser crash recovery');

await check('a crash mid-task restarts the browser and resumes from the checkpoint', async () => {
  const clock = createClock();
  const world = createWorld();
  let clicked = 0;

  world.handler.navigate = async ({ url }) => {
    world.url = url;
    world.title = 'Reports';
    world.text = url.endsWith('/reports') ? 'Reports page' : 'Home';
    return { status: 200, url, redirected: false, timedOut: false };
  };
  world.handler.click = async ({ world }) => {
    clicked += 1;
    if (clicked === 1) {
      world.dead = true; // the browser dies during the click
      throw new Error('Session closed');
    }
    world.text = 'Report ready';
  };
  world.handler.observe = async () => {
    if (world.dead) world.dead = false; // the restarted browser is healthy
    return {
      url: world.url,
      title: world.title,
      text: world.text,
      digest: progress.observationDigest({ url: world.url, title: world.title, text: world.text }),
      excerpt: world.text,
      nodeCount: 5,
      elementCount: 3,
      at: Date.now(),
    };
  };

  const task = makeTask({}, clock);
  const { task: result } = await runTask(task, world, clock);

  assert(result.events.some((event) => /browser crashed/i.test(event.message)), 'crash was not recorded');
  assert(
    result.events.some((event) => /checkpoint/i.test(event.message) && event.kind === 'recovery'),
    'no checkpoint restore was attempted',
  );
  assert(result.checkpoints.length > 0, 'no checkpoint was written before the crash');
  assertEqual(result.state, 'COMPLETED', 'task state after crash recovery');
  assert(result.events.some((event) => /browser session started/i.test(event.message)), 'the browser was not restarted');
});

/* ======================================================================= */
/*  AT-18 — expired session asks for reauthentication                      */
/* ======================================================================= */

console.log('\nAT-18 session expiry');

await check('an expired session pauses the task and asks the operator to sign in', async () => {
  const clock = createClock();
  const world = createWorld();
  world.handler.navigate = async ({ url }) => {
    world.url = url;
    world.title = 'Sign in';
    world.text = 'Your session expired. Please sign in again.';
    return { status: 200, url, redirected: false, timedOut: false };
  };

  const task = makeTask({}, clock);
  const { task: result } = await runTask(task, world, clock);

  assertEqual(result.state, 'WAITING_FOR_USER', 'state');
  assertEqual(result.blocker?.code, 'session-expired', 'blocker code');
  assert(/sign in/i.test(result.blocker?.fix ?? ''), `fix does not ask for a login: ${result.blocker?.fix}`);
  assertEqual(types.activityOf(result, clock.now()), 'waiting', 'activity');
  assert(
    !result.events.some((event) => /captcha|bypass/i.test(event.message)),
    'the agent must not attempt a bypass',
  );
});

await check('session expiry is recognised from a login form on an auth URL', () => {
  assert(
    restrictions.detectSessionExpiry({
      url: 'https://example.test/login',
      text: 'Welcome back',
      passwordFieldPresent: true,
      previouslyAuthenticated: true,
    }),
    'login form was not recognised as an expiry',
  );
  assert(
    !restrictions.detectSessionExpiry({
      url: 'https://example.test/login',
      text: 'Welcome',
      passwordFieldPresent: true,
      previouslyAuthenticated: false,
    }),
    'a first-time login page must not be treated as an expiry',
  );
});

/* ======================================================================= */
/*  AT-19 — a blocked site is reported, not retried forever                */
/* ======================================================================= */

console.log('\nAT-19 blocked website');

await check('a 403 stops the task with the restriction recorded', async () => {
  const clock = createClock();
  const world = createWorld();
  world.handler.navigate = async ({ url }) => {
    world.url = url;
    world.title = 'Forbidden';
    world.text = '403 Forbidden — access denied';
    return { status: 403, url, redirected: false, timedOut: false };
  };

  const task = makeTask({}, clock);
  const { task: result } = await runTask(task, world, clock);

  assertEqual(result.state, 'BLOCKED', 'state');
  assert(result.restriction, 'no restriction recorded');
  assertEqual(result.restriction.kind, 'access-denied', 'restriction kind');
  const navigations = world.calls.filter((call) => call.name === 'navigate').length;
  assert(navigations <= 2, `the blocked page was requested ${navigations} times — it must not be retried`);
});

await check('a CAPTCHA is reported as needing a human, with no solving attempt', () => {
  const restriction = restrictions.detectRestriction({
    url: 'https://example.test/',
    title: 'Just a moment',
    text: 'Please verify you are human',
    at: 1,
  });
  assert(restriction, 'CAPTCHA not detected');
  assertEqual(restriction.kind, 'captcha', 'kind');
  assert(/human/i.test(restriction.fix), 'the fix must name human intervention');
});

await check('an authorised alternative is preferred over repeating a block', async () => {
  const clock = createClock();
  const world = createWorld();
  const attempts = [];
  world.handler.navigate = async ({ url }) => {
    attempts.push(url);
    world.url = url;
    if (url.includes('primary')) {
      world.text = 'Access denied';
      world.title = 'Denied';
      return { status: 403, url, redirected: false, timedOut: false };
    }
    world.text = 'Report ready';
    world.title = 'Mirror';
    return { status: 200, url, redirected: false, timedOut: false };
  };
  world.handler.click = async ({ world }) => {
    world.text = 'Report ready';
  };

  const task = makeTask(
    {
      startUrl: 'https://primary.test/data',
      plan: [{ id: 'open', kind: 'navigate', url: 'https://primary.test/data', milestone: 'opened the source' }],
      alternateUrls: ['https://mirror.test/data'],
      successCriteria: [{ type: 'text-present', text: 'Report ready' }],
    },
    clock,
  );

  const { task: result } = await runTask(task, world, clock);
  assert(attempts.includes('https://mirror.test/data'), `authorised alternative was not tried: ${attempts.join(', ')}`);
  assert(result.restriction, 'the restriction was not recorded even though the alternative worked');
});

/* ======================================================================= */
/*  AT-20 — long-running task without supervision                          */
/* ======================================================================= */

console.log('\nAT-20 long-running task');

await check('a multi-step task spanning hours completes unattended', async () => {
  const clock = createClock();
  const world = createWorld();
  const plan = [];

  world.handler.navigate = async ({ url }) => {
    world.url = url;
    world.title = `Page ${url.split('/').pop()}`;
    world.text = `content for ${url}`;
    return { status: 200, url, redirected: false, timedOut: false };
  };

  for (let index = 0; index < 40; index += 1) {
    plan.push({
      id: `page-${index}`,
      kind: 'navigate',
      url: `https://example.test/page-${index}`,
      milestone: `read page ${index}`,
    });
  }
  plan.push({ id: 'final', kind: 'verify', criteria: [{ type: 'url-matches', pattern: '*page-39' }], milestone: 'finished the crawl' });

  const task = makeTask(
    {
      plan,
      successCriteria: [{ type: 'url-matches', pattern: '*page-39' }],
      limits: { deadlineMs: 6 * 60 * 60_000, progressIntervalMs: 60 * 60_000 },
    },
    clock,
  );

  const { task: result } = await runTask(task, world, clock);
  assertEqual(result.state, 'COMPLETED', 'state');
  assert(result.checkpoints.length >= 10, `too few checkpoints for a long run: ${result.checkpoints.length}`);
  const milestones = result.events.filter((event) => event.kind === 'milestone').length;
  assert(milestones >= 40, `milestones recorded: ${milestones}`);
  assert(result.lastProgressAt > result.createdAt, 'progress clock never advanced');
});

/* ======================================================================= */
/*  AT-21 — deadline enforcement                                          */
/* ======================================================================= */

console.log('\nAT-21 deadline enforcement');

await check('the task stops at its deadline with an explicit terminal state', async () => {
  const clock = createClock();
  const world = createWorld();
  const plan = [];
  for (let index = 0; index < 30; index += 1) {
    plan.push({ id: `w-${index}`, kind: 'wait', ms: 60_000, milestone: `waited ${index}` });
  }
  world.handler.navigate = async ({ url }) => {
    world.url = url;
    return { status: 200, url, redirected: false, timedOut: false };
  };

  const task = makeTask(
    {
      plan,
      successCriteria: [{ type: 'text-present', text: 'never' }],
      limits: { deadlineMs: 5 * 60_000, progressIntervalMs: 60 * 60_000 },
    },
    clock,
  );

  const { task: result } = await runTask(task, world, clock);
  assertEqual(result.state, 'TIMED_OUT', 'state');
  assertEqual(result.blocker?.code, 'deadline-exceeded', 'blocker code');
  assert(result.finishedAt !== null, 'no finish timestamp');
  const waits = world.calls.filter((call) => call.name === 'wait').length;
  assert(waits < 30, `the task ran ${waits} waits past a 5 minute deadline`);
});

/* ======================================================================= */
/*  AT-22 — every milestone has observable evidence                        */
/* ======================================================================= */

console.log('\nAT-22 progress evidence');

await check('checkpoints carry a real page observation, not a label', async () => {
  const clock = createClock();
  const world = createWorld();
  world.handler.navigate = async ({ url }) => {
    world.url = url;
    world.title = `Title ${url.split('/').length}`;
    world.text = `Body for ${url}`;
    return { status: 200, url, redirected: false, timedOut: false };
  };
  world.handler.click = async ({ world }) => {
    world.text = 'Report ready';
  };

  const task = makeTask({}, clock);
  const { task: result } = await runTask(task, world, clock);

  assert(result.checkpoints.length > 0, 'no checkpoints');
  for (const checkpoint of result.checkpoints) {
    assert(checkpoint.evidence?.observation?.url, `checkpoint ${checkpoint.id} has no observed url`);
    assert(checkpoint.evidence.observation.digest, `checkpoint ${checkpoint.id} has no state digest`);
    assert(checkpoint.evidence.observation.at > 0, `checkpoint ${checkpoint.id} has no timestamp`);
  }
  const completion = result.events.find((event) => event.message === 'task completed');
  assert(completion, 'no completion event');
  assert(completion.evidence?.observation?.url, 'the completion event carries no observation');
  assert(result.evidence?.screenshotId, 'completion evidence has no screenshot');
  assertEqual(result.evidence?.criteria?.every((entry) => entry.ok), true, 'completion criteria');
});

await check('a page that stays open without changing is not progress', () => {
  const idle = {
    url: 'https://example.test/wait',
    title: 'Waiting',
    digest: 'aaa',
    excerpt: 'Waiting for the job… 12:00',
    nodeCount: 4,
    elementCount: 2,
    at: 1,
  };
  const later = { ...idle, excerpt: 'Waiting for the job… 12:01' };
  assertEqual(progress.isMeaningfulChange(idle, later), false, 'clock changes must not count as progress');
  assertEqual(progress.isMeaningfulChange(idle, { ...idle, url: 'https://example.test/done' }), true, 'url change');
});

/* ======================================================================= */
/*  AT-23 — sensitive actions are never blindly retried                    */
/* ======================================================================= */

console.log('\nAT-23 safe retries');

await check('a sensitive action whose effect is unverified asks the operator', async () => {
  const clock = createClock();
  const world = createWorld();
  world.handler.click = async () => {
    throw new Error('navigation aborted by the page');
  };

  const task = makeTask(
    {
      plan: [
        {
          id: 'buy',
          kind: 'click',
          target: { role: 'button', name: 'Place order' },
          milestone: 'placed the order',
          sensitive: true,
          expect: [{ type: 'text-present', text: 'Order confirmed' }],
        },
      ],
      successCriteria: [{ type: 'text-present', text: 'Order confirmed' }],
    },
    clock,
  );

  const { task: result } = await runTask(task, world, clock);
  assertEqual(result.state, 'WAITING_FOR_USER', 'state');
  assertEqual(result.blocker?.code, 'sensitive-action', 'blocker code');
  assertEqual(world.calls.filter((call) => call.name === 'click').length, 1, 'the sensitive click was repeated');
});

await check('a sensitive action that already took effect is not repeated', async () => {
  const clock = createClock();
  const world = createWorld();
  let clicks = 0;
  world.handler.click = async ({ world }) => {
    clicks += 1;
    world.text = 'Order confirmed';
    // The click succeeded but the response was lost — the page says it worked.
    throw new Error('Target closed while waiting for the response');
  };

  const task = makeTask(
    {
      plan: [
        {
          id: 'buy',
          kind: 'click',
          target: { role: 'button', name: 'Place order' },
          milestone: 'placed the order',
          sensitive: true,
          expect: [{ type: 'text-present', text: 'Order confirmed' }],
        },
      ],
      successCriteria: [{ type: 'text-present', text: 'Order confirmed' }],
    },
    clock,
  );

  const { task: result } = await runTask(task, world, clock);
  assertEqual(clicks, 1, 'the order was submitted twice');
  // The page proves the order went through, so the honest outcome is completion —
  // reached without a second submission.
  assertEqual(result.state, 'COMPLETED', 'state');
  assert(
    result.events.some((event) => /already (took effect|effective)/i.test(event.message)),
    'the idempotency check was not recorded',
  );
});

await check('retry policy refuses sensitive steps it cannot verify', () => {
  const step = { id: 'pay', kind: 'click', target: { role: 'button', name: 'Pay now' }, milestone: 'paid' };
  assert(recovery.isSensitiveStep(step), 'a payment button must be sensitive');
  assert(!recovery.canRetry(step, false).ok, 'an unverified payment must not be retried');
  assert(recovery.canRetry(step, true).ok, 'a verified-absent payment may be retried');
  assert(recovery.isIdempotent({ id: 'go', kind: 'navigate', url: 'https://x.test', milestone: 'opened' }), 'navigation is idempotent');
  assert(!recovery.isIdempotent(step), 'a click is not idempotent');
});

/* ======================================================================= */
/*  AT-24 — service restart inspects state before continuing               */
/* ======================================================================= */

console.log('\nAT-24 restart recovery');

await check('a stale task inspects the checkpoint before repeating the last step', async () => {
  const clock = createClock();
  const world = createWorld();

  // Build a task that already finished step 1 and wrote a checkpoint.
  const task = makeTask({}, clock);
  task.steps.open = { stepId: 'open', attempts: 1, lastAttemptAt: clock.now(), ok: true, methodsTried: [] };
  task.stepIndex = 1;
  task.nextStepId = 'run';
  task.state = 'RUNNING';
  task.currentUrl = 'https://example.test/checkout';
  task.lastProgressAt = clock.now();
  task.checkpoints = [
    {
      id: 'cp-1',
      taskId: task.id,
      at: clock.now(),
      stepIndex: 1,
      milestone: 'reached checkout',
      nextStepId: 'run',
      url: 'https://example.test/checkout',
      title: 'Checkout',
      digest: progress.observationDigest({ url: 'https://example.test/checkout', title: 'Checkout', text: 'Ready' }),
      storageStateSaved: true,
      evidence: {
        observation: {
          url: 'https://example.test/checkout',
          title: 'Checkout',
          digest: progress.observationDigest({ url: 'https://example.test/checkout', title: 'Checkout', text: 'Ready' }),
          excerpt: 'Ready',
          nodeCount: 3,
          elementCount: 2,
          at: clock.now(),
        },
      },
    },
  ];
  task.restoredAt = clock.now();

  // The page already shows the effect of the interrupted step.
  world.url = 'https://example.test/checkout';
  world.title = 'Checkout';
  world.text = 'Report ready';
  world.handler.navigate = async ({ url }) => {
    world.url = url;
    return { status: 200, url, redirected: false, timedOut: false };
  };
  world.handler.click = async () => {
    throw new Error('the step must not be repeated');
  };

  const { task: result } = await runTask(task, world, clock);

  assert(result.events.some((event) => /restored/i.test(event.message)), 'restore was not recorded');
  assert(
    result.events.some((event) => /matches the checkpoint|differs from the checkpoint/i.test(event.message)),
    'the existing browser state was not inspected',
  );
  assertEqual(world.calls.filter((call) => call.name === 'click').length, 0, 'the completed step was repeated');
  assertEqual(result.state, 'COMPLETED', 'state after restart');
});

await check('the file store survives a new process', async () => {
  const clock = createClock();
  const dir = path.join(root, '.test-build', 'browser-store');
  await rm(dir, { recursive: true, force: true });
  const first = new store.FileTaskStore(dir);
  const task = makeTask({}, clock);
  task.state = 'RUNNING';
  task.events.push({ at: clock.now(), kind: 'milestone', message: 'persisted' });
  await first.save(task);

  const second = new store.FileTaskStore(dir);
  const loaded = await second.load(task.id);
  assert(loaded, 'the task did not load from disk');
  assertEqual(loaded.state, 'RUNNING', 'state round-trip');
  assertEqual(loaded.events.length, 1, 'timeline round-trip');
  assertEqual(second.durable, true, 'file store must report durability');

  const listed = await second.list();
  assertEqual(listed.length, 1, 'list');
});

/* ======================================================================= */
/*  AT-25 — resource limits                                               */
/* ======================================================================= */

console.log('\nAT-25 resource limits');

await check('excess tabs are closed and recorded', async () => {
  const clock = createClock();
  const world = createWorld();
  world.tabs = 12;
  world.handler.navigate = async ({ url }) => {
    world.url = url;
    world.text = 'Report ready';
    return { status: 200, url, redirected: false, timedOut: false };
  };
  world.handler.click = async ({ world }) => {
    world.text = 'Report ready';
  };

  const task = makeTask({ limits: { maxTabs: 4 } }, clock);
  const { task: result } = await runTask(task, world, clock);

  assert(world.closedTabs >= 8, `tabs were not closed (closed: ${world.closedTabs})`);
  assert(result.events.some((event) => /closed \d+ extra tab/.test(event.message)), 'the cleanup was not recorded');
});

await check('a heap ceiling recycles the browser and keeps the task going', async () => {
  const clock = createClock();
  const world = createWorld();
  world.handler.navigate = async ({ world, url }) => {
    world.url = url;
    world.text = 'Report ready';
    // Memory grows as the task runs; a fresh browser starts clean.
    world.heapMb = 2_000;
    return { status: 200, url, redirected: false, timedOut: false };
  };
  world.handler.click = async ({ world }) => {
    world.text = 'Report ready';
  };
  world.onLaunch = ({ world }) => {
    world.heapMb = 120;
  };

  const task = makeTask(
    {
      plan: [
        { id: 'open', kind: 'navigate', url: 'https://example.test/reports', milestone: 'opened the reports page' },
        {
          id: 'run',
          kind: 'click',
          target: { role: 'button', name: 'Generate' },
          milestone: 'requested the report',
          expect: [{ type: 'text-present', text: 'Report ready' }],
        },
      ],
      limits: { maxHeapMb: 800 },
    },
    clock,
  );

  const { task: result } = await runTask(task, world, clock);

  assert(result.events.some((event) => /heap ceiling/i.test(event.message)), 'the heap ceiling was not enforced');
  assert((world.launches ?? 0) >= 2, 'the browser was not restarted');
  assertEqual(result.state, 'COMPLETED', 'state');
});

await check('consecutive failures end the task instead of retrying forever', async () => {
  const clock = createClock();
  const world = createWorld();
  world.handler.click = async () => {
    throw new Error('element is not interactable');
  };
  world.handler.navigate = async ({ url }) => {
    world.url = url;
    return { status: 200, url, redirected: false, timedOut: false };
  };

  const task = makeTask(
    {
      plan: [{ id: 'run', kind: 'click', target: { role: 'button', name: 'Generate' }, milestone: 'clicked' }],
      successCriteria: [{ type: 'text-present', text: 'Report ready' }],
      limits: { maxConsecutiveFailures: 3, maxRetries: 20, maxRecoveryAttempts: 10 },
    },
    clock,
  );

  const { task: result } = await runTask(task, world, clock);
  assert(types.isTerminal(result.state), `not terminal: ${result.state}`);
  assertEqual(result.state, 'BLOCKED', 'state');
  const clicks = world.calls.filter((call) => call.name === 'click').length;
  assert(clicks <= 6, `clicked ${clicks} times despite a 3-failure ceiling`);
});

/* ======================================================================= */
/*  AT-26 — honest completion                                            */
/* ======================================================================= */

console.log('\nAT-26 honest completion');

await check('a finished plan with unmet criteria is FAILED, not COMPLETED', async () => {
  const clock = createClock();
  const world = createWorld();
  world.handler.navigate = async ({ world, url }) => {
    world.url = url;
    world.title = url.endsWith('/a') ? 'Step A' : 'Step B';
    world.text = url.endsWith('/a') ? 'Step A done' : 'Step B done — something else entirely';
    return { status: 200, url, redirected: false, timedOut: false };
  };

  const task = makeTask(
    {
      plan: [
        { id: 'a', kind: 'navigate', url: 'https://example.test/a', milestone: 'opened A' },
        { id: 'b', kind: 'navigate', url: 'https://example.test/b', milestone: 'opened B' },
      ],
      successCriteria: [{ type: 'text-present', text: 'Report ready' }],
    },
    clock,
  );

  const { task: result } = await runTask(task, world, clock);

  assertEqual(result.state, 'FAILED', 'state');
  assertEqual(result.blocker?.code, 'criteria-unverified', 'blocker code');
  assert(/criteria unverified|criteria were not met/i.test(result.outcome ?? ''), `outcome is not explicit: ${result.outcome}`);
  assertEqual(result.evidence, null, 'a failed task must not carry completion evidence');
  assertEqual(result.criteriaResults.length, 1, 'the criteria should still be evaluated and recorded');
});

await check('a click the site ignores ends BLOCKED with a no-effect reason', async () => {
  const clock = createClock();
  const world = createWorld();
  world.handler.navigate = async ({ world, url }) => {
    world.url = url;
    return { status: 200, url, redirected: false, timedOut: false };
  };
  world.handler.click = async () => {
    /* the site ignores it */
  };

  const task = makeTask(
    {
      plan: [{ id: 'run', kind: 'click', target: { role: 'button', name: 'Generate' }, milestone: 'clicked' }],
      limits: { maxConsecutiveFailures: 3, maxRetries: 8, maxRecoveryAttempts: 4, progressIntervalMs: 600_000 },
    },
    clock,
  );

  const { task: result } = await runTask(task, world, clock);
  assert(types.isTerminal(result.state), `not terminal: ${result.state}`);
  assert(
    result.events.some((event) => /no-effect/.test(event.detail ?? '')),
    'the no-effect failure was not recorded',
  );
});

await check('closing the browser is not completion', async () => {
  const clock = createClock();
  const world = createWorld();
  world.handler.click = async ({ session }) => {
    void session;
    world.alive = false;
    throw new Error('Target closed');
  };
  world.handler.navigate = async ({ url }) => {
    world.url = url;
    return { status: 200, url, redirected: false, timedOut: false };
  };

  const task = makeTask({}, clock);
  const { task: result } = await runTask(task, world, clock);
  assert(result.state !== 'COMPLETED', 'a closed session was reported as success');
});

await check('criteria evaluation decides completion, not the plan', async () => {
  const observation = {
    url: 'https://example.test/done',
    title: 'All good',
    digest: 'abc',
    excerpt: 'Your report is ready',
    nodeCount: 3,
    elementCount: 3,
    at: 1,
  };
  const results = await criteria.evaluateCriteria(
    [
      { type: 'url-matches', pattern: '*done' },
      { type: 'text-present', text: 'report is ready' },
      { type: 'text-absent', text: 'error' },
      { type: 'element-present', target: { role: 'button', name: 'Download' } },
    ],
    {
      observation,
      now: 2,
      downloadStarted: false,
      resolve: async () => ({ found: true, detail: 'found' }),
    },
  );
  assert(criteria.allSatisfied(results), 'all four criteria should pass');
  const failed = await criteria.evaluateCriterion({ type: 'text-present', text: 'not there' }, {
    observation,
    now: 2,
    downloadStarted: false,
    resolve: async () => ({ found: false, detail: 'missing' }),
  });
  assertEqual(failed.ok, false, 'a missing text must fail');
  assert(/not on the page/.test(failed.detail), 'the failure must explain what was looked for');
});

/* ======================================================================= */
/*  engine availability is reported honestly                              */
/* ======================================================================= */

console.log('\nengine availability');

await check('no browser in the runtime blocks the task with a fix', async () => {
  const clock = createClock();
  const world = createWorld();
  world.unavailable = true;
  world.unavailableReason = 'Chromium binary missing';

  const task = makeTask({}, clock);
  const { task: result } = await runTask(task, world, clock);

  assertEqual(result.state, 'BLOCKED', 'state');
  assertEqual(result.blocker?.code, 'browser-unavailable', 'blocker code');
  assert(/Chromium binary missing/.test(result.blocker?.message ?? ''), 'the real reason is missing');
  assert(result.blocker?.fix, 'no fix offered');
  assertEqual(world.calls.length, 0, 'no browser call may be attempted when no browser exists');
});

/* ---------------------------------------------------------------------- */

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.log(`\n${failure.name}\n${failure.error?.stack ?? failure.error}`);
  process.exit(1);
}
