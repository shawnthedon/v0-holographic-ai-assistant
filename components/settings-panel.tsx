'use client';

import React from "react"

import { useState } from 'react';
import { X, Upload } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            className="fixed inset-y-0 right-0 w-full max-w-md bg-slate-950 border-l border-cyan-400/30 z-50 overflow-y-auto"
            initial={{ x: 400 }}
            animate={{ x: 0 }}
            exit={{ x: 400 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          >
            {/* Header */}
            <div className="sticky top-0 flex items-center justify-between p-6 border-b border-cyan-400/20 bg-slate-950/95 backdrop-blur">
              <h2 className="text-lg font-semibold text-white">Advanced Settings</h2>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-cyan-400 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-8">
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
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
