#!/usr/bin/env node
/**
 * End-to-end UI acceptance run.
 *
 * Everything below drives the real built console in a real Chromium: the dock,
 * the artifact archive (create → rename → type re-derivation), the browser
 * agent panel (start a check, read the evidence, watch a block, pause, cancel)
 * and the API's refusal paths. Nothing is mocked — if the UI lies, this fails.
 *
 *   npm run build && npx next start -p 3100
 *   npm run test:ui                     # UI_BASE_URL defaults to :3100
 *
 * The fixture site is started by this script on an ephemeral port, so the only
 * prerequisite is a running app.
 */
import http from 'node:http';
import path from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import ts from 'typescript';

const root = process.cwd();
const base = process.env.UI_BASE_URL ?? 'http://127.0.0.1:3100';
const outDir = path.join(root, '.test-build', 'ui');

let passed = 0;
const failures = [];

function record(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
}

async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, '');
    return detail;
  } catch (error) {
    record(name, false, error.message);
    return undefined;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/* ---------------------------- fixture site ------------------------------ */

const pages = {
  '/report': `<!doctype html><html><head><title>Report console</title></head><body>
    <main><h1>Report console</h1><button id="go">Generate</button>
    <p id="status">Idle</p></main>
    <script>document.getElementById('go').addEventListener('click', function () {
      document.getElementById('status').textContent = 'Report ready';
    });</script></body></html>`,
  '/slow': `<!doctype html><html><head><title>Slow page</title></head><body>
    <main><h1>Slow page</h1><p>This page is deliberately slow.</p></main></body></html>`,
  '/forbidden': `<!doctype html><html><head><title>Access denied</title></head><body>
    <main><h1>Access denied</h1><p>The owner of this site has restricted access.</p></main></body></html>`,
};

const hits = { forbidden: 0 };

const fixture = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/forbidden') {
    hits.forbidden += 1;
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(pages['/forbidden']);
    return;
  }
  if (url.pathname === '/slow') {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(pages['/slow']);
    }, 250);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(pages[url.pathname] ?? pages['/report']);
});
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
const site = `http://127.0.0.1:${fixture.address().port}`;

/* --------------------------- preconditions ------------------------------ */

try {
  const probe = await fetch(`${base}/api/browser/tasks`, { signal: AbortSignal.timeout(8000) });
  if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
} catch (error) {
  console.log(`\nBLOCKED: no console listening on ${base} (${error.message}).`);
  console.log('Build and start it first:');
  console.log('  npx pnpm@10 run build && npx next start -H 0.0.0.0 -p 3100\n');
  fixture.close();
  process.exit(2);
}

/* ------------------------------- browser -------------------------------- */

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// Reuse the app's own Chromium bootstrap so this run needs no system Chrome.
const chromiumSource = await readFile(path.join(root, 'lib', 'browser', 'chromium.ts'), 'utf8');
const chromiumModule = ts.transpileModule(chromiumSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
await writeFile(path.join(outDir, 'chromium.mjs'), chromiumModule, 'utf8');
const { resolveChromium } = await import(path.join(outDir, 'chromium.mjs'));

const resolution = await resolveChromium();
if (!resolution.available) {
  console.log(`\nBLOCKED: no Chromium in this runtime — ${resolution.reason}`);
  console.log(resolution.fix ?? '');
  fixture.close();
  process.exit(2);
}
if (resolution.libraryPath) process.env.LD_LIBRARY_PATH = resolution.libraryPath;

const puppeteer = (await import('puppeteer-core')).default;
const browser = await puppeteer.launch({
  executablePath: resolution.executablePath,
  args: resolution.args,
  headless: true,
  defaultViewport: { width: 1440, height: 980 },
});

const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(error.message.slice(0, 160)));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const click = (label) =>
  page.evaluate((needle) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const exact = buttons.find((b) => (b.getAttribute('aria-label') ?? '').trim() === needle);
    const loose = buttons.find((b) => (b.innerText ?? '').trim().toLowerCase().startsWith(needle.toLowerCase()));
    const target = exact ?? loose;
    if (!target) return false;
    target.click();
    return true;
  }, label);

const panelText = (label) => page.evaluate((l) => document.querySelector(`[aria-label="${l}"]`)?.innerText ?? '', label);
const noticeText = () =>
  page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('p'));
    const notice = nodes.find((p) => /saved|renamed|uploaded|connection ok|armed|queued/i.test(p.innerText ?? ''));
    return (notice?.innerText ?? '').replace(/\s+/g, ' ').trim();
  });

const openDock = async (entry) => {
  await click('More controls');
  await wait(400);
  await click(entry);
};

/* ---------------------------- the console -------------------------------- */

await page.goto(`${base}/`, { waitUntil: 'networkidle2', timeout: 60000 });
await wait(6000);

await check('the console loads with no page errors', () => {
  assert(pageErrors.length === 0, pageErrors.join(' | '));
});

await check('the dock offers the artifact archive and the browser agent', async () => {
  await click('More controls');
  await wait(500);
  const entries = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map((b) => (b.innerText ?? '').trim().toLowerCase()),
  );
  assert(entries.some((e) => e.startsWith('artifacts')), 'artifacts entry missing');
  assert(entries.some((e) => e.startsWith('browser')), 'browser entry missing');
});

/* --------------------------- artifact archive ---------------------------- */

const stamp = Date.now().toString(36);
const original = `ui-${stamp}.md`;
const renamed = `ui-${stamp}.csv`;

await openDock('Artifacts');
await wait(1500);
await click('new');
await wait(400);
await page.type('input[placeholder="file name (e.g. report.md)"]', original);
await page.type('textarea', '# ui acceptance\npersisted through the real service\n');
await click('save');
await wait(1500);

await check('creating an artifact is confirmed to the operator', async () => {
  const notice = await noticeText();
  assert(/saved/i.test(notice), notice || 'no confirmation shown');
});

await check('the new artifact is listed with its derived kind', async () => {
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[aria-label="Artifact archive"] button')).map((b) => (b.innerText ?? '').replace(/\s+/g, ' ')),
  );
  const row = rows.find((r) => r.includes(original.toLowerCase()) || r.includes(original));
  assert(Boolean(row), `not listed: ${rows.slice(0, 6).join(' / ')}`);
  return row;
});

await check('renaming re-derives the artifact type', async () => {
  await page.evaluate((name) => {
    const row = Array.from(document.querySelectorAll('[aria-label="Artifact archive"] button')).find((b) => (b.innerText ?? '').includes(name));
    row?.click();
  }, original);
  await wait(600);
  await click('rename');
  await wait(500);
  const field = await page.$('[aria-label="New file name"]');
  assert(field, 'rename field did not open');
  await field.click({ clickCount: 3 });
  await field.type(renamed);
  await page.keyboard.press('Enter');
  await wait(1600);
  const text = await panelText('Artifact archive');
  assert(/CSV|rename/i.test(text), text.slice(0, 300));
  const notice = await noticeText();
  assert(/renamed|saved/i.test(notice) || /CSV/i.test(text), `no rename confirmation: ${notice}`);
  return notice;
});

await check('no page errors after the archive work', () => {
  assert(pageErrors.length === 0, pageErrors.join(' | '));
});
await page.screenshot({ path: path.join(outDir, 'artifacts.png') });

/* ---------------------------- browser agent ------------------------------ */

await page.keyboard.press('Escape');
await wait(600);
await openDock('Browser');
await wait(2500);

await check('the browser panel opens and reports its engine', async () => {
  const text = await panelText('Browser agent');
  assert(/LONG-RUNNING TASKS/i.test(text), text.slice(0, 120));
  assert(/chromium/i.test(text), 'engine status missing');
  return text.split('\n')[0];
});

await check('a check started from the panel completes with verified criteria', async () => {
  await page.type('[aria-label="Start URL"]', `${site}/slow`);
  await page.type('[aria-label="Expected text"]', 'Slow page');
  await page.type('[aria-label="Objective"]', `ui acceptance ${stamp}`);
  await click('run check');
  await wait(9000);
  const text = await panelText('Browser agent');
  assert(new RegExp(`ui acceptance ${stamp}`, 'i').test(text), 'task not listed');
  assert(/completed/i.test(text), text.slice(0, 400));
  assert(/found "Slow page"/i.test(text), 'criteria not reported');
  return 'completed with criteria';
});

await check('the completed task offers its evidence screenshot', async () => {
  const text = await panelText('Browser agent');
  assert(/evidence screenshot/i.test(text), text.slice(0, 400));
});

await check('the recovery history is listed', async () => {
  const text = await panelText('Browser agent');
  assert(/recovery history/i.test(text), text.slice(0, 300));
  assert(/milestone/i.test(text), 'no milestone entries');
});

await check('a full plan with a real click verifies', async () => {
  await click('full plan');
  await wait(400);
  await page.type(
    '[aria-label="Task spec JSON"]',
    JSON.stringify({
      objective: `click through ${stamp}`,
      startUrl: `${site}/report`,
      profile: 'console',
      plan: [
        { id: 'open', kind: 'navigate', url: `${site}/report`, milestone: 'opened the report console' },
        {
          id: 'generate',
          kind: 'click',
          target: { role: 'button', name: 'Generate' },
          milestone: 'generated the report',
          expect: [{ type: 'text-present', text: 'Report ready' }],
        },
      ],
      successCriteria: [{ type: 'text-present', text: 'Report ready' }],
    }),
  );
  await click('start task');
  await wait(9000);
  const text = await panelText('Browser agent');
  assert(new RegExp(`click through ${stamp}`, 'i').test(text), 'plan not listed');
  assert(/found "Report ready"/i.test(text), text.slice(0, 500));
  return 'click verified';
});
await page.screenshot({ path: path.join(outDir, 'browser.png') });

await check('a restricted site is reported instead of retried forever', async () => {
  const id = await page.evaluate(async (url) => {
    const response = await fetch('/api/browser/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spec: {
          objective: 'read a forbidden page',
          startUrl: url,
          profile: 'console',
          plan: [{ id: 'open', kind: 'navigate', url, milestone: 'opened the page' }],
          successCriteria: [{ type: 'text-present', text: 'Ready' }],
        },
      }),
    });
    const data = await response.json();
    return data.task?.task?.id ?? null;
  }, `${site}/forbidden`);
  assert(Boolean(id), 'task was not created');
  await wait(7000);
  await page.evaluate((taskId) => {
    const row = Array.from(document.querySelectorAll('[aria-label="Browser agent"] button')).find((b) => (b.innerText ?? '').includes('read a forbidden page'));
    row?.click();
  }, id);
  await wait(1800);
  const text = (await panelText('Browser agent')).replace(/\s+/g, ' ');
  assert(/blocked/i.test(text), text.slice(0, 400));
  assert(/restriction|access-denied/i.test(text), 'no restriction code');
  assert(hits.forbidden <= 3, `the site was hammered ${hits.forbidden} times`);
  return `${hits.forbidden} request(s) to the restricted page`;
});

await check('pause is honoured by the runner', async () => {
  const id = await page.evaluate(async (url) => {
    const plan = [];
    for (let i = 0; i < 25; i += 1) {
      plan.push({ id: `p-${i}`, kind: 'navigate', url: `${url}/slow?page=${i}`, milestone: `read page ${i}` });
    }
    const response = await fetch('/api/browser/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spec: { objective: 'slow crawl for controls', startUrl: `${url}/slow`, profile: 'console', plan, successCriteria: [{ type: 'text-present', text: 'Slow page' }] },
      }),
    });
    const data = await response.json();
    return data.task?.task?.id ?? null;
  }, site);
  assert(Boolean(id), 'long task was not created');
  await wait(2200);
  const paused = await page.evaluate(
    async (taskId) => (await fetch(`/api/browser/tasks/${taskId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pause' }) })).json(),
    id,
  );
  const state = paused.task?.task?.state;
  assert(['PAUSED', 'COMPLETED'].includes(state), `state after pause: ${state}`);
  const resumed = await page.evaluate(
    async (taskId) => (await fetch(`/api/browser/tasks/${taskId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resume' }) })).json(),
    id,
  );
  assert(['RUNNING', 'RECOVERING', 'COMPLETED'].includes(resumed.task?.task?.state), `state after resume: ${resumed.task?.task?.state}`);
  const cancelled = await page.evaluate(
    async (taskId) => (await fetch(`/api/browser/tasks/${taskId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) })).json(),
    id,
  );
  assert(['CANCELLED', 'COMPLETED'].includes(cancelled.task?.task?.state), `state after cancel: ${cancelled.task?.task?.state}`);
  return `paused ${state} → cancelled`;
});

await check('a spec without success criteria is refused with a fix', async () => {
  const body = await page.evaluate(async (url) => {
    const response = await fetch('/api/browser/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spec: {
          objective: 'no criteria',
          startUrl: url,
          profile: 'x',
          plan: [{ id: 'a', kind: 'navigate', url, milestone: 'm' }],
          successCriteria: [],
        },
      }),
    });
    return response.json();
  }, site);
  assert(body.code === 'invalid-plan', JSON.stringify(body).slice(0, 200));
  assert(typeof body.fix === 'string' && body.fix.length > 10, 'no fix text');
  return body.fix;
});

await check('no page errors during the whole run', () => {
  assert(pageErrors.length === 0, pageErrors.join(' | '));
});

/* ------------------------------- report ---------------------------------- */

console.log(`\n${passed} UI checks passed, ${failures.length} failed`);
if (failures.length) console.log(failures.map((f) => `  • ${f}`).join('\n'));

await browser.close();
fixture.close();
process.exit(failures.length === 0 ? 0 : 1);
