'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { getGovernor } from '@/lib/perf/governor';
import { getSyncManager } from '@/lib/offline/sync';
import { pruneCache } from '@/lib/offline/db';
import { registerArtifactSyncHandlers, reclaimSpace } from '@/lib/artifacts/service';
import { scheduleTask } from '@/lib/perf/tasks';
import { telemetry } from '@/lib/hud/telemetry';

/**
 * Boots the three background systems once, for the whole app:
 *
 *   1. power governor   — decides render cadence from battery/visibility
 *   2. sync manager     — flushes the durable queue when the network returns
 *   3. service worker   — caches the shell so a cold offline load works
 *
 * All of it is best-effort: a browser that refuses any one of them still gets a
 * working console, and the failure is reported rather than swallowed.
 */

const SW_VERSION_MESSAGE = 'nexus:sw';

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [swState, setSwState] = useState<'unsupported' | 'registering' | 'ready' | 'failed'>(
    typeof navigator === 'undefined' || !('serviceWorker' in navigator) ? 'unsupported' : 'registering',
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        // Order matters a little: handlers before the manager starts, so a task
        // left from a previous session is picked up by something.
        registerArtifactSyncHandlers();
        getSyncManager().start();
        await getGovernor().start();

        /*
         * Maintenance is deferred work: it must run, but never at the cost of a
         * frame the operator is waiting for. The scheduler holds it back until
         * the tab is idle, online and not on a dying battery.
         */
        scheduleTask({
          id: 'cache-prune',
          priority: 'deferred',
          run: async () => {
            const pruned = await pruneCache();
            if (pruned > 0) telemetry.logEvent(`${pruned} cache entries reclaimed`, 'info');
          },
        });
        scheduleTask({
          id: 'artifact-sweep',
          priority: 'deferred',
          run: async () => {
            const freed = await reclaimSpace();
            if (freed > 0) telemetry.logEvent(`${freed} orphan payloads reclaimed`, 'info');
          },
        });
        scheduleTask({
          id: 'cache-warm',
          priority: 'deferred',
          run: async () => {
            // Warm the model catalogue so the picker opens instantly offline.
            await fetch('/api/models', { cache: 'no-store' }).catch(() => undefined);
          },
        });
      } catch (error) {
        console.warn('[offline] background systems failed to start', error);
        telemetry.logEvent('offline subsystems degraded', 'warn');
      }
    })();

    /**
     * The worker is only registered in production, or when explicitly asked for
     * with `?sw=1`. A dev-mode worker caches the app shell and then serves a
     * stale build to the next `npm run dev`, which looks exactly like a broken
     * deploy and wastes hours.
     */
    const wantsWorker =
      process.env.NODE_ENV === 'production' ||
      (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('sw') === '1');

    if (!wantsWorker || !('serviceWorker' in navigator)) {
      if (!('serviceWorker' in navigator)) setSwState('unsupported');
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        if (cancelled) return;
        setSwState('ready');
        telemetry.logEvent('service worker ready', 'good');

        navigator.serviceWorker.addEventListener('message', (event) => {
          const data = event.data ?? {};
          if (data.type === 'SYNC_NOW') void getSyncManager().flush({ includeDeferred: false });
          if (data.type === 'PONG') console.info('[offline] worker', data.version);
        });

        // A new worker taking over mid-session should not wait for a reload.
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          installing?.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              installing.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      } catch (error) {
        if (cancelled) return;
        setSwState('failed');
        console.warn('[offline] service worker registration failed', error);
        telemetry.logEvent('service worker unavailable', 'warn');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Surfaced on <html> for diagnostics and for the settings panel to read.
  useEffect(() => {
    document.documentElement.dataset.sw = swState;
    window.dispatchEvent(new CustomEvent(SW_VERSION_MESSAGE, { detail: swState }));
  }, [swState]);

  return <>{children}</>;
}
