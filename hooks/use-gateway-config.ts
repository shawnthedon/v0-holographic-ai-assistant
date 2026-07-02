'use client';

import { useState, useCallback, useEffect } from 'react';
import { GatewayProvider, GatewayConfig } from '@/lib/unified-gateway';
import { GatewayConfigResponse } from '@/lib/gateway-config-manager';

interface GatewayState {
  isLoading: boolean;
  isSaving: boolean;
  isTesting: boolean;
  config: GatewayConfigResponse | null;
  error: string | null;
  testResult: { success: boolean; error?: string } | null;
}

export function useGatewayConfig() {
  const [state, setState] = useState<GatewayState>({
    isLoading: true,
    isSaving: false,
    isTesting: false,
    config: null,
    error: null,
    testResult: null,
  });

  // Load current config on mount
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const response = await fetch('/api/gateway/config', {
        headers: {
          'x-user-id': 'default', // In production, use actual user ID
        },
      });

      if (response.status === 404) {
        setState((prev) => ({ ...prev, isLoading: false, config: null }));
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to load config');
      }

      const config = await response.json();
      setState((prev) => ({ ...prev, isLoading: false, config }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }));
    }
  }, []);

  const saveConfig = useCallback(
    async (configData: {
      provider: GatewayProvider;
      model: string;
      baseUrl?: string;
      timeout?: number;
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      apiKey: string;
    }) => {
      setState((prev) => ({ ...prev, isSaving: true, error: null }));
      try {
        const response = await fetch('/api/gateway/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': 'default',
          },
          body: JSON.stringify(configData),
        });

        if (!response.ok) {
          throw new Error('Failed to save configuration');
        }

        const result = await response.json();
        setState((prev) => ({
          ...prev,
          isSaving: false,
          config: result.config,
        }));

        return result.config;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        setState((prev) => ({
          ...prev,
          isSaving: false,
          error: errorMsg,
        }));
        throw error;
      }
    },
    []
  );

  const testConnection = useCallback(
    async (configData: {
      provider: GatewayProvider;
      model: string;
      baseUrl?: string;
      timeout?: number;
      apiKey: string;
    }) => {
      setState((prev) => ({ ...prev, isTesting: true, testResult: null }));
      try {
        const response = await fetch('/api/gateway/test', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(configData),
        });

        if (!response.ok) {
          throw new Error('Test request failed');
        }

        const result = await response.json();
        setState((prev) => ({ ...prev, isTesting: false, testResult: result }));

        return result;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        const result = { success: false, error: errorMsg };
        setState((prev) => ({
          ...prev,
          isTesting: false,
          testResult: result,
        }));
        throw error;
      }
    },
    []
  );

  const deleteConfig = useCallback(async () => {
    setState((prev) => ({ ...prev, isSaving: true, error: null }));
    try {
      const response = await fetch('/api/gateway/config', {
        method: 'DELETE',
        headers: {
          'x-user-id': 'default',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to delete configuration');
      }

      setState((prev) => ({
        ...prev,
        isSaving: false,
        config: null,
      }));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setState((prev) => ({
        ...prev,
        isSaving: false,
        error: errorMsg,
      }));
      throw error;
    }
  }, []);

  return {
    ...state,
    loadConfig,
    saveConfig,
    testConnection,
    deleteConfig,
  };
}
