'use client';

import { useEffect, useRef } from 'react';
import { telemetry, type HistoryKey } from '@/lib/hud/telemetry';
import { getGovernor } from '@/lib/perf/governor';
import { useReducedMotion } from '@/lib/hud/motion';

interface LiveChartProps {
  series: HistoryKey;
  className?: string;
  color?: string;
  accent?: string;
  /** fixed domain; when omitted the chart auto-scales to the data */
  min?: number;
  max?: number;
  unit?: string;
  showScale?: boolean;
  fill?: boolean;
}

/**
 * Canvas sparkline bound to a real telemetry series. Reads the store inside
 * its own animation frame, so live updates never re-render React.
 */
export function LiveChart({
  series,
  className = '',
  color = '#8ff6ff',
  accent = '#b6ff3b',
  min,
  max,
  unit = '',
  showScale = false,
  fill = true,
}: LiveChartProps) {
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
      const minGap = Math.max(80, getGovernor().getFrameIntervalMs());
      if (now - lastDraw < minGap) return;
      lastDraw = now;
      if (!width || !height) return;

      const data = telemetry.history[series];
      if (!data.length) return;

      let lo = min ?? Infinity;
      let hi = max ?? -Infinity;
      if (min === undefined || max === undefined) {
        for (const value of data) {
          if (value < lo) lo = value;
          if (value > hi) hi = value;
        }
      }
      const top = max ?? (hi === -Infinity ? 1 : hi);
      const bottom = min ?? (lo === Infinity ? 0 : Math.min(lo, top - 1e-3));
      const span = Math.max(1e-3, top - bottom);

      ctx.clearRect(0, 0, width, height);

      const pad = 4;
      const usable = height - pad * 2;
      const step = width / Math.max(1, data.length - 1);
      const yFor = (value: number) =>
        pad + (1 - Math.min(1, Math.max(0, (value - bottom) / span))) * usable;

      const path = new Path2D();
      data.forEach((value, index) => {
        const x = index * step;
        const y = yFor(value);
        if (index === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      });

      if (fill) {
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, `${color}55`);
        gradient.addColorStop(1, `${color}00`);
        const areaPath = new Path2D(path);
        areaPath.lineTo(width, height);
        areaPath.lineTo(0, height);
        areaPath.closePath();
        ctx.fillStyle = gradient;
        ctx.fill(areaPath);
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.lineJoin = 'round';
      ctx.shadowBlur = 8;
      ctx.shadowColor = color;
      ctx.stroke(path);
      ctx.shadowBlur = 0;

      // leading marker at the newest sample
      const lastY = yFor(data[data.length - 1]);
      ctx.beginPath();
      ctx.arc(width - 1.5, lastY, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.shadowBlur = 10;
      ctx.shadowColor = accent;
      ctx.fill();
      ctx.shadowBlur = 0;

      if (showScale) {
        ctx.font = '6px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(150,238,255,0.45)';
        ctx.textAlign = 'left';
        ctx.fillText(`${Math.round(top)}${unit}`, 2, 8);
        ctx.fillText(`${Math.round(bottom)}${unit}`, 2, height - 3);
      }
    };

    if (reduced) {
      draw();
      return () => {
        cancelAnimationFrame(raf);
        observer.disconnect();
      };
    }

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [accent, color, fill, max, min, reduced, series, showScale, unit]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
