'use client';

/**
 * SHA-256 of artifact bytes.
 *
 * Hashing a few hundred KB is fine on the main thread; hashing a 20 MB export
 * is not — it blocks paint for hundreds of milliseconds. Large bodies are handed
 * to a worker (`public/workers/artifact.worker.js`) and fall back to the main
 * thread when workers are unavailable (old browsers, some embedded webviews).
 *
 * The digest is what makes duplicate detection cheap and what lets an FTP push
 * be verified end to end: the remote copy must hash the same.
 */

let worker: Worker | null = null;
let workerBroken = false;
let sequence = 0;
const pending = new Map<number, { resolve: (value: string) => void; reject: (error: Error) => void }>();

/** Above this, offload. Below it the message round trip costs more than the work. */
const WORKER_THRESHOLD_BYTES = 64 * 1024;

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined' || workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker('/workers/artifact.worker.js');
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as { id?: number; hash?: string; error?: string };
      if (typeof data?.id !== 'number') return;
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if (data.error) entry.reject(new Error(data.error));
      else entry.resolve(String(data.hash ?? ''));
    };
    worker.onerror = () => {
      // A worker that fails to load must not take the feature with it.
      workerBroken = true;
      worker?.terminate();
      worker = null;
      for (const [, entry] of pending) entry.reject(new Error('artifact worker failed'));
      pending.clear();
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

async function hashOnMainThread(bytes: ArrayBuffer): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    // No SubtleCrypto (insecure context): a deterministic non-crypto digest is
    // still useful for de-duplication, but it must be labelled as such.
    return `fnv1a:${fnv1a(new Uint8Array(bytes))}`;
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fnv1a(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function hashBytes(bytes: ArrayBuffer): Promise<string> {
  if (bytes.byteLength < WORKER_THRESHOLD_BYTES) return hashOnMainThread(bytes);

  const instance = getWorker();
  if (!instance) return hashOnMainThread(bytes);

  sequence += 1;
  const id = sequence;
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // Copy into a transferable buffer: the caller keeps its own view.
    instance.postMessage({ id, bytes }, [bytes.slice(0)]);
    window.setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      // Timed out — fall back rather than hang the artifact forever.
      void hashOnMainThread(bytes).then(resolve).catch(reject);
    }, 8000);
  });
}

export function hashText(text: string): Promise<string> {
  return hashBytes(new TextEncoder().encode(text).buffer as ArrayBuffer);
}
