'use client';

/**
 * Per-tab FTP credential custody.
 *
 * The password never goes into IndexedDB, the sync queue, telemetry or a log.
 * It is held in module memory and mirrored into `sessionStorage` so a reload in
 * the same tab can finish a queued upload. Closing the tab destroys it — which
 * is why a queued upload that survives the tab reports "credentials are gone"
 * instead of failing mysteriously or, worse, persisting a secret.
 */

import type { FtpPlan, FtpTarget } from './types';

const KEY_PREFIX = 'nexus.ftp.cred.';

const memory = new Map<string, string>();

function keyFor(plan: FtpPlan): string {
  return `${plan.username}@${plan.host}:${plan.port}`;
}

export function rememberCredentials(target: FtpTarget): FtpPlan {
  const { password, ...plan } = target;
  const key = keyFor(plan);
  memory.set(key, password);
  try {
    window.sessionStorage.setItem(KEY_PREFIX + key, password);
  } catch {
    /* private mode — memory only, still fine for this page's lifetime */
  }
  return plan;
}

export function recallPassword(plan: FtpPlan): string | null {
  const key = keyFor(plan);
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    const stored = window.sessionStorage.getItem(KEY_PREFIX + key);
    if (stored !== null) {
      memory.set(key, stored);
      return stored;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function forgetCredentials(plan: FtpPlan): void {
  const key = keyFor(plan);
  memory.delete(key);
  try {
    window.sessionStorage.removeItem(KEY_PREFIX + key);
  } catch {
    /* ignore */
  }
}
