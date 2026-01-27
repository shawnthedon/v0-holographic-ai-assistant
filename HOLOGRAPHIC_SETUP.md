# Holographic AI Assistant - Setup Guide

## Overview

This is a Next.js application that creates a futuristic holographic AI interface with:
- 3D avatar rendering using Three.js
- Real-time WebSocket communication for audio/viseme streaming
- Multiple LLM provider support (Gemini 2.0 Flash, GPT-4o, Custom OpenAI-compatible)
- Voice synthesis with Google TTS and ElevenLabs
- Knowledge Base RAG integration
- Advanced speech settings and customization

## Required Environment Variables

### LLM Providers

```env
# Google Gemini (for Gemini 2.0 Flash)
GOOGLE_API_KEY=your_google_api_key

# OpenAI (for GPT-4o)
OPENAI_API_KEY=your_openai_api_key
```

### Voice Synthesis

```env
# Google Text-to-Speech (optional, uses same GOOGLE_API_KEY as above)
# Already covered by GOOGLE_API_KEY

# ElevenLabs (optional)
ELEVENLABS_API_KEY=your_elevenlabs_api_key
```

### Backend WebSocket

```env
# Your backend server URL for real-time audio/viseme streaming
NEXT_PUBLIC_BACKEND_URL=ws://localhost:8080
# or
NEXT_PUBLIC_BACKEND_URL=wss://your-production-server.com
```

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
# or
yarn install
```

### 2. Configure Environment Variables

Create a `.env.local` file in the project root:

```env
# Add your API keys here
GOOGLE_API_KEY=
OPENAI_API_KEY=
ELEVENLABS_API_KEY=
NEXT_PUBLIC_BACKEND_URL=ws://localhost:8080
```

### 3. Prepare Avatar Model

Place your ReadyPlayerMe GLB avatar at `/public/models/avatar.glb`. 

To get a ReadyPlayerMe avatar:
1. Visit [readyplayer.me](https://readyplayer.me)
2. Create an avatar
3. Download the GLB file
4. Place it in the `/public/models/` directory

### 4. Run Development Server

```bash
npm run dev
```

Visit `http://localhost:3000` in your browser.

## Features

### 1. Avatar Scene
- **3D Rendering**: Three.js canvas with ReadyPlayerMe GLB avatar
- **Holographic Effect**: Pure black background (#000000) for Pepper's Ghost reflection
- **Floating Animation**: Subtle vertical bobbing motion
- **Lighting**: Cyan key light and pink rim light for dramatic effect

### 2. Control Menu
- **Quick Access**: Bottom-right floating menu with icon buttons
- **Voice Toggle**: Microphone control with visual feedback
- **Settings Access**: Advanced configuration panel
- **Status Badge**: Real-time connection status indicator

### 3. Advanced Settings Panel
- **LLM Selection**:
  - Gemini 2.0 Flash
  - GPT-4o
  - Custom OpenAI-compatible endpoint
- **Voice Provider**:
  - Google TTS
  - ElevenLabs
- **Speech Control**:
  - Speed adjustment (0.5x - 2.0x)
- **Knowledge Base**:
  - Drag & drop file upload
  - Supports PDF, TXT, DOC, DOCX
  - RAG pipeline integration

### 4. Real-time Communication
- **WebSocket Client**: Bidirectional communication with backend
- **Audio Streaming**: Real-time audio chunk transmission
- **Viseme Sync**: Lip-sync animation data streaming
- **Auto-reconnect**: Exponential backoff reconnection strategy

### 5. AI Integration
- **Multi-provider LLM**: Switch between providers
- **Speech Recognition**: Web Speech API for voice input
- **Speech Synthesis**: Multiple voice provider support
- **Context Management**: Conversation history tracking

## API Endpoints

### POST /api/chat
Sends a message to the selected LLM provider.

**Request**:
```json
{
  "message": "Hello, how are you?",
  "model": "gemini-2.0-flash",
  "endpoint": "https://api.example.com/v1",
  "messages": []
}
```

**Response**:
```json
{
  "response": "I'm doing well, thank you for asking!"
}
```

### POST /api/speech
Converts text to speech using the selected provider.

**Request**:
```json
{
  "text": "Hello there!",
  "provider": "google",
  "speed": 1.0
}
```

**Response**: Audio MP3 stream

## WebSocket Backend Integration

The application expects a WebSocket server at `NEXT_PUBLIC_BACKEND_URL` that handles:

### Message Types

**Audio Stream**:
```json
{
  "type": "audio",
  "data": {
    "buffer": [0, 1, 2, ...],
    "sampleRate": 16000
  },
  "timestamp": 1234567890
}
```

**Viseme Request**:
```json
{
  "type": "viseme",
  "data": {
    "text": "Hello world"
  },
  "timestamp": 1234567890
}
```

**Status Update**:
```json
{
  "type": "status",
  "data": {
    "connected": true
  },
  "timestamp": 1234567890
}
```

## Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Connect to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

### Self-Hosted

```bash
npm run build
npm run start
```

## Browser Compatibility

- Chrome/Edge: Full support
- Firefox: Full support (Web Speech API may vary)
- Safari: Limited Web Speech API support

## Troubleshooting

### Avatar Not Loading
- Check that `/public/models/avatar.glb` exists
- Verify Three.js is properly installed
- Check browser console for loading errors

### WebSocket Connection Failed
- Verify `NEXT_PUBLIC_BACKEND_URL` is correct
- Check backend server is running
- Ensure WebSocket protocol (ws:// or wss://) is correct

### API Key Errors
- Verify all required API keys are set in `.env.local`
- Check API key validity and quota limits
- Ensure proper environment variable naming

### No Audio Output
- Check browser audio permissions
- Verify speech synthesis API keys are configured
- Check browser console for audio playback errors

## Performance Optimization

- Avatar model size should be < 5MB for optimal loading
- Consider WebP format for better compression
- Use CDN for model delivery in production
- Implement lazy loading for heavy 3D assets

## License

MIT
