'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { telemetry, type HudMetricKey } from '@/lib/hud/telemetry';

/**
 * Subscribe a component to a single live metric. Values are primitives, so a
 * component only re-renders when its own number actually changes.
 */
export function useMetric(key: HudMetricKey): number {
  return useSyncExternalStore(
    telemetry.subscribe,
    () => telemetry.get(key),
    () => 0,
  );
}

/** Read the live store imperatively (for canvas loops — no re-renders). */
export function useTelemetryStore() {
  return telemetry;
}

/** Formatted uptime, ticking off a metric that already updates 5×/s. */
export function useUptime() {
  const seconds = useMetric('uptimeSec');
  if (seconds <= 0) return '--:--';
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** Count an interaction for the "operator input" counter. */
export function useBumpInteraction() {
  return useCallback(() => {
    telemetry.bump('interactions');
  }, []);
}

/** Keep the document title honest about the live frame rate. */
export function useLiveTitle() {
  useEffect(() => {
    const id = window.setInterval(() => {
      const fps = telemetry.get('fps');
      // a backgrounded tab stops painting, so 0 fps means "not sampling"
      document.title = fps > 0 ? `NEXUS · ${fps.toFixed(0)} fps` : 'NEXUS · holographic console';
    }, 4000);
    return () => window.clearInterval(id);
  }, []);
}
