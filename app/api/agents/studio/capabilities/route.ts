import { NextResponse } from 'next/server';
import { probeCapabilities } from '@/lib/agent-studio/probe';

export const dynamic = 'force-dynamic';

/**
 * What this deployment can actually do, checked now.
 *
 * The studio calls this on open and after a failed activation, so availability
 * is a measurement rather than a catalogue claim.
 */
export async function GET() {
  try {
    const snapshot = await probeCapabilities();
    return NextResponse.json({ ok: true, ...snapshot });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: 'capability-probe-failed',
        message: error instanceof Error ? error.message : 'The capability probe failed.',
        fix: 'The studio falls back to the static catalogue — nothing marked Ready there is guessed, but availability is unproven.',
      },
      { status: 500 },
    );
  }
}
