'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { telemetry } from '@/lib/hud/telemetry';

interface AudioConfig {
  sampleRate?: number;
  channelCount?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

export function useFullDuplexAudio(
  onAudioChunk: (chunk: Int16Array | Float32Array, sampleRate: number) => void,
  config: AudioConfig = {}
) {
  const {
    sampleRate = 16000,
    channelCount = 1,
    echoCancellation = true,
    noiseSuppression = true,
    autoGainControl = true,
  } = config;

  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Initialize audio context and start streaming
  const startStreaming = useCallback(async () => {
    try {
      // Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation,
          noiseSuppression,
          autoGainControl,
          sampleRate: { ideal: sampleRate },
        },
      });

      mediaStreamRef.current = stream;
      setHasPermission(true);

      // Create or reuse audio context
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const audioContext = audioContextRef.current;

      // Resume audio context if suspended
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // Create media stream source
      if (!sourceRef.current) {
        sourceRef.current = audioContext.createMediaStreamSource(stream);
      }

      // Real analyser feeding the HUD level meters, spectrum and lip-sync
      if (!analyserRef.current) {
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.72;
        sourceRef.current.connect(analyser);
        analyserRef.current = analyser;
        telemetry.attachAnalyser(analyser, audioContext.sampleRate);
      }

      // Create script processor for continuous audio capture
      const bufferSize = 4096;
      const processor = audioContext.createScriptProcessor(bufferSize, channelCount, channelCount);

      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);

        // Convert Float32 to Int16
        const int16Array = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          let sample = inputData[i];
          // Clamp to [-1, 1]
          sample = Math.max(-1, Math.min(1, sample));
          // Convert to Int16
          int16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }

        console.log('[v0] Sending audio chunk, size:', int16Array.length);
        onAudioChunk(int16Array, audioContext.sampleRate);
      };

      processorRef.current = processor;
      sourceRef.current.connect(processor);
      processor.connect(audioContext.destination);

      setIsStreaming(true);
      setError(null);
      console.log('[v0] Full-duplex audio streaming started');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[v0] Audio streaming error:', errorMsg);
      setError(errorMsg);
      setIsStreaming(false);
    }
  }, [sampleRate, channelCount, echoCancellation, noiseSuppression, autoGainControl, onAudioChunk]);

  // Stop streaming
  const stopStreaming = useCallback(() => {
    telemetry.attachAnalyser(null);

    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect();
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
    }

    setIsStreaming(false);
    console.log('[v0] Full-duplex audio streaming stopped');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isStreaming) {
        stopStreaming();
      }
    };
  }, [isStreaming, stopStreaming]);

  return {
    isStreaming,
    error,
    hasPermission,
    startStreaming,
    stopStreaming,
  };
}
