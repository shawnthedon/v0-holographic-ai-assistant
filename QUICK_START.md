# Quick Start: Full-Duplex Speech-to-Speech

## Setup in 5 Minutes

### 1. Set Environment Variable
```bash
# Add to .env.local or Vercel project vars
NEXT_PUBLIC_BACKEND_URL=ws://localhost:8000/audio
```

### 2. Click Settings Button
Open the advanced settings panel from the bottom-right menu.

### 3. Add Voice Prompt (Optional)
- Drag a 3-second audio file into the "Voice Prompt (Cloning)" zone
- Or click "Choose File" to browse
- Formats supported: MP3, WAV, OGG, WebM, etc.

### 4. Add Role Prompt (Optional)
Enter a character description in the "Role Prompt (Conditioning)" textarea:
```
Example: "You are a curious and friendly AI assistant who loves 
asking thoughtful questions and has a sense of humor."
```

### 5. Click Microphone Button
- Bottom-right menu → Microphone icon
- Avatar will show breathing animation (listening state)
- Speak freely - no need to pause
- Response audio plays automatically with lip-sync

## Key Files Reference

| File | Purpose | Status |
|------|---------|--------|
| `/hooks/use-full-duplex-audio.ts` | Continuous audio capture | ✅ Ready |
| `/hooks/use-persona-plex.ts` | Voice/role conditioning | ✅ Ready |
| `/components/avatar-scene.tsx` | Animations + lip-sync | ✅ Ready |
| `/components/settings-panel.tsx` | Voice/role prompt UI | ✅ Ready |
| `/app/page.tsx` | Main integration | ✅ Ready |
| `/app/api/persona/route.ts` | Backend handler | ✅ Ready |

## State Management

```typescript
// Voice and Role Prompts
const [voicePrompt, setVoicePrompt] = useState<Blob | null>(null);
const [rolePrompt, setRolePrompt] = useState('');

// Audio Streaming
const { isStreaming, startStreaming, stopStreaming } = useFullDuplexAudio(...);

// PersonaPlex Processing
const { isProcessing, currentViseme, playAudioChunk } = usePersonaPlex(...);

// Avatar State
<AvatarScene 
  isListening={isStreaming} 
  isSpeaking={isProcessing} 
/>
```

## Avatar Animation States

### Listening (isListening=true, isSpeaking=false)
```
🫀 Breathing: Scale 1.0 → 1.02 → 1.0 (3Hz)
👀 Eye Darting: Head tilts ±0.03 radians
```

### Speaking (isSpeaking=true)
```
🤐 Pause Breathing: Scale = 1.0
🗣️ Continue Floating: Base Y-axis animation
```

### Idle
```
🎭 Float Only: Subtle Y-axis bobbing + rotation
```

## WebSocket Message Format

### Client → Server (Audio)
```typescript
{
  "type": "audio",
  "data": [Int16Array],
  "format": "int16",
  "sampleRate": 16000
}
```

### Server → Client (Audio Response)
```typescript
{
  "type": "audio",
  "data": [Int16Array],
  "format": "int16",
  "sampleRate": 16000
}
```

## Hooks Quick Reference

### useFullDuplexAudio
```typescript
const { isStreaming, error, startStreaming, stopStreaming } = 
  useFullDuplexAudio(
    (chunk, sampleRate) => {
      // Handle audio chunk
    },
    { sampleRate: 16000, echoCancellation: true }
  );

// Start listening
await startStreaming();

// Stop listening
stopStreaming();
```

### usePersonaPlex
```typescript
const {
  isProcessing,
  currentViseme,
  initializeTalkingHead,
  playAudioChunk,
  updateVoicePrompt,
  updateRolePrompt,
} = usePersonaPlex({
  voicePrompt,
  rolePrompt,
});

// Play incoming audio
await playAudioChunk(audioBuffer, 'int16');

// Update prompts
updateVoicePrompt(voiceBlob);
updateRolePrompt("Character description...");
```

## Viseme Detection

Automatic real-time viseme detection maps frequency ranges to mouth shapes:

| Frequency | Viseme | Sound |
|-----------|--------|-------|
| 0-10 Hz | A | "ah" |
| 10-50 Hz | E | "eh" |
| 50-100 Hz | I/U | "ee"/"oo" |
| Mixed | O | "oh" |

## Troubleshooting Quick Fixes

### "WebSocket connection failed"
```javascript
// Check environment variable
console.log(process.env.NEXT_PUBLIC_BACKEND_URL);

// Verify backend is running
// Verify CORS headers (if applicable)
```

### "Microphone not working"
```javascript
// Check browser permissions
// Check console for: "Permission denied"

// Manually request permission
await navigator.mediaDevices.getUserMedia({ audio: true });
```

### "Avatar not breathing"
```javascript
// Check isListening prop is true
// Check browser console for errors
// Verify animation loop is running
```

### "No lip-sync animation"
```javascript
// Check currentViseme is updating
// Verify TalkingHead is initialized
// Check audio format matches Int16
```

## Development Checklist

- [ ] Backend WebSocket running on NEXT_PUBLIC_BACKEND_URL
- [ ] PersonaPlex processing pipeline implemented
- [ ] Voice prompt loading and conditioning
- [ ] Role prompt applied to context
- [ ] Audio streaming bi-directional
- [ ] Viseme timing synchronized
- [ ] Avatar animations smooth
- [ ] No console errors on microphone usage

## Performance Tips

1. **Reduce animation complexity** if FPS drops below 60
2. **Increase audio chunk size** if latency is high (currently 256ms)
3. **Use compression** for voice prompt file
4. **Enable noise suppression** for background noise reduction
5. **Close other browser tabs** to free up resources

## Example Backend Response (Node.js)

```typescript
// Handle incoming audio
socket.on('message', async (msg) => {
  const message = JSON.parse(msg);
  
  if (message.type === 'audio') {
    // Process with PersonaPlex
    const int16Array = new Int16Array(message.data);
    
    // Apply voice cloning
    const responseAudio = await processWithPersonaPlex(
      int16Array,
      voicePromptBuffer,
      rolePromptText
    );
    
    // Send back
    socket.send(JSON.stringify({
      type: 'audio',
      data: Array.from(responseAudio),
      format: 'int16',
      sampleRate: 16000
    }));
  }
});
```

## Next Steps

1. ✅ Run development server: `npm run dev`
2. ✅ Open http://localhost:3000
3. ✅ Test microphone permissions
4. ✅ Upload voice prompt (optional)
5. ✅ Set role prompt (optional)
6. ✅ Click microphone and speak
7. ✅ Enjoy real-time conversations with lip-sync!

---

For detailed documentation, see `/FULL_DUPLEX_GUIDE.md`

For implementation details, see `/IMPLEMENTATION_SUMMARY.md`
