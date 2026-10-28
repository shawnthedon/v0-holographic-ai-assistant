'use client';

import { useEffect, useState } from 'react';

/**
 * Shared motion language for the holographic HUD.
 *
 * Everything animated in this interface flows through these curves so the
 * whole console feels like one machine: fast, physical, interruptible.
 */
export const EASE = {
  /** Primary UI entrance / reveal — exponential, feels instant then settles. */
  out: 'outExpo',
  /** Slightly longer glide for large spatial moves. */
  glide: 'outQuart',
  /** Ambient, breathing loops. */
  smooth: 'inOutSine',
  /** Physical overshoot for toggle + latch interactions. */
  spring: 'outElastic(1, .55)',
  /** Continuous rotations / sweeps. */
  linear: 'linear',
} as const;

export type EaseToken = (typeof EASE)[keyof typeof EASE];

export const DURATION = {
  press: 120,
  micro: 180,
  panel: 240,
  reveal: 620,
  boot: 1100,
} as const;

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Reactive reduced-motion flag — animations never gate content. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Deterministic pseudo random so server + client renders match. */
export function seeded(seed: number) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

export const hexWord = (length = 8, seed = Date.now()) => {
  const alphabet = '0123456789ABCDEF';
  const rand = seeded(seed + 1);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(rand() * alphabet.length)];
  }
  return out;
};

/** Synthesise a smooth signal used by the sparklines / waveforms. */
export function signal(length: number, seed = 7, amplitude = 1) {
  const rand = seeded(seed);
  const points: number[] = [];
  let value = 0.5;
  for (let i = 0; i < length; i += 1) {
    value += (rand() - 0.5) * 0.45;
    value += Math.sin(i / 6 + seed) * 0.08;
    value = clamp(value, 0.08, 0.92);
    points.push(0.5 + (value - 0.5) * amplitude);
  }
  return points;
}
