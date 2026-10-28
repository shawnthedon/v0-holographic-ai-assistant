import { NextRequest, NextResponse } from 'next/server';
import { verify } from '@/lib/llm/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/llm/verify               configuration sweep only (no network)
 * GET /api/llm/verify?probe=1       send a real 1-token request to every configured model
 * GET /api/llm/verify?probe=1&discover=1  also verify up to 4 models per provider,
 *                                         asked for live from its /models endpoint
 * GET /api/llm/verify?models=a,b&probe=1
 *
 * The same data feeds docs/LLM_VERIFICATION.md via scripts/verify-llm.mjs.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const probe = params.get('probe') === '1' || params.get('probe') === 'true';
  const models = params.get('models')?.split(',').map((id) => id.trim()).filter(Boolean);
  const includeDiscovered = params.get('discover') === '1' || params.get('discover') === 'true';
  const timeoutMs = Number(params.get('timeoutMs') ?? 12000);

  try {
    const report = await verify({ probe, modelIds: models, includeDiscovered, timeoutMs });
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Verification failed',
        fix: 'Check the server log — the sweep should never throw.',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: { probe?: boolean; includeDiscovered?: boolean; models?: string[]; timeoutMs?: number } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine */
  }
  try {
    const report = await verify(body);
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Verification failed' },
      { status: 500 },
    );
  }
}
