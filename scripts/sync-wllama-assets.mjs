#!/usr/bin/env node
/**
 * Copies the wllama WASM runtime out of node_modules into public/ so the app
 * serves it from its own origin.
 *
 * Why: local inference must work with no network. Shipping the runtime with the
 * app (instead of fetching it from a CDN at first run) is what makes the
 * "offline after install" claim true, and keeps the byte-for-byte runtime in
 * lockstep with the npm dependency.
 *
 * Runs on postinstall + prebuild. Generated files are gitignored: the source of
 * truth is the pinned dependency, not a checked-in binary.
 */
import { access, copyFile, mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = process.cwd();
const target = path.join(root, 'public', 'vendor', 'wllama');

/**
 * Two runtime builds ship, and wllama picks at call time:
 *   • default  — JSPI + MEMORY64, fastest; needs a current engine.
 *   • compat   — Asyncify, no MEMORY64; runs on Safari and older browsers.
 * Both are served from this origin so nothing is fetched from a CDN at runtime.
 */
const RUNTIME_FILES = [
  ['esm/wasm/wllama.wasm', 'wllama.wasm'],
  ['LICENCE', 'LICENCE'],
];

const COMPAT_FILES = [
  ['wasm/wllama.wasm', 'compat/wllama.wasm'],
  ['wasm/wllama.js', 'compat/wllama.js'],
];

async function main() {
  let pkgDir;
  try {
    pkgDir = path.dirname(require.resolve('@wllama/wllama/package.json'));
  } catch {
    // package.json has no resolvable entry without a files field, so fall
    // back to the conventional location.
    pkgDir = path.join(root, 'node_modules', '@wllama', 'wllama');
  }

  try {
    await access(pkgDir);
  } catch {
    console.error(`[sync-wllama] @wllama/wllama is not installed — local inference will report unavailable.`);
    process.exit(0); // never break an install because of an optional runtime
  }

  await mkdir(target, { recursive: true });
  await mkdir(path.join(target, 'compat'), { recursive: true });

  const copy = async (base, [from, to]) => {
    const src = path.join(base, from);
    const dest = path.join(target, to);
    try {
      await copyFile(src, dest);
      const { size } = await stat(dest);
      console.log(`[sync-wllama] ${to} (${(size / 1024 / 1024).toFixed(1)} MB)`);
      return true;
    } catch (error) {
      console.warn(`[sync-wllama] skipped ${from}: ${error.code ?? error.message}`);
      return false;
    }
  };

  for (const entry of RUNTIME_FILES) await copy(pkgDir, entry);

  // The compat build is optional: without it, browsers lacking JSPI/MEMORY64
  // would silently pull the assets from a CDN, which breaks the offline claim.
  let compatDir;
  try {
    compatDir = path.dirname(require.resolve('@wllama/wllama-compat/package.json'));
  } catch {
    compatDir = path.join(root, 'node_modules', '@wllama', 'wllama-compat');
  }

  let compatOk = true;
  for (const entry of COMPAT_FILES) {
    compatOk = (await copy(compatDir, entry)) && compatOk;
  }
  if (!compatOk) {
    console.warn(
      '[sync-wllama] compat build missing — Safari and pre-JSPI browsers will report local inference as unavailable instead of using a CDN.',
    );
  }
}

await main();
