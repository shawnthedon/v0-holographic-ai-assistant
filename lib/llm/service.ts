import { DEFAULT_MODEL_ID, findModel, listModels } from './catalogue';
import { credentialHint, isConfigured, resolveCredential, type CredentialOverride } from './credentials';
import { PROVIDERS, complete, discover, getProvider, stream, type CallContext } from './providers';
import {
  LLMError,
  type ChatOptions,
  type ChatResult,
  type DiscoveredModel,
  type ModelSpec,
  type ModelStatus,
  type ProviderId,
  type ProviderStatus,
} from './types';
import { providerStatuses } from './credentials';

/**
 * The only entry point the routes use. Resolves a model id to a provider,
 * credential and request adapter, and turns every failure into an LLMError
 * that carries a remediation hint instead of a bare stack trace.
 */

/**
 * Models that have answered a live request in this process. The picker shows a
 * "verified" badge only for these — never for a model that merely has a key.
 * Per-instance memory: on serverless it resets on cold start, so run
 * /api/llm/verify?probe=1 to re-establish it.
 */
const verifiedModels = new Map<string, { at: string; latencyMs: number }>();

export function isVerified(modelId: string): boolean {
  return verifiedModels.has(modelId);
}

export function verifiedAt(modelId: string): string | undefined {
  return verifiedModels.get(modelId)?.at;
}

/**
 * The model used when the caller names none: an operator override, else the
 * first configured catalogue model, else the catalogue default. This is why a
 * deployment with a single provider key works without touching the UI.
 */
export function preferredModelId(): string {
  const override = process.env.DEFAULT_LLM_MODEL?.trim();
  if (override && findModel(override)) return override;

  // A model that just answered in this instance beats a theoretical default.
  const lastVerified = [...verifiedModels.entries()]
    .sort((a, b) => a[1].at.localeCompare(b[1].at))
    .at(-1)?.[0];
  if (lastVerified) return lastVerified;

  const available = new Set(
    providerStatuses()
      .filter((status) => status.configured)
      .map((status) => status.provider),
  );

  const firstConfigured = listModels().find(
    (spec) => available.has(spec.provider) && PROVIDERS[spec.provider]?.kind !== 'unsupported',
  );

  return firstConfigured?.id ?? DEFAULT_MODEL_ID;
}

export interface ResolveOptions {
  modelId?: string;
  credential?: CredentialOverride;
  baseUrl?: string;
}

export interface ResolvedModel {
  spec: ModelSpec;
  provider: ReturnType<typeof getProvider>;
  context: CallContext;
}

export function resolveModel(options: ResolveOptions = {}): ResolvedModel {
  const requested = options.modelId?.trim() || process.env.DEFAULT_LLM_MODEL || preferredModelId();
  const spec = findModel(requested);

  if (!spec) {
    throw new LLMError({
      code: 'unknown-model',
      message: `Unknown model "${requested}"`,
      fix: 'Call GET /api/models for the catalogue, or use "<provider>/<upstream-model>" to address a discovered model.',
      model: requested,
    });
  }

  const provider = PROVIDERS[spec.provider];
  if (!provider) {
    throw new LLMError({
      code: 'unsupported-provider',
      message: `Model "${spec.id}" points at an unknown provider`,
      fix: 'The catalogue entry is stale — check lib/llm/catalogue.ts.',
      model: spec.id,
    });
  }

  if (provider.kind === 'unsupported') {
    throw new LLMError({
      code: 'unsupported-provider',
      message: provider.unsupportedReason || `${provider.label} is not supported`,
      fix: `Add a dedicated adapter for ${provider.label} (${provider.docsUrl}) or choose another model.`,
      provider: provider.id,
      model: spec.id,
    });
  }

  const credential = resolveCredential(spec.provider, {
    apiKey: options.credential?.apiKey,
    baseUrl: options.baseUrl || options.credential?.baseUrl,
  });

  if (provider.requiresKey && !credential.apiKey) {
    throw new LLMError({
      code: 'no-credential',
      message: `No credential configured for ${provider.label} (${credentialHint(spec.provider)})`,
      fix: `Set one of ${provider.envKeys.join(', ')} in the deployment environment, or save a key in Settings → Models.`,
      provider: provider.id,
      model: spec.id,
    });
  }

  if (!provider.requiresKey && !isConfigured(spec.provider, options.credential) && !options.baseUrl) {
    const envVar = {
      ollama: 'OLLAMA_BASE_URL',
      vllm: 'VLLM_BASE_URL',
      litellm: 'LITELLM_BASE_URL',
      custom: 'CUSTOM_LLM_BASE_URL',
    }[provider.id as 'ollama' | 'vllm' | 'litellm' | 'custom'];

    throw new LLMError({
      code: 'config-error',
      message: `${provider.label} is selected but no host is configured`,
      fix: envVar
        ? `Set ${envVar} (e.g. http://127.0.0.1:11434/v1 for Ollama) so the console knows where the runtime listens. A default localhost URL is not treated as configured.`
        : `Set a base URL for ${provider.label}.`,
      provider: provider.id,
      model: spec.id,
    });
  }

  if (!credential.baseUrl) {
    throw new LLMError({
      code: 'config-error',
      message: `${provider.label} has no base URL`,
      fix: `Set ${provider.envKeys.join(' / ')} or pass a base URL for a self-hosted runtime.`,
      provider: provider.id,
      model: spec.id,
    });
  }

  return {
    spec,
    provider,
    context: {
      provider,
      model: spec.upstreamModel,
      baseUrl: credential.baseUrl,
      apiKey: credential.apiKey,
    },
  };
}

export async function chat(options: ChatOptions & ResolveOptions): Promise<ChatResult> {
  const { spec, provider, context } = resolveModel(options);
  const result = await complete(context, options);
  verifiedModels.set(spec.id, { at: new Date().toISOString(), latencyMs: result.latencyMs });
  return {
    ...result,
    execution: spec.execution,
    provider: provider.id,
  };
}

export function chatStream(options: ChatOptions & ResolveOptions): AsyncGenerator<string, void, unknown> {
  const { context } = resolveModel(options);
  return stream(context, options);
}

export function catalogue(): ModelSpec[] {
  return listModels();
}

export function providers(): ProviderStatus[] {
  return providerStatuses();
}

/* ------------------------------------------------------------------ */
/*  bulk discovery                                                     */
/* ------------------------------------------------------------------ */

export interface DiscoveryFailure {
  provider: ProviderId;
  label: string;
  code: string;
  message: string;
  fix: string;
  configured: boolean;
}

export interface DiscoveryResult {
  models: DiscoveredModel[];
  failures: DiscoveryFailure[];
  /** Per-provider totals, so the picker can say "137 live" not just list them. */
  counts: Record<string, number>;
  fetchedAt: string;
  cached: boolean;
}

/**
 * Per-process cache. Discovery costs one HTTP round trip (or several, for a
 * paginated provider) per provider, so the overlay must not trigger it on every
 * render. Five minutes is short enough that a newly deployed model shows up.
 */
const DISCOVERY_TTL_MS = 5 * 60_000;
const discoveryCache = new Map<string, { at: number; value: DiscoveryResult }>();

function cacheKey(ids: ProviderId[] | null): string {
  return ids ? [...ids].sort().join(',') : '*';
}

/**
 * Ask every provider what it serves, in parallel, and report per-provider
 * failures instead of one opaque error. A deployment with three keys and one
 * expired token still gets two full model lists plus the reason for the third.
 */
export async function discoverAll(options: {
  providerIds?: ProviderId[];
  refresh?: boolean;
} = {}): Promise<DiscoveryResult> {
  const ids = options.providerIds?.length ? options.providerIds : null;
  const key = cacheKey(ids);
  const cached = discoveryCache.get(key);
  if (!options.refresh && cached && Date.now() - cached.at < DISCOVERY_TTL_MS) {
    return { ...cached.value, cached: true };
  }

  const targets = providers().filter(
    (entry) => entry.supportsModelList && (!ids || ids.includes(entry.provider)),
  );

  const settled = await Promise.allSettled(
    targets.map(async (entry) => ({
      entry,
      models: await discoverProvider(entry.provider),
    })),
  );

  const models: DiscoveredModel[] = [];
  const failures: DiscoveryFailure[] = [];
  const counts: Record<string, number> = {};
  const seen = new Set<string>();

  settled.forEach((result, index) => {
    const entry = targets[index];
    if (result.status === 'fulfilled') {
      counts[entry.provider] = result.value.models.length;
      for (const model of result.value.models) {
        if (seen.has(model.id)) continue;
        seen.add(model.id);
        models.push(model);
      }
      return;
    }
    const error = result.reason;
    const llmError =
      error instanceof LLMError
        ? error
        : new LLMError({
            code: 'provider-error',
            message: error instanceof Error ? error.message : 'discovery failed',
            fix: `Check the ${entry.label} credential and base URL, then retry.`,
            provider: entry.provider,
          });
    counts[entry.provider] = 0;
    failures.push({
      provider: entry.provider,
      label: entry.label,
      code: llmError.code,
      message: llmError.message,
      fix: llmError.fix,
      configured: entry.configured,
    });
  });

  const value: DiscoveryResult = {
    models,
    failures,
    counts,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
  discoveryCache.set(key, { at: Date.now(), value });
  return value;
}

export async function discoverProvider(providerId: ProviderId): Promise<DiscoveredModel[]> {
  const provider = getProvider(providerId);
  const credential = resolveCredential(providerId);
  if (provider.requiresKey && !credential.apiKey) {
    throw new LLMError({
      code: 'no-credential',
      message: `No credential configured for ${provider.label}`,
      fix: `Set one of ${provider.envKeys.join(', ')} to list its models.`,
      provider: providerId,
    });
  }
  return discover(provider, credential.baseUrl, credential.apiKey);
}

/* ------------------------------------------------------------------ */
/*  verification sweep                                                 */
/* ------------------------------------------------------------------ */

export interface VerifyOptions {
  /** Actually send a 1-token completion to each model. */
  probe?: boolean;
  /** Ask each configured provider what it serves and verify up to 4 of those. */
  includeDiscovered?: boolean;
  /** Restrict the sweep, e.g. ['openrouter/qwen-2.5-72b-instruct']. */
  modelIds?: string[];
  /** Per-request timeout. */
  timeoutMs?: number;
}

export interface VerifyReport {
  generatedAt: string;
  runtime: { node: string; region: string; deployment: string };
  summary: {
    models: number;
    configured: number;
    probed: number;
    passed: number;
    failed: number;
    blocked: number;
  };
  providers: ProviderStatus[];
  models: ModelStatus[];
  /** Present when discovery ran: which providers answered, and which did not. */
  discovery?: Array<{ provider: string; error?: string }>;
  services: ServiceStatus[];
}

export interface ServiceStatus {
  name: 'chat' | 'speech' | 'speech-recognition' | 'voice-clone' | 'persona';
  status: 'ready' | 'missing-credential' | 'mock' | 'partial';
  detail: string;
  fix: string;
}

export function serviceStatuses(): ServiceStatus[] {
  const googleKey = Boolean(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
  const elevenKey = Boolean(process.env.ELEVENLABS_API_KEY);

  return [
    {
      name: 'chat',
      status: providers().some((provider) => provider.configured && provider.kind !== 'unsupported')
        ? 'ready'
        : 'missing-credential',
      detail: 'POST /api/chat → resolved model adapter.',
      fix: 'Set a provider key (OPENROUTER_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, GROQ_API_KEY, …).',
    },
    {
      name: 'speech',
      status: googleKey && elevenKey ? 'ready' : googleKey || elevenKey ? 'partial' : 'missing-credential',
      detail:
        `/api/speech providers → google:${googleKey ? 'configured' : 'missing'}, elevenlabs:${elevenKey ? 'configured' : 'missing'}.`,
      fix: 'Set GOOGLE_API_KEY (Neural2) and/or ELEVENLABS_API_KEY for TTS. No streaming/chunk queue yet — see docs/LLM_VERIFICATION.md.',
    },
    {
      name: 'speech-recognition',
      status: 'partial',
      detail: 'Browser Web Speech API (webkitSpeechRecognition) — Chrome-only and needs network.',
      fix: 'Add a local STT engine (whisper.cpp / Qwen2.5-Omni ASR) behind /api/stt for offline, cross-browser input.',
    },
    {
      name: 'voice-clone',
      status: process.env.ELEVENLABS_API_KEY ? 'ready' : 'missing-credential',
      detail: process.env.ELEVENLABS_API_KEY
        ? '/api/voice-clone → ElevenLabs /v1/voices/add (consent + 10 MB + MIME validation).'
        : '/api/voice-clone validates input then reports no-credential (no mock audio).',
      fix: 'Set ELEVENLABS_API_KEY for hosted cloning, or integrate a local engine (XTTS/RVC) behind the same route. Profile deletion/revocation UI is still missing.',
    },
    {
      name: 'persona',
      status: 'partial',
      detail: '/api/persona returns 501 (X-Mock) — no PersonaPlex runtime is configured; it no longer reports fake success.',
      fix: 'Set NEXT_PUBLIC_BACKEND_URL to a duplex runtime and implement the handler, or route persona turns through /api/chat.',
    },
  ];
}

export async function verify(options: VerifyOptions = {}): Promise<VerifyReport> {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const statuses = providers();
  const configuredProviders = new Set(
    statuses.filter((status) => status.configured).map((status) => status.provider),
  );

  const models = (options.modelIds?.length
    ? options.modelIds.map((id) => findModel(id)).filter((entry): entry is ModelSpec => Boolean(entry))
    : listModels());

  // A sweep limited to the curated list misses models a provider actually
  // serves — and misses a provider whose curated entries are all wrong.
  const discoveryNotes: Array<{ provider: string; error?: string }> = [];
  if (options.includeDiscovered) {
    const known = new Set(models.map((entry) => entry.id));
    for (const status of statuses) {
      const provider = PROVIDERS[status.provider];
      if (!status.configured || !provider.supportsModelList || provider.kind === 'unsupported') continue;
      try {
        const found = await discover(provider, resolveCredential(status.provider).baseUrl, resolveCredential(status.provider).apiKey);
        discoveryNotes.push({ provider: provider.id });
        for (const entry of found.slice(0, 4)) {
          if (known.has(entry.id)) continue;
          known.add(entry.id);
          models.push({
            id: entry.id,
            label: entry.label,
            provider: entry.provider,
            upstreamModel: entry.upstreamModel,
            roles: ['chat'],
            execution: ['ollama', 'vllm', 'litellm', 'custom'].includes(provider.id) ? 'self-hosted' : 'cloud',
            contextWindow: entry.contextWindow,
            notes: 'Discovered from the provider during verification.',
          });
        }
      } catch (error) {
        discoveryNotes.push({
          provider: provider.id,
          error: error instanceof Error ? error.message : 'discovery failed',
        });
      }
    }
  }

  const results: ModelStatus[] = [];
  let probeAttempts = 0;

  for (const spec of models) {
    const provider = PROVIDERS[spec.provider];
    const configured = configuredProviders.has(spec.provider);

    const base: ModelStatus = {
      id: spec.id,
      label: spec.label,
      provider: spec.provider,
      upstreamModel: spec.upstreamModel,
      roles: spec.roles,
      execution: spec.execution,
      configured,
      reachable: null,
    };

    if (provider.kind === 'unsupported') {
      results.push({
        ...base,
        reachable: false,
        error: {
          code: 'unsupported-provider',
          message: provider.unsupportedReason || 'unsupported provider',
          fix: `Implement an adapter that follows ${provider.docsUrl}, or remove the entry from the catalogue.`,
        },
        evidence: 'adapter refuses to build a request (no network call attempted)',
      });
      continue;
    }

    if (!configured) {
      const keyless = !provider.requiresKey;
      results.push({
        ...base,
        reachable: false,
        error: keyless
          ? {
              code: 'config-error',
              message: `${provider.label} has no host configured`,
              fix: `Set ${
                { ollama: 'OLLAMA_BASE_URL', vllm: 'VLLM_BASE_URL', litellm: 'LITELLM_BASE_URL', custom: 'CUSTOM_LLM_BASE_URL' }[
                  provider.id as 'ollama' | 'vllm' | 'litellm' | 'custom'
                ] ?? 'a base URL'
              } to the address of the local runtime.`,
            }
          : {
              code: 'no-credential',
              message: `No credential for ${provider.label} (${credentialHint(spec.provider)})`,
              fix: `Set ${provider.envKeys.join(' or ')} in the deployment environment.`,
            },
        evidence: 'configuration check only',
      });
      continue;
    }

    if (!options.probe) {
      results.push({
        ...base,
        reachable: null,
        evidence: 'credential present — run with ?probe=1 to send a live request',
      });
      continue;
    }

    probeAttempts += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await chat({
        modelId: spec.id,
        messages: [
          { role: 'system', content: 'You are a health probe. Reply with the single word OK.' },
          { role: 'user', content: 'ping' },
        ],
        maxTokens: 8,
        temperature: 0,
        signal: controller.signal,
      });
      verifiedModels.set(spec.id, { at: new Date().toISOString(), latencyMs: result.latencyMs });
      results.push({
        ...base,
        reachable: true,
        latencyMs: result.latencyMs,
        evidence: `reply: "${result.text.slice(0, 24).replace(/\s+/g, ' ')}"`,
      });
    } catch (error) {
      const llmError =
        error instanceof LLMError
          ? error
          : new LLMError({
              code: 'provider-error',
              message: error instanceof Error ? error.message : 'unknown error',
              fix: 'Inspect the provider response and the adapter mapping.',
            });
      results.push({
        ...base,
        reachable: false,
        error: { code: llmError.code, message: llmError.message, fix: llmError.fix },
        evidence: controller.signal.aborted ? 'probe timed out' : 'live probe failed',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  const passed = results.filter((entry) => entry.reachable === true).length;

  return {
    generatedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      region: process.env.VERCEL_REGION || 'local',
      deployment: process.env.VERCEL_URL || 'local',
    },
    summary: {
      models: results.length,
      configured: results.filter((entry) => entry.configured).length,
      probed: probeAttempts,
      passed,
      failed: results.filter((entry) => entry.reachable === false && entry.configured).length,
      blocked: results.filter((entry) => !entry.configured).length,
    },
    providers: statuses,
    models: results,
    discovery: options.includeDiscovered ? discoveryNotes : undefined,
    services: serviceStatuses(),
  };
}

export { LLMError };
export type { ChatOptions, ChatResult, ModelSpec, ModelStatus, ProviderStatus };
