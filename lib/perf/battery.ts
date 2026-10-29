'use client';

/**
 * Battery + power profile.
 *
 * The Battery Status API is not universally available (Firefox/Safari removed
 * it). When it is absent we say so — `supported: false` — and stay on the
 * balanced profile rather than inventing a level. The profile is the only thing
 * the rest of the app reads; nothing else touches the API directly.
 */

export interface BatterySnapshot {
  supported: boolean;
  /** 0..1, or null when unknown. */
  level: number | null;
  charging: boolean | null;
  chargingTime: number | null;
  dischargingTime: number | null;
}

export type PowerProfile = 'full' | 'balanced' | 'saver';

interface BatteryLike extends EventTarget {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
}

type NavigatorWithBattery = Navigator & { getBattery?: () => Promise<BatteryLike> };

export const UNKNOWN_BATTERY: BatterySnapshot = {
  supported: false,
  level: null,
  charging: null,
  chargingTime: null,
  dischargingTime: null,
};

export function batterySupported(): boolean {
  return typeof navigator !== 'undefined' && typeof (navigator as NavigatorWithBattery).getBattery === 'function';
}

export function readSnapshot(battery: BatteryLike): BatterySnapshot {
  return {
    supported: true,
    level: Number.isFinite(battery.level) ? customerClamp(battery.level) : null,
    charging: typeof battery.charging === 'boolean' ? battery.charging : null,
    chargingTime: Number.isFinite(battery.chargingTime) && battery.chargingTime > 0 ? battery.chargingTime : null,
    dischargingTime:
      Number.isFinite(battery.dischargingTime) && battery.dischargingTime > 0
        ? battery.dischargingTime
        : null,
  };
}

function customerClamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Decide how much work the UI should do.
 *
 *   saver    — discharging at or below 20%: drop sampling, pause ambient motion
 *   balanced — discharging mid-range, or battery unknown: the default cadence
 *   full     — on mains power, or a healthy battery: everything on
 */
export function profileFor(
  battery: BatterySnapshot,
  context: { hidden?: boolean } = {},
): PowerProfile {
  if (context.hidden) return 'balanced'; // a hidden tab does no animation anyway
  if (!battery.supported || battery.level === null) return 'balanced';
  if (battery.charging) return 'full';
  if (battery.level <= 0.2) return 'saver';
  if (battery.level <= 0.45) return 'balanced';
  return 'full';
}

export async function subscribeBattery(
  onChange: (snapshot: BatterySnapshot) => void,
): Promise<() => void> {
  if (!batterySupported()) {
    onChange(UNKNOWN_BATTERY);
    return () => undefined;
  }

  try {
    const battery = await (navigator as NavigatorWithBattery).getBattery!();
    const emit = () => onChange(readSnapshot(battery));
    emit();
    battery.addEventListener('levelchange', emit);
    battery.addEventListener('chargingchange', emit);
    battery.addEventListener('chargingtimechange', emit);
    battery.addEventListener('dischargingtimechange', emit);
    return () => {
      battery.removeEventListener('levelchange', emit);
      battery.removeEventListener('chargingchange', emit);
      battery.removeEventListener('chargingtimechange', emit);
      battery.removeEventListener('dischargingtimechange', emit);
    };
  } catch {
    onChange(UNKNOWN_BATTERY);
    return () => undefined;
  }
}

export function describeBattery(snapshot: BatterySnapshot): string {
  if (!snapshot.supported || snapshot.level === null) return 'battery · not exposed';
  const percent = Math.round(snapshot.level * 100);
  return snapshot.charging ? `battery ${percent}% · charging` : `battery ${percent}%`;
}
