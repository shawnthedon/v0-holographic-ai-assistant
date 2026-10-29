'use client';

/**
 * Durable background work.
 *
 * Every task in here is something the operator asked for that could not finish
 * — an artifact that failed to upload, a sync push deferred while offline. The
 * queue is the reason "background sync when the connection returns" is a real
 * behaviour rather than a spinner that disappears on reload: tasks are persisted
 * before they are attempted, retried with exponential backoff, and dropped only
 * when they genuinely cannot succeed.
 */

import { STORE, deleteRecord, getAll, getMeta, putRecord, setMeta } from './db';

export type TaskPriority = 0 | 1 | 2;
/** 0 = critical (user is waiting), 1 = normal, 2 = deferrable (idle only). */

export type TaskKind = 'artifact-upload' | 'artifact-push' | 'cache-warm' | 'ftp-upload';

export interface SyncTask<P = unknown> {
  id: string;
  kind: TaskKind;
  priority: TaskPriority;
  payload: P;
  createdAt: number;
  /** Earliest time this may be attempted (backoff). */
  scheduledAt: number;
  attempts: number;
  lastError?: string;
  label: string;
}

export const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/** 5s, 10s, 20s, 40s, 80s, 160s — capped, so a broken server is not hammered. */
export function backoffFor(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
}

export function taskId(kind: TaskKind, key: string): string {
  // Deterministic so re-enqueueing the same work replaces it instead of
  // stacking duplicates (which is how a queue silently triples itself).
  return `${kind}:${key}`;
}

export async function enqueueTask<P>(input: {
  kind: TaskKind;
  key: string;
  priority?: TaskPriority;
  label: string;
  payload: P;
  readyAt?: number;
}): Promise<SyncTask<P>> {
  const task: SyncTask<P> = {
    id: taskId(input.kind, input.key),
    kind: input.kind,
    priority: input.priority ?? 1,
    payload: input.payload,
    createdAt: Date.now(),
    scheduledAt: input.readyAt ?? Date.now(),
    attempts: 0,
    label: input.label,
  };

  const existing = await getMeta<number | null>(`queue-rev`, null);
  await putRecord(STORE.queue, task);
  await setMeta('queue-rev', (existing ?? 0) + 1);
  return task;
}

export async function listTasks(): Promise<SyncTask[]> {
  const tasks = await getAll<SyncTask>(STORE.queue).catch(() => [] as SyncTask[]);
  return tasks.sort(
    (a, b) => a.priority - b.priority || a.scheduledAt - b.scheduledAt || a.createdAt - b.createdAt,
  );
}

export async function removeTask(id: string): Promise<void> {
  await deleteRecord(STORE.queue, id);
}

/** Record a failed attempt and push the next one back. */
export async function rescheduleTask(task: SyncTask, error: string): Promise<SyncTask | null> {
  const attempts = task.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    // Kept, but parked far in the future: the operator can see what failed and
    // retry manually instead of the task vanishing without explanation.
    const parked: SyncTask = {
      ...task,
      attempts,
      lastError: error,
      scheduledAt: Date.now() + MAX_BACKOFF_MS,
    };
    await putRecord(STORE.queue, parked);
    return null;
  }

  const next: SyncTask = {
    ...task,
    attempts,
    lastError: error,
    scheduledAt: Date.now() + backoffFor(attempts),
  };
  await putRecord(STORE.queue, next);
  return next;
}

export async function taskCount(): Promise<number> {
  return (await listTasks()).length;
}

export async function clearTasks(): Promise<void> {
  const tasks = await listTasks();
  for (const task of tasks) await removeTask(task.id);
}
