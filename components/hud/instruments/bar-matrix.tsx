'use client';

import { useEffect, useRef } from 'react';
import { animate, stagger, utils } from 'animejs';
import { EASE, useReducedMotion } from '@/lib/hud/motion';

interface BarMatrixProps {
  bars?: number;
  className?: string;
  color?: string;
  active?: boolean;
  /** when true the bars react to the assistant state instead of idling */
  intensity?: number;
}

/** Spectrum bars — GPU transforms only (scaleY), staggered from the centre. */
export function BarMatrix({
  bars = 17,
  className = '',
  color = 'var(--hud-ink)',
  active = false,
  intensity = 0.6,
}: BarMatrixProps) {
  const scope = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    const items = root.querySelectorAll<HTMLElement>('.hud-bar');
    if (!items.length) return;

    if (reduced) {
      utils.set(items, { scaleY: 0.55 });
      return;
    }

    const animation = animate(items, {
      scaleY: [
        { to: () => 0.18 + Math.random() * 0.3, duration: 260 },
        { to: () => 0.35 + Math.random() * (0.35 + intensity * 0.45), duration: 520 },
      ],
      delay: stagger(46, { from: 'center' }),
      loop: true,
      alternate: true,
      ease: EASE.smooth,
    });

    return () => {
      animation.pause();
    };
  }, [bars, intensity, reduced]);

  return (
    <div
      ref={scope}
      className={`flex h-full w-full items-end justify-between gap-[3px] ${className}`}
      aria-hidden
    >
      {Array.from({ length: bars }).map((_, index) => (
        <span
          key={index}
          className="hud-bar block h-full flex-1 origin-bottom rounded-[1px]"
          style={{
            background: `linear-gradient(to top, ${color} 0%, ${color} 55%, transparent 100%)`,
            opacity: active ? 0.95 : 0.6,
            boxShadow: active ? `0 0 10px ${color}` : 'none',
            animationDelay: `${index * 40}ms`,
          }}
        />
      ))}
    </div>
  );
}
