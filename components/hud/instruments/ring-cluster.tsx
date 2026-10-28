'use client';

import { useEffect, useRef } from 'react';
import { animate, stagger, type JSAnimation } from 'animejs';
import { EASE, useReducedMotion } from '@/lib/hud/motion';

interface RingClusterProps {
  size?: number;
  className?: string;
  active?: boolean;
  ticks?: number;
  label?: string;
}

/**
 * Radar / gyro cluster. Each orbit is a separate anime.js loop so the
 * assembly counter-rotates against itself and speeds up while listening.
 */
export function RingCluster({
  size = 132,
  className = '',
  active = false,
  ticks = 48,
  label,
}: RingClusterProps) {
  const scope = useRef<HTMLDivElement>(null);
  const sweepRef = useRef<HTMLDivElement>(null);
  const loopsRef = useRef<{ animation: JSAnimation; base: number }[]>([]);
  const reduced = useReducedMotion();

  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    const rings = root.querySelectorAll<HTMLElement>('.ring-orbit');
    if (reduced) {
      rings.forEach((ring) => {
        ring.style.transform = 'rotate(0deg)';
      });
      return;
    }
    const loops: { animation: JSAnimation; base: number }[] = [];

    Array.from(rings).forEach((ring, index) => {
      const base = Number(ring.dataset.duration ?? 12000);
      loops.push({
        base,
        animation: animate(ring, {
          rotate: index % 2 === 0 ? [0, 360] : [360, 0],
          duration: base,
          loop: true,
          ease: EASE.linear,
        }),
      });
    });

    if (sweepRef.current) {
      loops.push({
        base: 5200,
        animation: animate(sweepRef.current, {
          rotate: [0, 360],
          duration: 5200,
          loop: true,
          ease: EASE.linear,
        }),
      });
    }

    loopsRef.current = loops;

    return () => {
      loops.forEach(({ animation }) => animation.pause());
      loopsRef.current = [];
    };
  }, [reduced]);

  // State response: stretch the live loops instead of restarting them, so the
  // motion never snaps or loses its phase while listening.
  useEffect(() => {
    const factor = active ? 0.42 : 1;
    loopsRef.current.forEach(({ animation, base }) => {
      animation.stretch(base * factor);
    });
  }, [active]);

  useEffect(() => {
    const root = scope.current;
    if (!root || reduced) return;
    const blips = root.querySelectorAll<HTMLElement>('.ring-blip');
    const animation = animate(blips, {
      opacity: [0.15, 1],
      scale: [0.85, 1.15],
      delay: stagger(420, { from: 'random' }),
      duration: 900,
      loop: true,
      alternate: true,
      ease: EASE.smooth,
    });
    return () => {
      animation.pause();
    };
  }, [reduced]);

  return (
    <div
      ref={scope}
      className={`relative aspect-square ${className}`}
      style={{ width: size }}
      aria-hidden
    >
      {/* soft halo */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(70,235,255,0.18) 0%, rgba(10,40,55,0.05) 55%, transparent 72%)',
        }}
      />

      {/* sweep */}
      <div
        ref={sweepRef}
        className="absolute inset-[14%] rounded-full"
        style={{
          background:
            'conic-gradient(from 0deg, rgba(160,255,70,0.5) 0deg, rgba(160,255,70,0.08) 42deg, transparent 88deg, transparent 360deg)',
          maskImage: 'radial-gradient(circle, transparent 42%, #000 46%)',
          WebkitMaskImage: 'radial-gradient(circle, transparent 42%, #000 46%)',
        }}
      />

      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
        <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(120,240,255,0.28)" strokeWidth="0.35" />
        <circle cx="50" cy="50" r="33" fill="none" stroke="rgba(120,240,255,0.22)" strokeWidth="0.35" strokeDasharray="1 3" />
        <circle cx="50" cy="50" r="20" fill="none" stroke="rgba(120,240,255,0.35)" strokeWidth="0.4" strokeDasharray="10 6" />
        <circle cx="50" cy="50" r="3.4" fill="none" stroke="rgba(120,240,255,0.6)" strokeWidth="0.5" />
        <line x1="4" y1="50" x2="96" y2="50" stroke="rgba(120,240,255,0.14)" strokeWidth="0.3" />
        <line x1="50" y1="4" x2="50" y2="96" stroke="rgba(120,240,255,0.14)" strokeWidth="0.3" />

        <g className="ring-orbit origin-center" data-duration="18000">
          <circle cx="50" cy="50" r="41" fill="none" stroke="rgba(120,240,255,0.5)" strokeWidth="1.1" strokeDasharray="18 130" strokeLinecap="round" />
        </g>
        <g className="ring-orbit origin-center" data-duration="11000">
          <circle cx="50" cy="50" r="37.5" fill="none" stroke="rgba(180,255,70,0.55)" strokeWidth="1.4" strokeDasharray="3 44" strokeLinecap="round" />
        </g>
        <g className="ring-orbit origin-center" data-duration="26000">
          <circle cx="50" cy="50" r="27" fill="none" stroke="rgba(120,240,255,0.4)" strokeWidth="0.6" strokeDasharray="0.8 2.6" />
        </g>

        {Array.from({ length: ticks }).map((_, index) => {
          const angle = (index / ticks) * Math.PI * 2;
          const inner = index % 4 === 0 ? 43 : 44.4;
          // rounded so SSR + client stringify identical attribute values
          const x1 = Number((50 + Math.cos(angle) * inner).toFixed(2));
          const y1 = Number((50 + Math.sin(angle) * inner).toFixed(2));
          const x2 = Number((50 + Math.cos(angle) * 46).toFixed(2));
          const y2 = Number((50 + Math.sin(angle) * 46).toFixed(2));
          return (
            <line
              key={index}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="rgba(120,240,255,0.45)"
              strokeWidth={index % 4 === 0 ? 0.7 : 0.35}
            />
          );
        })}

        {[
          [68, 34],
          [31, 62],
          [58, 72],
        ].map(([cx, cy], index) => (
          <circle
            key={index}
            className="ring-blip"
            cx={cx}
            cy={cy}
            r="1.5"
            fill="var(--hud-lime)"
          />
        ))}
      </svg>

      {label && (
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 font-mono text-[6px] uppercase tracking-[0.3em] text-[color:var(--hud-ink-dim)]">
          {label}
        </span>
      )}
    </div>
  );
}

/** Small segmented vertical level meter (the 78% column). */
export function SegmentedMeter({
  value = 78,
  segments = 22,
  className = '',
  active = false,
}: {
  value?: number;
  segments?: number;
  className?: string;
  active?: boolean;
}) {
  const scope = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const root = scope.current;
    if (!root || reduced) return;
    const segs = root.querySelectorAll<HTMLElement>('.hud-seg');
    const animation = animate(segs, {
      opacity: [0.18, 1],
      delay: stagger(38, { from: 'last' }),
      duration: 620,
      loop: true,
      loopDelay: 2600,
      alternate: true,
      ease: EASE.smooth,
    });
    return () => {
      animation.pause();
    };
  }, [reduced, segments, value]);

  const lit = Math.round((value / 100) * segments);

  return (
    <div ref={scope} className={`flex flex-col-reverse items-center gap-[3px] ${className}`} aria-hidden>
      {Array.from({ length: segments }).map((_, index) => {
        const on = index < lit;
        const hot = index >= lit - 3 && on;
        return (
          <span
            key={index}
            className="hud-seg block w-full rounded-[1px]"
            style={{
              height: 4,
              background: on
                ? hot
                  ? 'var(--hud-lime)'
                  : active
                    ? 'var(--hud-mint)'
                    : 'var(--hud-ink)'
                : 'rgba(120,240,255,0.16)',
              boxShadow: on ? '0 0 8px rgba(120,255,220,0.65)' : 'none',
              opacity: on ? 1 : 0.6,
            }}
          />
        );
      })}
    </div>
  );
}
