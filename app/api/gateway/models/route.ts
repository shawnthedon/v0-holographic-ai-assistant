import { NextRequest, NextResponse } from 'next/server';
import { discoverProvider } from '@/lib/llm/service';
import { catalogue } from '@/lib/llm/service';
import type { ProviderId } from '@/lib/llm/types';

/**
 * GET /api/gateway/models?provider=openrouter
 * Fetch available models for a given provider
 * Note: This is a stub that returns popular models per provider
 * In production, this should fetch from each provider's API
 */
export async function GET(request: NextRequest) {
  const provider = (request.nextUrl.searchParams.get('provider') || 'openrouter') as ProviderId;

  try {
    // ask the provider first; it is the only source of truth for what the
    // credential can actually reach
    const discovered = await discoverProvider(provider);
    return NextResponse.json({ provider, models: discovered, count: discovered.length, source: 'provider' });
  } catch (error) {
    // fall back to the curated catalogue, and say so instead of pretending
    const fallback = catalogue()
      .filter((entry) => entry.provider === provider)
      .map((entry) => ({
        id: entry.id,
        name: entry.label,
        contextLength: entry.contextWindow,
        source: 'catalogue',
      }));

    return NextResponse.json({
      provider,
      models: fallback,
      count: fallback.length,
      source: 'catalogue',
      error: error instanceof Error ? error.message : 'Provider discovery failed',
      fix: 'Set the provider API key to list live models, or pick from the curated catalogue.',
    });
  }
}

/**
 * Get popular models for each provider
 * In production, fetch from provider APIs with caching
 */
function getModelsForProvider(provider: string) {
  const modelCatalog: Record<string, any[]> = {
    openrouter: [
      { id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo', contextLength: 128000 },
      { id: 'openai/gpt-4', name: 'GPT-4', contextLength: 8192 },
      { id: 'openai/gpt-3.5-turbo', name: 'GPT-3.5 Turbo', contextLength: 16385 },
      { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus', contextLength: 200000 },
      { id: 'anthropic/claude-3-sonnet', name: 'Claude 3 Sonnet', contextLength: 200000 },
      { id: 'meta-llama/llama-2-70b-chat', name: 'Llama 2 70B Chat', contextLength: 4096 },
      { id: 'mistralai/mistral-7b-instruct', name: 'Mistral 7B Instruct', contextLength: 32768 },
      { id: 'nousresearch/nous-hermes-2-mixtral-8x7b-dpo', name: 'Nous Hermes 2 Mixtral 8x7B', contextLength: 32768 },
    ],
    huggingface: [
      { id: 'meta-llama/Llama-2-70b-chat-hf', name: 'Llama 2 70B Chat', contextLength: 4096 },
      { id: 'mistralai/Mistral-7B-Instruct-v0.1', name: 'Mistral 7B Instruct', contextLength: 32768 },
      { id: 'tiiuae/falcon-180B-chat', name: 'Falcon 180B Chat', contextLength: 2048 },
      { id: 'bigcode/starcoder', name: 'StarCoder', contextLength: 8192 },
    ],
    bedrock: [
      { id: 'anthropic.claude-3-opus-20240229-v1:0', name: 'Claude 3 Opus', contextLength: 200000 },
      { id: 'anthropic.claude-3-sonnet-20240229-v1:0', name: 'Claude 3 Sonnet', contextLength: 200000 },
      { id: 'anthropic.claude-3-haiku-20240307-v1:0', name: 'Claude 3 Haiku', contextLength: 200000 },
      { id: 'meta.llama2-70b-chat-v1', name: 'Llama 2 70B Chat', contextLength: 4096 },
      { id: 'meta.llama3-70b-instruct-v1:0', name: 'Llama 3 70B Instruct', contextLength: 8192 },
    ],
    ollama: [
      { id: 'llama2', name: 'Llama 2 7B', contextLength: 4096 },
      { id: 'llama2-uncensored', name: 'Llama 2 Uncensored', contextLength: 4096 },
      { id: 'mistral', name: 'Mistral 7B', contextLength: 32768 },
      { id: 'neural-chat', name: 'Neural Chat 7B', contextLength: 4096 },
      { id: 'orca-mini', name: 'Orca Mini 3B', contextLength: 4096 },
      { id: 'dolphin-mixtral', name: 'Dolphin Mixtral 8x7B', contextLength: 32768 },
    ],
    openai: [
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextLength: 128000 },
      { id: 'gpt-4', name: 'GPT-4', contextLength: 8192 },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', contextLength: 16385 },
      { id: 'gpt-3.5-turbo-16k', name: 'GPT-3.5 Turbo 16K', contextLength: 16385 },
    ],
    anthropic: [
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', contextLength: 200000 },
      { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', contextLength: 200000 },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', contextLength: 200000 },
    ],
    cohere: [
      { id: 'command', name: 'Command', contextLength: 4096 },
      { id: 'command-nightly', name: 'Command Nightly', contextLength: 4096 },
      { id: 'command-light', name: 'Command Light', contextLength: 4096 },
    ],
  };

  return modelCatalog[provider] || [];
}
