'use client';

import { useEffect, useRef } from 'react';
import { animate, createTimer } from 'animejs';
import { EASE, useReducedMotion } from '@/lib/hud/motion';

interface WaveformProps {
  className?: string;
  active?: boolean;
  color?: string;
  accent?: string;
  /** visual loudness 0..1, usually driven by assistant state */
  energy?: number;
  variant?: 'wave' | 'scope';
  grid?: boolean;
}

/**
 * Canvas oscilloscope. A single anime.js timer drives a single RAF loop —
 * amplitude is itself animated by anime.js so state changes ease smoothly.
 */
export function Waveform({
  className = '',
  active = false,
  color = '#8ff6ff',
  accent = '#b6ff3b',
  energy = 0.35,
  variant = 'wave',
  grid = true,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({ amp: energy, swirl: 0 });
  const reduced = useReducedMotion();

  useEffect(() => {
    stateRef.current.amp = energy;
  }, [energy]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const paint = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      if (canvas.width !== Math.round(width * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const mid = height / 2;
      const t = performance.now() / 1000;
      const amp = stateRef.current.amp;

      if (grid) {
        ctx.strokeStyle = 'rgba(120, 240, 255, 0.09)';
        ctx.lineWidth = 1;
        for (let x = 0; x <= width; x += width / 8) {
          ctx.beginPath();
          ctx.moveTo(Math.round(x) + 0.5, 0);
          ctx.lineTo(Math.round(x) + 0.5, height);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(0, mid);
        ctx.lineTo(width, mid);
        ctx.stroke();
      }

      const drawSeries = (opacity: number, scale: number, stroke: string, blur: number) => {
        ctx.beginPath();
        for (let x = 0; x <= width; x += 1) {
          const p = x / width;
          const envelope =
            variant === 'scope'
              ? 0.7 + Math.abs(Math.sin(p * Math.PI)) * 0.6
              : 0.45 + Math.sin(p * Math.PI) * 0.75;
          const signal =
            Math.sin(p * 34 + t * 7.2) * 0.42 +
            Math.sin(p * 11 - t * 4.1) * 0.35 +
            Math.sin(p * 71 + t * 12.5) * 0.22;
          const y = mid + signal * envelope * (height * 0.42) * amp * scale;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.4;
        ctx.shadowBlur = blur;
        ctx.shadowColor = stroke;
        ctx.globalAlpha = opacity;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      };

      drawSeries(0.18, 0.72, color, 0);
      drawSeries(0.95, 1, color, 10);

      // leading trace dot, riding the same signal
      const headX = ((t * 92) % (width + 40)) - 20;
      const p = Math.max(0, Math.min(1, headX / width));
      const envelope = 0.45 + Math.sin(p * Math.PI) * 0.75;
      const signal =
        Math.sin(p * 34 + t * 7.2) * 0.42 +
        Math.sin(p * 11 - t * 4.1) * 0.35 +
        Math.sin(p * 71 + t * 12.5) * 0.22;
      const headY = mid + signal * envelope * (height * 0.42) * amp;

      ctx.beginPath();
      ctx.arc(headX, headY, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.shadowBlur = 14;
      ctx.shadowColor = accent;
      ctx.fill();
      ctx.shadowBlur = 0;
    };

    if (reduced) {
      paint();
      return;
    }

    const timer = createTimer({
      duration: 1000,
      loop: true,
      onUpdate: paint,
    });

    const target = Math.min(1, Math.max(0.12, energy * (active ? 1.35 : 0.85)));
    animate(stateRef.current, {
      amp: target,
      duration: 720,
      ease: EASE.out,
    });

    return () => {
      timer.pause();
    };
  }, [accent, active, color, energy, grid, reduced, variant]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
