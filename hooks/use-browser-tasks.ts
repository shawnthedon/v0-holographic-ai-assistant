'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { BrowserTaskSpec, BrowserTaskView } from '@/lib/browser/types';

export interface BrowserEngineStatus {
  available: boolean;
  kind: string;
  reason?: string;
  fix?: string;
}

export interface BrowserError {
  code: string;
  message: string;
  fix: string;
}

interface Payload {
  tasks: BrowserTaskView[];
  engine: BrowserEngineStatus;
  durable: boolean;
  store?: string;
}

export interface BrowserConsoleState {
  tasks: BrowserTaskView[];
  engine: BrowserEngineStatus | null;
  durable: boolean;
  loading: boolean;
  error: BrowserError | null;
  selectedId: string | null;
  selected: BrowserTaskView | null;
  select: (id: string | null) => void;
  refresh: () => Promise<void>;
  dismissError: () => void;
  startCheck: (input: { objective: string; url: string; expectedText: string }) => Promise<boolean>;
  startSpec: (spec: BrowserTaskSpec) => Promise<boolean>;
  act: (id: string, action: 'pause' | 'resume' | 'cancel' | 'inspect') => Promise<void>;
  busy: string | null;
}

/**
 * Live view of the browser agent.
 *
 * The panel polls while it is open and stops when it closes — an idle agent must
 * not cost the operator a polling loop. Everything shown comes from the runner's
 * persisted record: no client-side inference about what the agent is "probably"
 * doing.
 */
export function useBrowserTasks(active: boolean, intervalMs = 1_500): BrowserConsoleState {
  const [tasks, setTasks] = useState<BrowserTaskView[]>([]);
  const [engine, setEngine] = useState<BrowserEngineStatus | null>(null);
  const [durable, setDurable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<BrowserError | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch('/api/browser/tasks', { cache: 'no-store' });
      const data = (await response.json()) as Payload & BrowserError & { error?: string };
      if (!response.ok) {
        setError({ code: data.code ?? 'browser-error', message: data.message ?? data.error ?? 'request failed', fix: data.fix ?? 'Retry.' });
        return;
      }
      setTasks(data.tasks ?? []);
      setEngine(data.engine ?? null);
      setDurable(Boolean(data.durable));
      setError(null);
    } catch (failure) {
      setError({
        code: 'browser-error',
        message: failure instanceof Error ? failure.message : 'could not reach the browser service',
        fix: 'Check that the console is running with the browser agent enabled, then retry.',
      });
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs, refresh]);

  // Keep a sensible selection as tasks come and go.
  useEffect(() => {
    if (tasks.length === 0) return;
    if (selectedId && tasks.some((entry) => entry.task.id === selectedId)) return;
    setSelectedId(tasks[0].task.id);
  }, [tasks, selectedId]);

  const post = useCallback(
    async (body: unknown, id?: string): Promise<boolean> => {
      try {
        const response = await fetch(id ? `/api/browser/tasks/${id}` : '/api/browser/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { task?: BrowserTaskView } & BrowserError & { error?: string };
        if (!response.ok) {
          setError({
            code: data.code ?? 'browser-error',
            message: data.message ?? data.error ?? 'the request failed',
            fix: data.fix ?? 'Check the task timeline for what happened.',
          });
          return false;
        }
        if (data.task) {
          setTasks((current) => {
            const others = current.filter((entry) => entry.task.id !== data.task!.task.id);
            return [data.task!, ...others].sort((a, b) => b.task.createdAt - a.task.createdAt);
          });
          setSelectedId(data.task.task.id);
        }
        void refresh();
        return true;
      } catch (failure) {
        setError({
          code: 'browser-error',
          message: failure instanceof Error ? failure.message : 'the request failed',
          fix: 'Retry. If it persists, the browser service may have restarted.',
        });
        return false;
      }
    },
    [refresh],
  );

  const act = useCallback(
    async (id: string, action: 'pause' | 'resume' | 'cancel' | 'inspect') => {
      setBusy(`${action}:${id}`);
      try {
        await post({ action }, id);
      } finally {
        setBusy(null);
      }
    },
    [post],
  );

  const startCheck = useCallback(
    async (input: { objective: string; url: string; expectedText: string }) => {
      setBusy('start');
      try {
        const spec: BrowserTaskSpec = {
          objective: input.objective.trim() || `verify ${input.url}`,
          startUrl: input.url.trim(),
          profile: 'console',
          plan: [{ id: 'open', kind: 'navigate', url: input.url.trim(), milestone: `opened ${input.url.trim()}` }],
          successCriteria: [{ type: 'text-present', text: input.expectedText.trim() }],
        };
        return await post({ spec });
      } finally {
        setBusy(null);
      }
    },
    [post],
  );

  const startSpec = useCallback(
    async (spec: BrowserTaskSpec) => {
      setBusy('start');
      try {
        return await post({ spec });
      } finally {
        setBusy(null);
      }
    },
    [post],
  );

  const selected = useMemo(
    () => tasks.find((entry) => entry.task.id === selectedId) ?? null,
    [tasks, selectedId],
  );

  return {
    tasks,
    engine,
    durable,
    loading,
    error,
    selectedId,
    selected,
    select: setSelectedId,
    refresh,
    dismissError: () => setError(null),
    startCheck,
    startSpec,
    act,
    busy,
  };
}
