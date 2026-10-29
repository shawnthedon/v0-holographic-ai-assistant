'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { animate, createTimer, stagger, type JSAnimation } from 'animejs';
import { AvatarRig } from '@/components/hud/avatar-rig';
import type { AvatarMode } from '@/lib/hud/avatar-face';
import { EASE, useReducedMotion } from '@/lib/hud/motion';
import { usePower } from '@/hooks/use-power';

interface HologramStageProps {
  active?: boolean;
  speaking?: boolean;
  mode?: AvatarMode;
  subject?: string;
  subjectId?: string;
  scanIndex?: number;
  onScan?: () => void;
}

/** Round trig output so SSR and client serialise identical SVG attributes. */
const r2 = (value: number) => Number(value.toFixed(2));

const SPARKS = Array.from({ length: 20 }).map((_, index) => {
  const angle = index * 2.399963;
  const radius = 33 + ((index * 17) % 20);
  return {
    left: r2(50 + Math.cos(angle) * radius),
    top: r2(45 + Math.sin(angle) * radius),
    delay: (index % 7) * 180,
    size: index % 5 === 0 ? 3 : 2,
  };
});

export function HologramStage({
  active = false,
  speaking = false,
  mode = 'idle',
  subjectId = '01001',
  scanIndex = 1,
  onScan,
}: HologramStageProps) {
  const scope = useRef<HTMLDivElement>(null);
  const rigRef = useRef<HTMLDivElement>(null);
  const subjectRef = useRef<HTMLDivElement>(null);
  const scanRef = useRef<HTMLDivElement>(null);
  const burstRef = useRef<SVGCircleElement>(null);
  const beamRef = useRef<HTMLDivElement>(null);
  const pedestalRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const power = usePower();
  const orbitLoops = useRef<{ animation: JSAnimation; base: number }[]>([]);
  const [pulse, setPulse] = useState(0);

  const deepScan = useCallback(() => {
    setPulse((value) => value + 1);
    onScan?.();
  }, [onScan]);

  /* ---------------- ambient cinema ---------------- */
  useEffect(() => {
    if (!scope.current || reduced) return;
    const root = scope.current;

    const loops: JSAnimation[] = [];
    const orbits: { animation: JSAnimation; base: number }[] = [];

    Array.from(root.querySelectorAll<HTMLElement>('.holo-orbit')).forEach((orbit, index) => {
      const base = Number(orbit.dataset.duration ?? 24000);
      const animation = animate(orbit, {
        rotate: index % 2 === 0 ? [0, 360] : [360, 0],
        duration: base,
        loop: true,
        ease: EASE.linear,
      });
      loops.push(animation);
      orbits.push({ animation, base });
    });
    orbitLoops.current = orbits;

    if (scanRef.current) {
      loops.push(
        animate(scanRef.current, {
          translateY: ['-125%', '125%'],
          duration: 4200,
          loop: true,
          alternate: true,
          ease: EASE.smooth,
        }),
      );
    }

    if (beamRef.current) {
      loops.push(
        animate(beamRef.current.querySelectorAll<HTMLElement>('.holo-beam-strand'), {
          opacity: [0.14, 0.6],
          scaleY: [0.94, 1.04],
          duration: 2400,
          delay: stagger(240),
          loop: true,
          alternate: true,
          ease: EASE.smooth,
        }),
      );
    }

    if (pedestalRef.current) {
      const arcs = pedestalRef.current.querySelectorAll<HTMLElement>('.holo-pedestal-arc');
      if (arcs.length) {
        loops.push(
          animate(arcs, { rotate: [0, 360], duration: 18000, loop: true, ease: EASE.linear }),
        );
      }
      const core = pedestalRef.current.querySelector<HTMLElement>('.holo-pedestal-core');
      if (core) {
        loops.push(
          animate(core, {
            opacity: [0.45, 1],
            scale: [0.97, 1.06],
            duration: 1900,
            loop: true,
            alternate: true,
            ease: EASE.smooth,
          }),
        );
      }
    }

    const sparks = root.querySelectorAll<HTMLElement>('.holo-spark');
    if (sparks.length) {
      loops.push(
        animate(sparks, {
          opacity: [0, 0.9, 0],
          translateY: [10, -30],
          translateX: () => (Math.random() - 0.5) * 16,
          scale: [0.6, 1.2],
          duration: 3200,
          delay: stagger(160, { from: 'random' }),
          loop: true,
          ease: EASE.smooth,
        }),
      );
    }

    return () => {
      loops.forEach((loop) => loop.pause());
      orbitLoops.current = [];
    };
  }, [reduced]);

  /* ---------------- pointer parallax ---------------- */
  useEffect(() => {
    const root = scope.current;
    const rig = rigRef.current;
    if (!root || !rig || reduced) return;

    const state = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (event: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      state.tx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      state.ty = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    const onLeave = () => {
      state.tx = 0;
      state.ty = 0;
    };

    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerleave', onLeave);

    let elapsed = 0;
    let lastX = Number.NaN;
    let lastY = Number.NaN;
    /** Track the last written CSS-var pair so idle frames cost no style recalc. */
    let lastPx = Number.NaN;
    let lastPy = Number.NaN;

    const timer = createTimer({
      duration: 1000,
      loop: true,
      // 60 fps of DOM writes for a slow drifting parallax is wasted work on the
      // main thread and forces a style recalc of the whole projection subtree.
      frameRate: Math.max(12, Math.min(30, power.fpsCap)),
      onUpdate: () => {
        if (document.hidden) return;
        elapsed += 33;
        state.x += (state.tx - state.x) * 0.1;
        state.y += (state.ty - state.y) * 0.1;
        const driftX = Math.sin(elapsed / 2600) * 0.18;
        const driftY = Math.cos(elapsed / 3100) * 0.14;
        const rotY = (state.x + driftX) * 7;
        const rotX = -(state.y + driftY) * 5.5;

        // Only touch the DOM when the value actually moved.
        if (Math.abs(rotY - lastX) > 0.01 || Math.abs(rotX - lastY) > 0.01) {
          lastX = rotY;
          lastY = rotX;
          rig.style.transform = `perspective(1200px) rotateY(${rotY}deg) rotateX(${rotX}deg) translateZ(0)`;
        }

        const px = -(state.x + driftX) * 10;
        const py = -(state.y + driftY) * 8;
        if (subjectRef.current && (Math.abs(px - lastPx) > 0.5 || Math.abs(py - lastPy) > 0.5)) {
          lastPx = px;
          lastPy = py;
          subjectRef.current.style.setProperty('--px', `${px}px`);
          subjectRef.current.style.setProperty('--py', `${py}px`);
        }
      },
    });

    return () => {
      timer.pause();
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
    };
  }, [power.fpsCap, reduced]);

  /* ---------------- state response ---------------- */
  useEffect(() => {
    if (!scope.current || reduced) return;
    const root = scope.current;

    // Stretch the live loops rather than restarting them — the assembly keeps
    // its phase and simply spins up while the channel is open.
    orbitLoops.current.forEach(({ animation, base }) => {
      animation.stretch(base * (active ? 0.4 : 1));
    });

    if (scanRef.current) {
      animate(scanRef.current, { opacity: active ? [0.55, 1] : 0.85, duration: 600, ease: EASE.out });
    }
    if (subjectRef.current) {
      animate(subjectRef.current, {
        scale: active ? 1.035 : 1.02,
        duration: 700,
        ease: EASE.out,
      });
    }
  }, [active, reduced]);

  useEffect(() => {
    if (!speaking || !scope.current || reduced) return;
    const root = scope.current;
    const glitch = () => {
      // brief chromatic displacement of the projection while it speaks
      if (subjectRef.current) {
        animate(subjectRef.current, {
          translateX: [0, 3, -2, 0],
          filter: [
            'hue-rotate(0deg) saturate(1)',
            'hue-rotate(18deg) saturate(1.5)',
            'hue-rotate(-12deg) saturate(1.2)',
            'hue-rotate(0deg) saturate(1)',
          ],
          duration: 420,
          ease: 'steps(4)',
        });
      }
      if (scanRef.current) {
        animate(scanRef.current, { opacity: [1, 0.4, 1], duration: 300, ease: 'steps(2)' });
      }
    };
    const timer = window.setInterval(glitch, 1500);
    return () => window.clearInterval(timer);
  }, [speaking, reduced]);

  /* ---------------- deep scan burst ---------------- */
  useEffect(() => {
    if (!pulse || reduced || !scope.current) return;
    if (burstRef.current) {
      animate(burstRef.current, {
        scale: [0.82, 1.5],
        opacity: [0.9, 0],
        duration: 1300,
        ease: EASE.glide,
      });
    }
    animate(scope.current.querySelectorAll<HTMLElement>('.holo-tick'), {
      scaleY: [1, 1.9, 1],
      opacity: [0.5, 1, 0.5],
      duration: 900,
      delay: stagger(12, { from: 'center' }),
      ease: EASE.smooth,
    });
  }, [pulse, reduced]);

  return (
    <div
      ref={scope}
      className="relative flex h-full w-full items-center justify-center"
      style={{ containerType: 'size' }}
    >
      {/* projection fog */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 42%, rgba(46,242,192,0.14) 0%, rgba(20,120,150,0.06) 40%, transparent 66%)',
        }}
      />

      <div
        className="relative"
        style={{ width: 'min(100cqw, 100cqh)', height: 'min(100cqw, 100cqh)' }}
      >
        <div ref={rigRef} className="absolute inset-0" style={{ transformStyle: 'preserve-3d' }}>
          {/* ============ orbital assembly ============ */}
          <div className="absolute left-1/2 top-0 aspect-square w-[90%] -translate-x-1/2">
            {/* outer orbits */}
            <div className="absolute inset-[-5%]">
              <div
                className="holo-orbit absolute inset-0 rounded-full border border-dashed"
                data-duration="52000"
                style={{ borderColor: 'rgba(125,242,255,0.14)' }}
              />
              <div
                className="holo-orbit absolute inset-[7%] rounded-full"
                data-duration="34000"
                style={{
                  border: '1px solid rgba(125,242,255,0.2)',
                  borderLeftColor: 'transparent',
                  borderBottomColor: 'transparent',
                }}
              />

              <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
                <g stroke="rgba(150,246,255,0.35)">
                  {Array.from({ length: 96 }).map((_, index) => {
                    const angle = (index / 96) * Math.PI * 2;
                    const major = index % 8 === 0;
                    const outer = major ? 96 : 93;
                    return (
                      <line
                        key={index}
                        x1={r2(100 + Math.cos(angle) * 88)}
                        y1={r2(100 + Math.sin(angle) * 88)}
                        x2={r2(100 + Math.cos(angle) * outer)}
                        y2={r2(100 + Math.sin(angle) * outer)}
                        strokeWidth={major ? 0.9 : 0.32}
                      />
                    );
                  })}
                </g>
                <g className="holo-orbit" data-duration="38000" style={{ transformOrigin: '100px 100px' }}>
                  <path
                    d="M 100 4 A 96 96 0 0 1 196 100"
                    fill="none"
                    stroke="rgba(182,255,59,0.55)"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 100 196 A 96 96 0 0 1 4 100"
                    fill="none"
                    stroke="rgba(182,255,59,0.32)"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                </g>
                <g className="holo-orbit" data-duration="56000" style={{ transformOrigin: '100px 100px' }}>
                  <circle
                    cx="100"
                    cy="100"
                    r="78"
                    fill="none"
                    stroke="rgba(125,242,255,0.38)"
                    strokeWidth="0.9"
                    strokeDasharray="1.5 8"
                  />
                </g>
              </svg>
            </div>

            {/* subject — live WebGL face rig */}
            <div className="absolute inset-[10%] overflow-hidden rounded-full bg-[#020a0d]">
              <div
                ref={subjectRef}
                className="absolute inset-0"
                style={{
                  transform: 'translate3d(var(--px, 0px), var(--py, 0px), 0) scale(1.02)',
                  willChange: 'transform',
                }}
              >
                <AvatarRig mode={mode} className="absolute inset-0" />
              </div>
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'radial-gradient(circle at 50% 42%, rgba(120,255,255,0.08) 0%, rgba(3,20,26,0.28) 62%, #02080a 94%)',
                  mixBlendMode: 'screen',
                }}
              />
              <div className="holo-grid pointer-events-none absolute inset-0 opacity-40" />
              <div className="holo-scanlines pointer-events-none absolute inset-0 opacity-40" />
              <div className="holo-dither pointer-events-none absolute inset-0 opacity-60" />
              <div
                className="pointer-events-none absolute inset-0 rounded-full"
                style={{
                  boxShadow:
                    'inset 0 0 0 1px rgba(150,246,255,0.32), inset 0 0 46px 8px rgba(46,242,192,0.14)',
                }}
              />
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  boxShadow:
                    'inset 0 0 70px 22px rgba(2,8,10,0.92), inset 0 0 140px 46px rgba(2,8,10,0.55)',
                }}
              />
            </div>

            {/* scan sweep */}
            <div className="pointer-events-none absolute inset-[8%] overflow-hidden rounded-full">
              <div ref={scanRef} className="holo-scan absolute inset-x-0 top-1/2 h-[38%]" />
            </div>

            {/* reticle */}
            <svg viewBox="0 0 200 200" className="pointer-events-none absolute inset-0 h-full w-full">
              <defs>
                <linearGradient id="holoCrossH" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="rgba(150,246,255,0)" />
                  <stop offset="38%" stopColor="rgba(150,246,255,0.5)" />
                  <stop offset="62%" stopColor="rgba(150,246,255,0.5)" />
                  <stop offset="100%" stopColor="rgba(150,246,255,0)" />
                </linearGradient>
                <linearGradient id="holoCrossV" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(150,246,255,0)" />
                  <stop offset="46%" stopColor="rgba(150,246,255,0.38)" />
                  <stop offset="100%" stopColor="rgba(150,246,255,0)" />
                </linearGradient>
              </defs>

              <rect x="0" y="99.6" width="200" height="0.8" fill="url(#holoCrossH)" />
              <rect x="99.6" y="0" width="0.8" height="200" fill="url(#holoCrossV)" />

              <circle cx="100" cy="100" r="71" fill="none" stroke="rgba(125,242,255,0.26)" strokeWidth="0.45" />
              <circle cx="100" cy="100" r="56" fill="none" stroke="rgba(125,242,255,0.14)" strokeWidth="0.4" strokeDasharray="2 5" />

              {Array.from({ length: 72 }).map((_, index) => {
                const angle = (index / 72) * Math.PI * 2;
                const major = index % 6 === 0;
                const outer = major ? 69 : 65.5;
                return (
                  <line
                    key={index}
                    x1={r2(100 + Math.cos(angle) * 62)}
                    y1={r2(100 + Math.sin(angle) * 62)}
                    x2={r2(100 + Math.cos(angle) * outer)}
                    y2={r2(100 + Math.sin(angle) * outer)}
                    stroke="rgba(150,246,255,0.42)"
                    strokeWidth={major ? 0.8 : 0.32}
                  />
                );
              })}

              {[0, 90, 180, 270].map((angle) => (
                <g key={angle} transform={`rotate(${angle} 100 100)`}>
                  <path d="M 100 5 l 4 6 l -8 0 z" fill="rgba(182,255,59,0.8)" />
                </g>
              ))}

              <g stroke="rgba(150,246,255,0.45)" strokeWidth="0.8" fill="none">
                <path d="M 8 30 L 8 8 L 30 8" />
                <path d="M 192 30 L 192 8 L 170 8" />
                <path d="M 8 170 L 8 192 L 30 192" />
                <path d="M 192 170 L 192 192 L 170 192" />
              </g>

              <g className="holo-orbit" data-duration="26000" style={{ transformOrigin: '100px 100px' }}>
                <path d="M 100 20 A 80 80 0 0 1 180 100" fill="none" stroke="rgba(182,255,59,0.42)" strokeWidth="0.9" />
                <circle cx="180" cy="100" r="1.3" fill="rgba(182,255,59,0.85)" />
              </g>

              <circle
                ref={burstRef}
                cx="100"
                cy="100"
                r="70"
                fill="none"
                stroke="rgba(182,255,59,0.7)"
                strokeWidth="0.8"
                opacity="0"
                style={{ transformOrigin: '100px 100px' }}
              />
            </svg>

            {/* radial ticks */}
            {Array.from({ length: 24 }).map((_, index) => (
              <span
                key={index}
                className="pointer-events-none absolute left-1/2 top-1/2 h-0 w-0"
                style={{
                  transform: `rotate(${r2((index / 24) * 360)}deg) translateY(-44%)`,
                }}
              >
                <span
                  className="holo-tick block h-4 w-px origin-top opacity-50"
                  style={{
                    background: 'linear-gradient(to bottom, rgba(150,246,255,0.9), transparent)',
                  }}
                />
              </span>
            ))}

            {/* sparks */}
            {SPARKS.map((spark, index) => (
              <span
                key={index}
                className="holo-spark pointer-events-none absolute rounded-full"
                style={{
                  left: `${spark.left}%`,
                  top: `${spark.top}%`,
                  width: spark.size,
                  height: spark.size,
                  background: index % 3 === 0 ? 'var(--hud-lime)' : 'var(--hud-ink)',
                  boxShadow: '0 0 8px currentColor',
                  color: index % 3 === 0 ? 'var(--hud-lime)' : 'var(--hud-ink)',
                  opacity: 0,
                }}
              />
            ))}

            {/* horizontal laser */}
            <div
              className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[160vw] max-w-none -translate-x-1/2"
              style={{
                background:
                  'linear-gradient(to right, transparent, rgba(182,255,59,0.04) 16%, rgba(210,255,120,0.85) 46%, rgba(182,255,59,0.04) 84%, transparent)',
                boxShadow: '0 0 18px 2px rgba(182,255,59,0.4)',
                opacity: 0.85,
              }}
            />
          </div>

          {/* ============ projector ============ */}
          <div
            ref={beamRef}
            className="pointer-events-none absolute bottom-[9%] left-1/2 h-[24%] w-[58%] -translate-x-1/2"
          >
            <div
              className="holo-beam-strand absolute inset-0 origin-bottom"
              style={{
                clipPath: 'polygon(36% 0%, 64% 0%, 100% 100%, 0% 100%)',
                background:
                  'linear-gradient(to bottom, rgba(150,246,255,0.3), rgba(70,235,255,0.1) 45%, rgba(20,120,150,0.02))',
                filter: 'blur(1px)',
              }}
            />
            <div
              className="holo-beam-strand absolute inset-x-[20%] bottom-0 top-0 origin-bottom"
              style={{
                clipPath: 'polygon(28% 0%, 72% 0%, 100% 100%, 0% 100%)',
                background:
                  'linear-gradient(to bottom, rgba(215,255,255,0.32), rgba(70,235,255,0.07) 60%, transparent)',
                filter: 'blur(3px)',
              }}
            />
            <div
              className="holo-beam-strand absolute inset-x-[36%] bottom-0 top-0"
              style={{
                background:
                  'linear-gradient(to bottom, rgba(255,255,255,0.4), rgba(150,246,255,0.08) 55%, transparent)',
                filter: 'blur(6px)',
              }}
            />
          </div>

          <div
            ref={pedestalRef}
            className="pointer-events-none absolute bottom-[1%] left-1/2 w-[58%] -translate-x-1/2"
          >
            <div className="relative aspect-[3/1]">
              <div
                className="absolute inset-0 rounded-[50%]"
                style={{
                  background:
                    'radial-gradient(ellipse at 50% 45%, rgba(120,255,255,0.28) 0%, rgba(10,60,75,0.5) 42%, rgba(2,10,14,0.92) 70%)',
                  border: '1px solid rgba(125,242,255,0.32)',
                  boxShadow: '0 0 40px rgba(70,235,255,0.22), inset 0 0 30px rgba(120,255,255,0.18)',
                }}
              />
              <div
                className="holo-pedestal-core absolute inset-[16%] rounded-[50%]"
                style={{
                  background:
                    'radial-gradient(ellipse at 50% 40%, rgba(220,255,255,0.85) 0%, rgba(120,255,220,0.32) 38%, transparent 72%)',
                  filter: 'blur(2px)',
                }}
              />
              <svg viewBox="0 0 200 66" className="absolute inset-0 h-full w-full">
                <ellipse
                  className="holo-pedestal-arc"
                  cx="100"
                  cy="33"
                  rx="92"
                  ry="27"
                  fill="none"
                  stroke="rgba(182,255,59,0.45)"
                  strokeWidth="0.9"
                  strokeDasharray="24 10 6 10 3 12"
                  style={{ transformOrigin: '100px 33px' }}
                />
                <ellipse
                  cx="100"
                  cy="33"
                  rx="76"
                  ry="21"
                  fill="none"
                  stroke="rgba(150,246,255,0.32)"
                  strokeWidth="0.7"
                />
              </svg>
            </div>
            <div className="mt-1 text-center font-mono text-[6px] uppercase tracking-[0.38em] text-[color:var(--hud-ink-dim)]">
              emitter array // {subjectId}
            </div>
          </div>

          {/* ============ annotations ============ */}
          <div className="pointer-events-none absolute inset-0 font-mono text-[6.5px] uppercase leading-[1.6] tracking-[0.26em] text-[color:var(--hud-ink-dim)]">
            <div className="hud-chip absolute left-0 top-[30%]">
              <span className="block">subject</span>
              <span className="text-[color:var(--hud-ink)]">{subjectId}</span>
            </div>
            <div className="hud-chip absolute right-0 top-[30%] text-right">
              <span className="block">scan pass</span>
              <span className="text-[color:var(--hud-lime)]">
                {String(scanIndex).padStart(2, '0')}
              </span>
            </div>
            <div className="hud-chip absolute bottom-[26%] left-0">
              mesh 4096 pts
              <br />
              drift 0.014
            </div>
            <div className="hud-chip absolute bottom-[26%] right-0 text-right">
              depth 0.82
              <br />
              lock ok
            </div>
          </div>

          {/* deep-scan hit area */}
          <button
            type="button"
            onClick={deepScan}
            className="group absolute left-1/2 top-[45%] h-[54%] w-[54%] -translate-x-1/2 -translate-y-1/2 rounded-full outline-none"
            aria-label="Run a deep neural scan"
          >
            <span className="absolute inset-0 rounded-full border border-transparent transition-colors duration-200 group-hover:border-[color:var(--hud-lime)]/40 group-focus-visible:border-[color:var(--hud-lime)]/70 group-active:scale-[0.98]" />
          </button>
        </div>
      </div>
    </div>
  );
}
