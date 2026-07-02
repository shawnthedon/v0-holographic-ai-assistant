import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/gateway/models?provider=openrouter
 * Fetch available models for a given provider
 * Note: This is a stub that returns popular models per provider
 * In production, this should fetch from each provider's API
 */
export async function GET(request: NextRequest) {
  try {
    const provider = request.nextUrl.searchParams.get('provider') || 'openrouter';

    const models = getModelsForProvider(provider);

    return NextResponse.json({
      provider,
      models,
      count: models.length,
    });
  } catch (error) {
    console.error('[v0] Models discovery error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch models' },
      { status: 500 }
    );
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
