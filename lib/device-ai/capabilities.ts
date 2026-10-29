'use client';

/**
 * Capability probe (spec §7/§12).
 *
 * Everything here is measured or read from the browser. Nothing is assumed:
 * if `deviceMemory` is absent the estimate says so, and the recommended model
 * ceiling is derived from known storage and (when present) memory rather than
 * from marketing claims about RAM.
 *
 * Limits of this platform are stated explicitly — there is no native host, so
 * background downloads, OS notifications and GPU/NPU inference are not
 * available. See docs/ON_DEVICE_AI.md §Limitations.
 */

import type { DeviceAiCapabilities } from './types';
import { opfsSupported, storageInfo } from './storage';

/** A conservative headroom factor: the runtime needs room beyond the weights. */
const KV_OVERHEAD_FACTOR = 1.35;

function detectWasmSimd(): boolean {
  try {
    // 0xfd 0x0f is the prefixed opcode space used by SIMD; a SIMD-enabled
    // engine rejects this tiny module only on the opcode, not on the wrapper.
    const bytes = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
      0x03, 0x02, 0x01, 0x00, 0x0a, 0x0a, 0x01, 0x08, 0x00, 0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00,
      0x0b,
    ]);
    return WebAssembly.validate(bytes);
  } catch {
    return false;
  }
}

/** One 64-bit memory with a single page — valid only where MEMORY64 exists. */
const MEMORY64_CANARY = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x05, 0x03, 0x01, 0x04, 0x01,
]);

function detectMemory64(): boolean {
  try {
    return WebAssembly.validate(MEMORY64_CANARY);
  } catch {
    return false;
  }
}

/** JSPI ships as `WebAssembly.Suspending`; Asyncify is the fallback. */
function detectJspi(): boolean {
  const wasm = WebAssembly as unknown as { Suspending?: unknown };
  return typeof wasm.Suspending === 'function';
}

function detectWasm(): boolean {
  try {
    return typeof WebAssembly === 'object' && typeof WebAssembly.validate === 'function'
      ? WebAssembly.validate(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]))
      : false;
  } catch {
    return false;
  }
}

export async function probeCapabilities(): Promise<DeviceAiCapabilities> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const wasm = detectWasm();
  const wasmSimd = wasm && detectWasmSimd();
  const wasmMemory64 = wasm && detectMemory64();
  const wasmJspi = wasm && detectJspi();
  // wllama needs JSPI *and* MEMORY64 for its default build; otherwise the
  // compat (Asyncify) build runs — slower, but supported.
  const runtimeBuild: 'default' | 'compat' | 'none' = !wasm
    ? 'none'
    : wasmMemory64 && wasmJspi
      ? 'default'
      : 'compat';
  const isolated =
    typeof globalThis.crossOriginIsolated === 'boolean' ? globalThis.crossOriginIsolated : false;
  const hardwareConcurrency = nav.hardwareConcurrency || 1;
  const opfs = opfsSupported();

  let webgpu = false;
  try {
    webgpu = Boolean((nav as Navigator & { gpu?: unknown }).gpu);
  } catch {
    webgpu = false;
  }

  const storage = await storageInfo().catch(() => null);
  const deviceMemoryGb = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined;

  const notes: string[] = [];
  const limitations: string[] = [
    'No native host: downloads pause when this tab is closed. There is no Android foreground service or OS notification.',
    'Inference runs on the CPU through WebAssembly. No GPU/NPU offload is claimed.',
    'Notifications are in-console only; no operating-system notification is simulated.',
  ];

  if (!wasm) {
    notes.push('WebAssembly is unavailable — local inference cannot run here.');
    return {
      platform: 'browser',
      userAgent: nav.userAgent,
      wasm,
      wasmSimd,
      wasmThreads: false,
      wasmJspi,
      wasmMemory64,
      runtimeBuild,
      crossOriginIsolated: isolated,
      webgpu,
      storageManager: Boolean(nav.storage?.estimate),
      opfs,
      indexedDb: typeof indexedDB !== 'undefined',
      deviceMemoryGb,
      hardwareConcurrency,
      storage: storage
        ? {
            quotaBytes: storage.quotaBytes,
            usageBytes: storage.usageBytes,
            availableBytes: storage.availableBytes,
          }
        : undefined,
      recommendedMaxModelBytes: 0,
      tier: 'unsupported',
      notes,
      limitations,
      probedAt: Date.now(),
    };
  }

  if (!opfs) {
    notes.push(
      'No OPFS: model files cannot be stored on this device, so only tiny models could be held in memory.',
    );
    limitations.push('Model installation is unavailable without origin-private file storage.');
  }

  if (wasmSimd) notes.push('WebAssembly SIMD detected — the faster WASM build will be used.');
  else notes.push('No WebAssembly SIMD — inference will be slower on this browser.');

  if (runtimeBuild === 'default') {
    notes.push('JSPI + MEMORY64 available — running the fast llama.cpp build.');
  } else {
    notes.push(
      'JSPI/MEMORY64 unavailable — running the Asyncify compat build. It works, but decodes several times slower than the default build.',
    );
    limitations.push(
      'This browser uses the compat runtime: expect slower generation. A Chromium-based browser with JSPI + MEMORY64 uses the fast build.',
    );
  }

  if (!isolated) {
    notes.push(
      'Not cross-origin isolated: WASM threads are disabled, so inference is single-threaded.',
    );
    limitations.push(
      'Multi-threaded WASM needs COOP/COEP headers; adding them would break third-party embeds, so single-thread is the default.',
    );
  }

  if (!webgpu) notes.push('WebGPU not exposed — CPU-only inference.');
  if (deviceMemoryGb === undefined) {
    notes.push('navigator.deviceMemory is unavailable here; the model-size ceiling is derived from storage only.');
  }

  const availableBytes = storage?.availableBytes ?? 0;
  const memoryCeilingBytes = deviceMemoryGb ? deviceMemoryGb * 1024 ** 3 * 0.55 : Number.POSITIVE_INFINITY;
  const storageCeilingBytes = availableBytes ? availableBytes / KV_OVERHEAD_FACTOR : 0;
  const recommendedMaxModelBytes = Math.max(
    0,
    Math.floor(Math.min(memoryCeilingBytes, storageCeilingBytes)),
  );

  const cores = hardwareConcurrency;
  const tier: DeviceAiCapabilities['tier'] =
    !opfs || recommendedMaxModelBytes < 120 * 1024 ** 2
      ? 'minimal'
      : recommendedMaxModelBytes < 600 * 1024 ** 2 || cores <= 4
        ? 'capable'
        : 'strong';

  if (recommendedMaxModelBytes > 0) {
    notes.push(
      `Conservative ceiling for a single model here: ≈${(recommendedMaxModelBytes / 1024 ** 2).toFixed(0)} MB (weights plus KV-cache headroom).`,
    );
  }

  return {
    platform: 'browser',
    userAgent: nav.userAgent,
    wasm,
    wasmSimd,
    wasmThreads: false,
    wasmJspi,
    wasmMemory64,
    runtimeBuild,
    crossOriginIsolated: isolated,
    webgpu,
    storageManager: Boolean(nav.storage?.estimate),
    opfs,
    indexedDb: typeof indexedDB !== 'undefined',
    deviceMemoryGb,
    hardwareConcurrency,
    storage: storage
      ? {
          quotaBytes: storage.quotaBytes,
          usageBytes: storage.usageBytes,
          availableBytes: storage.availableBytes,
        }
      : undefined,
    recommendedMaxModelBytes,
    tier,
    notes,
    limitations,
    probedAt: Date.now(),
  };
}
