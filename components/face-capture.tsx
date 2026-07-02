'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, X, Play, Square } from 'lucide-react';
import {
  captureFaceMesh,
  captureFramesBatch,
  drawFaceMesh,
  uploadFaceFrames,
  type FaceMesh,
} from '@/lib/face-capture';

interface FaceCaptureProps {
  onCaptureSent?: (frameCount: number) => void;
}

export function FaceCapture({ onCaptureSent }: FaceCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<
    'idle' | 'capturing' | 'uploading' | 'complete' | 'error'
  >('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [confidence, setConfidence] = useState(0);
  const animationFrameRef = useRef<number>();

  /**
   * Request camera access and start video stream
   */
  const initializeCamera = useCallback(async () => {
    try {
      setCameraError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        console.log('[v0] Camera initialized');
      }
    } catch (err) {
      const message =
        err instanceof DOMException
          ? `Camera permission denied: ${err.message}`
          : 'Failed to access camera';
      setCameraError(message);
      console.error('[v0] Camera error:', err);
    }
  }, []);

  /**
   * Stop camera and clean up
   */
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
  }, []);

  /**
   * Real-time mesh visualization loop
   */
  useEffect(() => {
    if (!isOpen || !videoRef.current || !canvasRef.current) return;

    const updateMesh = async () => {
      if (videoRef.current && canvasRef.current) {
        const mesh = await captureFaceMesh(videoRef.current);
        if (mesh) {
          setConfidence(mesh.confidence);
          drawFaceMesh(
            canvasRef.current,
            mesh,
            videoRef.current.videoWidth,
            videoRef.current.videoHeight
          );
        }
      }
      animationFrameRef.current = requestAnimationFrame(updateMesh);
    };

    animationFrameRef.current = requestAnimationFrame(updateMesh);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isOpen]);

  /**
   * Handle recording and upload
   */
  const handleRecordToggle = async () => {
    if (isRecording) {
      setIsRecording(false);
      setUploadStatus('idle');
      return;
    }

    setIsRecording(true);
    setUploadStatus('capturing');
    setFrameCount(0);

    try {
      if (!videoRef.current) throw new Error('Video element not ready');

      // Capture 60 frames (2 seconds at 30 FPS)
      const meshes = await captureFramesBatch(videoRef.current, 2000, {
        fpsTarget: 30,
      });

      if (meshes.length === 0) {
        throw new Error('No face detected during capture');
      }

      setFrameCount(meshes.length);
      setUploadStatus('uploading');

      // Upload frames to backend
      const result = await uploadFaceFrames(meshes);
      console.log('[v0] Face capture uploaded:', result);

      setUploadStatus('complete');
      onCaptureSent?.(meshes.length);

      // Reset after 2 seconds
      setTimeout(() => {
        setIsRecording(false);
        setUploadStatus('idle');
      }, 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setUploadError(message);
      setUploadStatus('error');
      setIsRecording(false);
      console.error('[v0] Face capture error:', err);
    }
  };

  /**
   * Handle panel open
   */
  const handleOpen = async () => {
    setIsOpen(true);
    await initializeCamera();
  };

  /**
   * Handle panel close
   */
  const handleClose = () => {
    stopCamera();
    setIsOpen(false);
    setUploadStatus('idle');
  };

  return (
    <>
      {/* Floating Button */}
      <motion.button
        onClick={handleOpen}
        className="fixed bottom-24 right-6 w-12 h-12 rounded-full bg-gradient-to-r from-cyan-400/20 to-purple-400/20 border border-cyan-400/50 flex items-center justify-center text-cyan-400 hover:from-cyan-400/30 hover:to-purple-400/30 transition-colors z-40"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        title="Face Capture"
      >
        <Camera size={20} />
      </motion.button>

      {/* Face Capture Panel */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleClose}
            />

            {/* Panel */}
            <motion.div
              className="fixed inset-y-0 left-0 w-full max-w-2xl bg-slate-950 border-r border-cyan-400/30 z-50 overflow-y-auto"
              initial={{ x: -600 }}
              animate={{ x: 0 }}
              exit={{ x: -600 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            >
              {/* Header */}
              <div className="sticky top-0 flex items-center justify-between p-6 border-b border-cyan-400/20 bg-slate-950/95 backdrop-blur">
                <h2 className="text-lg font-semibold text-white">Face Capture</h2>
                <button
                  onClick={handleClose}
                  className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-cyan-400 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-6">
                {/* Camera Error */}
                {cameraError && (
                  <motion.div
                    className="p-4 rounded-lg bg-red-400/10 border border-red-400/30 text-red-300 text-sm"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <p className="font-mono">{cameraError}</p>
                    <button
                      onClick={handleOpen}
                      className="mt-2 text-xs px-2 py-1 bg-red-400/20 rounded border border-red-400/30 hover:bg-red-400/30"
                    >
                      Retry
                    </button>
                  </motion.div>
                )}

                {/* Video Preview */}
                <div className="relative rounded-lg overflow-hidden bg-black border border-cyan-400/20">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    className="w-full aspect-video object-cover"
                  />
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full"
                  />

                  {/* Confidence Overlay */}
                  {isOpen && !cameraError && (
                    <motion.div
                      className="absolute top-4 right-4 px-3 py-1.5 rounded-lg bg-slate-950/80 border border-cyan-400/30 text-xs font-mono text-cyan-400"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      Confidence: {(confidence * 100).toFixed(1)}%
                    </motion.div>
                  )}
                </div>

                {/* Status Messages */}
                {uploadStatus !== 'idle' && (
                  <motion.div
                    className={`p-4 rounded-lg text-sm font-mono ${
                      uploadStatus === 'capturing'
                        ? 'bg-blue-400/10 border border-blue-400/30 text-blue-300'
                        : uploadStatus === 'uploading'
                          ? 'bg-yellow-400/10 border border-yellow-400/30 text-yellow-300'
                          : uploadStatus === 'complete'
                            ? 'bg-green-400/10 border border-green-400/30 text-green-300'
                            : 'bg-red-400/10 border border-red-400/30 text-red-300'
                    }`}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    {uploadStatus === 'capturing' && '📹 Capturing frames...'}
                    {uploadStatus === 'uploading' && '📤 Uploading to backend...'}
                    {uploadStatus === 'complete' &&
                      `✓ Uploaded ${frameCount} frames successfully`}
                    {uploadStatus === 'error' && `✗ Error: ${uploadError}`}
                  </motion.div>
                )}

                {/* Info */}
                <div className="p-4 rounded-lg bg-slate-900 border border-slate-700">
                  <p className="text-xs text-gray-300 leading-relaxed">
                    Look at the camera for 2 seconds while capturing. The system will
                    extract your face mesh and upload it to process your avatar cloning.
                  </p>
                </div>

                {/* Record Button */}
                <button
                  onClick={handleRecordToggle}
                  disabled={cameraError !== null || uploadStatus === 'uploading'}
                  className={`w-full py-3 rounded-lg font-mono text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                    isRecording
                      ? 'bg-red-400/20 border border-red-400/50 text-red-300 hover:bg-red-400/30'
                      : 'bg-cyan-400/20 border border-cyan-400/50 text-cyan-300 hover:bg-cyan-400/30 disabled:opacity-50 disabled:cursor-not-allowed'
                  }`}
                >
                  {isRecording ? (
                    <>
                      <Square size={16} />
                      Stop Recording
                    </>
                  ) : (
                    <>
                      <Play size={16} />
                      Start Capture
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
