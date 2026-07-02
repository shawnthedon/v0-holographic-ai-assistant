'use client';

import React, { useState } from 'react';
import { Plus, Trash2, Play, Pause, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgentManager } from '@/hooks/use-agent-manager';
import { AgentConfig } from '@/lib/agent-engine';

interface CreationStep {
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  tools: string[];
  voiceEnabled: boolean;
  avatarEnabled: boolean;
}

export function AgentHub() {
  const { agents, loading, error, createAgent, deleteAgent, executeAgent } = useAgentManager();
  const [isCreating, setIsCreating] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [creationStep, setCreationStep] = useState<Partial<CreationStep>>({});

  const handleCreateAgent = async () => {
    if (!creationStep.name || !creationStep.systemPrompt) {
      return;
    }

    const config: AgentConfig = {
      id: `agent_${Date.now()}`,
      name: creationStep.name,
      description: creationStep.description || '',
      systemPrompt: creationStep.systemPrompt,
      model: creationStep.model || 'gpt-4o',
      tools: creationStep.tools || [],
      voiceEnabled: creationStep.voiceEnabled || false,
      avatarEnabled: creationStep.avatarEnabled || false,
    };

    try {
      await createAgent(config);
      setIsCreating(false);
      setCreationStep({});
    } catch (err) {
      console.error('[v0] Failed to create agent:', err);
    }
  };

  const handleExecuteAgent = async () => {
    if (!selectedAgent || !input) return;

    try {
      const result = await executeAgent(selectedAgent, input);
      setOutput(result.response || '');
      setInput('');
    } catch (err) {
      console.error('[v0] Failed to execute agent:', err);
    }
  };

  return (
    <div className="w-full h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 rounded-lg border border-cyan-400/20 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-cyan-400/20">
        <div>
          <h2 className="text-2xl font-bold text-white font-mono">Agent Hub</h2>
          <p className="text-xs text-gray-400 mt-1">Create and manage AI agents</p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-400/20 border border-cyan-400/50 text-cyan-300 rounded-lg hover:bg-cyan-400/30 transition-colors"
        >
          <Plus size={16} />
          New Agent
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-2 gap-6 p-6 overflow-hidden">
        {/* Agent List */}
        <div className="flex flex-col gap-4 overflow-y-auto">
          <div className="text-sm font-mono text-cyan-400 mb-2">Active Agents</div>
          {agents.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              No agents created yet. Create one to get started.
            </div>
          ) : (
            agents.map((agent) => (
              <motion.div
                key={agent.id}
                className={`p-4 rounded-lg border transition-all cursor-pointer ${
                  selectedAgent === agent.id
                    ? 'bg-cyan-400/10 border-cyan-400/50'
                    : 'bg-slate-800/50 border-slate-700/50 hover:border-cyan-400/30'
                }`}
                onClick={() => setSelectedAgent(agent.id)}
                whileHover={{ scale: 1.02 }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-mono text-sm text-white font-semibold">{agent.name}</p>
                    <p className="text-xs text-gray-400 mt-1">{agent.description}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteAgent(agent.id);
                      }}
                      className="p-1 text-red-400 hover:bg-red-400/10 rounded"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="text-xs text-gray-500 space-y-1">
                  <p>Model: {agent.model}</p>
                  <p>Tools: {agent.tools?.length || 0}</p>
                  <div className="flex gap-2 mt-2">
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
            ))
          )}
        </div>

        {/* Agent Execution Panel */}
        <div className="flex flex-col gap-4">
          {selectedAgent ? (
            <>
              <div className="text-sm font-mono text-cyan-400 mb-2">Execute Agent</div>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Enter your message for the agent..."
                className="flex-1 p-3 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm resize-none focus:border-cyan-400/50 focus:outline-none"
              />
              <button
                onClick={handleExecuteAgent}
                disabled={loading || !input}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-cyan-400/20 border border-cyan-400/50 text-cyan-300 rounded-lg hover:bg-cyan-400/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Play size={16} />
                Execute
              </button>

              {output && (
                <div className="bg-slate-800/50 border border-slate-600 rounded-lg p-3">
                  <p className="text-xs font-mono text-gray-400 mb-2">Output:</p>
                  <p className="text-sm text-gray-200">{output}</p>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              Select an agent to execute
            </div>
          )}
        </div>
      </div>

      {/* Creation Modal */}
      <AnimatePresence>
        {isCreating && (
          <motion.div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() => setIsCreating(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-slate-900 border border-cyan-400/30 rounded-lg p-6 max-w-md w-full mx-4"
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
            >
              <h3 className="text-lg font-mono text-white mb-4">Create New Agent</h3>

              <div className="space-y-4">
                {/* Name */}
                <div>
                  <label className="block text-xs font-mono text-cyan-400 mb-2">Agent Name</label>
                  <input
                    type="text"
                    value={creationStep.name || ''}
                    onChange={(e) =>
                      setCreationStep((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder="e.g., Research Assistant"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:border-cyan-400/50 focus:outline-none"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-mono text-cyan-400 mb-2">
                    Description
                  </label>
                  <input
                    type="text"
                    value={creationStep.description || ''}
                    onChange={(e) =>
                      setCreationStep((prev) => ({ ...prev, description: e.target.value }))
                    }
                    placeholder="What does this agent do?"
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:border-cyan-400/50 focus:outline-none"
                  />
                </div>

                {/* System Prompt */}
                <div>
                  <label className="block text-xs font-mono text-cyan-400 mb-2">
                    System Prompt
                  </label>
                  <textarea
                    value={creationStep.systemPrompt || ''}
                    onChange={(e) =>
                      setCreationStep((prev) => ({ ...prev, systemPrompt: e.target.value }))
                    }
                    placeholder="Define the agent's behavior and personality..."
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm resize-none h-24 focus:border-cyan-400/50 focus:outline-none"
                  />
                </div>

                {/* Model Selection */}
                <div>
                  <label className="block text-xs font-mono text-cyan-400 mb-2">Model</label>
                  <select
                    value={creationStep.model || 'gpt-4o'}
                    onChange={(e) =>
                      setCreationStep((prev) => ({ ...prev, model: e.target.value }))
                    }
                    className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:border-cyan-400/50 focus:outline-none"
                  >
                    <option value="gpt-4o">GPT-4O</option>
                    <option value="gpt-4-turbo">GPT-4 Turbo</option>
                    <option value="claude-3-opus">Claude 3 Opus</option>
                    <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                  </select>
                </div>

                {/* Options */}
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={creationStep.voiceEnabled || false}
                      onChange={(e) =>
                        setCreationStep((prev) => ({
                          ...prev,
                          voiceEnabled: e.target.checked,
                        }))
                      }
                      className="w-4 h-4"
                    />
                    <span className="text-xs text-gray-300">Enable voice output</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={creationStep.avatarEnabled || false}
                      onChange={(e) =>
                        setCreationStep((prev) => ({
                          ...prev,
                          avatarEnabled: e.target.checked,
                        }))
                      }
                      className="w-4 h-4"
                    />
                    <span className="text-xs text-gray-300">Enable avatar animation</span>
                  </label>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setIsCreating(false)}
                    className="flex-1 px-4 py-2 bg-slate-700 text-gray-300 rounded hover:bg-slate-600 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateAgent}
                    disabled={loading || !creationStep.name || !creationStep.systemPrompt}
                    className="flex-1 px-4 py-2 bg-cyan-400/20 border border-cyan-400/50 text-cyan-300 rounded hover:bg-cyan-400/30 disabled:opacity-50 transition-colors"
                  >
                    Create Agent
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Display */}
      {error && (
        <motion.div
          className="mx-6 mb-4 p-3 bg-red-400/10 border border-red-400/30 rounded text-red-300 text-sm"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {error}
        </motion.div>
      )}
    </div>
  );
}
