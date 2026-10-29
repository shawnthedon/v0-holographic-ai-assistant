'use client';

/**
 * Task prioritisation for background work.
 *
 *   critical  — the operator is waiting (a send that must not feel dropped)
 *   normal    — should happen soon (sync a finished artifact)
 *   deferred  — do it when it is cheap: idle, online, and not on a dying battery
 *
 * Deferred work is the only category the governor can hold back. It uses
 * `requestIdleCallback` when the engine has it and a short timer when it does
 * not, so behaviour degrades rather than disappearing.
 */

import { getGovernor } from './governor';

export type TaskPriority = 'critical' | 'normal' | 'deferred';

export interface QueuedTask {
  id: string;
  priority: TaskPriority;
  run: () => void | Promise<void>;
  enqueuedAt: number;
}

type IdleDeadline = { didTimeout: boolean; timeRemaining: () => number };
type IdleWindow = Window & {
  requestIdleCallback?: (callback: (deadline: IdleDeadline) => void, options?: { timeout: number }) => number;
};

const queue: QueuedTask[] = [];
let draining = false;
let idleScheduled = false;

/** Run immediately (microtask) and surface failures without breaking the loop. */
function runNow(task: QueuedTask): void {
  void Promise.resolve()
    .then(task.run)
    .catch((error) => {
      console.warn('[tasks] background task failed', task.id, error);
    });
}

export function scheduleTask(task: Omit<QueuedTask, 'enqueuedAt'>): void {
  const entry: QueuedTask = { ...task, enqueuedAt: Date.now() };

  if (entry.priority === 'critical') {
    runNow(entry);
    return;
  }

  const governor = getGovernor();
  const state = governor.getState();

  if (entry.priority === 'normal' && state.online && state.profile !== 'saver') {
    runNow(entry);
    return;
  }

  // Deferred (or normal-while-offline): park it and drain when cheap.
  queue.push(entry);
  scheduleIdleDrain();
}

function scheduleIdleDrain(): void {
  if (idleScheduled || typeof window === 'undefined') return;
  idleScheduled = true;

  const drain = () => {
    idleScheduled = false;
    void drainQueue();
  };

  const idleWindow = window as IdleWindow;
  if (typeof idleWindow.requestIdleCallback === 'function') {
    idleWindow.requestIdleCallback(() => drain(), { timeout: 4000 });
  } else {
    window.setTimeout(drain, 1200);
  }
}

/**
 * Drain what the current conditions allow. `deferred` work is skipped on the
 * saver profile so a low battery does not get drained by cache warming.
 */
export async function drainQueue(force = false): Promise<number> {
  if (draining) return 0;
  draining = true;

  let ran = 0;
  try {
    const governor = getGovernor();
    const state = governor.getState();
    const allowDeferred = force || (state.profile !== 'saver' && !state.hidden);

    // Copy: a task may enqueue more work.
    for (const task of [...queue]) {
      if (task.priority === 'deferred' && !allowDeferred) continue;
      if (task.priority !== 'critical' && !state.online) continue;

      queue.splice(queue.indexOf(task), 1);
      try {
        await task.run();
        ran += 1;
      } catch (error) {
        console.warn('[tasks] queued task failed', task.id, error);
      }
    }
  } finally {
    draining = false;
  }

  if (queue.length > 0) scheduleIdleDrain();
  return ran;
}

export function pendingTasks(): number {
  return queue.length;
}

/** Held for tests / diagnostics. */
export function __peekQueue(): QueuedTask[] {
  return [...queue];
}
