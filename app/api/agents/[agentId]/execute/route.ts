import { NextRequest, NextResponse } from 'next/server';
import { agentEngineFactory } from '@/lib/agent-engine';

interface ExecuteRequest {
  message: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { agentId: string } }
) {
  try {
    const { agentId } = params;
    const { message }: ExecuteRequest = await request.json();

    if (!message) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const agent = agentEngineFactory.getAgent(agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const response = await agent.execute(message);

    return NextResponse.json({
      response,
      context: agent.getContext(),
    });
  } catch (error) {
    console.error('[v0] Agent execution error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to execute agent' },
      { status: 500 }
    );
  }
}
