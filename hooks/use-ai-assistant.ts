'use client';

import { useCallback, useRef, useState } from 'react';
import { getWebSocketClient } from '@/lib/websocket-client';
import * as deviceAi from '@/lib/device-ai/service';
import { toPayload } from '@/lib/device-ai/types';

/** Any model id from GET /api/models, e.g. 'openrouter/qwen-2.5-72b-instruct'. */
export type LLMModel = string;
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

/**
 * The transcript is capped. An unbounded message array means an unbounded
 * render tree and an unbounded request body — the two things that turn a long
 * conversation into a slow tab and, eventually, a killed one.
 */
const MAX_TRANSCRIPT = 60;
/** Turns sent upstream. The server caps at 24 as well. */
const MAX_CONTEXT_TURNS = 12;
/** A reply that never arrives must not leave the console stuck on "thinking". */
const CHAT_TIMEOUT_MS = 120_000;

function appendMessage(
  current: AssistantMessage[],
  message: AssistantMessage,
): AssistantMessage[] {
  const next = [...current, message];
  return next.length > MAX_TRANSCRIPT ? next.slice(-MAX_TRANSCRIPT) : next;
}

/** A model id of the form `local/…` runs on this device, never in the cloud. */
export function isLocalModelId(modelId: string): boolean {
  return modelId.startsWith('local/');
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

    type SpeechRecognitionCtor = new () => {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onstart: (() => void) | null;
      onresult: ((event: unknown) => void) | null;
      onerror: ((event: unknown) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    };
    const speechWindow = window as unknown as {
      webkitSpeechRecognition?: SpeechRecognitionCtor;
      SpeechRecognition?: SpeechRecognitionCtor;
    };
    const SpeechRecognition = speechWindow.webkitSpeechRecognition || speechWindow.SpeechRecognition;
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

  // Toggle microphone input. The duplex socket is optional: browser speech
  // recognition works without it, so a missing backend degrades to text-only
  // replies instead of blocking the microphone entirely.
  const toggleMicrophone = useCallback(async () => {
    if (!wsClientRef.current.isConnected()) {
      try {
        await wsClientRef.current.connect();
      } catch (err) {
        console.warn('[v0] Duplex socket unavailable — continuing with browser recognition only', err);
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
          throw new Error(`Speech synthesis unavailable (${response.status})`);
        }
        // A JSON/HTML error body must never reach decodeAudioData: that throws a
        // DOMException which some engines surface as an unhandled rejection.
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.startsWith('audio/')) {
          throw new Error(`Speech endpoint returned ${contentType || 'no content type'}`);
        }

        const audioBuffer = await response.arrayBuffer();

        // Best-effort: the duplex socket is optional, playback is not.
        try {
          await wsClientRef.current.sendAudio(audioBuffer, 16000);
        } catch {
          /* no duplex backend — continue with local playback */
        }

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
      setMessages((prev) => appendMessage(prev, userMessage));

      try {
        // ---- on-device path (spec §8): no network, no cloud fallback ----
        if (isLocalModelId(options.model)) {
          const loaded = deviceAi.loadedModelId();
          if (!loaded) {
            // Explicit, actionable failure. Deliberately NOT a silent cloud retry.
            throw new Error(
              'No local model is loaded — open Local AI, install and load a GGUF model. This prompt was not sent anywhere.',
            );
          }

          let streamed = '';
          const result = await deviceAi.generateText(
            {
              modelId: loaded,
              messages: [
                { role: 'system', content: 'You are NEXUS, a concise on-device assistant. Answer in two sentences.' },
                ...messages.slice(-6).map((message) => ({
                  role: message.role as 'user' | 'assistant',
                  content: message.content,
                })),
                { role: 'user', content },
              ],
              maxTokens: 220,
            },
            (chunk) => {
              streamed += chunk;
            },
          );

          const text = result.text || streamed;
          setMessages((prev) =>
            appendMessage(prev, { role: 'assistant', content: text, timestamp: Date.now() }),
          );
          try {
            await wsClientRef.current.sendVisemeRequest(text);
          } catch {
            /* the rig derives lip movement from live audio */
          }
          await synthesizeSpeech(text);
          return;
        }

        // Send to backend for LLM processing
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
        let response: Response;
        try {
          response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              message: content,
              model: options.model,
              endpoint: options.customEndpoint,
              // Only the recent context, with roles the provider accepts.
              messages: messages.slice(-MAX_CONTEXT_TURNS).map((message) => ({
                role: message.role,
                content: message.content,
              })),
            }),
          });
        } finally {
          window.clearTimeout(timeout);
        }

        if (!response.ok) {
          // the route returns { error, code, fix } for every LLM failure
          const failure = (await response.json().catch(() => null)) as
            | { error?: string; code?: string; fix?: string }
            | null;
          const detail = failure?.error || response.statusText || `HTTP ${response.status}`;
          setError(failure?.fix ? `${detail} — ${failure.fix}` : detail);
          throw new Error(detail);
        }

        const data = (await response.json()) as {
          response: string;
          model?: string;
          provider?: string;
          execution?: string;
        };
        const assistantResponse = data.response;

        console.log('[v0] LLM response:', assistantResponse);

        // Add assistant message
        const assistantMessage: AssistantMessage = {
          role: 'assistant',
          content: assistantResponse,
          timestamp: Date.now(),
        };
        setMessages((prev) => appendMessage(prev, assistantMessage));

        // Generate speech
        await synthesizeSpeech(assistantResponse);

        // Send viseme data to WebSocket for lip-sync (optional)
        try {
          await wsClientRef.current.sendVisemeRequest(assistantResponse);
        } catch {
          /* no duplex backend — the rig derives lip movement from live audio */
        }
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err) {
          const payload = toPayload(err);
          setError(`${payload.message} — ${payload.fix}`);
        } else {
          setError(err instanceof Error ? err.message : 'Unknown error');
        }
      } finally {
        setIsProcessing(false);
      }
    },
    [options, messages, synthesizeSpeech]
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
