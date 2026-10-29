'use client';

/**
 * llama.cpp (WebAssembly) runtime bridge.
 *
 * This is the ONLY module that imports the inference engine, and it does so
 * lazily so the 8 MB WASM binary is never part of the initial page payload.
 * Everything above it talks to the typed contract in `types.ts`.
 *
 * The engine is `@wllama/wllama` (MIT) — llama.cpp compiled to WASM. It runs in
 * a worker inside this tab; weights are streamed from OPFS by the caller, so no
 * model bytes are copied into a JS heap.
 */

import { DeviceAiError, type DeviceAiErrorPayload, type GenerationRequest, type GenerationResult, type LoadedModelInfo } from './types';

/** Where the WASM binaries are served from — synced from the npm packages. */
export const RUNTIME_WASM_PATH = '/vendor/wllama/wllama.wasm';
export const RUNTIME_COMPAT_WASM_PATH = '/vendor/wllama/compat/wllama.wasm';
export const RUNTIME_COMPAT_WORKER_PATH = '/vendor/wllama/compat/wllama.js';
export const RUNTIME_NAME = '@wllama/wllama (llama.cpp → WebAssembly)';
export const RUNTIME_VERSION = '3.8.1';
export const RUNTIME_LICENCE = 'MIT (wllama) · llama.cpp: MIT';

type WllamaLike = {
  setCompat: (
    compat: { wasm: string; worker: { code: string } } | null | 'default',
    mode?: 'safari' | 'firefox_safari',
  ) => void;
  loadModel: (blobs: Blob[], params?: Record<string, unknown>) => Promise<void>;
  exit: () => Promise<void>;
  isModelLoaded: () => boolean;
  getModelMetadata: () => { meta: Record<string, string>; hparams: Record<string, number> };
  getLoadedContextInfo: () => { n_ctx: number; n_batch?: number };
  getChatTemplate: () => string | null;
  getNumThreads: () => number;
  isMultithread: () => boolean;
  createChatCompletion: (options: Record<string, unknown>) => Promise<unknown>;
  getWorkerResources: () => unknown;
  supportInputModality?: (modality: 'image' | 'audio') => boolean;
};

interface RuntimeHandle {
  wllama: WllamaLike;
  loadedModelId: string;
  info: LoadedModelInfo;
}

let handle: RuntimeHandle | null = null;
let loading: Promise<RuntimeHandle> | null = null;
let activeAbort: AbortController | null = null;
let compatCode: string | null = null;

/**
 * Loads the compat worker source from our own origin.
 *
 * wllama would otherwise fetch it from a CDN on browsers without JSPI/MEMORY64,
 * which would make "works offline after install" false on exactly those
 * browsers. If the file is missing, compat mode is disabled and the failure is
 * reported honestly instead of silently reaching the network.
 */
async function loadCompatAssets(): Promise<{ wasm: string; worker: { code: string } } | null> {
  if (compatCode) return { wasm: RUNTIME_COMPAT_WASM_PATH, worker: { code: compatCode } };
  try {
    const response = await fetch(RUNTIME_COMPAT_WORKER_PATH, { cache: 'force-cache' });
    if (!response.ok) return null;
    compatCode = await response.text();
    return { wasm: RUNTIME_COMPAT_WASM_PATH, worker: { code: compatCode } };
  } catch {
    return null;
  }
}

/**
 * Resolves the engine module.
 *
 * The package ships no `exports` map, so the deep ESM path is the documented
 * entry (`esm/index.js`, MIT). A missing runtime is a typed, actionable error —
 * not a silent cloud fallback.
 */
async function importEngine(): Promise<{ Wllama: new (paths: Record<string, string>, config?: Record<string, unknown>) => WllamaLike }> {
  try {
    const mod = (await import('@wllama/wllama/esm/index.js')) as unknown as {
      Wllama: new (paths: Record<string, string>, config?: Record<string, unknown>) => WllamaLike;
    };
    if (!mod?.Wllama) throw new Error('Wllama export missing');
    return mod;
  } catch (error) {
    throw new DeviceAiError({
      code: 'runtime-missing',
      message: `The local inference runtime could not be loaded: ${error instanceof Error ? error.message : 'unknown error'}`,
      fix: 'The WASM bundle may be missing from the deployment. Run `npm run sync:runtime` and redeploy; local models stay unavailable until it is present.',
    });
  }
}

export function isModelLoaded(): boolean {
  return handle?.wllama.isModelLoaded() ?? false;
}

export function loadedModelId(): string | null {
  return handle?.loadedModelId ?? null;
}

export function loadedInfo(): LoadedModelInfo | null {
  return handle?.info ?? null;
}

export interface LoadOptions {
  modelId: string;
  blobs: Blob[];
  contextLength: number;
  threads: number;
  temperature?: number;
}

/** Loads a model into the runtime, replacing any currently loaded one. */
export async function loadModel(options: LoadOptions): Promise<LoadedModelInfo> {
  if (loading) {
    throw new DeviceAiError({
      code: 'model-busy',
      message: 'Another model is already loading',
      fix: 'Wait for the current load to finish, or cancel it first.',
    });
  }

  loading = (async (): Promise<RuntimeHandle> => {
    if (handle) await unloadModel(); // never hold two contexts: memory

    const { Wllama } = await importEngine();
    const wllama = new Wllama(
      // Point every build variant at our own copy so wllama never falls back to
      // a CDN. There is no cross-origin isolation, so the single-thread build
      // is what actually runs.
      {
        default: RUNTIME_WASM_PATH,
        'single-thread/wllama.wasm': RUNTIME_WASM_PATH,
        'multi-thread/wllama.wasm': RUNTIME_WASM_PATH,
      },
      { suppressNativeLog: true, allowOffline: true, parallelDownloads: 1 } as Record<string, unknown>,
    );

    const compat = await loadCompatAssets();
    if (compat) {
      wllama.setCompat(compat, 'safari');
    } else {
      // No local compat assets: disable the CDN path entirely. A browser that
      // needs it will fail loudly below rather than downloading at runtime.
      wllama.setCompat(null);
    }

    const started = performance.now();
    try {
      await wllama.loadModel(options.blobs, {
        n_ctx: options.contextLength,
        n_threads: options.threads,
        n_batch: 512,
        useCache: false,
        // Keep the KV cache small: this is a browser tab, not a server.
        cache_type_k: 'f16',
        cache_type_v: 'f16',
        warmup: true,
      });

      const info: LoadedModelInfo = {
        modelId: options.modelId,
        loadMs: Math.round(performance.now() - started),
        contextLength: wllama.getLoadedContextInfo().n_ctx,
        threads: wllama.getNumThreads?.() ?? options.threads,
        backend: wllama.isMultithread?.() ? 'wasm/multi-thread' : 'wasm/single-thread',
        runtime: RUNTIME_NAME,
      };

      const runtimeHandle: RuntimeHandle = { wllama, loadedModelId: options.modelId, info };
      handle = runtimeHandle;
      return runtimeHandle;
    } catch (error) {
      // Never leave a half-built context behind (spec §7).
      try {
        await wllama.exit();
      } catch {
        /* the context may never have finished allocating */
      }
      const message = error instanceof Error ? error.message : 'unknown load failure';
      const outOfMemory = /memory|alloc|OOM|RuntimeError/i.test(message);
      const featureGate = /memory64|table|jspi|suspend|compat|wasm/i.test(message) && !compat;
      throw new DeviceAiError({
        code: outOfMemory ? 'insufficient-memory' : featureGate ? 'runtime-missing' : 'load-failed',
        message: outOfMemory
          ? `The runtime ran out of memory while loading this model: ${message}`
          : featureGate
            ? `This browser cannot run the bundled WebAssembly runtime and no compat build was available: ${message}`
            : `The runtime rejected this model: ${message}`,
        fix: featureGate
          ? 'Use a current Chromium-based browser, or redeploy after `npm run sync:runtime` so the compat build is served.'
          : outOfMemory
          ? 'Close other tabs, choose a smaller quantization (Q4_K_M or lower), or lower the context length, then retry.'
          : 'Check that the GGUF architecture is supported by llama.cpp and that the file is complete, then reinstall it.',
      });
    } finally {
      loading = null;
    }
  })();

  const loaded = await loading;
  return loaded.info;
}

/** Stops any active generation, then frees the context. */
export async function unloadModel(): Promise<void> {
  activeAbort?.abort();
  activeAbort = null;
  if (!handle) return;
  const current = handle;
  handle = null;
  try {
    await current.wllama.exit();
  } catch (error) {
    throw new DeviceAiError({
      code: 'load-failed',
      message: `The runtime could not release the model cleanly: ${error instanceof Error ? error.message : 'unknown'}`,
      fix: 'Reload the tab to reclaim the memory; report this if it repeats.',
    });
  }
}

export function stopGeneration(): void {
  activeAbort?.abort();
}

export interface StreamHandlers {
  onToken: (chunk: string) => void;
}

/**
 * Streams a chat completion from the loaded model.
 *
 * Metrics are measured: first-token latency and tokens/second come from real
 * timestamps, and stay `null` rather than being estimated when unavailable.
 */
export async function generateText(
  request: GenerationRequest,
  handlers: StreamHandlers,
): Promise<GenerationResult> {
  if (!handle) {
    throw new DeviceAiError({
      code: 'not-installed',
      message: 'No local model is loaded',
      fix: 'Load a model from the Local AI panel first.',
    });
  }
  if (request.modelId !== handle.loadedModelId) {
    throw new DeviceAiError({
      code: 'model-busy',
      message: `The loaded model is "${handle.loadedModelId}", not "${request.modelId}"`,
      fix: 'Unload the current model and load the one you selected.',
    });
  }

  const abort = new AbortController();
  activeAbort = abort;
  const onExternalAbort = () => abort.abort();
  request.signal?.addEventListener('abort', onExternalAbort, { once: true });

  const started = performance.now();
  let firstTokenAt: number | null = null;
  let tokens = 0;
  let text = '';
  let stopped = false;

  try {
    await handle.wllama.createChatCompletion({
      messages: request.messages.map((message) => ({ role: message.role, content: message.content })),
      stream: true,
      abortSignal: abort.signal,
      max_tokens: request.maxTokens ?? 256,
      temperature: request.temperature ?? 0.7,
      cache_prompt: true,
      stream_options: undefined,
      onData: (chunk: {
        choices?: Array<{ delta?: { content?: string } }>;
        usage?: { completion_tokens?: number };
      }) => {
        const delta = chunk.choices?.[0]?.delta?.content ?? '';
        if (delta) {
          if (firstTokenAt === null) firstTokenAt = performance.now();
          text += delta;
          tokens += 1;
          handlers.onToken(delta);
        }
      },
    });
  } catch (error) {
    if (abort.signal.aborted) {
      stopped = true;
    } else {
      const message = error instanceof Error ? error.message : 'unknown generation failure';
      const contextFull = /kv cache|context|n_ctx/i.test(message);
      throw new DeviceAiError({
        code: 'generation-failed',
        message: contextFull
          ? `The context window is full: ${message}`
          : `Generation failed: ${message}`,
        fix: contextFull
          ? 'Clear the conversation, raise the context length, or load a model with a larger window.'
          : 'Try a shorter prompt or lower the token limit; if it repeats, reload the model.',
      });
    }
  } finally {
    request.signal?.removeEventListener('abort', onExternalAbort);
    if (activeAbort === abort) activeAbort = null;
  }

  const elapsed = performance.now() - started;
  const decodeMs = firstTokenAt !== null ? performance.now() - firstTokenAt : null;

  return {
    text,
    tokens,
    firstTokenMs: firstTokenAt !== null ? Math.round(firstTokenAt - started) : null,
    tokensPerSecond:
      decodeMs && decodeMs > 0 && tokens > 1
        ? Number(((tokens - 1) / (decodeMs / 1000)).toFixed(2))
        : tokens > 0 && elapsed > 0
          ? Number((tokens / (elapsed / 1000)).toFixed(2))
          : null,
    stopped,
  };
}

/** Reads true model facts from a loaded context (for the detail panel). */
export function loadedMetadata(): { architecture: string; contextLength: number; template: string | null } | null {
  if (!handle) return null;
  try {
    const meta = handle.wllama.getModelMetadata();
    return {
      architecture: meta.meta['general.architecture'] ?? 'unknown',
      contextLength: handle.wllama.getLoadedContextInfo().n_ctx,
      template: handle.wllama.getChatTemplate?.() ?? null,
    };
  } catch {
    return null;
  }
}

export function runtimeErrorPayload(error: unknown): DeviceAiErrorPayload {
  if (error instanceof DeviceAiError) return error.toJSON();
  return {
    code: 'load-failed',
    message: error instanceof Error ? error.message : 'unknown runtime error',
    fix: 'Reload the model from the Local AI panel.',
  };
}
