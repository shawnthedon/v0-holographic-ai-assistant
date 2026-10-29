import { NextRequest, NextResponse } from 'next/server';

import { BrowserService, getBrowserService } from '@/lib/browser/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * One browser task.
 *
 * GET  /api/browser/tasks/:id             — live view (state, progress, timeline)
 * POST /api/browser/tasks/:id             — { action: 'pause' | 'resume' | 'cancel' | 'inspect' }
 *
 * Every response carries the task even when an action fails, so the panel can
 * show what actually happened instead of a bare HTTP error.
 */

const ACTIONS = ['pause', 'resume', 'cancel', 'inspect'] as const;
type Action = (typeof ACTIONS)[number];

export async function GET(_request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const service = getBrowserService();
  const view = await service.view(taskId);
  if (!view) {
    return NextResponse.json(
      { error: 'task not found', code: 'task-not-found', fix: 'Reload the task list — the task may have been removed.' },
      { status: 404 },
    );
  }
  return NextResponse.json({ task: view });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const service = getBrowserService();

  let action: Action | undefined;
  try {
    const body = (await request.json()) as { action?: Action };
    action = body?.action;
  } catch {
    /* handled below */
  }

  if (!action || !ACTIONS.includes(action)) {
    return NextResponse.json(
      {
        error: 'unknown action',
        code: 'unsupported',
        fix: `Send { action: ${ACTIONS.map((value) => `'${value}'`).join(' | ')} }.`,
      },
      { status: 400 },
    );
  }

  try {
    if (action === 'pause') await service.pause(taskId);
    if (action === 'resume') await service.resume(taskId);
    if (action === 'cancel') await service.cancel(taskId);
    if (action === 'inspect') await service.inspect(taskId);

    const view = await service.view(taskId);
    if (!view) {
      return NextResponse.json(
        { error: 'task not found', code: 'task-not-found', fix: 'Reload the task list.' },
        { status: 404 },
      );
    }
    return NextResponse.json({ task: view, action });
  } catch (error) {
    const failure = BrowserService.toError(error);
    return NextResponse.json({ error: failure.message, ...failure }, { status: 500 });
  }
}
