#!/usr/bin/env node
/**
 * Agent Studio unit suite.
 *
 * The studio's honesty lives in pure functions: the catalogue, the draft
 * operations and the validation engine. This suite drives them directly — no
 * browser, no React — and asserts the rules from the Agent Creation
 * specification: fail closed, truthful capability display, explicit consent,
 * acknowledgement before activation, and a versioned edit path.
 *
 *   npm run test:studio
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const outDir = path.join(root, '.test-build', 'studio');

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
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

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const files = ['types.ts', 'catalogue.ts', 'draft.ts', 'validate.ts', 'store.ts'];
for (const file of files) {
  const source = await readFile(path.join(root, 'lib', 'agent-studio', file), 'utf8');
  let output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  output = output.replace(/from '\.\/([a-z-]+)'/g, "from './$1.mjs'");
  await writeFile(path.join(outDir, file.replace(/\.ts$/, '.mjs')), output, 'utf8');
}

const load = (name) => import(path.join(outDir, `${name}.mjs`));
const { CAPABILITIES, CAPABILITY_BY_ID, capabilitiesIn } = await load('catalogue');
const draftLib = await load('draft');
const validateLib = await load('validate');

const {
  newDraft,
  select,
  deselect,
  configure,
  grant,
  revoke,
  acknowledge,
  rename,
  diffDrafts,
  nextVersion,
  fromTemplate,
  TEMPLATES,
} = draftLib;
const { validateDraft, effectiveAvailability, activationSummary, requiredModelFeatures } = validateLib;

/* ------------------------------ fixtures -------------------------------- */

const MODELS = [
  {
    id: 'openrouter/test-chat',
    label: 'Test Chat',
    provider: 'openrouter',
    features: ['text', 'tool-calling'],
    configured: true,
  },
  {
    id: 'local/no-tools',
    label: 'Local (text only)',
    provider: 'ollama',
    features: ['text'],
    configured: true,
  },
  {
    id: 'cloud/unconfigured',
    label: 'Unconfigured',
    provider: 'openai',
    features: ['text'],
    configured: false,
  },
  {
    id: 'cloud/voice',
    label: 'Voice model',
    provider: 'openai',
    features: ['text', 'audio-in', 'audio-out', 'vision-in'],
    configured: true,
  },
];

/** A configuration that should be activatable once warnings are acknowledged. */
function validDraft() {
  let draft = newDraft({ name: 'Brief writer', goal: 'Read the pages I allow and write a brief.' });
  for (const id of [
    'framework.task-runner',
    'model.brain',
    'memory.session',
    'behaviour.guided',
    'interaction.text',
    'tools.artifacts',
    'knowledge.artifacts',
    'permissions.approval-gate',
  ]) {
    draft = select(draft, id);
  }
  draft = configure(draft, 'model.brain', { model: 'openrouter/test-chat' });
  for (const scope of ['execute', 'write', 'files', 'read']) draft = grant(draft, scope);
  draft = acknowledge(draft, 'memory:session-only');
  return draft;
}

const validate = (draft, extra = {}) =>
  validateDraft({ draft, models: MODELS, ...extra });

const ids = (result) => result.issues.map((issue) => issue.id);

/* ------------------------------ catalogue ------------------------------- */

await check('every capability id is unique', () => {
  const seen = new Set();
  for (const capability of CAPABILITIES) {
    assert(!seen.has(capability.id), `duplicate id ${capability.id}`);
    seen.add(capability.id);
  }
});

await check('every dependency points at a real capability', () => {
  for (const capability of CAPABILITIES) {
    for (const requirement of capability.requires) {
      assert(CAPABILITY_BY_ID[requirement], `${capability.id} requires unknown ${requirement}`);
    }
  }
});

await check('every capability states a limit or an availability note', () => {
  for (const capability of CAPABILITIES) {
    const honest = capability.limitations.length > 0 || Boolean(capability.availabilityNote);
    assert(honest, `${capability.id} claims availability without saying anything about limits`);
  }
});

await check('anything that is not ready carries a fix or a note', () => {
  for (const capability of CAPABILITIES) {
    if (capability.availability === 'ready') continue;
    assert(
      Boolean(capability.fix) || Boolean(capability.availabilityNote),
      `${capability.id} is ${capability.availability} but explains nothing`,
    );
  }
});

await check('every category in the palette has at least one option', () => {
  for (const category of ['framework', 'model', 'memory', 'behaviour', 'interaction', 'tools', 'knowledge', 'permissions']) {
    assert(capabilitiesIn(category).length > 0, `no capabilities for ${category}`);
  }
});

await check('uninstalled runtimes are marked needs-setup, never ready', () => {
  for (const id of ['framework.langgraph', 'framework.crewai', 'framework.ag2', 'framework.openclaw']) {
    assertEqual(CAPABILITY_BY_ID[id].availability, 'needs-setup', id);
  }
  assertEqual(CAPABILITY_BY_ID['framework.task-runner'].availability, 'ready', 'task runner');
});

/* --------------------------- draft operations --------------------------- */

await check('a new draft is empty and versioned', () => {
  const draft = newDraft();
  assertEqual(Object.keys(draft.selected).length, 0, 'selected');
  assertEqual(draft.version, 1, 'version');
  assert(draft.id.startsWith('draft-'), 'id');
});

await check('single-select categories replace rather than stack', () => {
  let draft = select(newDraft(), 'framework.langgraph');
  draft = select(draft, 'framework.task-runner');
  const frameworks = Object.keys(draft.selected).filter((id) => id.startsWith('framework.'));
  assertEqual(frameworks.length, 1, 'frameworks');
  assertEqual(frameworks[0], 'framework.task-runner', 'winner');
});

await check('selecting applies the declared defaults', () => {
  const draft = select(newDraft(), 'framework.task-runner');
  assertEqual(draft.selected['framework.task-runner'].maxSteps, 40, 'maxSteps');
  assertEqual(draft.selected['framework.task-runner'].maxMinutes, 30, 'maxMinutes');
});

await check('deselect removes a capability', () => {
  let draft = select(newDraft(), 'tools.artifacts');
  draft = deselect(draft, 'tools.artifacts');
  assert(!draft.selected['tools.artifacts'], 'still selected');
});

await check('acknowledgement is idempotent and reversible', () => {
  let draft = acknowledge(newDraft(), 'memory:session-only');
  draft = acknowledge(draft, 'memory:session-only');
  assertEqual(draft.acknowledged.length, 1, 'acknowledged');
  const undone = draftLib.unacknowledge(draft, 'memory:session-only');
  assertEqual(undone.acknowledged.length, 0, 'undone');
});

await check('editing an active record creates a new version', () => {
  const next = nextVersion(validDraft());
  assertEqual(next.version, 2, 'version');
  assertEqual(next.acknowledged.length, 0, 'acknowledgements reset');
});

await check('diff reports real changes only', () => {
  const before = validDraft();
  const after = grant(rename(select(before, 'tools.browser'), 'New name'), 'monitor');
  const diff = diffDrafts(before, after);
  assertEqual(diff.added.join(','), 'tools.browser', 'added');
  assert(diff.granted.includes('monitor'), 'granted');
  assertEqual(diff.removed.length, 0, 'removed');
  assert(!diffDrafts(before, before).reconfigured.length, 'no-op diff reconfigured');
});

/* ----------------------------- validation ------------------------------- */

await check('an empty draft is blocked on the three essentials', () => {
  const result = validate(newDraft());
  for (const id of ['framework:missing', 'behaviour:missing', 'interaction:missing']) {
    assert(ids(result).includes(id), `missing ${id}`);
  }
  assert(!result.activatable, 'empty draft must not be activatable');
});

await check('an uninstalled runtime blocks activation and explains why', () => {
  let draft = validDraft();
  draft = select(draft, 'framework.langgraph');
  const result = validate(draft);
  const blocker = result.blockers.find((entry) => entry.id === 'setup:framework.langgraph');
  assert(blocker, `expected setup blocker, got ${ids(result).join(', ')}`);
  assert(blocker.fix.includes('AGENT_RUNTIME_LANGGRAPH_URL'), 'fix must name the variable');
  assert(!result.activatable, 'must not activate');
});

await check('a complete configuration becomes activatable after acknowledgement', () => {
  const draft = validDraft();
  const result = validate(draft);
  assertEqual(result.blockers.length, 0, `blockers: ${ids(result).join(', ')}`);
  assertEqual(result.warnings.length, 0, `warnings: ${ids(result).join(', ')}`);
  assert(result.activatable, 'should be activatable');
});

await check('an unacknowledged warning blocks activation', () => {
  let draft = validDraft();
  draft = draftLib.unacknowledge(draft, 'memory:session-only');
  const result = validate(draft);
  assert(ids(result).includes('memory:session-only'), 'warning missing');
  assert(!result.activatable, 'unacknowledged warning must block');
  const acknowledged = validate(acknowledge(draft, 'memory:session-only'));
  assert(acknowledged.activatable, 'acknowledging must unblock');
});

await check('memory is never claimed when nothing persistent is connected', () => {
  const draft = validDraft();
  const result = validate(draft);
  assert(!result.features.includes('persistent-memory'), 'session memory must not claim persistence');
});

await check('an unconfigured provider blocks the route', () => {
  let draft = validDraft();
  draft = configure(draft, 'model.brain', { model: 'cloud/unconfigured' });
  const result = validate(draft);
  assert(ids(result).includes('model:not-configured'), ids(result).join(', '));
});

await check('a missing permission scope blocks and names the scope', () => {
  let draft = validDraft();
  draft = revoke(draft, 'execute');
  const result = validate(draft);
  const blocker = result.blockers.find((entry) => entry.id === 'scope:execute');
  assert(blocker, ids(result).join(', '));
  assert(/grant/i.test(blocker.fix), 'fix must tell the operator to grant it');
});

await check('a capability without its dependency is blocked', () => {
  let draft = validDraft();
  draft = deselect(draft, 'permissions.approval-gate');
  draft = select(draft, 'behaviour.bounded');
  const result = validate(draft);
  assert(ids(result).includes('requires:behaviour.bounded->permissions.approval-gate'), ids(result).join(', '));
});

await check('a role requirement is enforced', () => {
  const draft = { ...validDraft(), role: 'research' };
  const result = validate(draft);
  assert(ids(result).includes('role:research->tools.browser'), ids(result).join(', '));
});

await check('an unproven capability is a warning, not a silent pass', () => {
  let draft = validDraft();
  draft = select(draft, 'interaction.voice-out');
  const result = validate(draft, {
    availability: {
      'interaction.voice-out': {
        capabilityId: 'interaction.voice-out',
        availability: 'check-required',
        note: 'no speech credentials',
        checkedAt: Date.now(),
      },
    },
  });
  const warning = result.warnings.find((entry) => entry.id === 'unproven:interaction.voice-out');
  assert(warning, ids(result).join(', '));
  assert(warning.requiresAcknowledgement, 'must require acknowledgement');
  assert(!result.activatable, 'unproven capability must not activate');
});

await check('a voice channel on a model without audio is blocked', () => {
  let draft = validDraft();
  draft = select(draft, 'interaction.voice-out');
  draft = acknowledge(draft, 'unproven:interaction.voice-out');
  const result = validate(draft);
  assert(ids(result).includes('feature:audio-out'), ids(result).join(', '));
});

await check('the same channel passes on a model that declares audio', () => {
  let draft = validDraft();
  draft = configure(draft, 'model.brain', { model: 'cloud/voice' });
  draft = select(draft, 'interaction.voice-in');
  const result = validate(draft, {
    availability: {
      'interaction.voice-in': {
        capabilityId: 'interaction.voice-in',
        availability: 'ready',
        note: 'speech-to-text configured',
        checkedAt: Date.now(),
      },
    },
  });
  assert(!ids(result).includes('feature:audio-in'), ids(result).join(', '));
});

await check('an incompatible fallback is called out', () => {
  let draft = validDraft();
  draft = select(draft, 'tools.browser');
  draft = acknowledge(draft, 'unproven:tools.browser');
  draft = configure(draft, 'model.brain', { fallbackModel: 'local/no-tools' });
  const result = validate(draft, {
    availability: {
      'tools.browser': {
        capabilityId: 'tools.browser',
        availability: 'ready',
        note: 'browser ready',
        checkedAt: Date.now(),
      },
    },
  });
  assert(ids(result).includes('fallback:incompatible'), ids(result).join(', '));
});

await check('features come only from usable capabilities', () => {
  let draft = validDraft();
  draft = revoke(draft, 'write');
  const result = validate(draft);
  assert(!result.features.includes('workspace-write'), 'a blocked tool must not grant features');
  assert(!result.verdicts['tools.artifacts'].usable, 'artifact tool must be unusable without its scope');
});

await check('verdicts propagate through dependencies', () => {
  let draft = validDraft();
  draft = select(draft, 'tools.browser');
  draft = select(draft, 'knowledge.web');
  draft = acknowledge(draft, 'unproven:tools.browser');
  draft = revoke(draft, 'execute');
  const result = validate(draft);
  assert(!result.verdicts['tools.browser'].usable, 'browser tool should be unusable');
  assert(!result.verdicts['knowledge.web'].usable, 'dependent knowledge should follow');
});

await check('a zero limit is refused', () => {
  let draft = validDraft();
  draft = configure(draft, 'framework.task-runner', { maxSteps: 0 });
  const result = validate(draft);
  assert(ids(result).some((id) => id.startsWith('limit:')), ids(result).join(', '));
});

await check('an unknown component fails closed', () => {
  const draft = { ...validDraft(), selected: { ...validDraft().selected, 'tools.telepathy': {} } };
  const result = validate(draft);
  assert(ids(result).includes('unknown:tools.telepathy'), ids(result).join(', '));
  assert(!result.activatable, 'unknown component must block');
});

await check('a probe can lower availability but never raise a blocked state', () => {
  const lowered = validate(validDraft(), {
    availability: {
      'tools.artifacts': {
        capabilityId: 'tools.artifacts',
        availability: 'unavailable',
        note: 'storage is full',
        checkedAt: Date.now(),
      },
    },
  });
  assert(ids(lowered).includes('unavailable:tools.artifacts'), ids(lowered).join(', '));

  assertEqual(
    effectiveAvailability('tools.artifacts', {
      'tools.artifacts': { capabilityId: 'tools.artifacts', availability: 'ready', note: 'ok', checkedAt: Date.now() },
    }),
    'ready',
    'probe confirms',
  );
});

await check('an availability report can confirm a needs-setup runtime', () => {
  const result = validate({ ...validDraft(), selected: { ...validDraft().selected, 'framework.langgraph': { maxSteps: 60, maxMinutes: 45 } } }, {
    availability: {
      'framework.langgraph': {
        capabilityId: 'framework.langgraph',
        availability: 'ready',
        note: 'runtime reachable',
        checkedAt: Date.now(),
      },
    },
  });
  assert(!ids(result).includes('setup:framework.langgraph'), ids(result).join(', '));
  assert(result.features.includes('checkpointing'), 'runtime features should carry through');
});

/* ----------------------------- templates -------------------------------- */

await check('every template produces a validated draft', () => {
  for (const template of TEMPLATES) {
    const draft = fromTemplate(template);
    const result = validate(draft);
    assert(Array.isArray(result.issues), `${template.id} produced no result`);
    assert(Object.keys(draft.selected).length >= 5, `${template.id} selected too little`);
    assert(draft.granted.length > 0, `${template.id} grants nothing`);
    for (const issue of result.blockers) {
      assert(typeof issue.fix === 'string' && issue.fix.length > 8, `${template.id}: blocker without a fix`);
    }
  }
});

await check('the research template requires the browser tool', () => {
  const draft = fromTemplate(TEMPLATES.find((template) => template.id === 'research'));
  const result = validate(draft);
  assert(!ids(result).includes('role:research->tools.browser'), 'browser tool missing from template');
});

/* --------------------------- activation summary -------------------------- */

await check('the activation summary discloses access and limits', () => {
  const summary = activationSummary({ draft: validDraft(), models: MODELS });
  assert(summary.valid, 'should validate');
  assert(summary.dataAccess.some((entry) => entry.startsWith('write:')), 'write access missing');
  assert(summary.limits.some((entry) => /steps/.test(entry)), 'limits missing');
  assert(summary.capabilities.length >= 6, 'capabilities missing');
});

await check('the activation summary refuses a blocked draft', () => {
  const summary = activationSummary({ draft: newDraft(), models: MODELS });
  assert(!summary.valid, 'empty draft reported as valid');
  assert(summary.blockers.length >= 3, 'blockers missing');
});

await check('required model features follow the composition', () => {
  assert(requiredModelFeatures(['interaction.text']).includes('text'), 'text');
  assert(requiredModelFeatures(['interaction.voice-in']).includes('audio-in'), 'audio');
  assert(requiredModelFeatures(['tools.browser']).includes('tool-calling'), 'tool calling');
});

/* -------------------------------- store ---------------------------------- */

const record = (version, state = 'active') => ({
  id: `agent-test-v${version}`,
  agentId: 'agent-test',
  name: 'Test agent',
  goal: 'test',
  role: null,
  version,
  createdAt: Date.now(),
  state,
  source: 'studio',
  selected: { 'framework.task-runner': { maxSteps: 40, maxMinutes: 30 } },
  granted: ['execute'],
  validation: { at: Date.now(), activatable: true, blockers: 0, warnings: 0, acknowledged: [] },
  runtime: { connected: true, note: 'runtime connected' },
});

await (async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'agent-studio-'));
  process.env.AGENT_STUDIO_DIR = dir;
  const store = await load('store');

  await check('a version is written atomically and read back', async () => {
    const saved = await store.saveVersion(record(1));
    assertEqual(saved.versions.length, 1, 'versions');
    const loaded = await store.getAgent('agent-test');
    assertEqual(loaded.name, 'Test agent', 'name');
    assertEqual(loaded.versions[0].version, 1, 'version');
  });

  await check('the same version replaces itself instead of duplicating', async () => {
    await store.saveVersion(record(1));
    const saved = await store.getAgent('agent-test');
    assertEqual(saved.versions.length, 1, 'versions after rewrite');
  });

  await check('a new version is appended after the old one', async () => {
    const saved = await store.saveVersion(record(2));
    assertEqual(saved.versions.length, 2, 'versions');
    assertEqual(saved.versions[1].version, 2, 'newest last');
  });

  await check('pausing changes the latest version state only', async () => {
    const paused = await store.setAgentState('agent-test', 'draft');
    assert(paused, 'the record disappeared before it could be paused');
    assertEqual(paused.versions[1].state, 'draft', 'latest');
    assertEqual(paused.versions[0].state, 'active', 'history untouched');
  });

  await check('the listing is newest first and survives a missing file', async () => {
    await store.saveVersion({ ...record(3), agentId: 'agent-other', name: 'Other' });
    const list = await store.listAgents();
    assert(list.length >= 2, `expected at least 2 agents, got ${list.length}`);
    assertEqual(await store.getAgent('does-not-exist'), null, 'missing agent');
  });

  await check('deleting removes the record', async () => {
    const listBefore = await store.listAgents();
    const ok = await store.deleteAgent('agent-other');
    assert(ok, `delete failed; known=${listBefore.map((entry) => entry.agentId).join(',')}; dir=${process.env.AGENT_STUDIO_DIR}`);
    assertEqual(await store.getAgent('agent-other'), null, 'still present');
  });

  await rm(dir, { recursive: true, force: true });
})();

/* ------------------------------- report --------------------------------- */

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.log(`  • ${failure.name}: ${failure.error.message}`);
}
process.exit(failures.length === 0 ? 0 : 1);
