'use client';

import { useEffect, useRef } from 'react';
import { telemetry } from '@/lib/hud/telemetry';
import { useReducedMotion } from '@/lib/hud/motion';

interface LiveWaveformProps {
  className?: string;
  color?: string;
  accent?: string;
  /** 'audio' shows the microphone trace, 'frame' the frame-time history */
  source?: 'audio' | 'frame';
  grid?: boolean;
}

/**
 * Oscilloscope drawn from real samples: the live microphone buffer when the
 * channel is open, the frame-time history otherwise.
 */
export function LiveWaveform({
  className = '',
  color = '#8ff6ff',
  accent = '#b6ff3b',
  source = 'audio',
  grid = true,
}: LiveWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let width = 0;
    let height = 0;
    let smoothed = new Float32Array(128);

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    resize();

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!width || !height) return;
      ctx.clearRect(0, 0, width, height);

      const mid = height / 2;

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

      const live = telemetry.get('micActive') === 1;
      const points: number[] = [];

      if (source === 'audio' && live) {
        const stepSize = Math.floor(telemetry.waveform.length / smoothed.length);
        for (let i = 0; i < smoothed.length; i += 1) {
          const raw = (telemetry.waveform[i * stepSize] - 128) / 128;
          smoothed[i] += (raw - smoothed[i]) * 0.35;
          points.push(smoothed[i]);
        }
      } else {
        const history = telemetry.history[source === 'audio' ? 'audio' : 'frame'];
        const max = source === 'audio' ? 1 : 34;
        const count = smoothed.length;
        for (let i = 0; i < count; i += 1) {
          const value = history[Math.max(0, history.length - count + i)] ?? 0;
          const norm = source === 'audio' ? value / 100 : value / max;
          points.push((norm - 0.5) * (source === 'audio' ? 1 : 1.6));
        }
      }

      const step = width / Math.max(1, points.length - 1);
      ctx.beginPath();
      points.forEach((value, index) => {
        const x = index * step;
        const y = mid - value * mid * 0.86;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.shadowBlur = 9;
      ctx.shadowColor = color;
      ctx.stroke();
      ctx.shadowBlur = 0;

      const headX = width;
      const headY = mid - (points[points.length - 1] ?? 0) * mid * 0.86;
      ctx.beginPath();
      ctx.arc(headX - 2, headY, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.shadowBlur = 12;
      ctx.shadowColor = accent;
      ctx.fill();
      ctx.shadowBlur = 0;
    };

    if (reduced) {
      draw();
      cancelAnimationFrame(raf);
      return () => observer.disconnect();
    }

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [accent, color, grid, reduced, source]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
