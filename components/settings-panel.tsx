'use client';

import React from "react"

import { useState } from 'react';
import { X, Upload } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { GatewayConfig } from './gateway-config';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  llmModel?: string;
  onLlmModelChange?: (model: string) => void;
  voiceProvider?: string;
  onVoiceProviderChange?: (provider: string) => void;
  speechSpeed?: number;
  onSpeechSpeedChange?: (speed: number) => void;
  customEndpoint?: string;
  onCustomEndpointChange?: (endpoint: string) => void;
  onVoicePromptChange?: (voiceBlob: Blob | null) => void;
  onRolePromptChange?: (roleText: string) => void;
}

interface UploadedFile {
  name: string;
  size: number;
  uploadedAt: string;
  status: 'uploading' | 'processing' | 'complete' | 'error';
}

export function SettingsPanel({
  isOpen,
  onClose,
  llmModel: externalLlmModel,
  onLlmModelChange,
  voiceProvider: externalVoiceProvider,
  onVoiceProviderChange,
  speechSpeed: externalSpeechSpeed,
  onSpeechSpeedChange,
  customEndpoint: externalCustomEndpoint,
  onCustomEndpointChange,
  onVoicePromptChange,
  onRolePromptChange,
}: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'gateway' | 'agents' | 'skills' | 'knowledge'>('general');
  const [llmModel, setLlmModel] = useState(externalLlmModel || 'gemini-2.0-flash');
  const [voiceProvider, setVoiceProvider] = useState(externalVoiceProvider || 'google');
  const [speechSpeed, setSpeechSpeed] = useState(externalSpeechSpeed || 1);
  const [customEndpoint, setCustomEndpoint] = useState(externalCustomEndpoint || '');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [rolePrompt, setRolePrompt] = useState('');
  const [voicePromptFile, setVoicePromptFile] = useState<File | null>(null);

  // Update parent state when settings change
  const handleLlmModelChange = (value: string) => {
    setLlmModel(value);
    onLlmModelChange?.(value);
  };

  const handleVoiceProviderChange = (value: string) => {
    setVoiceProvider(value);
    onVoiceProviderChange?.(value);
  };

  const handleSpeechSpeedChange = (value: number) => {
    setSpeechSpeed(value);
    onSpeechSpeedChange?.(value);
  };

  const handleCustomEndpointChange = (value: string) => {
    setCustomEndpoint(value);
    onCustomEndpointChange?.(value);
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setIsUploading(true);
    const formData = new FormData();

    // Add files to form data and track them
    const newFiles: UploadedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      formData.append('files', file);
      newFiles.push({
        name: file.name,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        status: 'uploading',
      });
    }

    // Update UI with uploading status
    setUploadedFiles((prev) => [...prev, ...newFiles]);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        console.log('[v0] Files uploaded successfully:', data);

        // Update file statuses to processing
        setUploadedFiles((prev) =>
          prev.map((file) =>
            newFiles.some((f) => f.name === file.name)
              ? { ...file, status: 'processing' }
              : file
          )
        );

        // After a delay, mark as complete
        setTimeout(() => {
          setUploadedFiles((prev) =>
            prev.map((file) =>
              newFiles.some((f) => f.name === file.name)
                ? { ...file, status: 'complete' }
                : file
            )
          );
        }, 2000);
      } else {
        const error = await response.json();
        console.error('[v0] Upload failed:', error);

        // Mark as error
        setUploadedFiles((prev) =>
          prev.map((file) =>
            newFiles.some((f) => f.name === file.name)
              ? { ...file, status: 'error' }
              : file
          )
        );
      }
    } catch (error) {
      console.error('[v0] Upload error:', error);
      setUploadedFiles((prev) =>
        prev.map((file) =>
          newFiles.some((f) => f.name === file.name)
            ? { ...file, status: 'error' }
            : file
        )
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileUpload(e.dataTransfer.files);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            className="hud-sheet hud-scroll fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-[color:var(--hud-line-strong)]"
            initial={{ x: 400 }}
            animate={{ x: 0 }}
            exit={{ x: 400 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          >
            {/* Header */}
            <div className="sticky top-0 border-b border-[color:var(--hud-line)] bg-[#02090d]/95 backdrop-blur">
              <div className="flex items-center justify-between border-b border-[color:var(--hud-line)] px-5 py-4">
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[6.5px] uppercase tracking-[0.34em] text-[color:var(--hud-ink-dim)]">
                    nexus // configuration
                  </span>
                  <h2 className="font-mono text-[11px] uppercase tracking-[0.28em] text-[color:var(--hud-ink)]">
                    advanced settings
                  </h2>
                </div>
                <button
                  onClick={onClose}
                  className="flex h-7 w-7 items-center justify-center rounded border border-[color:var(--hud-line)] text-[color:var(--hud-ink-dim)] transition-colors duration-150 hover:border-[color:var(--hud-ink)]/60 hover:text-[color:var(--hud-ink)] active:scale-95"
                  aria-label="Close settings"
                >
                  <X size={14} />
                </button>
              </div>
              
              {/* Tab Navigation */}
              <div className="flex gap-0 overflow-x-auto px-3 pb-0">
                {[
                  { id: 'general' as const, label: 'General' },
                  { id: 'gateway' as const, label: 'LLM Gateway' },
                  { id: 'agents' as const, label: 'Agents' },
                  { id: 'skills' as const, label: 'Skills' },
                  { id: 'knowledge' as const, label: 'Knowledge Base' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`whitespace-nowrap border-b px-3 py-2.5 font-mono text-[8px] uppercase tracking-[0.24em] transition-colors duration-150 ${
                      activeTab === tab.id
                        ? 'border-[color:var(--hud-lime)] text-[color:var(--hud-lime)]'
                        : 'border-transparent text-[color:var(--hud-ink-dim)] hover:text-[color:var(--hud-ink)]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="p-6 space-y-8">
              {/* General Tab */}
              {activeTab === 'general' && (
                <>
                  {/* LLM Selection */}
              <div>
                <label className="block text-sm font-mono text-cyan-400 mb-3">
                  LLM Model
                </label>
                <div className="space-y-2">
                  {[
                    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
                    { value: 'gpt-4o', label: 'GPT-4o' },
                    { value: 'custom', label: 'Custom OpenAI-Compatible' },
                  ].map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-3 p-3 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-400/50 cursor-pointer transition-colors"
                    >
                      <input
                        type="radio"
                        name="llm"
                        value={option.value}
                        checked={llmModel === option.value}
                        onChange={(e) => handleLlmModelChange(e.target.value)}
                        className="w-4 h-4 accent-cyan-400"
                      />
                      <span className="text-sm text-gray-300">{option.label}</span>
                    </label>
                  ))}
                </div>

                {llmModel === 'custom' && (
                  <motion.div
                    className="mt-3 p-3 rounded-lg bg-slate-900 border border-slate-700"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <input
                      type="text"
                      placeholder="https://api.example.com/v1"
                      value={customEndpoint}
                      onChange={(e) => handleCustomEndpointChange(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400/50"
                    />
                  </motion.div>
                )}
              </div>

              {/* Voice Settings */}
              <div>
                <label className="block text-sm font-mono text-cyan-400 mb-3">
                  Voice Provider
                </label>
                <div className="space-y-2">
                  {[
                    { value: 'google', label: 'Google TTS' },
                    { value: 'elevenlabs', label: 'ElevenLabs' },
                  ].map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-3 p-3 rounded-lg bg-slate-900 border border-slate-700 hover:border-cyan-400/50 cursor-pointer transition-colors"
                    >
                      <input
                        type="radio"
                        name="voice"
                        value={option.value}
                        checked={voiceProvider === option.value}
                        onChange={(e) => handleVoiceProviderChange(e.target.value)}
                        className="w-4 h-4 accent-cyan-400"
                      />
                      <span className="text-sm text-gray-300">{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Speech Speed Control */}
              <div>
                <label className="block text-sm font-mono text-cyan-400 mb-3">
                  Speech Speed: {speechSpeed.toFixed(1)}x
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.1"
                  value={speechSpeed}
                  onChange={(e) => handleSpeechSpeedChange(parseFloat(e.target.value))}
                  className="w-full accent-cyan-400"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-2">
                  <span>0.5x</span>
                  <span>2.0x</span>
                </div>
              </div>

              {/* PersonaPlex Voice Cloning */}
              <div>
                <label className="block text-sm font-mono text-cyan-400 mb-3">
                  Voice Prompt (Cloning)
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Upload a 3-second audio clip to clone your voice for PersonaPlex
                </p>
                <div
                  onDragOver={() => setIsDragging(true)}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    const files = e.dataTransfer.files;
                    if (files.length > 0) {
                      const audioFile = files[0];
                      if (audioFile.type.startsWith('audio/')) {
                        setVoicePromptFile(audioFile);
                        onVoicePromptChange?.(audioFile);
                        console.log('[v0] Voice prompt set:', audioFile.name);
                      }
                    }
                  }}
                  className={`p-4 rounded-lg border-2 border-dashed transition-colors ${
                    isDragging
                      ? 'bg-cyan-400/10 border-cyan-400'
                      : 'bg-slate-900 border-slate-700 hover:border-cyan-400/50'
                  }`}
                >
                  <div className="flex flex-col items-center gap-2 text-center">
                    <Upload size={16} className="text-cyan-400" />
                    <p className="text-xs text-gray-300">Drag audio or click to browse</p>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setVoicePromptFile(file);
                          onVoicePromptChange?.(file);
                        }
                      }}
                      className="hidden"
                      id="voice-prompt-input"
                    />
                    <label
                      htmlFor="voice-prompt-input"
                      className="text-xs font-mono bg-cyan-400/10 text-cyan-400 px-2 py-1 rounded border border-cyan-400/30 hover:bg-cyan-400/20 cursor-pointer transition-colors"
                    >
                      Choose File
                    </label>
                  </div>
                </div>
                {voicePromptFile && (
                  <p className="text-xs text-green-400 mt-2">
                    ✓ Voice prompt loaded: {voicePromptFile.name}
                  </p>
                )}
              </div>

              {/* PersonaPlex Role Prompt */}
              <div>
                <label className="block text-sm font-mono text-cyan-400 mb-3">
                  Role Prompt (Conditioning)
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Define the character's background and personality
                </p>
                <textarea
                  value={rolePrompt}
                  onChange={(e) => {
                    setRolePrompt(e.target.value);
                    onRolePromptChange?.(e.target.value);
                  }}
                  placeholder="e.g., You are a friendly AI assistant with a curious personality who asks thoughtful questions..."
                  className="w-full px-3 py-2 text-xs bg-slate-800 border border-slate-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-cyan-400/50 resize-none h-24"
                />
              </div>
                </>
              )}

              {/* Gateway Tab */}
              {activeTab === 'gateway' && (
                <div className="space-y-6 pb-6">
                  <p className="text-sm text-gray-400">
                    Configure unified LLM gateway access. Supports 500+ models from OpenRouter, Hugging Face, AWS Bedrock, and more.
                  </p>
                  <GatewayConfig onConfigChange={(provider, model) => {
                    console.log('[v0] Gateway config changed:', provider, model);
                  }} />
                </div>
              )}

              {/* Agents Tab */}
              {activeTab === 'agents' && (
                <div className="space-y-6 pb-6">
                  <div>
                    <label className="block text-sm font-mono text-cyan-400 mb-3">
                      Agent Configuration
                    </label>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-mono text-gray-400 mb-2">
                          Default Agent Timeout (seconds)
                        </label>
                        <input
                          type="number"
                          defaultValue="30"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-cyan-400/50"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-mono text-gray-400 mb-2">
                          Max Concurrent Agents
                        </label>
                        <input
                          type="number"
                          defaultValue="10"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-cyan-400/50"
                        />
                      </div>

                      <div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            defaultChecked
                            className="w-4 h-4"
                          />
                          <span className="text-xs text-gray-300">Enable agent memory persistence</span>
                        </label>
                      </div>

                      <div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            defaultChecked
                            className="w-4 h-4"
                          />
                          <span className="text-xs text-gray-300">Allow agents to use tools</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-mono text-cyan-400 mb-3">
                      Swarm Settings
                    </label>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-mono text-gray-400 mb-2">
                          Swarm Coordination Mode
                        </label>
                        <select className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-cyan-400/50">
                          <option value="sequential">Sequential</option>
                          <option value="parallel">Parallel</option>
                          <option value="hierarchical">Hierarchical</option>
                        </select>
                      </div>

                      <div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            defaultChecked
                            className="w-4 h-4"
                          />
                          <span className="text-xs text-gray-300">Enable agent-to-agent communication</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Skills Tab */}
              {activeTab === 'skills' && (
                <div className="space-y-6 pb-6">
                  <div>
                    <label className="block text-sm font-mono text-cyan-400 mb-3">
                      Available Tools
                    </label>
                    <p className="text-xs text-gray-400 mb-4">
                      Select which tools are available to your agents:
                    </p>
                    <div className="space-y-2">
                      {['Web Search', 'Calculator', 'Memory Read/Write', 'File Operations', 'API Calls', 'Text Analysis'].map((tool) => (
                        <label key={tool} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            defaultChecked={tool !== 'File Operations'}
                            className="w-4 h-4"
                          />
                          <span className="text-xs text-gray-300">{tool}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-mono text-cyan-400 mb-3">
                      Tool Execution Settings
                    </label>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-mono text-gray-400 mb-2">
                          Tool Execution Timeout (ms)
                        </label>
                        <input
                          type="number"
                          defaultValue="10000"
                          className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm focus:outline-none focus:border-cyan-400/50"
                        />
                      </div>

                      <div>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            defaultChecked
                            className="w-4 h-4"
                          />
                          <span className="text-xs text-gray-300">Sandbox tool execution</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Knowledge Base Tab */}
              {activeTab === 'knowledge' && (
                <>
                  {/* Knowledge Base Upload */}
              <div>
                <label className="block text-sm font-mono text-cyan-400 mb-3">
                  Knowledge Base (RAG)
                </label>

                {/* Upload Zone */}
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`p-6 rounded-lg border-2 border-dashed transition-colors ${
                    isDragging
                      ? 'bg-cyan-400/10 border-cyan-400'
                      : 'bg-slate-900 border-slate-700 hover:border-cyan-400/50'
                  } ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <div className="flex flex-col items-center gap-2 text-center">
                    {isUploading ? (
                      <>
                        <div className="animate-spin">
                          <Upload size={20} className="text-cyan-400" />
                        </div>
                        <p className="text-sm text-gray-300">Uploading files...</p>
                      </>
                    ) : (
                      <>
                        <Upload size={20} className="text-cyan-400" />
                        <p className="text-sm text-gray-300">
                          Drag & drop your files here
                        </p>
                        <p className="text-xs text-gray-500">or click to browse</p>
                      </>
                    )}
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.txt,.doc,.docx"
                      onChange={(e) => handleFileUpload(e.target.files)}
                      className="hidden"
                      id="file-input"
                      disabled={isUploading}
                    />
                    {!isUploading && (
                      <label
                        htmlFor="file-input"
                        className="mt-2 px-3 py-1.5 text-xs font-mono bg-cyan-400/10 text-cyan-400 rounded border border-cyan-400/30 hover:bg-cyan-400/20 cursor-pointer transition-colors"
                      >
                        Browse Files
                      </label>
                    )}
                  </div>
                </div>

                {/* File format info */}
                <p className="mt-2 text-xs text-gray-500">
                  Supported: PDF, TXT, DOC, DOCX (max 10MB each)
                </p>

                {/* Uploaded files list */}
                {uploadedFiles.length > 0 && (
                  <motion.div
                    className="mt-4 space-y-2"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                  >
                    <p className="text-xs text-gray-500">Knowledge Base Files:</p>
                    {uploadedFiles.map((file, idx) => (
                      <motion.div
                        key={idx}
                        className="flex items-center justify-between p-3 rounded bg-slate-900 border border-slate-700"
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {file.status === 'uploading' && (
                              <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                            )}
                            {file.status === 'processing' && (
                              <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                            )}
                            {file.status === 'complete' && (
                              <div className="w-2 h-2 rounded-full bg-green-400" />
                            )}
                            {file.status === 'error' && (
                              <div className="w-2 h-2 rounded-full bg-red-400" />
                            )}
                            <span className="text-xs text-gray-300 truncate font-mono">
                              {file.name}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {(file.size / 1024).toFixed(1)}KB • {file.status}
                          </p>
                        </div>
                        {file.status !== 'uploading' && (
                          <button
                            onClick={() =>
                              setUploadedFiles((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            className="flex-shrink-0 ml-2 text-gray-500 hover:text-cyan-400 transition-colors"
                          >
                            <X size={16} />
                          </button>
                        )}
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </div>

                  {/* WebSocket Status */}
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-700">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                      <span className="text-xs text-gray-300 font-mono">
                        Backend Connected
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
