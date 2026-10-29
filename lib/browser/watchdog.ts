/**
 * Progress watchdog.
 *
 * The rule this file exists to enforce: **an open page is not progress**. A
 * browser task that has been sitting on the same page for five minutes is
 * stalled, and the watchdog is what turns "still waiting" into an action.
 *
 * Everything here is pure and time-injected, so the tests can drive hours of
 * behaviour in milliseconds without touching a clock.
 */

import type { BrowserTask } from './types';

export interface WatchdogInput {
  now: number;
  /** When the currently executing operation began, or null when idle. */
  operationStartedAt: number | null;
  operationTimeoutMs: number;
  lastProgressAt: number;
  progressIntervalMs: number;
  deadlineAt: number;
}

export type WatchdogSymptom =
  | { kind: 'ok' }
  | { kind: 'deadline'; detail: string; overdueMs: number }
  | { kind: 'action-timeout'; detail: string; elapsedMs: number }
  | { kind: 'no-progress'; detail: string; idleMs: number };

/**
 * Evaluated in priority order: a blown deadline outranks a slow action, which
 * outranks a quiet one. The first finding is the one the runner acts on.
 */
export function inspectWatchdog(input: WatchdogInput): WatchdogSymptom {
  const { now, deadlineAt } = input;

  if (now >= deadlineAt) {
    return {
      kind: 'deadline',
      detail: `deadline passed ${formatDuration(now - deadlineAt)} ago`,
      overdueMs: now - deadlineAt,
    };
  }

  if (input.operationStartedAt !== null) {
    const elapsed = now - input.operationStartedAt;
    if (elapsed > input.operationTimeoutMs) {
      return {
        kind: 'action-timeout',
        detail: `current operation has run for ${formatDuration(elapsed)} (budget ${formatDuration(
          input.operationTimeoutMs,
        )})`,
        elapsedMs: elapsed,
      };
    }
  }

  const idle = now - input.lastProgressAt;
  if (idle > input.progressIntervalMs) {
    return {
      kind: 'no-progress',
      detail: `no verified progress for ${formatDuration(idle)} (interval ${formatDuration(
        input.progressIntervalMs,
      )})`,
      idleMs: idle,
    };
  }

  return { kind: 'ok' };
}

/** Convenience: build the input from a task record. */
export function watchdogFor(task: BrowserTask, now: number): WatchdogInput {
  return {
    now,
    operationStartedAt: task.currentOperation?.startedAt ?? null,
    operationTimeoutMs: task.currentOperation ? task.limits.actionTimeoutMs : task.limits.actionTimeoutMs,
    lastProgressAt: task.lastProgressAt,
    progressIntervalMs: task.limits.progressIntervalMs,
    deadlineAt: task.deadlineAt,
  };
}

/**
 * A task needs recovery when it is nominally running but the watchdog is not
 * satisfied. Terminal and paused tasks are never "stalled" — they are simply
 * not running.
 */
export function needsRecovery(symptom: WatchdogSymptom): boolean {
  return symptom.kind === 'action-timeout' || symptom.kind === 'no-progress';
}

export function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < 1000) return `${Math.round(abs)} ms`;
  const seconds = Math.round(abs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}
