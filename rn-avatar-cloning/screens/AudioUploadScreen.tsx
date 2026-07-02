import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  Alert,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Audio } from 'expo-av';
import * as MediaLibrary from 'expo-media-library';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { apiClient } from '../services/api-client';

export function AudioUploadScreen() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordedAudio, setRecordedAudio] = useState<Audio.Recording | null>(null);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'complete' | 'error'>(
    'idle'
  );
  const recordingRef = useRef(recordingTime);
  const timerRef = useRef<NodeJS.Timeout>();

  const startRecording = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission denied', 'Microphone access is required');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      setRecordedAudio(recording);
      setIsRecording(true);
      setRecordingTime(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          const newTime = prev + 1;
          recordingRef.current = newTime;

          // Auto-stop at 30 seconds
          if (newTime >= 30) {
            stopRecording();
          }

          return newTime;
        });
      }, 1000);

      console.log('[v0] Recording started');
    } catch (error) {
      Alert.alert('Error', 'Failed to start recording');
      console.error('[v0] Recording error:', error);
    }
  };

  const stopRecording = async () => {
    if (!recordedAudio) return;

    try {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      await recordedAudio.stopAndUnloadAsync();
      setIsRecording(false);

      console.log('[v0] Recording stopped:', recordingRef.current, 'seconds');
    } catch (error) {
      Alert.alert('Error', 'Failed to stop recording');
      console.error('[v0] Stop recording error:', error);
    }
  };

  const deleteRecording = () => {
    setRecordedAudio(null);
    setRecordingTime(0);
  };

  const uploadRecording = async () => {
    if (!recordedAudio) return;

    setUploadStatus('uploading');

    try {
      // Get recording URI
      const uri = recordedAudio.getURI();
      if (!uri) throw new Error('No recording URI');

      // Convert to blob
      const response = await fetch(uri);
      const blob = await response.blob();

      // Upload
      const result = await apiClient.uploadAudio(blob, {
        model: 'openvoice',
        language: 'en',
      });

      console.log('[v0] Audio uploaded:', result);
      setUploadStatus('complete');

      setTimeout(() => {
        setUploadStatus('idle');
        Alert.alert('Success', 'Voice recording uploaded');
        deleteRecording();
      }, 2000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed';
      Alert.alert('Error', message);
      setUploadStatus('error');
      console.error('[v0] Upload error:', error);
    }
  };

  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Info Card */}
        <View style={styles.infoCard}>
          <MaterialIcons name="info" size={20} color="#06b6d4" />
          <Text style={styles.infoText}>
            Record a 3-10 second audio sample of your voice for cloning
          </Text>
        </View>

        {/* Recording Interface */}
        <View style={styles.recordingSection}>
          {!recordedAudio ? (
            <>
              {/* Timer */}
              <View style={styles.timerContainer}>
                <Text style={styles.timerText}>{formatTime(recordingTime)}</Text>
              </View>

              {/* Record Button */}
              <TouchableOpacity
                style={[
                  styles.recordButton,
                  isRecording && styles.recordButtonActive,
                ]}
                onPress={isRecording ? stopRecording : startRecording}
              >
                <MaterialIcons
                  name={isRecording ? 'stop' : 'radio-button-unchecked'}
                  size={40}
                  color={isRecording ? '#ef4444' : '#06b6d4'}
                />
              </TouchableOpacity>

              <Text style={styles.recordLabel}>
                {isRecording ? 'Recording...' : 'Start Recording'}
              </Text>
            </>
          ) : (
            <>
              {/* Playback */}
              <View style={styles.playbackContainer}>
                <MaterialIcons name="graphic-eq" size={32} color="#06b6d4" />
                <View style={styles.waveform}>
                  {Array.from({ length: 12 }).map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.waveformBar,
                        { height: `${30 + Math.random() * 40}%` },
                      ]}
                    />
                  ))}
                </View>
              </View>

              <Text style={styles.durationText}>
                Duration: {formatTime(recordingTime)}
              </Text>

              {/* Validation Message */}
              {recordingTime < 3 ? (
                <View style={styles.warningCard}>
                  <MaterialIcons name="warning" size={16} color="#eab308" />
                  <Text style={styles.warningText}>
                    Recording should be at least 3 seconds
                  </Text>
                </View>
              ) : recordingTime > 10 ? (
                <View style={styles.warningCard}>
                  <MaterialIcons name="info" size={16} color="#3b82f6" />
                  <Text style={styles.warningText}>
                    Recommended max 10 seconds for best quality
                  </Text>
                </View>
              ) : (
                <View style={styles.successCard}>
                  <MaterialIcons name="check-circle" size={16} color="#22c55e" />
                  <Text style={styles.successText}>Perfect recording length</Text>
                </View>
              )}

              {/* Action Buttons */}
              <View style={styles.buttonGroup}>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={deleteRecording}
                >
                  <MaterialIcons name="delete" size={20} color="#94a3b8" />
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.uploadButton,
                    uploadStatus === 'uploading' && styles.uploadButtonLoading,
                    recordingTime < 3 && styles.uploadButtonDisabled,
                  ]}
                  onPress={uploadRecording}
                  disabled={uploadStatus === 'uploading' || recordingTime < 3}
                >
                  {uploadStatus === 'uploading' ? (
                    <ActivityIndicator color="#06b6d4" size="small" />
                  ) : (
                    <>
                      <MaterialIcons name="cloud-upload" size={20} color="#06b6d4" />
                      <Text style={styles.uploadButtonText}>Upload</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {/* Status Message */}
        {uploadStatus === 'complete' && (
          <View style={styles.completeCard}>
            <MaterialIcons name="check-circle" size={24} color="#22c55e" />
            <Text style={styles.completeText}>Successfully uploaded!</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 20,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: 'rgba(6, 182, 212, 0.1)',
    borderRadius: 8,
    borderColor: 'rgba(6, 182, 212, 0.2)',
    borderWidth: 1,
  },
  infoText: {
    flex: 1,
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18,
  },
  recordingSection: {
    alignItems: 'center',
    gap: 24,
  },
  timerContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(6, 182, 212, 0.1)',
    borderWidth: 2,
    borderColor: 'rgba(6, 182, 212, 0.3)',
  },
  timerText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#06b6d4',
    fontFamily: 'monospace',
  },
  recordButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(6, 182, 212, 0.1)',
    borderWidth: 2,
    borderColor: 'rgba(6, 182, 212, 0.3)',
  },
  recordButtonActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  recordLabel: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '500',
  },
  playbackContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: 'rgba(6, 182, 212, 0.05)',
    borderRadius: 12,
    width: '100%',
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    flex: 1,
    height: 64,
  },
  waveformBar: {
    flex: 1,
    backgroundColor: '#06b6d4',
    borderRadius: 2,
  },
  durationText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  warningCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    borderRadius: 8,
    borderColor: 'rgba(234, 179, 8, 0.2)',
    borderWidth: 1,
    width: '100%',
  },
  warningText: {
    flex: 1,
    color: '#eab308',
    fontSize: 12,
  },
  successCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderRadius: 8,
    borderColor: 'rgba(34, 197, 94, 0.2)',
    borderWidth: 1,
    width: '100%',
  },
  successText: {
    flex: 1,
    color: '#22c55e',
    fontSize: 12,
  },
  buttonGroup: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  deleteButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    backgroundColor: 'rgba(148, 163, 184, 0.1)',
    borderRadius: 8,
    borderColor: 'rgba(148, 163, 184, 0.2)',
    borderWidth: 1,
  },
  deleteButtonText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '500',
  },
  uploadButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    backgroundColor: 'rgba(6, 182, 212, 0.2)',
    borderRadius: 8,
    borderColor: 'rgba(6, 182, 212, 0.4)',
    borderWidth: 1,
  },
  uploadButtonText: {
    color: '#06b6d4',
    fontSize: 14,
    fontWeight: '500',
  },
  uploadButtonLoading: {
    opacity: 0.7,
  },
  uploadButtonDisabled: {
    opacity: 0.5,
  },
  completeCard: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 20,
  },
  completeText: {
    color: '#22c55e',
    fontSize: 14,
    fontWeight: '500',
  },
});
