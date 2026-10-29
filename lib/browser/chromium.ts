/**
 * Chromium bootstrap.
 *
 * The agent needs a real browser, not a headless HTML parser: modern sites are
 * rendered by JavaScript, target elements through an accessibility tree, and
 * redirect freely. `@sparticuz/chromium` ships a headless build inside the npm
 * package (no external download), which is what makes this work in a plain Node
 * service without a system Chrome.
 *
 * Its shared libraries are shipped as brotli-compressed tars and must be on
 * `LD_LIBRARY_PATH` before Chromium starts. We extract them once, ourselves, so
 * the deployment does not depend on the host already having them.
 *
 * Nothing here fabricates a browser: if the binary cannot be resolved, the probe
 * fails with a reason and the UI reports `browser-unavailable`.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';

export interface ChromiumResolution {
  available: boolean;
  executablePath?: string;
  args: string[];
  reason?: string;
  fix?: string;
  /** Where the extracted shared libraries live, when we extracted them. */
  libraryPath?: string;
}

let cached: ChromiumResolution | null = null;

const BASE_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--hide-scrollbars',
  '--mute-audio',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints',
  /*
   * Consistency is the point: the window size, locale and timezone are fixed for
   * the life of a task so a site does not see the identity change mid-run. This
   * is stability, not evasion — we do not randomise or forge a fingerprint.
   */
  '--window-size=1440,900',
  '--lang=en-US',
];

export async function resolveChromium(): Promise<ChromiumResolution> {
  if (cached) return cached;

  const explicit = process.env.BROWSER_EXECUTABLE_PATH;
  if (explicit) {
    if (!existsSync(explicit)) {
      cached = {
        available: false,
        args: BASE_ARGS,
        reason: `BROWSER_EXECUTABLE_PATH points at ${explicit}, which does not exist`,
        fix: 'Correct the path, or unset BROWSER_EXECUTABLE_PATH to use the bundled Chromium.',
      };
      return cached;
    }
    cached = { available: true, executablePath: explicit, args: BASE_ARGS };
    return cached;
  }

  try {
    const module = await import('@sparticuz/chromium');
    const chromium = (module.default ?? module) as unknown as {
      executablePath: () => Promise<string>;
      args: string[];
    };
    const executablePath = await chromium.executablePath();
    const libraryPath = ensureSharedLibraries();

    // Chromium needs to find libnss3/libatk/etc. at load time; the flag form also
    // works when the loader ignores our env (e.g. a supervisor process).
    if (libraryPath) {
      process.env.LD_LIBRARY_PATH = [libraryPath, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    }

    cached = {
      available: true,
      executablePath,
      args: [...BASE_ARGS, ...(chromium.args ?? [])],
      libraryPath: libraryPath ?? undefined,
    };
    return cached;
  } catch (error) {
    cached = {
      available: false,
      args: BASE_ARGS,
      reason: error instanceof Error ? error.message : 'Chromium could not be resolved',
      fix: 'Install @sparticuz/chromium, or set BROWSER_EXECUTABLE_PATH / BROWSER_WS_ENDPOINT to a reachable browser.',
    };
    return cached;
  }
}

/**
 * Extract `bin/al2023.tar.br` (or `al2`) into a stable temp directory.
 * Returns the directory that must be added to LD_LIBRARY_PATH.
 */
function ensureSharedLibraries(): string | null {
  try {
    const packageRoot = dirname(dirname(requireFile('@sparticuz/chromium')));
    const binDir = join(packageRoot, 'bin');
    const archive = ['al2023.tar.br', 'al2.tar.br'].map((name) => join(binDir, name)).find(existsSync);
    if (!archive) return null;

    const stamp = createHash('sha256').update(readFileSync(archive)).digest('hex').slice(0, 12);
    const target = join(tmpdir(), `nexus-chromium-${stamp}`);
    const libraryPath = join(target, 'lib');
    if (existsSync(libraryPath)) return libraryPath;

    mkdirSync(target, { recursive: true });
    const tarPath = join(target, 'libs.tar');
    writeFileSync(tarPath, brotliDecompressSync(readFileSync(archive)));
    try {
      // `tar` is present on every image Chromium itself runs on; using it keeps
      // the extractor out of our dependency graph.
      execFileSync('tar', ['-xf', tarPath, '-C', target], { stdio: 'ignore' });
    } catch {
      // No tar binary: fall back to the system loader paths and let the probe
      // report a missing-library failure honestly.
      return existsSync(libraryPath) ? libraryPath : null;
    }
    return existsSync(libraryPath) ? libraryPath : null;
  } catch {
    return null;
  }
}

/** Resolve a package entry to an absolute path, from either module system. */
function requireFile(specifier: string): string {
  const require = createRequire(import.meta.url);
  return require.resolve(specifier);
}

export function chromiumLaunchArgs(extra: string[] = []): string[] {
  // A proxy is only used when the operator configured one — never to defeat a
  // regional or access restriction.
  const proxy = process.env.BROWSER_PROXY;
  const args = proxy ? [...BASE_ARGS, `--proxy-server=${proxy}`] : [...BASE_ARGS];
  return [...args, ...extra];
}
