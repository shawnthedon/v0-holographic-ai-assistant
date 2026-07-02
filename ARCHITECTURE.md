# AI Avatar Cloning System - Architecture Documentation

## High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          USER INTERFACES                                │
├──────────────────────────────┬──────────────────────────────────────────┤
│                              │                                          │
│   Next.js Web Application    │    React Native Mobile Application      │
│   ┌────────────────────────┐ │    ┌──────────────────────────────┐    │
│   │ Face Capture Component │ │    │ Bottom Tab Navigation        │    │
│   │ - Live video feed      │ │    │ ├─ Camera (Face Capture)   │    │
│   │ - Mesh visualization   │ │    │ ├─ Audio (Voice Record)    │    │
│   │ - Confidence meter     │ │    │ ├─ Preview (Avatar)        │    │
│   │ - Record/Upload        │ │    │ └─ Settings                │    │
│   └────────────────────────┘ │    └──────────────────────────────┘    │
│   ┌────────────────────────┐ │    ┌──────────────────────────────┐    │
│   │ Settings Panel         │ │    │ Screen Components           │    │
│   │ - Voice model select   │ │    │ ├─ CameraScreen.tsx         │    │
│   │ - Face quality         │ │    │ ├─ AudioUploadScreen.tsx   │    │
│   │ - Performance options  │ │    │ ├─ AvatarPreviewScreen.tsx │    │
│   │ - Privacy settings     │ │    │ └─ SettingsScreen.tsx      │    │
│   └────────────────────────┘ │    └──────────────────────────────┘    │
└──────────────────────────────┴──────────────────────────────────────────┘
                                 │
                    ┌────────────┴──────────────┐
                    │                           │
            ┌───────▼──────────┐      ┌────────▼────────┐
            │  Client Services │      │  API Client     │
            ├──────────────────┤      ├─────────────────┤
            │ face-capture.ts  │      │ api-client.ts   │
            │ - initFaceLand   │      │ - uploadFrames  │
            │ - captureMesh    │      │ - uploadAudio   │
            │ - drawFaceMesh   │      │ - retry logic   │
            │ - compress       │      │ - persistence   │
            │ - upload         │      │ - error handle  │
            └──────────────────┘      └─────────────────┘
            │ voice-cloning.ts │
            │ - validate       │
            │ - normalize      │
            │ - clone          │
            └──────────────────┘
                                 │
                    ┌────────────┴──────────────┐
                    │                           │
             ┌──────▼────────┐          ┌──────▼──────┐
             │ POST Requests │          │   Data      │
             ├───────────────┤          ├─────────────┤
             │ /api/         │          │ Compressed  │
             │ face-capture  │          │ landmarks   │
             │               │          │ + blendsh.  │
             │ /api/         │          │             │
             │ voice-clone   │          │ Audio file  │
             │               │          │ (WAV/MP3)   │
             └───────────────┘          └─────────────┘
                        │
                        │  JSON + FormData
                        │  (HTTPS encrypted)
                        │
         ┌──────────────┴──────────────┐
         │                             │
      ┌──▼──────────────┐    ┌────────▼──────────┐
      │ Backend API     │    │ Backend Services  │
      │ (Next.js Route) │    ├───────────────────┤
      │ ┌──────────────┐│    │ 3D Face Model     │
      │ │aggregateBlnd││    │ (DECA)            │
      │ │processFrames││    │ ↓                 │
      │ │returnMeshId ││    │ OpenVoice         │
      │ └──────────────┘│    │ RVC               │
      │ ┌──────────────┐│    │ XTTS              │
      │ │forwardToAI  ││    │ ↓                 │
      │ │returnAudio  ││    │ Audio output      │
      │ └──────────────┘│    └───────────────────┘
      └─────────────────┘
         │
         └─────► Session Storage
              ├─ meshId
              ├─ voiceId
              ├─ timestamp
              └─ metadata
```

## Data Flow Diagrams

### Face Capture Pipeline

```
┌─────────────────┐
│  User Presses   │
│  Capture Button │
└────────┬────────┘
         │
         ▼
┌──────────────────────┐
│ Start Video Stream   │
│ (30 FPS, 2 seconds)  │
└────────┬─────────────┘
         │
         ├─→ Frame 1  ──────┐
         │                  │
         ├─→ Frame 2        ├──→ MediaPipe FaceLandmarker
         │                  │
         ├─→ ...            │
         │                  │
         └─→ Frame 60 ──────┘
                  │
                  ▼
         ┌────────────────┐
         │ Extract        │
         │ - Landmarks    │
         │ - Blendshapes  │
         │ - Confidence   │
         └────────┬───────┘
                  │
                  ▼
         ┌────────────────┐
         │ Compress       │
         │ (Key points)   │
         └────────┬───────┘
                  │
                  ▼
         ┌────────────────┐
         │ Batch Upload   │
         │ to /api/       │
         │ face-capture   │
         └────────┬───────┘
                  │
                  ▼
    ┌─────────────────────────┐
    │ Backend Processing      │
    │ (aggregate blendshapes) │
    └────────────┬────────────┘
                 │
                 ▼
    ┌──────────────────────────┐
    │ Return meshId + metrics  │
    │ Store in session         │
    └──────────────────────────┘
```

### Voice Cloning Pipeline

```
┌─────────────────────┐
│ Start Recording     │
│ (3-30 seconds)      │
└────────┬────────────┘
         │
         ▼
┌──────────────────────────┐
│ Audio Buffer Collected   │
│ (16kHz PCM samples)      │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ Validate Audio           │
│ - Duration: 3-30 seconds │
│ - Format: WAV/MP3        │
└────────┬─────────────────┘
         │ If valid
         ▼
┌──────────────────────────┐
│ Normalize Amplitude      │
│ - Detect peaks           │
│ - Apply gain             │
│ - Prevent clipping       │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ Select Model:            │
│ - OpenVoice (default)    │
│ - RVC                    │
│ - XTTS                   │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ Upload to /api/          │
│ voice-clone              │
│ (multipart/form-data)    │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ Backend Model Inference  │
│ - Load reference audio   │
│ - Extract speaker embed  │
│ - Clone voice            │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ Return Cloned Audio      │
│ (base64 WAV)             │
│ Store in session         │
└──────────────────────────┘
```

## Component Hierarchy (Web App)

```
Home (page.tsx)
├── AvatarScene
├── ControlMenu
├── FaceCapture ◄── NEW
│   ├── VideoElement (ref)
│   ├── CanvasOverlay
│   │   └── Mesh Visualization
│   ├── StatusBadges
│   │   ├── Capturing
│   │   ├── Uploading
│   │   ├── Complete
│   │   └── Error
│   └── RecordButton
├── SettingsPanel
│   ├── LLM Selection
│   ├── Voice Provider
│   ├── Speech Speed
│   ├── Voice Prompt Upload
│   ├── Role Prompt
│   ├── Knowledge Base Upload ◄── Could integrate face settings here
│   └── Backend Status
└── (Other components...)
```

## Component Hierarchy (Mobile App)

```
App.tsx (Navigation)
├── Tab.Navigator
│   ├── Camera
│   │   └── CameraScreen
│   │       ├── CameraView
│   │       ├── FaceGuideOverlay
│   │       ├── ConfidenceBadge
│   │       ├── CaptureButton
│   │       └── StatusMessages
│   │
│   ├── Audio
│   │   └── AudioUploadScreen
│   │       ├── RecordButton
│   │       ├── TimerDisplay
│   │       ├── WaveformVisual
│   │       ├── ValidationFeedback
│   │       └── UploadControls
│   │
│   ├── Preview
│   │   └── AvatarPreviewScreen
│   │       ├── EmptyState
│   │       ├── StepProgress
│   │       ├── AvatarContainer
│   │       ├── SessionInfo
│   │       └── GenerateControls
│   │
│   └── Settings
│       └── SettingsStackNavigator
│           └── SettingsScreen
│               ├── FaceCaptureQuality
│               ├── VoiceModelSelect
│               ├── PerformanceToggles
│               ├── DebugInfo
│               └── SupportLinks
```

## File Organization

### Web App File Tree

```
app/
├── layout.tsx
├── page.tsx ◄── FaceCapture integrated
├── api/
│   ├── upload/
│   ├── face-capture/ ◄── NEW
│   │   └── route.ts
│   └── voice-clone/ ◄── NEW
│       └── route.ts
├── hooks/
└── ...

components/
├── avatar-scene.tsx
├── control-menu.tsx
├── settings-panel.tsx
├── face-capture.tsx ◄── NEW
├── theme-provider.tsx
└── ...

lib/
├── face-capture.ts ◄── NEW (223 lines)
│   ├── initializeFaceCapture()
│   ├── captureFaceMesh()
│   ├── captureFramesBatch()
│   ├── compressMesh()
│   ├── uploadFaceFrames()
│   └── drawFaceMesh()
│
├── voice-cloning.ts ◄── NEW (228 lines)
│   ├── validateAudioClip()
│   ├── normalizeAudio()
│   ├── cloneVoice()
│   ├── getSupportedModels()
│   └── getModelParams()
│
└── ...
```

### Mobile App File Tree

```
rn-avatar-cloning/
├── App.tsx (133 lines)
│   └── Navigation setup
│
├── screens/ ◄── NEW (Complete)
│   ├── CameraScreen.tsx (316 lines)
│   ├── AudioUploadScreen.tsx (442 lines)
│   ├── AvatarPreviewScreen.tsx (440 lines)
│   └── SettingsScreen.tsx (377 lines)
│
├── services/ ◄── NEW
│   └── api-client.ts (182 lines)
│       ├── uploadFaceFrames()
│       ├── uploadAudio()
│       ├── cloneVoice()
│       ├── getAvatarPreview()
│       ├── saveSession()
│       ├── loadSession()
│       └── clearSession()
│
├── components/ (To be created)
│   ├── PermissionGate.tsx
│   ├── FaceOverlay.tsx
│   └── SettingsSections/
│
├── utils/ (To be created)
│   ├── face-mesh-utils.ts
│   └── audio-utils.ts
│
├── app.json (Expo config)
├── package.json
├── tsconfig.json
└── README.md
```

## Data Models

### Face Capture Session

```typescript
interface FaceMesh {
  landmarks: NormalizedLandmark[];        // 468 points
  blendshapes: Record<string, number>;    // Expression values
  confidence: number;                      // 0-1 score
}

interface FaceSession {
  meshId: string;
  frameCount: number;
  avgConfidence: number;
  blendshapesSummary: Record<string, number>;
  timestamp: string;
}
```

### Voice Clone Session

```typescript
interface VoiceClonedResult {
  audioUrl: string;                       // Playable URL
  audioBlob: Blob;                        // Binary audio data
  duration: number;                       // Seconds
  model: VoiceCloningModel;               // Model used
}

interface VoiceSession {
  voiceId: string;
  model: 'openvoice' | 'rvc' | 'xtts';
  language: string;
  duration: number;
  timestamp: string;
}
```

### Combined Avatar Session

```typescript
interface AvatarSession {
  sessionId: string;
  face: FaceSession;
  voice: VoiceSession;
  status: 'capturing' | 'processing' | 'complete';
  createdAt: string;
  expiresAt: string;
}
```

## API Contract

### Request/Response Examples

#### Face Capture Request
```json
{
  "frames": [
    {
      "keyLandmarks": [
        { "idx": 0, "x": 0.5, "y": 0.5, "z": 0.1 },
        { "idx": 1, "x": 0.45, "y": 0.45, "z": 0.15 }
      ],
      "blendshapes": {
        "smile": 0.3,
        "blink": 0.1,
        "jaw_open": 0.05
      },
      "confidence": 0.95
    }
  ],
  "timestamp": "2024-01-01T12:00:00Z"
}
```

#### Face Capture Response
```json
{
  "meshId": "mesh_1704110400000_abc123",
  "frameCount": 60,
  "avgConfidence": 0.93,
  "blendshapesSummary": {
    "smile": 0.25,
    "blink": 0.08,
    "jaw_open": 0.04
  },
  "status": "processed",
  "timestamp": "2024-01-01T12:00:02Z"
}
```

#### Voice Clone Response
```json
{
  "audio": "UklGRi4AAABFQ1QzOC4wA...",
  "model": "openvoice",
  "duration": 5.2,
  "language": "en",
  "style": "neutral",
  "timestamp": "2024-01-01T12:00:10Z"
}
```

## Technology Stack

### Web Application
- **Framework**: Next.js 16 (App Router)
- **Runtime**: Node.js on Vercel
- **Face Detection**: @mediapipe/tasks-vision 0.10.35
- **HTTP Client**: axios
- **UI Framework**: React 19.2
- **Styling**: Tailwind CSS + Framer Motion
- **State**: React hooks + context

### Mobile Application
- **Framework**: React Native 0.73 + Expo 51
- **Runtime**: iOS/Android native runtime
- **Face Detection**: @mediapipe/tasks-vision 0.10.35
- **Camera**: expo-camera
- **Audio**: expo-av
- **Navigation**: @react-navigation 6.1
- **HTTP Client**: axios
- **Storage**: @react-native-async-storage
- **Styling**: React Native StyleSheet

### Backend Services (To be connected)
- **3D Face Model**: DECA (Deep Implicit Faces)
- **Voice Cloning**: OpenVoice, RVC, XTTS v2
- **Orchestration**: FastAPI or Flask microservices

## Deployment

### Web App
```bash
# Deploy to Vercel
vercel deploy --prod

# Environment variables
NEXT_PUBLIC_BACKEND_URL=https://api.example.com
```

### Mobile App
```bash
# Build for EAS (Expo Application Services)
eas build --platform ios --auto-submit
eas build --platform android --auto-submit

# Environment variables
EXPO_PUBLIC_API_URL=https://api.example.com
```

---

**Last Updated**: July 2, 2026
