interface WebSocketMessage {
  type: 'audio' | 'viseme' | 'status' | 'error';
  data: unknown;
  timestamp?: number;
}

interface VisemeData {
  viseme: string;
  duration: number;
  weight?: number;
}

interface AudioChunk {
  buffer: ArrayBuffer;
  sampleRate: number;
}

type MessageHandler = (data: WebSocketMessage) => void;

export class HolographicWebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private messageHandlers: Set<MessageHandler> = new Set();
  private isConnecting = false;

  constructor(url: string = process.env.NEXT_PUBLIC_BACKEND_URL || 'ws://localhost:8080') {
    this.url = url.replace(/^http/, 'ws');
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[v0] WebSocket already connected');
      return;
    }

    if (this.isConnecting) {
      console.log('[v0] WebSocket connection in progress');
      return;
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        console.log('[v0] Connecting to WebSocket:', this.url);
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('[v0] WebSocket connected');
          this.reconnectAttempts = 0;
          this.isConnecting = false;
          this.broadcast({
            type: 'status',
            data: { connected: true },
            timestamp: Date.now(),
          });
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            console.log('[v0] WebSocket message received:', message.type);
            this.broadcast(message);
          } catch (err) {
            console.error('[v0] Failed to parse WebSocket message:', err);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[v0] WebSocket error:', error);
          this.isConnecting = false;
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('[v0] WebSocket disconnected');
          this.isConnecting = false;
          this.broadcast({
            type: 'status',
            data: { connected: false },
            timestamp: Date.now(),
          });
          this.attemptReconnect();
        };
      } catch (err) {
        console.error('[v0] WebSocket creation error:', err);
        this.isConnecting = false;
        reject(err);
      }
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    console.log('[v0] WebSocket disconnect requested');
  }

  /**
   * Send audio data to the backend
   */
  async sendAudio(audioBuffer: ArrayBuffer, sampleRate: number): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const message: WebSocketMessage = {
      type: 'audio',
      data: {
        buffer: Array.from(new Uint8Array(audioBuffer)),
        sampleRate,
      },
      timestamp: Date.now(),
    };

    this.ws.send(JSON.stringify(message));
    console.log('[v0] Audio chunk sent');
  }

  /**
   * Send viseme request for lip sync
   */
  async sendVisemeRequest(text: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const message: WebSocketMessage = {
      type: 'viseme',
      data: { text },
      timestamp: Date.now(),
    };

    this.ws.send(JSON.stringify(message));
    console.log('[v0] Viseme request sent');
  }

  /**
   * Register a message handler
   */
  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);

    // Return unsubscribe function
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Broadcast message to all handlers
   */
  private broadcast(message: WebSocketMessage): void {
    this.messageHandlers.forEach((handler) => {
      try {
        handler(message);
      } catch (err) {
        console.error('[v0] Error in message handler:', err);
      }
    });
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[v0] Max reconnection attempts reached');
      this.broadcast({
        type: 'error',
        data: { message: 'Failed to reconnect to server' },
        timestamp: Date.now(),
      });
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`[v0] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch((err) => {
        console.error('[v0] Reconnection failed:', err);
      });
    }, delay);
  }
}

// Create singleton instance
let clientInstance: HolographicWebSocketClient | null = null;

export function getWebSocketClient(): HolographicWebSocketClient {
  if (!clientInstance) {
    clientInstance = new HolographicWebSocketClient();
  }
  return clientInstance;
}
