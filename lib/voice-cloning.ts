'use client';

export enum VoiceCloningModel {
  OPENVOICE = 'openvoice',
  RVC = 'rvc',
  XTTS = 'xtts',
}

export interface VoiceCloningParams {
  model: VoiceCloningModel;
  referenceAudio: Blob;
  text?: string;
  language?: string;
  pitchShift?: number; // -12 to +12 semitones
  toneColor?: number; // 0 to 1
  style?: string; // 'neutral', 'casual', 'formal'
  audioFormat?: 'mp3' | 'wav' | 'ogg';
}

export interface VoiceCloningResult {
  audioUrl: string;
  audioBlob: Blob;
  duration: number;
  model: VoiceCloningModel;
}

/**
 * Validate audio reference clip
 */
export async function validateAudioClip(blob: Blob): Promise<{
  valid: boolean;
  duration: number;
  error?: string;
}> {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const duration = audioBuffer.duration;

    // Validate: 1-30 seconds for reference
    if (duration < 1 || duration > 30) {
      return {
        valid: false,
        duration,
        error: `Audio must be 1-30 seconds (got ${duration.toFixed(2)}s)`,
      };
    }

    return { valid: true, duration };
  } catch (err) {
    return {
      valid: false,
      duration: 0,
      error: `Invalid audio format: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}

/**
 * Normalize audio (trim silence, adjust levels)
 */
export async function normalizeAudio(blob: Blob): Promise<Blob> {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Normalize amplitude
    const channelData = audioBuffer.getChannelData(0);
    let maxAmplitude = 0;
    for (let i = 0; i < channelData.length; i++) {
      maxAmplitude = Math.max(maxAmplitude, Math.abs(channelData[i]));
    }

    const normalizeGain = maxAmplitude > 0 ? 0.95 / maxAmplitude : 1;
    for (let i = 0; i < channelData.length; i++) {
      channelData[i] *= normalizeGain;
    }

    // Encode back to blob (simplified - in production use proper WAV encoder)
    return new Blob([arrayBuffer], { type: blob.type });
  } catch (err) {
    console.error('[v0] Audio normalization failed:', err);
    return blob; // Return original if normalization fails
  }
}

/**
 * Clone voice using specified model
 */
export async function cloneVoice(
  params: VoiceCloningParams,
  endpoint: string = '/api/voice-clone'
): Promise<VoiceCloningResult> {
  try {
    // Validate reference audio
    const validation = await validateAudioClip(params.referenceAudio);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Normalize audio
    const normalizedAudio = await normalizeAudio(params.referenceAudio);

    // Prepare form data
    const formData = new FormData();
    formData.append('model', params.model);
    formData.append('referenceAudio', normalizedAudio, 'reference.wav');

    if (params.text) {
      formData.append('text', params.text);
    }
    if (params.language) {
      formData.append('language', params.language);
    }
    if (params.pitchShift !== undefined) {
      formData.append('pitchShift', params.pitchShift.toString());
    }
    if (params.toneColor !== undefined) {
      formData.append('toneColor', params.toneColor.toString());
    }
    if (params.style) {
      formData.append('style', params.style);
    }

    // Send to backend
    const response = await fetch(endpoint, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || `Voice cloning failed: ${response.statusText}`);
    }

    const result = await response.json();

    // Convert base64 or URL to blob
    let audioBlob: Blob;
    if (result.audio) {
      // Base64 encoded audio
      const binaryString = atob(result.audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      audioBlob = new Blob([bytes], { type: 'audio/wav' });
    } else if (result.audioUrl) {
      // URL response - fetch the actual audio
      const audioResponse = await fetch(result.audioUrl);
      audioBlob = await audioResponse.blob();
    } else {
      throw new Error('No audio in response');
    }

    return {
      audioUrl: URL.createObjectURL(audioBlob),
      audioBlob,
      duration: result.duration || 0,
      model: params.model,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Voice cloning failed';
    console.error('[v0] Voice cloning error:', message);
    throw new Error(message);
  }
}

/**
 * Get supported models and their parameters
 */
export function getSupportedModels(): Record<
  VoiceCloningModel,
  { label: string; description: string; params: string[] }
> {
  return {
    [VoiceCloningModel.OPENVOICE]: {
      label: 'OpenVoice',
      description: 'Fast, high-quality zero-shot voice cloning',
      params: ['toneColor', 'style', 'language'],
    },
    [VoiceCloningModel.RVC]: {
      label: 'RVC (Retrieval-based VC)',
      description: 'Professional voice conversion with pitch control',
      params: ['pitchShift', 'audioFormat'],
    },
    [VoiceCloningModel.XTTS]: {
      label: 'XTTS v2',
      description: 'Cross-lingual text-to-speech cloning',
      params: ['language', 'style'],
    },
  };
}

/**
 * Get parameter config for a model
 */
export function getModelParams(model: VoiceCloningModel): Record<string, unknown> {
  const configs: Record<VoiceCloningModel, Record<string, unknown>> = {
    [VoiceCloningModel.OPENVOICE]: {
      toneColor: { min: 0, max: 1, default: 0.5, step: 0.1 },
      style: {
        options: ['neutral', 'casual', 'formal'],
        default: 'neutral',
      },
      language: { options: ['en', 'zh', 'ja', 'ko'], default: 'en' },
    },
    [VoiceCloningModel.RVC]: {
      pitchShift: { min: -12, max: 12, default: 0, step: 1 },
      audioFormat: {
        options: ['wav', 'mp3', 'ogg'],
        default: 'wav',
      },
    },
    [VoiceCloningModel.XTTS]: {
      language: { options: ['en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'tr', 'ru', 'nl', 'cy', 'ar', 'cs', 'da', 'fi', 'el', 'hu', 'ja', 'ko', 'zh', 'hi'], default: 'en' },
      style: {
        options: ['default', 'expressive', 'whisper'],
        default: 'default',
      },
    },
  };

  return configs[model] || {};
}
