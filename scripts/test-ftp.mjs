#!/usr/bin/env node
/**
 * End-to-end FTP test.
 *
 * Starts a real FTP server (ftp-srv) on a loopback port with a real filesystem
 * root, then drives the *shipped* client through it:
 *
 *   • connect + create a remote directory
 *   • upload a file and verify the bytes on disk and the returned SHA-256
 *   • verify a rejected password produces `ftp-auth-failed`, not a hang
 *   • verify an unlisted host is refused by the guard before any socket opens
 *
 *   npm run test:ftp
 *
 * No mocks of the protocol: ftp-srv speaks FTP, basic-ftp speaks FTP.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { mkdir as mkdirP, writeFile } from 'node:fs/promises';

const root = process.cwd();
const outDir = path.join(root, '.test-build', 'ftp');
const PORT = 2121;
const HOST = '127.0.0.1';

let passed = 0;
const failures = [];

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  PASS  ${name}`);
    })
    .catch((error) => {
      failures.push({ name, error });
      console.log(`  FAIL  ${name}\n        ${error.message}`);
    });
}

async function transpile(relPath, outName) {
  const source = await readFile(path.join(root, relPath), 'utf8');
  let output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  output = output.replace(/from '\.\/([a-z-]+)'/g, "from './$1.mjs'");
  await writeFile(path.join(outDir, outName), output, 'utf8');
}

await rm(path.join(root, '.test-build'), { recursive: true, force: true });
await mkdirP(outDir, { recursive: true });
await transpile('lib/ftp/types.ts', 'types.mjs');
await transpile('lib/ftp/guard.ts', 'guard.mjs');
await transpile('lib/ftp/client.ts', 'client.mjs');

const client = await import(path.join(outDir, 'client.mjs'));
const guard = await import(path.join(outDir, 'guard.mjs'));

/* ---------------------------- the FTP server ---------------------------- */

const serverRoot = await mkdtemp(path.join(tmpdir(), 'nexus-ftp-'));
await mkdir(path.join(serverRoot, 'incoming'), { recursive: true });

const FtpSrv = (await import('ftp-srv')).default;
const server = new FtpSrv({
  url: `ftp://${HOST}:${PORT}`,
  anonymous: false,
  pasv_url: HOST,
  pasv_min: 2130,
  pasv_max: 2140,
  greeting: ['NEXUS test server'],
});

const CREDENTIALS = { user: 'nexus', pass: 's3cret-pass' };

server.on('login', ({ username, password }, resolve, reject) => {
  if (username === CREDENTIALS.user && password === CREDENTIALS.pass) {
    resolve({ root: serverRoot });
  } else {
    reject(new Error('bad credentials'));
  }
});

await server.listen();
console.log(`ftp test server on ${HOST}:${PORT} (root ${serverRoot})\n`);

const connection = {
  host: HOST,
  port: PORT,
  secure: false,
  username: CREDENTIALS.user,
  password: CREDENTIALS.pass,
  remoteDir: '/incoming',
};

/* ------------------------------- the tests ------------------------------- */

try {
  console.log('ftp client');

  await check('connects and creates the remote directory', async () => {
    const { dir } = await client.testConnection(connection);
    if (dir !== '/incoming') throw new Error(`unexpected dir: ${dir}`);
  });

  await check('uploads bytes that match the source exactly', async () => {
    const body = 'name,score\nada,99\ngrace,97\n';
    const base64 = Buffer.from(body, 'utf8').toString('base64');
    const { uploaded, failures: uploadFailures } = await client.uploadBatch(connection, [
      { name: 'scores.csv', contentBase64: base64, sizeBytes: Buffer.byteLength(body) },
    ]);

    if (uploadFailures.length) throw new Error(`upload failures: ${JSON.stringify(uploadFailures)}`);
    if (uploaded.length !== 1) throw new Error(`expected 1 upload, got ${uploaded.length}`);

    const onDisk = await readFile(path.join(serverRoot, 'incoming', 'scores.csv'), 'utf8');
    if (onDisk !== body) throw new Error(`disk content mismatch: ${JSON.stringify(onDisk)}`);

    const expected = createHash('sha256').update(body).digest('hex');
    if (uploaded[0].sha256 !== expected) {
      throw new Error(`hash mismatch: ${uploaded[0].sha256} vs ${expected}`);
    }
    if (uploaded[0].remotePath !== '/incoming/scores.csv') {
      throw new Error(`unexpected remote path: ${uploaded[0].remotePath}`);
    }
    if (uploaded[0].bytes !== Buffer.byteLength(body)) {
      throw new Error(`byte count mismatch: ${uploaded[0].bytes}`);
    }
  });

  await check('creates a nested directory that does not exist yet', async () => {
    const nested = { ...connection, remoteDir: '/incoming/deep/branch' };
    const { uploaded, failures: uploadFailures } = await client.uploadBatch(nested, [
      { name: 'note.md', contentBase64: Buffer.from('# hi\n').toString('base64'), sizeBytes: 5 },
    ]);
    if (uploadFailures.length) throw new Error(JSON.stringify(uploadFailures));
    if (uploaded.length !== 1) throw new Error('no upload');
    const onDisk = await readFile(path.join(serverRoot, 'incoming', 'deep', 'branch', 'note.md'), 'utf8');
    if (onDisk.trim() !== '# hi') throw new Error(`content: ${onDisk}`);
  });

  await check('a wrong password fails fast with ftp-auth-failed', async () => {
    try {
      await client.testConnection({ ...connection, password: 'wrong' });
      throw new Error('should not connect');
    } catch (error) {
      if (!(error instanceof client.FtpClientError)) throw new Error(`wrong error type: ${error.name}`);
      if (error.code !== 'ftp-auth-failed') throw new Error(`unexpected code: ${error.code}`);
      if (String(error.message).includes('wrong')) throw new Error('password leaked into the message');
      if (!error.fix) throw new Error('no remediation hint');
    }
  });

  await check('an unreachable port fails with a connect error, not a hang', async () => {
    const started = Date.now();
    try {
      await client.testConnection({ ...connection, port: 2122, password: CREDENTIALS.pass });
      throw new Error('should not connect');
    } catch (error) {
      if (error.code !== 'ftp-connect-failed' && error.code !== 'ftp-timeout') {
        throw new Error(`unexpected code: ${error.code}`);
      }
      const elapsed = Date.now() - started;
      if (elapsed > 20_000) throw new Error(`took ${elapsed}ms — timeout is not enforced`);
    }
  });

  console.log('\nftp guard');

  await check('the guard refuses a host that is not allowlisted', async () => {
    const result = guard.validateTarget(
      { host: 'evil.example.net', username: 'u', password: 'p' },
      { allowed: [HOST], allowAny: false },
    );
    if (result.ok) throw new Error('accepted a blocked host');
    if (result.error.code !== 'ftp-host-blocked') throw new Error(`unexpected code: ${result.error.code}`);
  });

  await check('the allowlist permits the test host', async () => {
    const result = guard.validateTarget(
      { host: HOST, username: 'u', password: 'p' },
      { allowed: [HOST], allowAny: false },
    );
    if (!result.ok) throw new Error(`rejected the allowed host: ${result.error.message}`);
  });
} finally {
  await server.close().catch(() => undefined);
  await rm(serverRoot, { recursive: true, force: true }).catch(() => undefined);
}

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`\n${failure.name}\n${failure.error.stack}`);
  process.exit(1);
}
process.exit(0);
