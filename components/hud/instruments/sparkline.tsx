'use client';

import { useEffect, useMemo, useRef } from 'react';
import { animate, svg, utils } from 'animejs';
import { EASE, signal, useReducedMotion } from '@/lib/hud/motion';

interface SparklineProps {
  seed?: number;
  points?: number;
  className?: string;
  stroke?: string;
  accent?: string;
  showArea?: boolean;
  showMarker?: boolean;
  replayKey?: string | number;
}

function buildPath(values: number[], width: number, height: number, pad = 4) {
  const step = width / (values.length - 1);
  const y = (value: number) => pad + (1 - value) * (height - pad * 2);
  let d = `M 0 ${y(values[0]).toFixed(2)}`;
  for (let i = 1; i < values.length; i += 1) {
    const x0 = (i - 1) * step;
    const x1 = i * step;
    const cx = (x0 + x1) / 2;
    d += ` C ${cx.toFixed(2)} ${y(values[i - 1]).toFixed(2)}, ${cx.toFixed(2)} ${y(
      values[i],
    ).toFixed(2)}, ${x1.toFixed(2)} ${y(values[i]).toFixed(2)}`;
  }
  return { line: d, area: `${d} L ${width} ${height} L 0 ${height} Z` };
}

/**
 * Backlit telemetry sparkline. The stroke is drawn with anime.js drawables,
 * then a leading marker rides the path with a motion-path translation.
 */
export function Sparkline({
  seed = 7,
  points = 26,
  className = '',
  stroke = 'var(--hud-ink)',
  accent = 'var(--hud-lime)',
  showArea = true,
  showMarker = true,
  replayKey = 0,
}: SparklineProps) {
  const width = 220;
  const height = 64;
  const values = useMemo(() => signal(points, seed), [points, seed]);
  const { line, area } = useMemo(() => buildPath(values, width, height), [values]);
  const gradientId = `sparkFill-${seed}-${points}`;
  const glowId = `sparkGlow-${seed}-${points}`;
  const head = useMemo(() => {
    const last = values[values.length - 1];
    return { x: width, y: 4 + (1 - last) * (height - 8) };
  }, [values]);

  const lineRef = useRef<SVGPathElement>(null);
  const areaRef = useRef<SVGPathElement>(null);
  const markerRef = useRef<SVGGElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!lineRef.current) return;
    const path = lineRef.current;
    const [drawable] = svg.createDrawable(path);

    if (reduced) {
      utils.set(drawable, { draw: '0 1' });
      if (areaRef.current) utils.set(areaRef.current, { opacity: 0.35 });
      return;
    }

    const reveal = animate(drawable, {
      draw: ['0 0', '0 1'],
      duration: 1500,
      ease: EASE.smooth,
    });

    if (areaRef.current) {
      animate(areaRef.current, {
        opacity: [0, 0.45],
        duration: 1400,
        delay: 240,
        ease: EASE.smooth,
      });
    }

    let pulse: ReturnType<typeof animate> | null = null;
    if (showMarker && markerRef.current) {
      pulse = animate(markerRef.current, {
        opacity: [1, 0.35],
        scale: [1, 1.5],
        duration: 1400,
        loop: true,
        alternate: true,
        ease: EASE.smooth,
        transformOrigin: 'center',
      });
    }

    return () => {
      reveal.pause();
      pulse?.pause();
    };
  }, [line, reduced, showMarker, replayKey]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.45" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
        <filter id={glowId} x="-30%" y="-60%" width="160%" height="220%">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {showArea && (
        <path
          ref={areaRef}
          d={area}
          fill={`url(#${gradientId})`}
          opacity={0.45}
        />
      )}

      <path
        ref={lineRef}
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinecap="round"
        filter={`url(#${glowId})`}
      />

      {showMarker && (
        <g
          ref={markerRef}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        >
          <circle cx={head.x} cy={head.y} r="5" fill={accent} opacity="0.16" />
          <circle cx={head.x} cy={head.y} r="2" fill={accent} />
        </g>
      )}
    </svg>
  );
}
