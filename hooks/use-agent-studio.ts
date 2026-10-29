'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  acknowledge,
  configure,
  describeRole,
  diffDrafts,
  fromTemplate,
  grant,
  isEmptyDiff,
  newDraft,
  nextVersion,
  rename,
  revoke,
  select,
  deselect,
  setGoal,
  toggle,
  unacknowledge,
  type Template,
} from '@/lib/agent-studio/draft';
import { validateDraft, type ModelOption, type ValidationInput } from '@/lib/agent-studio/validate';
import type {
  AgentConfigRecord,
  AgentDraft,
  AvailabilityReport,
  PermissionScope,
  StudioRole,
} from '@/lib/agent-studio/types';

const DRAFT_KEY = 'nexus.agent-studio.draft.v1';

export interface CapabilitySnapshotClient {
  at: number;
  modelCount: number;
  configuredProviders: Array<{ id: string; label: string; configured: boolean }>;
  models: ModelOption[];
  defaultModelId: string;
  reports: Record<string, AvailabilityReport>;
  summary: {
    browsers: boolean;
    persistentMemory: boolean;
    markitdown: boolean;
    scheduler: boolean;
    ftp: boolean;
  };
}

interface SavedAgent {
  agentId: string;
  name: string;
  updatedAt: number;
  version: number;
  state: 'active' | 'draft';
  blockers: number;
  warnings: number;
  runtime: { connected: boolean; note: string };
  createdAt: number;
}

interface StudioError {
  code: string;
  message: string;
  fix: string;
}

function loadDraft(): AgentDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AgentDraft;
    if (!parsed || typeof parsed !== 'object' || !parsed.selected) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Studio state.
 *
 * The draft is the only source of truth in the browser; validation and the
 * activation sheet are derived from it plus the live probe. Nothing here
 * upgrades an availability state on its own — that is the server's job.
 */
export function useAgentStudio() {
  const [draft, setDraft] = useState<AgentDraft>(() => newDraft());
  const [restored, setRestored] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [snapshot, setSnapshot] = useState<CapabilitySnapshotClient | null>(null);
  const [probing, setProbing] = useState(true);
  const [probeError, setProbeError] = useState<StudioError | null>(null);
  const [agents, setAgents] = useState<SavedAgent[]>([]);
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState<AgentConfigRecord | null>(null);
  const [error, setError] = useState<StudioError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<AgentDraft | null>(null);
  const firstRun = useRef(true);

  /* ------------------------------ restore ------------------------------- */

  useEffect(() => {
    const stored = loadDraft();
    if (stored) {
      setDraft(stored);
      setSavedAt(stored.updatedAt);
    }
    setRestored(true);
  }, []);

  /* ------------------------------- probe -------------------------------- */

  const refreshProbe = useCallback(async () => {
    setProbing(true);
    try {
      const response = await fetch('/api/agents/studio/capabilities', { cache: 'no-store' });
      const data = (await response.json()) as CapabilitySnapshotClient & StudioError & { ok: boolean };
      if (!response.ok || !data.ok) {
        setProbeError({ code: data.code ?? 'probe-failed', message: data.message ?? 'Probe failed.', fix: data.fix ?? '' });
        setSnapshot(null);
      } else {
        setSnapshot(data);
        setProbeError(null);
      }
    } catch (cause) {
      setProbeError({
        code: 'probe-unreachable',
        message: (cause as Error).message,
        fix: 'The studio keeps the static catalogue, but nothing is marked available until the probe answers.',
      });
      setSnapshot(null);
    } finally {
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    void refreshProbe();
  }, [refreshProbe]);

  const refreshAgents = useCallback(async () => {
    try {
      const response = await fetch('/api/agents/studio/agents', { cache: 'no-store' });
      const data = (await response.json()) as { ok: boolean; agents?: SavedAgent[] };
      if (data.ok && data.agents) setAgents(data.agents);
    } catch {
      /* the list is a convenience; a failure must not break composition */
    }
  }, []);

  useEffect(() => {
    void refreshAgents();
  }, [refreshAgents]);

  /* ---------------------------- validation ------------------------------ */

  const validationInput: ValidationInput = useMemo(
    () => ({ draft, availability: snapshot?.reports, models: snapshot?.models ?? [] }),
    [draft, snapshot],
  );

  const validation = useMemo(() => validateDraft(validationInput), [validationInput]);

  const diff = useMemo(() => (baseline ? diffDrafts(baseline, draft) : null), [baseline, draft]);

  /* ------------------------------ autosave ------------------------------ */

  useEffect(() => {
    if (!restored) return;
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setDirty(true);
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        setSavedAt(Date.now());
        setDirty(false);
      } catch {
        setError({
          code: 'draft-save-failed',
          message: 'The browser refused to store the draft.',
          fix: 'Storage may be full or blocked. Export the configuration before closing.',
        });
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [draft, restored]);

  /* ------------------------------ actions ------------------------------- */

  const apply = useCallback((next: AgentDraft) => {
    setDraft(next);
    setNotice(null);
    setActivated(null);
  }, []);

  const actions = useMemo(
    () => ({
      setGoal: (value: string) => apply(setGoal(draft, value)),
      rename: (value: string) => apply(rename(draft, value)),
      setRole: (role: StudioRole | null) => apply(describeRole(draft, role)),
      toggleCapability: (id: string) => apply(toggle(draft, id)),
      addCapability: (id: string) => apply(select(draft, id)),
      removeCapability: (id: string) => apply(deselect(draft, id)),
      configure: (id: string, patch: Record<string, string | number | boolean>) => apply(configure(draft, id, patch)),
      grantScope: (scope: PermissionScope) => apply(grant(draft, scope)),
      revokeScope: (scope: PermissionScope) => apply(revoke(draft, scope)),
      acknowledge: (id: string) => apply(acknowledge(draft, id)),
      unacknowledge: (id: string) => apply(unacknowledge(draft, id)),
      applyTemplate: (template: Template) =>
        apply(fromTemplate(template, { defaultModel: snapshot?.defaultModelId })),
      reset: () => {
        setBaseline(null);
        apply(newDraft());
      },
      startEdit: (record: AgentConfigRecord) => {
        const next = nextVersion({
          ...newDraft(),
          name: record.name,
          goal: record.goal,
          role: record.role,
          selected: record.selected,
          granted: record.granted,
          version: record.version,
        });
        setBaseline({ ...next, version: record.version });
        setDraft(next);
        setNotice(`Editing version ${record.version} — saving creates version ${next.version}.`);
        setActivated(null);
      },
    }),
    [apply, draft, snapshot?.defaultModelId],
  );

  const activate = useCallback(async () => {
    setActivating(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/agents/studio/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draft }),
      });
      const data = (await response.json()) as {
        ok: boolean;
        agent?: AgentConfigRecord;
        code?: string;
        message?: string;
        fix?: string;
        blockers?: Array<{ message: string; fix: string }>;
      };
      if (!response.ok || !data.ok) {
        const extra = data.blockers?.length
          ? ` ${data.blockers.length} blocker(s) remain — see the validation panel.`
          : '';
        setError({
          code: data.code ?? 'activation-failed',
          message: `${data.message ?? 'Activation failed.'}${extra}`,
          fix: data.fix ?? 'Resolve the blockers, then activate again.',
        });
        return null;
      }
      setActivated(data.agent ?? null);
      setBaseline(draft);
      setDirty(false);
      void refreshAgents();
      return data.agent ?? null;
    } catch (cause) {
      setError({
        code: 'activation-unreachable',
        message: (cause as Error).message,
        fix: 'The studio could not reach the server. The draft is still saved locally.',
      });
      return null;
    } finally {
      setActivating(false);
    }
  }, [draft, refreshAgents]);

  return {
    draft,
    restored,
    savedAt,
    dirty,
    snapshot,
    probing,
    probeError,
    validation,
    diff,
    agents,
    activating,
    activated,
    error,
    notice,
    actions,
    refreshProbe,
    refreshAgents,
    activate,
    dismissError: () => setError(null),
    dismissNotice: () => setNotice(null),
    unchanged: diff ? isEmptyDiff(diff) : true,
  };
}

export type AgentStudioState = ReturnType<typeof useAgentStudio>;
