/**
 * Durable task store.
 *
 * A long task that only exists in memory dies with the process. Every state
 * change, checkpoint and piece of evidence is written here so a restart can pick
 * the task up and *inspect* it before continuing (AT-24).
 *
 * If the filesystem is not writable — a read-only serverless bundle, for example
 * — the store degrades to memory and reports `durable: false`. The UI shows that
 * honestly instead of promising a resume it cannot perform.
 */

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { BrowserTask } from './types';

export interface BrowserTaskStore {
  readonly durable: boolean;
  readonly location: string;
  save(task: BrowserTask): Promise<void>;
  load(id: string): Promise<BrowserTask | null>;
  list(): Promise<BrowserTask[]>;
  remove(id: string): Promise<void>;
  saveScreenshot(taskId: string, screenshotId: string, base64: string): Promise<void>;
  loadScreenshot(taskId: string, screenshotId: string): Promise<string | null>;
}

export class FileTaskStore implements BrowserTaskStore {
  readonly durable = true;
  readonly location: string;

  constructor(directory = process.env.BROWSER_TASK_DIR ?? defaultDirectory()) {
    this.location = directory;
  }

  private ensure(): void {
    mkdirSync(join(this.location, 'tasks'), { recursive: true });
    mkdirSync(join(this.location, 'shots'), { recursive: true });
  }

  async save(task: BrowserTask): Promise<void> {
    this.ensure();
    const file = join(this.location, 'tasks', `${task.id}.json`);
    const temporary = `${file}.tmp`;
    // Write-then-rename: a crash mid-write must not leave a truncated task that
    // the restore path would then refuse to load.
    writeFileSync(temporary, JSON.stringify(task), 'utf8');
    renameSync(temporary, file);
  }

  async load(id: string): Promise<BrowserTask | null> {
    try {
      const raw = readFileSync(join(this.location, 'tasks', `${id}.json`), 'utf8');
      return JSON.parse(raw) as BrowserTask;
    } catch {
      return null;
    }
  }

  async list(): Promise<BrowserTask[]> {
    try {
      this.ensure();
      const files = readdirSync(join(this.location, 'tasks')).filter((name) => name.endsWith('.json'));
      const tasks: BrowserTask[] = [];
      for (const file of files) {
        try {
          tasks.push(JSON.parse(readFileSync(join(this.location, 'tasks', file), 'utf8')) as BrowserTask);
        } catch {
          /* skip a corrupt file rather than failing the whole listing */
        }
      }
      return tasks.sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  }

  async remove(id: string): Promise<void> {
    try {
      rmSync(join(this.location, 'tasks', `${id}.json`), { force: true });
    } catch {
      /* nothing to remove */
    }
  }

  async saveScreenshot(taskId: string, screenshotId: string, base64: string): Promise<void> {
    this.ensure();
    writeFileSync(join(this.location, 'shots', `${taskId}-${screenshotId}.png`), Buffer.from(base64, 'base64'));
  }

  async loadScreenshot(taskId: string, screenshotId: string): Promise<string | null> {
    try {
      return readFileSync(join(this.location, 'shots', `${taskId}-${screenshotId}.png`)).toString('base64');
    } catch {
      return null;
    }
  }
}

export class MemoryTaskStore implements BrowserTaskStore {
  readonly durable = false;
  readonly location = 'memory';
  private tasks = new Map<string, BrowserTask>();
  private shots = new Map<string, string>();

  async save(task: BrowserTask): Promise<void> {
    this.tasks.set(task.id, JSON.parse(JSON.stringify(task)) as BrowserTask);
  }
  async load(id: string): Promise<BrowserTask | null> {
    const found = this.tasks.get(id);
    return found ? (JSON.parse(JSON.stringify(found)) as BrowserTask) : null;
  }
  async list(): Promise<BrowserTask[]> {
    return [...this.tasks.values()]
      .map((task) => JSON.parse(JSON.stringify(task)) as BrowserTask)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  async remove(id: string): Promise<void> {
    this.tasks.delete(id);
  }
  async saveScreenshot(taskId: string, screenshotId: string, base64: string): Promise<void> {
    this.shots.set(`${taskId}-${screenshotId}`, base64);
  }
  async loadScreenshot(taskId: string, screenshotId: string): Promise<string | null> {
    return this.shots.get(`${taskId}-${screenshotId}`) ?? null;
  }
}

function defaultDirectory(): string {
  // Serverless hosts mount a read-only app directory; /tmp is the only writable
  // place there, and it is ephemeral — which is why `durable` is reported.
  if (process.env.VERCEL) return join(tmpdir(), 'nexus-browser');
  return join(process.cwd(), '.nexus', 'browser');
}

/** Pick the best store this runtime allows, and say which one it is. */
export function createTaskStore(): BrowserTaskStore {
  const candidate = new FileTaskStore();
  try {
    mkdirSync(join(candidate.location, 'tasks'), { recursive: true });
    writeFileSync(join(candidate.location, '.probe'), 'ok');
    rmSync(join(candidate.location, '.probe'), { force: true });
    return candidate;
  } catch {
    return new MemoryTaskStore();
  }
}
