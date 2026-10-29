import { NextRequest, NextResponse } from 'next/server';

import { getBrowserService, BrowserService } from '@/lib/browser/service';
import { DEFAULT_LIMITS, type BrowserTaskSpec } from '@/lib/browser/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** A long task keeps running in the background; the route itself returns at once. */
export const maxDuration = 300;

/**
 * Browser agent tasks.
 *
 * GET  /api/browser/tasks   — every task with its live view, plus engine status
 * POST /api/browser/tasks   — { spec } → queue a task and return it immediately
 *
 * The engine block in the response is the truth about this deployment: when no
 * Chromium is reachable, `engine.available` is false with a reason and a fix, and
 * new tasks are stored BLOCKED rather than pretending to run.
 */

export async function GET() {
  const service = getBrowserService();
  try {
    const tasks = await service.listViews();
    const engine = await service.engineStatus();
    return NextResponse.json({
      tasks,
      engine,
      durable: service.durable,
      store: service.storeLocation,
      limits: DEFAULT_LIMITS,
    });
  } catch (error) {
    const failure = BrowserService.toError(error);
    return NextResponse.json({ error: failure.message, ...failure }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const service = getBrowserService();
  let body: { spec?: BrowserTaskSpec };
  try {
    body = (await request.json()) as { spec?: BrowserTaskSpec };
  } catch {
    return NextResponse.json(
      { error: 'invalid JSON body', code: 'invalid-plan', fix: 'Send { spec: { objective, startUrl, profile, plan, successCriteria } }.' },
      { status: 400 },
    );
  }

  if (!body?.spec) {
    return NextResponse.json(
      {
        error: 'no task spec',
        code: 'invalid-plan',
        fix: 'Send { spec: { objective, startUrl, profile, plan, successCriteria } }.',
      },
      { status: 400 },
    );
  }

  try {
    const task = await service.create(body.spec);
    const view = await service.toView(task);
    return NextResponse.json({ task: view }, { status: 201 });
  } catch (error) {
    const failure = BrowserService.toError(error);
    return NextResponse.json({ error: failure.message, ...failure }, { status: 400 });
  }
}
