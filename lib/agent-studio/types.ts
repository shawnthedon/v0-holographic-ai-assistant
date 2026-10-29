/**
 * Agent Studio — shared vocabulary.
 *
 * The studio composes an agent from the same categories the specification
 * names, and it refuses to claim a capability is usable unless every layer the
 * capability needs is actually present. Everything here is data: the catalogue
 * describes what *could* be selected, the draft records what *is* selected, and
 * validation is a pure function over the two.
 */

/** Categories map 1:1 to §7 of the specification. */
export type StudioCategory =
  | 'framework'
  | 'model'
  | 'memory'
  | 'behaviour'
  | 'interaction'
  | 'tools'
  | 'knowledge'
  | 'permissions';

export const CATEGORY_META: Record<
  StudioCategory,
  { label: string; short: string; order: number; description: string }
> = {
  framework: {
    label: 'Framework / runtime',
    short: 'RUNTIME',
    order: 1,
    description: 'What executes the agent, and what it can actually do.',
  },
  model: {
    label: 'AI brain',
    short: 'MODEL',
    order: 2,
    description: 'Provider, model and fallback route.',
  },
  memory: {
    label: 'Memory',
    short: 'MEMORY',
    order: 3,
    description: 'Context, persistence and recall — kept separate from knowledge.',
  },
  behaviour: {
    label: 'Behaviour & autonomy',
    short: 'BEHAVIOUR',
    order: 4,
    description: 'How far the agent may act on its own.',
  },
  interaction: {
    label: 'Interaction',
    short: 'CHANNEL',
    order: 5,
    description: 'How a person talks to the agent and gets answers back.',
  },
  tools: {
    label: 'Tools & connectors',
    short: 'TOOLS',
    order: 6,
    description: 'What the agent may touch in the outside world.',
  },
  knowledge: {
    label: 'Knowledge',
    short: 'KNOWLEDGE',
    order: 7,
    description: 'Source material the agent may read — data, never instruction.',
  },
  permissions: {
    label: 'Permissions',
    short: 'SCOPE',
    order: 8,
    description: 'What the agent is allowed to do, and where it must ask.',
  },
};

/**
 * Honest availability. `check-required` means we genuinely do not know yet and
 * must not treat the capability as working (spec §8.2 "Not checked").
 */
export type Availability = 'ready' | 'needs-setup' | 'check-required' | 'unsupported' | 'unavailable';

export const AVAILABILITY_META: Record<
  Availability,
  { label: string; tone: 'ok' | 'warn' | 'bad' | 'idle'; glyph: string; meaning: string }
> = {
  ready: {
    label: 'Ready',
    tone: 'ok',
    glyph: '◉',
    meaning: 'Every layer this needs is present and configured.',
  },
  'needs-setup': {
    label: 'Needs setup',
    tone: 'warn',
    glyph: '◍',
    meaning: 'Known step missing — credentials, an install, or a connection.',
  },
  'check-required': {
    label: 'Check required',
    tone: 'warn',
    glyph: '◌',
    meaning: 'Compatibility could not be proven. Treated as unproven, never as success.',
  },
  unsupported: {
    label: 'Unsupported',
    tone: 'bad',
    glyph: '⊗',
    meaning: 'This build cannot support it at all.',
  },
  unavailable: {
    label: 'Unavailable',
    tone: 'bad',
    glyph: '◒',
    meaning: 'Compatible, but the dependency is not reachable right now.',
  },
};

/** Features a capability can require or provide. Validation only trusts these. */
export type Feature =
  | 'text'
  | 'vision-in'
  | 'image-out'
  | 'audio-in'
  | 'audio-out'
  | 'tool-calling'
  | 'structured-output'
  | 'streaming'
  | 'cancellation'
  | 'checkpointing'
  | 'persistent-memory'
  | 'web-access'
  | 'file-ingest'
  | 'workspace-write';

/** Permission dimensions from §7.8. */
export type PermissionScope =
  | 'read'
  | 'write'
  | 'execute'
  | 'monitor'
  | 'send'
  | 'files'
  | 'share-with-agents'
  | 'approval';

export const PERMISSION_META: Record<PermissionScope, { label: string; risk: 'low' | 'medium' | 'high' }> = {
  read: { label: 'Read', risk: 'low' },
  write: { label: 'Write / update', risk: 'medium' },
  execute: { label: 'Execute actions', risk: 'high' },
  monitor: { label: 'Monitor / subscribe', risk: 'low' },
  send: { label: 'Send / communicate', risk: 'medium' },
  files: { label: 'Access files & knowledge', risk: 'medium' },
  'share-with-agents': { label: 'Share data with other agents', risk: 'high' },
  approval: { label: 'Request approval for restricted actions', risk: 'low' },
};

/** A setting the inspector renders for a capability. Values live in the draft. */
export type ConfigField =
  | {
      key: string;
      label: string;
      kind: 'select';
      options: Array<{ value: string; label: string; note?: string }>;
      default: string;
      help?: string;
    }
  | { key: string; label: string; kind: 'number'; min: number; max: number; step?: number; default: number; help?: string }
  | { key: string; label: string; kind: 'toggle'; default: boolean; help?: string };

export interface Capability {
  id: string;
  category: StudioCategory;
  name: string;
  /** One ordinary sentence — what this does for the user. */
  summary: string;
  /** Why the studio suggests it, in the user's terms. */
  rationale?: string;
  optional: boolean;
  /** What this capability needs from the rest of the agent. */
  requires: string[];
  provides: Feature[];
  permissions: PermissionScope[];
  limitations: string[];
  config: ConfigField[];
  /** Facts about the implementation — shown in the inspector, never guessed. */
  implementation?: string;
  licence?: string;
  /** Static availability; the live probe may raise or lower it. */
  availability: Availability;
  availabilityNote?: string;
  fix?: string;
}

/** Result of a live probe, keyed by capability id. */
export interface AvailabilityReport {
  capabilityId: string;
  availability: Availability;
  note: string;
  detail?: string;
  checkedAt: number;
}

export type StudioRole = 'research' | 'workflow' | 'coding' | 'monitoring' | 'ingestion' | 'orchestration';

export const ROLES: Array<{ id: StudioRole; label: string; hint: string; needs: string[] }> = [
  { id: 'research', label: 'Research', hint: 'Reads permitted sources and reports back.', needs: ['tools.browser'] },
  { id: 'workflow', label: 'Personal workflow', hint: 'Keeps track of tasks and drafts replies.', needs: [] },
  { id: 'coding', label: 'Coding support', hint: 'Writes and explains code in the workspace.', needs: ['tools.artifacts'] },
  { id: 'monitoring', label: 'Monitoring', hint: 'Watches an approved source and raises changes.', needs: ['tools.browser'] },
  { id: 'ingestion', label: 'Document ingestion', hint: 'Converts documents into notes you can search.', needs: ['tools.ingest'] },
  { id: 'orchestration', label: 'Team coordinator', hint: 'Delegates parts of a job to other agents.', needs: ['permissions.share-with-agents'] },
];

export interface AgentDraft {
  id: string;
  /** Display name. */
  name: string;
  goal: string;
  role: StudioRole | null;
  /** capability id → config values. Presence means "selected". */
  selected: Record<string, Record<string, string | number | boolean>>;
  /** Scopes the operator has explicitly granted. */
  granted: PermissionScope[];
  /** Acknowledged warning ids (spec: warnings may require acknowledgement). */
  acknowledged: string[];
  version: number;
  createdAt: number;
  updatedAt: number;
}

export type IssueSeverity = 'blocker' | 'warning' | 'note';

export interface ValidationIssue {
  id: string;
  severity: IssueSeverity;
  /** What is wrong, in plain language. */
  message: string;
  /** What to do about it. */
  fix: string;
  capabilityId?: string;
  /** Warnings must be acknowledged before activation (spec §8.2). */
  requiresAcknowledgement?: boolean;
}

export interface CapabilityVerdict {
  capabilityId: string;
  /** True only when every required layer supports it. */
  usable: boolean;
  availability: Availability;
  reasons: string[];
}

export interface ValidationResult {
  at: number;
  issues: ValidationIssue[];
  blockers: ValidationIssue[];
  warnings: ValidationIssue[];
  notes: ValidationIssue[];
  verdicts: Record<string, CapabilityVerdict>;
  /** Features the composed agent actually provides. */
  features: Feature[];
  permissions: PermissionScope[];
  /** Per-category state used by the palette and the map. */
  categories: Record<StudioCategory, Availability>;
  activatable: boolean;
}

export interface AgentConfigRecord {
  id: string;
  agentId: string;
  name: string;
  goal: string;
  role: StudioRole | null;
  version: number;
  createdAt: number;
  state: 'active' | 'draft';
  source: 'studio';
  selected: AgentDraft['selected'];
  granted: PermissionScope[];
  validation: {
    at: number;
    activatable: boolean;
    blockers: number;
    warnings: number;
    acknowledged: string[];
  };
  /** Honest statement about what activation did and did not do. */
  runtime: {
    connected: boolean;
    note: string;
  };
}
