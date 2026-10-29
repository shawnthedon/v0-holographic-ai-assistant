'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDot,
  Eye,
  Globe,
  Pause,
  Play,
  RefreshCw,
  Route,
  ShieldAlert,
  SkipForward,
  Square,
  Timer,
} from 'lucide-react';

import { useBrowserTasks } from '@/hooks/use-browser-tasks';
import type { BrowserTaskState, BrowserTaskView, TimelineEvent } from '@/lib/browser/types';

const STATE_STYLE: Record<BrowserTaskState, { text: string; className: string }> = {
  QUEUED: { text: 'queued', className: 'border-[color:var(--hud-line)] text-[color:var(--hud-ink-dim)]' },
  RUNNING: { text: 'running', className: 'border-[color:var(--hud-lime)]/60 text-[color:var(--hud-lime)]' },
  RECOVERING: { text: 'recovering', className: 'border-[#ffd27a]/60 text-[#ffd27a]' },
  WAITING_FOR_USER: { text: 'waiting for you', className: 'border-[#ffd27a]/70 text-[#ffd27a]' },
  PAUSED: { text: 'paused', className: 'border-[color:var(--hud-line)] text-[color:var(--hud-ink-dim)]' },
  COMPLETED: { text: 'completed', className: 'border-[color:var(--hud-mint)]/60 text-[color:var(--hud-mint)]' },
  FAILED: { text: 'failed', className: 'border-[#ff9d7a]/60 text-[#ff9d7a]' },
  BLOCKED: { text: 'blocked', className: 'border-[#ff9d7a]/60 text-[#ff9d7a]' },
  CANCELLED: { text: 'cancelled', className: 'border-[color:var(--hud-line)] text-[color:var(--hud-ink-dim)]' },
  TIMED_OUT: { text: 'timed out', className: 'border-[#ff9d7a]/60 text-[#ff9d7a]' },
};

const ACTIVITY_TEXT: Record<string, string> = {
  working: 'actively working',
  recovering: 'recovering',
  waiting: 'waiting for you',
  paused: 'paused',
  stalled: 'stalled — no verified progress',
  done: 'finished',
};

const EVENT_ACCENT: Record<TimelineEvent['kind'], string> = {
  state: 'text-[color:var(--hud-ink-dim)]',
  action: 'text-[color:var(--hud-ink)]',
  milestone: 'text-[color:var(--hud-mint)]',
  retry: 'text-[#ffd27a]',
  recovery: 'text-[#ffd27a]',
  loop: 'text-[#ff9d7a]',
  restriction: 'text-[#ff9d7a]',
  blocker: 'text-[#ff9d7a]',
  checkpoint: 'text-[color:var(--hud-lime)]',
  health: 'text-[color:var(--hud-ink-dim)]',
  note: 'text-[color:var(--hud-ink-dim)]',
  error: 'text-[#ff9d7a]',
};

function ago(ms: number): string {
  if (ms < 1_000) return 'just now';
  const seconds = Math.floor(ms / 1_000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${days}d ago`;
}

function clock(ms: number): string {
  const abs = Math.abs(ms);
  const seconds = Math.floor(abs / 1_000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Live observation of the browser agent.
 *
 * Everything here is reported from the task record: what the agent is doing, what
 * it last did successfully, when it last made verified progress, how many
 * recoveries it attempted, and why it stopped. There is deliberately no spinner
 * that keeps moving when the agent is stuck — a stalled task says "stalled".
 */
export function BrowserPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const consoleState = useBrowserTasks(open);
  // Empty by default: a prefilled value is something people type after, which
  // silently produces a glued URL.
  const [url, setUrl] = useState('');
  const [expectedText, setExpectedText] = useState('');
  const [objective, setObjective] = useState('');
  const [showSpec, setShowSpec] = useState(false);
  const [specText, setSpecText] = useState('');
  const [specError, setSpecError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const selected = consoleState.selected;

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  const timeline = useMemo(() => (selected ? [...selected.task.events].reverse().slice(0, 80) : []), [selected]);

  if (!open) return null;

  const engine = consoleState.engine;
  const remainingSteps = selected
    ? selected.task.spec.plan.length - selected.task.stepIndex
    : 0;

  return (
    <div className="fixed inset-0 z-[73] flex items-start justify-center bg-black/85 p-3 pt-[3vh] backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Browser agent"
        className="relative flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded border border-[color:var(--hud-line-strong)] bg-[#030c10]/97 shadow-[0_0_80px_rgba(46,242,192,0.14)]"
      >
        {/* header */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--hud-line)] px-4 py-3">
          <div>
            <p className="font-mono text-[8px] uppercase tracking-[0.34em] text-[color:var(--hud-ink-dim)]">
              agent browser · autonomous recovery
            </p>
            <h2 className="font-mono text-[13px] tracking-[0.18em] text-[color:var(--hud-ink)]">
              LONG-RUNNING TASKS
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[7px] uppercase tracking-[0.2em]">
            <span
              className={`flex items-center gap-1 rounded border px-2 py-[3px] ${
                engine?.available
                  ? 'border-[color:var(--hud-lime)]/50 text-[color:var(--hud-lime)]'
                  : 'border-[#ff9d7a]/60 text-[#ff9d7a]'
              }`}
            >
              <Globe size={9} /> {engine ? (engine.available ? engine.kind : 'no browser') : '…'}
            </span>
            <span className="rounded border border-[color:var(--hud-line)] px-2 py-[3px] text-[color:var(--hud-ink-dim)]">
              {consoleState.tasks.length} task{consoleState.tasks.length === 1 ? '' : 's'}
            </span>
            <span className="rounded border border-[color:var(--hud-line)] px-2 py-[3px] text-[color:var(--hud-ink-dim)]">
              {consoleState.durable ? 'checkpoints on disk' : 'checkpoints in memory'}
            </span>
            <button
              type="button"
              onClick={() => void consoleState.refresh()}
              aria-label="Refresh tasks"
              className="flex items-center gap-1 rounded border border-[color:var(--hud-line)] px-2 py-[3px] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)]"
            >
              <RefreshCw size={9} /> reload
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close browser agent"
              className="rounded border border-[color:var(--hud-line)] p-1.5 text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-line-strong)] hover:text-[color:var(--hud-ink)]"
            >
              ✕
            </button>
          </div>
        </header>

        {/* engine / error notices */}
        {engine && !engine.available && (
          <p className="flex items-start gap-2 border-b border-[#ff9d7a]/40 bg-[#ff9d7a]/10 px-4 py-2 font-mono text-[8px] uppercase leading-[1.6] tracking-[0.14em] text-[#ff9d7a]">
            <AlertTriangle size={11} className="mt-[1px] flex-none" />
            <span>
              <span className="mr-2 rounded border border-[#ff9d7a]/50 px-1">browser-unavailable</span>
              {engine.reason} — {engine.fix}
            </span>
          </p>
        )}
        {consoleState.error && (
          <p className="flex items-start gap-2 border-b border-[#ff9d7a]/40 bg-[#ff9d7a]/10 px-4 py-2 font-mono text-[8px] uppercase leading-[1.6] tracking-[0.14em] text-[#ff9d7a]">
            <span className="flex-1">
              <span className="mr-2 rounded border border-[#ff9d7a]/50 px-1">{consoleState.error.code}</span>
              {consoleState.error.message} — {consoleState.error.fix}
            </span>
            <button type="button" onClick={consoleState.dismissError} aria-label="Dismiss error">
              ✕
            </button>
          </p>
        )}

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* task list */}
          <div className="flex min-h-0 w-full flex-col border-[color:var(--hud-line)] md:w-[34%] md:border-r">
            <form
              className="border-b border-[color:var(--hud-line)] px-3 py-2.5"
              onSubmit={(event) => {
                event.preventDefault();
                if (!url.trim() || !expectedText.trim()) return;
                void consoleState.startCheck({ objective, url, expectedText });
              }}
            >
              <p className="mb-1.5 font-mono text-[7px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)]">
                new supervised check
              </p>
              <input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com/report"
                aria-label="Start URL"
                className="mb-1 w-full rounded border border-[color:var(--hud-line)] bg-black/40 px-2 py-1 font-mono text-[9px] text-[color:var(--hud-ink)] outline-none placeholder:text-[color:var(--hud-ink-dim)]"
              />
              <input
                value={expectedText}
                onChange={(event) => setExpectedText(event.target.value)}
                placeholder="text that must appear (success criterion)"
                aria-label="Expected text"
                className="mb-1 w-full rounded border border-[color:var(--hud-line)] bg-black/40 px-2 py-1 font-mono text-[9px] text-[color:var(--hud-ink)] outline-none placeholder:text-[color:var(--hud-ink-dim)]"
              />
              <input
                value={objective}
                onChange={(event) => setObjective(event.target.value)}
                placeholder="objective (optional)"
                aria-label="Objective"
                className="mb-1.5 w-full rounded border border-[color:var(--hud-line)] bg-black/40 px-2 py-1 font-mono text-[9px] text-[color:var(--hud-ink)] outline-none placeholder:text-[color:var(--hud-ink-dim)]"
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={consoleState.busy !== null || !engine?.available}
                  className="rounded border border-[color:var(--hud-lime)]/60 px-2.5 py-1 font-mono text-[7px] uppercase tracking-[0.2em] text-[color:var(--hud-lime)] transition hover:bg-[color:var(--hud-lime)]/10 disabled:opacity-40"
                >
                  {consoleState.busy === 'start' ? 'starting…' : 'run check'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowSpec((value) => !value)}
                  className="rounded border border-[color:var(--hud-line)] px-2 py-1 font-mono text-[7px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-ink)] hover:text-[color:var(--hud-ink)]"
                >
                  {showSpec ? 'simple' : 'full plan'}
                </button>
              </div>
              {showSpec && (
                <div className="mt-2">
                  <textarea
                    value={specText}
                    onChange={(event) => setSpecText(event.target.value)}
                    rows={6}
                    placeholder={'{"objective":"…","startUrl":"…","profile":"console","plan":[…],"successCriteria":[…]}'}
                    aria-label="Task spec JSON"
                    className="w-full resize-y rounded border border-[color:var(--hud-line)] bg-black/40 px-2 py-1 font-mono text-[8px] leading-relaxed text-[color:var(--hud-ink)] outline-none placeholder:text-[color:var(--hud-ink-dim)]"
                  />
                  {specError && <p className="mt-1 font-mono text-[7px] uppercase text-[#ff9d7a]">{specError}</p>}
                  <button
                    type="button"
                    onClick={async () => {
                      setSpecError(null);
                      try {
                        const spec = JSON.parse(specText);
                        const ok = await consoleState.startSpec(spec);
                        if (ok) setShowSpec(false);
                      } catch (error) {
                        setSpecError(error instanceof Error ? error.message : 'invalid JSON');
                      }
                    }}
                    className="mt-1 rounded border border-[color:var(--hud-mint)]/60 px-2 py-1 font-mono text-[7px] uppercase tracking-[0.2em] text-[color:var(--hud-mint)] transition hover:bg-[color:var(--hud-mint)]/10"
                  >
                    start task
                  </button>
                </div>
              )}
            </form>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {consoleState.loading && (
                <p className="px-3 py-4 font-mono text-[8px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)]">
                  reading tasks…
                </p>
              )}
              {!consoleState.loading && consoleState.tasks.length === 0 && (
                <p className="px-3 py-4 font-mono text-[8px] uppercase leading-[1.8] tracking-[0.16em] text-[color:var(--hud-ink-dim)]">
                  no tasks yet.
                  <br />
                  a check navigates once and verifies the text you expect — nothing is simulated.
                </p>
              )}
              {consoleState.tasks.map((view) => {
                const style = STATE_STYLE[view.task.state];
                return (
                  <button
                    key={view.task.id}
                    type="button"
                    onClick={() => consoleState.select(view.task.id)}
                    className={`w-full border-b border-[color:var(--hud-line)]/60 px-3 py-2 text-left transition hover:bg-[color:var(--hud-ink)]/5 ${
                      consoleState.selectedId === view.task.id ? 'bg-[color:var(--hud-lime)]/5' : ''
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={`rounded border px-1 py-[1px] font-mono text-[6.5px] uppercase tracking-[0.16em] ${style.className}`}>
                        {style.text}
                      </span>
                      <span className="truncate font-mono text-[9px] text-[color:var(--hud-ink)]">{view.task.spec.objective}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 font-mono text-[7px] uppercase tracking-[0.14em] text-[color:var(--hud-ink-dim)]">
                      <span>{view.task.currentTitle || view.task.currentUrl}</span>
                      <span>·</span>
                      <span>{ago(now - view.task.lastProgressAt)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* detail */}
          <div className="flex min-h-0 w-full flex-col md:w-[66%]">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center px-6 text-center">
                <p className="font-mono text-[8px] uppercase leading-[1.9] tracking-[0.22em] text-[color:var(--hud-ink-dim)]">
                  select a task to see what the agent did,
                  <br />
                  what it is doing, and why it stopped.
                </p>
              </div>
            ) : (
              <>
                {/* status strip */}
                <div className="border-b border-[color:var(--hud-line)] px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[7px] uppercase tracking-[0.18em]">
                    <span className={`rounded border px-1.5 py-[2px] ${STATE_STYLE[selected.task.state].className}`}>
                      {STATE_STYLE[selected.task.state].text}
                    </span>
                    <span className="flex items-center gap-1 text-[color:var(--hud-ink-dim)]">
                      <Activity size={9} /> {ACTIVITY_TEXT[selected.activity]}
                    </span>
                    <span className="flex items-center gap-1 text-[color:var(--hud-ink-dim)]">
                      <Timer size={9} /> {ago(now - selected.task.lastProgressAt)}
                    </span>
                    <span className="text-[color:var(--hud-ink-dim)]">
                      deadline in {selected.msRemaining > 0 ? clock(selected.msRemaining) : 'expired'}
                    </span>
                    <span className="text-[color:var(--hud-ink-dim)]">
                      {remainingSteps} step{remainingSteps === 1 ? '' : 's'} left
                    </span>
                  </div>

                  <p className="mt-1.5 font-mono text-[9px] leading-[1.6] text-[color:var(--hud-ink)]">
                    {selected.task.spec.objective}
                  </p>
                  <p className="mt-0.5 font-mono text-[8px] tracking-[0.06em] text-[color:var(--hud-ink-dim)]">
                    {selected.task.currentUrl} {selected.task.currentTitle ? `· ${selected.task.currentTitle}` : ''}
                  </p>

                  {/* controls */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Control
                      label="pause"
                      icon={Pause}
                      disabled={selected.task.state !== 'RUNNING' && selected.task.state !== 'RECOVERING'}
                      onClick={() => void consoleState.act(selected.task.id, 'pause')}
                    />
                    <Control
                      label="resume"
                      icon={Play}
                      disabled={!['PAUSED', 'WAITING_FOR_USER', 'BLOCKED', 'FAILED', 'TIMED_OUT'].includes(selected.task.state)}
                      onClick={() => void consoleState.act(selected.task.id, 'resume')}
                    />
                    <Control
                      label="stop"
                      icon={Square}
                      disabled={['COMPLETED', 'CANCELLED', 'FAILED', 'BLOCKED', 'TIMED_OUT'].includes(selected.task.state)}
                      onClick={() => void consoleState.act(selected.task.id, 'cancel')}
                    />
                    <Control
                      label="inspect"
                      icon={Eye}
                      onClick={() => void consoleState.act(selected.task.id, 'inspect')}
                    />
                  </div>
                </div>

                {/* facts */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-b border-[color:var(--hud-line)] px-3 py-2 font-mono text-[7.5px] uppercase leading-[1.7] tracking-[0.14em]">
                  <Fact label="last successful action" value={selected.task.lastAction ? `${selected.task.lastAction.label} · ${ago(now - selected.task.lastAction.at)}` : 'none yet'} />
                  <Fact
                    label="last verified milestone"
                    value={
                      selected.task.lastMilestone
                        ? `${selected.task.lastMilestone.label}${selected.task.lastMilestone.verified ? ' ✓' : ' (unverified)'} · ${ago(now - selected.task.lastMilestone.at)}`
                        : 'none yet'
                    }
                  />
                  <Fact label="recovery attempts" value={String(selected.task.recoveryAttempts)} warn={selected.task.recoveryAttempts > 0} />
                  <Fact label="retries used" value={`${selected.task.retriesUsed}/${selected.task.limits.maxRetries}`} />
                  <Fact label="consecutive failures" value={String(selected.task.consecutiveFailures)} warn={selected.task.consecutiveFailures > 0} />
                  <Fact label="loops flagged" value={selected.task.loopFlags.length ? selected.task.loopFlags.join(', ') : 'none'} warn={selected.task.loopFlags.length > 0} />
                  <Fact label="checkpoints" value={String(selected.task.checkpoints.length)} />
                  <Fact
                    label="browser"
                    value={
                      selected.task.health
                        ? `${selected.task.health.tabs} tab(s) · ${selected.task.health.heapMb} MB heap`
                        : 'unknown'
                    }
                  />
                </div>

                {/* blocker */}
                {(selected.task.blocker || selected.task.restriction) && (
                  <div className="border-b border-[#ff9d7a]/30 bg-[#ff9d7a]/8 px-3 py-2 font-mono text-[7.5px] uppercase leading-[1.7] tracking-[0.14em] text-[#ff9d7a]">
                    {selected.task.blocker && (
                      <p className="flex items-start gap-1.5">
                        <ShieldAlert size={11} className="mt-[1px] flex-none" />
                        <span>
                          <span className="mr-1.5 rounded border border-[#ff9d7a]/50 px-1">{selected.task.blocker.code}</span>
                          {selected.task.blocker.message}
                          <span className="mt-0.5 block normal-case tracking-[0.04em] text-[#ffd9c9]/80">{selected.task.blocker.fix}</span>
                        </span>
                      </p>
                    )}
                    {selected.task.restriction && (
                      <p className="mt-1 flex items-start gap-1.5">
                        <Ban size={11} className="mt-[1px] flex-none" />
                        <span>
                          site restriction: {selected.task.restriction.kind} · {selected.task.restriction.evidence}
                        </span>
                      </p>
                    )}
                  </div>
                )}

                {/* outcome + evidence */}
                {selected.task.outcome && (
                  <div className="border-b border-[color:var(--hud-line)] px-3 py-2">
                    <p className="flex items-start gap-1.5 font-mono text-[8px] uppercase leading-[1.7] tracking-[0.14em] text-[color:var(--hud-ink)]">
                      {selected.task.state === 'COMPLETED' ? (
                        <CheckCircle2 size={11} className="mt-[1px] flex-none text-[color:var(--hud-mint)]" />
                      ) : (
                        <CircleDot size={11} className="mt-[1px] flex-none" />
                      )}
                      {selected.task.outcome}
                    </p>
                    {selected.task.criteriaResults.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {selected.task.criteriaResults.map((result, index) => (
                          <li
                            key={`${index}-${result.criterion.type}`}
                            className={`font-mono text-[7px] uppercase tracking-[0.12em] ${
                              result.ok ? 'text-[color:var(--hud-mint)]' : 'text-[#ff9d7a]'
                            }`}
                          >
                            {result.ok ? '✓' : '✕'} {result.detail}
                          </li>
                        ))}
                      </ul>
                    )}
                    {selected.task.evidence?.screenshotId && (
                      <a
                        href={`/api/browser/tasks/${selected.task.id}/screenshot/${selected.task.evidence.screenshotId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 font-mono text-[7px] uppercase tracking-[0.16em] text-[color:var(--hud-lime)] underline decoration-dotted"
                      >
                        <Eye size={9} /> open the evidence screenshot
                      </a>
                    )}
                  </div>
                )}

                {/* timeline */}
                <div className="flex min-h-0 flex-1 flex-col">
                  <p className="flex items-center gap-1.5 border-b border-[color:var(--hud-line)] px-3 py-1 font-mono text-[7px] uppercase tracking-[0.22em] text-[color:var(--hud-ink-dim)]">
                    <Route size={9} /> recovery history · {selected.task.events.length} event(s)
                  </p>
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                    {timeline.length === 0 && (
                      <p className="font-mono text-[8px] uppercase tracking-[0.18em] text-[color:var(--hud-ink-dim)]">
                        nothing yet
                      </p>
                    )}
                    <ul className="space-y-1">
                      {timeline.map((event, index) => (
                        <li key={`${event.at}-${index}`} className="flex gap-2 font-mono text-[7.5px] leading-[1.5]">
                          <span className="w-[54px] flex-none text-right tabular-nums text-[color:var(--hud-ink-dim)]/70">
                            {new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                          <span className={`w-[62px] flex-none uppercase tracking-[0.12em] ${EVENT_ACCENT[event.kind]}`}>
                            {event.kind}
                          </span>
                          <span className="min-w-0 flex-1 text-[color:var(--hud-ink)]/85">
                            {event.message}
                            {event.detail && (
                              <span className="block text-[7px] normal-case tracking-[0.02em] text-[color:var(--hud-ink-dim)]/80">
                                {event.detail}
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[color:var(--hud-line)] px-3 py-1.5 font-mono text-[6.5px] uppercase tracking-[0.16em] text-[color:var(--hud-ink-dim)]">
                    <span className="flex items-center gap-1">
                      <SkipForward size={8} /> pause / resume / stop are honoured by the runner
                    </span>
                    <span>esc to close</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[6.5px] tracking-[0.18em] text-[color:var(--hud-ink-dim)]/80">{label}</p>
      <p className={`truncate normal-case tracking-[0.03em] ${warn ? 'text-[#ffd27a]' : 'text-[color:var(--hud-ink)]'}`}>{value}</p>
    </div>
  );
}

function Control({
  label,
  icon: Icon,
  onClick,
  disabled = false,
}: {
  label: string;
  icon: typeof Pause;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1 rounded border border-[color:var(--hud-line)] px-2 py-1 font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)] disabled:opacity-35"
    >
      <Icon size={9} /> {label}
    </button>
  );
}
