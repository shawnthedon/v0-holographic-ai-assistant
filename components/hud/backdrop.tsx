'use client';

import { useEffect, useRef } from 'react';
import { animate, type JSAnimation } from 'animejs';
import { EASE, useReducedMotion } from '@/lib/hud/motion';

/**
 * The room the hologram lives in: perspective floor grid, drifting data dust,
 * vignette and a slow chromatic bloom. Everything is GPU composited.
 */
export function HudBackdrop() {
  const gridRef = useRef<HTMLDivElement>(null);
  const bloomRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const animations: JSAnimation[] = [];

    if (gridRef.current) {
      animations.push(
        animate(gridRef.current, {
          backgroundPositionY: ['0px', '64px'],
          duration: 5200,
          loop: true,
          ease: EASE.linear,
        }),
      );
    }

    if (bloomRef.current) {
      animations.push(
        animate(bloomRef.current, {
          opacity: [0.35, 0.7],
          scale: [1, 1.06],
          duration: 7200,
          loop: true,
          alternate: true,
          ease: EASE.smooth,
        }),
      );
    }

    return () => animations.forEach((animation) => animation.pause());
  }, [reduced]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* base gradient */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 18%, #06222b 0%, #041116 38%, #01070a 72%, #000 100%)',
        }}
      />

      {/* bloom */}
      <div
        ref={bloomRef}
        className="absolute left-1/2 top-[16%] h-[62vh] w-[62vh] -translate-x-1/2 rounded-full blur-[90px]"
        style={{
          background:
            'radial-gradient(circle, rgba(40,200,230,0.28) 0%, rgba(20,120,150,0.12) 45%, transparent 70%)',
        }}
      />

      {/* perspective floor */}
      <div
        className="absolute inset-x-0 bottom-0 h-[46%] opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(110,235,255,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(110,235,255,0.16) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          transform: 'perspective(520px) rotateX(64deg)',
          transformOrigin: 'bottom',
          maskImage: 'linear-gradient(to top, #000 4%, transparent 78%)',
          WebkitMaskImage: 'linear-gradient(to top, #000 4%, transparent 78%)',
        }}
      />

      {/* ambient grid (scrolls) */}
      <div
        ref={gridRef}
        className="holo-grid absolute inset-0 opacity-[0.22]"
        style={{ backgroundSize: '64px 64px' }}
      />

      {/* scanlines + noise + vignette */}
      <div className="holo-scanlines absolute inset-0 opacity-[0.35]" />
      <div
        className="absolute inset-0 opacity-[0.05] mix-blend-screen"
        style={{
          backgroundImage: "url('/hud/noise.png')",
          backgroundSize: '180px 180px',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 80% at 50% 45%, transparent 30%, rgba(0,0,0,0.55) 78%, rgba(0,0,0,0.9) 100%)',
        }}
      />
    </div>
  );
}
