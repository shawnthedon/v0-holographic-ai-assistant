'use client';

/**
 * Artifact service — the only thing the UI and the chat hook talk to.
 *
 * Responsibilities, all of them explicit rather than implied:
 *   • validate names and sizes before anything is written
 *   • hash the bytes so duplicates are detected by content, not by name
 *   • store the body inline (small text) or as a blob (large/binary)
 *   • queue remote publication durably, so "upload when the connection returns"
 *     is a real state and not a spinner
 *   • dispatch one DOM event on every mutation so open panels can refresh
 */

import { hashBytes, hashText } from './hash';
import { extractArtifacts, hasArtifacts } from './extract';
import { assertSize, describeType, extensionOf, formatBytes, languageOf, safeName } from './classify';
import {
  deleteArtifactRecord,
  deleteBlobs,
  getArtifact,
  getBlob,
  listArtifacts,
  putArtifact,
  putBlob,
  statsOf,
  sweepOrphanBlobs,
} from './storage';
import {
  ARTIFACT_KINDS,
  INLINE_LIMIT_BYTES,
  MAX_ARTIFACT_BYTES,
  ArtifactError,
  toArtifactError,
  type Artifact,
  type ArtifactDraft,
  type ArtifactFilter,
  type ArtifactKind,
  type ArtifactRemote,
  type ArtifactSource,
  type ArtifactStats,
} from './types';
import { enqueueTask, removeTask } from '@/lib/offline/queue';
import { getSyncManager } from '@/lib/offline/sync';
import { forgetCredentials, recallPassword, rememberCredentials } from '@/lib/ftp/credentials';
import type { FtpPlan, FtpTarget } from '@/lib/ftp/types';

export const ARTIFACTS_EVENT = 'nexus:artifacts';

function notify(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ARTIFACTS_EVENT));
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `art-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface CreateArtifactInput {
  name: string;
  text?: string;
  bytes?: ArrayBuffer;
  title?: string;
  kind?: ArtifactKind;
  description?: string;
  tags?: string[];
  source: ArtifactSource;
  agentId?: string;
  agentName?: string;
}

export async function createArtifact(input: CreateArtifactInput): Promise<Artifact> {
  const name = safeName(input.name);
  const type = describeType(name);

  const textValue = input.text ?? null;
  const bytesValue =
    input.bytes ??
    (textValue !== null ? new TextEncoder().encode(textValue).buffer as ArrayBuffer : null);

  if (!bytesValue) {
    throw new ArtifactError({
      code: 'empty-artifact',
      message: 'Artifact has no content',
      fix: 'Re-run the step that produced it, or paste the content into the editor.',
    });
  }

  assertSize(bytesValue.byteLength);

  const hash = textValue !== null && bytesValue.byteLength < INLINE_LIMIT_BYTES
    ? await hashText(textValue)
    : await hashBytes(bytesValue);

  // Content-addressed duplicate check: the same bytes under the same name is a
  // re-capture (agent re-ran), so the record is refreshed rather than cloned.
  const existing = await listArtifacts();
  const duplicate = existing.find((entry) => entry.name === name && entry.hash === hash);
  if (duplicate) {
    const refreshed: Artifact = { ...duplicate, updatedAt: Date.now() };
    await putArtifact(refreshed);
    notify();
    return refreshed;
  }

  const id = newId();
  const inline = bytesValue.byteLength <= INLINE_LIMIT_BYTES && textValue !== null;

  if (!inline) {
    await putBlob({ id, bytes: bytesValue, mime: input.bytes ? type.mime : 'text/plain' });
  }

  const now = Date.now();
  const artifact: Artifact = {
    id,
    name,
    title: input.title?.trim() || name,
    kind: input.kind ?? type.kind,
    mime: type.mime,
    extension: name.split('.').pop() ?? '',
    language: languageOf(name),
    sizeBytes: bytesValue.byteLength,
    text: inline ? textValue : null,
    blobId: inline ? null : id,
    hash,
    createdAt: now,
    updatedAt: now,
    source: input.source,
    agentId: input.agentId,
    agentName: input.agentName,
    description: input.description,
    tags: input.tags ?? [],
  };

  await putArtifact(artifact);
  notify();
  return artifact;
}

/**
 * Capture whatever an agent produced. Returns the artifacts it created; an
 * empty array means the answer was prose, which is the common case.
 */
export async function captureFromAgent(
  message: string,
  meta: { agentId?: string; agentName?: string } = {},
): Promise<Artifact[]> {
  if (!hasArtifacts(message)) return [];

  const drafts = extractArtifacts(message, {
    fallbackStem: (meta.agentName ?? 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  });

  const created: Artifact[] = [];
  for (const draft of drafts) {
    try {
      created.push(
        await createArtifact({
          ...draft,
          source: 'agent',
          agentId: meta.agentId,
          agentName: meta.agentName,
          tags: ['agent'],
        }),
      );
    } catch {
      // One unparseable block must not lose the others.
    }
  }
  return created;
}

export async function createFromDraft(draft: ArtifactDraft, source: ArtifactSource = 'operator'): Promise<Artifact> {
  return createArtifact({
    name: draft.name,
    text: draft.text,
    title: draft.title,
    kind: draft.kind,
    description: draft.description,
    source,
  });
}

/** Import from the file picker, size-checked before the bytes are read in anger. */
export async function importFile(file: File): Promise<Artifact> {
  if (file.size > MAX_ARTIFACT_BYTES) {
    throw new ArtifactError({
      code: 'artifact-too-large',
      message: `${file.name} is ${formatBytes(file.size)}; the store caps a single artifact at ${formatBytes(MAX_ARTIFACT_BYTES)}`,
      fix: 'Split the file, or keep it on disk and publish it with the FTP action.',
    });
  }

  const bytes = await file.arrayBuffer();
  const name = safeName(file.name);
  const isText = describeType(name).mime.startsWith('text/') || /\.(json|ya?ml|csv|md|ts|js|py|sql|xml|toml)$/i.test(name);

  return createArtifact({
    name,
    bytes,
    text: isText ? new TextDecoder().decode(bytes) : undefined,
    title: file.name,
    description: `Imported from disk (${file.type || 'unknown type'})`,
    source: 'import',
    tags: ['imported'],
  });
}

export async function readArtifactText(artifact: Artifact): Promise<string> {
  if (artifact.text !== null) return artifact.text;
  if (!artifact.blobId) return '';
  const blob = await getBlob(artifact.blobId);
  if (!blob) {
    throw new ArtifactError({
      code: 'artifact-body-missing',
      message: `${artifact.name} has no stored body`,
      fix: 'The record survived but its payload did not — re-create the artifact from the agent output.',
    });
  }
  return new TextDecoder().decode(blob.bytes);
}

export async function artifactBlob(artifact: Artifact): Promise<Blob> {
  if (artifact.text !== null) return new Blob([artifact.text], { type: artifact.mime });
  if (!artifact.blobId) throw new ArtifactError({ code: 'artifact-body-missing', message: `${artifact.name} has no stored body`, fix: 'Re-create the artifact.' });
  const stored = await getBlob(artifact.blobId);
  if (!stored) throw new ArtifactError({ code: 'artifact-body-missing', message: `${artifact.name} has no stored body`, fix: 'Re-create the artifact.' });
  return new Blob([stored.bytes], { type: artifact.mime });
}

/** Browser download. Uses an object URL, revoked immediately after the click. */
export async function downloadArtifact(artifact: Artifact): Promise<void> {
  const blob = await artifactBlob(artifact);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function deleteArtifact(id: string): Promise<void> {
  const artifact = await getArtifact(id);
  if (!artifact) return;
  if (artifact.blobId) await deleteBlobs([artifact.blobId]);
  await deleteArtifactRecord(id);
  notify();
}

export interface RenameResult {
  artifact: Artifact;
  /** Set when the rename changed something the operator should know about. */
  warning?: string;
}

/**
 * Rename an artifact in place.
 *
 * The body never moves: the hash, size and stored bytes are untouched, so a
 * rename costs one metadata write and cannot corrupt the file. Everything the
 * name implies — kind, MIME, extension, language — is re-derived, because
 * `notes.txt` renamed to `notes.csv` really is a different kind of artifact.
 *
 * A published copy is *not* renamed on the remote host (FTP has no rename in our
 * client and silently claiming otherwise would be a lie), so the remote marker
 * is cleared and a warning returned.
 */
export async function renameArtifact(id: string, nextName: string): Promise<RenameResult> {
  const artifact = await getArtifact(id);
  if (!artifact) {
    throw new ArtifactError({
      code: 'artifact-missing',
      message: 'That artifact is no longer in the archive',
      fix: 'Reload the archive — it may have been deleted in another tab.',
    });
  }

  const name = safeName(nextName, extensionOf(artifact.name) || 'txt');
  if (!name || name === artifact.name) return { artifact };

  const clash = (await listArtifacts()).find((item) => item.id !== id && item.name === name);
  if (clash) {
    throw new ArtifactError({
      code: 'artifact-name-taken',
      message: `${name} already exists in the archive`,
      fix: 'Pick a different name, or delete the existing file first.',
    });
  }

  const type = describeType(name);
  const renamedAt = Date.now();
  const updated: Artifact = {
    ...artifact,
    name,
    kind: type.kind,
    mime: type.mime,
    extension: extensionOf(name),
    language: type.language,
    // A default title tracks the file name; a custom one is left alone.
    title: artifact.title === artifact.name ? name : artifact.title,
    remote: undefined,
    updatedAt: renamedAt,
  };

  await putArtifact(updated);
  notify();

  return {
    artifact: updated,
    warning: artifact.remote
      ? `Renamed to ${name} — the copy on ${artifact.remote.host} still has the old name; publish again to replace it.`
      : undefined,
  };
}

export async function getArtifactById(id: string): Promise<Artifact | null> {
  return getArtifact(id);
}

export async function listFiltered(filter: ArtifactFilter = {}): Promise<Artifact[]> {
  const all = await listArtifacts();
  const needle = filter.query?.trim().toLowerCase() ?? '';

  return all.filter((artifact) => {
    if (filter.kind && filter.kind !== 'all' && artifact.kind !== filter.kind) return false;
    if (filter.source && filter.source !== 'all' && artifact.source !== filter.source) return false;
    if (filter.tag && !artifact.tags.includes(filter.tag)) return false;
    if (!needle) return true;
    return `${artifact.name} ${artifact.title} ${artifact.description ?? ''} ${artifact.tags.join(' ')} ${artifact.kind}`
      .toLowerCase()
      .includes(needle);
  });
}

export async function artifactStats(): Promise<ArtifactStats> {
  return statsOf(await listArtifacts());
}

export async function reclaimSpace(): Promise<number> {
  return sweepOrphanBlobs();
}

/* ------------------------------------------------------------------ */
/*  remote publication (FTP)                                          */
/* ------------------------------------------------------------------ */

export interface PublishResult {
  queued: boolean;
  remote?: ArtifactRemote;
  message: string;
}

/**
 * Upload now if we can, otherwise queue it. Either way the operator gets a
 * truthful answer about which happened.
 */
export async function publishArtifact(
  artifact: Artifact,
  target: FtpTarget,
  options: { forceQueue?: boolean } = {},
): Promise<PublishResult> {
  const plan = rememberCredentials(target);

  if (options.forceQueue || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    await enqueueTask({
      kind: 'ftp-upload',
      key: artifact.id,
      priority: 1,
      label: `Upload ${artifact.name} to ${plan.host}`,
      payload: { artifactId: artifact.id, plan },
    });
    // Publish the new pending count immediately: the strip must show the work
    // that is waiting, not only the work that is happening.
    void getSyncManager().refreshCounts();
    notify();
    return {
      queued: true,
      message: navigator.onLine
        ? `Queued: ${artifact.name} will upload to ${plan.host} as soon as sync runs.`
        : `Offline — ${artifact.name} is queued for ${plan.host} and will upload when the connection returns.`,
    };
  }

  const file = await artifactBlob(artifact);
  const base64 = await blobToBase64(file);

  const response = await fetch('/api/ftp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'upload',
      target: { ...plan, password: target.password },
      files: [{ name: artifact.name, contentBase64: base64, sizeBytes: artifact.sizeBytes }],
    }),
  });

  const data = (await response.json().catch(() => null)) as
    | { ok?: boolean; uploaded?: Array<{ name: string; bytes: number; remotePath: string }>; error?: string; code?: string; fix?: string }
    | null;

  if (!response.ok || !data?.ok) {
    const message = data?.error ?? `Upload failed (${response.status})`;
    if (response.status >= 500 && response.status !== 502) {
      // Server-side transient failure: queue rather than lose the work.
      await enqueueTask({
        kind: 'ftp-upload',
        key: artifact.id,
        priority: 1,
        label: `Upload ${artifact.name} to ${plan.host}`,
        payload: { artifactId: artifact.id, plan },
      });
      void getSyncManager().refreshCounts();
      return { queued: true, message: `${message} — queued to retry.` };
    }
    throw new ArtifactError({
      code: data?.code ?? 'ftp-upload-failed',
      message,
      fix: data?.fix ?? 'Run the connection test, then retry.',
    });
  }

  const uploaded = data.uploaded?.[0];
  const remote: ArtifactRemote = {
    host: plan.host,
    dir: plan.remoteDir,
    uploadedAt: Date.now(),
    bytes: uploaded?.bytes ?? artifact.sizeBytes,
  };

  await putArtifact({ ...artifact, remote, updatedAt: Date.now() });
  notify();
  return {
    queued: false,
    remote,
    message: `Uploaded ${artifact.name} (${formatBytes(remote.bytes)}) to ${plan.host}:${plan.remoteDir}`,
  };
}

export async function testFtpTarget(target: FtpTarget): Promise<{ dir: string }> {
  const plan = rememberCredentials(target);
  const response = await fetch('/api/ftp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'test', target: { ...plan, password: target.password } }),
  });
  const data = (await response.json().catch(() => null)) as
    | { ok?: boolean; dir?: string; error?: string; code?: string; fix?: string }
    | null;

  if (!response.ok || !data?.ok) {
    throw new ArtifactError({
      code: data?.code ?? 'ftp-test-failed',
      message: data?.error ?? `Connection test failed (${response.status})`,
      fix: data?.fix ?? 'Check the host, port and credentials.',
    });
  }
  return { dir: data.dir ?? '/' };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the artifact body'));
    reader.readAsDataURL(blob);
  });
}

/* ------------------------------------------------------------------ */
/*  sync handler                                                      */
/* ------------------------------------------------------------------ */

/**
 * Register the FTP handler with the sync manager. Called once by the offline
 * provider; idempotent at the manager level (same kind replaces the handler).
 */
export function registerArtifactSyncHandlers(): void {
  const sync = getSyncManager();

  sync.register('ftp-upload', async (task) => {
    const payload = task.payload as { artifactId: string; plan: FtpPlan };
    const artifact = await getArtifact(payload.artifactId);

    if (!artifact) {
      // The artifact was deleted while queued: drop the task, do not retry it.
      await removeTask(task.id);
      return;
    }

    const password = recallPassword(payload.plan);
    if (password === null) {
      throw new Error(
        'FTP credentials are no longer in this tab (they are never persisted to disk) — open Artifacts and upload again.',
      );
    }

    const file = await artifactBlob(artifact);
    const base64 = await blobToBase64(file);

    const response = await fetch('/api/ftp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'upload',
        target: { ...payload.plan, password },
        files: [{ name: artifact.name, contentBase64: base64, sizeBytes: artifact.sizeBytes }],
      }),
    });

    const data = (await response.json().catch(() => null)) as
      | { ok?: boolean; uploaded?: Array<{ bytes: number }>; error?: string }
      | null;

    if (!response.ok || !data?.ok) {
      throw new Error(data?.error ?? `Upload failed (${response.status})`);
    }

    const remote: ArtifactRemote = {
      host: payload.plan.host,
      dir: payload.plan.remoteDir,
      uploadedAt: Date.now(),
      bytes: data.uploaded?.[0]?.bytes ?? artifact.sizeBytes,
    };

    await putArtifact({ ...artifact, remote, updatedAt: Date.now() });
    notify();
  });
}

export { toArtifactError, ARTIFACT_KINDS, formatBytes, forgetCredentials };
