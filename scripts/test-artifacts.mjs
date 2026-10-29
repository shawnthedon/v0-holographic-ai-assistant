#!/usr/bin/env node
/**
 * Executed tests for the artifact + FTP guard layer.
 *
 * These run the real source files (transpiled with the project's TypeScript),
 * not reimplementations. The interesting cases are hostile: path traversal,
 * Windows separators, percent-encoded traversal, newline injection into FTP
 * commands, oversized batches, and agent output that must NOT become a file.
 *
 *   npm run test:artifacts
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const outDir = path.join(root, '.test-build', 'artifacts');

const sources = [
  ['artifacts', 'types.ts'],
  ['artifacts', 'classify.ts'],
  ['artifacts', 'extract.ts'],
  ['ftp', 'types.ts'],
  ['ftp', 'guard.ts'],
  ['offline', 'db.ts'],
  ['offline', 'queue.ts'],
];

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
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
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertThrows(fn, matcher, label) {
  try {
    fn();
  } catch (error) {
    if (matcher && !matcher(error)) throw new Error(`${label}: wrong error — ${error.message}`);
    return error;
  }
  throw new Error(`${label}: expected a throw`);
}

/* ------------------------- transpile the sources ------------------------- */

await rm(path.join(root, '.test-build'), { recursive: true, force: true });

for (const [dir, file] of sources) {
  const target = path.join(outDir, dir);
  await mkdir(target, { recursive: true });
  const source = await import('node:fs/promises').then((fs) =>
    fs.readFile(path.join(root, 'lib', dir, file), 'utf8'),
  );
  let output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  output = output.replace(/from '\.\/([a-z-]+)'/g, "from './$1.mjs'");
  await writeFile(path.join(target, file.replace(/\.ts$/, '.mjs')), output, 'utf8');
}

const load = (dir, name) => import(`${path.join(outDir, dir, name)}.mjs`);

const classify = await load('artifacts', 'classify');
const extract = await load('artifacts', 'extract');
const ftpGuard = await load('ftp', 'guard');
const queue = await load('offline', 'queue');

/* ------------------------------ safeName ------------------------------ */

console.log('\nfile names');

check('traversal collapses to a bare base name', () => {
  const name = classify.safeName('../../etc/passwd');
  assert(!name.includes('/'), `still has a separator: ${name}`);
  assert(!name.includes('..'), `still has a dot run: ${name}`);
  assert(name.endsWith('.txt'), `no extension applied: ${name}`);
  // The last path segment is the file name; directory components are dropped.
  assertEqual(name, 'passwd.txt', 'safeName');
});

check('percent-encoded traversal is decoded before stripping', () => {
  const name = classify.safeName('%2e%2e%2f%2e%2e%2fetc%2fshadow');
  assert(!name.includes('/'), `separator survived: ${name}`);
  assert(!name.includes('..'), `dot run survived: ${name}`);
});

check('windows separators are treated as separators', () => {
  assertEqual(classify.safeName('C:\\Windows\\System32\\cmd.exe'), 'cmd.exe', 'windows path');
});

check('dot runs collapse but the extension survives', () => {
  assertEqual(classify.safeName('a..b.json'), 'a.b.json', 'dot collapse');
});

check('a missing name falls back to a real file name', () => {
  assertEqual(classify.safeName(''), 'artifact.txt', 'empty');
  assertEqual(classify.safeName('..'), 'artifact.txt', 'dots only');
  assertEqual(classify.safeName('/'), 'artifact.txt', 'slash only');
});

check('control characters and spaces are removed', () => {
  const name = classify.safeName('re\u0000port\u001f final.md');
  assert(!/[\u0000-\u001f]/.test(name), `control chars remain: ${JSON.stringify(name)}`);
  assert(!name.includes(' '), `space remains: ${name}`);
  assertEqual(name, 'report-final.md', 'sanitised');
});

check('absurdly long names are truncated, extension preserved', () => {
  const name = classify.safeName(`${'x'.repeat(300)}.py`);
  assert(name.length <= 96, `too long: ${name.length}`);
  assert(name.endsWith('.py'), `extension lost: ${name.slice(-8)}`);
});

check('an unknown extension becomes custom, not a guess', () => {
  assertEqual(classify.kindOf('weights.bin'), 'custom', 'bin kind');
  assertEqual(classify.describeType('weights.bin').mime, 'application/octet-stream', 'bin mime');
  assertEqual(classify.kindOf('Dockerfile'), 'custom', 'extensionless');
});

check('kind mapping covers the five artifact families', () => {
  assertEqual(classify.kindOf('agent.py'), 'code', 'py');
  assertEqual(classify.kindOf('deploy.yaml'), 'config', 'yaml');
  assertEqual(classify.kindOf('report.md'), 'report', 'md');
  assertEqual(classify.kindOf('rows.csv'), 'data', 'csv');
  assertEqual(classify.kindOf('thing.parquet'), 'data', 'parquet');
});

check('binary and text classification are distinct', () => {
  assert(classify.isBinaryType('sheet.xlsx'), 'xlsx should be binary');
  assert(classify.isBinaryType('doc.pdf'), 'pdf should be binary');
  assert(classify.isTextType('data.csv'), 'csv should be text');
  assert(classify.isTextType('conf.json'), 'json should be text');
  assert(!classify.isTextType('image.png'), 'png should not be text');
});

check('oversized artifacts are rejected before write', () => {
  assertThrows(
    () => classify.assertSize(40 * 1024 * 1024),
    (error) => error.code === 'artifact-too-large',
    'size guard',
  );
  assertThrows(() => classify.assertSize(-1), (error) => error.code === 'invalid-size', 'negative');
});

/* --------------------------- extractArtifacts --------------------------- */

console.log('\nagent output extraction');

const FENCED = [
  'Here is the script you asked for.',
  '',
  '```python app.py',
  'print("hello")',
  '```',
].join('\n');

check('a fenced block with a filename in the info string becomes a draft', () => {
  const drafts = extract.extractArtifacts(FENCED);
  assertEqual(drafts.length, 1, 'draft count');
  assertEqual(drafts[0].name, 'app.py', 'name');
  assertEqual(drafts[0].kind, 'code', 'kind');
  assert(drafts[0].text.includes('print'), 'body captured');
});

check('a comment on the first line names the file', () => {
  const message = ['```ts', '// filename: server.ts', 'export const x = 1;', '```'].join('\n');
  const [draft] = extract.extractArtifacts(message);
  assertEqual(draft.name, 'server.ts', 'name from comment');
});

check('a heading above the fence names the file', () => {
  const message = ['### reports/q3.md', '```markdown', '# Q3', '- throughput up', '```'].join('\n');
  const [draft] = extract.extractArtifacts(message);
  assertEqual(draft.name, 'q3.md', 'name from heading');
  assertEqual(draft.kind, 'report', 'kind');
});

check('an unlabelled block gets a language-derived name', () => {
  const message = ['```yaml', 'service: nexus', 'port: 3000', '```'].join('\n');
  const [draft] = extract.extractArtifacts(message, { fallbackStem: 'deploy' });
  assertEqual(draft.name, 'deploy-1.yaml', 'derived name');
  assertEqual(draft.kind, 'config', 'derived kind');
});

check('prose alone produces nothing', () => {
  assertEqual(
    extract.extractArtifacts('The report is ready. No files were attached.').length,
    0,
    'prose',
  );
});

check('a whole JSON reply is captured once', () => {
  const json = JSON.stringify({ model: 'nexus', steps: [1, 2, 3] }, null, 2);
  const drafts = extract.extractArtifacts(json, { fallbackStem: 'plan' });
  assertEqual(drafts.length, 1, 'one draft');
  assertEqual(drafts[0].name, 'plan.json', 'name');
  assertEqual(drafts[0].kind, 'config', 'kind');
});

check('a whole CSV reply is captured once', () => {
  const csv = 'name,bytes\nalpha,10\nbeta,20\ngamma,30';
  const drafts = extract.extractArtifacts(csv, { fallbackStem: 'table' });
  assertEqual(drafts.length, 1, 'one draft');
  assertEqual(drafts[0].kind, 'data', 'kind');
});

check('prose that merely contains commas is not a CSV', () => {
  const prose = 'I checked the logs, the queue, and the database, then reported back.';
  assertEqual(extract.extractArtifacts(prose).length, 0, 'prose with commas');
});

check('empty fences are skipped', () => {
  const message = ['```ts', '', '```'].join('\n');
  assertEqual(extract.extractArtifacts(message).length, 0, 'empty fence');
});

check('duplicate file names are disambiguated, never merged', () => {
  const message = [
    '```js a.js', 'const a = 1;', '```',
    '```js a.js', 'const b = 2;', '```',
  ].join('\n');
  const drafts = extract.extractArtifacts(message);
  assertEqual(drafts.length, 2, 'two drafts');
  assert(drafts[0].name !== drafts[1].name, 'names must differ');
  assertEqual(drafts[1].name, 'a-2.js', 'suffix');
});

check('the per-message cap is enforced', () => {
  const blocks = Array.from({ length: 12 }, (_, index) => `\`\`\`py f${index}.py\nx=${index}\n\`\`\``).join('\n');
  assertEqual(extract.extractArtifacts(blocks).length, 8, 'cap');
});

check('hasArtifacts is cheap and honest', () => {
  assert(extract.hasArtifacts(FENCED), 'fence detected');
  assert(!extract.hasArtifacts('just a sentence'), 'prose rejected');
});

/* -------------------------------- FTP guard -------------------------------- */

console.log('\nftp guards');

const policy = { allowed: ['ftp.example.com', '*.mirror.example'], allowAny: false };

check('exact host matches the allowlist', () => {
  assert(ftpGuard.hostAllowed('ftp.example.com', policy), 'exact');
  assert(ftpGuard.hostAllowed('FTP.Example.COM.', policy), 'case + trailing dot');
});

check('wildcard allows subdomains but not the parent or a lookalike', () => {
  assert(ftpGuard.hostAllowed('eu.mirror.example', policy), 'subdomain');
  assert(!ftpGuard.hostAllowed('mirror.example', policy), 'parent must not match *.x');
  assert(!ftpGuard.hostAllowed('evil-mirror.example', policy), 'suffix lookalike');
});

check('an unlisted host is refused with a fix', () => {
  const result = ftpGuard.validateTarget(
    { host: 'attacker.test', username: 'u', password: 'p' },
    policy,
  );
  assert(!result.ok, 'should refuse');
  assertEqual(result.error.code, 'ftp-host-blocked', 'code');
  assert(result.error.fix.includes('FTP_ALLOWED_HOSTS'), 'fix names the variable');
});

check('scheme, path and port in the host are rejected', () => {
  for (const host of ['ftp://example.com', 'example.com/path', 'example.com:21', 'a b']) {
    const result = ftpGuard.validateTarget({ host, username: 'u', password: 'p' }, { allowAny: true, allowed: [] });
    assert(!result.ok, `accepted invalid host: ${host}`);
  }
});

check('port range is enforced', () => {
  const result = ftpGuard.validateTarget(
    { host: 'ftp.example.com', port: 70000, username: 'u', password: 'p' },
    policy,
  );
  assert(!result.ok && result.error.code === 'ftp-invalid-port', 'port range');
});

check('newline injection into the PASS command is rejected', () => {
  const result = ftpGuard.validateTarget(
    { host: 'ftp.example.com', username: 'u', password: 'p\r\nDELE important.txt' },
    policy,
  );
  assert(!result.ok, 'newline password accepted');
  assertEqual(result.error.code, 'ftp-invalid-password', 'code');
});

check('remote directory traversal is normalised away', () => {
  assertEqual(ftpGuard.normaliseRemoteDir('/../../etc'), '/etc', 'traversal removed');
  assertEqual(ftpGuard.normaliseRemoteDir('artifacts/q3'), '/artifacts/q3', 'relative becomes absolute');
  assertEqual(ftpGuard.normaliseRemoteDir(''), '/', 'empty');
  assertEqual(ftpGuard.normaliseRemoteDir('/a/b/../c'), '/a/b/c', 'dot segment dropped');
  assert(!ftpGuard.normaliseRemoteDir('/a\u0000b').includes('\u0000'), 'control chars stripped');
});

check('batch limits are enforced', () => {
  const tooMany = Array.from({ length: 13 }, (_, index) => ({
    name: `f${index}.txt`,
    contentBase64: 'aGk=',
  }));
  const result = ftpGuard.validateBatch(tooMany);
  assert(!result.ok && result.error.code === 'ftp-batch-too-large', 'file count');
});

check('unsafe remote file names are refused', () => {
  for (const name of ['../../evil.sh', 'a b.txt', 'a/b.txt', '.']) {
    const result = ftpGuard.validateBatch([{ name, contentBase64: 'aGk=' }]);
    assert(!result.ok, `accepted unsafe name: ${name}`);
  }
});

check('a valid batch passes with decoded sizes', () => {
  const result = ftpGuard.validateBatch([{ name: 'report.md', contentBase64: 'aGVsbG8=' }]);
  assert(result.ok, 'should pass');
  assertEqual(result.items[0].name, 'report.md', 'name');
  assert(result.items[0].sizeBytes > 0, 'decoded size');
});

/* ------------------------------ sync backoff ------------------------------ */

console.log('\nsync queue');

check('backoff doubles and is capped', () => {
  assertEqual(queue.backoffFor(1), 5000, 'attempt 1');
  assertEqual(queue.backoffFor(2), 10000, 'attempt 2');
  assertEqual(queue.backoffFor(3), 20000, 'attempt 3');
  assertEqual(queue.backoffFor(12), 300000, 'capped at five minutes');
});

check('task ids are deterministic per kind + key', () => {
  assertEqual(queue.taskId('ftp-upload', 'abc'), 'ftp-upload:abc', 'id shape');
  assertEqual(queue.taskId('ftp-upload', 'abc'), queue.taskId('ftp-upload', 'abc'), 'stable');
  assert(queue.taskId('ftp-upload', 'abc') !== queue.taskId('artifact-push', 'abc'), 'kind scoped');
});

check('max attempts is a finite number', () => {
  assertEqual(queue.MAX_ATTEMPTS, 6, 'MAX_ATTEMPTS');
});

/* -------------------------------- summary -------------------------------- */

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\n${failure.name}\n${failure.error.stack}`);
  }
  process.exit(1);
}
