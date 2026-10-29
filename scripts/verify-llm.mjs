#!/usr/bin/env node
/**
 * System-wide LLM verification.
 *
 *   node scripts/verify-llm.mjs                      # config sweep against localhost:3000
 *   node scripts/verify-llm.mjs --probe              # also send a real request to every keyed model,
 *                                                    # including up to 4 models per provider discovered live
 *   node scripts/verify-llm.mjs --base https://… --probe --md report.md
 *   node scripts/verify-llm.mjs --models openai/gpt-4o-mini,groq/llama-3.1-8b --probe
 *
 * Exit codes: 0 = every reachable model passed, 1 = at least one keyed model
 * failed, 2 = the console could not be reached.
 */
import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const flag = (name, short) => {
  const i = args.findIndex((arg) => arg === `--${name}` || arg === short);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name, short) => args.some((arg) => arg === `--${name}` || arg === short);

const base = (flag('base', '-b') || process.env.LLM_VERIFY_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const probe = has('probe', '-p');
const models = flag('models', '-m');
// --probe alone would only check curated entries; ask providers what they serve
const discover = has('discover', '-d') || (probe && !has('no-discover'));
const mdPath = flag('md');
const jsonPath = flag('json');

const params = new URLSearchParams();
if (probe) params.set('probe', '1');
if (discover) params.set('discover', '1');
if (models) params.set('models', models);

const url = `${base}/api/llm/verify${params.size ? `?${params}` : ''}`;
console.log(`→ ${url}`);

let report;
try {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    const body = await response.text();
    console.error(`✗ verification endpoint returned ${response.status}: ${body.slice(0, 300)}`);
    process.exit(2);
  }
  report = await response.json();
} catch (error) {
  console.error(`✗ cannot reach ${base}: ${error instanceof Error ? error.message : error}`);
  console.error('  start the app first: npm run build && npm run start');
  process.exit(2);
}

const glyph = (status) => {
  if (status.reachable === true) return 'PASS';
  if (!status.configured) return 'BLOCK';
  if (status.reachable === false) return 'FAIL';
  return 'SKIP';
};

const rows = report.models.map((entry) => ({
  status: glyph(entry),
  model: entry.id,
  provider: entry.provider,
  execution: entry.execution,
  latency: entry.latencyMs ? `${entry.latencyMs}ms` : '—',
  detail: entry.error ? `${entry.error.code}: ${entry.error.message}` : entry.evidence || '',
  fix: entry.error?.fix || '',
}));

const width = (key) => Math.max(key.length, ...rows.map((row) => String(row[key]).length));
const cols = ['status', 'model', 'execution', 'latency'];
const widths = Object.fromEntries(cols.map((col) => [col, width(col)]));

console.log('');
for (const row of rows) {
  console.log(
    `${row.status.padEnd(widths.status)}  ${row.model.padEnd(widths.model)}  ${String(row.execution).padEnd(widths.execution)}  ${String(row.latency).padEnd(widths.latency)}  ${row.detail.slice(0, 80)}`,
  );
}

console.log('\nproviders');
for (const provider of report.providers) {
  console.log(
    `  ${provider.configured ? '●' : '○'} ${provider.provider.padEnd(12)} ${provider.kind.padEnd(18)} ${provider.source.padEnd(5)} ${provider.baseUrl}${provider.note ? ` — ${provider.note}` : ''}`,
  );
}

console.log('\nservices');
for (const service of report.services) {
  console.log(`  ${service.status.padEnd(18)} ${service.name.padEnd(20)} ${service.detail}`);
}

const { summary } = report;
console.log(
  `\nsummary: ${summary.models} models · ${summary.configured} configured · ${summary.probed} probed · ${summary.passed} passed · ${summary.failed} failed · ${summary.blocked} blocked`,
);

if (mdPath) {
  const md = [
    `# LLM verification evidence`,
    '',
    `- endpoint: \`${url}\``,
    `- generated: ${report.generatedAt}`,
    `- runtime: node ${report.runtime.node} · region ${report.runtime.region}`,
    '',
    `## Summary`,
    '',
    '| metric | value |',
    '| --- | --- |',
    `| models | ${summary.models} |`,
    `| configured | ${summary.configured} |`,
    `| probed | ${summary.probed} |`,
    `| passed | ${summary.passed} |`,
    `| failed | ${summary.failed} |`,
    `| blocked (no credential) | ${summary.blocked} |`,
    '',
    '## Models',
    '',
    '| result | model | execution | latency | detail | fix |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map(
      (row) =>
        `| ${row.status} | \`${row.model}\` | ${row.execution} | ${row.latency} | ${row.detail.replaceAll('|', '\\|')} | ${row.fix.replaceAll('|', '\\|')} |`,
    ),
    '',
    '## Providers',
    '',
    '| provider | kind | configured | source | base url | note |',
    '| --- | --- | --- | --- | --- | --- |',
    ...report.providers.map(
      (provider) =>
        `| ${provider.provider} | ${provider.kind} | ${provider.configured ? 'yes' : 'no'} | ${provider.source} | ${provider.baseUrl || '—'} | ${provider.note || ''} |`,
    ),
    '',
    '## Services',
    '',
    '| service | status | detail | fix |',
    '| --- | --- | --- | --- |',
    ...report.services.map(
      (service) =>
        `| ${service.name} | ${service.status} | ${service.detail.replaceAll('|', '\\|')} | ${service.fix.replaceAll('|', '\\|')} |`,
    ),
    '',
  ].join('\n');

  await writeFile(mdPath, md, 'utf8');
  console.log(`\nmarkdown written to ${mdPath}`);
}

if (jsonPath) {
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`json written to ${jsonPath}`);
}

process.exit(summary.failed > 0 ? 1 : 0);
