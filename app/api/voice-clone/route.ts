import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/voice-clone
 *
 * Creates a voice profile from consented reference audio.
 *
 * This endpoint used to return a hard-coded base64 clip and a fabricated
 * duration — i.e. it reported success without synthesising anything. It now
 * either performs a real clone with a configured engine, or states plainly that
 * no cloning engine is available.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'audio/webm',
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
]);

const SUPPORTED_ENGINES = ['elevenlabs'] as const;

/** Structural view of FormData — avoids the DOM/undici type clash in Node. */
type FormLike = { get(name: string): FormDataEntryValue | null };

function field(form: FormLike, name: string): string | null {
  const value = form.get(name);
  return typeof value === 'string' ? value : null;
}

export async function POST(request: NextRequest) {
  let form: FormLike;
  try {
    form = (await request.formData()) as unknown as FormLike;
  } catch {
    return NextResponse.json(
      { error: 'Expected multipart/form-data', code: 'bad-request', fix: 'Send a FormData body.' },
      { status: 400 },
    );
  }

  const engine = (field(form, 'engine') || 'elevenlabs').toLowerCase();
  const name = field(form, 'name') || 'operator-voice';
  const consent = field(form, 'consent');
  const reference = form.get('referenceAudio');

  if (!(reference instanceof File)) {
    return NextResponse.json(
      {
        error: 'referenceAudio file is required',
        code: 'bad-request',
        fix: 'Attach a 30s–3min mono recording as `referenceAudio`.',
      },
      { status: 400 },
    );
  }

  if (reference.size === 0 || reference.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `Reference audio must be between 1 byte and ${MAX_BYTES / 1024 / 1024} MB (received ${reference.size})`,
        code: 'bad-request',
        fix: 'Trim the recording or convert it to a smaller mono format.',
      },
      { status: 413 },
    );
  }

  if (reference.type && !ALLOWED_TYPES.has(reference.type)) {
    return NextResponse.json(
      {
        error: `Unsupported audio type "${reference.type}"`,
        code: 'bad-request',
        fix: `Send one of: ${[...ALLOWED_TYPES].join(', ')}.`,
      },
      { status: 415 },
    );
  }

  // Cloning someone's voice requires explicit, recorded consent.
  if (consent !== 'true') {
    return NextResponse.json(
      {
        error: 'Consent is required to create a voice profile',
        code: 'consent-required',
        fix: 'Send consent=true only when the speaker has authorised cloning of their voice.',
      },
      { status: 403 },
    );
  }

  if (!SUPPORTED_ENGINES.includes(engine as (typeof SUPPORTED_ENGINES)[number])) {
    return NextResponse.json(
      {
        error: `No cloning adapter for engine "${engine}"`,
        code: 'unsupported-engine',
        fix: `Supported engines: ${SUPPORTED_ENGINES.join(', ')}. Add an adapter in lib/llm/voice.ts for others.`,
      },
      { status: 501 },
    );
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: 'Voice cloning is not configured: ELEVENLABS_API_KEY is missing',
        code: 'no-credential',
        fix: 'Set ELEVENLABS_API_KEY to enable hosted cloning, or integrate a local cloning runtime (XTTS/RVC) behind this route. No mock audio is returned.',
      },
      { status: 503 },
    );
  }

  try {
    const upstream = new FormData();
    upstream.append('name', name.slice(0, 60));
    upstream.append('files', reference, reference.name || 'reference.webm');
    upstream.append('description', 'Created from the NEXUS console');

    const response = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: upstream,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      const status = response.status === 401 || response.status === 403 ? 401 : 502;
      return NextResponse.json(
        {
          error: `ElevenLabs voice creation failed (${response.status}): ${detail.slice(0, 300)}`,
          code: status === 401 ? 'auth-failed' : 'provider-error',
          fix:
            status === 401
              ? 'Re-issue ELEVENLABS_API_KEY; the current key was rejected.'
              : 'Check the ElevenLabs account quota and the reference audio duration.',
        },
        { status },
      );
    }

    const payload = (await response.json()) as { voice_id?: string };
    if (!payload.voice_id) {
      return NextResponse.json(
        {
          error: 'ElevenLabs accepted the request but returned no voice_id',
          code: 'bad-response',
          fix: 'Verify the account is enabled for voice cloning.',
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      voiceId: payload.voice_id,
      engine,
      name,
      referenceBytes: reference.size,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Voice cloning request failed',
        code: 'network-error',
        fix: 'The runtime could not reach ElevenLabs. Check egress rules for this deployment.',
      },
      { status: 502 },
    );
  }
}
