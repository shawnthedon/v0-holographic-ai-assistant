'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as service from '@/lib/device-ai/service';
import { LOCAL_CATALOGUE } from '@/lib/device-ai/catalogue';
import {
  DeviceAiError,
  toPayload,
  type CatalogueModel,
  type DeviceAiCapabilities,
  type DeviceAiErrorPayload,
  type DownloadJob,
  type GenerationResult,
  type LocalModel,
  type LoadedModelInfo,
  type StorageInfo,
} from '@/lib/device-ai/types';

export interface HfFile {
  name: string;
  path: string;
  sizeBytes: number;
  sha256?: string;
  url: string;
}

/**
 * React binding over the local-AI service.
 *
 * State is always re-read from the service after an action, so the UI shows the
 * persisted runtime state rather than an optimistic guess.
 */
export function useDeviceAi() {
  const [capabilities, setCapabilities] = useState<DeviceAiCapabilities | null>(null);
  const [models, setModels] = useState<LocalModel[]>([]);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [loaded, setLoaded] = useState<LoadedModelInfo | null>(null);
  const [error, setError] = useState<DeviceAiErrorPayload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextModels, nextJobs, nextStorage] = await Promise.all([
        service.listModels(),
        service.listJobs(),
        service.getStorageInfo(),
      ]);
      setModels(nextModels);
      setJobs(nextJobs);
      setStorage(nextStorage);
      setLoaded(service.loadedInfo());
    } catch (cause) {
      setError(toPayload(cause));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const caps = await service.getCapabilities().catch(() => null);
      if (cancelled) return;
      setCapabilities(caps);
      await refresh();
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    // Live download progress comes from the service, not a timer.
    return service.onDownloadProgress((job) => {
      setJobs((current) => {
        const next = current.filter((entry) => entry.id !== job.id);
        return [job, ...next].sort((a, b) => b.updatedAt - a.updatedAt);
      });
      if (job.state === 'done' || job.state === 'error') {
        void refresh();
        if (job.state === 'error' && job.error) setError(job.error);
      }
    });
  }, [refresh]);

  const run = useCallback(
    async <T,>(label: string, action: () => Promise<T>): Promise<T | null> => {
      setBusy(label);
      setError(null);
      try {
        const result = await action();
        await refresh();
        return result;
      } catch (cause) {
        setError(toPayload(cause));
        await refresh();
        return null;
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const importFile = useCallback(
    (file: File) => run(`import:${file.name}`, () => service.importModel(file)),
    [run],
  );

  const download = useCallback(
    (modelId: string, options: { url?: string; licenceAccepted?: boolean } = {}) => {
      const controller = new AbortController();
      abortRef.current = controller;
      return run(`download:${modelId}`, () =>
        service.downloadModel(modelId, { ...options, signal: controller.signal }),
      );
    },
    [run],
  );

  const resume = useCallback(
    (modelId: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      return run(`resume:${modelId}`, () => service.resumeDownload(modelId, { signal: controller.signal }));
    },
    [run],
  );

  const cancel = useCallback((jobId: string) => {
    service.cancelDownload(jobId);
    abortRef.current?.abort();
  }, []);

  const pause = useCallback((jobId: string) => {
    service.pauseDownload(jobId);
  }, []);

  const load = useCallback(
    (modelId: string, options: { contextLength?: number; threads?: number } = {}) =>
      run(`load:${modelId}`, async () => {
        const info = await service.loadModel(modelId, options);
        setLoaded(info);
        return info;
      }),
    [run],
  );

  const unload = useCallback(
    (modelId: string) =>
      run(`unload:${modelId}`, async () => {
        await service.unloadModel(modelId);
        setLoaded(null);
      }),
    [run],
  );

  const remove = useCallback(
    (modelId: string, options: { force?: boolean } = {}) =>
      run(`delete:${modelId}`, async () => {
        await service.deleteModel(modelId, options);
        if (service.loadedModelId() !== modelId) setLoaded(service.loadedInfo());
      }),
    [run],
  );

  const requestPersistence = useCallback(
    () =>
      run('persist', async () => {
        const granted = await service.setPersistence();
        return granted;
      }),
    [run],
  );

  const generate = useCallback(
    async (prompt: string, options: { maxTokens?: number } = {}): Promise<GenerationResult | null> =>
      run('generate', async () => {
        const info = service.loadedInfo();
        if (!info) {
          throw new DeviceAiError({
            code: 'not-installed',
            message: 'Load a local model before generating',
            fix: 'Open Local AI, install a model, then load it.',
          });
        }
        let streamed = '';
        const result = await service.generateText(
          {
            modelId: info.modelId,
            messages: [
              { role: 'system', content: 'You are NEXUS, a concise on-device assistant. Answer in two sentences.' },
              { role: 'user', content: prompt },
            ],
            maxTokens: options.maxTokens ?? 160,
          },
          (chunk) => {
            streamed += chunk;
          },
        );
        return { ...result, text: result.text || streamed };
      }),
    [run],
  );

  const browseRepo = useCallback(async (repo: string): Promise<HfFile[]> => {
    setError(null);
    try {
      const response = await fetch(`/api/device-ai/hf?repo=${encodeURIComponent(repo)}`, {
        cache: 'no-store',
      });
      const data = (await response.json()) as { files?: HfFile[]; error?: string; fix?: string; code?: string };
      if (!response.ok || data.error) {
        setError({
          code: 'network-error',
          message: data.error ?? `Hub lookup failed (${response.status})`,
          fix: data.fix ?? 'Retry, or paste the direct file URL.',
        });
        return [];
      }
      return data.files ?? [];
    } catch (cause) {
      setError(toPayload(cause));
      return [];
    }
  }, []);

  return {
    ready,
    capabilities,
    catalogue: LOCAL_CATALOGUE as CatalogueModel[],
    models,
    jobs,
    storage,
    loaded,
    error,
    busy,
    clearError: () => setError(null),
    imageGeneration: service.imageGenerationStatus(),
    refresh,
    importFile,
    download,
    resume,
    cancel,
    pause,
    load,
    unload,
    remove,
    generate,
    browseRepo,
    requestPersistence,
    recheckCapabilities: () => run('capabilities', () => service.getCapabilities(true)),
  };
}
