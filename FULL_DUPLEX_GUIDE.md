# Full-Duplex Speech-to-Speech with PersonaPlex

## Overview

This enhanced holographic AI assistant now supports full-duplex speech-to-speech communication with PersonaPlex integration. The system captures continuous user audio without VAD (Voice Activity Detection) and streams it to the backend while simultaneously receiving and playing AI responses with real-time lip-sync animation.

## Architecture

### Frontend Components

#### 1. **useFullDuplexAudio Hook** (`/hooks/use-full-duplex-audio.ts`)
- Captures continuous MediaStream from microphone
- No VAD detection - captures all audio
- Audio is converted from Float32 to Int16 format
- Streams audio chunks via WebSocket
- Features:
  - Echo cancellation
  - Noise suppression
  - Auto gain control
  - Configurable sample rate (default 16kHz)

#### 2. **usePersonaPlex Hook** (`/hooks/use-persona-plex.ts`)
- Handles PersonaPlex audio processing
- Manages voice prompt (3-second audio clip for voice cloning)
- Applies role prompt (character background/personality text)
- Real-time viseme detection for lip-sync
- Audio playback with frequency-based viseme mapping:
  - Low frequencies → "A" viseme
  - Mid frequencies → "E" viseme
  - High frequencies → "I"/"U" viseme

#### 3. **AvatarScene Component Updates** (`/components/avatar-scene.tsx`)
- **Listening Animation**: Subtle breathing effect (scale pulse) when listening
- **Eye Darting**: Head tilts and eye movement while listening
- **Simultaneous Speaking**: Avatar remains animated while speaking
- Smooth transitions between states

#### 4. **Settings Panel Enhancements** (`/components/settings-panel.tsx`)
- **Voice Prompt Upload**: Drag-and-drop or file selection for 3-second audio clip
- **Role Prompt Text Area**: Character background and personality definition
- Real-time state management with parent component callbacks

### Backend Components

#### 1. **WebSocket Server**
- Bidirectional audio streaming
- URL: `process.env.NEXT_PUBLIC_BACKEND_URL`
- Message format:
  ```json
  {
    "type": "audio",
    "data": [Int16 array],
    "format": "int16" | "float32",
    "sampleRate": 16000
  }
  ```

#### 2. **PersonaPlex API Route** (`/app/api/persona/route.ts`)
- Processes audio chunks with voice conditioning
- Applies role prompt for context
- Generates response audio
- Returns viseme timing data

## Full-Duplex Audio Flow

```
User speaks → Full-duplex audio hook captures continuous audio
    ↓
Audio chunks converted to Int16 format
    ↓
WebSocket sends to backend
    ↓
Backend processes with PersonaPlex (voice + role conditioning)
    ↓
Response audio streams back via WebSocket
    ↓
PersonaPlex hook receives audio chunks
    ↓
Immediately plays via TalkingHead.speakAudio()
    ↓
Real-time viseme detection updates avatar mouth movements
    ↓
Avatar animations (breathing, eye-darting) continue during playback
```

## Configuration

### Environment Variables

```bash
NEXT_PUBLIC_BACKEND_URL=ws://localhost:8000/audio
GOOGLE_API_KEY=your-api-key
OPENAI_API_KEY=your-api-key
ELEVENLABS_API_KEY=your-api-key
```

### Audio Capture Settings

Default configuration in `useFullDuplexAudio`:
```typescript
{
  sampleRate: 16000,        // 16kHz sampling rate
  channelCount: 1,          // Mono audio
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
}
```

## Avatar Animations

### Listening State (isListening=true, isSpeaking=false)
- **Breathing**: Scale animation (1.0 to 1.02) at 3Hz
- **Eye Darting**: Z-rotation oscillation (±0.03 radians)
- **Head Tilt**: X-rotation when breathing scale peaks
- **Floating**: Base animation continues

### Speaking State (isSpeaking=true)
- Breathing and eye-darting animations pause
- Avatar scales back to 1.0
- Rotations reset
- Base floating effect continues

### Idle State (both false)
- Only base floating animation
- Subtle Y-axis rotation

## Voice Prompt Requirements

- **Format**: Any audio format supported by browser (MP3, WAV, OGG, etc.)
- **Duration**: 3 seconds recommended
- **Purpose**: Voice cloning reference for PersonaPlex
- **Usage**: Automatically applied to all responses

## Role Prompt Examples

```
"You are a curious and friendly AI assistant from the year 2050. 
You have a sense of humor and love asking thoughtful questions 
about the user's interests and goals."
```

```
"You are a wise mentor figure who speaks thoughtfully and 
encourages deep reflection. You prefer asking questions over 
giving direct answers."
```

```
"You are an enthusiastic explorer who gets excited about new 
ideas and loves learning. You speak energetically and use 
vivid descriptions."
```

## Real-time Viseme Detection

The system uses frequency analysis to detect visemes in real-time:

1. **FFT Analysis**: Analyzes frequency spectrum of audio
2. **Frequency Mapping**:
   - 0-10 Hz bins → "A" (low frequencies)
   - 10-50 Hz bins → "E" (mid frequencies)
   - 50-100 Hz bins → "I"/"U" (high frequencies)
3. **Updates**: Viseme changes every 50ms for smooth animation

## Browser Compatibility

- Chrome/Chromium 84+
- Firefox 79+
- Safari 14.1+
- Edge 84+

Requires:
- `getUserMedia()` support
- `AudioContext` support
- WebSocket support

## Performance Optimization

1. **Audio Chunk Size**: 4096 samples at 16kHz = ~256ms chunks
2. **Processing**: Non-blocking WebSocket sends
3. **Rendering**: RequestAnimationFrame for smooth animations
4. **Memory**: Automatic cleanup on component unmount

## Troubleshooting

### No Audio Input
1. Check browser microphone permissions
2. Verify `navigator.mediaDevices` is available
3. Check console for specific error messages

### WebSocket Connection Issues
1. Verify `NEXT_PUBLIC_BACKEND_URL` is set
2. Check backend server is running
3. Verify CORS headers if applicable

### Lip-Sync Not Synchronized
1. Ensure PersonaPlex hook is properly initialized
2. Check viseme detection is running (`currentViseme` state updating)
3. Verify TalkingHead is connected to avatar scene

### Avatar Not Animating
1. Check `isListening` and `isSpeaking` props are being passed
2. Verify avatar model loaded successfully (check for error overlay)
3. Check animation loop is running (no console errors)

## Integration with Backend

Your backend should:

1. **Accept WebSocket audio streams** in Int16 or Float32 format
2. **Process with PersonaPlex** using provided voice/role prompts
3. **Stream response audio** back in same format
4. **Include timing data** for viseme synchronization

Example backend expectations:
```typescript
// Process incoming audio
if (message.type === 'audio') {
  const int16Array = new Int16Array(message.data);
  // Apply voice cloning from voicePrompt
  // Apply character conditioning from rolePrompt
  // Generate response with PersonaPlex
  // Stream response audio back
}
```

## Future Enhancements

- Emotion detection from audio tone
- Multi-language support
- Custom viseme mappings
- Audio effects processing
- Real-time transcription display
