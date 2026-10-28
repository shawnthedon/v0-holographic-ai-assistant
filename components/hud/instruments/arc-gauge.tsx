'use client';

import { useEffect, useRef } from 'react';
import { animate, utils } from 'animejs';
import { EASE, useReducedMotion } from '@/lib/hud/motion';

interface ArcGaugeProps {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  sublabel?: string;
  color?: string;
  track?: string;
  className?: string;
  showValue?: boolean;
}

/** Radial gauge: arc sweep + numeric counter, both orchestrated by anime.js. */
export function ArcGauge({
  value,
  size = 96,
  stroke = 5,
  label,
  sublabel,
  color = 'var(--hud-ink)',
  track = 'rgba(110, 240, 255, 0.12)',
  className = '',
  showValue = true,
}: ArcGaugeProps) {
  const radius = (size - stroke * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const arcRef = useRef<SVGCircleElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const arc = arcRef.current;
    if (!arc) return;

    const target = circumference * (1 - Math.min(100, Math.max(0, value)) / 100);

    if (reduced) {
      utils.set(arc, { strokeDashoffset: target });
      if (valueRef.current) valueRef.current.textContent = `${Math.round(value)}`;
      return;
    }

    animate(arc, {
      strokeDashoffset: [circumference, target],
      duration: 1600,
      ease: EASE.glide,
    });

    if (valueRef.current) {
      animate(
        { v: 0 },
        {
          v: value,
          duration: 1500,
          ease: EASE.glide,
          onUpdate: (self) => {
            const progress = (self as unknown as { progress: number }).progress ?? 0;
            if (valueRef.current) {
              valueRef.current.textContent = `${Math.round(value * progress)}`;
            }
          },
          onComplete: () => {
            if (valueRef.current) valueRef.current.textContent = `${Math.round(value)}`;
          },
        },
      );
    }
  }, [circumference, reduced, value]);

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={track}
          strokeWidth={stroke}
          strokeDasharray="2 5"
        />
        <circle
          ref={arcRef}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference}
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {showValue && (
          <span className="font-mono text-[13px] leading-none tracking-tight text-[color:var(--hud-ink)]">
            <span ref={valueRef}>{Math.round(value)}</span>
            <span className="text-[8px] opacity-70">%</span>
          </span>
        )}
        {label && (
          <span className="mt-1 font-mono text-[6.5px] uppercase tracking-[0.22em] text-[color:var(--hud-ink-dim)]">
            {label}
          </span>
        )}
      </div>
      {sublabel && (
        <span className="absolute -bottom-3 font-mono text-[6.5px] uppercase tracking-[0.25em] text-[color:var(--hud-ink-dim)]">
          {sublabel}
        </span>
      )}
    </div>
  );
}
