'use client';

import { useEffect, useRef, useState } from 'react';
import { animate, createTimeline, stagger } from 'animejs';
import { EASE, useReducedMotion } from '@/lib/hud/motion';

const BOOT_LINES = [
  'mounting neural lattice',
  'calibrating emitter array',
  'loading voiceprint model',
  'establishing duplex channel',
  'reticle lock acquired',
];

/**
 * Cold-boot overlay. One anime.js timeline drives the entire cold start:
 * frame draw, wordmark reveal, telemetry count and the iris-out exit.
 */
export function BootSequence() {
  const scope = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(true);
  const reduced = useReducedMotion();

  useEffect(() => {
    const root = scope.current;
    if (!root) return;

    if (reduced) {
      setVisible(false);
      return;
    }

    const words = Array.from(root.querySelectorAll<HTMLElement>('.boot-char'));
    const lines = Array.from(root.querySelectorAll<HTMLElement>('.boot-line'));
    const bar = root.querySelector<HTMLElement>('.boot-bar');
    const label = root.querySelector<HTMLElement>('.boot-label');
    if (!words.length || !lines.length || !bar || !label) {
      setVisible(false);
      return;
    }

    const timeline = createTimeline({ defaults: { ease: EASE.out } });

    timeline
      .add(words, {
        opacity: [0, 1],
        translateY: [18, 0],
        filter: ['blur(8px)', 'blur(0px)'],
        duration: 900,
        delay: stagger(45),
      })
      .add(
        lines,
        {
          opacity: [0, 1],
          translateX: [-10, 0],
          duration: 420,
          delay: stagger(95),
        },
        '-=620',
      )
      .add(
        bar,
        {
          scaleX: [0, 1],
          duration: 1250,
          ease: EASE.smooth,
        },
        '-=420',
      )
      .add(
        { progress: 0 },
        {
          progress: 100,
          duration: 1250,
          ease: EASE.smooth,
          onUpdate: (self) => {
            const progress = (self as unknown as { progress: number }).progress ?? 0;
            if (counterRef.current) {
              counterRef.current.textContent = String(Math.round(progress * 100)).padStart(3, '0');
            }
          },
        },
        '<',
      )
      .add(label, { opacity: [0, 1], duration: 300 }, '-=300')
      .add(
        root,
        {
          opacity: [1, 0],
          scale: [1, 1.06],
          filter: ['blur(0px)', 'blur(10px)'],
          duration: 720,
          delay: 220,
          ease: 'inOutQuad',
        },
        '+=260',
      )
      .call(() => setVisible(false));

    // Safety: never trap the interface behind the loader.
    const fallback = window.setTimeout(() => setVisible(false), 6500);

    return () => {
      window.clearTimeout(fallback);
      timeline.pause();
    };
  }, [reduced]);

  if (!visible) return null;

  return (
    <div
      ref={scope}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[#010507] px-6"
      aria-hidden
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(circle at 50% 45%, rgba(30,150,180,0.18) 0%, transparent 60%)',
        }}
      />
      <div className="holo-grid pointer-events-none absolute inset-0 opacity-40" />

      <div className="relative flex flex-col items-center">
        <div className="mb-6 flex items-center gap-[3px] font-mono text-[34px] font-light tracking-[0.34em] text-[color:var(--hud-ink)] sm:text-[52px]">
          {'NEXUS'.split('').map((char, index) => (
            <span
              key={`${char}-${index}`}
              className="boot-char inline-block"
              style={{ textShadow: '0 0 26px rgba(120,240,255,0.7)', opacity: 0 }}
            >
              {char}
            </span>
          ))}
        </div>

        <div className="mb-6 flex w-[min(78vw,420px)] items-center gap-3">
          <div className="h-[3px] flex-1 bg-[color:var(--hud-ink)]/12">
            <div
              className="boot-bar h-full origin-left bg-[color:var(--hud-ink)]"
              style={{ transform: 'scaleX(0)', boxShadow: '0 0 12px rgba(120,240,255,0.8)' }}
            />
          </div>
          <span className="font-mono text-[9px] tabular-nums tracking-[0.2em] text-[color:var(--hud-ink)]">
            <span ref={counterRef}>000</span>%
          </span>
        </div>

        <div className="flex w-[min(78vw,420px)] flex-col gap-1 font-mono text-[7.5px] uppercase tracking-[0.26em] text-[color:var(--hud-ink-dim)]">
          {BOOT_LINES.map((line) => (
            <div key={line} className="boot-line flex items-center justify-between gap-4" style={{ opacity: 0 }}>
              <span>{line}</span>
              <span className="text-[color:var(--hud-lime)]">ok</span>
            </div>
          ))}
        </div>

        <span className="boot-label mt-7 font-mono text-[7px] uppercase tracking-[0.5em] text-[color:var(--hud-ink-dim)]" style={{ opacity: 0 }}>
          holographic intelligence console
        </span>
      </div>
    </div>
  );
}

/** Fade-in wrapper used by every panel so the shell arrives as one gesture. */
export function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!ref.current) return;
    if (reduced) {
      animate(ref.current, { opacity: [0, 1], duration: 300, delay });
      return;
    }
    animate(ref.current, {
      opacity: [0, 1],
      translateY: [14, 0],
      filter: ['blur(6px)', 'blur(0px)'],
      duration: 780,
      delay: 900 + delay,
      ease: EASE.out,
    });
  }, [delay, reduced]);

  return (
    <div ref={ref} className={className} style={{ opacity: 0 }}>
      {children}
    </div>
  );
}
