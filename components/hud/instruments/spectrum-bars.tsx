'use client';

import { useEffect, useRef } from 'react';
import { telemetry } from '@/lib/hud/telemetry';
import { getGovernor } from '@/lib/perf/governor';
import { useReducedMotion } from '@/lib/hud/motion';

interface SpectrumBarsProps {
  className?: string;
  color?: string;
  peakColor?: string;
  bars?: number;
  /** when the microphone is closed, fall back to the frame-time series */
  fallbackSeries?: 'fps' | 'frame';
}

/**
 * Real spectrum analyser. Every bar is a bin of the live microphone FFT;
 * with the channel closed it plots the frame-time history instead so the
 * display always reflects something true about the running app.
 */
export function SpectrumBars({
  className = '',
  color = '#8ff6ff',
  peakColor = '#b6ff3b',
  bars = 20,
  fallbackSeries = 'frame',
}: SpectrumBarsProps) {
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
    let peaks = new Float32Array(bars);

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      // 2x on a small canvas triples raster cost for no visible gain.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    resize();

    let lastDraw = 0;
    const draw = (now = 0) => {
      raf = requestAnimationFrame(draw);
      // Telemetry publishes at 5 Hz. Repainting every frame redrew identical
      // pixels ~12x more often than the data changed.
      // Battery-aware: the base cadence, or slower when the governor caps fps.
      const minGap = Math.max(33, getGovernor().getFrameIntervalMs());
      if (now - lastDraw < minGap) return;
      lastDraw = now;
      if (!width || !height) return;
      ctx.clearRect(0, 0, width, height);

      const gap = 2;
      const barWidth = Math.max(1.5, (width - gap * (bars - 1)) / bars);
      const live = telemetry.spectrumLive;
      const history = telemetry.history[fallbackSeries];
      const scale = fallbackSeries === 'frame' ? 34 : 70;

      for (let index = 0; index < bars; index += 1) {
        let value: number;
        if (live) {
          const bin = Math.floor((index / bars) * telemetry.spectrum.length);
          value = telemetry.spectrum[bin] / 255;
        } else {
          const sample = history[Math.max(0, history.length - bars + index)] ?? 0;
          value = Math.min(1, Math.max(0.03, sample / scale));
        }

        const h = Math.max(2, value * (height - 4));
        const x = index * (barWidth + gap);
        const y = height - h;

        const gradient = ctx.createLinearGradient(0, y, 0, height);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, `${color}22`);
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, barWidth, h);

        // peak-hold markers decay slowly — real analyser behaviour
        peaks[index] = Math.max(value, peaks[index] - 0.012);
        ctx.fillStyle = peaks[index] > 0.02 ? peakColor : 'transparent';
        ctx.globalAlpha = 0.75;
        ctx.fillRect(x, height - Math.max(2, peaks[index] * (height - 4)) - 2, barWidth, 1.5);
        ctx.globalAlpha = 1;
      }
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
  }, [bars, color, fallbackSeries, peakColor, reduced]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
