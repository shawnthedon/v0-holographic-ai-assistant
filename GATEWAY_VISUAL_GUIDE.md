# Unified LLM Gateway - Visual Guide

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Holographic AI Assistant                        │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                    Settings Panel (UI)                        │  │
│  │  ┌──────────────────────────────────────────────────────────┐ │  │
│  │  │ [General]  [LLM Gateway]  [Knowledge Base]              │ │  │
│  │  │                                                          │ │  │
│  │  │  🔧 LLM Provider Configuration                         │ │  │
│  │  │  ┌─────────────────────────────────────────────────┐   │ │  │
│  │  │  │  Provider Grid:                                 │   │ │  │
│  │  │  │  [OpenRouter] [Hugging Face] [AWS] [LiteLLM]   │   │ │  │
│  │  │  │  [Ollama] [OpenAI] [Anthropic] [Cohere]        │   │ │  │
│  │  │  └─────────────────────────────────────────────────┘   │ │  │
│  │  │                                                          │ │  │
│  │  │  Model: [dropdown with 500+ models]                    │ │  │
│  │  │  API Key: [••••••••••••] [👁 show]                     │ │  │
│  │  │  Base URL: [https://api.example.com/v1]               │ │  │
│  │  │                                                          │ │  │
│  │  │  Advanced Settings:                                     │ │  │
│  │  │  Temperature: [====|====] 0.7                          │ │  │
│  │  │  Max Tokens: [==|========] 2000                        │ │  │
│  │  │  Top P: [========|==] 0.95                            │ │  │
│  │  │                                                          │ │  │
│  │  │  [Test Connection]  [Save Config]                      │ │  │
│  │  └─────────────────────────────────────────────────────┘   │ │  │
│  │                                                              │ │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  Chat/Voice/Avatar Components                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagram

```
User Configuration
        |
        v
  Settings Panel
        |
        v
┌──────────────────────────────────┐
│  useGatewayConfig() Hook         │
│  - saveConfig()                  │
│  - testConnection()              │
│  - loadConfig()                  │
└──────────────────────────────────┘
        |
        v
┌──────────────────────────────────┐
│  API: POST /api/gateway/config   │
│  - Validates config              │
│  - Encrypts API key              │
│  - Stores securely               │
└──────────────────────────────────┘
        |
        v
  Encrypted Storage
  (Environment or DB)
        
        
User Chat Message
        |
        v
┌──────────────────────────────────┐
│  Chat Component                  │
└──────────────────────────────────┘
        |
        v
┌──────────────────────────────────┐
│  API: POST /api/chat             │
│  - Load user's gateway config    │
│  - Decrypt API key               │
└──────────────────────────────────┘
        |
        v
┌──────────────────────────────────┐
│  UnifiedGatewayService           │
│  - Normalize request             │
│  - Add provider headers          │
│  - Route to gateway              │
└──────────────────────────────────┘
        |
        v
    [Selected LLM Provider]
    (OpenRouter / Ollama / etc)
        |
        v
  LLM Response
        |
        v
    Avatar + Voice
```

## Supported Providers Map

```
                    Unified LLM Gateway
                            |
        ┌───────────────────┼───────────────────┐
        |                   |                   |
     [Cloud]            [Enterprise]        [Local]
        |                   |                   |
   ┌────┴─────┐        ┌────┴─────┐       ┌────┴─────┐
   |           |        |           |       |           |
OpenRouter Hugging   OpenAI    AWS Bedrock Ollama
Face        Anthropic LiteLLM  Custom
   |           |        |       Gateway    Cohere
   |           |        |
500+ models  150+      10+
Limited   Unlimited  Proprietary
```

## Encryption Flow

```
Input API Key
      |
      v
┌─────────────────────┐
│ Generate Random:    │
│ - 32-byte salt      │
│ - 12-byte IV        │
└─────────────────────┘
      |
      v
┌─────────────────────┐
│ PBKDF2 Derivation   │
│ (100k iterations)   │
└─────────────────────┘
      |
      v
┌─────────────────────┐
│ AES-256-GCM         │
│ Encryption          │
└─────────────────────┘
      |
      v
┌──────────────────────────────────┐
│ {                                 │
│   iv: "base64-encoded",          │
│   authTag: "base64-encoded",     │
│   salt: "base64-encoded",        │
│   encrypted: "base64-encoded"    │
│ }                                │
└──────────────────────────────────┘
      |
      v
  Store Encrypted
  (Never expose to browser)
```

## Configuration State Machine

```
            ┌─────────────────┐
            │   No Config     │
            └────────┬────────┘
                     |
                     | User opens Settings
                     v
            ┌─────────────────┐
            │  Selecting      │
            │  Provider       │
            └────────┬────────┘
                     |
                     | Provider selected
                     v
            ┌─────────────────┐
            │  Entering       │
            │  Credentials    │
            └────────┬────────┘
                     |
         ┌───────────┴───────────┐
         |                       |
         | Test                  | Save
         v                       v
    ┌──────────┐          ┌──────────────┐
    │ Testing  │          │ Saving       │
    │ Connect  │          │ Config       │
    └────┬─────┘          └──────┬───────┘
         |                       |
         | Success               | Success
         v                       v
    ┌──────────────────────────────────────┐
    │         Configuration Saved           │
    │  Ready to use in chat                │
    └──────────────────────────────────────┘
```

## Provider Feature Comparison

```
┌────────────────┬─────────────┬────────────┬──────────┬────────────┐
│ Provider       │ Models      │ Auth       │ Cost     │ Latency    │
├────────────────┼─────────────┼────────────┼──────────┼────────────┤
│ OpenRouter     │ 500+        │ API Key    │ $0-$30   │ 1-5s       │
│ Hugging Face   │ 150+        │ Token      │ Free-$$$ │ 1-8s       │
│ AWS Bedrock    │ 20+         │ IAM        │ $$-$$$$  │ 1-3s       │
│ LiteLLM        │ Unlimited   │ Custom     │ Custom   │ <1s        │
│ Ollama         │ Limited     │ None       │ Free     │ <1s        │
│ OpenAI         │ 10+         │ API Key    │ $-$$$$   │ 1-5s       │
│ Anthropic      │ 5           │ API Key    │ $$$-$$$ │ 2-6s       │
│ Cohere         │ 3           │ API Key    │ $-$$     │ 1-3s       │
└────────────────┴─────────────┴────────────┴──────────┴────────────┘
```

## UI Component Hierarchy

```
App Layout
│
├── SettingsPanel
│   ├── Tab Navigation
│   │   ├── General (existing)
│   │   ├── LLM Gateway (NEW)
│   │   └── Knowledge Base (existing)
│   │
│   └── Content Area
│       ├── General Tab Content (existing)
│       ├── LLM Gateway Tab Content
│       │   └── GatewayConfig Component
│       │       ├── Provider Selector Grid
│       │       ├── Model Dropdown
│       │       ├── API Key Input
│       │       ├── Base URL Input
│       │       ├── Advanced Settings Panel
│       │       ├── Test Button
│       │       └── Save Button
│       └── Knowledge Base Tab Content (existing)
│
└── Chat Components
    ├── AvatarScene
    ├── ControlMenu
    └── [uses configured gateway]
```

## API Endpoint Usage Pattern

```
1. Load Configuration
   GET /api/gateway/config
   → Returns current config (no API key)

2. Load Models for Provider
   GET /api/gateway/models?provider=openrouter
   → Returns list of available models

3. Test Connection
   POST /api/gateway/test
   Body: { provider, model, apiKey, baseUrl }
   → Returns { success, error? }

4. Save Configuration
   POST /api/gateway/config
   Body: { provider, model, apiKey, baseUrl, settings }
   → Returns encrypted config (no key)

5. Use in Chat
   POST /api/chat
   Body: { message, messages }
   Header: x-user-id
   → Automatically uses saved config
   → Returns LLM response
```

## Security Layers

```
Layer 1: Frontend Input
├── Password type field (•••••)
├── Show/hide toggle
└── Input validation

Layer 2: Transmission
├── HTTPS/TLS encryption
└── No plaintext in logs

Layer 3: Server-side
├── AES-256-GCM encryption
├── PBKDF2 derivation
├── Server-side only decryption
└── Secure key storage

Layer 4: Display
├── Masked as ••••xxxx
├── Never logged
└── Accessible only server-side
```

## Request Flow Timeline

```
Time    Component              Action
─────────────────────────────────────────────────
0ms     User opens Settings    →
100ms   Gateway Config loads   ← User's current config loaded
200ms   Provider selected      → User selects provider
300ms   Models fetch started   → GET /api/gateway/models
500ms   Models loaded          ← Display model list
600ms   API key entered        → User pastes API key
700ms   Test clicked           → POST /api/gateway/test
800ms   Gateway validates      ← Testing connection...
2000ms  Test result            ← ✓ Connection successful
2100ms  Save clicked           → POST /api/gateway/config
2200ms  Encryption happens     ← Encrypting API key
2300ms  Config saved           ← ✓ Configuration saved
2400ms  UI updated             → Show success message
```

## Migration from Hardcoded to Dynamic

```
BEFORE:
┌──────────────────────────┐
│  Chat API (/api/chat)   │
├──────────────────────────┤
│  if model == "gemini"    │
│    → call Gemini SDK     │
│  else if model == "gpt"  │
│    → call OpenAI SDK     │
│  else                    │
│    → default to Gemini   │
└──────────────────────────┘
Limited to 2-3 models

AFTER:
┌──────────────────────────┐
│  Chat API (/api/chat)   │
├──────────────────────────┤
│  Load user config        │
│  Create gateway service  │
│  Call unified service    │
│  Return LLM response     │
└──────────────────────────┘
Supports 500+ models
```

## Cost Analysis Chart

```
Cost per 1M tokens (approximate)

$100 │
$90  │                  ┌─ GPT-4-Turbo
$80  │                  │
$70  │                  │
$60  │                  │
$50  │                  │
$40  │                  │
$30  │        ┌─ Claude-3-Opus
$20  │        │
$10  │    ┌───┤   ┌─ GPT-3.5-Turbo
$5   │    │   │   │   ┌─ Claude-3-Sonnet
$2   │    │   │   │   │  ┌─ Llama-2 (OpenRouter)
$1   │    │   │   │   │  │
$0   │────┴───┴───┴───┴──┴─ Ollama (local)
     └─────────────────────────────
      Fast & Cheap ←→ Powerful & Expensive
```

## Recommended Setup by Use Case

```
Development & Testing
→ Ollama (local, free)
→ OpenRouter free tier

Production Chat
→ GPT-3.5-Turbo (cost/quality)
→ Claude-3-Sonnet (alternative)

High-Quality Responses
→ GPT-4-Turbo
→ Claude-3-Opus

Cost-Conscious
→ Llama-2 (OpenRouter)
→ Mistral-7B
→ Open-source on Hugging Face

Enterprise
→ AWS Bedrock
→ LiteLLM proxy
→ Self-hosted gateway
```

## Next Steps Visualization

```
Current State: Unified Gateway Live
        ↓
Recommended Enhancements:
        ├── Response Streaming
        ├── Model Caching
        ├── Auto-selection by cost/speed
        ├── A/B Testing
        ├── Usage Analytics
        └── Fallback Providers

Timeline:
Week 1: Testing & validation
Week 2: User feedback collection
Week 3: Performance optimization
Week 4: Analytics dashboard
Month 2: Streaming + caching
Month 3: AI model selection
```
