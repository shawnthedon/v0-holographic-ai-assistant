'use client';

/**
 * Real application telemetry for the HUD.
 *
 * Everything the console displays is measured from the running application —
 * frame timing, long tasks, JS heap, DOM size, probe latency, network hints,
 * microphone level/spectrum, assistant state and user interaction counts.
 * Nothing is invented; when a value is unavailable the HUD shows it as such.
 */

export type HudMetricKey =
  | 'fps'
  | 'frameMs'
  | 'frameWorst'
  | 'jankPct'
  | 'longTasks'
  | 'longTaskMs'
  | 'heapMB'
  | 'heapLimitMB'
  | 'heapPct'
  | 'domNodes'
  | 'latencyMs'
  | 'apiUp'
  | 'pingFails'
  | 'online'
  | 'rttMs'
  | 'downlinkMbps'
  | 'uptimeSec'
  | 'interactions'
  | 'scanPasses'
  | 'messages'
  | 'audioLevel'
  | 'audioPeak'
  | 'audioDb'
  | 'sampleRate'
  | 'micActive'
  | 'agentsTotal'
  | 'agentsRunning'
  | 'gatewayConfigured'
  | 'localModels'
  | 'localLoaded'
  | 'engineReady';

export type HudMetrics = Record<HudMetricKey, number>;

export type HistoryKey = 'fps' | 'frame' | 'latency' | 'heap' | 'audio';

const HISTORY_LENGTH = 120;
const SPECTRUM_BINS = 20;

const DEFAULTS: HudMetrics = {
  fps: 0,
  frameMs: 0,
  frameWorst: 0,
  jankPct: 0,
  longTasks: 0,
  longTaskMs: 0,
  heapMB: 0,
  heapLimitMB: 0,
  heapPct: 0,
  domNodes: 0,
  latencyMs: 0,
  apiUp: 0,
  pingFails: 0,
  online: 1,
  rttMs: 0,
  downlinkMbps: 0,
  uptimeSec: 0,
  interactions: 0,
  scanPasses: 1,
  messages: 0,
  audioLevel: 0,
  audioPeak: 0,
  audioDb: -90,
  sampleRate: 0,
  micActive: 0,
  agentsTotal: 0,
  agentsRunning: 0,
  gatewayConfigured: 0,
  localModels: 0,
  localLoaded: 0,
  engineReady: 0,
};

export interface HudEvent {
  id: number;
  at: number;
  text: string;
  tone: 'info' | 'good' | 'warn';
}

type Listener = () => void;

class HudTelemetry {
  metrics: HudMetrics = { ...DEFAULTS };

  history: Record<HistoryKey, number[]> = {
    fps: new Array(HISTORY_LENGTH).fill(0),
    frame: new Array(HISTORY_LENGTH).fill(0),
    latency: new Array(HISTORY_LENGTH).fill(0),
    heap: new Array(HISTORY_LENGTH).fill(0),
    audio: new Array(HISTORY_LENGTH).fill(0),
  };

  /** 0..255 frequency magnitudes, filled from a real AnalyserNode. */
  spectrum: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(SPECTRUM_BINS));
  /** downsampled live waveform (centred around 128) for the oscilloscope */
  waveform: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(256)).fill(128);
  /** rolling application insight log */
  events: HudEvent[] = [];
  private eventId = 0;
  private lastStatusKey = '';
  /** true when the spectrum is coming from a live microphone node */
  spectrumLive = false;

  private listeners = new Set<Listener>();
  private refCount = 0;
  private raf = 0;
  private notifyAccumulator = 0;
  private frameAccumulator = 0;
  private frameCount = 0;
  private frameWindowWorst = 0;
  private lastFrameAt = 0;
  private lastTickAt = 0;
  private lastPingAt = 0;
  private lastDomSampleAt = 0;
  private heartbeat = 0;
  private startedAt = typeof performance !== 'undefined' ? performance.now() : 0;
  private analyser: AnalyserNode | null = null;
  private timeDomain: Uint8Array<ArrayBuffer> | null = null;
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private longTaskObserver: PerformanceObserver | null = null;

  /* ------------------------------------------------------------------ */

  get<K extends HudMetricKey>(key: K): number {
    return this.metrics[key];
  }

  set<K extends HudMetricKey>(key: K, value: number) {
    if (this.metrics[key] === value) return;
    this.metrics[key] = value;
  }

  patch(values: Partial<HudMetrics>) {
    Object.assign(this.metrics, values);
  }

  bump(key: 'interactions' | 'scanPasses' | 'messages', by = 1) {
    this.metrics[key] += by;
  }

  /** Record a real application event for the insight log. */
  logEvent(text: string, tone: HudEvent['tone'] = 'info') {
    this.eventId += 1;
    this.events = [
      ...this.events.slice(-5),
      { id: this.eventId, at: Date.now(), text, tone },
    ];
    this.notify();
  }

  attachAnalyser(node: AnalyserNode | null, sampleRate = 0) {
    this.analyser = node;
    if (node) {
      this.timeDomain = new Uint8Array(new ArrayBuffer(node.fftSize));
      this.freqData = new Uint8Array(new ArrayBuffer(node.frequencyBinCount));
      this.set('sampleRate', sampleRate);
      this.set('micActive', 1);
    } else {
      this.timeDomain = null;
      this.freqData = null;
      this.set('micActive', 0);
      this.set('audioLevel', 0);
      this.set('audioDb', -90);
      this.spectrumLive = false;
      this.spectrum.fill(0);
    }
  }

  /* ------------------------------------------------------------------ */

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    this.refCount += 1;
    if (this.refCount === 1) this.start();
    return () => {
      this.listeners.delete(listener);
      this.refCount -= 1;
      if (this.refCount === 0) this.stop();
    };
  };

  private notify() {
    this.listeners.forEach((listener) => listener());
  }

  private start() {
    if (typeof window === 'undefined' || this.raf) return;
    this.startedAt = performance.now();
    this.lastTickAt = performance.now();
    this.lastFrameAt = performance.now();

    this.set('online', navigator.onLine ? 1 : 0);
    this.readNetworkHints();
    this.pingHealth();

    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        this.metrics.longTasks += entries.length;
        const worst = entries.reduce((max, entry) => Math.max(max, entry.duration), 0);
        this.metrics.longTaskMs += entries.reduce((sum, entry) => sum + entry.duration, 0);
        if (worst > 60) {
          this.logEvent(`long task blocked ui · ${Math.round(worst)}ms`, 'warn');
        }
      });
      this.longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch {
      /* longtask unsupported — counter simply stays at zero */
    }

    window.addEventListener('online', this.onNetworkChange);
    window.addEventListener('offline', this.onNetworkChange);

    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      this.tick(now);
    };
    this.raf = requestAnimationFrame(loop);

    // A backgrounded tab stops painting, so RAF stalls. This heartbeat keeps
    // uptime, heap, DOM size and the health probe honest while it does, and
    // reports a true 0 fps instead of a stale reading.
    this.heartbeat = window.setInterval(() => this.beat(), 1000);
  }

  private beat() {
    const now = performance.now();
    if (now - this.lastFrameAt > 1500 && this.metrics.fps !== 0) {
      this.set('fps', 0);
      this.set('frameMs', 0);
      this.push('fps', 0);
      this.notify();
    }

    this.set('uptimeSec', Math.round((now - this.startedAt) / 1000));

    const memory = (performance as Performance & {
      memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
    }).memory;
    if (memory) {
      const used = memory.usedJSHeapSize / 1048576;
      const limit = memory.jsHeapSizeLimit / 1048576;
      this.set('heapMB', Number(used.toFixed(1)));
      this.set('heapLimitMB', Math.round(limit));
      this.set('heapPct', Number(((used / limit) * 100).toFixed(1)));
      this.push('heap', this.metrics.heapMB);
    }

    if (now - this.lastDomSampleAt > 900) {
      this.lastDomSampleAt = now;
      this.set('domNodes', document.getElementsByTagName('*').length);
    }

    if (now - this.lastPingAt > 9000) {
      this.lastPingAt = now;
      this.pingHealth();
    }
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.heartbeat) window.clearInterval(this.heartbeat);
    this.heartbeat = 0;
    this.longTaskObserver?.disconnect();
    this.longTaskObserver = null;
    window.removeEventListener('online', this.onNetworkChange);
    window.removeEventListener('offline', this.onNetworkChange);
  }

  private onNetworkChange = () => {
    this.set('online', navigator.onLine ? 1 : 0);
    this.readNetworkHints();
  };

  private readNetworkHints() {
    const connection = (navigator as Navigator & {
      connection?: { rtt?: number; downlink?: number };
    }).connection;
    if (connection) {
      this.set('rttMs', Math.round(connection.rtt ?? 0));
      this.set('downlinkMbps', Number((connection.downlink ?? 0).toFixed(1)));
    }
  }

  private tick(now: number) {
    const delta = now - this.lastFrameAt;
    this.lastFrameAt = now;

    /* ---- frame timing ---- */
    if (delta > 0 && delta < 1000) {
      this.frameCount += 1;
      this.frameAccumulator += delta;
      if (delta > this.frameWindowWorst) this.frameWindowWorst = delta;
      if (delta > 20) {
        const jank = this.metrics.jankPct * 0.9 + (delta > 33 ? 1 : 0.35) * 10;
        this.set('jankPct', Math.min(100, Number(jank.toFixed(1))));
      } else {
        this.set('jankPct', Number((this.metrics.jankPct * 0.98).toFixed(1)));
      }
    }

    /* ---- audio level / spectrum (single place, real analyser) ---- */
    if (this.analyser && this.timeDomain) {
      this.analyser.getByteTimeDomainData(this.timeDomain);
      let sumSquares = 0;
      for (let i = 0; i < this.timeDomain.length; i += 1) {
        const centred = (this.timeDomain[i] - 128) / 128;
        sumSquares += centred * centred;
      }
      const rms = Math.sqrt(sumSquares / this.timeDomain.length);
      const db = 20 * Math.log10(rms + 1e-6);
      this.set('audioLevel', Number(rms.toFixed(4)));
      this.set('audioDb', Math.round(db));
      if (rms > this.metrics.audioPeak) this.set('audioPeak', Number(rms.toFixed(4)));

      // downsample the time-domain buffer for the oscilloscope
      const stepSize = Math.floor(this.timeDomain.length / this.waveform.length);
      for (let i = 0; i < this.waveform.length; i += 1) {
        this.waveform[i] = this.timeDomain[i * stepSize];
      }

      if (this.freqData) {
        this.analyser.getByteFrequencyData(this.freqData);
        this.spectrumLive = true;
        const usable = Math.floor(this.freqData.length * 0.55);
        const binSize = Math.max(1, Math.floor(usable / SPECTRUM_BINS));
        for (let bin = 0; bin < SPECTRUM_BINS; bin += 1) {
          let peak = 0;
          const start = bin * binSize;
          for (let i = start; i < start + binSize && i < this.freqData.length; i += 1) {
            if (this.freqData[i] > peak) peak = this.freqData[i];
          }
          this.spectrum[bin] = peak;
        }
      }
    } else if (this.metrics.micActive) {
      this.set('micActive', 0);
    }

    /* ---- 5 Hz notification cadence ---- */
    if (now - this.lastTickAt >= 200) {
      const elapsed = now - this.lastTickAt;
      this.lastTickAt = now;

      const frames = Math.max(1, this.frameCount);
      const avg = this.frameAccumulator / frames;
      this.set('fps', Math.round((1000 / Math.max(avg, 0.5)) * 10) / 10);
      this.set('frameMs', Math.round(avg * 100) / 100);
      this.set('frameWorst', Math.round(this.frameWindowWorst * 10) / 10);
      this.push('fps', this.metrics.fps);
      this.push('frame', this.metrics.frameMs);
      this.frameCount = 0;
      this.frameAccumulator = 0;
      this.frameWindowWorst = 0;

      this.set('uptimeSec', Math.round((now - this.startedAt) / 1000));
      this.push('audio', this.metrics.audioLevel * 100);

      const memory = (performance as Performance & {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
      }).memory;
      if (memory) {
        const used = memory.usedJSHeapSize / 1048576;
        const limit = memory.jsHeapSizeLimit / 1048576;
        this.set('heapMB', Number(used.toFixed(1)));
        this.set('heapLimitMB', Math.round(limit));
        this.set('heapPct', Number(((used / limit) * 100).toFixed(1)));
        this.push('heap', this.metrics.heapMB);
      }

      if (now - this.lastDomSampleAt > 1000) {
        this.lastDomSampleAt = now;
        this.set('domNodes', document.getElementsByTagName('*').length);
      }

      if (now - this.lastPingAt > 9000) {
        this.lastPingAt = now;
        this.pingHealth();
      }

      const statusKey = `${this.metrics.micActive}|${this.metrics.apiUp}|${this.metrics.online}`;
      if (statusKey !== this.lastStatusKey) {
        if (this.lastStatusKey) {
          const [micWas, apiWas, onlineWas] = this.lastStatusKey.split('|').map(Number);
          if (micWas !== this.metrics.micActive) {
            this.logEvent(
              this.metrics.micActive
                ? `microphone channel open · ${Math.round(this.metrics.sampleRate / 1000)}khz`
                : 'microphone channel closed',
              this.metrics.micActive ? 'good' : 'info',
            );
          }
          if (apiWas !== this.metrics.apiUp && this.metrics.apiUp) {
            this.logEvent('api reachable', 'good');
          }
          if (onlineWas !== this.metrics.online) {
            this.logEvent(this.metrics.online ? 'network online' : 'network offline', this.metrics.online ? 'good' : 'warn');
          }
        }
        this.lastStatusKey = statusKey;
      }

      this.notifyAccumulator = 0;
      this.notify();
    }
  }

  private push(key: HistoryKey, value: number) {
    const series = this.history[key];
    series.push(value);
    if (series.length > HISTORY_LENGTH) series.shift();
  }

  /** Real round-trip measurement against the app's own health route. */
  private async pingHealth() {
    if (typeof fetch === 'undefined') return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    const started = performance.now();
    try {
      const response = await fetch(`/api/health?t=${Math.round(started)}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const rtt = performance.now() - started;
      const previous = this.metrics.apiUp;
      this.set('latencyMs', Math.round(rtt));
      this.set('apiUp', response.ok ? 1 : 0);
      this.push('latency', Math.round(rtt));

      if (previous === 0) {
        this.logEvent(`health probe restored · ${Math.round(rtt)}ms`, 'good');
      } else if (rtt > 400) {
        this.logEvent(`slow probe · ${Math.round(rtt)}ms`, 'warn');
      }
    } catch {
      this.set('apiUp', 0);
      this.set('pingFails', this.metrics.pingFails + 1);
      this.logEvent('health probe failed', 'warn');
    } finally {
      window.clearTimeout(timeout);
      this.notify();
    }
  }
}

const globalRef = globalThis as typeof globalThis & { __hudTelemetry?: HudTelemetry };

export const telemetry = (() => {
  if (!globalRef.__hudTelemetry) {
    globalRef.__hudTelemetry = new HudTelemetry();
  }
  return globalRef.__hudTelemetry;
})();

export const HISTORY_LENGTH_EXPORT = HISTORY_LENGTH;
export const SPECTRUM_BINS_EXPORT = SPECTRUM_BINS;
