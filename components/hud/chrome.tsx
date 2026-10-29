'use client';

import { useEffect, useRef, useState } from 'react';
import { animate, stagger } from 'animejs';
import { EASE, useReducedMotion } from '@/lib/hud/motion';
import { telemetry } from '@/lib/hud/telemetry';
import { useUptime } from '@/hooks/use-hud-telemetry';

/* ------------------------------------------------------------------ */
/*  Frame furniture                                                    */
/* ------------------------------------------------------------------ */

export function CornerBrackets({ className = '' }: { className?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 ${className}`} aria-hidden>
      {[
        'left-0 top-0 border-l border-t',
        'right-0 top-0 border-r border-t',
        'left-0 bottom-0 border-b border-l',
        'right-0 bottom-0 border-b border-r',
      ].map((position) => (
        <span
          key={position}
          className={`hud-bracket absolute h-4 w-4 ${position}`}
          style={{ borderColor: 'rgba(125,242,255,0.45)' }}
        />
      ))}
    </div>
  );
}

export function HudPanel({
  title,
  meta,
  children,
  className = '',
  bodyClassName = '',
}: {
  title?: string;
  meta?: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`hud-panel group relative flex flex-col px-3 py-2.5 ${className}`}
    >
      <CornerBrackets />
      {(title || meta) && (
        <header className="mb-2 flex items-center justify-between gap-2 font-mono text-[7px] uppercase tracking-[0.28em]">
          <span className="text-[color:var(--hud-ink-dim)]">{title}</span>
          <span className="text-[color:var(--hud-ink)]">{meta}</span>
        </header>
      )}
      <div className={`relative min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** Vertical tick column used along the left/right edges of the viewport. */
export function TickColumn({
  count = 21,
  labels = true,
  className = '',
  align = 'left',
}: {
  count?: number;
  labels?: boolean;
  className?: string;
  align?: 'left' | 'right';
}) {
  return (
    <div
      className={`flex flex-col justify-between font-mono text-[6px] leading-none text-[color:var(--hud-ink-dim)] ${className}`}
      aria-hidden
    >
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className={`flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}
        >
          <span
            className="block h-px"
            style={{
              width: index % 5 === 0 ? 12 : index % 2 === 0 ? 7 : 4,
              background: 'rgba(125,242,255,0.4)',
            }}
          />
          {labels && index % 5 === 0 && (
            <span className="tabular-nums">{String(count - index).padStart(2, '0')}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Scan header                                                        */
/* ------------------------------------------------------------------ */

export const SCAN_MODES = ['NEURAL', 'VOCAL', 'OCULAR', 'SYNAPTIC'] as const;

/**
 * The three values that change every second — the clock, the uptime and the
 * render-progress bar — are owned by this component, not by the page.
 *
 * They used to live in `Home`. Every tick re-rendered the whole console tree
 * (≈1,000 nodes, eight canvases, the WebGL host) once a second, which is
 * exactly the kind of churn that reads as "the UI is sluggish". Now the page
 * only re-renders when something structural changes.
 */
export function LiveClock() {
  const [clock, setClock] = useState(() => '--:--:--');
  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="tabular-nums text-[color:var(--hud-ink)]/80">{clock}</span>;
}

/** Scans progress = real frame health, sampled from telemetry (never invented). */
function useScanProgress(initial = 42) {
  const [progress, setProgress] = useState(initial);
  useEffect(() => {
    const id = window.setInterval(() => {
      const fps = telemetry.get('fps');
      if (fps > 0) setProgress(Math.round(Math.min(100, Math.max(8, (fps / 60) * 100))));
    }, 1200);
    return () => window.clearInterval(id);
  }, []);
  return progress;
}

export function ScanHeader({
  mode,
  onCycle,
  progress: progressProp,
  status,
  subjectId,
  clock: clockProp,
  uptime: uptimeProp,
}: {
  mode: number;
  onCycle: (direction: 1 | -1) => void;
  progress?: number;
  status: string;
  subjectId: string;
  clock?: string;
  uptime?: string;
}) {
  const sampledProgress = useScanProgress();
  const liveUptime = useUptime();
  const progress = progressProp ?? sampledProgress;
  // Hooks must run unconditionally; the prop simply wins when supplied.
  const uptime = uptimeProp ?? liveUptime;
  const labelRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!labelRef.current || reduced) return;
    animate(labelRef.current, {
      opacity: [0, 1],
      translateY: [8, 0],
      filter: ['blur(6px)', 'blur(0px)'],
      duration: 420,
      ease: EASE.out,
    });
  }, [mode, reduced]);

  useEffect(() => {
    if (!barRef.current || reduced) return;
    const segments = barRef.current.querySelectorAll<HTMLElement>('.scan-seg[data-lit="true"]');
    if (!segments.length) return;
    animate(segments, {
      opacity: [0.25, 1],
      scaleY: [0.4, 1],
      duration: 360,
      delay: stagger(9),
      ease: EASE.out,
    });
  }, [progress, reduced]);

  const segments = 44;
  const lit = Math.round((progress / 100) * segments);

  return (
    <header className="relative z-20 flex-none px-3 pt-2 sm:px-5">
      {/* top rule */}
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--hud-line)] pb-1.5 font-mono text-[7px] uppercase tracking-[0.3em] text-[color:var(--hud-ink-dim)]">
        <div className="flex items-center gap-2">
          <span className="flex items-end gap-[2px]">
            <span className="block h-2 w-1.5 bg-[color:var(--hud-ink)]/70" />
            <span className="block h-1.5 w-1.5 bg-[color:var(--hud-ink)]/40" />
            <span className="block h-1 w-1.5 bg-[color:var(--hud-ink)]/25" />
          </span>
          <span className="hidden sm:inline">nexus core</span>
          <span className="text-[color:var(--hud-ink)]/80">// {subjectId}</span>
        </div>

        <div className="flex items-center gap-3 text-[color:var(--hud-ink)]">
          <button
            type="button"
            onClick={() => onCycle(-1)}
            className="hud-hit px-1 text-[10px] leading-none text-[color:var(--hud-ink-dim)] transition-colors duration-150 hover:text-[color:var(--hud-ink)]"
            aria-label="Previous scan mode"
          >
            ‹
          </button>
          <span className="flex min-w-[92px] items-center justify-center gap-2">
            <span className="hidden text-[color:var(--hud-ink-dim)] sm:inline">scan level</span>
            <span ref={labelRef} className="tracking-[0.34em] text-[color:var(--hud-ink)]">
              {SCAN_MODES[mode]}
            </span>
          </span>
          <button
            type="button"
            onClick={() => onCycle(1)}
            className="hud-hit px-1 text-[10px] leading-none text-[color:var(--hud-ink-dim)] transition-colors duration-150 hover:text-[color:var(--hud-ink)]"
            aria-label="Next scan mode"
          >
            ›
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="hud-dot" data-state={status === 'LIVE' ? 'live' : 'idle'} />
          <span className="hidden sm:inline">{status}</span>
          {uptime && (
            <span className="hidden items-center gap-1 text-[color:var(--hud-ink-dim)] sm:flex">
              up <span className="tabular-nums text-[color:var(--hud-ink)]/80">{uptime}</span>
            </span>
          )}
          {clockProp ? (
            <span className="tabular-nums text-[color:var(--hud-ink)]/80">{clockProp}</span>
          ) : (
            <LiveClock />
          )}
        </div>
      </div>

      {/* progress row */}
      <div className="mt-1.5 flex items-center gap-2 sm:gap-3">
        <span className="w-12 flex-none font-mono text-[6.5px] uppercase leading-tight tracking-[0.24em] text-[color:var(--hud-ink-dim)]">
          progress
        </span>
        <div ref={barRef} className="flex h-2 flex-1 items-center gap-[2px]">
          {Array.from({ length: segments }).map((_, index) => (
            <span
              key={index}
              data-lit={index < lit ? 'true' : 'false'}
              className="scan-seg block h-full flex-1"
              style={{
                background:
                  index < lit
                    ? index > segments * 0.86
                      ? 'var(--hud-lime)'
                      : 'var(--hud-ink)'
                    : 'rgba(125,242,255,0.12)',
                boxShadow: index < lit ? '0 0 6px rgba(125,242,255,0.55)' : 'none',
                opacity: index < lit ? 1 : 0.5,
              }}
            />
          ))}
        </div>
        <span className="w-14 flex-none text-right font-mono text-[8px] tabular-nums tracking-[0.18em] text-[color:var(--hud-ink)]">
          {Math.round(progress)}%
        </span>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/*  Readouts                                                           */
/* ------------------------------------------------------------------ */

/** Numeric readout that counts between values with anime.js. */
export function Metric({
  label,
  value,
  unit = '',
  decimals = 0,
  className = '',
  tone = 'ink',
}: {
  label: string;
  value: number;
  unit?: string;
  decimals?: number;
  className?: string;
  tone?: 'ink' | 'lime' | 'mint';
}) {
  const valueRef = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    const node = valueRef.current;
    if (!node) return;
    const target = value;
    const format = (v: number) =>
      decimals > 0
        ? v.toFixed(decimals)
        : String(Math.round(v)).padStart(2, '0');

    if (reduced) {
      shown.current = target;
      node.textContent = format(target);
      return;
    }

    animate(
      { v: shown.current },
      {
        v: target,
        duration: 900,
        ease: EASE.glide,
        onUpdate: (self) => {
          const progress = (self as unknown as { progress: number }).progress ?? 0;
          const next = shown.current + (target - shown.current) * progress;
          node.textContent = format(next);
        },
        onComplete: () => {
          shown.current = target;
          node.textContent = format(target);
        },
      },
    );
  }, [decimals, reduced, value]);

  const toneClass =
    tone === 'lime'
      ? 'text-[color:var(--hud-lime)]'
      : tone === 'mint'
        ? 'text-[color:var(--hud-mint)]'
        : 'text-[color:var(--hud-ink)]';

  return (
    <div className={`flex items-baseline justify-between gap-2 ${className}`}>
      <span className="font-mono text-[6.5px] uppercase tracking-[0.24em] text-[color:var(--hud-ink-dim)]">
        {label}
      </span>
      <span className={`font-mono text-[10px] tabular-nums tracking-[0.08em] ${toneClass}`}>
        <span ref={valueRef}>{decimals > 0 ? value.toFixed(decimals) : String(Math.round(value)).padStart(2, '0')}</span>
        {unit && <span className="ml-[2px] text-[6.5px] opacity-60">{unit}</span>}
      </span>
    </div>
  );
}
