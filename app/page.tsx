'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { AvatarScene } from '@/components/avatar-scene';
import { ControlMenu } from '@/components/control-menu';
import { SettingsPanel } from '@/components/settings-panel';
import { FaceCapture } from '@/components/face-capture';
import { useAiAssistant, type LLMModel, type VoiceProvider } from '@/hooks/use-ai-assistant';
import { useFullDuplexAudio } from '@/hooks/use-full-duplex-audio';
import { usePersonaPlex } from '@/hooks/use-persona-plex';

export default function Home() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [llmModel, setLlmModel] = useState<LLMModel>('gemini-2.0-flash');
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>('google');
  const [speechSpeed, setSpeechSpeed] = useState(1);
  const [customEndpoint, setCustomEndpoint] = useState('');
  const [voicePrompt, setVoicePrompt] = useState<Blob | null>(null);
  const [rolePrompt, setRolePrompt] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  // Initialize PersonaPlex with voice and role prompts
  const {
    isProcessing: isPersonaProcessing,
    error: personaError,
    currentViseme,
    initializeTalkingHead,
    playAudioChunk,
    updateVoicePrompt,
    updateRolePrompt,
  } = usePersonaPlex({
    voicePrompt,
    rolePrompt,
  });

  // Initialize full-duplex audio streaming
  const handleAudioChunk = useCallback(
    (chunk: Int16Array | Float32Array, sampleRate: number) => {
      // Send audio chunk via WebSocket
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        const audioMessage = {
          type: 'audio',
          data: chunk,
          format: chunk instanceof Int16Array ? 'int16' : 'float32',
          sampleRate,
        };
        wsRef.current.send(JSON.stringify(audioMessage));
        console.log('[v0] Audio chunk sent via WebSocket');
      }
    },
    []
  );

  const { isStreaming, error: audioError, startStreaming, stopStreaming } = useFullDuplexAudio(
    handleAudioChunk,
    {
      sampleRate: 16000,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    }
  );

  const { isListening, isProcessing, toggleMicrophone, sendMessage } = useAiAssistant({
    model: llmModel,
    voiceProvider,
    speechSpeed,
    customEndpoint,
  });

  // Setup WebSocket connection for real-time audio response
  useEffect(() => {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!backendUrl) {
      console.warn('[v0] NEXT_PUBLIC_BACKEND_URL not configured');
      return;
    }

    const ws = new WebSocket(backendUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[v0] WebSocket connected for full-duplex audio');
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'audio') {
          // Convert received data to ArrayBuffer
          const audioBuffer = new ArrayBuffer(message.data.length * 2);
          const view = new Int16Array(audioBuffer);
          for (let i = 0; i < message.data.length; i++) {
            view[i] = message.data[i];
          }
          // Immediately play audio with lip-sync
          await playAudioChunk(audioBuffer, message.format || 'int16');
        }
      } catch (err) {
        console.error('[v0] Error processing WebSocket message:', err);
      }
    };

    ws.onerror = (err) => {
      console.error('[v0] WebSocket error:', err);
    };

    ws.onclose = () => {
      console.log('[v0] WebSocket disconnected');
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [playAudioChunk]);

  useEffect(() => {
    document.body.classList.add('dark');
  }, []);

  return (
    <main className="w-full h-screen bg-black overflow-hidden flex flex-col">
      {/* Avatar Scene - Main Background */}
      <div className="absolute inset-0 z-0">
        <AvatarScene isListening={isStreaming} isSpeaking={isPersonaProcessing} />
      </div>

      {/* Content Layer */}
      <div className="relative z-10 w-full h-full flex flex-col">
        {/* Header with status indicators */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-cyan-400/10 bg-black/40 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <h1 className="text-lg font-semibold text-white">Holographic AI</h1>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono text-gray-400">
            {isListening && (
              <div className="flex items-center gap-2 px-3 py-1 bg-cyan-400/10 rounded border border-cyan-400/30">
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                <span>Listening...</span>
              </div>
            )}

            {isProcessing && (
              <div className="flex items-center gap-2 px-3 py-1 bg-purple-400/10 rounded border border-purple-400/30">
                <div className="animate-spin">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                </div>
                <span>Processing...</span>
              </div>
            )}
          </div>
        </header>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col md:flex-row items-stretch justify-center gap-4 md:gap-6 p-4 md:p-6 overflow-hidden pb-24 md:pb-6">
          {/* Sidebar - Visible on md and up */}
          <div className="hidden md:flex flex-col gap-4 w-64 flex-shrink-0">
            <div className="p-5 rounded-lg bg-slate-900/50 border border-cyan-400/20 backdrop-blur">
              <h2 className="text-sm font-mono text-cyan-400 mb-3">
                Configuration
              </h2>
              <div className="space-y-2 text-xs text-gray-300">
                <div className="flex justify-between">
                  <span>Model:</span>
                  <span className="text-cyan-400 text-right truncate">{llmModel}</span>
                </div>
                <div className="flex justify-between">
                  <span>Voice:</span>
                  <span className="text-cyan-400">{voiceProvider}</span>
                </div>
                <div className="flex justify-between">
                  <span>Speed:</span>
                  <span className="text-cyan-400">{speechSpeed.toFixed(1)}x</span>
                </div>
              </div>
            </div>

            <div className="p-5 rounded-lg bg-slate-900/50 border border-cyan-400/20 backdrop-blur">
              <h2 className="text-sm font-mono text-cyan-400 mb-3">Tips</h2>
              <p className="text-xs text-gray-400 leading-relaxed">
                Use the menu at the bottom to access microphone, voice settings, and knowledge base uploads.
              </p>
            </div>
          </div>

          {/* Avatar Display - Center */}
          <div className="flex-1 min-h-96 md:min-h-0 rounded-lg overflow-hidden border border-cyan-400/20 bg-black/50 backdrop-blur flex items-center justify-center">
            <div className="text-center text-gray-500 text-sm font-mono">
              Avatar Model Loading...
            </div>
          </div>

          {/* Conversation Panel - Right sidebar */}
          <div className="hidden md:flex flex-col gap-4 w-64 flex-shrink-0">
            <div className="p-5 rounded-lg bg-slate-900/50 border border-cyan-400/20 backdrop-blur overflow-hidden flex flex-col h-full">
              <h2 className="text-sm font-mono text-cyan-400 mb-3 flex-shrink-0">
                Chat
              </h2>
              <div className="flex-1 overflow-y-auto space-y-3 text-xs pr-2">
                <div className="flex gap-3">
                  <div className="w-2 h-2 rounded-full bg-cyan-400 flex-shrink-0 mt-1.5" />
                  <p className="text-gray-300">
                    Welcome to the holographic AI interface. Ask me anything!
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setIsSettingsOpen(true)}
              className="px-4 py-2 text-xs font-mono bg-gradient-to-r from-cyan-400/20 to-purple-400/20 border border-cyan-400/30 rounded-lg text-cyan-400 hover:from-cyan-400/30 hover:to-purple-400/30 transition-colors flex-shrink-0"
            >
              Settings →
            </button>
          </div>
        </div>
      </div>

      {/* Control Menu */}
      <ControlMenu
        onSettingsOpen={() => setIsSettingsOpen(true)}
        onMicToggle={() => {
          if (isStreaming) {
            stopStreaming();
          } else {
            startStreaming().catch((err) => console.error('[v0] Streaming error:', err));
          }
        }}
      />

      {/* Face Capture Component */}
      <FaceCapture />

      {/* Settings Panel */}
      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        llmModel={llmModel}
        onLlmModelChange={setLlmModel}
        voiceProvider={voiceProvider}
        onVoiceProviderChange={setVoiceProvider}
        speechSpeed={speechSpeed}
        onSpeechSpeedChange={setSpeechSpeed}
        customEndpoint={customEndpoint}
        onCustomEndpointChange={setCustomEndpoint}
        onVoicePromptChange={(blob) => {
          setVoicePrompt(blob);
          if (blob) updateVoicePrompt(blob);
        }}
        onRolePromptChange={(text) => {
          setRolePrompt(text);
          updateRolePrompt(text);
        }}
      />
    </main>
  );
}
