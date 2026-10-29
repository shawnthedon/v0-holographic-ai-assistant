'use client';

import { useEffect, useState } from 'react';
import { getSyncManager, type SyncState } from '@/lib/offline/sync';
import { getGovernor, type GovernorState } from '@/lib/perf/governor';
import { describeBattery, type PowerProfile } from '@/lib/perf/battery';

export interface OfflineStatus {
  /**
   * False until the client has read the real connection state. The server
   * cannot know it, so anything rendered before mount must not claim either
   * answer — see StatusStrip.
   */
  ready: boolean;
  online: boolean;
  /** True once we have been offline at some point this session. */
  wasOffline: boolean;
  pending: number;
  failed: number;
  syncing: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  profile: PowerProfile;
  batteryLabel: string;
  /** 'checking' until the client has actually looked — never rendered as a fact. */
  serviceWorker: 'checking' | 'unsupported' | 'registering' | 'ready' | 'failed';
  retry: () => void;
  syncNow: () => void;
}

/**
 * One hook for "how degraded is this session right now".
 *
 * Both sources are singletons that already handle their own listeners; this only
 * subscribes, so mounting it in three places costs three callbacks, not three
 * sets of event handlers.
 */
export function useOffline(): OfflineStatus {
  const [sync, setSync] = useState<SyncState>(() => getSyncManager().getState());
  const [governor, setGovernor] = useState<GovernorState>(() => getGovernor().getState());
  const [wasOffline, setWasOffline] = useState(false);
  /*
   * Starts as 'checking' on BOTH sides. Reading `navigator` during the first
   * render is what produced a hydration mismatch: the server has no navigator
   * and rendered "no sw", the client rendered nothing.
   */
  const [serviceWorker, setServiceWorker] = useState<OfflineStatus['serviceWorker']>('checking');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      setServiceWorker('unsupported');
      return;
    }
    setServiceWorker(navigator.serviceWorker.controller ? 'ready' : 'registering');
  }, []);

  useEffect(() => {
    const unsubscribeSync = getSyncManager().subscribe(setSync);
    const unsubscribeGovernor = getGovernor().subscribe(setGovernor);

    const onOnline = () => setWasOffline(true);
    const onOffline = () => setWasOffline(true);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    const onSw = (event: Event) => {
      const detail = (event as CustomEvent).detail as OfflineStatus['serviceWorker'];
      if (detail) setServiceWorker(detail);
    };
    window.addEventListener('nexus:sw', onSw);

    return () => {
      unsubscribeSync();
      unsubscribeGovernor();
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('nexus:sw', onSw);
    };
  }, []);

  return {
    ready,
    online: sync.online,
    wasOffline,
    pending: sync.pending,
    failed: sync.failed,
    syncing: sync.running,
    lastSyncAt: sync.lastSyncAt,
    lastError: sync.lastError,
    profile: governor.profile,
    batteryLabel: describeBattery(governor.battery),
    serviceWorker,
    retry: () => void getSyncManager().retryFailed(),
    syncNow: () => void getSyncManager().flush({ includeDeferred: true }),
  };
}
