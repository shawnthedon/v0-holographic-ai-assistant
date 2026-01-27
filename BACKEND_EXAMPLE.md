# Backend Implementation Example: Full-Duplex PersonaPlex

This guide shows how to implement a Node.js WebSocket backend for full-duplex speech-to-speech with PersonaPlex.

## Setup

```bash
npm install ws express dotenv @google-cloud/text-to-speech
```

## WebSocket Server Implementation

### `server.ts`

```typescript
import WebSocket from 'ws';
import express from 'express';
import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const wss = new WebSocket.Server({ port: 8000 });

// Store active connections and their personas
const clients = new Map<WebSocket, ClientContext>();

interface ClientContext {
  voicePrompt?: Buffer;
  rolePrompt?: string;
  conversationHistory: Array<{ role: string; content: string }>;
}

// Initialize TTS client
const ttsClient = new TextToSpeechClient();

wss.on('connection', (ws: WebSocket) => {
  console.log('[Server] New WebSocket connection');
  
  const context: ClientContext = {
    conversationHistory: [],
  };
  clients.set(ws, context);

  ws.on('message', async (data: WebSocket.Data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle different message types
      if (message.type === 'audio') {
        await handleAudioStream(ws, message, context);
      } else if (message.type === 'setup') {
        handleSetup(message, context);
      }
    } catch (error) {
      console.error('[Server] Message handling error:', error);
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Processing failed' 
      }));
    }
  });

  ws.on('close', () => {
    console.log('[Server] Connection closed');
    clients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('[Server] WebSocket error:', error);
  });
});

// Handle incoming audio stream
async function handleAudioStream(
  ws: WebSocket,
  message: any,
  context: ClientContext
) {
  console.log('[Server] Received audio chunk');
  
  // Convert received data to Int16Array
  const int16Data = new Int16Array(message.data);
  
  // 1. Speech-to-Text (transcribe user audio)
  const userText = await transcribeAudio(int16Data);
  console.log('[Server] Transcribed:', userText);
  
  // Add to conversation history
  context.conversationHistory.push({
    role: 'user',
    content: userText,
  });
  
  // 2. LLM Processing (with role prompt context)
  const systemPrompt = buildSystemPrompt(context.rolePrompt);
  const llmResponse = await callLLM(userText, context.conversationHistory, systemPrompt);
  console.log('[Server] LLM response:', llmResponse);
  
  // Add to conversation history
  context.conversationHistory.push({
    role: 'assistant',
    content: llmResponse,
  });
  
  // 3. Text-to-Speech (with voice cloning)
  const audioBuffer = await synthesizeSpeech(
    llmResponse,
    context.voicePrompt
  );
  
  // 4. Process with PersonaPlex (apply voice/role conditioning)
  const personaplexOutput = await processWithPersonaPlex(
    audioBuffer,
    {
      voicePrompt: context.voicePrompt,
      rolePrompt: context.rolePrompt,
    }
  );
  
  // 5. Generate viseme timing
  const visemes = await detectVisemes(personaplexOutput);
  
  // 6. Send response back to client
  ws.send(JSON.stringify({
    type: 'audio',
    data: Array.from(new Int16Array(personaplexOutput)),
    format: 'int16',
    sampleRate: 16000,
    visemes: visemes, // Optional: send timing data
    transcript: {
      user: userText,
      assistant: llmResponse,
    }
  }));
}

// Handle setup message (voice/role prompt)
function handleSetup(message: any, context: ClientContext) {
  console.log('[Server] Setup message received');
  
  if (message.voicePrompt) {
    // Store voice prompt for cloning
    context.voicePrompt = Buffer.from(message.voicePrompt);
    console.log('[Server] Voice prompt set:', context.voicePrompt.length, 'bytes');
  }
  
  if (message.rolePrompt) {
    // Store role prompt for conditioning
    context.rolePrompt = message.rolePrompt;
    console.log('[Server] Role prompt set:', context.rolePrompt.substring(0, 50) + '...');
  }
}

// Transcribe audio (Speech-to-Text)
async function transcribeAudio(audioData: Int16Array): Promise<string> {
  // Implement with Google Speech-to-Text, Azure, or Whisper
  // For now, return placeholder
  console.log('[Server] Transcribing', audioData.length, 'samples');
  
  // Example with Google Cloud Speech-to-Text:
  // const speech = require('@google-cloud/speech');
  // const client = new speech.SpeechClient();
  // const request = { audio: { content: audioBuffer }, config: {...} };
  // const [response] = await client.recognize(request);
  
  return "Sample transcribed text";
}

// Call LLM (GPT, Gemini, etc.)
async function callLLM(
  userText: string,
  history: Array<{ role: string; content: string }>,
  systemPrompt: string
): Promise<string> {
  // Use OpenAI, Google Gemini, or another LLM API
  const apiKey = process.env.OPENAI_API_KEY || process.env.GOOGLE_API_KEY;
  
  // Example with OpenAI:
  // const response = await fetch('https://api.openai.com/v1/chat/completions', {
  //   method: 'POST',
  //   headers: { 'Authorization': `Bearer ${apiKey}` },
  //   body: JSON.stringify({
  //     model: 'gpt-4',
  //     system: systemPrompt,
  //     messages: [...history, { role: 'user', content: userText }],
  //   })
  // });
  
  return "Sample LLM response";
}

// Synthesize speech (Text-to-Speech)
async function synthesizeSpeech(
  text: string,
  voicePrompt?: Buffer
): Promise<ArrayBuffer> {
  console.log('[Server] Synthesizing speech:', text.substring(0, 50) + '...');
  
  // Example with Google Cloud TTS:
  const request = {
    input: { text },
    voice: {
      languageCode: 'en-US',
      name: 'en-US-Neural2-C', // Voice variant
    },
    audioConfig: {
      audioEncoding: 'LINEAR16',
      sampleRateHertz: 16000,
    },
  };
  
  // const [response] = await ttsClient.synthesizeSpeech(request);
  // return response.audioContent;
  
  // For now, return silence
  return new ArrayBuffer(16000 * 2); // 1 second of silence
}

// Process with PersonaPlex (voice cloning + role conditioning)
async function processWithPersonaPlex(
  audioBuffer: ArrayBuffer,
  params: {
    voicePrompt?: Buffer;
    rolePrompt?: string;
  }
): Promise<ArrayBuffer> {
  console.log('[Server] Processing with PersonaPlex');
  
  // This would integrate with @met4citizen/talkinghead PersonaPlex
  // For now, return the audio unchanged
  // In production:
  // 1. Apply voice cloning using voicePrompt
  // 2. Apply emotional/style conditioning using rolePrompt
  // 3. Generate synchronized audio with visemes
  
  return audioBuffer;
}

// Detect viseme timing from audio
async function detectVisemes(
  audioBuffer: ArrayBuffer
): Promise<Array<{ viseme: string; time: number }>> {
  // Use frequency analysis or ML model to detect visemes
  // Return timing data for lip-sync synchronization
  
  const visemes = [];
  
  // Simple frequency-based detection
  const audioContext = new (globalThis as any).OfflineAudioContext(1, 16000, 16000);
  const buffer = audioContext.createBuffer(1, 16000, 16000);
  
  // Analyze and generate viseme timing
  visemes.push({ viseme: 'neutral', time: 0 });
  visemes.push({ viseme: 'A', time: 100 });
  visemes.push({ viseme: 'E', time: 300 });
  
  return visemes;
}

// Build system prompt with role
function buildSystemPrompt(rolePrompt?: string): string {
  const base = "You are a helpful AI assistant.";
  
  if (rolePrompt) {
    return `${rolePrompt}\n\n${base}`;
  }
  
  return base;
}

// Start server
const PORT = process.env.PORT || 8000;
const httpServer = app.listen(PORT, () => {
  console.log(`[Server] WebSocket listening on ws://localhost:${PORT}`);
  console.log('[Server] Waiting for connections...');
});
```

## Client Integration (Next.js)

The Next.js app automatically connects to this server when `NEXT_PUBLIC_BACKEND_URL` is set:

```env
NEXT_PUBLIC_BACKEND_URL=ws://localhost:8000
```

## Advanced Features

### 1. Voice Cloning Integration

```typescript
// Process voice prompt for PersonaPlex
async function initializeVoiceCloning(voiceBlob: Blob) {
  // Extract voice characteristics (pitch, tone, tempo)
  const voiceFeatures = await analyzeVoiceCharacteristics(voiceBlob);
  
  // Store for all responses
  return voiceFeatures;
}

// Apply to TTS
function applyVoiceCloning(ttsRequest: any, voiceFeatures: any) {
  // Modify TTS parameters based on voice characteristics
  ttsRequest.voice.name = selectMatchingVoice(voiceFeatures);
  ttsRequest.audioConfig.pitch = voiceFeatures.pitch;
  ttsRequest.audioConfig.speakingRate = voiceFeatures.tempo;
  return ttsRequest;
}
```

### 2. Emotion-Aware Responses

```typescript
// Detect emotion from user audio
async function detectUserEmotion(audioData: Int16Array): Promise<string> {
  // Analyze prosody (pitch, intensity, rate)
  // Classify emotion: happy, sad, angry, neutral, excited, etc.
  return 'neutral'; // Placeholder
}

// Adjust role prompt based on emotion
function adaptRolePrompt(baseRole: string, emotion: string): string {
  const emotionContext = {
    sad: 'Be empathetic and supportive.',
    angry: 'Stay calm and patient.',
    excited: 'Match the energy and enthusiasm.',
    neutral: 'Be helpful and clear.',
  };
  
  return `${baseRole}\n${emotionContext[emotion] || emotionContext.neutral}`;
}
```

### 3. Conversation Memory

```typescript
// Maintain conversation context
function updateConversationMemory(context: ClientContext) {
  // Keep last 10 exchanges
  const maxHistory = 10;
  if (context.conversationHistory.length > maxHistory * 2) {
    context.conversationHistory = context.conversationHistory.slice(-maxHistory * 2);
  }
  
  // Summarize if too long
  if (context.conversationHistory.length > 20) {
    const summary = summarizeHistory(context.conversationHistory);
    context.conversationHistory = [summary];
  }
}

function summarizeHistory(history: any[]): any {
  // Use LLM to summarize conversation
  return {
    role: 'system',
    content: 'Previous conversation summary: ...',
  };
}
```

### 4. Real-time Transcription Stream

```typescript
// Stream transcription back to client
async function streamTranscription(ws: WebSocket, audioData: Int16Array) {
  // Use streaming speech-to-text API
  const transcriber = new StreamingTranscriber();
  
  transcriber.on('partial', (text) => {
    ws.send(JSON.stringify({
      type: 'transcription',
      partial: true,
      text: text,
    }));
  });
  
  transcriber.on('final', (text) => {
    ws.send(JSON.stringify({
      type: 'transcription',
      partial: false,
      text: text,
    }));
  });
}
```

## Error Handling

```typescript
// Graceful error handling
function handleError(ws: WebSocket, error: Error) {
  console.error('[Server] Error:', error.message);
  
  ws.send(JSON.stringify({
    type: 'error',
    message: error.message,
    timestamp: new Date().toISOString(),
  }));
}

// Timeout handling for long requests
function withTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), ms)
    ),
  ]);
}
```

## Monitoring & Logging

```typescript
// Log connection metrics
function logMetrics() {
  setInterval(() => {
    console.log(`[Metrics] Active connections: ${clients.size}`);
    clients.forEach((context) => {
      console.log(`  - History length: ${context.conversationHistory.length}`);
    });
  }, 60000); // Every minute
}

// Track latency
function measureLatency(startTime: number): number {
  return Date.now() - startTime;
}
```

## Deployment

### Docker

```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8000
CMD ["npm", "start"]
```

### Environment Variables (Production)

```bash
PORT=8000
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
GOOGLE_CLOUD_PROJECT=...
NODE_ENV=production
```

## Testing

```bash
# WebSocket client test
wscat -c ws://localhost:8000

# Send test message
{"type":"audio","data":[100,200,300...],"format":"int16","sampleRate":16000}
```

---

This example provides a complete template for implementing the backend. Adjust based on your specific LLM provider, TTS service, and PersonaPlex integration requirements.
