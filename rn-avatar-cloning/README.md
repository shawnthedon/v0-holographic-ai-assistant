# Avatar Cloning - React Native Mobile App

A React Native application for AI avatar cloning using on-device face capture (MediaPipe) and voice cloning APIs.

## Features

- **Face Capture**: Real-time face mesh detection using Google MediaPipe (468-point landmarks + blendshapes)
- **Voice Recording**: Audio recording with validation (3-10 seconds recommended)
- **Avatar Preview**: View and manage your cloned avatar
- **Settings Panel**: Configure face capture quality, voice models, and privacy options
- **Model Selection**: OpenVoice, RVC, or XTTS v2
- **Offline-First**: Face mesh extraction happens on-device; only processed data is uploaded

## Project Structure

```
rn-avatar-cloning/
├── App.tsx                          # Main entry point with navigation
├── screens/
│   ├── CameraScreen.tsx             # Face capture interface
│   ├── AudioUploadScreen.tsx        # Voice recording and upload
│   ├── AvatarPreviewScreen.tsx      # Avatar preview and session management
│   └── SettingsScreen.tsx           # App settings and configuration
├── services/
│   └── api-client.ts                # API client with retry logic
└── utils/
    └── (utilities for face/audio processing)
```

## Getting Started

### Prerequisites

- Node.js >= 18
- `pnpm` or `npm`
- Expo CLI: `npm install -g expo-cli`
- Physical device or emulator for testing

### Installation

```bash
# Install dependencies
pnpm install

# Start the dev server
pnpm start

# Run on iOS (macOS only)
pnpm ios

# Run on Android
pnpm android

# Run on web
pnpm web
```

### Environment Variables

Create a `.env.local` file:

```env
EXPO_PUBLIC_API_URL=http://localhost:3000
```

## Architecture

### On-Device Face Capture

- Uses `@mediapipe/tasks-vision` for real-time face detection
- Extracts 468 face landmarks + blendshapes per frame
- Compresses data before upload (only key landmarks transmitted)
- Runs at 30 FPS on high-quality mode

### Voice Processing

- Records audio using `expo-av`
- Validates duration (3-10 seconds)
- Normalizes audio levels before upload
- Supports WAV, MP3, and OGG formats

### Backend Integration

- Multipart form uploads for audio files
- JSON API for face frame batches
- Automatic retry on network failure (exponential backoff)
- Session persistence via AsyncStorage

## API Endpoints

### Face Capture

```
POST /api/face-capture
{
  "frames": [
    {
      "keyLandmarks": [...],
      "blendshapes": {...},
      "confidence": 0.95
    }
  ],
  "timestamp": "2024-01-01T12:00:00Z"
}

Response:
{
  "meshId": "mesh_123...",
  "frameCount": 30,
  "avgConfidence": 0.93,
  "status": "processed"
}
```

### Voice Clone

```
POST /api/voice-clone
FormData:
  - referenceAudio: File (WAV)
  - model: "openvoice" | "rvc" | "xtts"
  - language: "en" | "es" | ...
  - style: "neutral" | "casual" | "formal"

Response:
{
  "audio": "<base64>",
  "model": "openvoice",
  "duration": 5.2
}
```

## Screen Descriptions

### Camera Screen (Face Capture)

- Live camera preview with face mesh visualization
- Real-time confidence meter
- Capture button (records 2 seconds at 30 FPS)
- Upload status feedback
- Error handling for permission denials

### Audio Upload Screen

- Microphone permission gate
- Record button with elapsed time
- Waveform visualization
- Duration validation (3-10s recommended)
- Play/delete recording
- Upload progress indicator

### Avatar Preview Screen

- Multi-step progress display
- Session data visualization
- Avatar generation trigger
- Session management (save/clear)
- Preview rendering placeholder (for future 3D rendering)

### Settings Screen

- Face capture quality selection (high/medium/low)
- Voice model picker (OpenVoice/RVC/XTTS)
- Performance toggles (auto-upload, Wi-Fi-only)
- Privacy settings
- Debug info toggle
- Links to docs and support

## Development

### TypeScript

Full TypeScript support with strict mode enabled. Type definitions for all screens and services.

### Navigation

Uses React Navigation v6:
- Bottom tab navigator for main sections
- Stack navigator for settings sub-screens
- Automatic state management

### Styling

StyleSheet API with semantic color tokens:
- `#0f172a` - Background
- `#06b6d4` - Primary (cyan)
- `#e2e8f0` - Text primary
- `#94a3b8` - Text secondary

## Performance

- Lazy-load MediaPipe WASM (~15MB) only when face capture is needed
- Frame batching to reduce upload frequency
- Automatic quality downgrade on slow connections
- Efficient async/await for non-blocking UI

## Known Limitations

- 3D avatar preview is a placeholder (requires Three.js + Expo GL integration)
- MediaPipe GPU fallback on older devices
- Maximum 10MB audio file size
- Single face detection only

## Future Enhancements

- [ ] Real-time 3D avatar rendering with Three.js
- [ ] Multi-face support for group avatars
- [ ] Local model inference (ONNX Runtime)
- [ ] Avatar animation playback
- [ ] Lip-sync video generation
- [ ] Custom avatar blendshape tuning
- [ ] Cloud storage integration

## License

Proprietary - Avatar Cloning System

## Support

For issues or feature requests, see the main project README.
