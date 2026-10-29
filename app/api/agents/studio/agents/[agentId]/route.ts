import { NextRequest, NextResponse } from 'next/server';
import { deleteAgent, getAgent, setAgentState } from '@/lib/agent-studio/store';

export const dynamic = 'force-dynamic';

/** One agent: every configuration version, newest last — the audit trail. */
export async function GET(_request: NextRequest, context: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await context.params;
  const record = await getAgent(agentId);
  if (!record) {
    return NextResponse.json(
      { ok: false, code: 'agent-not-found', message: `No agent "${agentId}".`, fix: 'Pick one from the saved list.' },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, agentId: record.agentId, name: record.name, versions: record.versions });
}

/**
 * Pause / resume / archive. Pausing changes what the studio will let you do with
 * this configuration; it does not claim a running agent stopped, because this
 * deployment has no runtime to stop.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await context.params;
  let body: { action?: string };
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    body = {};
  }

  const action = body.action;
  if (action !== 'pause' && action !== 'resume' && action !== 'archive') {
    return NextResponse.json(
      { ok: false, code: 'unsupported-action', message: `Unknown action "${action}".`, fix: 'Use pause, resume or archive.' },
      { status: 400 },
    );
  }

  const record = await setAgentState(agentId, action === 'resume' ? 'active' : 'draft');
  if (!record) {
    return NextResponse.json(
      { ok: false, code: 'agent-not-found', message: `No agent "${agentId}".`, fix: 'Pick one from the saved list.' },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    agentId,
    state: action === 'resume' ? 'active' : 'draft',
    note:
      action === 'archive'
        ? 'Archived: kept for history, not offered for new runs.'
        : 'This deployment has no connected runtime — the state of the configuration changed, nothing started or stopped.',
  });
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await context.params;
  const removed = await deleteAgent(agentId);
  return NextResponse.json({ ok: removed }, { status: removed ? 200 : 404 });
}
