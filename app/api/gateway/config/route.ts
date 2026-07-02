import { NextRequest, NextResponse } from 'next/server';
import { createConfigManager } from '@/lib/gateway-config-manager';

/**
 * GET /api/gateway/config
 * Retrieve current gateway configuration (without API key)
 */
export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id') || 'default';
    const manager = createConfigManager();
    
    const config = await manager.getConfigSafe(userId);
    
    if (!config) {
      return NextResponse.json(
        { error: 'No gateway configuration found' },
        { status: 404 }
      );
    }

    return NextResponse.json(config);
  } catch (error) {
    console.error('[v0] Gateway config GET error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve gateway configuration' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/gateway/config
 * Save or update gateway configuration with encrypted API key
 */
export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id') || 'default';
    const body = await request.json();

    const { provider, model, baseUrl, timeout, temperature, maxTokens, topP, apiKey } = body;

    if (!provider || !model || !apiKey) {
      return NextResponse.json(
        { error: 'Missing required fields: provider, model, apiKey' },
        { status: 400 }
      );
    }

    const manager = createConfigManager();
    const config = await manager.saveConfig(userId, {
      provider,
      model,
      baseUrl,
      timeout,
      temperature,
      maxTokens,
      topP,
    }, apiKey);

    return NextResponse.json({
      success: true,
      config,
    });
  } catch (error) {
    console.error('[v0] Gateway config POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save gateway configuration' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/gateway/config
 * Delete gateway configuration
 */
export async function DELETE(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id') || 'default';
    const manager = createConfigManager();
    
    await manager.deleteConfig(userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[v0] Gateway config DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to delete gateway configuration' },
      { status: 500 }
    );
  }
}
