# Unified LLM Gateway Architecture

## Overview

The Holographic AI Assistant now supports **500+ Large Language Models** through a unified gateway architecture. Instead of maintaining individual SDK integrations, the system routes all LLM requests through a single OpenAI-compatible RESTful API that abstracts multiple providers.

## Supported Providers

### 1. **OpenRouter** (500+ models)
- URL: `https://openrouter.ai/api/v1`
- Supports: GPT-4, Claude, Llama, Mistral, and hundreds more
- Auth: Bearer token
- Popular Models:
  - `openai/gpt-4-turbo` - Latest GPT-4 Turbo
  - `anthropic/claude-3-opus` - Claude 3 Opus
  - `meta-llama/llama-2-70b-chat` - Llama 2 70B
  - `mistralai/mistral-7b-instruct` - Mistral 7B

### 2. **Hugging Face** (150+ models)
- URL: `https://api-inference.huggingface.co/v1`
- Supports: Open-source models from Hugging Face Hub
- Auth: HF_TOKEN
- Popular Models:
  - `meta-llama/Llama-2-70b-chat-hf`
  - `mistralai/Mistral-7B-Instruct-v0.1`
  - `tiiuae/falcon-180B-chat`

### 3. **AWS Bedrock** (20+ models)
- URL: `https://bedrock-runtime.us-east-1.amazonaws.com`
- Supports: Claude, Llama, Jurassic models
- Auth: AWS IAM credentials
- Popular Models:
  - `anthropic.claude-3-opus-20240229-v1:0`
  - `anthropic.claude-3-sonnet-20240229-v1:0`
  - `meta.llama2-70b-chat-v1`

### 4. **LiteLLM** (Universal Proxy)
- URL: `http://0.0.0.0:4000`
- Self-hosted gateway supporting any LLM provider
- Auth: Custom (via proxy)
- Best for: Enterprise + local deployments

### 5. **Ollama** (Local Models)
- URL: `http://localhost:11434/v1`
- Supports: Running models locally (Llama 2, Mistral, etc.)
- Auth: None required (local)
- Best for: Development + privacy-sensitive deployments

### 6. **OpenAI** (Direct Integration)
- URL: `https://api.openai.com/v1`
- Models: GPT-4, GPT-3.5-Turbo
- Auth: API key

### 7. **Anthropic** (Direct Integration)
- URL: `https://api.anthropic.com`
- Models: Claude 3 family
- Auth: API key

### 8. **Cohere** (Direct Integration)
- URL: `https://api.cohere.com/v1`
- Models: Command, Command-Light
- Auth: API key

## Architecture

### Core Components

#### 1. **UnifiedGatewayService** (`/lib/unified-gateway.ts`)
Abstracts all providers through a single interface:

```typescript
const gateway = createGatewayService({
  provider: 'openrouter',
  model: 'openai/gpt-4-turbo',
  apiKey: 'your-api-key',
  baseUrl: 'https://openrouter.ai/api/v1', // optional
  timeout: 30000,
});

const response = await gateway.chat({
  messages: [{ role: 'user', content: 'Hello' }],
  temperature: 0.7,
  maxTokens: 2000,
});
```

#### 2. **GatewayConfigManager** (`/lib/gateway-config-manager.ts`)
Handles encrypted storage and retrieval of gateway configurations:

```typescript
const manager = new GatewayConfigManager();

// Save encrypted config
await manager.saveConfig(userId, {
  provider: 'openrouter',
  model: 'openai/gpt-4-turbo',
  temperature: 0.7,
  maxTokens: 2000,
}, apiKey);

// Load config with decrypted key
const config = await manager.loadConfig(userId);
```

#### 3. **Gateway Encryption** (`/lib/gateway-encryption.ts`)
AES-256-GCM encryption for secure API key storage:

- Keys encrypted at rest
- Never exposed to client-side browser
- Automatic decryption on server-side only
- PBKDF2 key derivation with 100k iterations

#### 4. **API Endpoints** (`/app/api/gateway/`)

##### GET `/api/gateway/config`
Retrieve current configuration (without API key):
```json
{
  "provider": "openrouter",
  "model": "openai/gpt-4-turbo",
  "temperature": 0.7,
  "maxTokens": 2000,
  "masked": "••••xxxx",
  "lastUpdated": 1704067200000
}
```

##### POST `/api/gateway/config`
Save or update configuration with encrypted API key:
```json
{
  "provider": "openrouter",
  "model": "openai/gpt-4-turbo",
  "apiKey": "sk-...",
  "temperature": 0.7,
  "maxTokens": 2000,
  "topP": 1,
  "timeout": 30000
}
```

##### POST `/api/gateway/test`
Test connection without storing credentials:
```json
{
  "provider": "openrouter",
  "model": "openai/gpt-4-turbo",
  "apiKey": "sk-...",
  "baseUrl": "https://openrouter.ai/api/v1"
}
```

Returns:
```json
{
  "success": true,
  "error": null
}
```

##### GET `/api/gateway/models?provider=openrouter`
List available models for a provider:
```json
{
  "provider": "openrouter",
  "models": [
    {
      "id": "openai/gpt-4-turbo",
      "name": "GPT-4 Turbo",
      "contextLength": 128000
    },
    ...
  ],
  "count": 234
}
```

## UI Integration

### Settings Panel - Gateway Tab

The new "LLM Gateway" tab in Settings provides:

1. **Provider Selector**: Grid of 8 providers
2. **Model Dropdown**: Dynamically loads models per provider
3. **API Key Input**: Masked password field
4. **Custom Base URL**: Override endpoint (for self-hosted)
5. **Advanced Settings**:
   - Temperature (0-2)
   - Max Tokens (100-8000)
   - Top P (0-1)
6. **Test Connection**: Validates without storing
7. **Save Configuration**: Encrypts and stores settings

### Hooks

#### `useGatewayConfig()`
React hook for managing gateway configuration in components:

```typescript
const { config, isSaving, testConnection, saveConfig } = useGatewayConfig();

// Test connection
await testConnection({
  provider: 'openrouter',
  model: 'openai/gpt-4-turbo',
  apiKey: 'sk-...',
});

// Save configuration
await saveConfig({
  provider: 'openrouter',
  model: 'openai/gpt-4-turbo',
  apiKey: 'sk-...',
  temperature: 0.7,
  maxTokens: 2000,
});
```

## Security

### API Key Protection

1. **Encryption**: AES-256-GCM with PBKDF2 key derivation
2. **Storage**: Encrypted in environment variables (production: use database)
3. **Transit**: Always via HTTPS
4. **Exposure**: Never to client-side code
5. **Masking**: Displayed as `••••xxxx` in UI

### Environment Setup

Required environment variables:

```bash
# Encryption key for API keys (32+ chars recommended)
GATEWAY_ENCRYPTION_KEY=your-long-secure-random-key-here

# Optional: Individual provider keys (for backward compatibility)
GOOGLE_API_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
```

### Best Practices

1. Use environment variables for secrets
2. Enable HTTPS on all gateways
3. Rotate API keys regularly
4. Use least-privileged API keys
5. Monitor usage for anomalies
6. Enable audit logging

## Integration with Existing Chat API

The chat endpoint (`/api/chat`) now automatically uses the configured gateway:

```typescript
// No change needed in client code
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-user-id': 'default',
  },
  body: JSON.stringify({
    message: 'Hello',
    messages: [],
  }),
});

const data = await response.json();
console.log(data.response); // LLM response
console.log(data.provider); // 'openrouter'
console.log(data.model); // 'openai/gpt-4-turbo'
```

## Migration Guide

### From Hardcoded Models to Gateway

**Before:**
```typescript
// Hardcoded Gemini
const response = await callGemini(message);
```

**After:**
```typescript
// Uses configured gateway
const response = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ message }),
  headers: { 'x-user-id': userId },
});
```

### Setting Up a New Provider

1. Open Settings → LLM Gateway
2. Select provider from dropdown
3. Enter API key (or leave blank for local/free tiers)
4. Models auto-populate
5. Click "Test Connection"
6. Click "Save Configuration"

## Advanced Usage

### Custom Provider Gateway

For self-hosted or proprietary gateways:

```typescript
{
  "provider": "custom",
  "baseUrl": "https://api.yourdomain.com/v1",
  "model": "your-model-id",
  "apiKey": "your-key"
}
```

### Local LLM Development

Using Ollama for local development:

1. Install Ollama: `brew install ollama` (Mac/Linux)
2. Pull a model: `ollama pull llama2`
3. Start server: `ollama serve`
4. In Settings:
   - Provider: Ollama
   - Model: llama2
   - Base URL: http://localhost:11434/v1
   - API Key: (leave blank)

### Load Balancing

For production, use LiteLLM as a proxy:

```bash
docker run -p 4000:4000 \
  -e OPENROUTER_API_KEY=sk-... \
  -e OPENAI_API_KEY=sk-... \
  ghcr.io/berriai/litellm:main
```

Then configure app to use LiteLLM provider at `http://gateway.yourdomain.com:4000`.

## Troubleshooting

### "No gateway configuration found"

**Solution:** User must configure gateway in Settings → LLM Gateway before using chat.

### Connection Test Fails

**Check:**
1. API key is valid
2. Provider endpoint is accessible
3. Network allows outbound connections
4. Try with test endpoint provided by provider

### Slow Responses

**Optimize:**
1. Choose faster model (e.g., gpt-3.5-turbo over gpt-4-turbo)
2. Reduce `maxTokens`
3. Lower `temperature` (less random = faster)
4. Check provider latency

### High Costs

**Reduce by:**
1. Using open-source models (Llama, Mistral)
2. Caching responses
3. Optimizing prompt length
4. Using batching for multiple requests

## Performance Metrics

### Model Response Times (Approximate)
- GPT-4 Turbo: 2-5 seconds
- GPT-3.5 Turbo: 1-2 seconds
- Claude 3 Opus: 3-6 seconds
- Llama 2 70B: 3-8 seconds
- Mistral 7B: 1-3 seconds
- Local Ollama: <1 second

### Cost Comparison (Per 1M tokens)
- GPT-4 Turbo: $30-$90
- GPT-3.5 Turbo: $0.50-$1.50
- Claude 3 Sonnet: $3-$15
- Llama 2 (OpenRouter): $0.50-$2
- Local Ollama: $0 (hardware cost only)

## Future Roadmap

- [ ] Model caching and batching
- [ ] Multi-model routing (automatically select best model)
- [ ] Cost optimization (auto-select cheapest provider)
- [ ] A/B testing between models
- [ ] Usage analytics dashboard
- [ ] Rate limiting and quota management
- [ ] Fallback providers (auto-retry on failure)
- [ ] Stream response support
