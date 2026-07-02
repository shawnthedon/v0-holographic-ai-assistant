import { NextRequest, NextResponse } from 'next/server';
import { agentEngineFactory, AgentConfig } from '@/lib/agent-engine';

// In-memory storage (replace with database for production)
const agentStorage: Map<string, AgentConfig> = new Map();

export async function POST(request: NextRequest) {
  try {
    const config: AgentConfig = await request.json();

    // Validate required fields
    if (!config.name || !config.systemPrompt) {
      return NextResponse.json(
        { error: 'Missing required fields: name, systemPrompt' },
        { status: 400 }
      );
    }

    // Store agent config
    agentStorage.set(config.id, config);

    // Create engine instance
    const agent = agentEngineFactory.createAgent(config);
    await agent.initialize();

    return NextResponse.json({
      id: config.id,
      name: config.name,
      description: config.description,
      model: config.model,
      tools: config.tools,
      voiceEnabled: config.voiceEnabled,
      avatarEnabled: config.avatarEnabled,
      status: 'idle',
    });
  } catch (error) {
    console.error('[v0] Agent creation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create agent' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const agents = Array.from(agentStorage.values()).map((config) => ({
      id: config.id,
      name: config.name,
      description: config.description,
      model: config.model,
      tools: config.tools,
      voiceEnabled: config.voiceEnabled,
      avatarEnabled: config.avatarEnabled,
      status: 'idle',
    }));

    return NextResponse.json(agents);
  } catch (error) {
    console.error('[v0] Failed to list agents:', error);
    return NextResponse.json({ error: 'Failed to list agents' }, { status: 500 });
  }
}
