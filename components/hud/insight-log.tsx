'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { animate } from 'animejs';
import { telemetry, type HudEvent } from '@/lib/hud/telemetry';
import { EASE, useReducedMotion } from '@/lib/hud/motion';

const subscribe = (listener: () => void) => {
  const unsubscribe = telemetry.subscribe(listener);
  return () => unsubscribe();
};

const getEvents = () => telemetry.events.length;

/**
 * Rolling log of real application events (health probes, channel state,
 * long tasks, operator actions) pulled from the telemetry store.
 */
export function InsightLog({ className = '' }: { className?: string }) {
  const count = useSyncExternalStore(subscribe, getEvents, () => 0);
  const [, forceRender] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  // events live in the store as a mutable array; count drives re-render
  useEffect(() => {
    forceRender((value) => value + 1);
  }, [count]);

  const events: HudEvent[] = telemetry.events;

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const rows = root.querySelectorAll<HTMLElement>('.insight-row');
    const head = rows[rows.length - 1];
    if (!head) return;
    rows.forEach((row, index) => {
      const distance = rows.length - 1 - index;
      row.style.opacity = `${Math.max(0.14, 1 - distance * 0.2)}`;
    });
    if (reduced) return;
    animate(head, {
      opacity: [0, 1],
      translateX: [-10, 0],
      duration: 420,
      ease: EASE.out,
    });
  }, [count, reduced]);

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`} aria-live="polite">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-[#02080a] to-transparent" />
      <div className="flex flex-col gap-[3px]">
        {events.length === 0 && (
          <p className="font-mono text-[7px] uppercase leading-[1.6] tracking-[0.2em] text-[color:var(--hud-ink-dim)]">
            awaiting telemetry…
          </p>
        )}
        {events.map((event) => (
          <div
            key={event.id}
            className="insight-row flex items-start gap-2 font-mono text-[7px] uppercase leading-[1.55] tracking-[0.12em]"
          >
            <span className="flex-none tabular-nums text-[color:var(--hud-ink-dim)]">
              {new Date(event.at).toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
            <span
              className={
                event.tone === 'warn'
                  ? 'text-[#ff9d7a]'
                  : event.tone === 'good'
                    ? 'text-[color:var(--hud-lime)]'
                    : 'text-[color:var(--hud-ink)]'
              }
            >
              {event.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
