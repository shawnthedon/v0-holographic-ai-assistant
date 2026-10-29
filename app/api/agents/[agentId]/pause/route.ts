import { NextRequest, NextResponse } from 'next/server';
import { agentEngineFactory } from '@/lib/agent-engine';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;

    const agent = agentEngineFactory.getAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    agent.pause();

    return NextResponse.json({
      success: true,
      context: agent.getContext(),
    });
  } catch (error) {
    console.error('[v0] Agent pause error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to pause agent' },
      { status: 500 }
    );
  }
}
