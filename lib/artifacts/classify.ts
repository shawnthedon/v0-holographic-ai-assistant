/**
 * File-type classification and name hygiene.
 *
 * Pure functions, no browser APIs — this is the part the unit tests hammer,
 * because a bad extension map or a weak name sanitiser is the difference
 * between a file manager and a path-traversal bug.
 */

import {
  MAX_ARTIFACT_BYTES,
  type ArtifactKind,
  ArtifactError,
} from './types';

interface TypeInfo {
  kind: ArtifactKind;
  mime: string;
  language?: string;
}

/**
 * Extension → kind/mime. A type that is not listed is `custom` with
 * `application/octet-stream`; guessing a MIME from content is how a CSV ends up
 * declared as HTML and rendered as markup.
 */
const TYPES: Record<string, TypeInfo> = {
  /* ------------------------------ code ------------------------------ */
  py: { kind: 'code', mime: 'text/x-python', language: 'python' },
  js: { kind: 'code', mime: 'text/javascript', language: 'javascript' },
  mjs: { kind: 'code', mime: 'text/javascript', language: 'javascript' },
  cjs: { kind: 'code', mime: 'text/javascript', language: 'javascript' },
  jsx: { kind: 'code', mime: 'text/jsx', language: 'jsx' },
  ts: { kind: 'code', mime: 'text/typescript', language: 'typescript' },
  tsx: { kind: 'code', mime: 'text/tsx', language: 'tsx' },
  rs: { kind: 'code', mime: 'text/rust', language: 'rust' },
  go: { kind: 'code', mime: 'text/x-go', language: 'go' },
  java: { kind: 'code', mime: 'text/x-java', language: 'java' },
  kt: { kind: 'code', mime: 'text/x-kotlin', language: 'kotlin' },
  c: { kind: 'code', mime: 'text/x-c', language: 'c' },
  h: { kind: 'code', mime: 'text/x-c', language: 'c' },
  cpp: { kind: 'code', mime: 'text/x-c++', language: 'cpp' },
  cs: { kind: 'code', mime: 'text/x-csharp', language: 'csharp' },
  rb: { kind: 'code', mime: 'text/x-ruby', language: 'ruby' },
  php: { kind: 'code', mime: 'text/x-php', language: 'php' },
  swift: { kind: 'code', mime: 'text/x-swift', language: 'swift' },
  sh: { kind: 'code', mime: 'text/x-sh', language: 'shell' },
  bash: { kind: 'code', mime: 'text/x-sh', language: 'shell' },
  sql: { kind: 'code', mime: 'application/sql', language: 'sql' },
  css: { kind: 'code', mime: 'text/css', language: 'css' },
  scss: { kind: 'code', mime: 'text/x-scss', language: 'scss' },
  lua: { kind: 'code', mime: 'text/x-lua', language: 'lua' },
  pl: { kind: 'code', mime: 'text/x-perl', language: 'perl' },
  r: { kind: 'code', mime: 'text/x-r', language: 'r' },

  /* ----------------------------- config ----------------------------- */
  json: { kind: 'config', mime: 'application/json', language: 'json' },
  jsonc: { kind: 'config', mime: 'application/json', language: 'json' },
  yaml: { kind: 'config', mime: 'application/yaml', language: 'yaml' },
  yml: { kind: 'config', mime: 'application/yaml', language: 'yaml' },
  toml: { kind: 'config', mime: 'application/toml', language: 'toml' },
  ini: { kind: 'config', mime: 'text/plain', language: 'ini' },
  env: { kind: 'config', mime: 'text/plain', language: 'dotenv' },
  conf: { kind: 'config', mime: 'text/plain' },
  properties: { kind: 'config', mime: 'text/plain' },
  xml: { kind: 'config', mime: 'application/xml', language: 'xml' },
  dockerfile: { kind: 'config', mime: 'text/plain', language: 'dockerfile' },

  /* ----------------------------- report ----------------------------- */
  md: { kind: 'report', mime: 'text/markdown', language: 'markdown' },
  markdown: { kind: 'report', mime: 'text/markdown', language: 'markdown' },
  html: { kind: 'report', mime: 'text/html', language: 'html' },
  htm: { kind: 'report', mime: 'text/html', language: 'html' },
  txt: { kind: 'report', mime: 'text/plain' },
  rst: { kind: 'report', mime: 'text/x-rst' },
  pdf: { kind: 'report', mime: 'application/pdf' },
  docx: {
    kind: 'report',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },

  /* ------------------------------ data ------------------------------ */
  csv: { kind: 'data', mime: 'text/csv', language: 'csv' },
  tsv: { kind: 'data', mime: 'text/tab-separated-values', language: 'tsv' },
  ndjson: { kind: 'data', mime: 'application/x-ndjson', language: 'json' },
  jsonl: { kind: 'data', mime: 'application/x-ndjson', language: 'json' },
  xlsx: {
    kind: 'data',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  xls: { kind: 'data', mime: 'application/vnd.ms-excel' },
  parquet: { kind: 'data', mime: 'application/vnd.apache.parquet' },
};

/** Binary formats we will happily store but never parse as text. */
const BINARY_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.apache.parquet',
]);

export function extensionOf(name: string): string {
  const clean = name.trim().toLowerCase();
  const dot = clean.lastIndexOf('.');
  if (dot <= 0 || dot === clean.length - 1) return '';
  return clean.slice(dot + 1);
}

export function describeType(name: string): TypeInfo {
  const ext = extensionOf(name);
  const known = TYPES[ext];
  if (known) return known;
  return { kind: 'custom', mime: 'application/octet-stream' };
}

export function kindOf(name: string): ArtifactKind {
  return describeType(name).kind;
}

export function isBinaryType(name: string): boolean {
  return BINARY_MIMES.has(describeType(name).mime);
}

export function isTextType(name: string): boolean {
  const { mime } = describeType(name);
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/yaml' ||
    mime === 'application/xml' ||
    mime === 'application/sql' ||
    mime === 'application/x-ndjson' ||
    mime === 'application/toml'
  );
}

/**
 * Sanitise a proposed file name.
 *
 * Order matters: strip paths and control characters first, then collapse dots,
 * then enforce an extension and a length. A name of `../../etc/passwd` must not
 * survive as `..%2F..%2Fetc%2Fpasswd` either — separators are removed, not
 * encoded, because the value is used as a key and as a download name.
 */
export function safeName(input: string, fallbackExtension = 'txt'): string {
  const fallback = `artifact.${fallbackExtension}`;
  if (!input) return fallback;

  let name = String(input).normalize('NFKC');

  // Decode percent-escapes BEFORE stripping, so %2e%2e%2f cannot sneak back in.
  try {
    if (/%[0-9a-f]{2}/i.test(name)) name = decodeURIComponent(name);
  } catch {
    /* malformed escape — proceed with the literal value */
  }

  name = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\\/g, '/') // windows separators become unix ones
    .split('/')
    .pop()! // drop every directory component
    .replace(/^[.\s]+/, '') // no leading dots or spaces
    .replace(/[<>:"|?*]/g, '-') // characters Windows and URLs dislike
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/\.{2,}/g, '.') // collapse dot runs
    .trim();

  if (!name || name === '.' || name === '..') return fallback;

  // Cap the stem so the extension survives.
  if (name.length > 96) {
    const ext = extensionOf(name);
    const stem = ext ? name.slice(0, -(ext.length + 1)) : name;
    name = `${stem.slice(0, 80)}${ext ? `.${ext}` : ''}`;
  }

  if (!extensionOf(name)) name = `${name}.${fallbackExtension}`;
  return name;
}

export function assertSize(bytes: number): void {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new ArtifactError({
      code: 'invalid-size',
      message: 'Artifact size is not a valid number',
      fix: 'Re-create the artifact from the agent output.',
    });
  }
  if (bytes > MAX_ARTIFACT_BYTES) {
    throw new ArtifactError({
      code: 'artifact-too-large',
      message: `Artifact is ${(bytes / 1048576).toFixed(1)} MB; the browser store is capped at 32 MB per file`,
      fix: 'Ask the agent for a smaller extract, or write the file to disk and move it with the FTP action.',
    });
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

/** Language label for the preview pane. */
export function languageOf(name: string): string | undefined {
  return describeType(name).language;
}
