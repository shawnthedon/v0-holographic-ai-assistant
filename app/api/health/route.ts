import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lightweight liveness probe used by the HUD to measure real round-trip
 * latency. Deliberately does no external work so the number reflects the
 * network path rather than a third-party API.
 */
export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      ts: Date.now(),
      uptime: Math.round(process.uptime()),
      node: process.version,
      region: process.env.VERCEL_REGION ?? 'local',
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
