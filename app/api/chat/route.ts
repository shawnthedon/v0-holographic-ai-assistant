import { NextRequest, NextResponse } from 'next/server';
import { chat, chatStream, resolveModel } from '@/lib/llm/service';
import { LLMError, type ChatTurn } from '@/lib/llm/types';
import { telemetryServerLog } from '@/lib/llm/log';
import { createConfigManager } from '@/lib/gateway-config-manager';
import type { ProviderId } from '@/lib/llm/types';

/** legacy gateway provider ids → LLM provider ids */
const LEGACY_PROVIDER_MAP: Record<string, ProviderId> = {
  litellm: 'litellm',
  openrouter: 'openrouter',
  openai: 'openai',
  anthropic: 'anthropic',
  huggingface: 'huggingface',
  cohere: 'cohere',
  ollama: 'ollama',
  bedrock: 'bedrock',
  custom: 'custom',
};

/**
 * Settings → Gateway still lets an operator store a provider + key. Honour it
 * when the request does not name a model, so the old configuration keeps
 * working instead of being silently ignored.
 */
async function storedGatewayRoute(userId: string) {
  try {
    const manager = createConfigManager();
    const stored = await manager.loadConfig(userId);
    if (!stored) return null;
    const provider = LEGACY_PROVIDER_MAP[stored.provider] ?? 'custom';
    return {
      modelId: `${provider}/${stored.model}`,
      credential: { apiKey: stored.apiKey, baseUrl: stored.baseUrl },
    };
  } catch {
    return null;
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ChatRequestBody {
  message?: string;
  model?: string;
  messages?: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  baseUrl?: string;
}

const VALID_ROLES = new Set(['system', 'user', 'assistant']);

function normalizeMessages(body: ChatRequestBody): ChatTurn[] {
  const history = Array.isArray(body.messages)
    ? body.messages
        .filter((entry) => entry && typeof entry.content === 'string' && VALID_ROLES.has(entry.role))
        .map((entry) => ({ role: entry.role as ChatTurn['role'], content: entry.content.slice(0, 8000) }))
        .slice(-24)
    : [];

  const prompt = body.message?.trim();
  if (prompt) history.push({ role: 'user', content: prompt.slice(0, 8000) });

  if (!history.some((entry) => entry.role === 'user')) {
    throw new LLMError({
      code: 'bad-response',
      message: 'No user message supplied',
      fix: 'Send { message } or a messages array with at least one user turn.',
    });
  }

  return history;
}

export async function POST(request: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', fix: 'Send a JSON object with { message } or { messages }.' },
      { status: 400 },
    );
  }

  try {
    const messages = normalizeMessages(body);
    const userId = request.headers.get('x-user-id') || 'default';

    let modelId = body.model?.trim() || undefined;
    let stored: Awaited<ReturnType<typeof storedGatewayRoute>> = null;
    if (!modelId) {
      stored = await storedGatewayRoute(userId);
      if (stored) modelId = stored.modelId;
    }

    telemetryServerLog('chat.request', {
      model: modelId ?? '(default)',
      route: stored ? 'saved-gateway-config' : body.model ? 'explicit' : 'default',
    });

    const options = {
      modelId,
      messages,
      temperature: body.temperature,
      maxTokens: body.maxTokens ?? 1024,
      baseUrl: body.baseUrl,
      credential: stored?.credential,
    };

    if (body.stream) {
      const resolved = resolveModel(options);
      const encoder = new TextEncoder();
      const generator = chatStream(options);

      const streamBody = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(
            encoder.encode(
              `event: meta\ndata: ${JSON.stringify({
                model: resolved.spec.id,
                provider: resolved.provider.id,
                execution: resolved.spec.execution,
              })}\n\n`,
            ),
          );
          try {
            for await (const delta of generator) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
            }
            controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'));
          } catch (error) {
            const payload =
              error instanceof LLMError
                ? error.toJSON()
                : { code: 'provider-error', message: String(error), fix: 'Inspect the server log.' };
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify(payload)}\n\n`));
          } finally {
            controller.close();
          }
        },
      });

      return new Response(streamBody, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      });
    }

    const result = await chat(options);

    return NextResponse.json(
      {
        response: result.text,
        model: result.model,
        provider: result.provider,
        execution: result.execution,
        latencyMs: result.latencyMs,
        usage: result.usage,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof LLMError) {
      const status =
        error.code === 'no-credential'
          ? 503
          : error.code === 'unknown-model'
            ? 404
            : error.code === 'auth-failed'
              ? 401
              : error.code === 'rate-limited'
                ? 429
                : error.code === 'unsupported-provider' || error.code === 'config-error'
                  ? 501
                  : error.status && error.status >= 400 && error.status < 600
                    ? error.status
                    : 502;

      telemetryServerLog('chat.error', { code: error.code, provider: error.provider });
      return NextResponse.json({ error: error.message, ...error.toJSON() }, { status });
    }

    console.error('[chat] unhandled error', error);
    return NextResponse.json(
      {
        error: 'Chat request failed',
        code: 'provider-error',
        fix: 'Check the server logs for the provider response body.',
      },
      { status: 500 },
    );
  }
}
