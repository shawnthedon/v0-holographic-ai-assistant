'use client';

/**
 * Artifact persistence.
 *
 * Metadata lives in the `artifacts` store; bodies are either inline (small text,
 * so a preview renders without a second read) or in the `blobs` store (anything
 * large or binary). Deleting an artifact deletes its blob in the same pass — an
 * orphaned 20 MB blob is exactly the kind of leak that ends with a full origin
 * quota and a model download that cannot complete.
 */

import {
  STORE,
  deleteRecord,
  deleteRecords,
  getAll,
  getRecord,
  putRecord,
} from '@/lib/offline/db';
import { ARTIFACT_KINDS, type Artifact, type ArtifactBlob, type ArtifactKind, type ArtifactStats } from './types';

export async function putArtifact(artifact: Artifact): Promise<void> {
  await putRecord(STORE.artifacts, artifact);
}

export async function getArtifact(id: string): Promise<Artifact | null> {
  return getRecord<Artifact>(STORE.artifacts, id);
}

export async function listArtifacts(): Promise<Artifact[]> {
  const rows = await getAll<Artifact>(STORE.artifacts).catch(() => [] as Artifact[]);
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteArtifactRecord(id: string): Promise<void> {
  await deleteRecord(STORE.artifacts, id);
}

export async function putBlob(blob: ArtifactBlob): Promise<void> {
  await putRecord(STORE.blobs, blob);
}

export async function getBlob(id: string): Promise<ArtifactBlob | null> {
  return getRecord<ArtifactBlob>(STORE.blobs, id);
}

export async function deleteBlobs(ids: string[]): Promise<void> {
  await deleteRecords(STORE.blobs, ids);
}

export async function listBlobs(): Promise<ArtifactBlob[]> {
  return getAll<ArtifactBlob>(STORE.blobs).catch(() => [] as ArtifactBlob[]);
}

export function emptyStats(): ArtifactStats {
  const byKind = Object.fromEntries(ARTIFACT_KINDS.map((kind) => [kind, 0])) as Record<
    ArtifactKind,
    number
  >;
  return { total: 0, bytes: 0, byKind, pendingSync: 0 };
}

export function statsOf(artifacts: Artifact[]): ArtifactStats {
  const stats = emptyStats();
  for (const artifact of artifacts) {
    stats.total += 1;
    stats.bytes += artifact.sizeBytes;
    stats.byKind[artifact.kind] += 1;
    if (!artifact.remote) stats.pendingSync += 1;
  }
  return stats;
}

/** Reclaim: drop blobs that no artifact points at (interrupted writes). */
export async function sweepOrphanBlobs(): Promise<number> {
  const [artifacts, blobs] = await Promise.all([listArtifacts(), listBlobs()]);
  const referenced = new Set(artifacts.map((artifact) => artifact.blobId).filter(Boolean) as string[]);
  const orphans = blobs.filter((blob) => !referenced.has(blob.id)).map((blob) => blob.id);
  if (orphans.length) await deleteBlobs(orphans);
  return orphans.length;
}
