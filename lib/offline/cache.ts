'use client';

/**
 * Response cache for GET endpoints.
 *
 * Goal: the console must render its catalogue and settings from disk when the
 * network is gone, without shipping a second state layer. Rules:
 *
 *   • network-first — a live answer always wins while online
 *   • on success the body is persisted with a TTL
 *   • on failure the cached body is served, flagged `stale`, and the caller
 *     decides whether to surface that (the UI marks it, it never lies)
 *
 * POST is never cached. Chat prompts and replies are deliberately excluded from
 * every cache on purpose — they are not "app data".
 */

import { STORE, getRecord, putRecord, deleteRecord, type CacheRecord } from './db';

export const DEFAULT_TTL_MS = 10 * 60_000;

export interface CachedResult<T> {
  data: T;
  /** true when the network failed and this came off disk */
  stale: boolean;
  storedAt: number;
}

export class OfflineError extends Error {
  readonly code = 'offline-no-cache';
  readonly fix: string;

  constructor(url: string) {
    super(`No network and no cached copy of ${url}`);
    this.name = 'OfflineError';
    this.fix = 'Reconnect once so the console can cache this data, or retry when the connection returns.';
  }
}

export async function readCache<T>(key: string): Promise<{ data: T; storedAt: number } | null> {
  const record = await getRecord<CacheRecord>(STORE.cache, key).catch(() => null);
  if (!record) return null;
  try {
    return { data: JSON.parse(record.body) as T, storedAt: record.storedAt };
  } catch {
    return null;
  }
}

export async function writeCache(key: string, data: unknown, ttlMs = DEFAULT_TTL_MS): Promise<void> {
  const now = Date.now();
  const record: CacheRecord = {
    key,
    body: JSON.stringify(data),
    contentType: 'application/json',
    status: 200,
    storedAt: now,
    expiresAt: now + ttlMs,
  };
  await putRecord(STORE.cache, record).catch(() => undefined);
}

export async function invalidateCache(key: string): Promise<void> {
  await deleteRecord(STORE.cache, key).catch(() => undefined);
}

/**
 * Fetch JSON with a persisted fallback.
 *
 * `staleOk` (default true) lets an expired entry be served when the network is
 * down — better an old model list than an empty screen, provided the UI says so.
 */
export async function cachedJson<T>(
  url: string,
  options: { ttlMs?: number; signal?: AbortSignal; staleOk?: boolean } = {},
): Promise<CachedResult<T>> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const key = `GET ${url}`;
  const offline = typeof navigator !== 'undefined' && !navigator.onLine;

  if (offline) {
    const cached = await readCache<T>(key);
    if (cached && options.staleOk !== false) {
      return { data: cached.data, stale: true, storedAt: cached.storedAt };
    }
    throw new OfflineError(url);
  }

  try {
    const response = await fetch(url, { cache: 'no-store', signal: options.signal });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const data = (await response.json()) as T;
    await writeCache(key, data, ttlMs);
    return { data, stale: false, storedAt: Date.now() };
  } catch (error) {
    const cached = await readCache<T>(key);
    if (cached && options.staleOk !== false) {
      return { data: cached.data, stale: true, storedAt: cached.storedAt };
    }
    throw error;
  }
}
