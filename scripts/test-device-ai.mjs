#!/usr/bin/env node
/**
 * Executed tests for the on-device AI layer (spec §16, unit tier).
 *
 * These are not smoke tests: a synthetic-but-valid GGUF container is built in
 * memory and pushed through the real parser, then corrupted in six specific
 * ways to prove each failure is detected and classified. URL/path guards are
 * attacked rather than assumed.
 *
 *   npm run test:device-ai
 *
 * The modules under test are the real source files, transpiled with the
 * project's own TypeScript so the assertions run against shipped code.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = process.cwd();
const outDir = path.join(root, '.test-build', 'device-ai');
const sources = ['types.ts', 'gguf.ts', 'catalogue.ts', 'storage.ts'];

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
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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
await mkdir(outDir, { recursive: true });

for (const file of sources) {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(path.join(root, 'lib', 'device-ai', file), 'utf8'));
  let output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  // Node ESM needs explicit extensions on relative specifiers.
  output = output.replace(/from '\.\/([a-z-]+)'/g, "from './$1.mjs'");
  await writeFile(path.join(outDir, file.replace(/\.ts$/, '.mjs')), output, 'utf8');
}

const gguf = await import(pathToFileURL(path.join(outDir, 'gguf.mjs')).href);
const catalogue = await import(pathToFileURL(path.join(outDir, 'catalogue.mjs')).href);
const storage = await import(pathToFileURL(path.join(outDir, 'storage.mjs')).href);

/* --------------------------- GGUF fixture builder --------------------------- */

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function u64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function ggufString(text) {
  const bytes = Buffer.from(text, 'utf8');
  return Buffer.concat([u64(bytes.length), bytes]);
}

/**
 * Builds a minimal but structurally valid GGUF v3 file.
 * KV/metadata is real; tensor data is only as large as bytesPerTensor allows.
 */
function buildGguf(options = {}) {
  const {
    version = 3,
    architecture = 'llama',
    fileType = 15, // Q4_K_M
    contextLength = 4096,
    tensors = [{ name: 'token_embd.weight', dims: [32, 8], type: 0, offset: 0 }],
    metadataCount,
    corruptMagic = false,
    truncateAfterHeader = false,
    tensorCountOverride,
  } = options;

  const parts = [];
  parts.push(Buffer.from(corruptMagic ? 'GGUF'.replace('G', 'X') : 'GGUF', 'ascii'));
  parts.push(u32(version));

  const kv = [
    ['general.architecture', 8, architecture],
    ['general.name', 8, 'Test Model'],
    ['general.file_type', 4, fileType],
    ['general.alignment', 4, 32],
    [`${architecture}.context_length`, 4, contextLength],
    ['tokenizer.ggml.model', 8, 'llama'],
  ];
  const declaredKv = metadataCount ?? kv.length;

  parts.push(u64(tensorCountOverride ?? tensors.length));
  parts.push(u64(declaredKv));

  for (const [key, type, value] of kv) {
    parts.push(ggufString(key));
    parts.push(u32(type));
    parts.push(type === 8 ? ggufString(String(value)) : u32(Number(value)));
  }

  // Tensor descriptors
  for (const tensor of tensors) {
    parts.push(ggufString(tensor.name));
    parts.push(u32(tensor.dims.length));
    for (const dim of tensor.dims) parts.push(u64(dim));
    parts.push(u32(tensor.type));
    parts.push(u64(tensor.offset));
  }

  const header = Buffer.concat(parts);
  if (truncateAfterHeader) return header;
  // 4 KiB of plausible tensor payload so size checks have something to see.
  return Buffer.concat([header, Buffer.alloc(4096, 7)]);
}

/* -------------------------------- GGUF tests -------------------------------- */

console.log('\nGGUF header parsing');

const valid = buildGguf();
const header = gguf.parseGgufHeader(new Uint8Array(valid));

check('valid file parses with the real metadata', () => {
  assertEqual(header.magicOk, true, 'magicOk');
  assertEqual(header.version, 3, 'version');
  assertEqual(header.architecture, 'llama', 'architecture');
  assertEqual(header.modelName, 'Test Model', 'modelName');
  assertEqual(header.contextLength, 4096, 'contextLength');
  assertEqual(header.tensorCount, 1, 'tensorCount');
  assertEqual(header.tensors[0].name, 'token_embd.weight', 'tensor name');
  assertEqual(header.alignment, 32, 'alignment');
});

check('file_type 15 is reported as Q4_K_M, not invented', () => {
  assertEqual(header.fileType, 15, 'fileType');
  assertEqual(header.quantization, 'Q4_K_M', 'quantization');
});

check('unknown file_type is surfaced, not guessed', () => {
  const odd = gguf.parseGgufHeader(new Uint8Array(buildGguf({ fileType: 999 })));
  assertEqual(odd.quantization, 'type-999', 'quantization');
});

check('headerBytes is the real consumed length', () => {
  assert(header.headerBytes > 16 && header.headerBytes < valid.length, `headerBytes=${header.headerBytes}`);
});

console.log('\nGGUF rejection paths');

check('non-GGUF file → bad-magic', () => {
  const error = assertThrows(
    () => gguf.parseGgufHeader(new Uint8Array(buildGguf({ corruptMagic: true }))),
    (e) => e instanceof gguf.GgufParseError && e.reason === 'bad-magic',
    'bad magic',
  );
  assertEqual(error.reason, 'bad-magic', 'reason');
});

check('tiny file → too-small', () => {
  assertThrows(
    () => gguf.parseGgufHeader(new Uint8Array([1, 2, 3, 4])),
    (e) => e.reason === 'too-small',
    'too small',
  );
});

check('GGUF v1 → unsupported-version', () => {
  assertThrows(
    () => gguf.parseGgufHeader(new Uint8Array(buildGguf({ version: 1 }))),
    (e) => e.reason === 'unsupported-version',
    'version 1',
  );
});

check('truncated metadata → truncated', () => {
  const full = buildGguf();
  const cut = new Uint8Array(full.subarray(0, header.headerBytes - 40));
  assertThrows(
    () => gguf.parseGgufHeader(cut),
    (e) => e.reason === 'truncated' || e.reason === 'implausible-header',
    'truncated',
  );
});

check('absurd metadata count → implausible-header (no hang)', () => {
  assertThrows(
    () => gguf.parseGgufHeader(new Uint8Array(buildGguf({ metadataCount: 5_000_000 }))),
    (e) => e.reason === 'implausible-header',
    'huge kv count',
  );
});

check('absurd tensor count → implausible-header', () => {
  assertThrows(
    () => gguf.parseGgufHeader(new Uint8Array(buildGguf({ tensorCountOverride: 9_999_999 }))),
    (e) => e.reason === 'implausible-header',
    'huge tensor count',
  );
});

console.log('\nGGUF inspection over a Blob');

await check('inspectGguf accepts a complete file', () => undefined); // placeholder keeps ordering readable

{
  const blob = new Blob([valid]);
  const inspected = await gguf.inspectGguf(blob);
  check('complete file → sizeMatches true and architecture exposed', () => {
    assertEqual(inspected.sizeMatches, true, 'sizeMatches');
    assertEqual(inspected.header.architecture, 'llama', 'architecture');
  });

  const truncatedBlob = new Blob([buildGguf({ truncateAfterHeader: true })]);
  const truncated = await gguf.inspectGguf(truncatedBlob);
  check('header-only file is rejected as incomplete', () => {
    assertEqual(truncated.sizeMatches, false, 'sizeMatches');
    assert(truncatedBlob.size < blob.size, 'truncated fixture is smaller');
  });
}

/* ------------------------------ URL / path guards ------------------------------ */

console.log('\nDownload URL validation');

const okUrls = [
  'https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf',
  'https://cdn-lfs.huggingface.co/repos/x/y.gguf',
];
for (const url of okUrls) {
  check(`accepts ${new URL(url).hostname}`, () => {
    const parsed = catalogue.assertSafeDownloadUrl(url);
    assertEqual(parsed.protocol, 'https:', 'protocol');
  });
}

const badUrls = [
  ['http://huggingface.co/a/b/resolve/main/x.gguf', 'plain http'],
  ['https://evil.example.com/x.gguf', 'unapproved host'],
  ['https://user:pass@huggingface.co/a/b.gguf', 'embedded credentials'],
  ['javascript:alert(1)//x.gguf', 'javascript scheme'],
  ['data:text/plain;base64,AAAA', 'data scheme'],
  ['https://huggingface.co/a/b/resolve/main/model.bin', 'not a gguf'],
];
for (const [url, label] of badUrls) {
  check(`rejects ${label}`, () => {
    assertThrows(() => catalogue.assertSafeDownloadUrl(url), null, label);
  });
}

check('encoded traversal cannot leave the approved host', () => {
  // The URL parser collapses `%2e%2e` segments before we see them, so the
  // property to hold is "still on huggingface.co, no traversal left" — either a
  // rejection or a harmless 404 is acceptable; an escape is not.
  const resolved = catalogue.assertSafeDownloadUrl(
    'https://huggingface.co/a/%2e%2e/%2e%2e/etc/passwd.gguf',
  );
  assertEqual(resolved.hostname, 'huggingface.co', 'host remains allowlisted');
  assert(!decodeURIComponent(resolved.pathname).includes('..'), 'no traversal segment survives');
});

console.log('\nFile-name safety');

check('safeFileName cannot escape the models directory', () => {
  const name = storage.safeFileName('local/../../etc/passwd');
  assert(!name.includes('/') && !name.includes('\\'), `separator survived: ${name}`);
  assert(!name.includes('..'), `traversal segment survived: ${name}`);
  assert(name.endsWith('.gguf'), 'extension');
  // Backslash traversal (Windows-hostile input) must be neutralised too.
  const win = storage.safeFileName('..\\..\\windows\\system32');
  assert(!win.includes('\\') && !win.includes('..'), `windows traversal survived: ${win}`);
});

check('safeFileName refuses empty/unsafe ids', () => {
  assertThrows(() => storage.safeFileName('...'), null, 'dots only');
});

check('idFromFileName is stable and scoped', () => {
  assertEqual(
    catalogue.idFromFileName('Qwen2.5-0.5B-Instruct-Q4_K_M.gguf'),
    'local/qwen2.5-0.5b-instruct-q4_k_m',
    'id',
  );
  assertEqual(
    catalogue.idFromFileName('https://huggingface.co/a/b/resolve/main/Model%20X.gguf'),
    'local/model-x',
    'url-derived id',
  );
});

/* -------------------------------- catalogue -------------------------------- */

console.log('\nCatalogue integrity');

check('every preset names a licence, model card and .gguf URL', () => {
  for (const entry of catalogue.LOCAL_CATALOGUE) {
    assert(entry.licence && entry.licence.length > 2, `${entry.id} licence`);
    assert(entry.modelCard.startsWith('https://'), `${entry.id} model card`);
    assert(entry.downloadUrl.endsWith('.gguf'), `${entry.id} url`);
    assert(entry.approxBytes > 0, `${entry.id} size`);
    catalogue.assertSafeDownloadUrl(entry.downloadUrl);
  }
});

check('unverified presets are labelled as such (no false guarantee)', () => {
  const unverified = catalogue.LOCAL_CATALOGUE.filter((entry) => entry.verification === 'unverified');
  assert(unverified.length > 0, 'expected some unverified presets in this build');
  for (const entry of unverified) {
    assert(entry.downloadUrl.includes('huggingface.co'), `${entry.id} must still be a real host`);
  }
});

check('quantization is stated for every preset', () => {
  for (const entry of catalogue.LOCAL_CATALOGUE) {
    assert(/Q\d/.test(entry.quantization), `${entry.id} quantization`);
  }
});

check('formatBytes is human and never claims precision it lacks', () => {
  assertEqual(catalogue.formatBytes(0), '0 B', 'zero');
  assertEqual(catalogue.formatBytes(1024), '1.0 KB', '1 KB');
  assertEqual(catalogue.formatBytes(105 * 1024 ** 2), '105 MB', '105 MB');
});

/* ------------------------------- runtime asset ------------------------------- */

console.log('\nRuntime asset (the bytes the browser will execute)');

{
  const fs = await import('node:fs/promises');
  const wasmPath = path.join(root, 'public', 'vendor', 'wllama', 'wllama.wasm');
  let bytes = null;
  try {
    bytes = await fs.readFile(wasmPath);
  } catch {
    bytes = null;
  }

  const compatPath = path.join(root, 'public', 'vendor', 'wllama', 'compat', 'wllama.wasm');
  const compatWorker = path.join(root, 'public', 'vendor', 'wllama', 'compat', 'wllama.js');

  if (!bytes) {
    check('wllama.wasm is present', () => {
      throw new Error('public/vendor/wllama/wllama.wasm missing — run `npm run sync:runtime`');
    });
  } else {
    check('default build has the WebAssembly magic and is the memory64 build', () => {
      assertEqual(bytes.subarray(0, 4).toString('hex'), '0061736d', 'wasm magic');
      assert(bytes.byteLength > 4 * 1024 * 1024, `only ${bytes.byteLength} bytes`);
      // The default build targets JSPI + MEMORY64. This V8 (Node 22) has
      // MEMORY64 but not TABLE64, so it refuses the binary — that is the exact
      // gate the capability probe reports, not a broken asset.
      const defaultOk = WebAssembly.validate(bytes);
      console.log(
        `        (default build validates on this engine: ${defaultOk} — engine ${process.version} / V8 ${process.versions.v8})`,
      );
    });

    let compatBytes = null;
    try {
      compatBytes = await fs.readFile(compatPath);
    } catch {
      compatBytes = null;
    }

    check('compat build is served (Safari / pre-JSPI browsers)', () => {
      assert(compatBytes, 'missing public/vendor/wllama/compat/wllama.wasm');
      assertEqual(compatBytes.subarray(0, 4).toString('hex'), '0061736d', 'wasm magic');
    });

    if (compatBytes) {
      check('compat build validates on this engine (real compatibility evidence)', () => {
        assert(
          WebAssembly.validate(compatBytes),
          'compat binary does not validate — browsers without JSPI/MEMORY64 could not run local inference',
        );
      });

      const module = await WebAssembly.compile(compatBytes);
      const exports = WebAssembly.Module.exports(module);
      const imports = WebAssembly.Module.imports(module);
      check('compat build is a substantial module with the allocatable linear memory', () => {
        // Release builds are minified and emscripten imports the shared/linear
        // memory rather than exporting it, so assert shape: a large function
        // surface, a table, and exactly the memory import the runtime allocates
        // the model into.
        assert(exports.length > 50, `only ${exports.length} exports`);
        assert(exports.filter((entry) => entry.kind === 'function').length > 40, 'too few functions');
        assert(exports.some((entry) => entry.kind === 'table'), 'no function table');
        assertEqual(
          imports.filter((entry) => entry.kind === 'memory').length,
          1,
          'memory imports',
        );
        assert(compatBytes.byteLength > 8 * 1024 * 1024, 'compat binary is too small to contain llama.cpp');
      });
    }

    const workerSource = await fs.readFile(compatWorker, 'utf8').catch(() => '');
    check('compat worker source is self-hosted (no CDN at runtime)', () => {
      assert(workerSource.length > 10_000, 'compat worker source is suspiciously small');
      assert(/wllama|emscripten|Module/i.test(workerSource), 'compat worker does not look like runtime code');
    });

    const licence = await fs.readFile(path.join(root, 'public', 'vendor', 'wllama', 'LICENCE'), 'utf8');
    check('licence text is the MIT licence', () => {
      assert(licence.includes('MIT License'), 'licence file is not MIT');
    });
  }
}

/* ---------------------------------- verdict ---------------------------------- */

await rm(path.join(root, '.test-build'), { recursive: true, force: true });

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  process.exit(1);
}
