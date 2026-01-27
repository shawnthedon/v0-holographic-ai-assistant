'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface PersonaPlexConfig {
  voicePrompt?: Blob | null;
  rolePrompt?: string;
  model?: string;
}

type AudioFormat = 'int16' | 'float32';

export function usePersonaPlex(config: PersonaPlexConfig = {}) {
  const { voicePrompt, rolePrompt } = config;

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentViseme, setCurrentViseme] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const talkingHeadRef = useRef<any>(null);

  // Initialize PersonaPlex talking head
  const initializeTalkingHead = useCallback(async (canvasElement: HTMLCanvasElement) => {
    try {
      console.log('[v0] Initializing TalkingHead with PersonaPlex');

      // This is a placeholder for @met4citizen/talkinghead integration
      // In production, you would initialize the library here
      // const TalkingHead = (window as any).TalkingHead;
      // talkingHeadRef.current = new TalkingHead(canvasElement, config);

      // For now, create a mock implementation
      talkingHeadRef.current = {
        speakAudio: async (audioData: ArrayBuffer, format: AudioFormat = 'int16') => {
          console.log('[v0] Speaking audio chunk, format:', format, 'size:', audioData.byteLength);
          setIsProcessing(true);
          // Simulate processing
          await new Promise((resolve) => setTimeout(resolve, 100));
          setIsProcessing(false);
        },
        setRolePrompt: (prompt: string) => {
          console.log('[v0] Set role prompt:', prompt);
        },
        setVoicePrompt: (voiceBlob: Blob) => {
          console.log('[v0] Set voice prompt from blob, size:', voiceBlob.size);
        },
      };

      if (rolePrompt) {
        talkingHeadRef.current.setRolePrompt(rolePrompt);
      }

      if (voicePrompt) {
        talkingHeadRef.current.setVoicePrompt(voicePrompt);
      }

      setError(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to initialize TalkingHead';
      console.error('[v0] TalkingHead initialization error:', errorMsg);
      setError(errorMsg);
    }
  }, [rolePrompt, voicePrompt]);

  // Process and play audio chunks with real-time lip-sync
  const playAudioChunk = useCallback(
    async (audioData: ArrayBuffer | Int16Array | Float32Array, format: AudioFormat = 'int16') => {
      try {
        if (!talkingHeadRef.current) {
          console.warn('[v0] TalkingHead not initialized');
          return;
        }

        // Convert to ArrayBuffer if needed
        let buffer: ArrayBuffer;
        if (audioData instanceof ArrayBuffer) {
          buffer = audioData;
        } else if (audioData instanceof Int16Array || audioData instanceof Float32Array) {
          buffer = audioData.buffer;
        } else {
          throw new Error('Invalid audio data format');
        }

        // Immediately pass to TalkingHead for real-time lip-sync
        console.log('[v0] Playing audio chunk with lip-sync');
        await talkingHeadRef.current.speakAudio(buffer, format);

        // Also play audio
        await playAudioBuffer(buffer, format);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Audio playback error';
        console.error('[v0] Audio playback error:', errorMsg);
        setError(errorMsg);
      }
    },
    []
  );

  // Helper function to play audio buffer
  const playAudioBuffer = useCallback(async (buffer: ArrayBuffer, format: AudioFormat = 'int16') => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const audioContext = audioContextRef.current;

      // Resume audio context if suspended
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // Decode audio data
      const audioBuffer = await audioContext.decodeAudioData(buffer);

      // Create source and play
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;

      // Connect to analyser for viseme detection
      if (!analyserRef.current) {
        analyserRef.current = audioContext.createAnalyser();
        analyserRef.current.fftSize = 2048;
      }

      source.connect(analyserRef.current);
      analyserRef.current.connect(audioContext.destination);
      source.start(0);

      // Update viseme based on frequency analysis
      const detectViseme = () => {
        if (!analyserRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        // Simple viseme detection based on frequency peaks
        const lowFreq = dataArray.slice(0, 10).reduce((a, b) => a + b) / 10;
        const midFreq = dataArray.slice(10, 50).reduce((a, b) => a + b) / 40;
        const highFreq = dataArray.slice(50, 100).reduce((a, b) => a + b) / 50;

        let viseme = 'neutral';
        if (lowFreq > 100) viseme = 'A';
        else if (midFreq > 100) viseme = 'E';
        else if (highFreq > 100) viseme = 'I';
        else if (lowFreq > midFreq && midFreq > highFreq) viseme = 'O';
        else if (highFreq > midFreq) viseme = 'U';

        setCurrentViseme(viseme);
      };

      const animationFrame = setInterval(detectViseme, 50);
      source.onended = () => {
        clearInterval(animationFrame);
        setCurrentViseme(null);
      };
    } catch (err) {
      console.error('[v0] Audio decoding error:', err);
    }
  }, []);

  // Update voice or role prompt
  const updateVoicePrompt = useCallback((voiceBlob: Blob) => {
    if (talkingHeadRef.current) {
      talkingHeadRef.current.setVoicePrompt(voiceBlob);
      console.log('[v0] Voice prompt updated');
    }
  }, []);

  const updateRolePrompt = useCallback((roleText: string) => {
    if (talkingHeadRef.current) {
      talkingHeadRef.current.setRolePrompt(roleText);
      console.log('[v0] Role prompt updated');
    }
  }, []);

  return {
    isProcessing,
    error,
    currentViseme,
    initializeTalkingHead,
    playAudioChunk,
    updateVoicePrompt,
    updateRolePrompt,
  };
}
