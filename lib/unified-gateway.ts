import axios, { AxiosInstance } from 'axios';

/**
 * Unified AI Gateway Service
 * Supports 500+ LLMs through OpenAI-compatible APIs
 * Supports: OpenRouter, Hugging Face, LiteLLM, AWS Bedrock, Ollama, Custom
 */

export type GatewayProvider = 
  | 'openrouter'
  | 'huggingface'
  | 'litellm'
  | 'bedrock'
  | 'ollama'
  | 'custom'
  | 'openai'
  | 'anthropic'
  | 'cohere';

export interface GatewayConfig {
  provider: GatewayProvider;
  apiKey: string;
  baseUrl?: string;
  model: string;
  timeout?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stream?: boolean;
}

export interface ChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message?: {
      role: string;
      content: string;
    };
    delta?: {
      role?: string;
      content?: string;
    };
    finishReason: string | null;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: GatewayProvider;
  contextLength?: number;
  costPer1kPromptTokens?: number;
  costPer1kCompletionTokens?: number;
  description?: string;
}

const PROVIDER_DEFAULTS: Record<GatewayProvider, { baseUrl: string; headers?: Record<string, string> }> = {
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  huggingface: {
    baseUrl: 'https://api-inference.huggingface.co/v1',
  },
  litellm: {
    baseUrl: 'http://127.0.0.1:4000/v1',
  },
  bedrock: {
    baseUrl: 'https://bedrock-runtime.us-east-1.amazonaws.com',
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
  },
  custom: {
    baseUrl: '', // Must be provided in config
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
  },
  cohere: {
    baseUrl: 'https://api.cohere.com/v1',
  },
};

/**
 * UnifiedGatewayService
 * Abstracts all LLM providers through a single OpenAI-compatible interface
 */
export class UnifiedGatewayService {
  private client: AxiosInstance;
  private config: GatewayConfig;
  private baseUrl: string;

  constructor(config: GatewayConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || PROVIDER_DEFAULTS[config.provider].baseUrl;

    if (!this.baseUrl) {
      throw new Error(`No base URL configured for provider: ${config.provider}`);
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: config.timeout || 30000,
      headers: this.buildHeaders(),
    });
  }

  /**
   * Build authentication and provider-specific headers
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    switch (this.config.provider) {
      case 'openrouter':
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        headers['HTTP-Referer'] = process.env.APP_URL || 'http://localhost:3000';
        headers['X-Title'] = 'Holographic AI Assistant';
        break;

      case 'huggingface':
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        break;

      case 'bedrock':
        // AWS Bedrock uses AWS SDK, not standard headers
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        break;

      case 'litellm':
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        break;

      case 'ollama':
        // Ollama typically doesn't require auth
        break;

      case 'openai':
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        break;

      case 'anthropic':
        headers['x-api-key'] = this.config.apiKey;
        headers['anthropic-version'] = '2023-06-01';
        break;

      case 'cohere':
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        break;

      case 'custom':
        // Custom providers might use different auth schemes
        if (this.config.apiKey) {
          headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        }
        break;
    }

    return headers;
  }

  /**
   * Send a chat completion request
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    try {
      const payload = this.normalizeRequest(request);

      const response = await this.client.post<ChatResponse>('/chat/completions', payload);
      return response.data;
    } catch (error) {
      throw new Error(
        `Gateway error [${this.config.provider}]: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Send a streaming chat completion request
   */
  async chatStream(request: ChatRequest): Promise<ReadableStream> {
    try {
      const payload = this.normalizeRequest({ ...request, stream: true });

      const response = await this.client.post('/chat/completions', payload, {
        responseType: 'stream',
      });

      return response.data as ReadableStream;
    } catch (error) {
      throw new Error(
        `Gateway streaming error [${this.config.provider}]: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Normalize request to OpenAI format
   */
  private normalizeRequest(request: ChatRequest) {
    return {
      model: this.config.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 1024,
      top_p: request.topP ?? 1,
      frequency_penalty: request.frequencyPenalty ?? 0,
      presence_penalty: request.presencePenalty ?? 0,
      stream: request.stream ?? false,
    };
  }

  /**
   * Test the gateway connection
   */
  async testConnection(): Promise<{ success: boolean; model: string; error?: string; fix?: string }> {
    // Delegate to the shared adapter layer so a "test" exercises the same
    // request shape production uses. The old implementation posted an
    // OpenAI-compatible body at every provider, which reported false
    // successes for Anthropic/Bedrock/Cohere.
    try {
      const { chat } = await import('./llm/service');
      const { PROVIDERS } = await import('./llm/providers');
      const providerId = this.config.provider === ('litelm' as string) ? 'litellm' : this.config.provider;
      const provider = PROVIDERS[providerId as keyof typeof PROVIDERS];

      if (!provider) {
        return {
          success: false,
          model: this.config.model,
          error: `Unknown provider "${this.config.provider}"`,
          fix: 'Use one of the providers listed by GET /api/models.',
        };
      }

      const result = await chat({
        modelId: `${providerId}/${this.config.model}`,
        credential: { apiKey: this.config.apiKey, baseUrl: this.config.baseUrl },
        messages: [
          { role: 'system', content: 'You are a connectivity probe. Reply with the single word OK.' },
          { role: 'user', content: 'ping' },
        ],
        maxTokens: 8,
        temperature: 0,
      });

      return { success: true, model: result.model };
    } catch (error) {
      const fix = (error as { fix?: string }).fix;
      return {
        success: false,
        model: this.config.model,
        error: error instanceof Error ? error.message : 'Unknown error',
        fix,
      };
    }
  }

  /**
   * Get provider configuration
   */
  getConfig(): GatewayConfig {
    return { ...this.config };
  }

  /**
   * Get available models for a provider (stub - should be overridden per provider)
   */
  static async getAvailableModels(provider: GatewayProvider, apiKey: string): Promise<ModelInfo[]> {
    // This would fetch from the provider's API
    // For now, returning empty - implement per-provider logic
    return [];
  }
}

/**
 * Factory function to create gateway service from config
 */
export function createGatewayService(config: GatewayConfig): UnifiedGatewayService {
  return new UnifiedGatewayService(config);
}
