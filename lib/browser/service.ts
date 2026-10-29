/**
 * Browser task service — the process-wide registry.
 *
 * Responsibilities:
 *  • own the runners (one per task) and the durable store;
 *  • start, pause, resume, cancel and inspect;
 *  • rehydrate tasks after a restart and tell them to inspect before continuing.
 *
 * It reports the engine's real availability, so a runtime without a browser says
 * so instead of queueing work it can never do.
 */

import { PuppeteerEngine } from './puppeteer-engine';
import type { BrowserEngine } from './engine';
import { createTaskStore, type BrowserTaskStore } from './store';
import { BrowserTaskRunner, createTask, validateSpec } from './task';
import {
  activityOf,
  isTerminal,
  toBrowserError,
  type BrowserTask,
  type BrowserTaskSpec,
  type BrowserTaskView,
} from './types';

interface Registry {
  runners: Map<string, BrowserTaskRunner>;
  store: BrowserTaskStore;
  engine: BrowserEngine;
  restored: boolean;
  availability: BrowserTaskView['engine'] | null;
}

const GLOBAL_KEY = '__nexus_browser_service__';

function registry(): Registry {
  const holder = globalThis as unknown as Record<string, Registry | undefined>;
  if (!holder[GLOBAL_KEY]) {
    holder[GLOBAL_KEY] = {
      runners: new Map(),
      store: createTaskStore(),
      engine: new PuppeteerEngine(),
      restored: false,
      availability: null,
    };
  }
  return holder[GLOBAL_KEY]!;
}

export class BrowserService {
  private get state(): Registry {
    return registry();
  }

  get durable(): boolean {
    return this.state.store.durable;
  }

  get storeLocation(): string {
    return this.state.store.location;
  }

  async engineStatus(): Promise<BrowserTaskView['engine']> {
    if (this.state.availability) return this.state.availability;
    const status = await this.state.engine.availability();
    this.state.availability = { ...status };
    return this.state.availability;
  }

  /**
   * Rehydrate every unfinished task exactly once per process.
   *
   * A task that was RUNNING when the process died comes back as RECOVERING and
   * inspects the checkpointed page before repeating anything (AT-24). PAUSED and
   * WAITING_FOR_USER tasks are left for the operator.
   */
  async restore(): Promise<number> {
    if (this.state.restored) return 0;
    this.state.restored = true;

    const tasks = await this.state.store.list();
    let resumed = 0;

    for (const task of tasks) {
      if (isTerminal(task.state)) continue;

      const restored: BrowserTask = {
        ...task,
        restoredAt: Date.now(),
        state: task.state === 'PAUSED' || task.state === 'WAITING_FOR_USER' ? task.state : 'RECOVERING',
        stateReason:
          task.state === 'PAUSED' || task.state === 'WAITING_FOR_USER'
            ? task.stateReason
            : 'restored after a restart — inspecting the checkpoint before continuing',
        currentOperation: null,
      };

      const runner = this.runnerFor(restored, task);
      if (restored.state === 'RECOVERING') {
        void runner.resume();
        resumed += 1;
      }
    }

    return resumed;
  }

  private runnerFor(task: BrowserTask, previous?: BrowserTask): BrowserTaskRunner {
    const existing = this.state.runners.get(task.id);
    if (existing) return existing;

    const runner = new BrowserTaskRunner(task, {
      engine: this.state.engine,
      store: this.state.store,
      downloadsDir: `${this.state.store.location}/downloads`,
      onUpdate: (next) => {
        // Keep the map entry pointing at the task the runner is mutating.
        void next;
      },
    });
    void previous;
    this.state.runners.set(task.id, runner);
    return runner;
  }

  async create(spec: BrowserTaskSpec): Promise<BrowserTask> {
    validateSpec(spec);
    const task = createTask(spec);

    const status = await this.engineStatus();
    if (!status.available) {
      task.state = 'BLOCKED';
      task.stateReason = status.reason ?? 'no browser is available in this runtime';
      task.blocker = {
        code: 'browser-unavailable',
        message: status.reason ?? 'no browser is available in this runtime',
        fix: status.fix ?? 'Install a Chromium build, or point BROWSER_WS_ENDPOINT at a browser service.',
      };
      task.finishedAt = Date.now();
      task.outcome = `Blocked: ${task.blocker.message}`;
      await this.state.store.save(task);
      return task;
    }

    task.state = 'QUEUED';
    task.stateReason = 'queued';
    await this.state.store.save(task);

    const runner = this.runnerFor(task);
    // Fire and forget: the API returns a task the panel can watch immediately.
    void runner.run();

    return task;
  }

  async get(id: string): Promise<BrowserTask | null> {
    const runner = this.state.runners.get(id);
    if (runner) return runner.snapshot;

    const stored = await this.state.store.load(id);
    if (stored && !isTerminal(stored.state)) {
      /*
       * A non-terminal task with no runner in this process is a zombie: the
       * process that owned it is gone. Reporting it as RUNNING would be a lie, so
       * restoring wins — the task comes back as RECOVERING and inspects its
       * checkpoint before doing anything.
       */
      await this.ensureRestored();
      const restored = this.state.runners.get(id);
      if (restored) return restored.snapshot;
      return (await this.state.store.load(id)) ?? stored;
    }
    return stored;
  }

  async list(): Promise<BrowserTask[]> {
    const stored = await this.state.store.list();
    const merged = new Map(stored.map((task) => [task.id, task]));
    for (const [id, runner] of this.state.runners) merged.set(id, runner.snapshot);
    return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  async view(id: string): Promise<BrowserTaskView | null> {
    const task = await this.get(id);
    if (!task) return null;
    return this.toView(task);
  }

  async toView(task: BrowserTask): Promise<BrowserTaskView> {
    const now = Date.now();
    return {
      task,
      activity: activityOf(task, now),
      msSinceProgress: Math.max(0, now - task.lastProgressAt),
      msRemaining: task.deadlineAt - now,
      engine: await this.engineStatus(),
      durable: this.durable,
    };
  }

  async listViews(): Promise<BrowserTaskView[]> {
    await this.ensureRestored();
    const tasks = await this.list();
    const engine = await this.engineStatus();
    const now = Date.now();
    return tasks.map((task) => ({
      task,
      activity: activityOf(task, now),
      msSinceProgress: Math.max(0, now - task.lastProgressAt),
      msRemaining: task.deadlineAt - now,
      engine,
      durable: this.durable,
    }));
  }

  private async ensureRestored(): Promise<void> {
    if (this.state.restored) return;
    await this.restore();
  }

  async pause(id: string): Promise<BrowserTask | null> {
    const runner = this.state.runners.get(id);
    if (runner) {
      await runner.pause();
      return runner.snapshot;
    }
    const stored = await this.state.store.load(id);
    if (!stored || isTerminal(stored.state)) return stored;
    const paused: BrowserTask = { ...stored, state: 'PAUSED', stateReason: 'paused by operator', updatedAt: Date.now() };
    await this.state.store.save(paused);
    return paused;
  }

  async resume(id: string): Promise<BrowserTask | null> {
    await this.ensureRestored();
    const existing = this.state.runners.get(id);
    if (existing) {
      await existing.resume();
      return existing.snapshot;
    }
    const stored = await this.state.store.load(id);
    if (!stored || isTerminal(stored.state)) return stored;

    const status = await this.engineStatus();
    if (!status.available) {
      const blocked: BrowserTask = {
        ...stored,
        state: 'BLOCKED',
        stateReason: status.reason ?? 'no browser is available',
        blocker: {
          code: 'browser-unavailable',
          message: status.reason ?? 'no browser is available',
          fix: status.fix ?? 'Install a Chromium build.',
        },
        finishedAt: Date.now(),
      };
      await this.state.store.save(blocked);
      return blocked;
    }

    const restored: BrowserTask = { ...stored, restoredAt: Date.now(), state: 'RECOVERING' };
    const runner = this.runnerFor(restored);
    void runner.resume();
    return runner.snapshot;
  }

  async cancel(id: string): Promise<BrowserTask | null> {
    const runner = this.state.runners.get(id);
    if (runner) {
      await runner.cancel();
      return runner.snapshot;
    }
    const stored = await this.state.store.load(id);
    if (!stored) return null;
    if (isTerminal(stored.state)) return stored;
    const cancelled: BrowserTask = {
      ...stored,
      state: 'CANCELLED',
      stateReason: 'cancelled by operator',
      finishedAt: Date.now(),
      outcome: 'Cancelled by operator',
      updatedAt: Date.now(),
    };
    await this.state.store.save(cancelled);
    return cancelled;
  }

  async inspect(id: string): Promise<BrowserTask | null> {
    const runner = this.state.runners.get(id);
    if (!runner) return this.get(id);
    return runner.inspect();
  }

  async screenshot(id: string, screenshotId: string): Promise<string | null> {
    return this.state.store.loadScreenshot(id, screenshotId);
  }

  /** Errors from the service surface as `{ code, message, fix }`, like every other route. */
  static toError(error: unknown): { code: string; message: string; fix: string } {
    return toBrowserError(error);
  }
}

export function getBrowserService(): BrowserService {
  return new BrowserService();
}
