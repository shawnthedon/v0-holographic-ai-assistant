'use client';

/**
 * Persistent storage for on-device models.
 *
 * Two layers, deliberately separate (spec §5):
 *   • OPFS (origin-private file system) holds the *weights* — gigabytes, streamed
 *     to disk, never held in JS memory, never in localStorage.
 *   • IndexedDB holds *metadata and job state* — small, queryable, survives reload.
 *
 * Everything degrades to a typed error rather than a silent fallback: a browser
 * without OPFS reports `unsupported-platform`, it does not pretend to install.
 */

import { DeviceAiError, type DownloadJob, type LocalModel } from './types';

const DB_NAME = 'nexus-device-ai';
const DB_VERSION = 1;
const MODELS_STORE = 'models';
const JOBS_STORE = 'jobs';
const ROOT_DIR = 'device-ai';
const MODELS_DIR = 'models';
const PARTIAL_DIR = 'partials';

/* ------------------------------- OPFS ------------------------------- */

interface DirLike {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  keys?(): AsyncIterable<string>;
}

interface FileHandleLike {
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<WritableLike>;
}

interface WritableLike {
  write(data: BufferSource | Blob | string | { type: 'write'; position?: number; data: BufferSource | Blob | string }): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export function opfsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

async function dir(...segments: string[]): Promise<DirLike> {
  if (!opfsSupported()) {
    throw new DeviceAiError({
      code: 'unsupported-platform',
      message: 'This browser has no origin-private file storage (OPFS)',
      fix: 'Use a Chromium-based browser (Chrome/Edge 108+), or a Safari/Firefox build with OPFS enabled. Without it, multi-GB model files cannot be stored on device.',
    });
  }
  let handle = (await navigator.storage.getDirectory()) as unknown as DirLike;
  for (const segment of [ROOT_DIR, ...segments]) {
    handle = await handle.getDirectoryHandle(segment, { create: true });
  }
  return handle;
}

/** Sanitises a model id into a safe, single-segment file name (spec §5). */
export function safeFileName(id: string): string {
  const cleaned = id
    .toLowerCase()
    // separators first, so `a/../b` can never fold into a traversal segment
    .replace(/[\\/]+/g, '-')
    .replace(/[^a-z0-9._-]+/g, '-')
    // collapse runs of dots: `..` has no meaning inside a single file name
    .replace(/\.{2,}/g, '.')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 96);
  if (!cleaned || cleaned === '.' || cleaned === '..' || cleaned.includes('/')) {
    throw new DeviceAiError({
      code: 'invalid-file',
      message: `Refusing unsafe file name for model id "${id}"`,
      fix: 'Model ids are sanitised to [a-z0-9._-]; rename the source file.',
    });
  }
  return `${cleaned}.gguf`;
}

export async function writeModelFile(id: string, blob: Blob): Promise<{ bytes: number; fileName: string }> {
  const fileName = safeFileName(id);
  const folder = await dir(MODELS_DIR);
  const handle = (await folder.getFileHandle(fileName, { create: true })) as unknown as FileHandleLike;
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
  return { bytes: blob.size, fileName };
}

export async function readModelFile(id: string): Promise<File | null> {
  const fileName = safeFileName(id);
  const folder = await dir(MODELS_DIR);
  try {
    const handle = (await folder.getFileHandle(fileName)) as unknown as FileHandleLike;
    return await handle.getFile();
  } catch {
    return null;
  }
}

export async function modelFileSize(id: string): Promise<number> {
  const file = await readModelFile(id);
  return file?.size ?? -1;
}

export async function deleteModelFile(id: string): Promise<void> {
  const fileName = safeFileName(id);
  const folder = await dir(MODELS_DIR);
  try {
    await folder.removeEntry(fileName);
  } catch {
    /* already gone — deletion of a missing model is not a failure */
  }
  await deletePartial(id);
}

/* --------------------------- partial files --------------------------- */

export async function partialSize(id: string): Promise<number> {
  const fileName = `${safeFileName(id)}.partial`;
  const folder = await dir(PARTIAL_DIR);
  try {
    const handle = (await folder.getFileHandle(fileName)) as unknown as FileHandleLike;
    const file = await handle.getFile();
    return file.size;
  } catch {
    return 0;
  }
}

export async function readPartialFile(id: string): Promise<File | null> {
  const fileName = `${safeFileName(id)}.partial`;
  const folder = await dir(PARTIAL_DIR);
  try {
    const handle = (await folder.getFileHandle(fileName)) as unknown as FileHandleLike;
    return await handle.getFile();
  } catch {
    return null;
  }
}

export async function deletePartial(id: string): Promise<void> {
  const fileName = `${safeFileName(id)}.partial`;
  const folder = await dir(PARTIAL_DIR);
  try {
    await folder.removeEntry(fileName);
  } catch {
    /* nothing to clean up */
  }
}

/**
 * Opens an appendable handle on the partial file so a download can be streamed
 * to disk chunk by chunk (never buffered whole in memory).
 */
export async function openPartialWriter(
  id: string,
  options: { resumeFrom?: number } = {},
): Promise<{ write: (chunk: Uint8Array) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void>; written: () => number }> {
  const fileName = `${safeFileName(id)}.partial`;
  const folder = await dir(PARTIAL_DIR);

  if (!options.resumeFrom) await deletePartial(id);

  const handle = (await folder.getFileHandle(fileName, { create: true })) as unknown as FileHandleLike;
  const writable = (await handle.createWritable({
    keepExistingData: Boolean(options.resumeFrom),
  })) as unknown as WritableLike & { seek?: (offset: number) => Promise<void> };

  if (options.resumeFrom && typeof writable.seek === 'function') {
    await writable.seek(options.resumeFrom);
  }

  let written = options.resumeFrom ?? 0;
  return {
    write: async (chunk) => {
      await writable.write(chunk as unknown as BufferSource);
      written += chunk.byteLength;
    },
    close: async () => {
      await writable.close();
    },
    abort: async () => {
      try {
        await writable.abort?.();
      } catch {
        /* the browser may already have torn the stream down */
      }
    },
    written: () => written,
  };
}

/** Promotes a completed partial file to an installed model file, atomically. */
export async function promotePartial(id: string): Promise<{ bytes: number; fileName: string }> {
  const partialName = `${safeFileName(id)}.partial`;
  const finalName = safeFileName(id);
  const partialFolder = await dir(PARTIAL_DIR);
  const modelsFolder = await dir(MODELS_DIR);

  const partialHandle = (await partialFolder.getFileHandle(partialName)) as unknown as FileHandleLike;
  const file = await partialHandle.getFile();

  const finalHandle = (await modelsFolder.getFileHandle(finalName, { create: true })) as unknown as FileHandleLike;
  const writable = await finalHandle.createWritable();
  try {
    await writable.write(file);
  } finally {
    await writable.close();
  }

  await partialFolder.removeEntry(partialName);
  return { bytes: file.size, fileName: finalName };
}

/* ---------------------------- IndexedDB ----------------------------- */

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(
        new DeviceAiError({
          code: 'unsupported-platform',
          message: 'IndexedDB is unavailable in this context',
          fix: 'Private-browsing modes can disable IndexedDB. Open the console in a normal window.',
        }),
      );
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MODELS_STORE)) db.createObjectStore(MODELS_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(JOBS_STORE)) db.createObjectStore(JOBS_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new DeviceAiError({
          code: 'unsupported-platform',
          message: `Could not open the local metadata store: ${request.error?.message ?? 'unknown'}`,
          fix: 'Clear site data for this origin and reload.',
        }),
      );
  });
}

async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = tx.objectStore(store);
      const result = run(request);
      if (result instanceof IDBRequest) {
        result.onsuccess = () => resolve(result.result as T);
        result.onerror = () => reject(result.error);
      } else {
        void Promise.resolve(result).then(resolve, reject);
      }
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function listModels(): Promise<LocalModel[]> {
  const all = await withStore<LocalModel[]>(MODELS_STORE, 'readonly', (store) => store.getAll());
  return all.sort((a, b) => (b.installedAt ?? 0) - (a.installedAt ?? 0));
}

export async function getModel(id: string): Promise<LocalModel | null> {
  const found = await withStore<LocalModel | undefined>(MODELS_STORE, 'readonly', (store) => store.get(id));
  return found ?? null;
}

export async function putModel(model: LocalModel): Promise<void> {
  await withStore(MODELS_STORE, 'readwrite', (store) => store.put(model));
}

export async function patchModel(id: string, patch: Partial<LocalModel>): Promise<LocalModel | null> {
  const existing = await getModel(id);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  await putModel(next);
  return next;
}

export async function removeModel(id: string): Promise<void> {
  await withStore(MODELS_STORE, 'readwrite', (store) => store.delete(id));
}

export async function listJobs(): Promise<DownloadJob[]> {
  const all = await withStore<DownloadJob[]>(JOBS_STORE, 'readonly', (store) => store.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function putJob(job: DownloadJob): Promise<void> {
  await withStore(JOBS_STORE, 'readwrite', (store) => store.put(job));
}

export async function removeJob(id: string): Promise<void> {
  await withStore(JOBS_STORE, 'readwrite', (store) => store.delete(id));
}

/* --------------------------- storage estimate --------------------------- */

export async function storageInfo(): Promise<{
  quotaBytes: number;
  usageBytes: number;
  availableBytes: number;
  persisted: boolean;
}> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { quotaBytes: 0, usageBytes: 0, availableBytes: 0, persisted: false };
  }
  const estimate = await navigator.storage.estimate().catch(() => ({ quota: 0, usage: 0 }));
  const quotaBytes = estimate.quota ?? 0;
  const usageBytes = estimate.usage ?? 0;
  const persisted = (await navigator.storage.persisted?.().catch(() => false)) ?? false;
  return {
    quotaBytes,
    usageBytes,
    availableBytes: Math.max(0, quotaBytes - usageBytes),
    persisted,
  };
}

/**
 * Asks the browser to keep model files when space gets tight. Best-effort: the
 * UI reports the real result rather than assuming it was granted.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist().catch(() => false);
}
