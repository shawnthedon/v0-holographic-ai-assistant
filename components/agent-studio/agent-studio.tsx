'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleSlash,
  Cpu,
  Layers,
  Lock,
  PlayCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react';

import { HoloBackdropClip } from '@/components/agent-studio/holo-backdrop';
import { StudioGraph } from '@/components/agent-studio/studio-graph';
import { useAgentStudio } from '@/hooks/use-agent-studio';
import { CAPABILITY_BY_ID, capabilitiesIn, ROLE_REQUIREMENTS } from '@/lib/agent-studio/catalogue';
import { TEMPLATES } from '@/lib/agent-studio/draft';
import { activationSummary, isSelectable } from '@/lib/agent-studio/validate';
import {
  AVAILABILITY_META,
  CATEGORY_META,
  PERMISSION_META,
  ROLES,
  type Availability,
  type Capability,
  type ConfigField,
  type PermissionScope,
  type StudioCategory,
  type ValidationIssue,
} from '@/lib/agent-studio/types';

const CATEGORY_ORDER: StudioCategory[] = (
  ['framework', 'model', 'memory', 'behaviour', 'interaction', 'tools', 'knowledge', 'permissions'] as StudioCategory[]
).sort((a, b) => CATEGORY_META[a].order - CATEGORY_META[b].order);

function toneClass(tone: 'ok' | 'warn' | 'bad' | 'idle') {
  if (tone === 'ok') return 'text-[color:var(--hud-lime)] border-[color:var(--hud-lime)]/45';
  if (tone === 'warn') return 'text-[#ffd27a] border-[#ffd27a]/45';
  if (tone === 'bad') return 'text-[#ff9d7a] border-[#ff9d7a]/45';
  return 'text-[color:var(--hud-ink-dim)] border-[color:var(--hud-line)]';
}

function AvailabilityBadge({ state }: { state: Availability }) {
  const meta = AVAILABILITY_META[state];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-[2px] font-mono text-[6px] uppercase tracking-[0.2em] ${toneClass(meta.tone)}`}
    >
      <span aria-hidden="true">{meta.glyph}</span>
      {meta.label}
    </span>
  );
}

/**
 * AGENT DESIGNER STUDIO
 *
 * The module the specification calls the platform’s primary entry point: compose
 * an agent from real capabilities, see the dependency map, and activate only
 * what validates.
 *
 * The holographic plate behind it is decoration (30% opacity, governed frame
 * budget, stills for reduced motion). Every number and word over the top of it
 * comes from the draft or from a live probe of this deployment.
 */
export function AgentStudio({ open, onClose }: { open: boolean; onClose: () => void }) {
  const studio = useAgentStudio();
  const [category, setCategory] = useState<StudioCategory>('framework');
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState(false);
  /* < lg the studio is a three-pane drawer, one pane at a time */
  const [pane, setPane] = useState<'palette' | 'map' | 'inspect'>('palette');
  const [result, setResult] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    /* land the keyboard inside the studio instead of leaving it on the dock */
    const frame = requestAnimationFrame(() => dialogRef.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      previous?.focus?.({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (sheet) setSheet(false);
        else onClose();
        return;
      }
      if (event.key === 'Tab') {
        /* keep focus in the dialog while it is modal */
        const root = dialogRef.current;
        if (!root) return;
        const focusable = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((node) => node.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!root.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, sheet]);

  const { draft, validation, snapshot, probing, probeError, actions, error, notice } = studio;

  const selectedInCategory = useMemo(
    () =>
      Object.keys(draft.selected)
        .map((id) => CAPABILITY_BY_ID[id])
        .filter((capability) => capability?.category === category),
    [draft.selected, category],
  );

  const options = useMemo(() => {
    const list = capabilitiesIn(category);
    if (!query.trim()) return list;
    const needle = query.toLowerCase();
    return list.filter(
      (capability) =>
        capability.name.toLowerCase().includes(needle) ||
        capability.summary.toLowerCase().includes(needle) ||
        capability.id.includes(needle),
    );
  }, [category, query]);

  const summary = useMemo(
    () => activationSummary({ draft, availability: snapshot?.reports, models: snapshot?.models ?? [] }),
    [draft, snapshot],
  );

  const routedModel = useMemo(() => {
    const id = draft.selected['model.brain']?.model;
    return snapshot?.models.find((model) => model.id === id) ?? null;
  }, [draft.selected, snapshot]);

  const activeCapability = selectedInCategory[0] ?? null;
  const validationLabel = validation.blockers.length
    ? `${validation.blockers.length} blocker${validation.blockers.length === 1 ? '' : 's'}`
    : validation.warnings.length
      ? `${validation.warnings.length} to acknowledge`
      : 'ready to activate';

  if (!open) return null;

  const setField = (field: ConfigField, value: string | number | boolean) => {
    if (!activeCapability) return;
    actions.configure(activeCapability.id, { [field.key]: value });
  };

  const fieldValue = (field: ConfigField) => {
    if (!activeCapability) return field.kind === 'toggle' ? false : '';
    const stored = draft.selected[activeCapability.id]?.[field.key];
    return stored ?? field.default;
  };

  return (
    <div className="fixed inset-0 z-[74] flex items-start justify-center bg-black/80 p-2 pt-[2vh] md:p-4 md:pt-[3vh]">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Agent designer studio"
        tabIndex={-1}
        className="relative flex h-[96vh] outline-none w-full max-w-[1560px] flex-col overflow-hidden rounded border border-[color:var(--hud-line-strong)] bg-[#020a0d]/92 shadow-[0_0_100px_rgba(46,242,192,0.16)]"
      >
        <HoloBackdropClip />

        {/* ------------------------------ header ------------------------------ */}
        <header className="relative z-10 flex flex-wrap items-center justify-between gap-2 border-b border-[color:var(--hud-line)] bg-[#020a0d]/72 px-3 py-2.5 md:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="hidden h-8 w-8 items-center justify-center rounded border border-[color:var(--hud-line-strong)] text-[color:var(--hud-ink)] md:flex">
              <Sparkles size={14} />
            </span>
            <div className="min-w-0">
              <p className="font-mono text-[7px] uppercase tracking-[0.34em] text-[color:var(--hud-ink-dim)]">
                agent creation · designer studio
              </p>
              <input
                value={draft.name}
                onChange={(event) => actions.rename(event.target.value)}
                aria-label="Agent name"
                className="w-full max-w-[260px] border-b border-transparent bg-transparent font-mono text-[13px] uppercase tracking-[0.16em] text-[color:var(--hud-ink)] outline-none transition focus:border-[color:var(--hud-ink)]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[6.5px] uppercase tracking-[0.2em]">
            <span className="rounded border border-[color:var(--hud-line)] px-2 py-[3px] text-[color:var(--hud-ink-dim)]">
              draft v{draft.version}
            </span>
            <span
              className={`rounded border px-2 py-[3px] ${
                studio.dirty ? 'border-[#ffd27a]/45 text-[#ffd27a]' : 'border-[color:var(--hud-line)] text-[color:var(--hud-ink-dim)]'
              }`}
              aria-live="polite"
            >
              {studio.dirty
                ? 'saving…'
                : studio.savedAt
                  ? `saved ${new Date(studio.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'not saved'}
            </span>
            <span
              className={`flex items-center gap-1 rounded border px-2 py-[3px] ${
                validation.blockers.length
                  ? 'border-[#ff9d7a]/50 text-[#ff9d7a]'
                  : validation.warnings.length
                    ? 'border-[#ffd27a]/50 text-[#ffd27a]'
                    : 'border-[color:var(--hud-lime)]/50 text-[color:var(--hud-lime)]'
              }`}
              aria-live="polite"
            >
              {validation.blockers.length ? <XCircle size={9} /> : <CheckCircle2 size={9} />}
              {validationLabel}
            </span>
            <button
              type="button"
              onClick={() => void studio.refreshProbe()}
              aria-label="Re-run capability checks"
              disabled={probing}
              className="flex items-center gap-1 rounded border border-[color:var(--hud-line)] px-2 py-[3px] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)] disabled:opacity-50"
            >
              <RefreshCw size={9} className={probing ? 'animate-spin' : ''} /> recheck
            </button>
            <button
              type="button"
              disabled={!validation.activatable}
              onClick={() => setSheet(true)}
              className={`flex items-center gap-1 rounded border px-2.5 py-[4px] tracking-[0.22em] transition ${
                validation.activatable
                  ? 'border-[color:var(--hud-lime)]/60 text-[color:var(--hud-lime)] hover:bg-[color:var(--hud-lime)]/10'
                  : 'cursor-not-allowed border-[color:var(--hud-line)] text-[color:var(--hud-ink-dim)] opacity-60'
              }`}
              title={validation.activatable ? 'Review and activate' : 'Resolve blockers first'}
            >
              <PlayCircle size={10} /> activate
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close agent studio"
              className="rounded border border-[color:var(--hud-line)] p-1.5 text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-line-strong)] hover:text-[color:var(--hud-ink)]"
            >
              <X size={11} />
            </button>
          </div>
        </header>

        {/* ----------------------------- messages ----------------------------- */}
        {error && (
          <p className="relative z-10 flex items-start gap-2 border-b border-[#ff9d7a]/40 bg-[#ff9d7a]/10 px-4 py-2 font-mono text-[8px] uppercase leading-[1.6] tracking-[0.14em] text-[#ff9d7a]">
            <span className="flex-1">
              <span className="mr-2 rounded border border-[#ff9d7a]/50 px-1">{error.code}</span>
              {error.message} — {error.fix}
            </span>
            <button type="button" onClick={studio.dismissError} aria-label="Dismiss error">
              ✕
            </button>
          </p>
        )}
        {probeError && !error && (
          <p className="relative z-10 flex items-start gap-2 border-b border-[#ffd27a]/40 bg-[#ffd27a]/10 px-4 py-2 font-mono text-[8px] uppercase leading-[1.6] tracking-[0.14em] text-[#ffd27a]">
            <AlertTriangle size={11} className="mt-[1px] flex-none" />
            <span className="flex-1">
              <span className="mr-2 rounded border border-[#ffd27a]/50 px-1">{probeError.code}</span>
              {probeError.message} — {probeError.fix}
            </span>
          </p>
        )}
        {notice && (
          <p className="relative z-10 flex items-start gap-2 border-b border-[color:var(--hud-lime)]/30 bg-[color:var(--hud-lime)]/5 px-4 py-2 font-mono text-[8px] uppercase leading-[1.6] tracking-[0.14em] text-[color:var(--hud-lime)]">
            <span className="flex-1">{notice}</span>
            <button type="button" onClick={studio.dismissNotice} aria-label="Dismiss notice">
              ✕
            </button>
          </p>
        )}

        {/* --------------------------- narrow tabs --------------------------- */}
        <div
          role="tablist"
          aria-label="Studio panes"
          className="relative z-10 flex gap-1 border-b border-[color:var(--hud-line)] bg-[#020a0d]/80 px-3 py-1.5 lg:hidden"
        >
          {(
            [
              ['palette', 'palette', Object.keys(draft.selected).length],
              ['map', 'map', validation.issues.length],
              ['inspect', 'inspector', 0],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={pane === id}
              onClick={() => setPane(id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded border px-2 py-[5px] font-mono text-[6.5px] uppercase tracking-[0.2em] transition ${
                pane === id
                  ? 'border-[color:var(--hud-ink)] text-[color:var(--hud-ink)]'
                  : 'border-[color:var(--hud-line)] text-[color:var(--hud-ink-dim)]'
              }`}
            >
              {label}
              {count > 0 && <span className="rounded bg-black/50 px-1 tabular-nums">{count}</span>}
            </button>
          ))}
        </div>

        {/* ------------------------------- body ------------------------------- */}
        <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          {/* -------------------------- palette -------------------------- */}
          <aside
            className={`w-full flex-col border-b border-[color:var(--hud-line)] bg-[#020a0d]/64 lg:flex lg:min-h-0 lg:w-[300px] lg:border-b-0 lg:border-r ${
              pane === 'palette' ? 'flex' : 'hidden'
            }`}
          >
            <div className="border-b border-[color:var(--hud-line)] px-3 py-2">
              <p className="mb-1.5 font-mono text-[7px] uppercase tracking-[0.26em] text-[color:var(--hud-ink-dim)]">
                component palette
              </p>
              <div className="relative">
                <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-[color:var(--hud-ink-dim)]" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Search components"
                  placeholder="search components"
                  className="w-full rounded border border-[color:var(--hud-line)] bg-black/40 py-1 pl-6 pr-2 font-mono text-[8px] uppercase tracking-[0.14em] text-[color:var(--hud-ink)] outline-none placeholder:text-[color:var(--hud-ink-dim)]"
                />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1">
                {CATEGORY_ORDER.map((entry) => {
                  const state = validation.categories[entry];
                  const meta = AVAILABILITY_META[state];
                  const active = category === entry;
                  return (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => setCategory(entry)}
                      aria-pressed={active}
                      className={`flex items-center justify-between gap-1 rounded border px-1.5 py-[3px] font-mono text-[6px] uppercase tracking-[0.18em] transition ${
                        active
                          ? 'border-[color:var(--hud-ink)] text-[color:var(--hud-ink)]'
                          : 'border-[color:var(--hud-line)] text-[color:var(--hud-ink-dim)] hover:border-[color:var(--hud-line-strong)]'
                      }`}
                    >
                      <span className="truncate">{CATEGORY_META[entry].short}</span>
                      <span aria-hidden="true" className={toneClass(meta.tone).split(' ')[0]}>
                        {meta.glyph}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="hud-scroll max-h-[46vh] min-h-0 overflow-y-auto px-2 py-2 lg:max-h-none lg:flex-1">
              <p className="mb-1.5 px-1 font-mono text-[6.5px] uppercase leading-[1.6] tracking-[0.2em] text-[color:var(--hud-ink-dim)]">
                {CATEGORY_META[category].description}
              </p>
              {options.map((capability) => (
                <CapabilityRow
                  key={capability.id}
                  capability={capability}
                  availability={validation.verdicts[capability.id]?.availability ?? capability.availability}
                  selected={Boolean(draft.selected[capability.id])}
                  selectable={isSelectable(capability.id, snapshot?.reports)}
                  onToggle={() => {
                    const wasSelected = Boolean(draft.selected[capability.id]);
                    actions.toggleCapability(capability.id);
                    if (!wasSelected) setPane('inspect');
                  }}
                />
              ))}
              {options.length === 0 && (
                <p className="px-1 py-3 font-mono text-[7px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)]">
                  nothing matches “{query}”
                </p>
              )}

              <div className="mt-3 border-t border-[color:var(--hud-line)] pt-2">
                <p className="mb-1.5 px-1 font-mono text-[6.5px] uppercase tracking-[0.24em] text-[color:var(--hud-ink-dim)]">
                  saved configurations
                </p>
                {studio.agents.length === 0 && (
                  <p className="px-1 font-mono text-[6.5px] uppercase tracking-[0.16em] text-[color:var(--hud-ink-dim)]">
                    none yet
                  </p>
                )}
                {studio.agents.slice(0, 4).map((agent) => (
                  <button
                    key={agent.agentId}
                    type="button"
                    onClick={async () => {
                      const response = await fetch(`/api/agents/studio/agents/${agent.agentId}`, { cache: 'no-store' });
                      const data = (await response.json()) as { ok: boolean; versions?: Array<Record<string, unknown>> };
                      const latest = data.versions?.[data.versions.length - 1];
                      if (latest) {
                        actions.startEdit(latest as never);
                        setResult(null);
                      }
                    }}
                    className="mb-1 flex w-full items-center justify-between gap-2 rounded border border-[color:var(--hud-line)] px-1.5 py-1 text-left font-mono text-[6.5px] uppercase tracking-[0.16em] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-line-strong)] hover:text-[color:var(--hud-ink)]"
                  >
                    <span className="truncate">{agent.name}</span>
                    <span className={agent.runtime.connected ? 'text-[color:var(--hud-lime)]' : 'text-[#ffd27a]'}>
                      v{agent.version}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          {/* --------------------------- canvas --------------------------- */}
          <section
            className={`w-full flex-col lg:flex lg:min-h-0 lg:flex-1 ${pane === 'map' ? 'flex' : 'hidden'}`}
          >
            <div className="border-b border-[color:var(--hud-line)] bg-[#020a0d]/82 px-3 py-2">
              <label
                htmlFor="studio-goal"
                className="mb-1 block font-mono text-[6.5px] uppercase tracking-[0.26em] text-[color:var(--hud-ink-dim)]"
              >
                what should this agent do?
              </label>
              <textarea
                id="studio-goal"
                value={draft.goal}
                onChange={(event) => actions.setGoal(event.target.value)}
                rows={2}
                placeholder="Read the pages I allow and write a short brief with sources."
                className="w-full resize-none rounded border border-[color:var(--hud-line)] bg-black/40 px-2 py-1.5 font-mono text-[9px] leading-[1.6] text-[color:var(--hud-ink)] outline-none placeholder:text-[color:var(--hud-ink-dim)] focus:border-[color:var(--hud-line-strong)]"
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="font-mono text-[6px] uppercase tracking-[0.24em] text-[color:var(--hud-ink-dim)]">role</span>
                {ROLES.map((role) => (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => actions.setRole(draft.role === role.id ? null : role.id)}
                    aria-pressed={draft.role === role.id}
                    title={role.hint}
                    className={`rounded border px-1.5 py-[2px] font-mono text-[6px] uppercase tracking-[0.18em] transition ${
                      draft.role === role.id
                        ? 'border-[color:var(--hud-mint)]/60 text-[color:var(--hud-mint)]'
                        : 'border-[color:var(--hud-line)] text-[color:var(--hud-ink-dim)] hover:border-[color:var(--hud-line-strong)]'
                    }`}
                  >
                    {role.label}
                  </button>
                ))}
                <span className="ml-2 font-mono text-[6px] uppercase tracking-[0.24em] text-[color:var(--hud-ink-dim)]">start</span>
                {TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => {
                      actions.applyTemplate(template);
                      setResult(null);
                    }}
                    title={template.why}
                    className="rounded border border-[color:var(--hud-line)] px-1.5 py-[2px] font-mono text-[6px] uppercase tracking-[0.18em] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-mint)] hover:text-[color:var(--hud-mint)]"
                  >
                    {template.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="hud-scroll min-h-0 overflow-visible lg:flex-1 lg:overflow-y-auto">
              <div className="hidden md:block">
                <StudioGraph
                  draft={draft}
                  validation={validation}
                  activeCategory={category}
                  onSelectCategory={setCategory}
                />
              </div>

              {/* the map never disappears for small screens — it becomes a list */}
              <ul className="grid grid-cols-1 gap-1 px-3 py-2 md:hidden">
                {CATEGORY_ORDER.map((entry) => {
                  const caps = Object.keys(draft.selected)
                    .map((id) => CAPABILITY_BY_ID[id])
                    .filter((capability) => capability?.category === entry);
                  return (
                    <li key={`mobile-${entry}`}>
                      <button
                        type="button"
                        onClick={() => setCategory(entry)}
                        className="flex w-full items-center justify-between gap-2 rounded border border-[color:var(--hud-line)] px-2 py-1.5 text-left"
                      >
                        <span className="font-mono text-[7px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)]">
                          {CATEGORY_META[entry].short}
                        </span>
                        <span className="truncate font-mono text-[7px] uppercase tracking-[0.12em] text-[color:var(--hud-ink)]">
                          {caps.map((capability) => capability!.name).join(', ') || 'not set'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {/* -------------------- validation -------------------- */}
              <div className="border-t border-[color:var(--hud-line)] bg-[#020a0d]/80 px-3 py-2" aria-live="polite">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <p className="font-mono text-[7px] uppercase tracking-[0.26em] text-[color:var(--hud-ink-dim)]">
                    validation · {validation.issues.length} finding{validation.issues.length === 1 ? '' : 's'}
                  </p>
                  <span className="font-mono text-[6px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)]">
                    checked {snapshot ? new Date(snapshot.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                    {snapshot ? ` · ${snapshot.modelCount} models` : ''}
                  </span>
                </div>
                {validation.issues.length === 0 && (
                  <p className="flex items-center gap-2 font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-lime)]">
                    <Check size={10} /> every layer supports this configuration
                  </p>
                )}
                <ul className="space-y-1">
                  {validation.issues.slice(0, 14).map((issue) => (
                    <ValidationRow
                      key={issue.id}
                      issue={issue}
                      acknowledged={draft.acknowledged.includes(issue.id)}
                      onAcknowledge={() => actions.acknowledge(issue.id)}
                      onUnacknowledge={() => actions.unacknowledge(issue.id)}
                      onFocus={() => issue.capabilityId && CAPABILITY_BY_ID[issue.capabilityId] && setCategory(CAPABILITY_BY_ID[issue.capabilityId].category)}
                    />
                  ))}
                </ul>
              </div>
            </div>
          </section>

          {/* -------------------------- inspector -------------------------- */}
          <aside
            className={`w-full flex-col border-t border-[color:var(--hud-line)] bg-[#020a0d]/64 lg:flex lg:min-h-0 lg:w-[340px] lg:border-l lg:border-t-0 ${
              pane === 'inspect' ? 'flex' : 'hidden'
            }`}
          >
            <div className="hud-scroll min-h-0 overflow-visible px-3 py-2 lg:flex-1 lg:overflow-y-auto">
              <p className="mb-1.5 font-mono text-[7px] uppercase tracking-[0.26em] text-[color:var(--hud-ink-dim)]">
                {CATEGORY_META[category].label} · inspector
              </p>

              {!activeCapability && (
                <p className="mb-3 font-mono text-[7px] uppercase leading-[1.7] tracking-[0.16em] text-[color:var(--hud-ink-dim)]">
                  nothing selected in this category — pick one from the palette on the left
                </p>
              )}

              {activeCapability && (
                <div className="mb-3 rounded border border-[color:var(--hud-line)] px-2 py-2">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[color:var(--hud-ink)]">
                      {activeCapability.name}
                    </span>
                    <AvailabilityBadge
                      state={validation.verdicts[activeCapability.id]?.availability ?? activeCapability.availability}
                    />
                  </div>
                  <p className="mb-1 font-mono text-[7px] uppercase leading-[1.7] tracking-[0.12em] text-[color:var(--hud-ink-dim)]">
                    {activeCapability.summary}
                  </p>
                  {validation.verdicts[activeCapability.id]?.reasons.length ? (
                    <p className="mb-1 font-mono text-[6.5px] uppercase leading-[1.6] tracking-[0.14em] text-[#ff9d7a]">
                      not usable: {validation.verdicts[activeCapability.id].reasons.join(' · ')}
                    </p>
                  ) : null}

                  {activeCapability.category === 'model' && (
                    <div className="mt-2 space-y-1.5">
                      <label
                        htmlFor="studio-model"
                        className="block font-mono text-[6px] uppercase tracking-[0.22em] text-[color:var(--hud-ink-dim)]"
                      >
                        primary model
                      </label>
                      <select
                        id="studio-model"
                        value={String(draft.selected['model.brain']?.model ?? '')}
                        onChange={(event) => actions.configure('model.brain', { model: event.target.value })}
                        className="w-full rounded border border-[color:var(--hud-line)] bg-black/50 px-1.5 py-1 font-mono text-[8px] text-[color:var(--hud-ink)] outline-none"
                      >
                        <option value="">— choose from the live catalogue —</option>
                        {(snapshot?.models ?? []).map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.configured ? '● ' : '○ '}
                            {model.label} · {model.provider}
                          </option>
                        ))}
                      </select>
                      <label
                        htmlFor="studio-fallback"
                        className="block font-mono text-[6px] uppercase tracking-[0.22em] text-[color:var(--hud-ink-dim)]"
                      >
                        fallback (optional)
                      </label>
                      <select
                        id="studio-fallback"
                        value={String(draft.selected['model.brain']?.fallbackModel ?? '')}
                        onChange={(event) => actions.configure('model.brain', { fallbackModel: event.target.value })}
                        className="w-full rounded border border-[color:var(--hud-line)] bg-black/50 px-1.5 py-1 font-mono text-[8px] text-[color:var(--hud-ink)] outline-none"
                      >
                        <option value="">— none —</option>
                        {(snapshot?.models ?? []).map((model) => (
                          <option key={`fb-${model.id}`} value={model.id}>
                            {model.label} · {model.provider}
                          </option>
                        ))}
                      </select>
                      {routedModel && (
                        <p className="font-mono text-[6px] uppercase leading-[1.6] tracking-[0.16em] text-[color:var(--hud-ink-dim)]">
                          features: {routedModel.features.join(' · ') || 'none declared'}
                        </p>
                      )}
                    </div>
                  )}

                  {activeCapability.config.map((field) => (
                    <div key={field.key} className="mt-1.5">
                      <label
                        htmlFor={`field-${field.key}`}
                        className="block font-mono text-[6px] uppercase tracking-[0.22em] text-[color:var(--hud-ink-dim)]"
                      >
                        {field.label}
                      </label>
                      {field.kind === 'select' && (
                        <select
                          id={`field-${field.key}`}
                          value={String(fieldValue(field))}
                          onChange={(event) => setField(field, event.target.value)}
                          className="mt-0.5 w-full rounded border border-[color:var(--hud-line)] bg-black/50 px-1.5 py-1 font-mono text-[8px] text-[color:var(--hud-ink)] outline-none"
                        >
                          {field.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      )}
                      {field.kind === 'number' && (
                        <input
                          id={`field-${field.key}`}
                          type="number"
                          min={field.min}
                          max={field.max}
                          step={field.step ?? 1}
                          value={Number(fieldValue(field))}
                          onChange={(event) => setField(field, Number(event.target.value))}
                          className="mt-0.5 w-full rounded border border-[color:var(--hud-line)] bg-black/50 px-1.5 py-1 font-mono text-[8px] text-[color:var(--hud-ink)] outline-none"
                        />
                      )}
                      {field.kind === 'toggle' && (
                        <button
                          type="button"
                          onClick={() => setField(field, !fieldValue(field))}
                          aria-pressed={Boolean(fieldValue(field))}
                          className={`mt-0.5 flex w-full items-center justify-between rounded border px-1.5 py-1 font-mono text-[7px] uppercase tracking-[0.18em] ${
                            fieldValue(field)
                              ? 'border-[color:var(--hud-lime)]/50 text-[color:var(--hud-lime)]'
                              : 'border-[color:var(--hud-line)] text-[color:var(--hud-ink-dim)]'
                          }`}
                        >
                          {fieldValue(field) ? 'enabled' : 'disabled'}
                          <span aria-hidden="true">{fieldValue(field) ? '◉' : '○'}</span>
                        </button>
                      )}
                      {field.help && (
                        <p className="mt-0.5 font-mono text-[5.5px] uppercase leading-[1.6] tracking-[0.14em] text-[color:var(--hud-ink-dim)]">
                          {field.help}
                        </p>
                      )}
                    </div>
                  ))}

                  {activeCapability.limitations.length > 0 && (
                    <ul className="mt-2 space-y-[2px] border-t border-[color:var(--hud-line)] pt-1.5">
                      {activeCapability.limitations.map((limitation) => (
                        <li
                          key={limitation}
                          className="flex items-start gap-1 font-mono text-[6px] uppercase leading-[1.6] tracking-[0.12em] text-[color:var(--hud-ink-dim)]"
                        >
                          <CircleSlash size={8} className="mt-[1px] flex-none" /> {limitation}
                        </li>
                      ))}
                    </ul>
                  )}
                  {activeCapability.implementation && (
                    <p className="mt-1 font-mono text-[5.5px] uppercase tracking-[0.14em] text-[color:var(--hud-ink-dim)] opacity-80">
                      {activeCapability.implementation}
                      {activeCapability.licence ? ` · ${activeCapability.licence}` : ''}
                    </p>
                  )}
                </div>
              )}

              {/* permissions */}
              <p className="mb-1.5 font-mono text-[7px] uppercase tracking-[0.26em] text-[color:var(--hud-ink-dim)]">
                permissions
              </p>
              <div className="mb-3 space-y-1">
                {(Object.keys(PERMISSION_META) as PermissionScope[]).map((scope) => {
                  const meta = PERMISSION_META[scope];
                  const granted = draft.granted.includes(scope);
                  const owners = Object.keys(draft.selected)
                    .map((id) => CAPABILITY_BY_ID[id])
                    .filter((capability) => capability?.permissions.includes(scope))
                    .map((capability) => capability!.name);
                  return (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => (granted ? actions.revokeScope(scope) : actions.grantScope(scope))}
                      aria-pressed={granted}
                      className={`flex w-full items-center justify-between gap-2 rounded border px-1.5 py-1 text-left transition ${
                        granted
                          ? 'border-[color:var(--hud-mint)]/45 text-[color:var(--hud-mint)]'
                          : 'border-[color:var(--hud-line)] text-[color:var(--hud-ink-dim)] hover:border-[color:var(--hud-line-strong)]'
                      }`}
                    >
                      <span className="flex items-center gap-1 font-mono text-[6.5px] uppercase tracking-[0.16em]">
                        {granted ? <ShieldCheck size={9} /> : <Lock size={9} />}
                        {meta.label}
                      </span>
                      <span className="font-mono text-[5.5px] uppercase tracking-[0.16em] opacity-80">
                        {owners.length ? `${owners.length} needs` : meta.risk}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* summary */}
              <p className="mb-1.5 font-mono text-[7px] uppercase tracking-[0.26em] text-[color:var(--hud-ink-dim)]">
                summary
              </p>
              <dl className="space-y-[3px] font-mono text-[6.5px] uppercase tracking-[0.14em] text-[color:var(--hud-ink-dim)]">
                <div className="flex justify-between gap-2">
                  <dt>capabilities</dt>
                  <dd className="text-[color:var(--hud-ink)]">{Object.keys(draft.selected).length}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>features</dt>
                  <dd className="truncate text-right text-[color:var(--hud-ink)]">{summary.features.join(' · ') || '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>scopes</dt>
                  <dd className="text-right text-[color:var(--hud-ink)]">{draft.granted.join(' · ') || 'none'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>probe</dt>
                  <dd className="text-right text-[color:var(--hud-ink)]">
                    {probing ? 'checking…' : snapshot ? `${snapshot.configuredProviders.filter((p) => p.configured).length} providers ready` : 'static catalogue'}
                  </dd>
                </div>
              </dl>

              {draft.role && (ROLE_REQUIREMENTS[draft.role]?.length ?? 0) > 0 && (
                <p className="mt-2 flex items-start gap-1 font-mono text-[5.5px] uppercase leading-[1.6] tracking-[0.14em] text-[color:var(--hud-ink-dim)]">
                  <Layers size={8} className="mt-[1px] flex-none" />
                  {draft.role} role requires {ROLE_REQUIREMENTS[draft.role].map((id) => CAPABILITY_BY_ID[id]?.name ?? id).join(', ')}
                </p>
              )}

              {result && (
                <p className="mt-3 flex items-start gap-1 border border-[color:var(--hud-lime)]/40 bg-[color:var(--hud-lime)]/5 px-1.5 py-1 font-mono text-[6.5px] uppercase leading-[1.7] tracking-[0.14em] text-[color:var(--hud-lime)]">
                  <CheckCircle2 size={9} className="mt-[1px] flex-none" />
                  {result}
                </p>
              )}
            </div>
          </aside>
        </div>

        {/* ------------------------------ footer ------------------------------ */}
        <footer className="relative z-10 flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--hud-line)] bg-[#020a0d]/70 px-3 py-1.5 font-mono text-[6px] uppercase tracking-[0.22em] text-[color:var(--hud-ink-dim)]">
          <span className="flex items-center gap-2">
            <Cpu size={9} /> {snapshot ? `${snapshot.modelCount} models · ${snapshot.configuredProviders.length} providers` : 'probe pending'}
            <span className="opacity-60">·</span> {validation.blockers.length} blocked
            <span className="opacity-60">·</span> {validation.warnings.length} to acknowledge
          </span>
          <span className="flex items-center gap-2">
            <ArrowRight size={9} /> activation writes a versioned record · escapes close
          </span>
        </footer>

        {/* -------------------------- activation sheet -------------------------- */}
        {sheet && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 p-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Activation review"
              className="hud-panel max-h-[80vh] w-full max-w-[560px] overflow-y-auto px-4 py-3"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-[7px] uppercase tracking-[0.3em] text-[color:var(--hud-ink-dim)]">
                    pre-activation review
                  </p>
                  <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[color:var(--hud-ink)]">
                    {draft.name || 'Untitled agent'} · v{draft.version}
                  </h3>
                </div>
                <button type="button" onClick={() => setSheet(false)} aria-label="Close activation review">
                  ✕
                </button>
              </div>

              <p className="mb-2 font-mono text-[7px] uppercase leading-[1.7] tracking-[0.14em] text-[color:var(--hud-ink-dim)]">
                {draft.goal || 'no goal written yet'}
              </p>

              <SheetBlock title="capabilities" items={summary.capabilities.map((entry) => `${entry.name} · ${entry.availability}`)} />
              <SheetBlock title="data access" items={summary.dataAccess} empty="no data scopes requested" />
              <SheetBlock title="limits" items={summary.limits} empty="no explicit limits" />
              <SheetBlock title="features" items={summary.features} empty="no features verified" />

              <p className="mt-2 border-t border-[color:var(--hud-line)] pt-2 font-mono text-[6px] uppercase leading-[1.7] tracking-[0.16em] text-[color:var(--hud-ink-dim)]">
                activation saves this exact configuration as a new version. Nothing runs on its own: this
                deployment has no connected runtime unless the framework row says Ready.
              </p>

              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSheet(false)}
                  className="rounded border border-[color:var(--hud-line)] px-2 py-1 font-mono text-[7px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)]"
                >
                  cancel
                </button>
                <button
                  type="button"
                  disabled={studio.activating}
                  onClick={async () => {
                    const record = await studio.activate();
                    if (record) {
                      setSheet(false);
                      setResult(
                        `activated v${record.version} · runtime ${record.runtime.connected ? 'connected' : 'not connected'} — ${record.runtime.note}`,
                      );
                    }
                  }}
                  className="flex items-center gap-1 rounded border border-[color:var(--hud-lime)]/60 px-2.5 py-1 font-mono text-[7px] uppercase tracking-[0.22em] text-[color:var(--hud-lime)] transition hover:bg-[color:var(--hud-lime)]/10 disabled:opacity-50"
                >
                  <PlayCircle size={10} /> {studio.activating ? 'activating…' : 'confirm activation'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SheetBlock({ title, items, empty }: { title: string; items: string[]; empty?: string }) {
  return (
    <div className="mb-2">
      <p className="mb-1 font-mono text-[6px] uppercase tracking-[0.24em] text-[color:var(--hud-ink-dim)]">{title}</p>
      {items.length === 0 ? (
        <p className="font-mono text-[6.5px] uppercase tracking-[0.14em] text-[color:var(--hud-ink-dim)] opacity-70">
          {empty ?? 'none'}
        </p>
      ) : (
        <ul className="space-y-[1px]">
          {items.map((item) => (
            <li key={item} className="font-mono text-[6.5px] uppercase tracking-[0.12em] text-[color:var(--hud-ink)]">
              ▸ {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CapabilityRow({
  capability,
  availability,
  selected,
  selectable,
  onToggle,
}: {
  capability: Capability;
  availability: Availability;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
}) {
  const meta = AVAILABILITY_META[availability];
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      title={capability.availabilityNote ?? capability.summary}
      className={`mb-1 w-full rounded border px-2 py-1.5 text-left transition ${
        selected
          ? 'border-[color:var(--hud-mint)]/50 bg-[color:var(--hud-mint)]/5'
          : 'border-[color:var(--hud-line)] hover:border-[color:var(--hud-line-strong)]'
      } ${selectable ? '' : 'opacity-70'}`}
    >
      <span className="flex items-start justify-between gap-1">
        <span className="font-mono text-[8px] uppercase leading-[1.4] tracking-[0.1em] text-[color:var(--hud-ink)]">
          {capability.name}
        </span>
        <span className={`flex-none font-mono text-[5.5px] uppercase tracking-[0.16em] ${toneClass(meta.tone).split(' ')[0]}`}>
          {selected ? '◉ added' : meta.label}
        </span>
      </span>
      <span className="mt-[2px] block font-mono text-[6px] uppercase leading-[1.6] tracking-[0.1em] text-[color:var(--hud-ink-dim)]">
        {capability.summary}
      </span>
      {capability.requires.length > 0 && (
        <span className="mt-[2px] block font-mono text-[5.5px] uppercase tracking-[0.14em] text-[color:var(--hud-ink-dim)] opacity-80">
          needs {capability.requires.map((id) => CAPABILITY_BY_ID[id]?.name ?? id).join(' · ')}
        </span>
      )}
    </button>
  );
}

function ValidationRow({
  issue,
  acknowledged,
  onAcknowledge,
  onUnacknowledge,
  onFocus,
}: {
  issue: ValidationIssue;
  acknowledged: boolean;
  onAcknowledge: () => void;
  onUnacknowledge: () => void;
  onFocus: () => void;
}) {
  const blocker = issue.severity === 'blocker';
  const warning = issue.severity === 'warning';
  return (
    <li
      className={`flex items-start gap-1.5 rounded border px-1.5 py-1 ${
        blocker
          ? 'border-[#ff9d7a]/40 bg-[#ff9d7a]/5'
          : warning
            ? 'border-[#ffd27a]/40 bg-[#ffd27a]/5'
            : 'border-[color:var(--hud-line)] bg-black/20'
      }`}
    >
      <span className="mt-[1px] flex-none">
        {blocker ? (
          <XCircle size={9} className="text-[#ff9d7a]" />
        ) : warning ? (
          <AlertTriangle size={9} className="text-[#ffd27a]" />
        ) : (
          <CheckCircle2 size={9} className="text-[color:var(--hud-lime)]" />
        )}
      </span>
      <span className="flex-1">
        <button type="button" onClick={onFocus} className="block text-left font-mono text-[6.5px] uppercase leading-[1.7] tracking-[0.1em] text-[color:var(--hud-ink)]">
          {issue.message}
        </button>
        <span className="block font-mono text-[5.5px] uppercase leading-[1.6] tracking-[0.12em] text-[color:var(--hud-ink-dim)]">
          → {issue.fix}
        </span>
      </span>
      {warning && (
        <button
          type="button"
          onClick={acknowledged ? onUnacknowledge : onAcknowledge}
          aria-label={acknowledged ? `Undo acknowledgement: ${issue.message}` : `Acknowledge: ${issue.message}`}
          className={`flex-none rounded border px-1 py-[1px] font-mono text-[5.5px] uppercase tracking-[0.16em] ${
            acknowledged
              ? 'border-[color:var(--hud-lime)]/50 text-[color:var(--hud-lime)]'
              : 'border-[#ffd27a]/50 text-[#ffd27a]'
          }`}
        >
          {acknowledged ? 'acked' : 'ack'}
        </button>
      )}
    </li>
  );
}
