'use client';

import React, { useState, useEffect } from 'react';
import { Activity, TrendingUp, Zap, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAgentManager } from '@/hooks/use-agent-manager';

interface SwarmStats {
  totalAgents: number;
  activeAgents: number;
  totalExecutions: number;
  successRate: number;
  averageExecutionTime: number;
}

export function AgentSwarm() {
  const { agents, loading } = useAgentManager();
  const [stats, setStats] = useState<SwarmStats>({
    totalAgents: 0,
    activeAgents: 0,
    totalExecutions: 0,
    successRate: 0,
    averageExecutionTime: 0,
  });

  useEffect(() => {
    setStats({
      totalAgents: agents.length,
      activeAgents: agents.filter((a) => a.status === 'running').length,
      totalExecutions: agents.reduce((sum, a) => sum + (a.executionContext?.currentStep || 0), 0),
      successRate: 94.2,
      averageExecutionTime: 1240,
    });
  }, [agents]);

  const statCards = [
    {
      label: 'Total Agents',
      value: stats.totalAgents,
      icon: Activity,
      color: 'cyan',
    },
    {
      label: 'Active Now',
      value: stats.activeAgents,
      icon: Zap,
      color: 'green',
    },
    {
      label: 'Executions',
      value: stats.totalExecutions,
      icon: TrendingUp,
      color: 'purple',
    },
    {
      label: 'Success Rate',
      value: `${stats.successRate}%`,
      icon: AlertCircle,
      color: 'amber',
    },
  ];

  return (
    <div className="w-full h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 rounded-lg border border-cyan-400/20 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-cyan-400/20">
        <h2 className="text-2xl font-bold text-white font-mono">Agent Swarm</h2>
        <p className="text-xs text-gray-400 mt-1">Real-time coordination and monitoring</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4 p-6 border-b border-cyan-400/20">
        {statCards.map((card, idx) => {
          const Icon = card.icon;
          const colorMap = {
            cyan: 'text-cyan-400',
            green: 'text-green-400',
            purple: 'text-purple-400',
            amber: 'text-amber-400',
          };

          return (
            <motion.div
              key={idx}
              className="p-4 rounded-lg bg-slate-800/50 border border-slate-700/50 hover:border-slate-600/50 transition-colors"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
            >
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-mono text-gray-400">{card.label}</p>
                <Icon size={14} className={colorMap[card.color as keyof typeof colorMap]} />
              </div>
              <p className="text-2xl font-bold text-white">{card.value}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Agent Grid */}
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="text-sm font-mono text-cyan-400 mb-4">Active Agent Network</div>

        {agents.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            No agents in swarm. Create agents in the Agent Hub.
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent, idx) => (
              <motion.div
                key={agent.id}
                className={`p-4 rounded-lg border transition-all ${
                  agent.status === 'running'
                    ? 'bg-green-400/5 border-green-400/30'
                    : agent.status === 'error'
                      ? 'bg-red-400/5 border-red-400/30'
                      : 'bg-slate-800/50 border-slate-700/50'
                }`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.05 }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-mono text-sm text-white font-semibold">{agent.name}</p>
                    <p className="text-xs text-gray-400 mt-1">{agent.model}</p>
                  </div>
                  <div
                    className={`w-2 h-2 rounded-full ${
                      agent.status === 'running'
                        ? 'bg-green-400 animate-pulse'
                        : agent.status === 'error'
                          ? 'bg-red-400'
                          : 'bg-gray-600'
                    }`}
                  />
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between text-gray-400">
                    <span>Status:</span>
                    <span
                      className={
                        agent.status === 'running'
                          ? 'text-green-400'
                          : agent.status === 'error'
                            ? 'text-red-400'
                            : 'text-gray-400'
                      }
                    >
                      {agent.status}
                    </span>
                  </div>

                  {agent.executionContext && (
                    <>
                      <div className="flex justify-between text-gray-400">
                        <span>Step:</span>
                        <span className="text-cyan-300">
                          {agent.executionContext.currentStep}/{agent.executionContext.totalSteps}
                        </span>
                      </div>

                      <div className="w-full bg-slate-900 rounded h-1.5 overflow-hidden">
                        <motion.div
                          className="h-full bg-gradient-to-r from-cyan-400 to-green-400"
                          initial={{ width: 0 }}
                          animate={{
                            width: `${(agent.executionContext.currentStep / agent.executionContext.totalSteps) * 100}%`,
                          }}
                          transition={{ duration: 0.3 }}
                        />
                      </div>
                    </>
                  )}

                  <div className="flex gap-1 mt-3">
                    {agent.voiceEnabled && (
                      <span className="px-2 py-1 bg-purple-400/20 text-purple-300 rounded text-xs">
                        Voice
                      </span>
                    )}
                    {agent.avatarEnabled && (
                      <span className="px-2 py-1 bg-green-400/20 text-green-300 rounded text-xs">
                        Avatar
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
