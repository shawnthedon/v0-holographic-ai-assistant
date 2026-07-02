import React, { useEffect } from 'react';
import { StatusBar, LogBox } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

// Screens
import { CameraScreen } from './screens/CameraScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AvatarPreviewScreen } from './screens/AvatarPreviewScreen';
import { AudioUploadScreen } from './screens/AudioUploadScreen';

// Navigation
const Tab = createBottomTabNavigator();
const SettingsStack = createStackNavigator();

// Suppress specific warnings
LogBox.ignoreLogs([
  'Non-serializable values were found in the navigation state',
  'Possible unhandled promise rejection',
]);

/**
 * Settings Stack Navigator
 */
function SettingsStackNavigator() {
  return (
    <SettingsStack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <SettingsStack.Screen name="SettingsMain" component={SettingsScreen} />
    </SettingsStack.Navigator>
  );
}

/**
 * Main App with Bottom Tab Navigation
 */
export default function App() {
  useEffect(() => {
    // Set up status bar
    StatusBar.setBarStyle('light-content');
  }, []);

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ focused, color, size }) => {
            let iconName: keyof typeof MaterialIcons.glyphMap = 'home';

            if (route.name === 'Camera') {
              iconName = 'photo-camera';
            } else if (route.name === 'Audio') {
              iconName = 'mic';
            } else if (route.name === 'Preview') {
              iconName = 'preview';
            } else if (route.name === 'Settings') {
              iconName = 'settings';
            }

            return (
              <MaterialIcons name={iconName} size={size} color={color} />
            );
          },
          tabBarActiveTintColor: '#06b6d4',
          tabBarInactiveTintColor: '#64748b',
          tabBarStyle: {
            backgroundColor: '#0f172a',
            borderTopColor: '#1e293b',
            borderTopWidth: 1,
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: '500',
          },
          headerStyle: {
            backgroundColor: '#0f172a',
            borderBottomColor: '#1e293b',
            borderBottomWidth: 1,
          },
          headerTintColor: '#06b6d4',
          headerTitleStyle: {
            fontWeight: '600',
            fontSize: 16,
          },
          headerBackTitle: 'Back',
          headerShown: true,
        })}
      >
        <Tab.Screen
          name="Camera"
          component={CameraScreen}
          options={{
            tabBarLabel: 'Face Capture',
            headerTitle: 'Face Capture',
          }}
        />

        <Tab.Screen
          name="Audio"
          component={AudioUploadScreen}
          options={{
            tabBarLabel: 'Voice',
            headerTitle: 'Voice Recording',
          }}
        />

        <Tab.Screen
          name="Preview"
          component={AvatarPreviewScreen}
          options={{
            tabBarLabel: 'Avatar',
            headerTitle: 'Avatar Preview',
          }}
        />

        <Tab.Screen
          name="Settings"
          component={SettingsStackNavigator}
          options={{
            tabBarLabel: 'Settings',
            headerShown: false,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
