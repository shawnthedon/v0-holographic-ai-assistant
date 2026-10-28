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
      {
        error: error instanceof Error ? error.message : 'Failed to retrieve gateway configuration',
        code: 'gateway-config-error',
        fix: 'Stored gateway configs are ephemeral per instance. Prefer provider environment variables (e.g. OPENROUTER_API_KEY) or set GATEWAY_ENCRYPTION_KEY to enable saved keys.',
      },
      { status: 503 }
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
    const message = error instanceof Error ? error.message : 'Failed to save gateway configuration';
    const missingKey = message.includes('GATEWAY_ENCRYPTION_KEY');
    console.error('[v0] Gateway config POST error:', message);
    return NextResponse.json(
      {
        error: message,
        code: missingKey ? 'missing-encryption-key' : 'gateway-config-error',
        fix: missingKey
          ? 'Set GATEWAY_ENCRYPTION_KEY (≥16 chars) in the deployment, or skip saved keys and set the provider key as an environment variable instead.'
          : 'Inspect the server log for the encryption/decryption failure.',
      },
      { status: missingKey ? 503 : 500 }
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
