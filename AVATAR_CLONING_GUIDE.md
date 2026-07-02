# AI Avatar Cloning System - Complete Implementation Guide

## Overview

This document describes the complete AI avatar cloning system, which includes both a Next.js web application and a React Native mobile app for capturing face and voice data to create custom cloned avatars.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    User Interfaces                              │
├─────────────────────┬───────────────────┬───────────────────────┤
│  Next.js Web App    │ React Native App  │  Settings Panel       │
│  (Face Capture)     │  (Face + Voice)   │  (Configuration)      │
└────────────┬────────┴─────────┬─────────┴──────────┬────────────┘
             │                  │                    │
             └──────────────────┼────────────────────┘
                                │
                    ┌───────────▼──────────┐
                    │  API Layer           │
                    │  /api/face-capture   │
                    │  /api/voice-clone    │
                    └───────────┬──────────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
        ┌───────▼──────┐  ┌─────▼──────┐  ┌────▼───────┐
        │ DECA (3D)    │  │ OpenVoice  │  │ RVC/XTTS  │
        │ Face Mesh    │  │ Voice      │  │ Voice      │
        │ Extraction   │  │ Cloning    │  │ Cloning    │
        └──────────────┘  └────────────┘  └────────────┘
```

## Web Application (Next.js)

### Components

#### 1. Face Capture Component (`components/face-capture.tsx`)

Interactive component for capturing face mesh data:

- **Live Camera Preview**: Real-time video feed with canvas overlay
- **Mesh Visualization**: 468-point face landmark visualization
- **Confidence Indicator**: Real-time confidence metrics
- **Recording Controls**: Start/stop capture with 2-second duration
- **Upload Feedback**: Status indicators (capturing, uploading, complete, error)

**Usage:**
```tsx
<FaceCapture onCaptureSent={(frameCount) => console.log(frameCount)} />
```

#### 2. Settings Panel Extension (`components/settings-panel.tsx`)

Existing settings panel extended with avatar cloning configuration:

- **Face Capture Settings**: Quality, mesh detail, streaming mode
- **Voice Cloning Settings**: Model selection, reference audio, parameters
- **Performance & Privacy**: On-device toggle, Wi-Fi-only, bandwidth limit
- **Developer Debug**: Custom backend URL, overlay toggle, cache control

### Services

#### Face Capture Service (`lib/face-capture.ts`)

Low-level face detection and mesh extraction:

```typescript
// Initialize MediaPipe (lazy-loaded)
await initializeFaceCapture();

// Capture single frame
const mesh = await captureFaceMesh(videoElement);

// Batch capture at target FPS
const meshes = await captureFramesBatch(videoElement, 2000, { fpsTarget: 30 });

// Visualize mesh
drawFaceMesh(canvas, mesh, videoWidth, videoHeight);

// Upload frames
await uploadFaceFrames(meshes, '/api/face-capture');
```

**Features:**
- Lazy-load MediaPipe WASM (~15MB) only when needed
- 468-point landmark extraction with confidence scores
- Blendshape extraction (smile, blink, etc.)
- Key landmark compression for efficient upload
- Real-time visualization

#### Voice Cloning Service (`lib/voice-cloning.ts`)

Voice cloning abstraction over multiple models:

```typescript
// Validate audio reference
const validation = await validateAudioClip(blob);

// Normalize audio levels
const normalized = await normalizeAudio(blob);

// Clone voice
const result = await cloneVoice({
  model: VoiceCloningModel.OPENVOICE,
  referenceAudio: blob,
  text: "Hello, world!",
  language: 'en',
  toneColor: 0.5,
});

// Get model parameters
const params = getModelParams(VoiceCloningModel.OPENVOICE);
```

**Supported Models:**
- **OpenVoice**: Fast zero-shot cloning, 40ms latency
- **RVC**: Professional voice conversion with pitch control
- **XTTS v2**: Cross-lingual TTS, supports 20+ languages

### API Routes

#### POST `/api/face-capture`

Receive and process face frame batches:

```typescript
// Request
{
  "frames": [
    {
      "keyLandmarks": [{ idx, x, y, z }, ...],
      "blendshapes": { "smile": 0.3, "blink": 0.1 },
      "confidence": 0.95
    }
  ],
  "timestamp": "2024-01-01T12:00:00Z"
}

// Response
{
  "meshId": "mesh_123456",
  "frameCount": 30,
  "avgConfidence": 0.93,
  "blendshapesSummary": { "smile": 0.25, "blink": 0.08 },
  "status": "processed"
}
```

#### POST `/api/voice-clone`

Handle voice cloning requests:

```typescript
// Request (multipart/form-data)
- referenceAudio: File (WAV, 1-30 seconds)
- model: "openvoice" | "rvc" | "xtts"
- text: string (optional)
- language: string (optional)
- style: string (optional)

// Response
{
  "audio": "<base64-encoded WAV>",
  "model": "openvoice",
  "duration": 5.2,
  "timestamp": "2024-01-01T12:00:00Z"
}
```

## Mobile Application (React Native)

### Project Structure

```
rn-avatar-cloning/
├── App.tsx                      # Bottom tab navigation
├── screens/
│   ├── CameraScreen.tsx         # Face capture interface
│   ├── AudioUploadScreen.tsx    # Voice recording
│   ├── AvatarPreviewScreen.tsx  # Avatar management
│   └── SettingsScreen.tsx       # App configuration
├── services/
│   └── api-client.ts            # Backend communication
├── app.json                     # Expo configuration
└── package.json
```

### Screens

#### CameraScreen

Face capture interface with real-time preview:

- Live camera feed with face guide overlay
- Confidence indicator overlay
- Capture button (30 frames at 2 seconds)
- Status badges (capturing, uploading, complete, error)
- Permission handling with retry

**Key Props:**
```typescript
interface CameraScreenProps {
  onCaptureSent?: (frameCount: number) => void;
}
```

#### AudioUploadScreen

Voice recording and upload interface:

- Recording timer with auto-stop at 30s
- Waveform visualization during playback
- Duration validation feedback (3-10s recommended)
- Play/delete/upload controls
- Upload progress with retry on failure

**Recording Validation:**
- Minimum: 3 seconds
- Recommended: 3-10 seconds
- Maximum: 30 seconds

#### AvatarPreviewScreen

Avatar management and preview:

- Session progress display (face captured ✓, voice recorded ✓)
- Step-by-step guide to completion
- Avatar preview placeholder (for 3D rendering)
- Session data display (mesh ID, voice ID, timestamp)
- Generate/clear session controls

#### SettingsScreen

Configuration panel:

- Face capture quality (high/medium/low FPS)
- Voice model selection (OpenVoice/RVC/XTTS)
- Performance toggles (auto-upload, Wi-Fi-only, sound)
- Debug info display
- Links to documentation

### Services

#### API Client (`services/api-client.ts`)

Backend communication with retry logic:

```typescript
// Upload face frames
await apiClient.uploadFaceFrames(meshes);

// Clone voice
await apiClient.cloneVoice(audioBlob, {
  model: 'openvoice',
  language: 'en'
});

// Session management
await apiClient.saveSession(data);
const session = await apiClient.loadSession();
await apiClient.clearSession();
```

**Features:**
- Exponential backoff retry (3 attempts)
- 30s timeout per request
- Multipart form data support
- AsyncStorage persistence
- Automatic error logging

## Data Flow

### Face Capture Flow

```
1. User presses Capture button
2. Face mesh extracted every 33ms (30 FPS) for 2 seconds
3. 60 frames collected with landmarks + blendshapes
4. Frames compressed (key landmarks only)
5. Batch uploaded to /api/face-capture
6. Backend processes with DECA model
7. 3D face geometry returned + stored in session
```

### Voice Cloning Flow

```
1. User records 3-10s audio sample
2. Audio validated for duration + format
3. Levels normalized (prevent clipping)
4. Uploaded to /api/voice-clone with model param
5. Backend processes with selected model (OpenVoice/RVC/XTTS)
6. Cloned audio returned as base64 WAV
7. Audio playable in app + stored in session
```

### Avatar Generation Flow

```
1. Both face + voice captured and uploaded
2. Session contains meshId + audioId
3. User clicks "Generate Preview"
4. Backend combines face mesh + cloned voice
5. Optional: Generate talking head video or 3D model
6. Results displayed in AvatarPreviewScreen
```

## Configuration

### Environment Variables

**Web App (.env.local):**
```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:3000
```

**Mobile App (.env.local):**
```env
EXPO_PUBLIC_API_URL=http://localhost:3000
```

### MediaPipe Configuration

Default settings in `lib/face-capture.ts`:

```typescript
const DEFAULT_CONFIG = {
  MESH_POINT_COUNT: 468,      // Full face mesh
  CONFIDENCE_THRESHOLD: 0.5,  // Minimum confidence
  FPS_TARGET: 30,             // Target frame rate
};
```

### Voice Model Parameters

**OpenVoice:**
- `toneColor`: 0-1 (neutral to expressive)
- `style`: neutral | casual | formal
- `language`: en, zh, ja, ko

**RVC:**
- `pitchShift`: -12 to +12 semitones
- `audioFormat`: wav | mp3 | ogg

**XTTS v2:**
- `language`: 20+ supported languages
- `style`: default | expressive | whisper

## Security & Privacy

### On-Device Processing

- Face mesh extraction happens entirely on-device
- No raw video frames transmitted to backend
- Only compressed mesh data + blendshapes uploaded

### Audio Handling

- Audio normalized but not modified
- Sent as encrypted multipart form data
- Server-side processing on isolated backend

### Session Data

- Stored locally in AsyncStorage (mobile) or localStorage (web)
- Session encryption recommended for production
- Users can clear sessions at any time

### Rate Limiting

- Mobile: 3-second minimum between uploads
- Web: Debounced uploads to prevent flooding
- Backend: 429 status with exponential backoff

## Performance Optimization

### Bundle Size

- MediaPipe WASM: ~15MB (lazy-loaded)
- Face capture component: ~20KB
- Voice cloning service: ~8KB

### Memory Usage

- Face mesh: ~100KB per frame (after compression)
- Audio buffer: ~200KB for 10-second clip
- Session data: ~50KB typical

### Network

- Face batch: ~60 frames × 5KB = ~300KB
- Audio: ~10-second clip ≈ 500KB-1MB
- Automatic retry on failure (exponential backoff)

## Deployment

### Web App

```bash
# Build
pnpm build

# Deploy to Vercel
vercel deploy --prod
```

### Mobile App

```bash
# Build iOS
eas build --platform ios

# Build Android
eas build --platform android

# Publish to app stores
# (Requires Apple Developer / Google Play accounts)
```

## Troubleshooting

### Face Capture Issues

**Problem:** "Camera permission denied"
- **Solution:** Enable camera in device settings → App permissions

**Problem:** Low confidence scores (<0.5)
- **Solution:** Ensure good lighting, look directly at camera, position face in center

**Problem:** Slow capture (FPS < 10)
- **Solution:** Reduce quality in settings, close background apps

### Voice Issues

**Problem:** "Audio must be 1-30 seconds"
- **Solution:** Record for 3-10 seconds (optimal range)

**Problem:** "Upload failed" 
- **Solution:** Check internet connection, ensure Wi-Fi if Wi-Fi-only mode enabled

**Problem:** Poor voice quality
- **Solution:** Reduce background noise, speak clearly and naturally

### Backend Issues

**Problem:** 500 error on /api/face-capture
- **Solution:** Verify DECA backend is running and accessible

**Problem:** Voice clone timeout
- **Solution:** Model inference taking too long; try lower quality or different model

## Future Enhancements

### Phase 2

- [ ] Real-time 3D avatar rendering with Three.js
- [ ] Lip-sync synchronization with cloned voice
- [ ] Multi-face support for group avatars
- [ ] Avatar animation library + customization

### Phase 3

- [ ] Local ONNX model inference (eliminate backend dependency)
- [ ] Video generation from avatar + script
- [ ] Avatar marketplace for sharing
- [ ] Real-time streaming (WebRTC)

### Phase 4

- [ ] Advanced blendshape editor
- [ ] Avatar emotion/expression control
- [ ] Full-body capture and animation
- [ ] Integration with social platforms

## References

- **MediaPipe Docs**: https://ai.google.dev/edge/mediapipe
- **OpenVoice**: https://github.com/myshell-ai/OpenVoice
- **RVC**: https://github.com/RVC-Project/Retrieval-based-Voice-Conversion
- **XTTS v2**: https://github.com/coqui-ai/TTS
- **Expo Docs**: https://docs.expo.dev
- **React Navigation**: https://reactnavigation.org

## Support

For issues, feature requests, or technical questions:
1. Check the troubleshooting section above
2. Review API documentation in individual service files
3. Check console logs for detailed error messages
4. Open an issue on GitHub with reproduction steps
