import { encryptSensitiveData, decryptSensitiveData, maskApiKey, type EncryptedData } from './gateway-encryption';
import { GatewayProvider, GatewayConfig } from './unified-gateway';

/**
 * Gateway Configuration Manager
 * Handles persistent storage of gateway configs with encrypted API keys
 * Uses environment variables + database (if available) for storage
 */

export interface GatewayConfigData {
  provider: GatewayProvider;
  model: string;
  baseUrl?: string;
  timeout?: number;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface StoredGatewayConfig extends GatewayConfigData {
  encryptedApiKey: EncryptedData;
  lastUpdated: number;
  masked: string;
}

export interface GatewayConfigResponse {
  provider: GatewayProvider;
  model: string;
  baseUrl?: string;
  timeout?: number;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  masked: string;
  lastUpdated: number;
}

/**
 * GatewayConfigManager
 * Manages encrypted storage and retrieval of gateway configurations
 */
/**
 * In-process store for per-user gateway configs.
 *
 * Previous releases wrote these blobs into `process.env`, which leaked one
 * user's encrypted config into every request handled by the same instance and
 * left secrets in the environment dump. A module-scoped Map is scoped to the
 * instance and disappears with it — acceptable for a single-operator console,
 * and the report calls out that durable storage is still required for
 * multi-user deployments.
 */
const configStore = new Map<string, string>();

export class GatewayConfigManager {
  private masterKey: string;

  constructor() {
    // Do not throw here: a missing key must degrade to a clear, actionable
    // error at save time instead of breaking every route that imports this.
    this.masterKey = process.env.GATEWAY_ENCRYPTION_KEY || '';
  }

  get isEncryptionReady() {
    return this.masterKey.length >= 16;
  }

  private assertEncryptionReady() {
    if (!this.isEncryptionReady) {
      throw new Error(
        'GATEWAY_ENCRYPTION_KEY is not set (min 16 chars) — cannot store user API keys. ' +
          'Set it in the deployment environment, or rely on provider environment variables instead.',
      );
    }
  }

  /**
   * Save gateway configuration with encrypted API key
   */
  async saveConfig(userId: string, config: GatewayConfigData, apiKey: string): Promise<GatewayConfigResponse> {
    this.assertEncryptionReady();
    if (!apiKey) {
      throw new Error('API key is required');
    }

    const encryptedApiKey = encryptSensitiveData(apiKey, this.masterKey);
    const masked = maskApiKey(apiKey);
    const now = Date.now();

    const stored: StoredGatewayConfig = {
      ...config,
      encryptedApiKey,
      masked,
      lastUpdated: now,
    };

    configStore.set(userId, JSON.stringify(stored));

    return this.configToResponse(stored);
  }

  /**
   * Load gateway configuration with decrypted API key
   */
  async loadConfig(userId: string): Promise<GatewayConfig | null> {
    const stored = configStore.get(userId);
    if (!stored) {
      return null;
    }
    this.assertEncryptionReady();

    try {
      const parsedConfig: StoredGatewayConfig = JSON.parse(stored);
      const decryptedApiKey = decryptSensitiveData(parsedConfig.encryptedApiKey, this.masterKey);

      return {
        provider: parsedConfig.provider,
        model: parsedConfig.model,
        apiKey: decryptedApiKey,
        baseUrl: parsedConfig.baseUrl,
        timeout: parsedConfig.timeout,
      };
    } catch (error) {
      throw new Error(`Failed to load gateway config: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get configuration without API key (for frontend display)
   */
  async getConfigSafe(userId: string): Promise<GatewayConfigResponse | null> {
    const stored = configStore.get(userId);
    if (!stored) {
      return null;
    }

    try {
      const parsedConfig: StoredGatewayConfig = JSON.parse(stored);
      return this.configToResponse(parsedConfig);
    } catch (error) {
      throw new Error(`Failed to get gateway config: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete gateway configuration
   */
  async deleteConfig(userId: string): Promise<void> {
    configStore.delete(userId);
  }

  /**
   * Test gateway connection without storing
   */
  async testConnection(config: GatewayConfigData, apiKey: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { UnifiedGatewayService } = await import('./unified-gateway');

      const service = new UnifiedGatewayService({
        ...config,
        apiKey,
      });

      const result = await service.testConnection();
      return {
        success: result.success,
        error: result.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Convert stored config to response format (without API key)
   */
  private configToResponse(stored: StoredGatewayConfig): GatewayConfigResponse {
    return {
      provider: stored.provider,
      model: stored.model,
      baseUrl: stored.baseUrl,
      timeout: stored.timeout,
      temperature: stored.temperature,
      maxTokens: stored.maxTokens,
      topP: stored.topP,
      masked: stored.masked,
      lastUpdated: stored.lastUpdated,
    };
  }

  /**
   * Get default configurations for supported providers
   */
  static getProviderDefaults(): Record<string, Partial<GatewayConfigData>> {
    return {
      openrouter: {
        provider: 'openrouter',
        model: 'qwen/qwen-2.5-72b-instruct',
        temperature: 0.7,
        maxTokens: 2000,
      },
      huggingface: {
        provider: 'huggingface',
        model: 'Qwen/Qwen2.5-72B-Instruct',
        temperature: 0.7,
        maxTokens: 2000,
      },
      litellm: {
        provider: 'litellm',
        model: 'gpt-4o-mini',
        baseUrl: 'http://127.0.0.1:4000/v1',
        temperature: 0.7,
        maxTokens: 2000,
      },
      bedrock: {
        provider: 'bedrock',
        model: 'anthropic.claude-3-sonnet-20240229-v1:0',
        temperature: 0.7,
        maxTokens: 2000,
      },
      ollama: {
        provider: 'ollama',
        model: 'llama3.2:3b',
        baseUrl: 'http://127.0.0.1:11434/v1',
        temperature: 0.7,
        maxTokens: 2000,
      },
      openai: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        temperature: 0.7,
        maxTokens: 2000,
      },
      anthropic: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        temperature: 0.7,
        maxTokens: 2000,
      },
    };
  }
}

/**
 * Factory function to create config manager
 */
export function createConfigManager(): GatewayConfigManager {
  return new GatewayConfigManager();
}
