import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { apiClient } from '../services/api-client';

interface SessionData {
  meshId?: string;
  voiceId?: string;
  timestamp?: string;
}

export function AvatarPreviewScreen() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle'
  );

  useEffect(() => {
    loadSession();
  }, []);

  const loadSession = async () => {
    try {
      const sessionData = await apiClient.loadSession();
      setSession(sessionData);
      if (sessionData?.meshId) {
        setPreviewStatus('ready');
      }
    } catch (error) {
      console.error('[v0] Failed to load session:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const generatePreview = async () => {
    if (!session?.meshId) return;

    setPreviewStatus('loading');
    try {
      const result = await apiClient.getAvatarPreview(session.meshId);
      console.log('[v0] Avatar preview generated:', result);
      setPreviewStatus('ready');
    } catch (error) {
      console.error('[v0] Preview generation failed:', error);
      setPreviewStatus('error');
    }
  };

  const clearSession = async () => {
    await apiClient.clearSession();
    setSession(null);
    setPreviewStatus('idle');
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <ActivityIndicator color="#06b6d4" size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Empty State */}
        {!session || !session.meshId ? (
          <View style={styles.emptyState}>
            <MaterialIcons name="image-not-supported" size={48} color="#64748b" />
            <Text style={styles.emptyTitle}>No Avatar Created Yet</Text>
            <Text style={styles.emptyDescription}>
              Capture your face and record your voice to create an avatar
            </Text>

            <View style={styles.stepsContainer}>
              <View style={styles.step}>
                <View
                  style={[
                    styles.stepNumber,
                    session?.meshId && styles.stepDone,
                  ]}
                >
                  <MaterialIcons
                    name={session?.meshId ? 'check' : 'one'}
                    size={16}
                    color={session?.meshId ? '#22c55e' : '#06b6d4'}
                  />
                </View>
                <View>
                  <Text style={styles.stepTitle}>Capture Face</Text>
                  <Text style={styles.stepDescription}>
                    Use the camera to capture your face mesh
                  </Text>
                </View>
              </View>

              <View style={styles.step}>
                <View
                  style={[
                    styles.stepNumber,
                    session?.voiceId && styles.stepDone,
                  ]}
                >
                  <MaterialIcons
                    name={session?.voiceId ? 'check' : 'two'}
                    size={16}
                    color={session?.voiceId ? '#22c55e' : '#06b6d4'}
                  />
                </View>
                <View>
                  <Text style={styles.stepTitle}>Record Voice</Text>
                  <Text style={styles.stepDescription}>
                    Record a voice sample for cloning
                  </Text>
                </View>
              </View>

              <View style={styles.step}>
                <View style={styles.stepNumber}>
                  <Text style={styles.stepNumberText}>3</Text>
                </View>
                <View>
                  <Text style={styles.stepTitle}>Generate Avatar</Text>
                  <Text style={styles.stepDescription}>
                    Process and view your custom avatar
                  </Text>
                </View>
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.previewContent}>
            {/* Avatar Container */}
            <View style={styles.avatarContainer}>
              <View style={styles.avatarPlaceholder}>
                <MaterialIcons name="3d-rotation" size={48} color="#06b6d4" />
                <Text style={styles.placeholderText}>
                  3D Avatar Preview
                </Text>
                <Text style={styles.placeholderHint}>
                  (3D rendering would be displayed here)
                </Text>
              </View>
            </View>

            {/* Session Info */}
            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Mesh ID</Text>
                <Text style={styles.infoValue} numberOfLines={1}>
                  {session.meshId}
                </Text>
              </View>

              {session.voiceId && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Voice ID</Text>
                  <Text style={styles.infoValue} numberOfLines={1}>
                    {session.voiceId}
                  </Text>
                </View>
              )}

              {session.timestamp && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Created</Text>
                  <Text style={styles.infoValue}>
                    {new Date(session.timestamp).toLocaleDateString()}
                  </Text>
                </View>
              )}
            </View>

            {/* Status Badge */}
            <View
              style={[
                styles.statusBadge,
                previewStatus === 'ready' && styles.statusReady,
                previewStatus === 'error' && styles.statusError,
              ]}
            >
              {previewStatus === 'loading' && (
                <ActivityIndicator color="#06b6d4" size="small" />
              )}
              {previewStatus === 'ready' && (
                <MaterialIcons name="check-circle" size={16} color="#22c55e" />
              )}
              {previewStatus === 'error' && (
                <MaterialIcons name="error" size={16} color="#ef4444" />
              )}

              <Text
                style={[
                  styles.statusText,
                  previewStatus === 'ready' && styles.statusTextReady,
                  previewStatus === 'error' && styles.statusTextError,
                ]}
              >
                {previewStatus === 'idle' && 'Ready'}
                {previewStatus === 'loading' && 'Generating...'}
                {previewStatus === 'ready' && 'Preview Ready'}
                {previewStatus === 'error' && 'Error'}
              </Text>
            </View>

            {/* Actions */}
            <View style={styles.actions}>
              {previewStatus === 'idle' && (
                <TouchableOpacity
                  style={styles.generateButton}
                  onPress={generatePreview}
                >
                  <MaterialIcons name="play-circle" size={20} color="#06b6d4" />
                  <Text style={styles.generateButtonText}>Generate Preview</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.clearButton}
                onPress={clearSession}
              >
                <MaterialIcons name="delete" size={20} color="#94a3b8" />
                <Text style={styles.clearButtonText}>Clear Session</Text>
              </TouchableOpacity>
            </View>
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
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#e2e8f0',
  },
  emptyDescription: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
  },
  stepsContainer: {
    width: '100%',
    marginTop: 16,
    gap: 12,
  },
  step: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    borderRadius: 8,
    borderColor: 'rgba(6, 182, 212, 0.1)',
    borderWidth: 1,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(6, 182, 212, 0.1)',
    borderColor: 'rgba(6, 182, 212, 0.3)',
    borderWidth: 1,
  },
  stepNumberText: {
    color: '#06b6d4',
    fontSize: 14,
    fontWeight: '600',
  },
  stepDone: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  stepTitle: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '500',
  },
  stepDescription: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  previewContent: {
    gap: 16,
  },
  avatarContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    marginVertical: 8,
  },
  avatarPlaceholder: {
    aspectRatio: 1,
    backgroundColor: 'rgba(6, 182, 212, 0.05)',
    borderColor: 'rgba(6, 182, 212, 0.2)',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  placeholderText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '500',
  },
  placeholderHint: {
    color: '#64748b',
    fontSize: 12,
  },
  infoCard: {
    padding: 12,
    backgroundColor: 'rgba(30, 41, 59, 0.5)',
    borderRadius: 8,
    borderColor: 'rgba(6, 182, 212, 0.1)',
    borderWidth: 1,
    gap: 8,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  infoLabel: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 12,
    color: '#06b6d4',
    fontFamily: 'monospace',
    flex: 1,
    textAlign: 'right',
    marginLeft: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(6, 182, 212, 0.1)',
    borderRadius: 8,
    borderColor: 'rgba(6, 182, 212, 0.2)',
    borderWidth: 1,
  },
  statusReady: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderColor: 'rgba(34, 197, 94, 0.2)',
  },
  statusError: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  statusText: {
    fontSize: 13,
    color: '#06b6d4',
    fontWeight: '500',
  },
  statusTextReady: {
    color: '#22c55e',
  },
  statusTextError: {
    color: '#ef4444',
  },
  actions: {
    gap: 8,
  },
  generateButton: {
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
  generateButtonText: {
    color: '#06b6d4',
    fontSize: 14,
    fontWeight: '500',
  },
  clearButton: {
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
  clearButtonText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '500',
  },
});
