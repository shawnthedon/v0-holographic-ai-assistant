'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DiscoveredModel, ModelSpec, ProviderId, ProviderStatus } from '@/lib/llm/types';

export interface CatalogueModel extends ModelSpec {
  configured: boolean;
  /** `provider` = discovered live from the provider's /models endpoint. */
  source?: 'catalogue' | 'provider';
}

interface CatalogueResponse {
  defaultModelId: string;
  models: CatalogueModel[];
  providers: ProviderStatus[];
  discovered?: DiscoveredModel[];
  discoverError?: { code: string; message: string; fix: string };
}

const STORAGE_KEY = 'nexus.llm.model';

/**
 * Loads the server catalogue and remembers the operator's choice.
 *
 * The selection is a model *id*, resolved server-side on every request — the
 * browser never holds a provider credential.
 */
export function useModelCatalogue() {
  const [state, setState] = useState<{
    loading: boolean;
    error: string | null;
    models: CatalogueModel[];
    providers: ProviderStatus[];
    defaultModelId: string;
  }>({ loading: true, error: null, models: [], providers: [], defaultModelId: '' });

  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [discovered, setDiscovered] = useState<DiscoveredModel[]>([]);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState<ProviderId | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/models', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Catalogue request failed (${response.status})`);
      const data = (await response.json()) as CatalogueResponse;
      setState({
        loading: false,
        error: null,
        models: (data.models ?? []).map((entry) => ({ ...entry, source: 'catalogue' as const })),
        providers: data.providers ?? [],
        defaultModelId: data.defaultModelId ?? '',
      });
      setSelectedModelId((current) => {
        if (current) return current;
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
        if (stored && (data.models ?? []).some((entry) => entry.id === stored)) return stored;
        return data.defaultModelId ?? data.models?.[0]?.id ?? '';
      });
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load model catalogue',
      }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const select = useCallback((modelId: string) => {
    setSelectedModelId(modelId);
    try {
      window.localStorage.setItem(STORAGE_KEY, modelId);
    } catch {
      /* private mode — selection still applies for this session */
    }
  }, []);

  const discover = useCallback(async (provider: ProviderId) => {
    setDiscovering(provider);
    setDiscoverError(null);
    try {
      const response = await fetch(`/api/models?discover=${encodeURIComponent(provider)}`, {
        cache: 'no-store',
      });
      const data = (await response.json()) as CatalogueResponse;
      if (data.discoverError) {
        setDiscoverError(`${data.discoverError.message} — ${data.discoverError.fix}`);
        setDiscovered([]);
        return [];
      }
      setDiscovered(data.discovered ?? []);
      return data.discovered ?? [];
    } catch (error) {
      setDiscoverError(error instanceof Error ? error.message : 'Discovery failed');
      return [];
    } finally {
      setDiscovering(null);
    }
  }, []);

  const configuredProviders = useMemo(
    () => state.providers.filter((entry) => entry.configured).map((entry) => entry.provider),
    [state.providers],
  );

  /**
   * Discovered models are merged into the same list the picker renders, so a
   * model the provider advertises is actually selectable — not just printed.
   */
  const fusedModels = useMemo<CatalogueModel[]>(() => {
    const local = new Set<ProviderId>(['ollama', 'vllm', 'litellm', 'custom']);
    const seen = new Set(state.models.map((entry) => entry.id));
    const added = discovered
      .filter((entry) => !seen.has(entry.id))
      .map<CatalogueModel>((entry) => ({
        id: entry.id,
        label: entry.label,
        provider: entry.provider,
        upstreamModel: entry.upstreamModel,
        roles: ['chat'],
        execution: local.has(entry.provider) ? 'self-hosted' : 'cloud',
        contextWindow: entry.contextWindow,
        notes: 'Discovered live from the provider — not in the curated catalogue.',
        configured: entry.configured ?? configuredProviders.includes(entry.provider),
        verified: entry.verified ?? false,
        source: 'provider',
      }));

    return [...state.models, ...added];
  }, [configuredProviders, discovered, state.models]);

  const selected = useMemo(
    () => fusedModels.find((entry) => entry.id === selectedModelId) ?? null,
    [fusedModels, selectedModelId],
  );

  return {
    ...state,
    models: fusedModels,
    selected,
    selectedModelId,
    select,
    reload: load,
    discover,
    discovered,
    discovering,
    discoverError,
    configuredProviders,
  };
}
