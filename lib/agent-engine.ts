/**
 * Core Agent Execution Engine with State Machine
 * Manages agent lifecycle, state transitions, and execution
 */

export type AgentState = 'idle' | 'running' | 'paused' | 'error' | 'completed';

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  maxSteps?: number;
  timeout?: number;
  tools?: string[];
  memory?: {
    enabled: boolean;
    maxTokens?: number;
  };
  voiceEnabled?: boolean;
  avatarEnabled?: boolean;
}

export interface AgentExecutionContext {
  agentId: string;
  sessionId: string;
  state: AgentState;
  currentStep: number;
  totalSteps: number;
  startedAt: number;
  updatedAt: number;
  error?: string;
  output?: unknown;
  memoryBindings?: Record<string, unknown>;
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

class AgentEngine {
  private config: AgentConfig;
  private context: AgentExecutionContext;
  private messageHistory: AgentMessage[] = [];
  private stateTransitionCallbacks: Map<AgentState, Function[]> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private lastHeartbeat: number = Date.now();

  constructor(config: AgentConfig) {
    this.config = config;
    this.context = {
      agentId: config.id,
      sessionId: this.generateSessionId(),
      state: 'idle',
      currentStep: 0,
      totalSteps: config.maxSteps || 10,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /**
   * Initialize agent and start health monitoring
   */
  async initialize(): Promise<void> {
    console.log('[v0] Agent initialized:', this.config.id);
    this.startHealthCheck();
  }

  /**
   * Execute agent with input message
   */
  async execute(userMessage: string): Promise<string> {
    try {
      this.setState('running');
      this.addMessage('user', userMessage);

      // Simulate agent thinking with steps
      for (let step = 0; step < (this.config.maxSteps || 5); step++) {
        if (this.context.state === 'paused') {
          break;
        }

        this.context.currentStep = step + 1;
        this.context.updatedAt = Date.now();

        console.log(`[v0] Agent step ${step + 1}/${this.config.maxSteps || 5}`);

        // Simulate processing time
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const response = await this.generateResponse();
      this.addMessage('assistant', response);
      this.setState('completed');

      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.setState('error');
      this.context.error = errorMessage;
      throw error;
    }
  }

  /**
   * Pause agent execution
   */
  pause(): void {
    if (this.context.state === 'running') {
      this.setState('paused');
    }
  }

  /**
   * Resume agent execution
   */
  async resume(): Promise<void> {
    if (this.context.state === 'paused') {
      this.setState('running');
    }
  }

  /**
   * Stop agent and cleanup
   */
  stop(): void {
    this.setState('idle');
    this.stopHealthCheck();
    this.messageHistory = [];
    this.context.currentStep = 0;
  }

  /**
   * Get current execution context
   */
  getContext(): AgentExecutionContext {
    return { ...this.context };
  }

  /**
   * Get conversation history
   */
  getHistory(): AgentMessage[] {
    return [...this.messageHistory];
  }

  /**
   * Add message to history
   */
  private addMessage(role: AgentMessage['role'], content: string): void {
    this.messageHistory.push({
      role,
      content,
      timestamp: Date.now(),
    });
  }

  /**
   * Generate agent response
   */
  private async generateResponse(): Promise<string> {
    // This would normally call the LLM gateway with the agent's system prompt
    return `Response from agent ${this.config.name} processing: ${this.messageHistory[this.messageHistory.length - 1]?.content || 'N/A'}`;
  }

  /**
   * State transition with callbacks
   */
  private setState(newState: AgentState): void {
    const oldState = this.context.state;
    this.context.state = newState;
    this.context.updatedAt = Date.now();

    console.log(`[v0] Agent state transition: ${oldState} -> ${newState}`);

    // Trigger callbacks for new state
    const callbacks = this.stateTransitionCallbacks.get(newState) || [];
    callbacks.forEach((cb) => cb(this.context));
  }

  /**
   * Register state transition callback
   */
  onStateChange(state: AgentState, callback: (context: AgentExecutionContext) => void): void {
    if (!this.stateTransitionCallbacks.has(state)) {
      this.stateTransitionCallbacks.set(state, []);
    }
    this.stateTransitionCallbacks.get(state)!.push(callback);
  }

  /**
   * Health check and heartbeat
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      this.lastHeartbeat = Date.now();
      console.log(`[v0] Agent heartbeat: ${this.config.id}`);

      // Check for timeout
      if (this.config.timeout) {
        const elapsed = Date.now() - this.context.startedAt;
        if (elapsed > this.config.timeout && this.context.state === 'running') {
          console.warn(`[v0] Agent timeout exceeded: ${this.config.id}`);
          this.setState('error');
          this.context.error = 'Execution timeout exceeded';
        }
      }
    }, 30000); // 30s heartbeat
  }

  /**
   * Stop health check
   */
  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Create and manage agent instances
 */
export class AgentEngineFactory {
  private agents: Map<string, AgentEngine> = new Map();

  createAgent(config: AgentConfig): AgentEngine {
    const agent = new AgentEngine(config);
    this.agents.set(config.id, agent);
    return agent;
  }

  getAgent(agentId: string): AgentEngine | undefined {
    return this.agents.get(agentId);
  }

  removeAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.stop();
      this.agents.delete(agentId);
    }
  }

  getAllAgents(): AgentEngine[] {
    return Array.from(this.agents.values());
  }
}

export const agentEngineFactory = new AgentEngineFactory();
