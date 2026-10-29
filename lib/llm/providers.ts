import {
  type ChatOptions,
  type ChatResult,
  type ChatTurn,
  type ChatUsage,
  type DiscoveredModel,
  type LLMErrorCode,
  LLMError,
  type ProviderId,
  type ProviderSpec,
} from './types';

/**
 * Provider adapters.
 *
 * Four wire formats cover everything the console supports:
 *   - OpenAI-compatible  (/chat/completions)
 *   - Anthropic          (/v1/messages)
 *   - Google Gemini      (:generateContent)
 *   - Cohere v2          (/v2/chat)
 *
 * Providers whose real API is not reachable with a bearer token (Bedrock needs
 * SigV4) are declared `unsupported` with an explicit reason rather than being
 * quietly routed to the wrong endpoint.
 */

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    envKeys: ['OPENROUTER_API_KEY'],
    requiresKey: true,
    supportsModelList: true,
    docsUrl: 'https://openrouter.ai/docs',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    envKeys: ['OPENAI_API_KEY'],
    requiresKey: true,
    supportsModelList: true,
    docsUrl: 'https://platform.openai.com/docs/api-reference',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    envKeys: ['ANTHROPIC_API_KEY'],
    requiresKey: true,
    supportsModelList: true,
    docsUrl: 'https://docs.anthropic.com/en/api/messages',
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    kind: 'google',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    envKeys: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
    requiresKey: true,
    supportsModelList: true,
    docsUrl: 'https://ai.google.dev/api/generate-content',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    envKeys: ['GROQ_API_KEY'],
    requiresKey: true,
    supportsModelList: true,
    docsUrl: 'https://console.groq.com/docs',
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    envKeys: ['MISTRAL_API_KEY'],
    requiresKey: true,
    supportsModelList: true,
    docsUrl: 'https://docs.mistral.ai/api',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    envKeys: ['DEEPSEEK_API_KEY'],
    requiresKey: true,
    supportsModelList: true,
    docsUrl: 'https://api-docs.deepseek.com',
  },
  together: {
    id: 'together',
    label: 'Together AI',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    envKeys: ['TOGETHER_API_KEY'],
    requiresKey: true,
    supportsModelList: true,
    docsUrl: 'https://docs.together.ai/reference',
  },
  huggingface: {
    id: 'huggingface',
    label: 'Hugging Face',
    kind: 'openai-compatible',
    // the legacy api-inference host no longer serves the OpenAI route
    defaultBaseUrl: 'https://router.huggingface.co/v1',
    envKeys: ['HF_TOKEN', 'HUGGINGFACE_API_KEY'],
    requiresKey: true,
    supportsModelList: true,
    docsUrl: 'https://huggingface.co/docs/inference-providers',
  },
  cohere: {
    id: 'cohere',
    label: 'Cohere',
    kind: 'cohere',
    defaultBaseUrl: 'https://api.cohere.com',
    envKeys: ['COHERE_API_KEY'],
    requiresKey: true,
    supportsModelList: true,
    docsUrl: 'https://docs.cohere.com/reference/chat',
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    kind: 'openai-compatible',
    defaultBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1',
    envKeys: ['OLLAMA_API_KEY'],
    requiresKey: false,
    supportsModelList: true,
    docsUrl: 'https://github.com/ollama/ollama/blob/main/docs/openai.md',
  },
  litellm: {
    id: 'litellm',
    label: 'LiteLLM proxy',
    kind: 'openai-compatible',
    defaultBaseUrl: process.env.LITELLM_BASE_URL || 'http://127.0.0.1:4000/v1',
    envKeys: ['LITELLM_API_KEY'],
    requiresKey: false,
    supportsModelList: true,
    docsUrl: 'https://docs.litellm.ai/docs/providers/openai_compatible',
  },
  vllm: {
    id: 'vllm',
    label: 'vLLM (self-hosted)',
    kind: 'openai-compatible',
    defaultBaseUrl: process.env.VLLM_BASE_URL || 'http://127.0.0.1:8000/v1',
    envKeys: ['VLLM_API_KEY'],
    requiresKey: false,
    supportsModelList: true,
    docsUrl: 'https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html',
  },
  custom: {
    id: 'custom',
    label: 'Custom endpoint',
    kind: 'openai-compatible',
    defaultBaseUrl: '',
    envKeys: ['CUSTOM_LLM_API_KEY', 'CUSTOM_LLM_BASE_URL'],
    requiresKey: false,
    supportsModelList: true,
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
  },
  bedrock: {
    id: 'bedrock',
    label: 'AWS Bedrock',
    kind: 'unsupported',
    defaultBaseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
    envKeys: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
    requiresKey: true,
    supportsModelList: false,
    docsUrl: 'https://docs.aws.amazon.com/bedrock/latest/APIReference/',
    unsupportedReason:
      'Bedrock requires AWS SigV4 request signing and a different request schema; a bearer token cannot call it.',
  },
};

export function getProvider(id: ProviderId): ProviderSpec {
  const provider = PROVIDERS[id];
  if (!provider) {
    throw new LLMError({
      code: 'unsupported-provider',
      message: `Unknown provider "${id}"`,
      fix: 'Pick a model from /api/models; unknown providers are rejected before any network call.',
    });
  }
  return provider;
}

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

const trimSlash = (value: string) => value.replace(/\/+$/, '');

function joinUrl(baseUrl: string, path: string) {
  return `${trimSlash(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`;
}

function classifyStatus(status: number): LLMErrorCode {
  if (status === 401 || status === 403) return 'auth-failed';
  if (status === 404) return 'not-found';
  if (status === 429) return 'rate-limited';
  return 'provider-error';
}

function fixFor(code: LLMErrorCode, provider: ProviderSpec): string {
  switch (code) {
    case 'auth-failed':
      return `The credential was rejected. Re-issue the key for ${provider.label} and set one of: ${provider.envKeys.join(', ')}.`;
    case 'rate-limited':
      return 'The provider is throttling this key. Retry with backoff, lower maxTokens, or use another model.';
    case 'not-found':
      return `The provider does not expose this model. Check the model id in /api/models or run discovery (?discover=${provider.id}).`;
    case 'network-error':
      return `The endpoint was unreachable from this runtime. Check ${provider.defaultBaseUrl} and any egress/firewall rules.`;
    case 'timeout':
      return 'The provider took too long. Retry, lower maxTokens, or raise the request timeout.';
    case 'bad-response':
      return 'The provider returned a payload this adapter could not read. Capture the raw body and add a mapping for it.';
    default:
      return `Inspect the provider error body and compare it with ${provider.docsUrl}.`;
  }
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return response.statusText;
    try {
      const json = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      if (typeof json.error === 'string') return json.error;
      if (json.error?.message) return json.error.message;
      if (json.message) return json.message;
    } catch {
      /* plain text body */
    }
    return text.slice(0, 400);
  } catch {
    return response.statusText;
  }
}

/* ------------------------------------------------------------------ */
/*  request bodies                                                     */
/* ------------------------------------------------------------------ */

function splitSystem(messages: ChatTurn[]) {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const rest = messages.filter((message) => message.role !== 'system');
  return { system, rest };
}

function buildRequest(
  provider: ProviderSpec,
  model: string,
  options: ChatOptions,
  baseUrl: string,
  apiKey: string,
  stream: boolean,
): { url: string; init: RequestInit } {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const temperature = options.temperature ?? 0.8;
  const maxTokens = options.maxTokens ?? 1024;

  const auth = () => {
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  };

  switch (provider.kind) {
    case 'anthropic': {
      if (apiKey) headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      const { system, rest } = splitSystem(options.messages);
      const body: Record<string, unknown> = {
        model,
        max_tokens: maxTokens,
        temperature,
        messages: rest.map((message) => ({ role: message.role, content: message.content })),
        stream,
      };
      if (system) body.system = system;
      return {
        url: joinUrl(baseUrl, '/v1/messages'),
        init: { method: 'POST', headers, body: JSON.stringify(body), signal: options.signal },
      };
    }

    case 'google': {
      const contents = options.messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }],
        }));
      const { system } = splitSystem(options.messages);
      const body: Record<string, unknown> = {
        contents,
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      const action = stream ? 'streamGenerateContent?alt=sse&key=' : 'generateContent?key=';
      return {
        url: `${joinUrl(baseUrl, `/models/${encodeURIComponent(model)}:${action}`)}${encodeURIComponent(apiKey)}`,
        init: { method: 'POST', headers, body: JSON.stringify(body), signal: options.signal },
      };
    }

    case 'cohere': {
      auth();
      const { system, rest } = splitSystem(options.messages);
      const body: Record<string, unknown> = {
        model,
        messages: rest.map((message) => ({ role: message.role, content: message.content })),
        temperature,
        max_tokens: maxTokens,
        stream,
      };
      if (system) body.messages = [{ role: 'system', content: system }, ...(body.messages as unknown[])];
      return {
        url: joinUrl(baseUrl, '/v2/chat'),
        init: { method: 'POST', headers, body: JSON.stringify(body), signal: options.signal },
      };
    }

    case 'unsupported':
      throw new LLMError({
        code: 'unsupported-provider',
        message: provider.unsupportedReason || `${provider.label} is not supported by this adapter`,
        fix: `Use an OpenAI-compatible provider, or add a dedicated adapter that follows ${provider.docsUrl}.`,
        provider: provider.id,
        model,
      });

    default: {
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      if (provider.id === 'openrouter') {
        headers['HTTP-Referer'] = process.env.APP_URL || 'http://localhost:3000';
        headers['X-Title'] = 'Holographic AI Assistant';
      }
      const body = {
        model,
        messages: options.messages,
        temperature,
        max_tokens: maxTokens,
        stream,
      };
      return {
        url: joinUrl(baseUrl, '/chat/completions'),
        init: { method: 'POST', headers, body: JSON.stringify(body), signal: options.signal },
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/*  response parsing                                                   */
/* ------------------------------------------------------------------ */

function parseText(provider: ProviderSpec, payload: unknown): { text: string; usage?: ChatUsage } {
  const data = payload as Record<string, any>;

  if (provider.kind === 'anthropic') {
    const blocks = Array.isArray(data.content) ? data.content : [];
    const text = blocks
      .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
      .map((block: any) => block.text)
      .join('');
    const usage = data.usage
      ? {
          promptTokens: data.usage.input_tokens ?? 0,
          completionTokens: data.usage.output_tokens ?? 0,
          totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
        }
      : undefined;
    return { text, usage };
  }

  if (provider.kind === 'google') {
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    const text = (candidates[0]?.content?.parts ?? [])
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
    const meta = data.usageMetadata;
    const usage = meta
      ? {
          promptTokens: meta.promptTokenCount ?? 0,
          completionTokens: meta.candidatesTokenCount ?? 0,
          totalTokens: meta.totalTokenCount ?? 0,
        }
      : undefined;
    return { text, usage };
  }

  if (provider.kind === 'cohere') {
    const content = data.message?.content;
    const text = Array.isArray(content)
      ? content.map((part: any) => part?.text ?? '').join('')
      : typeof content === 'string'
        ? content
        : '';
    return { text };
  }

  const text = data.choices?.[0]?.message?.content ?? '';
  const usage = data.usage
    ? {
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? 0,
        totalTokens: data.usage.total_tokens ?? 0,
      }
    : undefined;
  return { text, usage };
}

function parseDelta(provider: ProviderSpec, payload: unknown): string {
  const data = payload as Record<string, any>;

  if (provider.kind === 'anthropic') {
    if (data.type === 'content_block_delta') return data.delta?.text ?? '';
    return '';
  }
  if (provider.kind === 'google') {
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    return (candidates[0]?.content?.parts ?? [])
      .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
  }
  if (provider.kind === 'cohere') {
    if (data.type && data.type !== 'content-delta') return '';
    const content = data.delta?.message?.content;
    if (Array.isArray(content)) return content.map((part: any) => part?.text ?? '').join('');
    return typeof content === 'string' ? content : '';
  }
  return data.choices?.[0]?.delta?.content ?? '';
}

/* ------------------------------------------------------------------ */
/*  public API                                                         */
/* ------------------------------------------------------------------ */

export interface CallContext {
  provider: ProviderSpec;
  model: string;
  baseUrl: string;
  apiKey: string;
}

async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network request failed';
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new LLMError({
      code: aborted ? 'cancelled' : 'network-error',
      message,
      fix: 'The runtime could not reach the provider. Check the base URL, DNS and egress rules for this deployment.',
    });
  }
}

export async function complete(context: CallContext, options: ChatOptions): Promise<ChatResult> {
  const started = performance.now();
  const { url, init } = buildRequest(
    context.provider,
    context.model,
    options,
    context.baseUrl,
    context.apiKey,
    false,
  );

  const response = await request(url, init);

  if (!response.ok) {
    const code = classifyStatus(response.status);
    throw new LLMError({
      code,
      message: `${context.provider.label} responded ${response.status}: ${await readErrorBody(response)}`,
      fix: fixFor(code, context.provider),
      provider: context.provider.id,
      model: context.model,
      status: response.status,
    });
  }

  const payload = await response.json().catch(() => null);
  if (!payload) {
    throw new LLMError({
      code: 'bad-response',
      message: `${context.provider.label} returned a non-JSON body`,
      fix: fixFor('bad-response', context.provider),
      provider: context.provider.id,
      model: context.model,
    });
  }

  const { text, usage } = parseText(context.provider, payload);
  if (!text) {
    throw new LLMError({
      code: 'bad-response',
      message: `${context.provider.label} returned no text content`,
      fix: 'The model may have refused or returned a tool call. Inspect the raw payload and extend the adapter.',
      provider: context.provider.id,
      model: context.model,
    });
  }

  return {
    text,
    model: context.model,
    provider: context.provider.id,
    execution: 'cloud',
    latencyMs: Math.round(performance.now() - started),
    usage,
  };
}

/** Yields text deltas as they arrive. Falls back to a single delta if the
 *  provider ignores `stream: true`. */
export async function* stream(
  context: CallContext,
  options: ChatOptions,
): AsyncGenerator<string, void, unknown> {
  const { url, init } = buildRequest(
    context.provider,
    context.model,
    options,
    context.baseUrl,
    context.apiKey,
    true,
  );

  const response = await request(url, init);
  if (!response.ok) {
    const code = classifyStatus(response.status);
    throw new LLMError({
      code,
      message: `${context.provider.label} responded ${response.status}: ${await readErrorBody(response)}`,
      fix: fixFor(code, context.provider),
      provider: context.provider.id,
      model: context.model,
      status: response.status,
    });
  }

  if (!response.body) {
    const text = await response.text();
    try {
      const { text: full } = parseText(context.provider, JSON.parse(text));
      if (full) yield full;
      return;
    } catch {
      throw new LLMError({
        code: 'bad-response',
        message: 'Streaming response had no body',
        fix: fixFor('bad-response', context.provider),
      });
    }
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let emitted = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(':')) continue;

        const payloadText = line.startsWith('data:') ? line.slice(5).trim() : line;
        if (!payloadText || payloadText === '[DONE]') continue;

        try {
          const delta = parseDelta(context.provider, JSON.parse(payloadText));
          if (delta) {
            emitted = true;
            yield delta;
          }
        } catch {
          // providers occasionally emit keep-alive frames; ignore them
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!emitted) {
    // some proxies ignore stream:true — replay the buffered body once
    const tail = buffer.trim();
    if (tail) {
      try {
        const { text: full } = parseText(context.provider, JSON.parse(tail));
        if (full) yield full;
      } catch {
        /* nothing recoverable */
      }
    }
  }
}

/** Ask the provider which models it currently exposes. */
export async function discover(
  provider: ProviderSpec,
  baseUrl: string,
  apiKey: string,
): Promise<DiscoveredModel[]> {
  if (!provider.supportsModelList) {
    throw new LLMError({
      code: 'unsupported-provider',
      message: `${provider.label} does not expose a model list`,
      fix: `Add models to the catalogue manually for ${provider.label}.`,
      provider: provider.id,
    });
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let url: string;

  switch (provider.kind) {
    case 'anthropic':
      if (apiKey) headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      url = joinUrl(baseUrl, '/v1/models');
      break;
    case 'google':
      url = `${joinUrl(baseUrl, '/models')}?key=${encodeURIComponent(apiKey)}`;
      break;
    case 'cohere':
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      url = joinUrl(baseUrl, '/v1/models');
      break;
    case 'unsupported':
      throw new LLMError({
        code: 'unsupported-provider',
        message: provider.unsupportedReason || `${provider.label} is unsupported`,
        fix: `See ${provider.docsUrl}`,
        provider: provider.id,
      });
    default:
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      url = joinUrl(baseUrl, '/models');
  }

  const response = await request(url, { method: 'GET', headers });
  if (!response.ok) {
    const code = classifyStatus(response.status);
    throw new LLMError({
      code,
      message: `${provider.label} model list failed (${response.status}): ${await readErrorBody(response)}`,
      fix: fixFor(code, provider),
      provider: provider.id,
      status: response.status,
    });
  }

  const payload = (await response.json().catch(() => null)) as Record<string, any> | null;
  const list = payload?.data ?? payload?.models ?? [];
  if (!Array.isArray(list)) {
    throw new LLMError({
      code: 'bad-response',
      message: `${provider.label} returned an unexpected model list`,
      fix: fixFor('bad-response', provider),
      provider: provider.id,
    });
  }

  const mapped: Array<DiscoveredModel | null> = list
    .map((entry: any): DiscoveredModel | null => {
      const upstreamModel: string =
        entry?.id ?? entry?.name ?? entry?.model ?? '';
      if (!upstreamModel) return null;
      const cleaned = upstreamModel.replace(/^models\//, '');
      return {
        id: `${provider.id}/${cleaned}`,
        label: entry?.display_name || entry?.name || cleaned,
        provider: provider.id,
        upstreamModel: cleaned,
        contextWindow: entry?.context_length ?? entry?.context_window ?? undefined,
      };
    })
    .slice(0, 300);

  return mapped.filter((entry): entry is DiscoveredModel => entry !== null);
}

export { joinUrl, classifyStatus, fixFor };
