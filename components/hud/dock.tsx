'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BrainCircuit,
  Camera,
  Sparkles,
  MessageSquare,
  Mic,
  MicOff,
  ScanFace,
  Settings,
  HardDriveDownload,
} from 'lucide-react';
import { animate, type JSAnimation } from 'animejs';
import { EASE, useReducedMotion } from '@/lib/hud/motion';

interface DockProps {
  live: boolean;
  thinking: boolean;
  onMicToggle: () => void;
  onChatToggle: () => void;
  onFaceToggle: () => void;
  onSettings: () => void;
  onDeepScan: () => void;
  onModels?: () => void;
  onLocalAi?: () => void;
  localLabel?: string;
  modelLabel?: string;
  chatOpen?: boolean;
}

/**
 * Command dock. Magnetic hover + press feedback + an animated halo that
 * latches on when the microphone channel is live.
 */
export function CommandDock({
  live,
  thinking,
  onMicToggle,
  onChatToggle,
  onFaceToggle,
  onSettings,
  onDeepScan,
  onModels,
  onLocalAi,
  localLabel,
  modelLabel,
  chatOpen = false,
}: DockProps) {
  const dockRef = useRef<HTMLDivElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!dockRef.current) return;
    const buttons = dockRef.current.querySelectorAll<HTMLElement>('.dock-magnet');
    const cleanups: Array<() => void> = [];
    const live = new Map<HTMLElement, JSAnimation>();
    let last = 0;

    buttons.forEach((button) => {
      const onMove = (event: PointerEvent) => {
        if (reduced) return;
        const now = performance.now();
        if (now - last < 40) return;
        last = now;
        const rect = button.getBoundingClientRect();
        const dx = (event.clientX - (rect.left + rect.width / 2)) * 0.22;
        const dy = (event.clientY - (rect.top + rect.height / 2)) * 0.22;
        live.get(button)?.pause();
        live.set(
          button,
          animate(button, {
            translateX: dx,
            translateY: dy,
            duration: 320,
            ease: EASE.out,
          }),
        );
      };
      const onLeave = () => {
        if (reduced) return;
        live.get(button)?.pause();
        live.set(
          button,
          animate(button, {
            translateX: 0,
            translateY: 0,
            duration: 620,
            ease: EASE.spring,
          }),
        );
      };
      button.addEventListener('pointermove', onMove);
      button.addEventListener('pointerleave', onLeave);
      cleanups.push(() => {
        button.removeEventListener('pointermove', onMove);
        button.removeEventListener('pointerleave', onLeave);
      });
    });

    return () => cleanups.forEach((fn) => fn());
  }, [reduced]);

  useEffect(() => {
    if (!haloRef.current || reduced || !live) return;
    const ring = haloRef.current;
    const animation = animate(ring, {
      scale: [1, 1.9],
      opacity: [0.55, 0],
      duration: 1800,
      loop: true,
      ease: 'outSine',
    });
    return () => {
      animation.pause();
    };
  }, [live, reduced]);

  const ripple = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (reduced) return;
    const host = event.currentTarget;
    const el = document.createElement('span');
    el.className = 'pointer-events-none absolute inset-0 rounded-full';
    el.style.border = '1px solid rgba(182,255,59,0.7)';
    host.appendChild(el);
    animate(el, {
      scale: [0.7, 1.5],
      opacity: [0.8, 0],
      duration: 620,
      ease: EASE.out,
      onComplete: () => el.remove(),
    });
  }, [reduced]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center pb-[max(env(safe-area-inset-bottom),0.75rem)]">
      <div ref={dockRef} className="pointer-events-auto relative">
        {/* secondary actions */}
        <div
          className="absolute bottom-full left-1/2 mb-3 flex -translate-x-1/2 items-end gap-2"
          aria-hidden={!expanded}
        >
          {[
            { icon: Sparkles, label: 'Deep scan', action: onDeepScan, active: false },
            ...(onModels
              ? [{ icon: BrainCircuit, label: modelLabel ? `Models · ${modelLabel}` : 'Models', action: onModels, active: false }]
              : []),
            ...(onLocalAi
              ? [{ icon: HardDriveDownload, label: localLabel ? `Local AI · ${localLabel}` : 'Local AI', action: onLocalAi, active: false }]
              : []),
            { icon: Camera, label: 'Biometric capture', action: onFaceToggle, active: false },
            { icon: MessageSquare, label: 'Transcript', action: onChatToggle, active: chatOpen },
            { icon: Settings, label: 'Settings', action: onSettings, active: false },
          ].map((item, index) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                item.action();
                setExpanded(false);
              }}
              className={`dock-magnet group relative flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-colors duration-200 sm:h-11 sm:w-11 ${
                item.active
                  ? 'border-[color:var(--hud-lime)]/70 bg-[color:var(--hud-lime)]/15 text-[color:var(--hud-lime)]'
                  : 'border-[color:var(--hud-line-strong)] bg-[#041014]/80 text-[color:var(--hud-ink)]/80 hover:border-[color:var(--hud-ink)]/70 hover:text-[color:var(--hud-ink)]'
              } ${expanded ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
              style={{
                transform: expanded ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.92)',
                transition: `transform 240ms cubic-bezier(0.16,1,0.3,1) ${index * 35}ms, opacity 180ms ease ${index * 35}ms, border-color 160ms ease, color 160ms ease`,
              }}
              aria-label={item.label}
              tabIndex={expanded ? 0 : -1}
            >
              <item.icon size={16} strokeWidth={1.6} />
              <span className="pointer-events-none absolute bottom-full mb-2 whitespace-nowrap rounded border border-[color:var(--hud-line)] bg-[#020a0d]/95 px-2 py-1 font-mono text-[7px] uppercase tracking-[0.22em] text-[color:var(--hud-ink)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                {item.label}
              </span>
            </button>
          ))}
        </div>

        {/* dock rail */}
        <div className="relative flex items-center gap-1 rounded-full border border-[color:var(--hud-line-strong)] bg-[#030c10]/85 px-2 py-2 shadow-[0_0_40px_rgba(0,200,255,0.12)] backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="dock-magnet group relative flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--hud-line)] text-[color:var(--hud-ink-dim)] transition-colors duration-150 hover:text-[color:var(--hud-ink)] active:scale-95"
            aria-label="More controls"
            aria-expanded={expanded}
          >
            <ScanFace size={15} strokeWidth={1.6} />
          </button>

          <span className="h-6 w-px bg-[color:var(--hud-line)]" />

          {/* primary mic */}
          <button
            type="button"
            onClick={(event) => {
              ripple(event);
              onMicToggle();
            }}
            className={`dock-magnet relative flex h-12 w-12 items-center justify-center rounded-full border transition-colors duration-200 active:scale-[0.96] sm:h-14 sm:w-14 ${
              live
                ? 'border-[color:var(--hud-lime)] bg-[color:var(--hud-lime)]/20 text-[color:var(--hud-lime)]'
                : 'border-[color:var(--hud-ink)]/70 bg-[color:var(--hud-ink)]/10 text-[color:var(--hud-ink)]'
            }`}
            aria-label={live ? 'Stop listening' : 'Start listening'}
            aria-pressed={live}
          >
            <div
              ref={haloRef}
              className="pointer-events-none absolute inset-0 rounded-full border"
              style={{
                borderColor: live ? 'var(--hud-lime)' : 'transparent',
                opacity: live ? 0.55 : 0,
              }}
            />
            {live ? <Mic size={18} strokeWidth={1.7} /> : <MicOff size={18} strokeWidth={1.7} />}
          </button>

          <div className="ml-1 flex flex-col justify-center pr-1 font-mono text-[6.5px] uppercase leading-[1.5] tracking-[0.24em]">
            <span className="text-[color:var(--hud-ink-dim)]">channel</span>
            <span className={live ? 'text-[color:var(--hud-lime)]' : 'text-[color:var(--hud-ink)]'}>
              {live ? 'live' : thinking ? 'synth' : 'standby'}
            </span>
          </div>

          <span className="mr-1 flex h-6 items-end gap-[2px]" aria-hidden>
            {[0, 1, 2, 3, 4].map((index) => (
              <span
                key={index}
                className="dock-eq w-[2px] rounded-full"
                style={{
                  background: live ? 'var(--hud-lime)' : 'var(--hud-ink)',
                  height: `${6 + ((index * 5) % 14)}px`,
                  opacity: live ? 1 : 0.45,
                  animation: `hud-eq ${(live ? 700 : 1600) + index * 90}ms ease-in-out ${
                    index * 90
                  }ms infinite alternate`,
                }}
              />
            ))}
          </span>
        </div>

        {/* status ribbon */}
        <div className="mt-1.5 flex items-center justify-center gap-2 font-mono text-[6px] uppercase tracking-[0.32em] text-[color:var(--hud-ink-dim)]">
          <span className="h-px w-6 bg-[color:var(--hud-line-strong)]" />
          {thinking ? 'synthesising response' : live ? 'capturing voiceprint' : 'tap to open channel'}
          <span className="h-px w-6 bg-[color:var(--hud-line-strong)]" />
        </div>
      </div>
    </div>
  );
}
