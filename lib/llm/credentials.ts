import { PROVIDERS, getProvider } from './providers';
import type { ProviderId, ProviderStatus } from './types';

/**
 * Credential resolution, server-side only.
 *
 * Order of precedence:
 *   1. per-user encrypted override (settings → gateway config)
 *   2. environment variables for this deployment
 *   3. none — reported explicitly, never silently defaulted
 *
 * Nothing here reads process.env into a client bundle; every export is used
 * from route handlers only.
 */

export interface ResolvedCredential {
  apiKey: string;
  baseUrl: string;
  source: 'env' | 'user' | 'none';
}

export interface CredentialOverride {
  apiKey?: string;
  baseUrl?: string;
}

const BASE_URL_ENV: Partial<Record<ProviderId, string>> = {
  ollama: 'OLLAMA_BASE_URL',
  vllm: 'VLLM_BASE_URL',
  litellm: 'LITELLM_BASE_URL',
  custom: 'CUSTOM_LLM_BASE_URL',
};

function envValue(keys: string[]): { value: string; key?: string } {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim()) return { value: value.trim(), key };
  }
  return { value: '' };
}

export function resolveCredential(
  providerId: ProviderId,
  override?: CredentialOverride,
): ResolvedCredential {
  const provider = getProvider(providerId);

  const baseUrlEnv = BASE_URL_ENV[providerId];
  const envBaseUrl = baseUrlEnv ? process.env[baseUrlEnv]?.trim() : undefined;

  if (override?.apiKey) {
    return {
      apiKey: override.apiKey,
      baseUrl: override.baseUrl?.trim() || envBaseUrl || provider.defaultBaseUrl,
      source: 'user',
    };
  }

  const { value } = envValue(provider.envKeys);

  if (value) {
    return {
      apiKey: value,
      baseUrl: override?.baseUrl?.trim() || envBaseUrl || provider.defaultBaseUrl,
      source: 'env',
    };
  }

  // keyless local runtimes still need a host the operator actually pointed at;
  // the catalogue's defaultBaseUrl is a suggestion, not evidence of a runtime.
  const explicitBase = override?.baseUrl?.trim() || envBaseUrl;
  if (!provider.requiresKey && explicitBase) {
    return { apiKey: '', baseUrl: explicitBase, source: 'env' };
  }

  return {
    apiKey: '',
    baseUrl: override?.baseUrl?.trim() || envBaseUrl || provider.defaultBaseUrl,
    source: 'none',
  };
}

export function isConfigured(providerId: ProviderId, override?: CredentialOverride): boolean {
  const provider = PROVIDERS[providerId];
  if (!provider) return false;
  if (provider.kind === 'unsupported') return false;

  const credential = resolveCredential(providerId, override);
  if (provider.requiresKey) return Boolean(credential.apiKey);

  // keyless local runtimes only count as configured when the operator has
  // pointed at a host explicitly — a default localhost URL is not evidence
  // that anything is listening there.
  const baseUrlEnv = BASE_URL_ENV[providerId];
  const explicit = Boolean(override?.baseUrl?.trim() || (baseUrlEnv && process.env[baseUrlEnv]?.trim()));
  return explicit && Boolean(credential.baseUrl);
}

export function providerStatuses(overrides?: Partial<Record<ProviderId, CredentialOverride>>): ProviderStatus[] {
  return Object.values(PROVIDERS).map((provider) => {
    const credential = resolveCredential(provider.id, overrides?.[provider.id]);
    const configured = isConfigured(provider.id, overrides?.[provider.id]);
    return {
      provider: provider.id,
      label: provider.label,
      kind: provider.kind,
      configured,
      source: credential.source,
      baseUrl: credential.baseUrl,
      requiresKey: provider.requiresKey,
      supportsModelList: provider.supportsModelList,
      docsUrl: provider.docsUrl,
      envKeys: provider.envKeys,
      note: provider.unsupportedReason,
    };
  });
}

/** Non-secret hint of which key var is populated, for diagnostics only. */
export function credentialHint(providerId: ProviderId): string {
  const provider = PROVIDERS[providerId];
  if (!provider) return 'unknown provider';
  const { key } = envValue(provider.envKeys);
  if (key) return `${key} is set`;
  if (!provider.requiresKey) return 'no key required';
  return `none of ${provider.envKeys.join(', ')} is set`;
}
