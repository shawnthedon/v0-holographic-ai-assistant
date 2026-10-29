/**
 * Draft composition — pure operations over an `AgentDraft`.
 *
 * The UI never mutates a draft in place; it asks for the next one. That keeps
 * undo, autosave and the "edit creates a new version" rule trivial, and it means
 * the same functions run in tests without a browser.
 */

import { CAPABILITY_BY_ID, isSingleSelect } from './catalogue';
import type { AgentDraft, PermissionScope, StudioRole } from './types';

const DEFAULT_GRANTS: PermissionScope[] = [];

export function newDraft(overrides: Partial<AgentDraft> = {}): AgentDraft {
  const now = Date.now();
  return {
    id: `draft-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: 'Untitled agent',
    goal: '',
    role: null,
    selected: {},
    granted: [...DEFAULT_GRANTS],
    acknowledged: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function withDefaults(id: string, existing: Record<string, string | number | boolean> = {}) {
  const capability = CAPABILITY_BY_ID[id];
  const config: Record<string, string | number | boolean> = {};
  for (const field of capability?.config ?? []) config[field.key] = field.default;
  return { ...config, ...existing };
}

/** Selecting replaces a single-select sibling rather than stacking two runtimes. */
export function select(draft: AgentDraft, id: string): AgentDraft {
  const capability = CAPABILITY_BY_ID[id];
  if (!capability) return draft;

  const selected: AgentDraft['selected'] = { ...draft.selected };
  if (isSingleSelect(capability.category)) {
    for (const other of Object.keys(selected)) {
      if (CAPABILITY_BY_ID[other]?.category === capability.category) delete selected[other];
    }
  }
  selected[id] = withDefaults(id, selected[id]);

  // Selecting a runtime/model without a behaviour still needs the permission the
  // capability declares; the operator grants it explicitly, never implicitly.
  return { ...draft, selected, updatedAt: Date.now() };
}

export function deselect(draft: AgentDraft, id: string): AgentDraft {
  if (!draft.selected[id]) return draft;
  const selected = { ...draft.selected };
  delete selected[id];
  return { ...draft, selected, updatedAt: Date.now() };
}

export function toggle(draft: AgentDraft, id: string): AgentDraft {
  return draft.selected[id] ? deselect(draft, id) : select(draft, id);
}

export function configure(
  draft: AgentDraft,
  id: string,
  patch: Record<string, string | number | boolean>,
): AgentDraft {
  if (!draft.selected[id]) return draft;
  const selected = { ...draft.selected, [id]: { ...draft.selected[id], ...patch } };
  return { ...draft, selected, updatedAt: Date.now() };
}

export function grant(draft: AgentDraft, scope: PermissionScope): AgentDraft {
  if (draft.granted.includes(scope)) return draft;
  return { ...draft, granted: [...draft.granted, scope].sort(), updatedAt: Date.now() };
}

export function revoke(draft: AgentDraft, scope: PermissionScope): AgentDraft {
  if (!draft.granted.includes(scope)) return draft;
  return { ...draft, granted: draft.granted.filter((entry) => entry !== scope), updatedAt: Date.now() };
}

export function acknowledge(draft: AgentDraft, issueId: string): AgentDraft {
  if (draft.acknowledged.includes(issueId)) return draft;
  return { ...draft, acknowledged: [...draft.acknowledged, issueId], updatedAt: Date.now() };
}

export function unacknowledge(draft: AgentDraft, issueId: string): AgentDraft {
  return { ...draft, acknowledged: draft.acknowledged.filter((entry) => entry !== issueId), updatedAt: Date.now() };
}

export function rename(draft: AgentDraft, name: string): AgentDraft {
  return { ...draft, name: name.slice(0, 80), updatedAt: Date.now() };
}

export function describeRole(draft: AgentDraft, role: StudioRole | null): AgentDraft {
  return { ...draft, role, updatedAt: Date.now() };
}

export function setGoal(draft: AgentDraft, goal: string): AgentDraft {
  return { ...draft, goal: goal.slice(0, 2000), updatedAt: Date.now() };
}

/**
 * Editing an active configuration produces a new draft version (spec §5.4) —
 * the running agent keeps the version it started with.
 */
export function nextVersion(draft: AgentDraft): AgentDraft {
  return {
    ...draft,
    id: `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    version: draft.version + 1,
    acknowledged: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export interface DraftDiff {
  added: string[];
  removed: string[];
  reconfigured: Array<{ id: string; from: Record<string, string | number | boolean>; to: Record<string, string | number | boolean> }>;
  granted: PermissionScope[];
  revoked: PermissionScope[];
}

/** What actually changed between two drafts — shown before a new version is saved. */
export function diffDrafts(before: AgentDraft, after: AgentDraft): DraftDiff {
  const added = Object.keys(after.selected).filter((id) => !before.selected[id]);
  const removed = Object.keys(before.selected).filter((id) => !after.selected[id]);
  const reconfigured: DraftDiff['reconfigured'] = [];

  for (const id of Object.keys(after.selected)) {
    const previous = before.selected[id];
    const next = after.selected[id];
    if (!previous) continue;
    const changed = Object.keys(next).some((key) => previous[key] !== next[key]);
    if (changed) reconfigured.push({ id, from: previous, to: next });
  }

  return {
    added,
    removed,
    reconfigured,
    granted: after.granted.filter((scope) => !before.granted.includes(scope)),
    revoked: before.granted.filter((scope) => !after.granted.includes(scope)),
  };
}

export function isEmptyDiff(diff: DraftDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.reconfigured.length === 0 &&
    diff.granted.length === 0 &&
    diff.revoked.length === 0
  );
}

/* ------------------------------ templates ------------------------------- */

export interface Template {
  id: string;
  name: string;
  goal: string;
  role: StudioRole;
  why: string;
  selected: string[];
  granted: PermissionScope[];
}

/**
 * Templates are *starting points*, not promises: each one is validated like any
 * other draft, and the ones that need an uninstalled dependency say so.
 */
export const TEMPLATES: Template[] = [
  {
    id: 'research',
    name: 'Research brief',
    goal: 'Read the sources I allow and write a brief with citations.',
    role: 'research',
    why: 'Browsing role: needs the browser agent and read access.',
    selected: [
      'framework.task-runner',
      'model.brain',
      'memory.session',
      'behaviour.guided',
      'interaction.text',
      'tools.browser',
      'knowledge.web',
      'permissions.approval-gate',
    ],
    granted: ['read', 'execute', 'approval'],
  },
  {
    id: 'workflow',
    name: 'Daily workflow',
    goal: 'Keep my notes and drafts tidy without me asking each time.',
    role: 'workflow',
    why: 'Runs in the console, saves everything as a file you can inspect.',
    selected: [
      'framework.task-runner',
      'model.brain',
      'memory.session',
      'behaviour.guided',
      'interaction.text',
      'tools.artifacts',
      'permissions.approval-gate',
    ],
    granted: ['write', 'files', 'approval'],
  },
  {
    id: 'ingestion',
    name: 'Document intake',
    goal: 'Turn the documents I drop in into searchable notes.',
    role: 'ingestion',
    why: 'Ingestion role: text formats work today; PDF/Office need MarkItDown.',
    selected: [
      'framework.task-runner',
      'model.brain',
      'memory.session',
      'behaviour.guided',
      'interaction.text',
      'tools.ingest-local',
      'knowledge.uploads',
      'permissions.approval-gate',
    ],
    granted: ['files', 'read', 'approval'],
  },
  {
    id: 'monitoring',
    name: 'Site monitor',
    goal: 'Check an approved page on a schedule and tell me what changed.',
    role: 'monitoring',
    why: 'Monitoring role: bounded autonomy plus the browser agent.',
    selected: [
      'framework.task-runner',
      'model.brain',
      'memory.session',
      'behaviour.bounded',
      'interaction.text',
      'tools.browser',
      'permissions.approval-gate',
    ],
    granted: ['read', 'execute', 'monitor', 'approval'],
  },
];

export function fromTemplate(template: Template, models?: { defaultModel?: string; preferredProvider?: string }): AgentDraft {
  let draft = newDraft({ name: template.name, goal: template.goal, role: template.role });
  for (const id of template.selected) draft = select(draft, id);
  draft = { ...draft, granted: [...template.granted].sort(), updatedAt: Date.now() };
  if (models?.defaultModel && draft.selected['model.brain']) {
    draft = configure(draft, 'model.brain', { model: models.defaultModel });
  }
  return draft;
}
