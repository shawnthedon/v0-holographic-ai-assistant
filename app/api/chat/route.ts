import { NextRequest, NextResponse } from 'next/server';
import { createGatewayService } from '@/lib/unified-gateway';
import { createConfigManager } from '@/lib/gateway-config-manager';

interface ChatRequest {
  message: string;
  model?: string;
  endpoint?: string;
  messages?: Array<{ role: string; content: string }>;
}

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const { message, messages = [] } = body;
    const userId = request.headers.get('x-user-id') || 'default';

    console.log('[v0] Chat API called with user:', userId);

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Load gateway configuration for the user
    const configManager = createConfigManager();
    const gatewayConfig = await configManager.loadConfig(userId);

    if (!gatewayConfig) {
      return NextResponse.json(
        { error: 'No gateway configuration found. Please configure LLM provider in settings.' },
        { status: 400 }
      );
    }

    // Create unified gateway service with user's configuration
    const gateway = createGatewayService(gatewayConfig);

    // Prepare conversation messages
    const conversationMessages = [
      ...messages.map((msg) => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      })),
      { role: 'user' as const, content: message },
    ];

    // Call the unified gateway
    const response = await gateway.chat({
      messages: conversationMessages,
      maxTokens: 1024,
      temperature: 0.9,
    });

    const assistantMessage = response.choices?.[0]?.message?.content || 'No response generated';

    return NextResponse.json({ 
      response: assistantMessage,
      model: response.model,
      provider: gatewayConfig.provider,
    });
  } catch (error) {
    console.error('[v0] Chat API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process chat request' },
      { status: 500 }
    );
  }
}
