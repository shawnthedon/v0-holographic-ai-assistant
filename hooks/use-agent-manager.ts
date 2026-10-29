/**
 * React Hook for Agent Management
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { AgentConfig, AgentExecutionContext } from '@/lib/agent-engine';

export interface AgentState extends AgentConfig {
  status: 'idle' | 'running' | 'paused' | 'error';
  executionContext?: AgentExecutionContext;
}

export function useAgentManager() {
  const [agents, setAgents] = useState<Map<string, AgentState>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Create new agent
   */
  const createAgent = useCallback(async (config: AgentConfig) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        throw new Error('Failed to create agent');
      }

      const agent = await response.json();
      setAgents((prev) => new Map(prev).set(agent.id, agent));
      return agent;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Load all agents
   */
  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/agents');
      if (!response.ok) {
        throw new Error('Failed to load agents');
      }

      const agentList = await response.json();
      const agentMap = new Map<string, AgentState>(
        (agentList as AgentState[]).map((agent) => [agent.id, agent] as const),
      );
      setAgents(agentMap);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Delete agent
   */
  const deleteAgent = useCallback(async (agentId: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/agents/${agentId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete agent');
      }

      setAgents((prev) => {
        const next = new Map(prev);
        next.delete(agentId);
        return next;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Execute agent
   */
  const executeAgent = useCallback(
    async (agentId: string, userMessage: string) => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/agents/${agentId}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: userMessage }),
        });

        if (!response.ok) {
          throw new Error('Failed to execute agent');
        }

        const result = await response.json();
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  /**
   * Pause agent
   */
  const pauseAgent = useCallback(async (agentId: string) => {
    try {
      const response = await fetch(`/api/agents/${agentId}/pause`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to pause agent');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    }
  }, []);

  /**
   * Resume agent
   */
  const resumeAgent = useCallback(async (agentId: string) => {
    try {
      const response = await fetch(`/api/agents/${agentId}/resume`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to resume agent');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    }
  }, []);

  // Load agents on mount
  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  return {
    agents: Array.from(agents.values()),
    loading,
    error,
    createAgent,
    loadAgents,
    deleteAgent,
    executeAgent,
    pauseAgent,
    resumeAgent,
  };
}
