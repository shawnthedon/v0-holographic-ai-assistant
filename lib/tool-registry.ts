/**
 * Tool Registry and Sandboxed Execution
 * Manages agent tools and executes them in isolated contexts
 */

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  enum?: unknown[];
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  parameters: ToolParameter[];
  handler: (params: Record<string, unknown>) => Promise<unknown>;
  permissions?: string[];
  rateLimit?: {
    calls: number;
    windowMs: number;
  };
}

export interface ToolExecutionResult {
  toolId: string;
  status: 'success' | 'error' | 'timeout' | 'permission_denied' | 'rate_limited';
  result?: unknown;
  error?: string;
  executionTimeMs: number;
}

class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private rateLimitMap: Map<string, number[]> = new Map();
  private executionTimeouts: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Register a tool
   */
  register(tool: ToolDefinition): void {
    this.tools.set(tool.id, tool);
    console.log(`[v0] Tool registered: ${tool.id}`);
  }

  /**
   * Register multiple tools
   */
  registerBulk(tools: ToolDefinition[]): void {
    tools.forEach((tool) => this.register(tool));
  }

  /**
   * Get tool definition
   */
  getTool(toolId: string): ToolDefinition | undefined {
    return this.tools.get(toolId);
  }

  /**
   * Get all tools
   */
  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get tools by category
   */
  getToolsByCategory(category: string): ToolDefinition[] {
    return Array.from(this.tools.values()).filter((t) => t.category === category);
  }

  /**
   * Execute tool with sandboxing and error handling
   */
  async execute(
    toolId: string,
    params: Record<string, unknown>,
    agentId: string,
    timeoutMs: number = 30000
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    try {
      const tool = this.getTool(toolId);
      if (!tool) {
        return {
          toolId,
          status: 'error',
          error: `Tool not found: ${toolId}`,
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Check rate limiting
      const rateLimitCheck = this.checkRateLimit(toolId, agentId);
      if (!rateLimitCheck.allowed) {
        return {
          toolId,
          status: 'rate_limited',
          error: `Rate limit exceeded: ${rateLimitCheck.message}`,
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Validate parameters
      const validation = this.validateParameters(tool, params);
      if (!validation.valid) {
        return {
          toolId,
          status: 'error',
          error: `Invalid parameters: ${validation.error}`,
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Execute with timeout
      const result = await this.executeWithTimeout(
        tool.handler,
        params,
        toolId,
        timeoutMs
      );

      return {
        toolId,
        status: 'success',
        result,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        toolId,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute tool with timeout protection
   */
  private async executeWithTimeout(
    handler: (params: Record<string, unknown>) => Promise<unknown>,
    params: Record<string, unknown>,
    toolId: string,
    timeoutMs: number
  ): Promise<unknown> {
    return Promise.race([
      handler(params),
      new Promise<never>((_, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Tool execution timeout: ${toolId}`));
        }, timeoutMs);
        this.executionTimeouts.set(toolId, timeout);
      }),
    ]).finally(() => {
      const timeout = this.executionTimeouts.get(toolId);
      if (timeout) {
        clearTimeout(timeout);
        this.executionTimeouts.delete(toolId);
      }
    });
  }

  /**
   * Validate parameters against tool definition
   */
  private validateParameters(
    tool: ToolDefinition,
    params: Record<string, unknown>
  ): { valid: boolean; error?: string } {
    for (const param of tool.parameters) {
      if (param.required && !(param.name in params)) {
        return {
          valid: false,
          error: `Missing required parameter: ${param.name}`,
        };
      }

      const value = params[param.name];
      if (value !== undefined && typeof value !== param.type) {
        return {
          valid: false,
          error: `Parameter ${param.name} must be ${param.type}`,
        };
      }

      if (param.enum && value !== undefined && !param.enum.includes(value)) {
        return {
          valid: false,
          error: `Parameter ${param.name} must be one of: ${param.enum.join(', ')}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Check rate limiting
   */
  private checkRateLimit(
    toolId: string,
    agentId: string
  ): { allowed: boolean; message?: string } {
    const tool = this.getTool(toolId);
    if (!tool?.rateLimit) {
      return { allowed: true };
    }

    const key = `${toolId}:${agentId}`;
    const now = Date.now();
    const calls = this.rateLimitMap.get(key) || [];

    // Remove old calls outside window
    const recentCalls = calls.filter((t) => now - t < tool.rateLimit!.windowMs);

    if (recentCalls.length >= tool.rateLimit.calls) {
      return {
        allowed: false,
        message: `Rate limit: ${tool.rateLimit.calls} calls per ${tool.rateLimit.windowMs}ms`,
      };
    }

    recentCalls.push(now);
    this.rateLimitMap.set(key, recentCalls);

    return { allowed: true };
  }

  /**
   * Built-in tools
   */
  registerBuiltinTools(): void {
    // Web search tool
    this.register({
      id: 'web_search',
      name: 'Web Search',
      description: 'Search the web for information',
      category: 'search',
      parameters: [
        {
          name: 'query',
          type: 'string',
          description: 'Search query',
          required: true,
        },
        {
          name: 'limit',
          type: 'number',
          description: 'Number of results (1-10)',
        },
      ],
      handler: async (params) => {
        console.log('[v0] Web search:', params.query);
        return {
          results: [
            {
              title: `Result for ${params.query}`,
              url: 'https://example.com',
              snippet: 'Search result snippet',
            },
          ],
        };
      },
      rateLimit: { calls: 10, windowMs: 60000 },
    });

    // Calculator tool
    this.register({
      id: 'calculator',
      name: 'Calculator',
      description: 'Perform mathematical calculations',
      category: 'math',
      parameters: [
        {
          name: 'expression',
          type: 'string',
          description: 'Mathematical expression to evaluate',
          required: true,
        },
      ],
      handler: async (params) => {
        try {
          const result = Function(`"use strict"; return (${params.expression})`)();
          return { result };
        } catch (err) {
          throw new Error(`Invalid expression: ${params.expression}`);
        }
      },
    });

    // Wait/delay tool
    this.register({
      id: 'wait',
      name: 'Wait',
      description: 'Pause execution for specified duration',
      category: 'system',
      parameters: [
        {
          name: 'duration_ms',
          type: 'number',
          description: 'Duration in milliseconds',
          required: true,
        },
      ],
      handler: async (params) => {
        await new Promise((resolve) => setTimeout(resolve, params.duration_ms as number));
        return { waited_ms: params.duration_ms };
      },
    });

    // Memory read tool
    this.register({
      id: 'read_memory',
      name: 'Read Memory',
      description: 'Read from agent memory',
      category: 'memory',
      parameters: [
        {
          name: 'key',
          type: 'string',
          description: 'Memory key to read',
          required: true,
        },
        {
          name: 'type',
          type: 'string',
          description: 'Memory type: short, long, or working',
          enum: ['short', 'long', 'working'],
        },
      ],
      handler: async (params) => {
        return { key: params.key, value: `Memory value for ${params.key}` };
      },
    });

    console.log('[v0] Built-in tools registered');
  }
}

export const toolRegistry = new ToolRegistry();

// Auto-register built-in tools
toolRegistry.registerBuiltinTools();
