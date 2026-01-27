'use client';

import { useCallback, useRef, useState } from 'react';
import { getWebSocketClient } from '@/lib/websocket-client';

export type LLMModel = 'gemini-2.0-flash' | 'gpt-4o' | 'custom';
export type VoiceProvider = 'google' | 'elevenlabs';

interface UseAiAssistantOptions {
  model: LLMModel;
  voiceProvider: VoiceProvider;
  speechSpeed: number;
  customEndpoint?: string;
}

interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function useAiAssistant(options: UseAiAssistantOptions) {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const wsClientRef = useRef(getWebSocketClient());
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);

  // Initialize Web Speech API
  const initializeSpeechRecognition = useCallback(() => {
    if (recognitionRef.current) return;

    const SpeechRecognition =
      window.webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SpeechRecognition) {
      setError('Speech Recognition not supported');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      console.log('[v0] Speech recognition started');
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      console.log('[v0] Speech transcript:', transcript);

      if (event.isFinal) {
        handleUserMessage(transcript);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('[v0] Speech recognition error:', event.error);
      setError(`Speech error: ${event.error}`);
      setIsListening(false);
    };

    recognition.onend = () => {
      console.log('[v0] Speech recognition ended');
      setIsListening(false);
    };

    recognitionRef.current = recognition;
  }, []);

  // Toggle microphone input
  const toggleMicrophone = useCallback(async () => {
    if (!wsClientRef.current.isConnected()) {
      try {
        await wsClientRef.current.connect();
      } catch (err) {
        console.error('[v0] WebSocket connection failed:', err);
        setError('Failed to connect to server');
        return;
      }
    }

    initializeSpeechRecognition();

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current?.start();
    }
  }, [isListening, initializeSpeechRecognition]);

  // Handle user message
  const handleUserMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      console.log('[v0] Processing user message:', content);
      setIsProcessing(true);
      setError(null);

      // Add user message to history
      const userMessage: AssistantMessage = {
        role: 'user',
        content,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMessage]);

      try {
        // Send to backend for LLM processing
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: content,
            model: options.model,
            endpoint: options.customEndpoint,
            messages: messages,
          }),
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.statusText}`);
        }

        const data = await response.json();
        const assistantResponse = data.response;

        console.log('[v0] LLM response:', assistantResponse);

        // Add assistant message
        const assistantMessage: AssistantMessage = {
          role: 'assistant',
          content: assistantResponse,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMessage]);

        // Generate speech
        await synthesizeSpeech(assistantResponse);

        // Send viseme data to WebSocket for lip-sync
        await wsClientRef.current.sendVisemeRequest(assistantResponse);
      } catch (err) {
        console.error('[v0] Error processing message:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsProcessing(false);
      }
    },
    [options, messages]
  );

  // Text-to-speech synthesis
  const synthesizeSpeech = useCallback(
    async (text: string) => {
      try {
        console.log('[v0] Synthesizing speech for:', text.substring(0, 50));

        const response = await fetch('/api/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            provider: options.voiceProvider,
            speed: options.speechSpeed,
          }),
        });

        if (!response.ok) {
          throw new Error('Speech synthesis failed');
        }

        const audioBuffer = await response.arrayBuffer();

        // Send audio to WebSocket
        await wsClientRef.current.sendAudio(audioBuffer, 16000);

        // Play audio locally
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext ||
            (window as any).webkitAudioContext)();
        }

        const audioContext = audioContextRef.current;
        const decoded = await audioContext.decodeAudioData(audioBuffer.slice(0));
        const source = audioContext.createBufferSource();
        source.buffer = decoded;
        source.connect(audioContext.destination);
        source.start(0);

        console.log('[v0] Audio playback started');
      } catch (err) {
        console.error('[v0] Speech synthesis error:', err);
        setError('Failed to generate speech');
      }
    },
    [options]
  );

  // Send text message directly
  const sendMessage = useCallback(
    (content: string) => {
      handleUserMessage(content);
    },
    [handleUserMessage]
  );

  return {
    isListening,
    isProcessing,
    messages,
    error,
    toggleMicrophone,
    sendMessage,
  };
}
