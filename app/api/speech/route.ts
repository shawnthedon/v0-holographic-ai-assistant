import { NextRequest, NextResponse } from 'next/server';

interface SpeechRequest {
  text: string;
  provider: 'google' | 'elevenlabs';
  speed: number;
}

export async function POST(request: NextRequest) {
  try {
    const body: SpeechRequest = await request.json();
    const { text, provider, speed = 1 } = body;

    console.log('[v0] Speech API called with provider:', provider);

    if (!text) {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    let audioBuffer: ArrayBuffer;

    if (provider === 'elevenlabs') {
      audioBuffer = await synthesizeElevenLabs(text, speed);
    } else {
      // Default to Google TTS
      audioBuffer = await synthesizeGoogle(text, speed);
    }

    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error('[v0] Speech API error:', error);
    return NextResponse.json(
      { error: 'Failed to synthesize speech' },
      { status: 500 }
    );
  }
}

async function synthesizeGoogle(text: string, speed: number): Promise<ArrayBuffer> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY not configured');
  }

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          text: text,
        },
        voice: {
          languageCode: 'en-US',
          name: 'en-US-Neural2-A',
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: speed,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Google TTS error: ${response.statusText}`);
  }

  const data = await response.json();
  const audioContent = data.audioContent;

  // Decode base64 to ArrayBuffer
  const binaryString = atob(audioContent);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes.buffer;
}

async function synthesizeElevenLabs(text: string, speed: number): Promise<ArrayBuffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  // Use a default voice ID for ElevenLabs (can be customized)
  const voiceId = 'EXAVITQu4vr4xnSDxMaL';

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`ElevenLabs API error: ${response.statusText}`);
  }

  return response.arrayBuffer();
}
