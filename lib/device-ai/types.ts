/**
 * On-device AI contracts.
 *
 * This is the typed service boundary the UI talks to (spec §8/§13): the console
 * never imports an inference runtime directly, so the runtime can be swapped —
 * or reported as unavailable — without touching a component.
 *
 * Platform reality: this is a browser app. The local runtime is llama.cpp
 * compiled to WebAssembly (wllama) running in this tab, with weights held in
 * origin-private file storage. There is no native host, so there is no
 * foreground service and no OS download notification; see docs/ON_DEVICE_AI.md.
 */

export type ModelState =
  | 'available'
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'verifying'
  | 'importing'
  | 'installed'
  | 'loading'
  | 'loaded'
  | 'unloading'
  | 'error'
  | 'cancelled';

export type ModelSourceKind = 'catalogue' | 'import' | 'url';

export interface ModelSource {
  kind: ModelSourceKind;
  /** Where the weights came from (https URL, or the file name for imports). */
  origin: string;
  label: string;
  licence: string;
  modelCard?: string;
}

export interface LocalModel {
  /** Stable id: `local/<slug>`. */
  id: string;
  name: string;
  state: ModelState;
  sizeBytes: number;
  quantization: string;
  architecture: string;
  contextLength?: number;
  embeddingLength?: number;
  layerCount?: number;
  source: ModelSource;
  sha256?: string;
  integrity: 'unverified' | 'header-ok' | 'checksum-ok' | 'checksum-mismatch';
  installedAt?: number;
  lastUsedAt?: number;
  lastError?: DeviceAiErrorPayload;
  /** Measured on this device, never estimated. */
  performance?: { loadMs: number; tokensPerSecond: number; firstTokenMs: number };
}

export interface DeviceAiCapabilities {
  /** 'browser' — there is no native host in this project. */
  platform: 'browser';
  userAgent: string;
  wasm: boolean;
  wasmSimd: boolean;
  wasmThreads: boolean;
  /** JSPI lets the default (fast) build suspend/resume without Asyncify. */
  wasmJspi: boolean;
  /** MEMORY64 is required by the default build; absent ⇒ compat build. */
  wasmMemory64: boolean;
  /** Which bundled runtime this browser will actually execute. */
  runtimeBuild: 'default' | 'compat' | 'none';
  crossOriginIsolated: boolean;
  webgpu: boolean;
  storageManager: boolean;
  opfs: boolean;
  indexedDb: boolean;
  /** navigator.deviceMemory, in GiB. Absent on most browsers. */
  deviceMemoryGb?: number;
  hardwareConcurrency: number;
  storage?: { quotaBytes: number; usageBytes: number; availableBytes: number };
  /** Largest model this device should attempt, from a conservative estimate. */
  recommendedMaxModelBytes: number;
  tier: 'unsupported' | 'minimal' | 'capable' | 'strong';
  /** Human-readable reasons behind the verdict — shown verbatim in the UI. */
  notes: string[];
  /** What this platform cannot do, stated rather than simulated. */
  limitations: string[];
  probedAt: number;
}

export interface DownloadJob {
  id: string;
  modelId: string;
  state: 'queued' | 'downloading' | 'paused' | 'verifying' | 'done' | 'error' | 'cancelled';
  receivedBytes: number;
  totalBytes: number | null;
  bytesPerSecond: number;
  startedAt: number;
  updatedAt: number;
  /** True only when the server advertised byte ranges and supports resume. */
  resumable: boolean;
  url: string;
  error?: DeviceAiErrorPayload;
}

export interface StorageInfo {
  quotaBytes: number;
  usageBytes: number;
  availableBytes: number;
  modelsBytes: number;
  partialBytes: number;
  persisted: boolean;
}

export interface LoadedModelInfo {
  modelId: string;
  loadMs: number;
  contextLength: number;
  threads: number;
  backend: string;
  runtime: string;
}

export interface GenerationRequest {
  modelId: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  temperature?: number;
  /** Aborts generation; the runtime is asked to stop, not just ignored. */
  signal?: AbortSignal;
}

export interface GenerationResult {
  text: string;
  /** Measured, not estimated. */
  tokens: number;
  firstTokenMs: number | null;
  tokensPerSecond: number | null;
  stopped: boolean;
}

export type DeviceAiErrorCode =
  | 'unsupported-platform'
  | 'runtime-missing'
  | 'invalid-file'
  | 'corrupt-file'
  | 'unsupported-architecture'
  | 'insufficient-storage'
  | 'insufficient-memory'
  | 'network-error'
  | 'permission-denied'
  | 'cancelled'
  | 'checksum-mismatch'
  | 'model-busy'
  | 'load-failed'
  | 'generation-failed'
  | 'not-installed'
  | 'model-loaded'
  | 'image-runtime-unavailable';

export interface DeviceAiErrorPayload {
  code: DeviceAiErrorCode;
  message: string;
  fix: string;
}

export class DeviceAiError extends Error {
  code: DeviceAiErrorCode;
  fix: string;

  constructor(payload: DeviceAiErrorPayload) {
    super(payload.message);
    this.name = 'DeviceAiError';
    this.code = payload.code;
    this.fix = payload.fix;
  }

  toJSON(): DeviceAiErrorPayload {
    return { code: this.code, message: this.message, fix: this.fix };
  }
}

export function toPayload(error: unknown): DeviceAiErrorPayload {
  if (error instanceof DeviceAiError) return error.toJSON();
  return {
    code: 'load-failed',
    message: error instanceof Error ? error.message : 'unknown device-AI failure',
    fix: 'Open the model panel for details, then retry. If it repeats, unload and reload the model.',
  };
}

/* ------------------------------------------------------------------ */
/*  preset catalogue (spec §9) — candidate families, not guarantees     */
/* ------------------------------------------------------------------ */

export interface CatalogueModel {
  id: string;
  name: string;
  family: string;
  /** Approximate GGUF file size; shown with a "≈" and never as a RAM claim. */
  approxBytes: number;
  quantization: string;
  contextLength: number;
  licence: string;
  licenceNote?: string;
  modelCard: string;
  downloadUrl: string;
  /** Extra params this family needs (chat template, reasoning mode). */
  runtimeNotes?: string;
  resourceHeavy?: boolean;
  /**
   * 'unverified' means the exact file/quantization could not be confirmed from
   * this build environment (no egress to the model host). The download manager
   * re-validates the file at install time: GGUF magic, header, byte length.
   */
  verification: 'unverified' | 'validated';
  sha256?: string;
}
