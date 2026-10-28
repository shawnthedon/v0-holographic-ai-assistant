'use client';

import { useEffect, useRef, useState } from 'react';
import { animate, utils } from 'animejs';
import { EASE, hexWord, useReducedMotion } from '@/lib/hud/motion';

interface LogRow {
  id: number;
  hex: string;
  tag: string;
  ok: boolean;
}

const TAGS = ['SYNC', 'MESH', 'VOX', 'LIDAR', 'CORTEX', 'TONE', 'EDGE', 'PULSE'];

/**
 * Streaming neural log. New rows are injected on an interval and enter with
 * an anime.js tween; older rows fade back so the head of the log always reads
 * as "live".
 */
export function NeuralLog({
  rows = 11,
  interval = 1250,
  active = false,
  className = '',
}: {
  rows?: number;
  interval?: number;
  active?: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const counter = useRef(0);
  const reduced = useReducedMotion();
  const [entries, setEntries] = useState<LogRow[]>([]);

  useEffect(() => {
    const push = () => {
      counter.current += 1;
      const entry: LogRow = {
        id: counter.current,
        hex: `${hexWord(4, counter.current * 13)} ${hexWord(4, counter.current * 29)}`,
        tag: TAGS[counter.current % TAGS.length],
        ok: counter.current % 7 !== 0,
      };
      setEntries((prev) => [...prev.slice(-(rows - 1)), entry]);
    };

    for (let i = 0; i < rows; i += 1) push();
    const timer = window.setInterval(push, active ? Math.round(interval * 0.55) : interval);
    return () => window.clearInterval(timer);
  }, [active, interval, rows]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const all = root.querySelectorAll<HTMLElement>('.log-row');
    const head = all[all.length - 1];
    all.forEach((row, index) => {
      const distance = all.length - 1 - index;
      row.style.opacity = `${Math.max(0.16, 1 - distance * 0.085)}`;
    });
    if (!head) return;

    if (reduced) {
      utils.set(head, { opacity: 1 });
      return;
    }

    animate(head, {
      opacity: [0, 1],
      translateX: [-12, 0],
      scale: [0.98, 1],
      duration: 420,
      ease: EASE.out,
    });
  }, [entries, reduced]);

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`} aria-hidden>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-[#02080a] to-transparent" />
      <div className="space-y-[3px]">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="log-row flex items-center gap-2 font-mono text-[7.5px] leading-[1.5] uppercase tracking-[0.14em] text-[color:var(--hud-ink)]"
          >
            <span className="text-[color:var(--hud-ink-dim)]">
              {String(entry.id).padStart(3, '0')}
            </span>
            <span className="tabular-nums opacity-80">{entry.hex}</span>
            <span className="ml-auto text-[color:var(--hud-ink-dim)]">{entry.tag}</span>
            <span className={entry.ok ? 'text-[color:var(--hud-lime)]' : 'text-[#ff7a7a]'}>
              {entry.ok ? 'OK' : 'ERR'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
