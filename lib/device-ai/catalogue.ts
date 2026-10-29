/**
 * Preset local-model catalogue (spec §9).
 *
 * These are candidate families, not guarantees. Each entry names the exact
 * Hugging Face repo, the quantization, the licence and the model card. Because
 * this build environment has no egress to huggingface.co, the exact file names
 * are marked `verification: 'unverified'` — the UI confirms them against the
 * Hub before downloading ("browse files"), and the installer validates the real
 * bytes (GGUF magic, header, architecture, size) before a model is listed as
 * installed. A stale URL fails loudly instead of installing garbage.
 *
 * No RAM claims are made anywhere: sizes are file sizes, and the caution
 * string says so.
 */

import type { CatalogueModel } from './types';

export const RAM_CAUTION =
  'File size is the download size, not a RAM figure. Runtime memory = weights + KV cache + overhead and varies by device, context length and quantization. Loads are refused when the model exceeds this device’s conservative ceiling.';

const HF = 'https://huggingface.co';

function hf(repo: string, file: string): string {
  return `${HF}/${repo}/resolve/main/${file}`;
}

export const LOCAL_CATALOGUE: CatalogueModel[] = [
  {
    id: 'local/smollm2-135m-q4km',
    name: 'SmolLM2 135M Instruct',
    family: 'SmolLM2',
    approxBytes: 105 * 1024 ** 2,
    quantization: 'Q4_K_M',
    contextLength: 8192,
    licence: 'Apache-2.0',
    modelCard: `${HF}/HuggingFaceTB/SmolLM2-135M-Instruct`,
    downloadUrl: hf('bartowski/SmolLM2-135M-Instruct-GGUF', 'SmolLM2-135M-Instruct-Q4_K_M.gguf'),
    runtimeNotes: 'Smallest useful default; expect terse answers.',
    verification: 'unverified',
  },
  {
    id: 'local/smollm2-360m-q4km',
    name: 'SmolLM2 360M Instruct',
    family: 'SmolLM2',
    approxBytes: 230 * 1024 ** 2,
    quantization: 'Q4_K_M',
    contextLength: 8192,
    licence: 'Apache-2.0',
    modelCard: `${HF}/HuggingFaceTB/SmolLM2-360M-Instruct`,
    downloadUrl: hf('bartowski/SmolLM2-360M-Instruct-GGUF', 'SmolLM2-360M-Instruct-Q4_K_M.gguf'),
    verification: 'unverified',
  },
  {
    id: 'local/qwen2.5-0.5b-q4km',
    name: 'Qwen2.5 0.5B Instruct',
    family: 'Qwen2.5',
    approxBytes: 398 * 1024 ** 2,
    quantization: 'Q4_K_M',
    contextLength: 32768,
    licence: 'Apache-2.0',
    modelCard: `${HF}/Qwen/Qwen2.5-0.5B-Instruct`,
    downloadUrl: hf('bartowski/Qwen2.5-0.5B-Instruct-GGUF', 'Qwen2.5-0.5B-Instruct-Q4_K_M.gguf'),
    runtimeNotes: 'Good general-purpose floor; chat template ships in the GGUF.',
    verification: 'unverified',
  },
  {
    id: 'local/llama-3.2-1b-q4km',
    name: 'Llama 3.2 1B Instruct',
    family: 'Llama 3.2',
    approxBytes: 808 * 1024 ** 2,
    quantization: 'Q4_K_M',
    contextLength: 131072,
    licence: 'Llama 3.2 Community Licence',
    licenceNote:
      'Meta licence with attribution and acceptable-use terms. Review before redistribution; weights are not bundled with this app.',
    modelCard: `${HF}/meta-llama/Llama-3.2-1B-Instruct`,
    downloadUrl: hf('bartowski/Llama-3.2-1B-Instruct-GGUF', 'Llama-3.2-1B-Instruct-Q4_K_M.gguf'),
    verification: 'unverified',
  },
  {
    id: 'local/deepseek-r1-distill-qwen-1.5b-q4km',
    name: 'DeepSeek-R1-Distill-Qwen 1.5B',
    family: 'DeepSeek R1 Distill',
    approxBytes: 1120 * 1024 ** 2,
    quantization: 'Q4_K_M',
    contextLength: 32768,
    licence: 'MIT (distill) — base Qwen2.5 Apache-2.0',
    modelCard: `${HF}/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B`,
    downloadUrl: hf(
      'bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF',
      'DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf',
    ),
    runtimeNotes:
      'Reasoning-oriented: emits long thinking traces, so it is slower and uses more context. Reasoning quality is not guaranteed on a 1.5B model.',
    resourceHeavy: true,
    verification: 'unverified',
  },
  {
    id: 'local/llama-3.2-3b-q4km',
    name: 'Llama 3.2 3B Instruct',
    family: 'Llama 3.2',
    approxBytes: 2020 * 1024 ** 2,
    quantization: 'Q4_K_M',
    contextLength: 131072,
    licence: 'Llama 3.2 Community Licence',
    licenceNote: 'Meta licence with attribution and acceptable-use terms.',
    modelCard: `${HF}/meta-llama/Llama-3.2-3B-Instruct`,
    downloadUrl: hf('bartowski/Llama-3.2-3B-Instruct-GGUF', 'Llama-3.2-3B-Instruct-Q4_K_M.gguf'),
    resourceHeavy: true,
    verification: 'unverified',
  },
];

export function findCatalogueModel(id: string): CatalogueModel | null {
  return LOCAL_CATALOGUE.find((entry) => entry.id === id) ?? null;
}

/* ------------------------- URL safety (spec §11) ------------------------- */

const DOWNLOAD_HOSTS = [
  'huggingface.co',
  'cdn-lfs.huggingface.co',
  'cdn-lfs-us-1.huggingface.co',
  'cdn-lfs-eu-1.huggingface.co',
];

/** Hosts the byte-proxy may fetch from (kept in sync with the route). */
export const PROXY_ALLOWED_HOSTS = DOWNLOAD_HOSTS;

/**
 * Rejects anything that is not a plain HTTPS model download.
 *
 * Guards against `javascript:`, `data:`, credentials in the URL, private
 * addresses and path traversal in the file segment.
 */
export function assertSafeDownloadUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('That is not a valid URL.');
  }

  if (url.protocol !== 'https:') throw new Error('Only https:// downloads are allowed.');
  if (url.username || url.password) throw new Error('URLs with embedded credentials are refused.');
  if (!DOWNLOAD_HOSTS.includes(url.hostname)) {
    throw new Error(
      `Host "${url.hostname}" is not an approved model host (${DOWNLOAD_HOSTS.join(', ')}).`,
    );
  }
  // Normalised URLs already resolve literal `../`, so decode first: an encoded
  // traversal must not slip past the check and be re-interpreted downstream.
  let decodedPath = url.pathname;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    throw new Error('The URL contains malformed percent-encoding.');
  }
  if (decodedPath.includes('..') || url.pathname.includes('..')) {
    throw new Error('Path traversal is not allowed in a model URL.');
  }
  if (!/\.gguf$/i.test(url.pathname)) throw new Error('The URL does not point at a .gguf file.');
  return url;
}

/** Derives a stable, readable model id from a URL or file name. */
export function idFromFileName(fileName: string): string {
  let tail = fileName.split('/').pop() ?? fileName;
  try {
    tail = decodeURIComponent(tail);
  } catch {
    /* keep the raw segment if the encoding is malformed */
  }
  const base = tail
    .replace(/\.gguf$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return `local/${base || 'model'}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value >= 100 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}
