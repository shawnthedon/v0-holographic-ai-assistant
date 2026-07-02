'use client';

import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Eye, EyeOff } from 'lucide-react';
import { motion } from 'framer-motion';
import { useGatewayConfig } from '@/hooks/use-gateway-config';
import { GatewayProvider } from '@/lib/unified-gateway';
import { GatewayConfigManager } from '@/lib/gateway-config-manager';

type GatewayProviderType = GatewayProvider;

interface GatewayConfigProps {
  onConfigChange?: (provider: GatewayProviderType, model: string) => void;
}

const PROVIDERS: Array<{ id: GatewayProviderType; label: string; description: string }> = [
  { id: 'openrouter', label: 'OpenRouter', description: '500+ models aggregated' },
  { id: 'huggingface', label: 'Hugging Face', description: 'Open source models' },
  { id: 'bedrock', label: 'AWS Bedrock', description: 'Enterprise AWS integration' },
  { id: 'litelm', label: 'LiteLLM', description: 'Unified proxy gateway' },
  { id: 'ollama', label: 'Ollama', description: 'Local models' },
  { id: 'openai', label: 'OpenAI', description: 'OpenAI API' },
  { id: 'anthropic', label: 'Anthropic', description: 'Claude models' },
  { id: 'cohere', label: 'Cohere', description: 'Cohere API' },
];

const PROVIDER_INFO: Record<
  GatewayProviderType,
  { defaultBaseUrl?: string; requiresAuth: boolean; supportedModels: number }
> = {
  openrouter: { defaultBaseUrl: 'https://openrouter.ai/api/v1', requiresAuth: true, supportedModels: 500 },
  huggingface: { defaultBaseUrl: 'https://api-inference.huggingface.co/v1', requiresAuth: true, supportedModels: 150 },
  bedrock: { defaultBaseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com', requiresAuth: true, supportedModels: 20 },
  litelm: { defaultBaseUrl: 'http://0.0.0.0:4000', requiresAuth: false, supportedModels: 0 },
  ollama: { defaultBaseUrl: 'http://localhost:11434/v1', requiresAuth: false, supportedModels: 0 },
  openai: { defaultBaseUrl: 'https://api.openai.com/v1', requiresAuth: true, supportedModels: 10 },
  anthropic: { defaultBaseUrl: 'https://api.anthropic.com', requiresAuth: true, supportedModels: 5 },
  cohere: { defaultBaseUrl: 'https://api.cohere.com/v1', requiresAuth: true, supportedModels: 3 },
};

export function GatewayConfig({ onConfigChange }: GatewayConfigProps) {
  const { config, isLoading, isSaving, isTesting, error, testResult, saveConfig, testConnection, loadConfig } =
    useGatewayConfig();

  const [selectedProvider, setSelectedProvider] = useState<GatewayProviderType>('openrouter');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2000);
  const [topP, setTopP] = useState(1);
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  // Initialize from stored config
  useEffect(() => {
    if (config && !isLoading) {
      setSelectedProvider(config.provider as GatewayProviderType);
      setModel(config.model);
      setBaseUrl(config.baseUrl || '');
      setTemperature(config.temperature || 0.7);
      setMaxTokens(config.maxTokens || 2000);
      setTopP(config.topP || 1);
    }
  }, [config, isLoading]);

  // Load models when provider changes
  useEffect(() => {
    loadModels();
  }, [selectedProvider]);

  const loadModels = async () => {
    setIsLoadingModels(true);
    try {
      const response = await fetch(`/api/gateway/models?provider=${selectedProvider}`);
      if (response.ok) {
        const data = await response.json();
        setAvailableModels(data.models);
        if (data.models.length > 0 && !model) {
          setModel(data.models[0].id);
        }
      }
    } catch (error) {
      console.error('[v0] Failed to load models:', error);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleProviderChange = (provider: GatewayProviderType) => {
    setSelectedProvider(provider);
    const info = PROVIDER_INFO[provider];
    setBaseUrl(info.defaultBaseUrl || '');
  };

  const handleSaveConfig = async () => {
    if (!apiKey) {
      alert('API key is required');
      return;
    }

    try {
      await saveConfig({
        provider: selectedProvider,
        model,
        baseUrl: baseUrl || undefined,
        temperature,
        maxTokens,
        topP,
        apiKey,
      });

      onConfigChange?.(selectedProvider, model);
      setApiKey(''); // Clear from state after saving
    } catch (error) {
      console.error('[v0] Failed to save config:', error);
    }
  };

  const handleTestConnection = async () => {
    if (!apiKey) {
      alert('API key is required to test');
      return;
    }

    try {
      const result = await testConnection({
        provider: selectedProvider,
        model,
        baseUrl: baseUrl || undefined,
        apiKey,
      });
    } catch (error) {
      console.error('[v0] Test failed:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-foreground/60" />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
      {/* Provider Selector */}
      <div className="space-y-3">
        <label className="block text-sm font-semibold text-foreground">LLM Provider</label>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              onClick={() => handleProviderChange(provider.id)}
              className={`p-3 rounded-lg border-2 transition-all text-left ${
                selectedProvider === provider.id
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-background hover:border-primary/50'
              }`}
            >
              <div className="text-sm font-semibold text-foreground">{provider.label}</div>
              <div className="text-xs text-foreground/60 mt-1">{provider.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Model Selector */}
      <div className="space-y-3">
        <label className="block text-sm font-semibold text-foreground">Model</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={isLoadingModels}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground disabled:opacity-50"
        >
          <option value="">
            {isLoadingModels ? 'Loading models...' : 'Select a model'}
          </option>
          {availableModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} {m.contextLength ? `(${m.contextLength.toLocaleString()} tokens)` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* API Key Input */}
      <div className="space-y-3">
        <label className="block text-sm font-semibold text-foreground">API Key</label>
        <div className="relative">
          <input
            type={showApiKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-... or your API key"
            className="w-full px-3 py-2 pr-10 rounded-lg border border-border bg-background text-foreground placeholder:text-foreground/40"
          />
          <button
            type="button"
            onClick={() => setShowApiKey(!showApiKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/60 hover:text-foreground"
          >
            {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        {config?.masked && (
          <p className="text-xs text-foreground/60">Stored key: {config.masked}</p>
        )}
      </div>

      {/* Custom Base URL */}
      <div className="space-y-3">
        <label className="block text-sm font-semibold text-foreground">Base URL (Optional)</label>
        <input
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={PROVIDER_INFO[selectedProvider].defaultBaseUrl}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground placeholder:text-foreground/40"
        />
        <p className="text-xs text-foreground/60">Override default endpoint (for local/self-hosted)</p>
      </div>

      {/* Advanced Settings */}
      <div className="space-y-4 p-4 rounded-lg bg-background/50 border border-border">
        <h3 className="text-sm font-semibold text-foreground">Advanced Settings</h3>

        <div className="space-y-3">
          <label className="block text-sm text-foreground/80">
            Temperature: <span className="font-semibold">{temperature.toFixed(2)}</span>
          </label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="space-y-3">
          <label className="block text-sm text-foreground/80">
            Max Tokens: <span className="font-semibold">{maxTokens}</span>
          </label>
          <input
            type="range"
            min="100"
            max="8000"
            step="100"
            value={maxTokens}
            onChange={(e) => setMaxTokens(parseInt(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="space-y-3">
          <label className="block text-sm text-foreground/80">
            Top P: <span className="font-semibold">{topP.toFixed(2)}</span>
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={topP}
            onChange={(e) => setTopP(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>
      </div>

      {/* Test Connection */}
      <button
        onClick={handleTestConnection}
        disabled={isTesting || !apiKey}
        className="w-full px-4 py-2 rounded-lg border border-border bg-background text-foreground hover:bg-foreground/5 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
      >
        {isTesting ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            Testing...
          </>
        ) : (
          'Test Connection'
        )}
      </button>

      {/* Test Result */}
      {testResult && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-3 rounded-lg flex items-start gap-3 ${
            testResult.success ? 'bg-green-500/10 border border-green-500/30' : 'bg-red-500/10 border border-red-500/30'
          }`}
        >
          {testResult.success ? (
            <>
              <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-600">Connection successful!</p>
                <p className="text-xs text-green-600/80">Gateway responded normally</p>
              </div>
            </>
          ) : (
            <>
              <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-600">Connection failed</p>
                <p className="text-xs text-red-600/80">{testResult.error}</p>
              </div>
            </>
          )}
        </motion.div>
      )}

      {/* Error Message */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-600">Error</p>
            <p className="text-xs text-red-600/80">{error}</p>
          </div>
        </motion.div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleSaveConfig}
          disabled={isSaving || !apiKey || !model}
          className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all font-semibold flex items-center justify-center gap-2"
        >
          {isSaving ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Saving...
            </>
          ) : config ? (
            'Update Configuration'
          ) : (
            'Save Configuration'
          )}
        </button>
      </div>
    </motion.div>
  );
}
