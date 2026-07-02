import { NextRequest, NextResponse } from 'next/server';
import { createConfigManager } from '@/lib/gateway-config-manager';

/**
 * POST /api/gateway/test
 * Test gateway connection without storing configuration
 * Validates API key and connectivity without exposing credentials
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { provider, model, baseUrl, apiKey, timeout } = body;

    if (!provider || !model || !apiKey) {
      return NextResponse.json(
        { error: 'Missing required fields: provider, model, apiKey' },
        { status: 400 }
      );
    }

    const manager = createConfigManager();
    const result = await manager.testConnection(
      {
        provider,
        model,
        baseUrl,
        timeout,
      },
      apiKey
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('[v0] Gateway test error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed' 
      },
      { status: 500 }
    );
  }
}
