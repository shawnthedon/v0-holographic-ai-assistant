import axios, { AxiosInstance, AxiosError } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

class ApiClient {
  private instance: AxiosInstance;
  private retryCount = 3;
  private retryDelay = 1000;

  constructor() {
    this.instance = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add response interceptor for error handling
    this.instance.interceptors.response.use(
      (response) => response,
      (error) => this.handleError(error)
    );
  }

  private async handleError(error: AxiosError) {
    if (error.response?.status === 429 || error.code === 'ECONNABORTED') {
      console.warn('[v0] Rate limited or timeout, retrying...');
      return this.retry(error.config);
    }
    return Promise.reject(error);
  }

  private async retry(config: any, attempt = 0) {
    if (attempt >= this.retryCount) {
      return Promise.reject(new Error('Max retries exceeded'));
    }

    await new Promise((resolve) =>
      setTimeout(resolve, this.retryDelay * Math.pow(2, attempt))
    );

    return this.instance(config);
  }

  /**
   * Upload face frames
   */
  async uploadFaceFrames(frames: any[]): Promise<any> {
    try {
      const response = await this.instance.post('/api/face-capture', {
        frames,
        timestamp: new Date().toISOString(),
      });
      console.log('[v0] Face frames uploaded:', response.data);
      return response.data;
    } catch (error) {
      console.error('[v0] Face upload failed:', error);
      throw error;
    }
  }

  /**
   * Upload audio file with multipart
   */
  async uploadAudio(audioBlob: Blob, metadata: Record<string, string>): Promise<any> {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'voice.wav');

      for (const [key, value] of Object.entries(metadata)) {
        formData.append(key, value);
      }

      const response = await this.instance.post('/api/voice-clone', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      console.log('[v0] Audio uploaded:', response.data);
      return response.data;
    } catch (error) {
      console.error('[v0] Audio upload failed:', error);
      throw error;
    }
  }

  /**
   * Clone voice with reference audio
   */
  async cloneVoice(
    referenceAudio: Blob,
    params: {
      model: string;
      text?: string;
      language?: string;
      style?: string;
    }
  ): Promise<any> {
    try {
      const formData = new FormData();
      formData.append('referenceAudio', referenceAudio, 'reference.wav');
      formData.append('model', params.model);

      if (params.text) formData.append('text', params.text);
      if (params.language) formData.append('language', params.language);
      if (params.style) formData.append('style', params.style);

      const response = await this.instance.post('/api/voice-clone', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      return response.data;
    } catch (error) {
      console.error('[v0] Voice cloning failed:', error);
      throw error;
    }
  }

  /**
   * Get avatar preview
   */
  async getAvatarPreview(meshId: string): Promise<any> {
    try {
      const response = await this.instance.get(`/api/avatar-preview/${meshId}`);
      return response.data;
    } catch (error) {
      console.error('[v0] Failed to get avatar preview:', error);
      throw error;
    }
  }

  /**
   * Save session data
   */
  async saveSession(sessionData: Record<string, any>): Promise<void> {
    try {
      await AsyncStorage.setItem(
        'avatar_session',
        JSON.stringify({
          ...sessionData,
          timestamp: new Date().toISOString(),
        })
      );
      console.log('[v0] Session saved');
    } catch (error) {
      console.error('[v0] Failed to save session:', error);
    }
  }

  /**
   * Load session data
   */
  async loadSession(): Promise<Record<string, any> | null> {
    try {
      const session = await AsyncStorage.getItem('avatar_session');
      return session ? JSON.parse(session) : null;
    } catch (error) {
      console.error('[v0] Failed to load session:', error);
      return null;
    }
  }

  /**
   * Clear session
   */
  async clearSession(): Promise<void> {
    try {
      await AsyncStorage.removeItem('avatar_session');
      console.log('[v0] Session cleared');
    } catch (error) {
      console.error('[v0] Failed to clear session:', error);
    }
  }
}

export const apiClient = new ApiClient();
