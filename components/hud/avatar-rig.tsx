'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { createAvatarRig, type AvatarRigHandle, type AvatarMode } from '@/lib/hud/avatar-face';
import { telemetry } from '@/lib/hud/telemetry';
import { useReducedMotion } from '@/lib/hud/motion';

interface AvatarRigProps {
  mode: AvatarMode;
  className?: string;
  onReady?: () => void;
}

/**
 * React host for the WebGL face rig.
 *
 * The canvas is created imperatively so a remount (React strict mode, route
 * change) always starts from a clean WebGL context. If WebGL is unavailable
 * the projection falls back to the still portrait, so the stage never blanks.
 */
export function AvatarRig({ mode, className = '', onReady }: AvatarRigProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<AvatarRigHandle | null>(null);
  const reduced = useReducedMotion();
  const [status, setStatus] = useState<'pending' | 'live' | 'failed'>('pending');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'h-full w-full';
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);

    let rig: AvatarRigHandle | null = null;
    try {
      rig = createAvatarRig({
        canvas,
        onReady: () => {
          setStatus('live');
          onReady?.();
        },
        onError: () => setStatus('failed'),
      });
      rigRef.current = rig;
    } catch (error) {
      console.error('[hud] avatar rig unavailable', error);
      telemetry.logEvent('webgl projection unavailable', 'warn');
      setStatus('failed');
      return () => {
        canvas.remove();
      };
    }

    const onContextLost = () => {
      telemetry.logEvent('webgl context lost', 'warn');
      setStatus('failed');
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    // feed the real microphone envelope into the mouth rig at ~30hz
    const audioTimer = window.setInterval(() => {
      rig?.setAudio(telemetry.get('audioLevel'));
    }, 33);

    return () => {
      window.clearInterval(audioTimer);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      rig?.dispose();
      rigRef.current = null;
      canvas.remove();
    };
  }, [onReady]);

  useEffect(() => {
    rigRef.current?.setMode(mode);
    rigRef.current?.setHover(!reduced);
  }, [mode, reduced]);

  return (
    <div className={`relative ${className}`}>
      <div ref={hostRef} className="absolute inset-0" />

      {status !== 'live' && (
        <div className="absolute inset-0 overflow-hidden">
          <Image
            src="/hologram/subject.jpg"
            alt=""
            fill
            priority
            sizes="(max-width: 768px) 80vw, 520px"
            className="holo-subject object-cover opacity-90"
          />
          <div className="holo-grid pointer-events-none absolute inset-0" />
          <div className="holo-scanlines pointer-events-none absolute inset-0 opacity-70" />
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_70px_22px_rgba(2,8,10,0.9)]" />
    </div>
  );
}
