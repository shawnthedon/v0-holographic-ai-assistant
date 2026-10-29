import { PROVIDERS } from './providers';
import type { ModelSpec, ProviderId } from './types';

/**
 * Curated model catalogue.
 *
 * These are starting points, not a closed list: `/api/models?discover=<provider>`
 * asks the provider for everything the credential can actually reach, and the
 * UI merges both. `notes` states the caveat — a model is only marked `verified`
 * after a live probe in this deployment.
 */

const model = (
  id: string,
  label: string,
  provider: ProviderId,
  upstreamModel: string,
  extra: Partial<ModelSpec> = {},
): ModelSpec => ({
  id,
  label,
  provider,
  upstreamModel,
  roles: ['chat'],
  execution: PROVIDERS[provider].kind === 'openai-compatible' &&
    ['ollama', 'vllm', 'litellm'].includes(provider)
    ? 'self-hosted'
    : 'cloud',
  ...extra,
});

export const MODEL_CATALOGUE: ModelSpec[] = [
  /* ---------------- Qwen (primary family) ---------------- */
  model('openrouter/qwen-2.5-72b-instruct', 'Qwen2.5 72B Instruct', 'openrouter', 'qwen/qwen-2.5-72b-instruct', {
    roles: ['chat', 'code'],
    contextWindow: 32768,
    licence: 'Apache-2.0 (Qwen2.5)',
    notes: 'Hosted Qwen2.5 text model. Speech in/out is not exposed by this hosted route.',
  }),
  model('openrouter/qwen-2.5-coder-32b', 'Qwen2.5 Coder 32B', 'openrouter', 'qwen/qwen-2.5-coder-32b-instruct', {
    roles: ['chat', 'code'],
    contextWindow: 32768,
    licence: 'Apache-2.0 (Qwen2.5)',
  }),
  model('openrouter/qwq-32b', 'QwQ 32B (reasoning)', 'openrouter', 'qwen/qwq-32b', {
    roles: ['chat'],
    contextWindow: 32768,
    licence: 'Apache-2.0 (Qwen)',
    notes: 'Reasoning model — slower time-to-first-token; good for planning turns.',
  }),
  model('openrouter/qwen2.5-vl-72b', 'Qwen2.5 VL 72B', 'openrouter', 'qwen/qwen2.5-vl-72b-instruct', {
    roles: ['chat', 'vision'],
    contextWindow: 32768,
    licence: 'Apache-2.0 (Qwen2.5)',
  }),
  model('vllm/qwen2.5-omni-7b', 'Qwen2.5-Omni 7B (self-hosted)', 'vllm', 'Qwen/Qwen2.5-Omni-7B', {
    roles: ['chat', 'omni', 'speech-in', 'speech-out'],
    contextWindow: 32768,
    licence: 'Apache-2.0 (Qwen2.5-Omni)',
    execution: 'self-hosted',
    notes:
      'Speech in/out requires a Qwen2.5-Omni-capable runtime (official Transformers path or a compatible server). vLLM does not serve the audio-generation head — point base URL at the Omni runtime. Hardware gate: 7B needs a GPU with enough VRAM for the chosen precision.',
  }),
  model('vllm/qwen2.5-72b-instruct', 'Qwen2.5 72B (self-hosted)', 'vllm', 'Qwen/Qwen2.5-72B-Instruct', {
    roles: ['chat', 'code'],
    contextWindow: 32768,
    licence: 'Apache-2.0 (Qwen2.5)',
    execution: 'self-hosted',
    notes: 'Requires VLLM_BASE_URL and a GPU host that can hold the weights.',
  }),
  model('ollama/qwen2.5-7b', 'Qwen2.5 7B (on-device)', 'ollama', 'qwen2.5:7b', {
    roles: ['chat', 'code'],
    contextWindow: 32768,
    licence: 'Apache-2.0 (Qwen2.5)',
    execution: 'on-device',
    notes: 'Runs on the machine that hosts the console server. Needs `ollama pull qwen2.5:7b`.',
  }),
  model('huggingface/qwen2.5-72b-instruct', 'Qwen2.5 72B Instruct (HF)', 'huggingface', 'Qwen/Qwen2.5-72B-Instruct', {
    roles: ['chat'],
    contextWindow: 32768,
    licence: 'Apache-2.0 (Qwen2.5)',
  }),
  model('together/qwen2.5-72b-turbo', 'Qwen2.5 72B Turbo (Together)', 'together', 'Qwen/Qwen2.5-72B-Instruct-Turbo', {
    roles: ['chat'],
    contextWindow: 32768,
    licence: 'Apache-2.0 (Qwen2.5)',
  }),

  /* ---------------- OpenAI ---------------- */
  model('openai/gpt-4o', 'GPT-4o', 'openai', 'gpt-4o', {
    roles: ['chat', 'vision'],
    contextWindow: 128000,
  }),
  model('openai/gpt-4o-mini', 'GPT-4o mini', 'openai', 'gpt-4o-mini', {
    roles: ['chat', 'vision'],
    contextWindow: 128000,
    notes: 'Cheapest OpenAI option; good default for the console.',
  }),
  model('openrouter/openai-gpt-4o', 'GPT-4o (via OpenRouter)', 'openrouter', 'openai/gpt-4o', {
    roles: ['chat', 'vision'],
    contextWindow: 128000,
  }),

  /* ---------------- Anthropic ---------------- */
  model('anthropic/claude-sonnet-4-5', 'Claude Sonnet 4.5', 'anthropic', 'claude-sonnet-4-5', {
    roles: ['chat', 'vision', 'code'],
    contextWindow: 200000,
    notes: 'Native /v1/messages adapter (x-api-key + anthropic-version), not the OpenAI route.',
  }),
  model('anthropic/claude-3-5-haiku-latest', 'Claude 3.5 Haiku', 'anthropic', 'claude-3-5-haiku-latest', {
    roles: ['chat', 'code'],
    contextWindow: 200000,
  }),
  model('openrouter/anthropic-claude-sonnet', 'Claude Sonnet (via OpenRouter)', 'openrouter', 'anthropic/claude-sonnet-4.5', {
    roles: ['chat', 'vision'],
    contextWindow: 200000,
  }),

  /* ---------------- Google ---------------- */
  model('google/gemini-2.0-flash', 'Gemini 2.0 Flash', 'google', 'gemini-2.0-flash', {
    roles: ['chat', 'vision'],
    contextWindow: 1000000,
    notes: 'Uses :generateContent with an API key query parameter.',
  }),
  model('google/gemini-2.5-pro', 'Gemini 2.5 Pro', 'google', 'gemini-2.5-pro', {
    roles: ['chat', 'vision'],
    contextWindow: 1000000,
  }),
  model('openrouter/gemini-2.0-flash', 'Gemini 2.0 Flash (via OpenRouter)', 'openrouter', 'google/gemini-2.0-flash-001', {
    roles: ['chat', 'vision'],
    contextWindow: 1000000,
  }),

  /* ---------------- fast / cheap ---------------- */
  model('groq/llama-3.3-70b', 'Llama 3.3 70B (Groq)', 'groq', 'llama-3.3-70b-versatile', {
    roles: ['chat'],
    contextWindow: 131072,
    notes: 'Very low latency; good for the voice loop where time-to-first-token matters.',
  }),
  model('groq/llama-3.1-8b', 'Llama 3.1 8B (Groq)', 'groq', 'llama-3.1-8b-instant', {
    roles: ['chat'],
    contextWindow: 131072,
  }),
  model('deepseek/deepseek-chat', 'DeepSeek Chat', 'deepseek', 'deepseek-chat', {
    roles: ['chat', 'code'],
    contextWindow: 64000,
  }),
  model('deepseek/deepseek-reasoner', 'DeepSeek Reasoner', 'deepseek', 'deepseek-reasoner', {
    roles: ['chat', 'code'],
    contextWindow: 64000,
    notes: 'Emits reasoning tokens — expect a slower first token.',
  }),
  model('mistral/mistral-large', 'Mistral Large', 'mistral', 'mistral-large-latest', {
    roles: ['chat', 'code'],
    contextWindow: 128000,
  }),
  model('openrouter/llama-3.3-70b', 'Llama 3.3 70B (via OpenRouter)', 'openrouter', 'meta-llama/llama-3.3-70b-instruct', {
    roles: ['chat'],
    contextWindow: 131072,
  }),
  model('openrouter/deepseek-r1', 'DeepSeek R1 (via OpenRouter)', 'openrouter', 'deepseek/deepseek-r1', {
    roles: ['chat'],
    contextWindow: 64000,
  }),

  /* ---------------- Cohere ---------------- */
  model('cohere/command-r-plus', 'Command R+', 'cohere', 'command-r-plus-08-2024', {
    roles: ['chat'],
    contextWindow: 128000,
    notes: 'Uses /v2/chat, not /chat/completions.',
  }),

  /* ---------------- local runtimes ---------------- */
  model('ollama/llama3.2-3b', 'Llama 3.2 3B (on-device)', 'ollama', 'llama3.2:3b', {
    roles: ['chat'],
    contextWindow: 131072,
    execution: 'on-device',
    notes: 'Smallest sane local default. `ollama pull llama3.2:3b`.',
  }),
  model('ollama/qwen2.5-coder-7b', 'Qwen2.5 Coder 7B (on-device)', 'ollama', 'qwen2.5-coder:7b', {
    roles: ['chat', 'code'],
    contextWindow: 32768,
    execution: 'on-device',
  }),
  model('litellm/proxy-default', 'LiteLLM proxy model', 'litellm', 'gpt-4o-mini', {
    roles: ['chat'],
    execution: 'self-hosted',
    notes: 'Alias resolved by your LiteLLM config; set LITELLM_BASE_URL and the alias you want.',
  }),

  /* ---------------- declared, not reachable ---------------- */
  model('bedrock/claude-3-5-sonnet', 'Claude 3.5 Sonnet (Bedrock)', 'bedrock', 'anthropic.claude-3-5-sonnet-20241022-v2:0', {
    roles: ['chat'],
    contextWindow: 200000,
    notes: 'BLOCKED: Bedrock needs AWS SigV4 signing. The adapter refuses rather than sending a wrong request.',
  }),
];

export const DEFAULT_MODEL_ID = 'openrouter/qwen-2.5-72b-instruct';

export function listModels(): ModelSpec[] {
  return MODEL_CATALOGUE.map((entry) => ({ ...entry }));
}

export function findModel(id: string): ModelSpec | null {
  if (!id) return null;
  const exact = MODEL_CATALOGUE.find((entry) => entry.id === id);
  if (exact) return exact;

  // tolerate a bare upstream id or provider/upstream pairs
  const lower = id.toLowerCase();
  const byUpstream = MODEL_CATALOGUE.find(
    (entry) =>
      entry.upstreamModel.toLowerCase() === lower ||
      entry.id.toLowerCase() === lower ||
      `${entry.provider}/${entry.upstreamModel}`.toLowerCase() === lower,
  );
  if (byUpstream) return byUpstream;

  // an undiscovered-but-addressable model: provider/upstream
  const slash = id.indexOf('/');
  if (slash > 0) {
    const provider = id.slice(0, slash) as ProviderId;
    if (PROVIDERS[provider]) {
      return {
        id,
        label: id.slice(slash + 1),
        provider,
        upstreamModel: id.slice(slash + 1),
        roles: ['chat'],
        execution: ['ollama', 'vllm', 'litellm'].includes(provider) ? 'self-hosted' : 'cloud',
        notes: 'Discovered at runtime — not in the curated catalogue.',
      };
    }
  }
  return null;
}

export function groupByProvider(models: ModelSpec[]): Record<string, ModelSpec[]> {
  return models.reduce<Record<string, ModelSpec[]>>((groups, entry) => {
    (groups[entry.provider] ||= []).push(entry);
    return groups;
  }, {});
}
