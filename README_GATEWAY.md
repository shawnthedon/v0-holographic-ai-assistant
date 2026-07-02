# Unified LLM Gateway Feature

## 🚀 What's New

The Holographic AI Assistant now supports **500+ Large Language Models** across **9 major providers**, all through a unified gateway that requires zero code changes.

### Before
- Hardcoded to 2-3 models (Gemini, GPT-4)
- Provider-specific SDKs
- Manual switching required code deployment

### After
- 500+ models from any provider
- Single OpenAI-compatible interface
- Dynamic switching via Settings panel
- Secure encrypted API key storage

## 🎯 Quick Start (5 minutes)

### 1. Setup Environment
```bash
# Generate encryption key
openssl rand -base64 32

# Add to .env.local
GATEWAY_ENCRYPTION_KEY=your-generated-key-here
```

### 2. Start Application
```bash
npm run dev
# Visit http://localhost:3000
```

### 3. Configure Gateway
1. Open **Settings** (gear icon)
2. Click **"LLM Gateway"** tab
3. Select a provider (e.g., OpenRouter)
4. Paste your API key
5. Click **"Test Connection"**
6. Click **"Save Configuration"**

### 4. Start Chatting
Just use the chat as normal. The configured gateway is now active!

## 📋 Supported Providers

| Provider | Models | Free Tier | Setup Time |
|----------|--------|-----------|------------|
| **OpenRouter** | 500+ | ✅ Yes | 2 min |
| **Ollama** (Local) | 20+ | ✅ Yes | 5 min |
| **Hugging Face** | 150+ | ✅ Yes | 3 min |
| **OpenAI** | 10 | ❌ No | 2 min |
| **Anthropic** | 5 | ❌ No | 2 min |
| **AWS Bedrock** | 20 | ❌ No | 5 min |
| **LiteLLM** | ∞ | ✅ Self-hosted | 10 min |
| **Cohere** | 3 | ❌ No | 2 min |

## 🔐 Security

### API Key Protection
- ✅ **Encrypted** with AES-256-GCM
- ✅ **Server-side only** - never touches browser
- ✅ **Masked** in UI as `••••xxxx`
- ✅ **Rotatable** - update anytime in Settings

### Best Practices
1. Use unique API keys per deployment
2. Rotate keys quarterly
3. Monitor provider usage dashboards
4. Set spending limits on accounts
5. Use least-privileged API keys

## 📚 Documentation

### Quick References
- **[GATEWAY_SETUP_GUIDE.md](./GATEWAY_SETUP_GUIDE.md)** - Provider setup + testing
- **[UNIFIED_LLM_GATEWAY.md](./UNIFIED_LLM_GATEWAY.md)** - Architecture + API docs
- **[GATEWAY_VISUAL_GUIDE.md](./GATEWAY_VISUAL_GUIDE.md)** - Diagrams + flowcharts
- **[GATEWAY_IMPLEMENTATION_SUMMARY.md](./GATEWAY_IMPLEMENTATION_SUMMARY.md)** - What was built

### For Developers
```bash
# Key files
lib/gateway-encryption.ts         # Encryption utils
lib/unified-gateway.ts            # Core service
lib/gateway-config-manager.ts     # Config storage
app/api/gateway/                  # API endpoints
components/gateway-config.tsx     # Settings UI
hooks/use-gateway-config.ts       # React hook
```

## 🧪 Testing Scenarios

### Scenario 1: Provider Switching
```
1. Configure OpenRouter + GPT-4
2. Chat: "Hello"
3. Settings → Switch to Anthropic + Claude
4. Chat: "Hello"
→ Result: Same chat interface, different models
```

### Scenario 2: Cost Comparison
```
1. Ask same question to 3 providers
2. Compare cost per response
3. Note response quality differences
→ Choose optimal balance for your use case
```

### Scenario 3: Error Recovery
```
1. Set invalid API key
2. Try to chat
3. See error message
4. Update API key in Settings
5. Try again
→ Graceful error handling
```

## 💰 Cost Estimation

### Pricing by Provider (Per 1M Tokens)
```
Most Expensive:
  GPT-4 Turbo: $30-$90

Mid-Range:
  Claude 3 Opus: $15-$30
  GPT-3.5-Turbo: $0.50-$1.50

Most Affordable:
  Llama 2 (OpenRouter): $0.50-$2
  Ollama (Local): Free (hardware only)
```

### Example Costs
For 1000 conversations (1000 words each):
- GPT-4: ~$5-10
- GPT-3.5: $0.10-0.20
- Llama 2: $0.10-0.30
- Ollama: $0

## 🛠️ Common Tasks

### Switch from GPT-4 to Claude
```
Settings → LLM Gateway
[Select Anthropic]
Model: [Claude 3 Sonnet]
[Test Connection]
[Save]
→ All future chats use Claude
```

### Use Local Ollama
```
1. Install Ollama: https://ollama.ai
2. Terminal: ollama pull llama2
3. Terminal: ollama serve
4. Settings → LLM Gateway
5. Provider: Ollama
6. Model: llama2
7. Base URL: http://localhost:11434/v1
8. [Test] → [Save]
```

### Use Self-Hosted Gateway
```
Deploy LiteLLM proxy:
docker run -p 4000:4000 \
  -e OPENAI_API_KEY=sk-... \
  ghcr.io/berriai/litellm:main

Settings → LLM Gateway
Provider: LiteLLM
Base URL: http://your-server.com:4000
Model: gpt-3.5-turbo
```

## 🚨 Troubleshooting

### "No gateway configuration found"
→ Configure in Settings → LLM Gateway first

### "Invalid API key" 
→ Verify key on provider's website, try regenerating

### "Connection timeout"
→ Check internet connection, provider status page, network firewall

### "Model not available"
→ Try "Refresh Models" button, check account tier/region

### "Slow responses"
→ Try faster model, reduce max tokens, check latency to provider

## 📊 Performance Benchmarks

### Response Times (Approximate)
```
GPT-4 Turbo:     2-5 seconds
Claude 3:        3-6 seconds  
GPT-3.5 Turbo:   1-2 seconds
Llama 2 70B:     3-8 seconds
Mistral 7B:      1-3 seconds
Ollama (Local):  <1 second
```

### Token Usage
No inflated token counts - what you see is what you pay.

## 🎓 Examples

### Example 1: Budget-Conscious Chatbot
```
Use: Ollama locally
Cost: Free
Setup: 5 minutes
Quality: Good for most tasks
```

### Example 2: Production Chat App
```
Use: GPT-3.5-Turbo (default)
Cost: $0.50-1.50 per 1M tokens
Quality: Excellent for most needs
```

### Example 3: High-Quality Responses
```
Use: GPT-4 Turbo
Cost: $30-90 per 1M tokens
Quality: Best available
```

### Example 4: Hybrid Approach
```
- Simple questions: Llama 2 (cheap)
- Complex reasoning: GPT-4 (expensive)
- Auto-route based on question type
```

## 🔗 Integration Points

The gateway integrates seamlessly with existing features:

- ✅ Voice input/output (talks to selected LLM)
- ✅ Avatar lip-sync (matches LLM response)
- ✅ Persona cloning (uses any LLM)
- ✅ Knowledge base RAG (works with any model)
- ✅ Full-duplex audio (any LLM supported)

## 📞 Getting Help

### Documentation
- Start with [GATEWAY_SETUP_GUIDE.md](./GATEWAY_SETUP_GUIDE.md)
- See [UNIFIED_LLM_GATEWAY.md](./UNIFIED_LLM_GATEWAY.md) for architecture

### Provider Support
- OpenRouter: https://openrouter.ai/docs
- Hugging Face: https://huggingface.co/docs/api-inference
- AWS Bedrock: https://aws.amazon.com/bedrock/
- OpenAI: https://platform.openai.com/docs

### Issues?
Check [GATEWAY_SETUP_GUIDE.md - Troubleshooting](./GATEWAY_SETUP_GUIDE.md#troubleshooting)

## 🎯 Next Steps

1. ✅ **Try it out** with your favorite provider
2. ✅ **Compare models** and find your sweet spot
3. ✅ **Optimize costs** by choosing right model for task
4. ✅ **Monitor usage** on provider's dashboard
5. ✅ **Share feedback** on what works best

## 🎉 Summary

You now have access to **500+ LLMs** with:
- ✅ Zero code changes
- ✅ Secure encrypted storage
- ✅ Easy UI configuration
- ✅ Dynamic provider switching
- ✅ Full backwards compatibility

Enjoy exploring unlimited possibilities! 🚀
