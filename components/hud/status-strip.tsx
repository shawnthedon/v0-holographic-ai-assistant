'use client';

import { CloudOff, Cloud, BatteryLow, BatteryMedium, BatteryFull, RefreshCw } from 'lucide-react';
import { useOffline } from '@/hooks/use-offline';

/**
 * Connection + power + queue state, in one line.
 *
 * This is the honest answer to "is anything degraded right now": it reports the
 * browser's real online flag, the real pending sync count, the real battery
 * profile, and whether the service worker is actually installed. When the
 * Battery Status API is unavailable it says so instead of showing a fake level.
 */
export function StatusStrip({ className = '' }: { className?: string }) {
  const offline = useOffline();

  const BatteryIcon =
    offline.profile === 'saver' ? BatteryLow : offline.profile === 'balanced' ? BatteryMedium : BatteryFull;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[6.5px] uppercase tracking-[0.24em] ${className}`}
      aria-live="polite"
    >
      {/* Before mount neither branch is known, so the strip says "sync" in
          neutral grey rather than guessing and hydrating into a mismatch. */}
      {!offline.ready ? (
        <span className="flex items-center gap-1 text-[color:var(--hud-ink-dim)]/70">
          <Cloud size={9} /> sync
        </span>
      ) : (
        <span
          className={`flex items-center gap-1 ${
            offline.online ? 'text-[color:var(--hud-mint)]' : 'text-[#ffd27a]'
          }`}
        >
          {offline.online ? <Cloud size={9} /> : <CloudOff size={9} />}
          {offline.online ? 'online' : 'offline'}
        </span>
      )}

      <span className="flex items-center gap-1 text-[color:var(--hud-ink-dim)]">
        <BatteryIcon size={9} />
        {offline.profile}
      </span>

      {(offline.pending > 0 || offline.syncing) && (
        <span className="flex items-center gap-1 text-[color:var(--hud-lime)]">
          <RefreshCw size={9} className={offline.syncing ? 'animate-spin' : ''} />
          {offline.syncing ? 'syncing' : `${offline.pending} queued`}
        </span>
      )}

      {offline.failed > 0 && (
        <button
          type="button"
          onClick={offline.retry}
          className="flex items-center gap-1 text-[#ff9d7a] underline decoration-dotted"
        >
          {offline.failed} failed · retry
        </button>
      )}

      {offline.serviceWorker === 'unsupported' && (
        <span className="text-[color:var(--hud-ink-dim)]/70">no sw</span>
      )}
    </div>
  );
}
