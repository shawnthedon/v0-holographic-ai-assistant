/**
 * Agent Memory Management System
 * Handles persistent memory, context, and state across sessions
 */

export interface MemoryEntry {
  id: string;
  key: string;
  value: unknown;
  timestamp: number;
  ttl?: number; // Time-to-live in milliseconds
  agentId: string;
}

export interface MemoryContext {
  shortTerm: Map<string, MemoryEntry>; // Current session
  longTerm: Map<string, MemoryEntry>; // Persistent across sessions
  workingMemory: Map<string, unknown>; // Transient during execution
}

class MemoryManager {
  private memories: Map<string, MemoryContext> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupTask();
  }

  /**
   * Get or create memory context for agent
   */
  getContext(agentId: string): MemoryContext {
    if (!this.memories.has(agentId)) {
      this.memories.set(agentId, {
        shortTerm: new Map(),
        longTerm: new Map(),
        workingMemory: new Map(),
      });
    }
    return this.memories.get(agentId)!;
  }

  /**
   * Store short-term memory (session-scoped)
   */
  setShortTerm(agentId: string, key: string, value: unknown, ttl?: number): void {
    const context = this.getContext(agentId);
    const entry: MemoryEntry = {
      id: `st_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      key,
      value,
      timestamp: Date.now(),
      ttl,
      agentId,
    };
    context.shortTerm.set(key, entry);
  }

  /**
   * Get short-term memory
   */
  getShortTerm(agentId: string, key: string): unknown {
    const context = this.getContext(agentId);
    const entry = context.shortTerm.get(key);

    if (!entry) return undefined;

    // Check TTL
    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      context.shortTerm.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Store long-term memory (persistent)
   */
  setLongTerm(agentId: string, key: string, value: unknown): void {
    const context = this.getContext(agentId);
    const entry: MemoryEntry = {
      id: `lt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      key,
      value,
      timestamp: Date.now(),
      agentId,
    };
    context.longTerm.set(key, entry);
  }

  /**
   * Get long-term memory
   */
  getLongTerm(agentId: string, key: string): unknown {
    const context = this.getContext(agentId);
    return context.longTerm.get(key)?.value;
  }

  /**
   * Set working memory (transient during execution)
   */
  setWorking(agentId: string, key: string, value: unknown): void {
    const context = this.getContext(agentId);
    context.workingMemory.set(key, value);
  }

  /**
   * Get working memory
   */
  getWorking(agentId: string, key: string): unknown {
    const context = this.getContext(agentId);
    return context.workingMemory.get(key);
  }

  /**
   * Clear working memory (per execution)
   */
  clearWorking(agentId: string): void {
    const context = this.getContext(agentId);
    context.workingMemory.clear();
  }

  /**
   * Get all memories for agent (for context injection)
   */
  getAllMemories(agentId: string): Record<string, unknown> {
    const context = this.getContext(agentId);
    const memories: Record<string, unknown> = {};

    context.longTerm.forEach((entry) => {
      memories[`long_${entry.key}`] = entry.value;
    });

    context.shortTerm.forEach((entry) => {
      memories[`short_${entry.key}`] = entry.value;
    });

    return memories;
  }

  /**
   * Clear specific memory entry
   */
  forget(agentId: string, key: string, type: 'short' | 'long' = 'short'): void {
    const context = this.getContext(agentId);
    if (type === 'short') {
      context.shortTerm.delete(key);
    } else {
      context.longTerm.delete(key);
    }
  }

  /**
   * Clear all memories for agent
   */
  clearAgent(agentId: string): void {
    this.memories.delete(agentId);
  }

  /**
   * Clean up expired TTL entries
   */
  private startCleanupTask(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      this.memories.forEach((context) => {
        Array.from(context.shortTerm.entries()).forEach(([key, entry]) => {
          if (entry.ttl && now - entry.timestamp > entry.ttl) {
            context.shortTerm.delete(key);
          }
        });
      });
    }, 60000); // Run every minute
  }

  /**
   * Stop cleanup task
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

export const memoryManager = new MemoryManager();
