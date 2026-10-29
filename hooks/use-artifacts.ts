'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ARTIFACTS_EVENT,
  artifactBlob,
  captureFromAgent,
  createArtifact,
  downloadArtifact,
  deleteArtifact,
  getArtifactById,
  importFile,
  listFiltered,
  publishArtifact,
  readArtifactText,
  reclaimSpace,
  renameArtifact,
  testFtpTarget,
  artifactStats,
} from '@/lib/artifacts/service';
import { toArtifactError, type Artifact, type ArtifactFilter, type ArtifactStats } from '@/lib/artifacts/types';
import { formatBytes } from '@/lib/artifacts/classify';
import type { FtpTarget } from '@/lib/ftp/types';

export interface ArtifactActionState {
  busy: string | null;
  error: { code: string; message: string; fix: string } | null;
  notice: string | null;
}

/**
 * React binding over the artifact service.
 *
 * The list is always re-read from IndexedDB after a mutation — the UI shows
 * what is persisted, not what we hoped persisted. A single DOM event
 * (`nexus:artifacts`) keeps every open panel in sync, including the one in
 * another tab component.
 */
export function useArtifacts(initialFilter: ArtifactFilter = {}) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [stats, setStats] = useState<ArtifactStats | null>(null);
  const [filter, setFilter] = useState<ArtifactFilter>(initialFilter);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<ArtifactActionState>({ busy: null, error: null, notice: null });

  const refresh = useCallback(async () => {
    try {
      const [next, nextStats] = await Promise.all([listFiltered(filter), artifactStats()]);
      setArtifacts(next);
      setStats(nextStats);
    } catch (error) {
      setState((current) => ({ ...current, error: toArtifactError(error) }));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Any mutation anywhere in the app refreshes every consumer.
  useEffect(() => {
    const onChange = () => void refresh();
    window.addEventListener(ARTIFACTS_EVENT, onChange);
    return () => window.removeEventListener(ARTIFACTS_EVENT, onChange);
  }, [refresh]);

  const run = useCallback(
    async <T,>(label: string, action: () => Promise<T>): Promise<T | null> => {
      setState({ busy: label, error: null, notice: null });
      try {
        const result = await action();
        await refresh();
        // Keep the message the action just wrote — clearing it here made every
        // success (save / publish / test) look like a no-op to the operator.
        setState((current) => ({ busy: null, error: null, notice: current.notice }));
        return result;
      } catch (error) {
        setState({ busy: null, error: toArtifactError(error), notice: null });
        return null;
      }
    },
    [refresh],
  );

  const create = useCallback(
    (input: { name: string; text: string; title?: string; description?: string }) =>
      run('create', async () => {
        const artifact = await createArtifact({ ...input, source: 'operator' });
        setState((current) => ({
          ...current,
          notice: `${artifact.name} saved · ${formatBytes(artifact.sizeBytes)}`,
        }));
        return artifact;
      }),
    [run],
  );

  const upload = useCallback(
    (file: File) =>
      run('upload', async () => {
        const artifact = await importFile(file);
        setState((current) => ({ ...current, notice: `${artifact.name} imported` }));
        return artifact;
      }),
    [run],
  );

  const remove = useCallback(
    (id: string) => run('delete', () => deleteArtifact(id)),
    [run],
  );

  const rename = useCallback(
    (id: string, name: string) =>
      run('rename', async () => {
        const result = await renameArtifact(id, name);
        setState((current) => ({
          ...current,
          notice: result.warning ?? `${result.artifact.name} renamed`,
        }));
        return result.artifact;
      }),
    [run],
  );

  const download = useCallback(
    (artifact: Artifact) => run('download', () => downloadArtifact(artifact)),
    [run],
  );

  const publish = useCallback(
    (artifact: Artifact, target: FtpTarget, forceQueue = false) =>
      run('publish', async () => {
        const result = await publishArtifact(artifact, target, { forceQueue });
        setState((current) => ({ ...current, notice: result.message }));
        return result;
      }),
    [run],
  );

  const testConnection = useCallback(
    (target: FtpTarget) =>
      run('test', async () => {
        const result = await testFtpTarget(target);
        setState((current) => ({
          ...current,
          notice: `Connection OK — ${target.host}:${target.port}${result.dir}`,
        }));
        return result;
      }),
    [run],
  );

  const capture = useCallback(
    (message: string, agentName?: string) => captureFromAgent(message, { agentName }),
    [],
  );

  const readText = useCallback((artifact: Artifact) => readArtifactText(artifact), []);
  const getBlob = useCallback((artifact: Artifact) => artifactBlob(artifact), []);
  const getById = useCallback((id: string) => getArtifactById(id), []);
  const reclaim = useCallback(
    () =>
      run('reclaim', async () => {
        const freed = await reclaimSpace();
        setState((current) => ({
          ...current,
          notice: freed ? `Freed ${freed} orphaned payload${freed === 1 ? '' : 's'}` : 'Nothing to reclaim',
        }));
        return freed;
      }),
    [run],
  );

  const kinds = useMemo(() => {
    const counts = { code: 0, config: 0, report: 0, data: 0, custom: 0 };
    for (const artifact of artifacts) counts[artifact.kind] += 1;
    return counts;
  }, [artifacts]);

  return {
    artifacts,
    stats,
    kinds,
    filter,
    setFilter,
    loading,
    busy: state.busy,
    error: state.error,
    notice: state.notice,
    clearNotice: () => setState((current) => ({ ...current, notice: null, error: null })),
    refresh,
    create,
    upload,
    remove,
    rename,
    download,
    publish,
    testConnection,
    capture,
    readText,
    getBlob,
    getById,
    reclaim,
  };
}
