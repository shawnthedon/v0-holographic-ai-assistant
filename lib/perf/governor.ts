'use client';

/**
 * The power governor.
 *
 * One place decides how much rendering work the console does, and everything
 * that costs frames subscribes to it instead of each feature inventing a
 * heuristic:
 *
 *   profile   fps cap   telemetry   behaviour
 *   full        60      5 Hz        ambient motion, all instruments live
 *   balanced    45      4 Hz        ambient motion, instruments live
 *   saver       20      1 Hz        ambient motion paused, charts slower
 *
 * The governor also reacts to `document.hidden` (a tab that is not visible must
 * not burn battery) and to the network coming back (a reconnect is the moment
 * to drain the sync queue and warm caches).
 */

import { telemetry } from '@/lib/hud/telemetry';
import {
  UNKNOWN_BATTERY,
  profileFor,
  subscribeBattery,
  type BatterySnapshot,
  type PowerProfile,
} from './battery';
import { getSyncManager } from '@/lib/offline/sync';

export interface GovernorState {
  profile: PowerProfile;
  battery: BatterySnapshot;
  hidden: boolean;
  online: boolean;
  fpsCap: number;
  /** Telemetry publish rate. */
  telemetryHz: number;
}

interface Preset {
  fpsCap: number;
  telemetryHz: number;
  ambient: boolean;
}

const PRESETS: Record<PowerProfile, Preset> = {
  full: { fpsCap: 60, telemetryHz: 5, ambient: true },
  balanced: { fpsCap: 45, telemetryHz: 4, ambient: true },
  saver: { fpsCap: 20, telemetryHz: 1, ambient: false },
};

type Listener = (state: GovernorState) => void;

class PowerGovernor {
  state: GovernorState = {
    profile: 'balanced',
    battery: UNKNOWN_BATTERY,
    hidden: false,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    ...PRESETS.balanced,
  };

  private listeners = new Set<Listener>();
  private started = false;
  private teardownBattery: (() => void) | null = null;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState(): GovernorState {
    return this.state;
  }

  /** Frame budget for anything that draws: `requestAnimationFrame` loops. */
  getFpsCap(): number {
    return this.state.fpsCap;
  }

  /**
   * Minimum gap between paints, derived from the fps cap. Loops that draw on a
   * timer use this instead of hard-coding a number.
   */
  getFrameIntervalMs(): number {
    return Math.round(1000 / this.state.fpsCap);
  }

  ambientEnabled(): boolean {
    return PRESETS[this.state.profile].ambient && !this.state.hidden;
  }

  async start(): Promise<void> {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;

    this.teardownBattery = await subscribeBattery((snapshot) => {
      this.apply({ battery: snapshot });
    });

    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.apply({});
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.teardownBattery?.();
    this.teardownBattery = null;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private onOnline = () => {
    this.apply({ online: true });
    // Reconnecting is the moment the queue is worth draining.
    void getSyncManager().flush();
  };

  private onOffline = () => this.apply({ online: false });

  private onVisibility = () => this.apply({ hidden: document.visibilityState === 'hidden' });

  private apply(patch: Partial<Pick<GovernorState, 'battery' | 'hidden' | 'online'>>): void {
    const next = { ...this.state, ...patch };
    const profile = profileFor(next.battery, { hidden: next.hidden });
    const preset = PRESETS[profile];
    this.state = { ...next, profile, fpsCap: preset.fpsCap, telemetryHz: preset.telemetryHz };

    if (typeof document !== 'undefined') {
      document.documentElement.dataset.power = profile;
    }
    telemetry.setProfile(profile);

    for (const listener of this.listeners) listener(this.state);
    window.dispatchEvent(new CustomEvent('nexus:power', { detail: this.state }));
  }
}

let governor: PowerGovernor | null = null;

export function getGovernor(): PowerGovernor {
  if (!governor) governor = new PowerGovernor();
  return governor;
}

export const PRESETS_BY_PROFILE = PRESETS;
