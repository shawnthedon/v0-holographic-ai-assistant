/**
 * Validation — the part of the studio that is allowed to say no.
 *
 * Pure functions: same draft + same probe report = same verdict, which is what
 * makes it testable and what stops the UI from "passing" a configuration by
 * rendering it differently.
 *
 * Three rules dominate:
 *   1. A capability is usable only when *every* layer supports it (spec §8.1).
 *   2. Missing or unknown dependencies are never success (fail closed).
 *   3. Warnings that matter must be acknowledged before activation (spec §8.2).
 */

import {
  CAPABILITY_BY_ID,
  CAPABILITIES,
  ROLE_REQUIREMENTS,
  capabilitiesIn,
} from './catalogue';
import {
  CATEGORY_META,
  type AgentDraft,
  type Availability,
  type AvailabilityReport,
  type CapabilityVerdict,
  type Feature,
  type PermissionScope,
  type StudioCategory,
  type ValidationIssue,
  type ValidationResult,
} from './types';

/** A model the deployment can actually route to, with the features it declares. */
export interface ModelOption {
  id: string;
  label: string;
  provider: string;
  features: Feature[];
  configured: boolean;
  note?: string;
}

export interface ValidationInput {
  draft: AgentDraft;
  /** Live probe results, keyed by capability id. Missing ⇒ fall back to static truth. */
  availability?: Record<string, AvailabilityReport | undefined>;
  models?: ModelOption[];
}

const SEVERITY_ORDER: Record<ValidationIssue['severity'], number> = { blocker: 0, warning: 1, note: 2 };

/** Static truth can only be confirmed or lowered by a live probe. */
export function effectiveAvailability(id: string, reports?: ValidationInput['availability']): Availability {
  const capability = CAPABILITY_BY_ID[id];
  if (!capability) return 'unsupported';
  const report = reports?.[id];
  if (!report) return capability.availability;
  if (capability.availability === 'unsupported') return 'unsupported';
  return report.availability;
}

export function availabilityReason(id: string, reports?: ValidationInput['availability']): string {
  const report = reports?.[id];
  if (report?.note) return report.note;
  return CAPABILITY_BY_ID[id]?.availabilityNote ?? '';
}

function issue(
  id: string,
  severity: ValidationIssue['severity'],
  message: string,
  fix: string,
  extra: Partial<ValidationIssue> = {},
): ValidationIssue {
  return { id, severity, message, fix, ...extra };
}

export function validateDraft(input: ValidationInput): ValidationResult {
  const { draft, availability, models = [] } = input;
  const selectedIds = Object.keys(draft.selected);
  const issues: ValidationIssue[] = [];
  const granted = new Set<PermissionScope>(draft.granted);

  /* --------------------------- 1. composition --------------------------- */

  const frameworks = selectedIds.filter((id) => CAPABILITY_BY_ID[id]?.category === 'framework');
  const behaviours = selectedIds.filter((id) => CAPABILITY_BY_ID[id]?.category === 'behaviour');
  const interactions = selectedIds.filter((id) => CAPABILITY_BY_ID[id]?.category === 'interaction');
  const memories = selectedIds.filter((id) => CAPABILITY_BY_ID[id]?.category === 'memory');

  if (frameworks.length === 0) {
    issues.push(
      issue(
        'framework:missing',
        'blocker',
        'No runtime selected — nothing can execute this agent.',
        'Pick a runtime in the Framework panel. Only runtimes marked Ready can run today.',
      ),
    );
  }
  if (frameworks.length > 1) {
    issues.push(
      issue(
        'framework:multiple',
        'blocker',
        `${frameworks.length} runtimes selected; an agent runs on one.`,
        `Keep the executor you trust and remove the rest (${frameworks.join(', ')}).`,
      ),
    );
  }
  if (behaviours.length === 0) {
    issues.push(
      issue('behaviour:missing', 'blocker', 'No behaviour selected — the agent has no operating mode.', 'Choose Respond only, Guided, Bounded or Scheduled.'),
    );
  }
  if (behaviours.length > 1) {
    issues.push(
      issue('behaviour:multiple', 'blocker', 'Two behaviours selected.', 'An agent has exactly one operating mode; remove the extra one.'),
    );
  }
  if (interactions.length === 0) {
    issues.push(
      issue('interaction:missing', 'blocker', 'No interaction channel — the agent cannot be reached.', 'Add Text chat, or a voice/image channel.'),
    );
  }
  if (memories.length === 0) {
    issues.push(
      issue(
        'memory:none',
        'warning',
        'No memory layer selected. The agent starts every run with nothing.',
        'Add Session memory at minimum, or connect SuperLocalMemory for persistence.',
        { requiresAcknowledgement: true },
      ),
    );
  }

  /* ------------------------- 2. dependency graph ------------------------ */

  for (const id of selectedIds) {
    const capability = CAPABILITY_BY_ID[id];
    if (!capability) continue;
    for (const requirement of capability.requires) {
      if (draft.selected[requirement]) continue;
      const needed = CAPABILITY_BY_ID[requirement];
      issues.push(
        issue(
          `requires:${id}->${requirement}`,
          'blocker',
          `${capability.name} needs ${needed?.name ?? requirement}.`,
          `Add ${needed?.name ?? requirement}, or remove ${capability.name}.`,
          { capabilityId: id },
        ),
      );
    }
  }

  /* --------------------------- 3. availability -------------------------- */

  for (const id of selectedIds) {
    const capability = CAPABILITY_BY_ID[id];
    if (!capability) {
      issues.push(issue(`unknown:${id}`, 'blocker', `Unknown component "${id}".`, 'Remove it — the catalogue does not contain it.'));
      continue;
    }
    const state = effectiveAvailability(id, availability);
    const reason = availabilityReason(id, availability);
    if (state === 'needs-setup') {
      issues.push(
        issue(`setup:${id}`, 'blocker', `${capability.name}: ${reason || 'setup required.'}`, capability.fix ?? 'Complete the setup, then re-run the check.', {
          capabilityId: id,
        }),
      );
    } else if (state === 'unavailable') {
      issues.push(
        issue(`unavailable:${id}`, 'blocker', `${capability.name} is unreachable right now.`, capability.fix ?? 'Restore the dependency and re-check.', {
          capabilityId: id,
        }),
      );
    } else if (state === 'unsupported') {
      issues.push(
        issue(`unsupported:${id}`, 'blocker', `${capability.name} cannot be supported by this build.`, 'Remove it and use a supported alternative.', {
          capabilityId: id,
        }),
      );
    } else if (state === 'check-required') {
      issues.push(
        issue(
          `unproven:${id}`,
          'warning',
          `${capability.name}: compatibility is not proven${reason ? ` — ${reason}` : ''}.`,
          'Run the connection check. Until it passes this stays unproven, not working.',
          { capabilityId: id, requiresAcknowledgement: true },
        ),
      );
    }
  }

  /* ----------------------------- 4. model ------------------------------- */

  let routedModel: ModelOption | undefined;
  if (draft.selected['model.brain']) {
    const config = draft.selected['model.brain'];
    const modelId = typeof config.model === 'string' ? config.model : '';
    if (!modelId) {
      issues.push(
        issue('model:unrouted', 'blocker', 'No model chosen for the AI brain.', 'Open the model route and pick a model from the live catalogue.'),
      );
    } else {
      routedModel = models.find((model) => model.id === modelId);
      if (models.length > 0 && !routedModel) {
        issues.push(
          issue('model:unknown', 'blocker', `Model "${modelId}" is not in the live catalogue.`, 'Rediscover models, then choose one that is listed.'),
        );
      } else if (routedModel && !routedModel.configured) {
        issues.push(
          issue(
            'model:not-configured',
            'blocker',
            `${routedModel.label} needs credentials for ${routedModel.provider}.`,
            'Add the provider key in Settings, or route to an already-configured provider.',
          ),
        );
      }
    }

    const fallbackId = typeof config.fallbackModel === 'string' ? config.fallbackModel : '';
    if (fallbackId && routedModel && models.length > 0) {
      const fallback = models.find((model) => model.id === fallbackId);
      const needed = requiredModelFeatures(selectedIds);
      const missing = needed.filter((feature) => !fallback?.features.includes(feature));
      if (!fallback) {
        issues.push(
          issue('fallback:unknown', 'warning', `Fallback "${fallbackId}" is not in the live catalogue.`, 'Pick a fallback that exists, or none.', {
            requiresAcknowledgement: true,
          }),
        );
      } else if (missing.length > 0) {
        issues.push(
          issue(
            'fallback:incompatible',
            'warning',
            `${fallback.label} cannot cover this agent (missing ${missing.join(', ')}).`,
            'Choose a fallback that supports every feature the agent uses, or accept that a failure stops the run.',
            { requiresAcknowledgement: true },
          ),
        );
      }
    }
  }

  /* ---------------------- 5. model feature support ---------------------- */

  const required = requiredModelFeatures(selectedIds);
  if (routedModel) {
    for (const feature of required) {
      if (routedModel.features.includes(feature)) continue;
      const blocking = feature === 'audio-in' || feature === 'audio-out' || feature === 'vision-in';
      issues.push(
        issue(
          `feature:${feature}`,
          blocking ? 'blocker' : 'warning',
          blocking
            ? `${routedModel.label} does not support ${featureLabel(feature)}, so that channel cannot work.`
            : `${routedModel.label} does not declare ${featureLabel(feature)}.`,
          blocking
            ? `Route to a model that supports ${featureLabel(feature)}, or remove the channel that needs it.`
            : 'Confirm the model supports it, or remove the channel that needs it.',
          { requiresAcknowledgement: !blocking },
        ),
      );
    }
  }

  /* --------------------------- 6. permissions --------------------------- */

  const neededScopes = new Map<PermissionScope, string[]>();
  for (const id of selectedIds) {
    const capability = CAPABILITY_BY_ID[id];
    if (!capability) continue;
    for (const scope of capability.permissions) {
      if (scope === 'approval') continue;
      const list = neededScopes.get(scope) ?? [];
      list.push(capability.name);
      neededScopes.set(scope, list);
    }
  }
  for (const [scope, owners] of neededScopes) {
    if (granted.has(scope)) continue;
    issues.push(
      issue(
        `scope:${scope}`,
        'blocker',
        `${scope} access is needed by ${owners.join(', ')} but has not been granted.`,
        `Grant ${scope} explicitly in the Permissions panel — the agent cannot grant it to itself.`,
      ),
    );
  }

  /* ------------------------- 7. role requirements ----------------------- */

  if (draft.role) {
    for (const requirement of ROLE_REQUIREMENTS[draft.role] ?? []) {
      if (draft.selected[requirement]) continue;
      const needed = CAPABILITY_BY_ID[requirement];
      issues.push(
        issue(
          `role:${draft.role}->${requirement}`,
          'blocker',
          `A ${draft.role} agent needs ${needed?.name ?? requirement}.`,
          `Add ${needed?.name ?? requirement}, or change the role.`,
        ),
      );
    }
  }

  /* ------------------- 8. addendum: memory must be declared ------------- */

  const persistentMemoryReady =
    Boolean(draft.selected['memory.superlocal']) && effectiveAvailability('memory.superlocal', availability) === 'ready';
  if (!persistentMemoryReady) {
    issues.push(
      issue(
        'memory:session-only',
        'warning',
        draft.selected['memory.superlocal']
          ? 'SuperLocalMemory is selected but not connected — nothing will persist.'
          : 'Memory is session-only: nothing is remembered between runs.',
        'Connect SuperLocalMemory and run a write-and-recall test, or accept that this agent forgets.',
        { requiresAcknowledgement: true, capabilityId: 'memory.superlocal' },
      ),
    );
  }

  /* ------------------------------ 9. limits ----------------------------- */

  for (const id of selectedIds) {
    const capability = CAPABILITY_BY_ID[id];
    if (!capability) continue;
    const config = draft.selected[id];
    for (const field of capability.config) {
      if (field.kind === 'number' && (field.key === 'maxSteps' || field.key === 'maxMinutes')) {
        const value = Number(config[field.key]);
        if (!Number.isFinite(value) || value < field.min) {
          issues.push(
            issue(
              `limit:${id}:${field.key}`,
              'blocker',
              `${capability.name}: ${field.label.toLowerCase()} is not set.`,
              'Enter a limit — unattended work needs a hard stop.',
              { capabilityId: id },
            ),
          );
        }
      }
    }
  }

  /* -------------------------- 10. acknowledged -------------------------- */

  const acknowledged = new Set(draft.acknowledged);
  for (const entry of issues) {
    if (entry.requiresAcknowledgement && acknowledged.has(entry.id)) {
      entry.severity = 'note';
      entry.message = `${entry.message} (acknowledged)`;
    }
  }

  /* ----------------------------- verdicts ------------------------------- */

  const verdicts: Record<string, CapabilityVerdict> = {};
  const features = new Set<Feature>();
  const permissions = new Set<PermissionScope>();
  const computeVerdict = (id: string, seen: Set<string>): CapabilityVerdict => {
    const cached = verdicts[id];
    if (cached) return cached;
    const capability = CAPABILITY_BY_ID[id];
    const state = effectiveAvailability(id, availability);
    const reasons: string[] = [];
    let usable = state === 'ready';
    if (!capability) {
      return { capabilityId: id, usable: false, availability: 'unsupported', reasons: ['unknown component'] };
    }
    if (state !== 'ready') {
      reasons.push(availabilityReason(id, availability) || `state: ${state}`);
    }
    if (seen.has(id)) {
      // A cycle in the catalogue is a bug, not a feature: fail closed.
      return { capabilityId: id, usable: false, availability: state, reasons: ['dependency cycle'] };
    }
    seen.add(id);
    for (const requirement of capability.requires) {
      if (!draft.selected[requirement]) {
        usable = false;
        reasons.push(`missing ${CAPABILITY_BY_ID[requirement]?.name ?? requirement}`);
        continue;
      }
      const parent = computeVerdict(requirement, seen);
      if (!parent.usable) {
        usable = false;
        reasons.push(`${CAPABILITY_BY_ID[requirement]?.name ?? requirement} not usable`);
      }
    }
    for (const scope of capability.permissions) {
      if (scope === 'approval') continue;
      if (!granted.has(scope)) {
        usable = false;
        reasons.push(`${scope} not granted`);
      }
    }
    seen.delete(id);
    const verdict: CapabilityVerdict = { capabilityId: id, usable, availability: state, reasons };
    verdicts[id] = verdict;
    return verdict;
  };

  for (const id of selectedIds) {
    const verdict = computeVerdict(id, new Set());
    if (!verdict.usable) continue;
    const capability = CAPABILITY_BY_ID[id];
    if (!capability) continue;
    capability.provides.forEach((feature) => features.add(feature));
    capability.permissions.forEach((scope) => permissions.add(scope));
  }

  /* ---------------------- per-category availability --------------------- */

  const categories = {} as Record<StudioCategory, Availability>;
  const rank: Record<Availability, number> = {
    ready: 4,
    'check-required': 3,
    'needs-setup': 2,
    unavailable: 1,
    unsupported: 0,
  };
  for (const category of Object.keys(CATEGORY_META) as StudioCategory[]) {
    const options = capabilitiesIn(category);
    const best = options.reduce<Availability>(
      (winner, option) =>
        rank[effectiveAvailability(option.id, availability)] > rank[winner]
          ? effectiveAvailability(option.id, availability)
          : winner,
      'unsupported',
    );
    categories[category] = best;
  }

  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const blockers = issues.filter((entry) => entry.severity === 'blocker');
  const warnings = issues.filter((entry) => entry.severity === 'warning');
  const notes = issues.filter((entry) => entry.severity === 'note');

  return {
    at: Date.now(),
    issues,
    blockers,
    warnings,
    notes,
    verdicts,
    features: Array.from(features).sort(),
    permissions: Array.from(permissions).sort(),
    categories,
    activatable: blockers.length === 0 && warnings.length === 0,
  };
}

/** Features the routed model must supply for the selected composition. */
export function requiredModelFeatures(selectedIds: string[]): Feature[] {
  const required = new Set<Feature>();
  if (selectedIds.some((id) => id.startsWith('interaction.') || id === 'tools.browser')) {
    required.add('text');
  }
  if (selectedIds.includes('interaction.voice-in')) required.add('audio-in');
  if (selectedIds.includes('interaction.voice-out')) required.add('audio-out');
  if (selectedIds.includes('interaction.vision')) required.add('vision-in');
  if (selectedIds.some((id) => id === 'tools.browser' || id === 'framework.langgraph' || id === 'framework.crewai')) {
    required.add('tool-calling');
  }
  return Array.from(required);
}

function featureLabel(feature: Feature): string {
  const labels: Record<Feature, string> = {
    text: 'text',
    'vision-in': 'image input',
    'image-out': 'image output',
    'audio-in': 'audio input',
    'audio-out': 'audio output',
    'tool-calling': 'tool calling',
    'structured-output': 'structured output',
    streaming: 'streaming',
    cancellation: 'cancellation',
    checkpointing: 'checkpointing',
    'persistent-memory': 'persistent memory',
    'web-access': 'web access',
    'file-ingest': 'file ingestion',
    'workspace-write': 'workspace writes',
  };
  return labels[feature];
}

/** Everything the activation sheet must disclose, computed — never typed by hand. */
export function activationSummary(input: ValidationInput) {
  const result = validateDraft(input);
  const { draft } = input;
  const selected = Object.keys(draft.selected)
    .map((id) => CAPABILITY_BY_ID[id])
    .filter(Boolean);

  const dataAccess = selected
    .flatMap((capability) => capability.permissions.map((scope) => `${scope}:${capability.name}`))
    .sort();

  const limits = selected.map((capability) => {
    const config = draft.selected[capability.id] ?? {};
    const parts: string[] = [];
    if (typeof config.maxSteps === 'number') parts.push(`${config.maxSteps} steps`);
    if (typeof config.maxMinutes === 'number') parts.push(`${config.maxMinutes} min`);
    return parts.length ? `${capability.name}: ${parts.join(', ')}` : null;
  });

  return {
    valid: result.activatable,
    blockers: result.blockers,
    warnings: result.warnings,
    permissions: result.permissions,
    dataAccess,
    limits: limits.filter(Boolean) as string[],
    features: result.features,
    capabilities: selected.map((capability) => ({
      id: capability.id,
      name: capability.name,
      category: capability.category,
      availability: effectiveAvailability(capability.id, input.availability),
    })),
  };
}

/** Convenience for the palette: is this capability selectable at all? */
export function isSelectable(id: string, availability?: ValidationInput['availability']): boolean {
  const state = effectiveAvailability(id, availability);
  return state === 'ready' || state === 'check-required' || state === 'needs-setup';
}

/** All catalogue entries grouped by category, in spec order. */
export function catalogueByCategory() {
  return (Object.keys(CATEGORY_META) as StudioCategory[])
    .sort((a, b) => CATEGORY_META[a].order - CATEGORY_META[b].order)
    .map((category) => ({
      category,
      meta: CATEGORY_META[category],
      capabilities: capabilitiesIn(category),
    }));
}

export const CATALOGUE_SIZE = CAPABILITIES.length;
