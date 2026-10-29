/**
 * Turn an agent's answer into artifacts.
 *
 * Agents emit files the way people write them in chat: a fenced block, usually
 * with a language, sometimes with a filename in the fence info string, a comment
 * on the first line, or a heading just above it. This module reads those
 * conventions and nothing else.
 *
 * It deliberately does **not** guess: prose is not turned into a file, an
 * unlabelled block is not turned into a file unless it looks like a complete
 * document (JSON object/array, or a CSV with a consistent delimiter), and a
 * block with no recognisable extension gets a name derived from its language.
 */

import { describeType, safeName } from './classify';
import { MAX_DRAFTS_PER_MESSAGE, type ArtifactDraft } from './types';

const FENCE = /^```([^\n`]*)\n([\s\S]*?)^```[ \t]*$/gm;

/** ```ts title="src/app.ts"  /  ```ts filename=app.ts  /  ```app.ts */
function nameFromFenceInfo(info: string): string | null {
  const trimmed = info.trim();
  if (!trimmed) return null;

  const titled = trimmed.match(/(?:title|filename|file|name)\s*[:=]\s*["']?([^"'\s]+)["']?/i);
  if (titled) return titled[1];

  // Any token that already looks like a path or file name. This covers both
  // "```app.py" and "```python app.py" — the language token is skipped because
  // it has no dot-extension.
  const tokens = trimmed.split(/[\s,]+/);
  for (const token of tokens) {
    if (token && /[/.]/.test(token) && /\.[a-z0-9]{1,8}$/i.test(token)) return token;
  }

  return null;
}

/** `// filename: app.ts`, `# app.py`, `<!-- page.html -->` on the first line. */
function nameFromBody(body: string): string | null {
  const firstLine = body.split('\n', 1)[0]?.trim() ?? '';
  if (!firstLine) return null;

  const comment = firstLine.match(
    /^(?:\/\/|#|--|;|%|<!--)\s*(?:filename|file|name)\s*[:=]\s*([^\s>]+)/i,
  );
  if (comment) return comment[1];

  const bareHeading = firstLine.match(/^\/\/\s*([\w.-]+\.[a-z0-9]{1,8})$/i);
  if (bareHeading) return bareHeading[1];

  return null;
}

const LANGUAGE_EXTENSION: Record<string, string> = {
  python: 'py',
  py: 'py',
  javascript: 'js',
  js: 'js',
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  jsx: 'jsx',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  bash: 'sh',
  sh: 'sh',
  shell: 'sh',
  sql: 'sql',
  html: 'html',
  css: 'css',
  markdown: 'md',
  md: 'md',
  csv: 'csv',
  tsv: 'tsv',
  xml: 'xml',
  rust: 'rs',
  go: 'go',
  java: 'java',
  ruby: 'rb',
  php: 'php',
  text: 'txt',
  txt: 'txt',
};

function extensionForLanguage(info: string): string {
  const token = info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return LANGUAGE_EXTENSION[token] ?? 'txt';
}

/** Title from the first Markdown heading, else the first non-empty line. */
function titleFrom(body: string, fallback: string): string {
  const heading = body.match(/^\s{0,3}#{1,6}\s+(.+)$/m);
  if (heading) return heading[1].trim().slice(0, 80);
  const line = body
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  if (!line) return fallback;
  return line.replace(/^[/*#-]+\s*/, '').slice(0, 80);
}

function looksLikeJson(body: string): boolean {
  const trimmed = body.trim();
  if (!/^[[{]/.test(trimmed) || !/[\]}]$/.test(trimmed)) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function looksLikeCsv(body: string): boolean {
  const lines = body.trim().split('\n').slice(0, 6);
  if (lines.length < 2) return false;
  const counts = new Set(
    lines.map((line) => {
      // Count separators outside quotes — a naive split miscounts prose.
      let commas = 0;
      let inQuotes = false;
      for (const char of line) {
        if (char === '"') inQuotes = !inQuotes;
        else if (char === ',' && !inQuotes) commas += 1;
      }
      return commas;
    }),
  );
  return counts.size === 1 && [...counts][0] >= 1;
}

/**
 * Pull artifacts out of one agent message.
 *
 * Returns an empty array for prose — the caller must not invent files.
 */
export function extractArtifacts(
  message: string,
  options: { maxDrafts?: number; fallbackStem?: string } = {},
): ArtifactDraft[] {
  if (!message || typeof message !== 'string') return [];

  const max = options.maxDrafts ?? MAX_DRAFTS_PER_MESSAGE;
  const drafts: ArtifactDraft[] = [];
  const used = new Set<string>();
  const stem = options.fallbackStem ?? 'agent-output';

  // A heading immediately before a fence is a strong filename hint:
  //   ### reports/q3.md
  //   ```markdown
  const headingHints = new Map<number, string>();
  const headingRe = /^#{1,6}\s+([^\n]+)\n+(?=```)/gm;
  for (let match = headingRe.exec(message); match; match = headingRe.exec(message)) {
    headingHints.set(match.index + match[0].length, match[1].trim());
  }

  let index = 0;
  for (let match = FENCE.exec(message); match; match = FENCE.exec(message)) {
    index += 1;
    if (drafts.length >= max) break;

    const info = match[1] ?? '';
    const body = match[2] ?? '';
    if (!body.trim()) continue;

    const hint = headingHints.get(match.index);
    const proposed =
      nameFromFenceInfo(info) ??
      nameFromBody(body) ??
      (hint && /\.[a-z0-9]{1,8}$/i.test(hint) ? hint : null);

    const ext = extensionForLanguage(info);
    let name = proposed ? safeName(proposed) : safeName(`${stem}-${index}.${ext}`);

    // Never let two blocks collide into one key.
    let suffix = 2;
    while (used.has(name)) {
      const dot = name.lastIndexOf('.');
      name = dot > 0 ? `${name.slice(0, dot)}-${suffix}${name.slice(dot)}` : `${name}-${suffix}`;
      suffix += 1;
    }
    used.add(name);

    const type = describeType(name);
    drafts.push({
      name,
      title: titleFrom(body, name),
      kind: type.kind,
      text: body.replace(/\s+$/, ''),
      language: type.language,
      description: `Extracted from agent output (block ${index})`,
    });
  }

  // No fences, but the whole message is a document: capture it once.
  if (drafts.length === 0) {
    const trimmed = message.trim();
    if (looksLikeJson(trimmed)) {
      drafts.push({
        name: safeName(`${stem}.json`),
        title: stem,
        kind: 'config',
        text: trimmed,
        language: 'json',
        description: 'Whole agent reply captured as a JSON document',
      });
    } else if (looksLikeCsv(trimmed)) {
      drafts.push({
        name: safeName(`${stem}.csv`),
        title: stem,
        kind: 'data',
        text: trimmed,
        language: 'csv',
        description: 'Whole agent reply captured as a CSV table',
      });
    }
  }

  return drafts;
}

/** True when a message contains something worth capturing — cheap pre-check. */
export function hasArtifacts(message: string): boolean {
  if (!message) return false;
  if (message.includes('```')) return true;
  const trimmed = message.trim();
  return looksLikeJson(trimmed) || looksLikeCsv(trimmed);
}
