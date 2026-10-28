'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { animate } from 'animejs';
import { Check, Cpu, Radio, RefreshCw, Search, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { EASE, useReducedMotion } from '@/lib/hud/motion';
import type { CatalogueModel } from '@/hooks/use-model-catalogue';
import type { ProviderId, ProviderStatus } from '@/lib/llm/types';

type RoleFilter = 'all' | 'chat' | 'code' | 'vision' | 'omni' | 'speech-out';

interface ModelPickerProps {
  open: boolean;
  onClose: () => void;
  models: CatalogueModel[];
  providers: ProviderStatus[];
  selectedModelId: string;
  onSelect: (modelId: string) => void;
  onDiscover: (provider: ProviderId) => Promise<unknown>;
  discoverError: string | null;
  discovering: ProviderId | null;
  onReload?: () => void;
  loading?: boolean;
}

interface ProbeResult {
  reachable: boolean | null;
  code?: string;
  message?: string;
  fix?: string;
}

interface SweepSummary {
  models: number;
  configured: number;
  probed: number;
  passed: number;
  failed: number;
  blocked: number;
}

const ROLE_LABELS: Record<RoleFilter, string> = {
  all: 'all roles',
  chat: 'conversation',
  code: 'code',
  vision: 'vision',
  omni: 'multimodal',
  'speech-out': 'speech out',
};

/**
 * Model catalogue overlay. Lists every model this deployment can address,
 * whether its provider has a credential, and where inference would run.
 */
export function ModelPicker({
  open,
  onClose,
  models,
  providers,
  selectedModelId,
  onSelect,
  onDiscover,
  discoverError,
  discovering,
  onReload,
  loading = false,
}: ModelPickerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<RoleFilter>('all');
  const reduced = useReducedMotion();
  const [sweeping, setSweeping] = useState(false);
  const [sweep, setSweep] = useState<{ summary: SweepSummary; results: Map<string, ProbeResult> } | null>(null);
  const [sweepError, setSweepError] = useState<string | null>(null);

  /**
   * Runs the same system-wide sweep the CLI runs, in the browser, so an
   * operator can see which models actually answer instead of guessing.
   */
  const runSweep = async () => {
    setSweeping(true);
    setSweepError(null);
    try {
      const response = await fetch('/api/llm/verify?probe=1&discover=1', { cache: 'no-store' });
      const data = (await response.json()) as {
        summary?: SweepSummary;
        models?: Array<{ id: string; reachable: boolean | null; error?: ProbeResult }>;
        error?: string;
        fix?: string;
      };
      if (!response.ok || !data.summary) {
        setSweepError(`${data.error ?? `verification failed (${response.status})`}${data.fix ? ` — ${data.fix}` : ''}`);
        return;
      }
      const results = new Map<string, ProbeResult>();
      for (const entry of data.models ?? []) {
        results.set(entry.id, {
          reachable: entry.reachable,
          code: entry.error?.code,
          message: entry.error?.message,
          fix: entry.error?.fix,
        });
      }
      setSweep({ summary: data.summary, results });
      onReload?.();
    } catch (error) {
      setSweepError(error instanceof Error ? error.message : 'verification request failed');
    } finally {
      setSweeping(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || reduced || !panelRef.current) return;
    animate(panelRef.current, {
      opacity: [0, 1],
      scale: [0.98, 1],
      translateY: [10, 0],
      duration: 320,
      ease: EASE.out,
    });
    animate(panelRef.current.querySelectorAll('.model-row'), {
      opacity: [0, 1],
      translateX: [-8, 0],
      delay: (_el: unknown, index = 0) => 30 + index * 12,
      duration: 340,
      ease: EASE.out,
    });
  }, [open, reduced]);

  const providerById = useMemo(
    () => new Map(providers.map((entry) => [entry.provider, entry])),
    [providers],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return models
      .filter((entry) => (role === 'all' ? true : entry.roles.includes(role)))
      .filter((entry) =>
        needle
          ? `${entry.label} ${entry.id} ${entry.provider}`.toLowerCase().includes(needle)
          : true,
      )
      .sort((a, b) => {
        if (a.id === selectedModelId) return -1;
        if (b.id === selectedModelId) return 1;
        if (a.configured !== b.configured) return a.configured ? -1 : 1;
        return a.provider.localeCompare(b.provider) || a.label.localeCompare(b.label);
      });
  }, [models, query, role, selectedModelId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/80 p-4 pt-[8vh] backdrop-blur-sm">
      <div
        ref={panelRef}
        className="relative flex max-h-[78vh] w-full max-w-3xl flex-col overflow-hidden rounded border border-[color:var(--hud-line-strong)] bg-[#030c10]/97 shadow-[0_0_80px_rgba(46,242,192,0.16)]"
        role="dialog"
        aria-modal="true"
        aria-label="Model catalogue"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[color:var(--hud-line)] px-4 py-3">
          <div>
            <p className="font-mono text-[8px] uppercase tracking-[0.34em] text-[color:var(--hud-ink-dim)]">
              model catalogue
            </p>
            <h2 className="font-mono text-[13px] tracking-[0.18em] text-[color:var(--hud-ink)]">
              SELECT INFERENCE CORE
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close model catalogue"
            className="rounded border border-[color:var(--hud-line)] p-1.5 text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-line-strong)] hover:text-[color:var(--hud-ink)]"
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--hud-line)] px-4 py-2.5">
          <label className="flex flex-1 items-center gap-2 rounded border border-[color:var(--hud-line)] bg-black/40 px-2 py-1.5">
            <Search size={12} className="text-[color:var(--hud-ink-dim)]" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="search models, providers…"
              className="w-full bg-transparent font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--hud-ink)] outline-none placeholder:text-[color:var(--hud-ink-dim)]"
            />
          </label>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(ROLE_LABELS) as RoleFilter[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setRole(key)}
                aria-pressed={role === key}
                className={`rounded border px-2 py-1 font-mono text-[7px] uppercase tracking-[0.2em] transition ${
                  role === key
                    ? 'border-[color:var(--hud-lime)] text-[color:var(--hud-lime)]'
                    : 'border-[color:var(--hud-line)] text-[color:var(--hud-ink-dim)] hover:border-[color:var(--hud-line-strong)]'
                }`}
              >
                {ROLE_LABELS[key]}
              </button>
            ))}
          </div>
        </div>

        {discoverError && (
          <p className="flex items-start gap-2 border-b border-[#ff9d7a]/40 bg-[#ff9d7a]/10 px-4 py-2 font-mono text-[8px] uppercase leading-[1.6] tracking-[0.14em] text-[#ff9d7a]">
            <TriangleAlert size={12} className="mt-[1px] flex-none" />
            {discoverError}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {loading && (
            <p className="px-2 py-6 text-center font-mono text-[8px] uppercase tracking-[0.3em] text-[color:var(--hud-ink-dim)]">
              loading catalogue…
            </p>
          )}
          {!loading && filtered.length === 0 && (
            <p className="px-2 py-6 text-center font-mono text-[8px] uppercase tracking-[0.3em] text-[color:var(--hud-ink-dim)]">
              no models match that filter
            </p>
          )}

          {filtered.map((entry) => {
            const provider = providerById.get(entry.provider);
            const isSelected = entry.id === selectedModelId;
            const probe = sweep?.results.get(entry.id);
            const blocked = provider?.kind === 'unsupported' || !entry.configured;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  onSelect(entry.id);
                  onClose();
                }}
                className={`model-row group flex w-full items-start gap-3 rounded px-2.5 py-2 text-left transition ${
                  isSelected ? 'bg-[color:var(--hud-mint)]/10' : 'hover:bg-white/[0.03]'
                }`}
              >
                <span
                  className={`mt-[3px] flex h-4 w-4 flex-none items-center justify-center rounded-full border ${
                    isSelected
                      ? 'border-[color:var(--hud-lime)] text-[color:var(--hud-lime)]'
                      : 'border-[color:var(--hud-line-strong)] text-transparent'
                  }`}
                >
                  <Check size={10} />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span
                      className={`font-mono text-[11px] tracking-[0.08em] ${
                        blocked ? 'text-[color:var(--hud-ink-dim)]' : 'text-[color:var(--hud-ink)]'
                      }`}
                    >
                      {entry.label}
                    </span>
                    <span className="font-mono text-[7px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)]">
                      {provider?.label ?? entry.provider}
                    </span>
                    {entry.verified && (
                      <span className="flex items-center gap-1 font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-lime)]">
                        <ShieldCheck size={9} /> verified
                      </span>
                    )}
                    {entry.source === 'provider' && (
                      <span className="flex items-center gap-1 font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-mint)]">
                        <Radio size={9} /> live
                      </span>
                    )}
                    {probe?.reachable === false && probe.code && (
                      <span className="font-mono text-[7px] uppercase tracking-[0.18em] text-[#ff9d7a]">
                        {probe.code}
                      </span>
                    )}
                  </span>

                  <span className="mt-[2px] flex flex-wrap items-center gap-x-2 gap-y-[2px] font-mono text-[7px] uppercase tracking-[0.16em] text-[color:var(--hud-ink-dim)]">
                    <span className="flex items-center gap-1">
                      <Cpu size={9} /> {entry.execution}
                    </span>
                    <span>{entry.roles.join(' · ')}</span>
                    {entry.contextWindow ? <span>{(entry.contextWindow / 1000).toFixed(0)}k ctx</span> : null}
                    {provider?.kind === 'unsupported' ? (
                      <span className="text-[#ff9d7a]">blocked</span>
                    ) : entry.configured ? (
                      <span className="text-[color:var(--hud-mint)]">ready</span>
                    ) : (
                      <span className="text-[#ffd27a]">no key</span>
                    )}
                  </span>

                  {entry.notes && (
                    <span className="mt-1 block font-mono text-[7.5px] normal-case leading-[1.55] tracking-[0.06em] text-[color:var(--hud-ink-dim)]">
                      {entry.notes}
                    </span>
                  )}
                </span>

                {provider?.supportsModelList && entry.configured && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      void onDiscover(entry.provider);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.stopPropagation();
                        void onDiscover(entry.provider);
                      }
                    }}
                    className="flex flex-none items-center gap-1 rounded border border-[color:var(--hud-line)] px-1.5 py-[3px] font-mono text-[7px] uppercase tracking-[0.16em] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)]"
                  >
                    <RefreshCw size={8} className={discovering === entry.provider ? 'animate-spin' : ''} />
                    list
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-[color:var(--hud-line)] px-4 py-2 font-mono text-[7px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)]">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {filtered.length} model{filtered.length === 1 ? '' : 's'} ·{' '}
              {providers.filter((entry) => entry.configured).length}/{providers.length} providers keyed
            </span>
            {sweep && (
              <span className="text-[color:var(--hud-ink)]">
                sweep · {sweep.summary.passed} pass / {sweep.summary.failed} fail /{' '}
                {sweep.summary.blocked} blocked
              </span>
            )}
            {sweepError && <span className="text-[#ff9d7a]">{sweepError}</span>}
          </span>
          <span className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void runSweep()}
              disabled={sweeping}
              className="rounded border border-[color:var(--hud-line)] px-2 py-[3px] font-mono text-[7px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)] disabled:opacity-50"
            >
              {sweeping ? 'probing models…' : 'verify all'}
            </button>
            <span>esc to close</span>
          </span>
        </footer>
      </div>
    </div>
  );
}
