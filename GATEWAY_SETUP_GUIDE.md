# Unified LLM Gateway - Setup & Testing Guide

## Quick Start

### 1. Environment Setup

Create a `.env.local` file with the encryption key:

```bash
# Generate a secure 32+ character key
openssl rand -base64 32

# Add to .env.local
GATEWAY_ENCRYPTION_KEY=your-generated-key-here
```

### 2. Basic Configuration

1. Start the app: `npm run dev`
2. Open Settings → LLM Gateway tab
3. Select a provider (e.g., OpenRouter)
4. Paste your API key
5. Click "Test Connection"
6. Click "Save Configuration"

## Provider Setup Instructions

### OpenRouter (Recommended for Testing)

**Why:** 500+ models, free tier available, easy API

**Setup:**
1. Visit https://openrouter.ai
2. Sign up and get API key
3. Add $5 credit (free tier)
4. In Settings:
   - Provider: OpenRouter
   - API Key: Paste your key
   - Model: Choose from dropdown (e.g., gpt-3.5-turbo-free)

**Test:**
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "x-user-id: default" \
  -d '{"message":"Say hello","messages":[]}'
```

### OpenAI Direct

**Setup:**
1. Visit https://platform.openai.com/api-keys
2. Create API key
3. In Settings:
   - Provider: OpenAI
   - API Key: sk-...
   - Model: gpt-4-turbo (or gpt-3.5-turbo)

### Anthropic (Claude)

**Setup:**
1. Visit https://console.anthropic.com
2. Create API key
3. In Settings:
   - Provider: Anthropic
   - API Key: (from Anthropic console)
   - Model: claude-3-sonnet-20240229

### Hugging Face

**Setup:**
1. Visit https://huggingface.co/settings/tokens
2. Create or copy token
3. In Settings:
   - Provider: Hugging Face
   - API Key: (HF token)
   - Model: meta-llama/Llama-2-70b-chat-hf

### AWS Bedrock

**Prerequisites:**
- AWS account with Bedrock access
- IAM permissions for bedrock:InvokeModel

**Setup:**
1. Configure AWS credentials locally:
   ```bash
   aws configure
   ```
2. In Settings:
   - Provider: AWS Bedrock
   - API Key: (AWS access key or leave if using default credentials)
   - Model: anthropic.claude-3-sonnet-20240229-v1:0

### Local Ollama

**Setup:**
1. Install Ollama: https://ollama.ai
2. Pull a model:
   ```bash
   ollama pull llama2
   ollama pull mistral
   ```
3. Start Ollama:
   ```bash
   ollama serve
   ```
4. In Settings:
   - Provider: Ollama
   - Base URL: http://localhost:11434/v1
   - API Key: (leave blank)
   - Model: llama2 (or other pulled model)

### LiteLLM Proxy (Enterprise)

**Setup:**
1. Install LiteLLM:
   ```bash
   pip install litellm
   ```
2. Start proxy:
   ```bash
   litellm --model openai/gpt-3.5-turbo
   ```
3. In Settings:
   - Provider: LiteLLM
   - Base URL: http://localhost:4000
   - API Key: (required if proxy requires auth)
   - Model: gpt-3.5-turbo

## Testing Scenarios

### Scenario 1: Provider Switching

**Test:**
1. Configure OpenRouter with GPT-4
2. Send message in chat
3. Go to Settings → LLM Gateway
4. Switch to Anthropic + Claude
5. Test connection
6. Save
7. Send another message
8. Verify response uses Claude

**Expected:** Chat seamlessly switches between providers

### Scenario 2: Model Comparison

**Test:**
1. Set up multiple provider tabs
2. Ask same question to GPT-4, Claude, and Llama
3. Compare response quality/speed/cost

**Expected:** Different models provide different response characteristics

### Scenario 3: Error Handling

**Test:**
1. Enter invalid API key
2. Click test connection
3. Observe error message
4. Try to send message

**Expected:** Clear error messages, graceful failures

### Scenario 4: Token Limits

**Test:**
1. Set maxTokens to 50
2. Ask a long question
3. Observe truncated response

**Expected:** Response respects token limit

### Scenario 5: Temperature Variation

**Test:**
1. Set temperature to 0 (deterministic)
2. Ask "Write a random sentence" 3x
3. Set temperature to 2 (creative)
4. Ask same question 3x

**Expected:** Low temp = consistent, high temp = varied responses

## Integration Testing

### With Full Duplex Audio

**Test:**
1. Configure gateway
2. Start voice interaction
3. Speak to microphone
4. Verify response from configured LLM
5. Hear voice reply

**Expected:** Voice + LLM integration works end-to-end

### With Avatar Animations

**Test:**
1. Configure gateway
2. Trigger chat interaction
3. Watch avatar respond with lip-sync

**Expected:** Avatar animations match LLM response timing

### With Persona Cloning

**Test:**
1. Set up voice cloning
2. Configure gateway
3. Interact with avatar

**Expected:** Responses use selected LLM + cloned voice

## Performance Testing

### Response Time Benchmark

```bash
#!/bin/bash
echo "Testing response times..."

for provider in openai anthropic openrouter; do
  echo "Provider: $provider"
  time curl -X POST http://localhost:3000/api/chat \
    -H "Content-Type: application/json" \
    -H "x-user-id: default" \
    -d '{"message":"What is 2+2?","messages":[]}'
done
```

### Load Testing

```bash
# Using Apache Bench
ab -n 100 -c 10 -p request.json \
  -T application/json \
  http://localhost:3000/api/chat
```

### Cost Estimation

Check the UNIFIED_LLM_GATEWAY.md for per-provider cost comparison.

## Troubleshooting

### "No gateway configuration found"

**Cause:** User hasn't configured a gateway yet

**Fix:**
1. Open Settings → LLM Gateway
2. Select provider
3. Enter API key
4. Save

### Connection test fails with 401

**Cause:** Invalid or expired API key

**Fix:**
1. Verify API key on provider's website
2. Check if key has required permissions
3. Regenerate key if needed
4. Paste new key in Settings

### Connection test fails with 403

**Cause:** API key valid but account lacks permissions

**Fix:**
1. Check account tier/billing
2. Verify model is available in your region
3. Check rate limits

### Slow responses

**Cause:** Model selection or network issues

**Fix:**
1. Try faster model (e.g., gpt-3.5-turbo)
2. Reduce maxTokens
3. Reduce temperature
4. Check network latency: `ping api-provider.com`

### "Invalid model"

**Cause:** Model not available in provider

**Fix:**
1. Click "Refresh Models"
2. Select from available list
3. Or override in advanced settings

## Development Workflow

### Adding a New Provider

1. Add to `GatewayProvider` type in `/lib/unified-gateway.ts`
2. Add to `PROVIDER_DEFAULTS` mapping
3. Add to `PROVIDERS` in `/components/gateway-config.tsx`
4. Implement provider-specific header logic in `buildHeaders()`
5. Add models to `/app/api/gateway/models/route.ts`
6. Test connection flow

### Creating a Custom Gateway

For proprietary or specialized gateways:

1. Implement OpenAI-compatible `/v1/chat/completions` endpoint
2. In Settings:
   - Provider: custom
   - Base URL: https://your-gateway.com/v1
   - API Key: your-key
   - Model: your-model-id

### Debugging

Enable debug logging:

```typescript
// In /lib/unified-gateway.ts - add before gateway call
console.log('[v0] Gateway config:', JSON.stringify(config, null, 2));
console.log('[v0] Request payload:', JSON.stringify(payload, null, 2));
```

## Security Best Practices

### For Production

1. **Use environment variables for master key:**
   ```bash
   export GATEWAY_ENCRYPTION_KEY=$(openssl rand -base64 32)
   ```

2. **Rotate API keys regularly:**
   ```bash
   # In provider console, generate new key
   # Update in Settings
   # Delete old key from provider
   ```

3. **Use separate keys per deployment:**
   - Dev: free tier API key
   - Staging: limited quota key
   - Production: full quota key

4. **Monitor usage:**
   - Check provider's usage dashboard
   - Alert on unusual activity
   - Set spending limits

5. **Audit trails:**
   - Log which provider/model used for each request
   - Track cost per conversation
   - Review provider logs

## Performance Optimization

### Caching Responses

For frequently asked questions, cache results:

```typescript
// Not implemented yet - future enhancement
const cacheKey = hash(messages);
if (cache.has(cacheKey)) {
  return cache.get(cacheKey);
}
```

### Batching

For multiple requests, batch them:

```typescript
// Future enhancement using provider APIs
await gateway.batchChat([
  { messages: [...] },
  { messages: [...] },
]);
```

### Model Selection

Use cheaper models for simple tasks:

```typescript
if (message.length < 100 && !needsReasoning) {
  // Use fast + cheap model
  model = 'gpt-3.5-turbo';
} else {
  // Use powerful model
  model = 'gpt-4-turbo';
}
```

## Migration Checklist

- [ ] Generate GATEWAY_ENCRYPTION_KEY
- [ ] Add to .env.local
- [ ] Test with at least 2 providers
- [ ] Verify chat integration works
- [ ] Test voice + gateway integration
- [ ] Test error handling
- [ ] Benchmark response times
- [ ] Set up monitoring
- [ ] Document company's provider choice
- [ ] Train team on gateway configuration
