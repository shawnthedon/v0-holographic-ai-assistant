import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Switch,
  Linking,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

interface SettingsState {
  faceCaptureQuality: 'high' | 'medium' | 'low';
  voiceModel: 'openvoice' | 'rvc' | 'xtts';
  autoUpload: boolean;
  wifiOnly: boolean;
  showDebugInfo: boolean;
  soundEnabled: boolean;
}

export function SettingsScreen() {
  const [settings, setSettings] = useState<SettingsState>({
    faceCaptureQuality: 'high',
    voiceModel: 'openvoice',
    autoUpload: false,
    wifiOnly: true,
    showDebugInfo: false,
    soundEnabled: true,
  });

  const updateSetting = <K extends keyof SettingsState>(
    key: K,
    value: SettingsState[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const SettingSection: React.FC<{
    title: string;
    subtitle?: string;
    children: React.ReactNode;
  }> = ({ title, subtitle, children }) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
      <View style={styles.sectionContent}>{children}</View>
    </View>
  );

  const OptionButton: React.FC<{
    label: string;
    selected: boolean;
    onPress: () => void;
  }> = ({ label, selected, onPress }) => (
    <TouchableOpacity
      style={[styles.optionButton, selected && styles.optionButtonSelected]}
      onPress={onPress}
    >
      <View
        style={[styles.optionDot, selected && styles.optionDotSelected]}
      />
      <Text
        style={[styles.optionLabel, selected && styles.optionLabelSelected]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  const ToggleSetting: React.FC<{
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
  }> = ({ label, value, onChange }) => (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: '#334155', true: 'rgba(6, 182, 212, 0.3)' }}
        thumbColor={value ? '#06b6d4' : '#64748b'}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Face Capture Settings */}
        <SettingSection title="Face Capture" subtitle="Quality and performance">
          <View style={styles.optionsGroup}>
            <OptionButton
              label="High (30 FPS)"
              selected={settings.faceCaptureQuality === 'high'}
              onPress={() => updateSetting('faceCaptureQuality', 'high')}
            />
            <OptionButton
              label="Medium (15 FPS)"
              selected={settings.faceCaptureQuality === 'medium'}
              onPress={() => updateSetting('faceCaptureQuality', 'medium')}
            />
            <OptionButton
              label="Low (10 FPS)"
              selected={settings.faceCaptureQuality === 'low'}
              onPress={() => updateSetting('faceCaptureQuality', 'low')}
            />
          </View>

          <View style={styles.infoBox}>
            <MaterialIcons name="info" size={14} color="#06b6d4" />
            <Text style={styles.infoText}>
              Higher quality captures more details but uses more data
            </Text>
          </View>
        </SettingSection>

        {/* Voice Cloning Settings */}
        <SettingSection title="Voice Cloning" subtitle="Model and processing">
          <View style={styles.optionsGroup}>
            <OptionButton
              label="OpenVoice (Recommended)"
              selected={settings.voiceModel === 'openvoice'}
              onPress={() => updateSetting('voiceModel', 'openvoice')}
            />
            <OptionButton
              label="RVC (Pitch Control)"
              selected={settings.voiceModel === 'rvc'}
              onPress={() => updateSetting('voiceModel', 'rvc')}
            />
            <OptionButton
              label="XTTS v2 (Multi-language)"
              selected={settings.voiceModel === 'xtts'}
              onPress={() => updateSetting('voiceModel', 'xtts')}
            />
          </View>
        </SettingSection>

        {/* Performance & Privacy */}
        <SettingSection title="Performance & Privacy">
          <ToggleSetting
            label="Auto Upload"
            value={settings.autoUpload}
            onChange={(value) => updateSetting('autoUpload', value)}
          />
          <View style={styles.divider} />
          <ToggleSetting
            label="Wi-Fi Only"
            value={settings.wifiOnly}
            onChange={(value) => updateSetting('wifiOnly', value)}
          />
          <View style={styles.divider} />
          <ToggleSetting
            label="Sound Effects"
            value={settings.soundEnabled}
            onChange={(value) => updateSetting('soundEnabled', value)}
          />

          <View style={styles.infoBox}>
            <MaterialIcons name="shield" size={14} color="#06b6d4" />
            <Text style={styles.infoText}>
              Face and voice data is processed on-device and encrypted during transfer
            </Text>
          </View>
        </SettingSection>

        {/* Developer Debug */}
        <SettingSection title="Developer" subtitle="Advanced options">
          <ToggleSetting
            label="Show Debug Info"
            value={settings.showDebugInfo}
            onChange={(value) => updateSetting('showDebugInfo', value)}
          />

          {settings.showDebugInfo && (
            <View style={styles.debugInfo}>
              <View style={styles.debugRow}>
                <Text style={styles.debugLabel}>App Version</Text>
                <Text style={styles.debugValue}>1.0.0</Text>
              </View>
              <View style={styles.debugRow}>
                <Text style={styles.debugLabel}>MediaPipe</Text>
                <Text style={styles.debugValue}>0.10.35</Text>
              </View>
              <View style={styles.debugRow}>
                <Text style={styles.debugLabel}>Platform</Text>
                <Text style={styles.debugValue}>React Native</Text>
              </View>
            </View>
          )}
        </SettingSection>

        {/* About & Support */}
        <SettingSection title="About & Support">
          <TouchableOpacity style={styles.linkButton}>
            <Text style={styles.linkButtonText}>Documentation</Text>
            <MaterialIcons name="open-in-new" size={16} color="#06b6d4" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.linkButton}>
            <Text style={styles.linkButtonText}>Report Issue</Text>
            <MaterialIcons name="open-in-new" size={16} color="#06b6d4" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.linkButton}>
            <Text style={styles.linkButtonText}>Privacy Policy</Text>
            <MaterialIcons name="open-in-new" size={16} color="#06b6d4" />
          </TouchableOpacity>
        </SettingSection>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Avatar Cloning v1.0.0
          </Text>
          <Text style={styles.footerSmall}>
            Built with MediaPipe, OpenVoice, and Expo
          </Text>
        </View>
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
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 24,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#06b6d4',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
  },
  sectionContent: {
    gap: 12,
  },
  optionsGroup: {
    gap: 8,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(30, 41, 59, 0.5)',
    borderRadius: 8,
    borderColor: 'rgba(6, 182, 212, 0.1)',
    borderWidth: 1,
  },
  optionButtonSelected: {
    backgroundColor: 'rgba(6, 182, 212, 0.1)',
    borderColor: 'rgba(6, 182, 212, 0.3)',
  },
  optionDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderColor: '#94a3b8',
    borderWidth: 2,
  },
  optionDotSelected: {
    borderColor: '#06b6d4',
    backgroundColor: '#06b6d4',
  },
  optionLabel: {
    flex: 1,
    fontSize: 13,
    color: '#94a3b8',
  },
  optionLabelSelected: {
    color: '#e2e8f0',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(30, 41, 59, 0.5)',
    borderRadius: 8,
    borderColor: 'rgba(6, 182, 212, 0.1)',
    borderWidth: 1,
  },
  toggleLabel: {
    fontSize: 13,
    color: '#e2e8f0',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(6, 182, 212, 0.1)',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(6, 182, 212, 0.05)',
    borderRadius: 6,
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 16,
  },
  debugInfo: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(6, 182, 212, 0.05)',
    borderRadius: 8,
    borderColor: 'rgba(6, 182, 212, 0.1)',
    borderWidth: 1,
    gap: 8,
  },
  debugRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  debugLabel: {
    fontSize: 12,
    color: '#94a3b8',
  },
  debugValue: {
    fontSize: 12,
    color: '#06b6d4',
    fontFamily: 'monospace',
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(30, 41, 59, 0.5)',
    borderRadius: 8,
    borderColor: 'rgba(6, 182, 212, 0.1)',
    borderWidth: 1,
  },
  linkButtonText: {
    flex: 1,
    fontSize: 13,
    color: '#06b6d4',
  },
  footer: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 20,
  },
  footerText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  footerSmall: {
    fontSize: 10,
    color: '#64748b',
  },
});
