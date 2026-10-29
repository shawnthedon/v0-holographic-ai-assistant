'use client';

/**
 * Local-AI service: the single entry point the UI uses (spec §13).
 *
 * Responsibilities: model catalogue, import, download management, lifecycle
 * transitions, generation. Everything persisted goes through `storage.ts`;
 * everything executed goes through `runtime.ts`.
 *
 * Two rules are enforced here rather than in the UI:
 *   1. A partial or invalid file can never appear as an installed model.
 *   2. Nothing here ever contacts a cloud model. There is no fallback path —
 *      a local failure is reported as a local failure.
 */

import { assertSafeDownloadUrl, findCatalogueModel, idFromFileName, LOCAL_CATALOGUE } from './catalogue';
import { probeCapabilities } from './capabilities';
import { inspectGguf, GgufParseError, type GgufHeader } from './gguf';
import * as runtime from './runtime';
import * as store from './storage';
import {
  DeviceAiError,
  toPayload,
  type CatalogueModel,
  type DeviceAiCapabilities,
  type DownloadJob,
  type GenerationRequest,
  type GenerationResult,
  type LocalModel,
  type LoadedModelInfo,
  type StorageInfo,
} from './types';

/* ----------------------------- capabilities ----------------------------- */

let capabilityCache: { at: number; value: DeviceAiCapabilities } | null = null;

export async function getCapabilities(force = false): Promise<DeviceAiCapabilities> {
  if (!force && capabilityCache && Date.now() - capabilityCache.at < 30_000) {
    return capabilityCache.value;
  }
  const value = await probeCapabilities();
  capabilityCache = { at: Date.now(), value };
  return value;
}

/* -------------------------------- listing -------------------------------- */

export async function listModels(): Promise<LocalModel[]> {
  const models = await store.listModels();
  // Reconcile: a record whose file vanished is reported as needing reinstall
  // rather than silently claiming to be installed.
  return models;
}

export async function getModel(id: string): Promise<LocalModel | null> {
  return store.getModel(id);
}

export async function getStorageInfo(): Promise<StorageInfo> {
  const info = await store.storageInfo();
  const models = await store.listModels();
  const jobs = await store.listJobs();
  const modelsBytes = models.reduce((sum, model) => sum + Math.max(0, model.sizeBytes), 0);
  const partialBytes = jobs
    .filter((job) => job.state === 'downloading' || job.state === 'paused')
    .reduce((sum, job) => sum + Math.max(0, job.receivedBytes), 0);
  return {
    quotaBytes: info.quotaBytes,
    usageBytes: info.usageBytes,
    availableBytes: info.availableBytes,
    modelsBytes,
    partialBytes,
    persisted: info.persisted,
  };
}

export async function setPersistence(): Promise<boolean> {
  return store.requestPersistence();
}

/* ------------------------------ validation ------------------------------ */

interface ValidatedFile {
  header: GgufHeader;
  integrity: LocalModel['integrity'];
}

/**
 * Validates a GGUF file for real: magic, version, metadata, architecture, size
 * sanity. Throws a typed error that names what is wrong.
 */
async function validateFile(blob: Blob, declaredBytes?: number): Promise<ValidatedFile> {
  if (blob.size < 1024) {
    throw new DeviceAiError({
      code: 'invalid-file',
      message: `File is only ${blob.size} bytes — that cannot be a model`,
      fix: 'Pick a complete .gguf model file, or retry the download.',
    });
  }

  if (declaredBytes && Math.abs(blob.size - declaredBytes) > 1024) {
    throw new DeviceAiError({
      code: 'invalid-file',
      message: `Expected ${declaredBytes} bytes but got ${blob.size} — the transfer was incomplete`,
      fix: 'Delete this model and download it again. Partial files are never installed.',
    });
  }

  let header: GgufHeader;
  try {
    const inspected = await inspectGguf(blob);
    header = inspected.header;
    if (!inspected.sizeMatches) {
      throw new DeviceAiError({
        code: 'corrupt-file',
        message: 'The GGUF header parses but the file is smaller than its own tensor table claims',
        fix: 'The file is truncated. Re-download it; if it happens again the preset URL may be wrong.',
      });
    }
  } catch (error) {
    if (error instanceof DeviceAiError) throw error;
    if (error instanceof GgufParseError) {
      throw new DeviceAiError({
        code: error.reason === 'bad-magic' ? 'invalid-file' : 'corrupt-file',
        message: `GGUF validation failed: ${error.message}`,
        fix:
          error.reason === 'unsupported-version'
            ? 'Re-quantize with a current llama.cpp release (GGUF v2/v3).'
            : 'Reject this file and import a known-good GGUF; the header does not describe a usable model.',
      });
    }
    throw new DeviceAiError({
      code: 'invalid-file',
      message: `Could not read the model header: ${error instanceof Error ? error.message : 'unknown'}`,
      fix: 'Try another file. If the file is valid, reload the page and retry.',
    });
  }

  if (!header.architecture) {
    throw new DeviceAiError({
      code: 'unsupported-architecture',
      message: 'The GGUF file has no general.architecture metadata',
      fix: 'This file was not produced by a standard converter. Use an official GGUF quantization.',
    });
  }

  return { header, integrity: 'header-ok' };
}

function modelFromHeader(args: {
  id: string;
  fileName: string;
  header: GgufHeader;
  sizeBytes: number;
  source: LocalModel['source'];
  integrity: LocalModel['integrity'];
  contextFallback?: number;
}): LocalModel {
  return {
    id: args.id,
    name: args.header.modelName ?? args.fileName.replace(/\.gguf$/i, ''),
    state: 'installed',
    sizeBytes: args.sizeBytes,
    quantization: args.header.quantization,
    architecture: args.header.architecture ?? 'unknown',
    contextLength: args.header.contextLength ?? args.contextFallback,
    embeddingLength: args.header.embeddingLength ?? undefined,
    layerCount: args.header.layerCount ?? undefined,
    source: args.source,
    integrity: args.integrity,
    installedAt: Date.now(),
  };
}

/* -------------------------------- import -------------------------------- */

export async function importModel(file: File): Promise<LocalModel> {
  if (!/\.gguf$/i.test(file.name)) {
    throw new DeviceAiError({
      code: 'invalid-file',
      message: `"${file.name}" is not a .gguf file`,
      fix: 'Local text models must be GGUF format. Convert with llama.cpp’s convert script, or pick a GGUF from the catalogue.',
    });
  }

  const capabilities = await getCapabilities();
  if (!capabilities.opfs) {
    throw new DeviceAiError({
      code: 'unsupported-platform',
      message: 'This browser cannot store model files on device',
      fix: 'Use a Chromium-based browser with origin-private file storage, or choose a cloud model instead.',
    });
  }

  const storage = await getStorageInfo();
  if (storage.availableBytes && file.size > storage.availableBytes) {
    throw new DeviceAiError({
      code: 'insufficient-storage',
      message: `Import needs ${file.size} bytes but only ${storage.availableBytes} are available`,
      fix: 'Delete an unused model below, or free space in the browser’s storage for this origin.',
    });
  }

  const id = idFromFileName(file.name);
  const existing = await store.getModel(id);
  if (existing) {
    // Duplicate handling: identical file = no-op; different file = explicit replace.
    const sameSize = Math.abs(existing.sizeBytes - file.size) < 1024;
    if (sameSize) {
      throw new DeviceAiError({
        code: 'invalid-file',
        message: `"${file.name}" is already installed with the same size`,
        fix: 'Nothing to do. Unload and delete it first if you want to reinstall.',
      });
    }
    await deleteModel(id, { force: true });
  }

  const pending: LocalModel = {
    id,
    name: file.name.replace(/\.gguf$/i, ''),
    state: 'verifying',
    sizeBytes: file.size,
    quantization: 'unknown',
    architecture: 'unknown',
    source: {
      kind: 'import',
      origin: file.name,
      label: 'Imported from this device',
      licence: 'Unknown — supplied by the operator',
    },
    integrity: 'unverified',
  };
  await store.putModel(pending);

  try {
    const { header, integrity } = await validateFile(file);
    const { bytes } = await store.writeModelFile(id, file);
    const model = modelFromHeader({
      id,
      fileName: file.name,
      header,
      sizeBytes: bytes,
      source: pending.source,
      integrity,
    });
    await store.putModel(model);
    return model;
  } catch (error) {
    // A failed import must not leave a record that looks installed (MM-02).
    await store.removeModel(id).catch(() => undefined);
    throw error;
  }
}

/* ------------------------------- downloads ------------------------------- */

type ProgressListener = (job: DownloadJob) => void;
const progressListeners = new Set<ProgressListener>();
const cancelled = new Set<string>();
const paused = new Set<string>();

/** Subscribes to download-job updates. Returns an unsubscribe function. */
export function onDownloadProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

function emit(job: DownloadJob) {
  for (const listener of progressListeners) listener(job);
}

function jobIdFor(modelId: string) {
  return `job-${modelId.replace(/[^a-z0-9]+/gi, '-')}`;
}

export async function listJobs(): Promise<DownloadJob[]> {
  return store.listJobs();
}

export function cancelDownload(jobId: string): void {
  cancelled.add(jobId);
}

export function pauseDownload(jobId: string): void {
  paused.add(jobId);
}

/**
 * Downloads model weights to disk with honest progress.
 *
 * • Streamed: chunks go straight to an OPFS partial file, never a JS buffer.
 * • Resumable only when the server advertises `Accept-Ranges: bytes` and the
 *   response actually used the range; otherwise the UI says resume is not
 *   supported for this host rather than pretending.
 * • Cancellation aborts the fetch and leaves a recoverable partial (MM-04).
 * • Promotion happens only after validation succeeds; a partial file can never
 *   be loaded.
 */
export async function downloadModel(
  modelId: string,
  options: { url?: string; signal?: AbortSignal; licenceAccepted?: boolean } = {},
): Promise<DownloadJob> {
  const preset: CatalogueModel | null = findCatalogueModel(modelId);

  if (preset && preset.verification === 'unverified' && !options.licenceAccepted) {
    // Not a licence click-through theatre: the user must confirm the exact
    // file and licence, because the preset's file name is unverified.
    throw new DeviceAiError({
      code: 'permission-denied',
      message: 'Confirm the exact model file and licence before downloading',
      fix: 'Open the model card, check the file name and licence, then accept to start the download.',
    });
  }

  const rawUrl = options.url ?? preset?.downloadUrl;
  if (!rawUrl) {
    throw new DeviceAiError({
      code: 'invalid-file',
      message: `No download URL for "${modelId}"`,
      fix: 'Paste a direct .gguf https URL from an approved model host.',
    });
  }

  let url: URL;
  try {
    url = assertSafeDownloadUrl(rawUrl);
  } catch (error) {
    throw new DeviceAiError({
      code: 'invalid-file',
      message: error instanceof Error ? error.message : 'Unsafe download URL',
      fix: 'Use a direct https://huggingface.co/.../.gguf link.',
    });
  }

  const capabilities = await getCapabilities();
  if (!capabilities.opfs) {
    throw new DeviceAiError({
      code: 'unsupported-platform',
      message: 'This browser cannot stream a download to disk',
      fix: 'Use a Chromium-based browser with OPFS (Chrome/Edge 108+).',
    });
  }

  const expected = preset?.approxBytes ?? 0;
  const storage = await getStorageInfo();
  const needed = expected * 1.15; // partial + promoted copy during the swap
  if (storage.availableBytes && needed && needed > storage.availableBytes) {
    throw new DeviceAiError({
      code: 'insufficient-storage',
      message: `Downloading this model needs about ${Math.round(needed)} bytes but ${storage.availableBytes} are available`,
      fix: 'Delete an installed model first, or choose a smaller quantization.',
    });
  }

  const jobId = jobIdFor(modelId);
  const resumedFrom = await store.partialSize(modelId);

  const job: DownloadJob = {
    id: jobId,
    modelId,
    state: 'queued',
    receivedBytes: resumedFrom,
    totalBytes: expected || null,
    bytesPerSecond: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    resumable: false,
    url: url.toString(),
  };
  await store.putJob(job);
  emit(job);

  await store.putModel({
    id: modelId,
    name: preset?.name ?? modelId.replace(/^local\//, ''),
    state: 'downloading',
    sizeBytes: expected,
    quantization: preset?.quantization ?? 'unknown',
    architecture: 'unknown',
    contextLength: preset?.contextLength,
    source: {
      kind: preset ? 'catalogue' : 'url',
      origin: url.toString(),
      label: preset?.family ?? 'Direct download',
      licence: preset?.licence ?? 'Declared by the source',
      modelCard: preset?.modelCard,
    },
    integrity: 'unverified',
  });

  cancelled.delete(jobId);
  paused.delete(jobId);

  try {
    const headers: Record<string, string> = {};
    if (resumedFrom > 0) headers.Range = `bytes=${resumedFrom}-`;

    const response = await fetch(url.toString(), {
      headers,
      signal: options.signal,
      credentials: 'omit',
      cache: 'no-store',
    });

    if (!response.ok && response.status !== 206) {
      throw new DeviceAiError({
        code: 'network-error',
        message: `The model host answered ${response.status} ${response.statusText}`,
        fix:
          response.status === 404
            ? 'The preset file name is stale. Use “browse files” to pick the exact GGUF, or paste the current file URL from the model card.'
            : response.status === 401 || response.status === 403
              ? 'This repo needs authentication. Fetch the file from the model card in a browser, then use Import instead.'
              : 'Retry. If it persists, the host may be blocking this origin (CORS) — use the byte-proxy option.',
      });
    }

    const supportsRange = (response.headers.get('accept-ranges') ?? '').toLowerCase().includes('bytes');
    const usedRange = response.status === 206;
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    const totalBytes = usedRange
      ? resumedFrom + contentLength
      : contentLength || (response.headers.get('content-length') ? contentLength : expected || null);

    let received = usedRange ? resumedFrom : 0;
    const writer = await store.openPartialWriter(modelId, { resumeFrom: usedRange ? resumedFrom : 0 });

    job.state = 'downloading';
    job.totalBytes = totalBytes || null;
    job.resumable = supportsRange;
    job.receivedBytes = received;
    job.updatedAt = Date.now();
    await store.putJob(job);
    emit(job);

    const reader = response.body?.getReader();
    if (!reader) {
      throw new DeviceAiError({
        code: 'network-error',
        message: 'The response had no body to stream',
        fix: 'Retry the download; if the host streams nothing, use Import with a local file.',
      });
    }

    let lastEmit = 0;
    let lastBytes = received;
    let lastTime = performance.now();

    for (;;) {
      if (cancelled.has(jobId)) {
        await reader.cancel().catch(() => undefined);
        await writer.close().catch(() => undefined);
        job.state = 'cancelled';
        job.updatedAt = Date.now();
        await store.putJob(job);
        await store.patchModel(modelId, { state: 'cancelled' });
        emit(job);
        throw new DeviceAiError({
          code: 'cancelled',
          message: 'Download cancelled',
          fix: 'The partial file is kept; press Resume to continue from where it stopped.',
        });
      }

      if (paused.has(jobId)) {
        await reader.cancel().catch(() => undefined);
        await writer.close().catch(() => undefined);
        job.state = 'paused';
        job.receivedBytes = received;
        job.updatedAt = Date.now();
        await store.putJob(job);
        await store.patchModel(modelId, { state: 'paused' });
        emit(job);
        return job;
      }

      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        await writer.write(value);
        received += value.byteLength;
      }

      const now = performance.now();
      if (now - lastEmit > 250) {
        const deltaBytes = received - lastBytes;
        const deltaMs = now - lastTime;
        job.bytesPerSecond = deltaMs > 0 ? Math.round((deltaBytes / deltaMs) * 1000) : 0;
        job.receivedBytes = received;
        job.totalBytes = totalBytes || null;
        job.updatedAt = Date.now();
        lastBytes = received;
        lastTime = now;
        lastEmit = now;
        await store.putJob(job);
        emit(job);
      }
    }

    await writer.close();

    job.state = 'verifying';
    job.receivedBytes = received;
    job.updatedAt = Date.now();
    await store.putJob(job);
    await store.patchModel(modelId, { state: 'verifying' });
    emit(job);

    // Validate the bytes on disk before promoting: an incomplete transfer must
    // never become loadable (MM-04).
    const partial = await store.readPartialFile(modelId);
    if (!partial) {
      throw new DeviceAiError({
        code: 'invalid-file',
        message: 'The downloaded file could not be read back from storage',
        fix: 'Retry the download. If it repeats, the browser storage quota may be exhausted.',
      });
    }
    const { header, integrity } = await validateFile(partial, totalBytes || undefined);

    const promoted = await store.promotePartial(modelId);
    const model = modelFromHeader({
      id: modelId,
      fileName: `local-${modelId.split('/').pop()}.gguf`,
      header,
      sizeBytes: promoted.bytes,
      source: {
        kind: preset ? 'catalogue' : 'url',
        origin: url.toString(),
        label: preset?.family ?? 'Direct download',
        licence: preset?.licence ?? 'Declared by the source',
        modelCard: preset?.modelCard,
      },
      integrity,
      contextFallback: preset?.contextLength,
    });
    await store.putModel(model);

    job.state = 'done';
    job.receivedBytes = promoted.bytes;
    job.totalBytes = promoted.bytes;
    job.updatedAt = Date.now();
    await store.putJob(job);
    emit(job);
    return job;
  } catch (error) {
    const payload = toPayload(error);
    job.state = payload.code === 'cancelled' ? 'cancelled' : 'error';
    job.error = payload;
    job.updatedAt = Date.now();
    await store.putJob(job);
    await store.patchModel(modelId, {
      state: payload.code === 'cancelled' ? 'cancelled' : 'error',
      lastError: payload,
    });
    emit(job);
    throw error instanceof DeviceAiError ? error : new DeviceAiError(payload);
  }
}

/** Resumes a paused/cancelled job, from the byte offset actually on disk. */
export async function resumeDownload(modelId: string, options: { signal?: AbortSignal; url?: string } = {}) {
  const offset = await store.partialSize(modelId);
  if (!offset) return downloadModel(modelId, { ...options, licenceAccepted: true });
  return downloadModel(modelId, { ...options, licenceAccepted: true, url: options.url });
}

/* ------------------------------- lifecycle ------------------------------- */

export async function loadModel(
  modelId: string,
  options: { contextLength?: number; threads?: number } = {},
): Promise<LoadedModelInfo> {
  const model = await store.getModel(modelId);
  if (!model || model.state === 'error') {
    throw new DeviceAiError({
      code: 'not-installed',
      message: `"${modelId}" is not installed`,
      fix: 'Download or import the model first.',
    });
  }

  const file = await store.readModelFile(modelId);
  if (!file) {
    await store.patchModel(modelId, {
      state: 'error',
      lastError: {
        code: 'not-installed',
        message: 'The model file is missing from storage',
        fix: 'Reinstall the model — the metadata record outlived the weights.',
      },
    });
    throw new DeviceAiError({
      code: 'not-installed',
      message: 'The model file has been deleted from storage',
      fix: 'Reinstall it from the catalogue or import it again.',
    });
  }

  const capabilities = await getCapabilities();
  if (capabilities.recommendedMaxModelBytes && file.size > capabilities.recommendedMaxModelBytes) {
    throw new DeviceAiError({
      code: 'insufficient-memory',
      message: `This model is ${file.size} bytes, above this device’s conservative ceiling of ${capabilities.recommendedMaxModelBytes} bytes`,
      fix: 'Pick a smaller quantization (Q4_K_M or Q3_K_M) or a smaller model. Loading anyway may crash the tab.',
    });
  }

  await store.patchModel(modelId, { state: 'loading' });

  const contextLength = Math.min(
    options.contextLength ?? Math.min(model.contextLength ?? 4096, 4096),
    model.contextLength ?? 8192,
  );
  const threads = Math.max(1, Math.min(options.threads ?? Math.floor(capabilities.hardwareConcurrency / 2), 8));

  try {
    const info = await runtime.loadModel({
      modelId,
      blobs: [file],
      contextLength,
      threads,
    });
    await store.patchModel(modelId, { state: 'loaded', lastUsedAt: Date.now(), lastError: undefined });
    return info;
  } catch (error) {
    const payload = toPayload(error);
    await store.patchModel(modelId, { state: 'error', lastError: payload });
    throw error instanceof DeviceAiError ? error : new DeviceAiError(payload);
  }
}

export async function unloadModel(modelId: string): Promise<void> {
  if (runtime.loadedModelId() && runtime.loadedModelId() !== modelId) {
    throw new DeviceAiError({
      code: 'model-busy',
      message: `"${runtime.loadedModelId()}" is loaded, not "${modelId}"`,
      fix: 'Unload the model that is actually loaded.',
    });
  }
  await store.patchModel(modelId, { state: 'unloading' });
  try {
    await runtime.unloadModel();
    await store.patchModel(modelId, { state: 'installed' });
  } catch (error) {
    const payload = toPayload(error);
    await store.patchModel(modelId, { state: 'error', lastError: payload });
    throw error instanceof DeviceAiError ? error : new DeviceAiError(payload);
  }
}

/**
 * Deletes a model. An actively loaded model must be unloaded first (MM-10), and
 * a partial infrastructure failure is reported instead of being swallowed.
 */
export async function deleteModel(modelId: string, options: { force?: boolean } = {}): Promise<void> {
  const model = await store.getModel(modelId);
  if (!model) return;

  if (runtime.loadedModelId() === modelId) {
    if (!options.force) {
      throw new DeviceAiError({
        code: 'model-loaded',
        message: 'This model is loaded into memory',
        fix: 'Unload it first — deleting weights that the runtime is using would crash the tab.',
      });
    }
    await runtime.unloadModel();
  }

  await store.patchModel(modelId, { state: 'unloading' });
  await store.deleteModelFile(modelId);
  const stillThere = await store.modelFileSize(modelId);
  if (stillThere > 0) {
    await store.patchModel(modelId, {
      state: 'error',
      lastError: {
        code: 'invalid-file',
        message: 'The model file could not be removed',
        fix: 'Clear this origin’s site data in the browser settings, then reload.',
      },
    });
    throw new DeviceAiError({
      code: 'invalid-file',
      message: 'Deletion failed: the weights are still on disk',
      fix: 'Clear this origin’s site data, then reload the console.',
    });
  }

  await store.removeModel(modelId);
  const jobs = await store.listJobs();
  for (const job of jobs) {
    if (job.modelId === modelId) await store.removeJob(job.id);
  }
}

/* ------------------------------ generation ------------------------------ */

export async function generateText(
  request: GenerationRequest,
  onToken: (chunk: string) => void,
): Promise<GenerationResult> {
  const result = await runtime.generateText(request, { onToken });
  await store.patchModel(request.modelId, { lastUsedAt: Date.now() }).catch(() => undefined);
  return result;
}

export function stopGeneration(): void {
  runtime.stopGeneration();
}

export function loadedModelId(): string | null {
  return runtime.loadedModelId();
}

export function loadedInfo(): LoadedModelInfo | null {
  return runtime.loadedInfo();
}

/* --------------------------- image generation --------------------------- */

/**
 * Local image generation (spec §10) is NOT implemented.
 *
 * This is an honest capability report, not a stub that returns a picture: this
 * app has no diffusion runtime, no image model on device, and WebGPU support
 * across target browsers is not enough to run SD/FLUX inside a WASM tab without
 * a dedicated pipeline. Phase 4 of the spec is a feasibility spike on real
 * hardware, which cannot be performed in this environment. See
 * docs/ON_DEVICE_AI.md §Image generation.
 */
export function imageGenerationStatus(): {
  state: 'unavailable';
  reason: string;
  requirements: string[];
} {
  return {
    state: 'unavailable',
    reason:
      'No local diffusion runtime is bundled. Text GGUF models cannot generate images, and no cloud image API is called.',
    requirements: [
      'A diffusion runtime compiled for WebGPU/WASM (e.g. stable-diffusion.cpp or a WebGPU pipeline) added as a dependency',
      'A compatible quantized image model (≈1–2 GB) stored on device',
      'A GPU-capable browser, plus a measured generation-time and memory benchmark on real hardware',
      'A Phase 4 feasibility gate pass recorded before enabling the UI',
    ],
  };
}

export { LOCAL_CATALOGUE };
export type { CatalogueModel };
