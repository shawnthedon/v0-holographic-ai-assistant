import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { apiClient } from '../services/api-client';

export function CameraScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [isCapturing, setIsCapturing] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<
    'idle' | 'capturing' | 'uploading' | 'complete' | 'error'
  >('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    if (!permission) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  if (!permission) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#06b6d4" />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centeredContent}>
          <MaterialIcons name="no-photography" size={48} color="#64748b" />
          <Text style={styles.errorText}>Camera permission required</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={requestPermission}
          >
            <Text style={styles.retryButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const handleCapture = async () => {
    if (!cameraRef.current) return;

    setIsCapturing(true);
    setUploadStatus('capturing');
    setFrameCount(0);

    try {
      // Simulate frame capture (in production, integrate MediaPipe)
      const mockFrames = Array.from({ length: 30 }, (_, i) => ({
        keyLandmarks: [
          { idx: 0, x: 0.5, y: 0.5, z: 0.1 },
          { idx: 1, x: 0.45, y: 0.45, z: 0.15 },
        ],
        blendshapes: { smile: 0.3, blink: 0.1 },
        confidence: 0.85 + Math.random() * 0.1,
      }));

      setFrameCount(mockFrames.length);
      setUploadStatus('uploading');

      const result = await apiClient.uploadFaceFrames(mockFrames);
      console.log('[v0] Capture result:', result);

      setUploadStatus('complete');
      setTimeout(() => {
        setIsCapturing(false);
        setUploadStatus('idle');
        Alert.alert('Success', `Captured ${mockFrames.length} frames`);
      }, 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Capture failed';
      setUploadError(message);
      setUploadStatus('error');
      setIsCapturing(false);
      Alert.alert('Error', message);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing="front">
        {/* Status Overlay */}
        <View style={styles.overlay}>
          {/* Top Status */}
          <View style={styles.topStatus}>
            {uploadStatus !== 'idle' && (
              <View
                style={[
                  styles.statusBadge,
                  uploadStatus === 'capturing' && styles.statusCapturing,
                  uploadStatus === 'uploading' && styles.statusUploading,
                  uploadStatus === 'complete' && styles.statusComplete,
                  uploadStatus === 'error' && styles.statusError,
                ]}
              >
                {uploadStatus === 'capturing' && (
                  <ActivityIndicator color="#3b82f6" size="small" />
                )}
                {uploadStatus === 'uploading' && (
                  <ActivityIndicator color="#eab308" size="small" />
                )}
                {uploadStatus === 'complete' && (
                  <MaterialIcons name="check-circle" size={16} color="#22c55e" />
                )}
                {uploadStatus === 'error' && (
                  <MaterialIcons name="error" size={16} color="#ef4444" />
                )}
                <Text
                  style={[
                    styles.statusText,
                    uploadStatus === 'capturing' && styles.statusTextCapturing,
                    uploadStatus === 'uploading' && styles.statusTextUploading,
                    uploadStatus === 'complete' && styles.statusTextComplete,
                    uploadStatus === 'error' && styles.statusTextError,
                  ]}
                >
                  {uploadStatus === 'capturing'
                    ? 'Capturing frames...'
                    : uploadStatus === 'uploading'
                      ? 'Uploading...'
                      : uploadStatus === 'complete'
                        ? `✓ ${frameCount} frames`
                        : 'Error'}
                </Text>
              </View>
            )}
          </View>

          {/* Capture Guides */}
          <View style={styles.centerGuide}>
            <View style={styles.faceGuide} />
            <Text style={styles.guidText}>Center your face in the circle</Text>
          </View>

          {/* Bottom Controls */}
          <View style={styles.bottomControls}>
            <TouchableOpacity
              style={[
                styles.captureButton,
                isCapturing && styles.captureButtonDisabled,
              ]}
              onPress={handleCapture}
              disabled={isCapturing}
            >
              <MaterialIcons
                name={isCapturing ? 'stop-circle' : 'circle'}
                size={56}
                color={isCapturing ? '#ef4444' : '#06b6d4'}
              />
            </TouchableOpacity>

            <View style={styles.infoContainer}>
              <Text style={styles.infoText}>
                {isCapturing ? 'Recording...' : 'Ready to capture'}
              </Text>
              {frameCount > 0 && (
                <Text style={styles.frameCount}>{frameCount} frames captured</Text>
              )}
            </View>
          </View>
        </View>
      </CameraView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 40,
  },
  topStatus: {
    width: '100%',
    alignItems: 'center',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  statusCapturing: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderColor: 'rgba(59, 130, 246, 0.3)',
    borderWidth: 1,
  },
  statusUploading: {
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    borderColor: 'rgba(234, 179, 8, 0.3)',
    borderWidth: 1,
  },
  statusComplete: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderColor: 'rgba(34, 197, 94, 0.3)',
    borderWidth: 1,
  },
  statusError: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderWidth: 1,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  statusTextCapturing: {
    color: '#3b82f6',
  },
  statusTextUploading: {
    color: '#eab308',
  },
  statusTextComplete: {
    color: '#22c55e',
  },
  statusTextError: {
    color: '#ef4444',
  },
  centerGuide: {
    alignItems: 'center',
    gap: 12,
  },
  faceGuide: {
    width: 160,
    height: 200,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'rgba(6, 182, 212, 0.4)',
  },
  guidText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '500',
  },
  bottomControls: {
    alignItems: 'center',
    gap: 16,
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(6, 182, 212, 0.1)',
    borderWidth: 2,
    borderColor: 'rgba(6, 182, 212, 0.3)',
  },
  captureButtonDisabled: {
    opacity: 0.5,
  },
  infoContainer: {
    alignItems: 'center',
  },
  infoText: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '500',
  },
  frameCount: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 4,
  },
  centeredContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  errorText: {
    color: '#94a3b8',
    fontSize: 16,
  },
  retryButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(6, 182, 212, 0.2)',
    borderRadius: 6,
    borderColor: 'rgba(6, 182, 212, 0.5)',
    borderWidth: 1,
  },
  retryButtonText: {
    color: '#06b6d4',
    fontSize: 14,
    fontWeight: '500',
  },
});
