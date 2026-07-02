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
export class GatewayConfigManager {
  private masterKey: string;

  constructor() {
    const masterKey = process.env.GATEWAY_ENCRYPTION_KEY;
    if (!masterKey || masterKey.length < 16) {
      throw new Error('GATEWAY_ENCRYPTION_KEY environment variable not set or too short (min 16 chars)');
    }
    this.masterKey = masterKey;
  }

  /**
   * Save gateway configuration with encrypted API key
   */
  async saveConfig(userId: string, config: GatewayConfigData, apiKey: string): Promise<GatewayConfigResponse> {
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

    // Store in environment/session for now
    // In production, this would store in database with userId key
    process.env[`GATEWAY_CONFIG_${userId}`] = JSON.stringify(stored);

    return this.configToResponse(stored);
  }

  /**
   * Load gateway configuration with decrypted API key
   */
  async loadConfig(userId: string): Promise<GatewayConfig | null> {
    const stored = process.env[`GATEWAY_CONFIG_${userId}`];
    if (!stored) {
      return null;
    }

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
    const stored = process.env[`GATEWAY_CONFIG_${userId}`];
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
    delete process.env[`GATEWAY_CONFIG_${userId}`];
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
        model: 'meta-llama/llama-2-70b-chat',
        temperature: 0.7,
        maxTokens: 2000,
      },
      huggingface: {
        provider: 'huggingface',
        model: 'meta-llama/Llama-2-70b-chat-hf',
        temperature: 0.7,
        maxTokens: 2000,
      },
      litelm: {
        provider: 'litelm',
        model: 'gpt-3.5-turbo',
        baseUrl: 'http://localhost:4000',
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
        model: 'llama2',
        baseUrl: 'http://localhost:11434/v1',
        temperature: 0.7,
        maxTokens: 2000,
      },
      openai: {
        provider: 'openai',
        model: 'gpt-4-turbo',
        temperature: 0.7,
        maxTokens: 2000,
      },
      anthropic: {
        provider: 'anthropic',
        model: 'claude-3-sonnet-20240229',
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
