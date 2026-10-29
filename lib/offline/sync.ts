'use client';

/**
 * Background sync.
 *
 * The queue is durable (IndexedDB), so recovery does not depend on this object
 * being alive: a reload, a closed tab, a crashed renderer all leave the work on
 * disk. What the manager adds is *when* to run it — the moment the browser
 * reports it is back online, when the tab becomes visible, on a slow poll while
 * online, and on demand.
 *
 * Failure policy is explicit: a task that fails is retried with backoff up to
 * MAX_ATTEMPTS, and then parked with its error preserved so the UI can show it.
 * Nothing is silently dropped.
 */

import { listTasks, removeTask, rescheduleTask, type SyncTask, type TaskKind } from './queue';

export interface SyncState {
  online: boolean;
  running: boolean;
  pending: number;
  failed: number;
  lastSyncAt: number | null;
  lastError: string | null;
}

export type TaskHandler = (task: SyncTask) => Promise<void>;

type Listener = (state: SyncState) => void;

const POLL_MS = 30_000;

class SyncManager {
  private handlers = new Map<TaskKind, TaskHandler>();
  private listeners = new Set<Listener>();
  private timer: number | null = null;
  private started = false;
  private running = false;

  state: SyncState = {
    /*
     * Node 21+ ships a `navigator` global that has no `onLine`, so testing for
     * the object alone reported "offline" during SSR and every page load then
     * hydrated into a mismatch. Only trust a real boolean.
     */
    online: typeof navigator?.onLine === 'boolean' ? navigator.onLine : true,
    running: false,
    pending: 0,
    failed: 0,
    lastSyncAt: null,
    lastError: null,
  };

  register(kind: TaskKind, handler: TaskHandler): void {
    this.handlers.set(kind, handler);
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState(): SyncState {
    return this.state;
  }

  private emit(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  start(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;

    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisible);
    this.timer = window.setInterval(() => {
      if (this.state.online) void this.flush();
    }, POLL_MS);

    void this.refreshCounts();
    if (this.state.online) void this.flush();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
  }

  private onOnline = () => {
    this.emit({ online: true });
    void this.flush();
  };

  private onOffline = () => {
    this.emit({ online: false });
  };

  private onVisible = () => {
    if (document.visibilityState === 'visible' && this.state.online) void this.flush();
  };

  async refreshCounts(): Promise<void> {
    const tasks = await listTasks().catch(() => [] as SyncTask[]);
    this.emit({
      pending: tasks.filter((task) => task.attempts < 6).length,
      failed: tasks.filter((task) => task.attempts >= 6).length,
    });
  }

  /**
   * Run everything that is due. Critical work first; deferrable work is skipped
   * unless the caller says the app is idle and on mains power.
   */
  async flush(options: { includeDeferred?: boolean } = {}): Promise<void> {
    if (this.running || typeof window === 'undefined') return;
    if (!navigator.onLine) {
      this.emit({ online: false });
      // Offline is exactly when the queued count matters, so refresh it here
      // instead of waiting for a sync that cannot happen yet.
      await this.refreshCounts();
      return;
    }

    this.running = true;
    this.emit({ running: true });

    try {
      const tasks = await listTasks();
      const now = Date.now();

      for (const task of tasks) {
        if (task.scheduledAt > now) continue;
        if (task.attempts >= 6) continue;
        if (task.priority === 2 && !options.includeDeferred) continue;

        const handler = this.handlers.get(task.kind);
        if (!handler) continue;

        try {
          await handler(task);
          await removeTask(task.id);
          this.emit({ lastSyncAt: Date.now(), lastError: null });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'sync failed';
          await rescheduleTask(task, message);
          this.emit({ lastError: message });
        }
      }
    } finally {
      this.running = false;
      this.emit({ running: false });
      await this.refreshCounts();
    }
  }

  /** Manual retry: clear the backoff on parked tasks and try again. */
  async retryFailed(): Promise<void> {
    const tasks = await listTasks();
    for (const task of tasks) {
      if (task.attempts >= 6) {
        await rescheduleTask({ ...task, attempts: 5 }, task.lastError ?? 'retry requested');
      }
    }
    await this.flush({ includeDeferred: true });
  }
}

let manager: SyncManager | null = null;

export function getSyncManager(): SyncManager {
  if (!manager) manager = new SyncManager();
  return manager;
}
