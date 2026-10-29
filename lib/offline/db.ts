'use client';

/**
 * One IndexedDB database for everything that must survive a reload.
 *
 * Deliberately separate from `nexus-device-ai` (which owns multi-GB model
 * weights and its own schema): artifacts, the sync queue and the response cache
 * are small records that a different feature set reads and writes. Bumping one
 * version must never put the other's objects at risk.
 *
 * Stores
 *   artifacts  — artifact metadata, keyPath `id`
 *   blobs      — payloads too large to inline, keyPath `id`
 *   queue      — durable background work, keyPath `id`
 *   cache      — HTTP responses with TTL, keyPath `key`
 *   meta       — small bookkeeping values, keyPath `key`
 */

export const DB_NAME = 'nexus-offline';
export const DB_VERSION = 1;

export const STORE = {
  artifacts: 'artifacts',
  blobs: 'blobs',
  queue: 'queue',
  cache: 'cache',
  meta: 'meta',
} as const;

export type StoreName = (typeof STORE)[keyof typeof STORE];

let dbPromise: Promise<IDBDatabase> | null = null;

export function indexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!indexedDbAvailable()) {
      reject(new Error('IndexedDB is unavailable — private browsing can disable it.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE.artifacts)) {
        const store = db.createObjectStore(STORE.artifacts, { keyPath: 'id' });
        store.createIndex('kind', 'kind');
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('source', 'source');
      }
      if (!db.objectStoreNames.contains(STORE.blobs)) {
        db.createObjectStore(STORE.blobs, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE.queue)) {
        const store = db.createObjectStore(STORE.queue, { keyPath: 'id' });
        store.createIndex('scheduledAt', 'scheduledAt');
      }
      if (!db.objectStoreNames.contains(STORE.cache)) {
        const store = db.createObjectStore(STORE.cache, { keyPath: 'key' });
        store.createIndex('storedAt', 'storedAt');
      }
      if (!db.objectStoreNames.contains(STORE.meta)) {
        db.createObjectStore(STORE.meta, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // A second tab upgrading the schema must not deadlock this one.
      db.onversionchange = () => db.close();
      resolve(db);
    };

    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open the offline database'));
    request.onblocked = () =>
      reject(new Error('The offline database is blocked by another tab — close it and retry.'));
  });

  return dbPromise;
}

/** Run one request inside a transaction and resolve with its result. */
export async function withStore<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest | void,
): Promise<T> {
  const db = await openDb();

  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const objectStore = tx.objectStore(store);
    const request = run(objectStore);

    let settled = false;
    let value: unknown;

    if (request instanceof IDBRequest) {
      request.onsuccess = () => {
        value = request.result;
      };
      request.onerror = () => {
        if (!settled) {
          settled = true;
          reject(request.error ?? new Error('IndexedDB request failed'));
        }
      };
    }

    tx.oncomplete = () => {
      if (!settled) {
        settled = true;
        resolve(value as T);
      }
    };
    tx.onerror = () => {
      if (!settled) {
        settled = true;
        reject(tx.error ?? new Error('IndexedDB transaction failed'));
      }
    };
    tx.onabort = () => {
      if (!settled) {
        settled = true;
        reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      }
    };
  });
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  return withStore<T[]>(store, 'readonly', (objectStore) => objectStore.getAll());
}

export async function getRecord<T>(store: StoreName, key: IDBValidKey): Promise<T | null> {
  const found = await withStore<T | undefined>(store, 'readonly', (objectStore) =>
    objectStore.get(key),
  );
  return found ?? null;
}

export async function putRecord<T>(store: StoreName, value: T): Promise<void> {
  await withStore(store, 'readwrite', (objectStore) => objectStore.put(value as unknown as object));
}

export async function putRecords<T>(store: StoreName, values: T[]): Promise<void> {
  if (values.length === 0) return;
  await withStore(store, 'readwrite', (objectStore) => {
    for (const value of values) objectStore.put(value as unknown as object);
  });
}

export async function deleteRecord(store: StoreName, key: IDBValidKey): Promise<void> {
  await withStore(store, 'readwrite', (objectStore) => objectStore.delete(key));
}

export async function deleteRecords(store: StoreName, keys: IDBValidKey[]): Promise<void> {
  if (keys.length === 0) return;
  await withStore(store, 'readwrite', (objectStore) => {
    for (const key of keys) objectStore.delete(key);
  });
}

export async function countRecords(store: StoreName): Promise<number> {
  return withStore<number>(store, 'readonly', (objectStore) => objectStore.count());
}

/** TTL helpers for the `cache` store — entries carry their own expiry. */
export interface CacheRecord {
  key: string;
  body: string;
  contentType: string;
  status: number;
  storedAt: number;
  expiresAt: number;
  etag?: string;
}

export interface MetaRecord {
  key: string;
  value: unknown;
  updatedAt: number;
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const record = await getRecord<MetaRecord>(STORE.meta, key).catch(() => null);
  return record ? (record.value as T) : fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await putRecord<MetaRecord>(STORE.meta, { key, value, updatedAt: Date.now() });
}

/** Delete expired cache rows. Called on startup, not on the hot path. */
export async function pruneCache(): Promise<number> {
  const now = Date.now();
  const all = await getAll<CacheRecord>(STORE.cache).catch(() => [] as CacheRecord[]);
  const stale = all.filter((entry) => entry.expiresAt < now).map((entry) => entry.key);
  await deleteRecords(STORE.cache, stale).catch(() => undefined);
  return stale.length;
}
