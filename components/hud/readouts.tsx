'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { telemetry, type HudMetricKey } from '@/lib/hud/telemetry';
import { useMetric, useUptime } from '@/hooks/use-hud-telemetry';
import { ArcGauge } from '@/components/hud/instruments/arc-gauge';
import { LiveChart } from '@/components/hud/instruments/live-chart';
import { RingCluster, SegmentedMeter } from '@/components/hud/instruments/ring-cluster';
import { HudPanel } from '@/components/hud/chrome';

/* ------------------------------------------------------------------ */
/*  primitives — each subscribes to one metric, so only it re-renders   */
/* ------------------------------------------------------------------ */

const TONE = {
  ink: 'text-[color:var(--hud-ink)]',
  lime: 'text-[color:var(--hud-lime)]',
  mint: 'text-[color:var(--hud-mint)]',
  warn: 'text-[#ff9d7a]',
} as const;

export function MetricLine({
  label,
  metric,
  unit = '',
  precision = 0,
  tone = 'ink',
  transform,
  suffix,
}: {
  label: string;
  metric: Parameters<typeof useMetric>[0];
  unit?: string;
  precision?: number;
  tone?: keyof typeof TONE;
  transform?: (value: number) => number;
  suffix?: string;
}) {
  const raw = useMetric(metric);
  const value = transform ? transform(raw) : raw;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-mono text-[6.5px] uppercase tracking-[0.22em] text-[color:var(--hud-ink-dim)]">
        {label}
      </span>
      <span className={`font-mono text-[10px] tabular-nums tracking-[0.06em] ${TONE[tone]}`}>
        {value.toFixed(precision)}
        {unit && <span className="ml-[1px] text-[6.5px] opacity-60">{unit}</span>}
        {suffix}
      </span>
    </div>
  );
}

/** Inline live text for places that must not subscribe the whole page. */
export function LiveMeta({
  metric,
  unit = '',
  precision = 0,
  suffix = '',
}: {
  metric: Parameters<typeof useMetric>[0];
  unit?: string;
  precision?: number;
  suffix?: string;
}) {
  const value = useMetric(metric);
  return (
    <span>
      {value.toFixed(precision)}
      {unit}
      {suffix}
    </span>
  );
}

/**
 * Odometer-style counter that eases toward the measured value instead of
 * snapping, so increments read as motion rather than a flicker.
 */
export function LiveCounter({
  metric,
  label,
  unit = '',
  pad = 0,
  tone = 'ink',
  size = 'md',
}: {
  metric: HudMetricKey;
  label: string;
  unit?: string;
  pad?: number;
  tone?: keyof typeof TONE;
  size?: 'sm' | 'md' | 'lg';
}) {
  const real = useMetric(metric);
  const [shown, setShown] = useState(real);
  const frame = useRef(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(real);
      return;
    }
    const step = () => {
      setShown((current) => {
        const next = current + (real - current) * 0.22;
        return Math.abs(real - next) < 0.01 ? real : next;
      });
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [real]);

  const text = Math.round(shown).toString().padStart(pad, '0');
  const scale = size === 'lg' ? 'text-[15px]' : size === 'sm' ? 'text-[9px]' : 'text-[11px]';

  return (
    <div className="flex items-baseline justify-between gap-1">
      <span className="font-mono text-[6px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)]">
        {label}
      </span>
      <span className={`font-mono tabular-nums tracking-[0.04em] ${scale} ${TONE[tone]}`}>
        {text}
        {unit && <span className="ml-[1px] text-[6px] opacity-60">{unit}</span>}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  panels                                                             */
/* ------------------------------------------------------------------ */

/** Frame budget: fps dial + jank / long-task counters. */
export function PerformancePanel({ className = '' }: { className?: string }) {
  const fps = useMetric('fps');
  const target = Math.min(100, Math.max(0, (fps / 60) * 100));

  return (
    <HudPanel title="render engine" meta={fps >= 55 ? 'smooth' : fps > 35 ? 'loaded' : 'strained'} className={className}>
      <div className="flex h-full items-center justify-between gap-2">
        <ArcGauge value={target} size={74} stroke={4} color="var(--hud-ink)" />
        <div className="flex flex-1 flex-col justify-center gap-1.5">
          <MetricLine label="fps" metric="fps" precision={1} tone="lime" />
          <MetricLine label="frame" metric="frameMs" precision={1} unit="ms" />
          <MetricLine label="worst" metric="frameWorst" precision={1} unit="ms" tone="warn" />
        </div>
      </div>
    </HudPanel>
  );
}

/** Real microphone analysis: level, peak, dB, sample rate. */
export function AudioPanel({ className = '' }: { className?: string }) {
  const level = useMetric('audioLevel');
  const active = useMetric('micActive');
  const peak = useMetric('audioPeak');

  return (
    <HudPanel
      title="input channel"
      meta={active ? 'live' : 'closed'}
      className={className}
    >
      <div className="flex h-full items-center gap-3">
        <SegmentedMeter
          value={Math.min(100, level * 220)}
          segments={16}
          active={active === 1}
          className="h-full w-2.5 flex-none"
        />
        <div className="flex flex-1 flex-col justify-between gap-1 py-0.5">
          <MetricLine label="level" metric="audioLevel" precision={3} />
          <MetricLine label="peak" metric="audioPeak" precision={3} tone="lime" />
          <MetricLine label="db" metric="audioDb" unit="db" tone={peak > 0.05 ? 'lime' : 'ink'} />
          <MetricLine
            label="rate"
            metric="sampleRate"
            transform={(value) => value / 1000}
            precision={1}
            unit="khz"
          />
        </div>
      </div>
    </HudPanel>
  );
}

/** Network: real probe latency against /api/health. */
export function NetworkPanel({ className = '' }: { className?: string }) {
  const latency = useMetric('latencyMs');
  const up = useMetric('apiUp');
  const online = useMetric('online');
  const fails = useMetric('pingFails');

  const grade = !up ? 'offline' : latency < 120 ? 'excellent' : latency < 300 ? 'fair' : 'slow';

  return (
    <HudPanel title="api uplink" meta={grade} className={className}>
      <div className="flex h-full flex-col justify-between gap-1">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[18px] font-light tabular-nums leading-none text-[color:var(--hud-ink)]">
            {latency}
            <span className="ml-[2px] text-[7px] opacity-60">ms</span>
          </span>
          <span
            className={`flex items-center gap-1 font-mono text-[6px] uppercase tracking-[0.2em] ${
              online && up ? 'text-[color:var(--hud-lime)]' : 'text-[#ff9d7a]'
            }`}
          >
            <span
              className="h-1 w-1 rounded-full"
              style={{
                background: online && up ? 'var(--hud-lime)' : '#ff9d7a',
                boxShadow: '0 0 6px currentColor',
              }}
            />
            {online ? (up ? 'online' : 'degraded') : 'offline'}
          </span>
        </div>

        <LiveChart series="latency" className="h-8 w-full" min={0} max={Math.max(220, latency * 1.4)} />

        <div className="flex flex-col gap-[2px]">
          <MetricLine label="rtt" metric="rttMs" unit="ms" />
          <MetricLine label="downlink" metric="downlinkMbps" precision={1} unit="mb" />
          <MetricLine label="fails" metric="pingFails" tone={fails ? 'warn' : 'ink'} />
        </div>
      </div>
    </HudPanel>
  );
}

/** Memory + DOM size: the app's own runtime footprint. */
export function MemoryPanel({ className = '' }: { className?: string }) {
  const heapPct = useMetric('heapPct');
  const uptime = useUptime();

  return (
    <HudPanel title="runtime" meta={uptime} className={className}>
      <div className="flex h-full items-center justify-between gap-2">
        <ArcGauge value={heapPct} size={64} stroke={3.5} showValue={false} color="var(--hud-mint)" />
        <div className="flex flex-1 flex-col justify-center gap-1">
          <MetricLine label="heap" metric="heapMB" precision={1} unit="mb" />
          <MetricLine label="of" metric="heapLimitMB" unit="mb" />
          <MetricLine label="nodes" metric="domNodes" />
        </div>
      </div>
    </HudPanel>
  );
}

/** Operator + session counters. */
export function SessionPanel({ className = '' }: { className?: string }) {
  const uptime = useUptime();
  return (
    <HudPanel title="session" meta={uptime} className={className}>
      <div className="flex h-full flex-col justify-center gap-1">
        <LiveCounter label="inputs" metric="interactions" tone="ink" />
        <LiveCounter label="messages" metric="messages" tone="ink" />
        <LiveCounter label="scans" metric="scanPasses" tone="lime" />
        <LiveCounter label="agents" metric="agentsTotal" tone="mint" />
      </div>
    </HudPanel>
  );
}

/** Sensor array: radar sweep plus real scan-pass count. */
export function SensorPanel({ className = '', live = false }: { className?: string; live?: boolean }) {
  const passes = useMetric('scanPasses');
  return (
    <HudPanel title="sensor array" meta={live ? 'tracking' : 'lidar'} className={className}>
      <div className="flex h-full items-center justify-around gap-1">
        <RingCluster size={76} active={live} label={`${String(passes).padStart(2, '0')} scan`} />
        <div className="flex flex-col gap-1">
          <LiveCounter label="passes" metric="scanPasses" tone="lime" />
          <LiveCounter label="inputs" metric="interactions" />
          <MetricLine label="up" metric="uptimeSec" transform={(v) => v / 60} precision={1} unit="m" />
        </div>
      </div>
    </HudPanel>
  );
}

/** Biometric identity plate — the source portrait for the projection. */
export function IdentityPlate({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 border border-[color:var(--hud-line)] bg-[#030c10]/70 p-1.5 ${className}`}>
      <div className="relative h-9 w-9 flex-none overflow-hidden rounded-full border border-[color:var(--hud-line-strong)]">
        <Image
          src="/hologram/subject.jpg"
          alt="Subject identity plate"
          fill
          sizes="36px"
          className="object-cover opacity-80 grayscale-[0.35]"
        />
      </div>
      <div className="min-w-0 font-mono text-[6px] uppercase leading-[1.6] tracking-[0.2em]">
        <p className="truncate text-[color:var(--hud-ink-dim)]">identity</p>
        <p className="truncate text-[color:var(--hud-ink)]">01001 · locked</p>
        <p className="truncate text-[color:var(--hud-lime)]">mesh 128k</p>
      </div>
    </div>
  );
}
