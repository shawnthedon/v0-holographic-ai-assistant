import { NextRequest, NextResponse } from 'next/server';
import { agentEngineFactory } from '@/lib/agent-engine';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { agentId: string } }
) {
  try {
    const { agentId } = params;

    const agent = agentEngineFactory.getAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    agentEngineFactory.removeAgent(agentId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[v0] Agent deletion error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete agent' },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { agentId: string } }
) {
  try {
    const { agentId } = params;

    const agent = agentEngineFactory.getAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const context = agent.getContext();

    return NextResponse.json({
      id: agentId,
      context,
      history: agent.getHistory(),
    });
  } catch (error) {
    console.error('[v0] Failed to get agent:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get agent' },
      { status: 500 }
    );
  }
}
