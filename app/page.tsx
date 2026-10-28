'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScanLine, TriangleAlert, X } from 'lucide-react';
import { HudBackdrop } from '@/components/hud/backdrop';
import { BootSequence, Reveal } from '@/components/hud/boot-sequence';
import { HudPanel, ScanHeader, TickColumn } from '@/components/hud/chrome';
import { CommandDock } from '@/components/hud/dock';
import { ConsolePanel } from '@/components/hud/console-panel';
import { HologramStage } from '@/components/hud/hologram-stage';
import { InsightLog } from '@/components/hud/insight-log';
import { LiveChart } from '@/components/hud/instruments/live-chart';
import { LiveWaveform } from '@/components/hud/instruments/live-waveform';
import { SpectrumBars } from '@/components/hud/instruments/spectrum-bars';
import {
  AudioPanel,
  IdentityPlate,
  LiveMeta,
  MemoryPanel,
  MetricLine,
  NetworkPanel,
  PerformancePanel,
  SensorPanel,
  SessionPanel,
} from '@/components/hud/readouts';
import { SettingsPanel } from '@/components/settings-panel';
import { ModelPicker } from '@/components/hud/model-picker';
import { FaceCapture } from '@/components/face-capture';
import { useAiAssistant, type LLMModel, type VoiceProvider } from '@/hooks/use-ai-assistant';
import { useFullDuplexAudio } from '@/hooks/use-full-duplex-audio';
import { usePersonaPlex } from '@/hooks/use-persona-plex';
import { useAgentManager } from '@/hooks/use-agent-manager';
import { useUptime, useLiveTitle } from '@/hooks/use-hud-telemetry';
import { useModelCatalogue } from '@/hooks/use-model-catalogue';
import { telemetry } from '@/lib/hud/telemetry';
import type { AvatarMode } from '@/lib/hud/avatar-face';

const MODE_COUNT = 4;

export default function Home() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [faceOpen, setFaceOpen] = useState(false);
  const [scanMode, setScanMode] = useState(0);
  const [scanPass, setScanPass] = useState(1);
  const [clock, setClock] = useState('--:--:--');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const {
    models: catalogueModels,
    providers: catalogueProviders,
    selectedModelId,
    selected: selectedModel,
    select: selectModel,
    loading: catalogueLoading,
    discover,
    discovering,
    discoverError,
    reload: reloadCatalogue,
  } = useModelCatalogue();
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>('google');
  const [speechSpeed, setSpeechSpeed] = useState(1);
  const [customEndpoint, setCustomEndpoint] = useState('');
  const [voicePrompt, setVoicePrompt] = useState<Blob | null>(null);
  const [rolePrompt, setRolePrompt] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  const { agents } = useAgentManager();
  const uptime = useUptime();
  useLiveTitle();

  const {
    isProcessing: isPersonaProcessing,
    playAudioChunk,
    updateVoicePrompt,
    updateRolePrompt,
  } = usePersonaPlex({ voicePrompt, rolePrompt });

  const handleAudioChunk = useCallback(
    (chunk: Int16Array | Float32Array, sampleRate: number) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'audio',
            data: chunk,
            format: chunk instanceof Int16Array ? 'int16' : 'float32',
            sampleRate,
          }),
        );
      }
    },
    [],
  );

  const { isStreaming, startStreaming, stopStreaming } = useFullDuplexAudio(handleAudioChunk, {
    sampleRate: 16000,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });

  const {
    isListening,
    isProcessing,
    messages,
    error: assistantError,
    toggleMicrophone,
    sendMessage,
  } = useAiAssistant({
    model: selectedModelId,
    voiceProvider,
    speechSpeed,
    customEndpoint,
  });

  /* -------------------- duplex websocket -------------------- */
  useEffect(() => {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!backendUrl) return;

    const ws = new WebSocket(backendUrl);
    wsRef.current = ws;
    telemetry.logEvent('duplex socket connecting');

    ws.onopen = () => telemetry.logEvent('duplex socket open', 'good');
    ws.onclose = () => telemetry.logEvent('duplex socket closed', 'warn');
    ws.onerror = () => telemetry.logEvent('duplex socket error', 'warn');

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'audio') {
          const audioBuffer = new ArrayBuffer(message.data.length * 2);
          const view = new Int16Array(audioBuffer);
          for (let i = 0; i < message.data.length; i += 1) view[i] = message.data[i];
          await playAudioChunk(audioBuffer, message.format || 'int16');
        }
      } catch (err) {
        console.error('[hud] audio frame rejected', err);
      }
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    };
  }, [playAudioChunk]);

  useEffect(() => {
    document.body.classList.add('dark');
    telemetry.set('engineReady', 1);
    telemetry.logEvent('console initialised', 'good');
  }, []);

  /* -------------------- derived machine state -------------------- */
  const mode: AvatarMode = isPersonaProcessing
    ? 'speaking'
    : isProcessing
      ? 'thinking'
      : isStreaming || isListening
        ? 'listening'
        : 'idle';

  const live = mode === 'listening' || mode === 'speaking';
  const thinking = mode === 'thinking' || mode === 'speaking';
  const status = mode === 'listening' ? 'LIVE' : thinking ? 'SYNTH' : 'IDLE';

  /* -------------------- real app insights -------------------- */
  useEffect(() => {
    telemetry.patch({
      messages: messages.length,
      agentsTotal: agents.length,
      agentsRunning: agents.filter((agent) => agent.status === 'running').length,
      gatewayConfigured: customEndpoint ? 1 : 0,
    });
  }, [agents, customEndpoint, messages.length]);

  useEffect(() => {
    telemetry.logEvent(`avatar mode · ${mode}`);
  }, [mode]);

  // scan progress mirrors the real frame rate once the renderer is warm
  const [progress, setProgress] = useState(42);
  useEffect(() => {
    const id = window.setInterval(() => {
      const fps = telemetry.get('fps');
      if (fps > 0) {
        setProgress(Math.round(Math.min(100, Math.max(8, (fps / 60) * 100))));
      }
    }, 1200);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      );
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const cycleMode = useCallback((direction: 1 | -1) => {
    setScanMode((current) => (current + direction + MODE_COUNT) % MODE_COUNT);
    telemetry.bump('interactions');
  }, []);

  const deepScan = useCallback(() => {
    setScanPass((pass) => {
      const next = pass + 1;
      telemetry.bump('scanPasses');
      telemetry.logEvent(`deep scan pass ${String(next).padStart(2, '0')}`, 'good');
      return next;
    });
    telemetry.bump('interactions');
  }, []);

  const toggleChannel = useCallback(() => {
    telemetry.bump('interactions');
    if (isStreaming) {
      stopStreaming();
      return;
    }
    startStreaming().catch((err) => {
      console.error('[hud] microphone channel failed', err);
      telemetry.logEvent('microphone permission denied', 'warn');
      toggleMicrophone();
    });
  }, [isStreaming, startStreaming, stopStreaming, toggleMicrophone]);

  const modeLabel = useMemo(
    () => ['neural', 'vocal', 'ocular', 'synaptic'][scanMode],
    [scanMode],
  );

  return (
    <main className="hud-root relative h-[100dvh] w-full overflow-clip bg-black">
      <HudBackdrop />
      <BootSequence />

      {/* ---------------------------- shell ---------------------------- */}
      <div className="relative z-10 flex h-full flex-col pb-[88px] md:pb-0">
        <ScanHeader
          mode={scanMode}
          onCycle={cycleMode}
          progress={progress}
          status={status}
          subjectId="01001"
          clock={clock}
          uptime={uptime}
        />

        <div className="relative flex min-h-0 flex-1 items-stretch gap-2 px-3 pt-2 sm:gap-3 sm:px-5">
          {/* ---------------- left rail ---------------- */}
          <div className="hidden w-[168px] flex-none flex-col gap-2 lg:flex xl:w-[192px]">
            <Reveal delay={80} className="flex-none">
              <PerformancePanel className="h-[136px]" />
            </Reveal>

            <Reveal delay={150} className="min-h-0 flex-1">
              <HudPanel title="insight log" meta="live" className="h-full" bodyClassName="overflow-hidden">
                <InsightLog className="h-full" />
              </HudPanel>
            </Reveal>

            <Reveal delay={220} className="flex-none">
              <SensorPanel live={live} className="h-[118px]" />
            </Reveal>

            <Reveal delay={280} className="flex-none">
              <IdentityPlate />
            </Reveal>
          </div>

          {/* ---------------- stage ---------------- */}
          <div className="relative flex min-w-0 flex-1 flex-col">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 hidden w-6 md:block">
              <TickColumn count={17} className="h-full py-2" />
            </div>
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 hidden w-6 md:block">
              <TickColumn count={17} align="right" className="h-full py-2" />
            </div>

            <div className="pointer-events-none relative z-10 flex flex-none flex-col items-center gap-1 px-8 pb-2 pt-1">
              <div className="flex items-center gap-2 font-mono text-[6.5px] uppercase tracking-[0.34em] text-[color:var(--hud-ink-dim)]">
                <span className="h-px w-8 bg-[color:var(--hud-line-strong)]" />
                {mode === 'listening'
                  ? 'voiceprint acquisition'
                  : mode === 'thinking'
                    ? 'reasoning · avatar thinking'
                    : mode === 'speaking'
                      ? 'synthesis · lips live'
                      : 'awaiting operator input'}
                <span className="h-px w-8 bg-[color:var(--hud-line-strong)]" />
              </div>
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[22px] font-light tracking-[0.28em] text-[color:var(--hud-ink)] sm:text-[28px]">
                  {modeLabel.toUpperCase()}
                </span>
                <span className="font-mono text-[6.5px] tracking-[0.3em] text-[color:var(--hud-ink-dim)]">
                  LVL {String(scanMode + 1).padStart(2, '0')}
                </span>
              </div>
            </div>

            <div className="relative min-h-0 flex-1">
              <HologramStage
                active={live}
                speaking={thinking}
                mode={mode}
                scanIndex={scanPass}
                onScan={deepScan}
              />
            </div>

            {/* compact mobile telemetry */}
            <div className="mt-1 grid flex-none grid-cols-3 gap-2 md:hidden">
              <HudPanel title="fps" className="h-[58px]">
                <LiveChart series="fps" min={0} max={70} className="h-7 w-full" />
              </HudPanel>
              <HudPanel title="latency" className="h-[58px]">
                <div className="flex h-full flex-col justify-center">
                  <MetricLine label="api" metric="latencyMs" unit="ms" />
                  <MetricLine label="level" metric="audioLevel" precision={2} tone="lime" />
                </div>
              </HudPanel>
              <HudPanel title="spectrum" className="h-[58px]">
                <SpectrumBars className="h-7 w-full" bars={12} />
              </HudPanel>
            </div>
          </div>

          {/* ---------------- right rail ---------------- */}
          <div className="hidden w-[168px] flex-none flex-col gap-2 xl:flex xl:w-[192px]">
            <Reveal delay={120} className="flex-none">
              <AudioPanel className="h-[136px]" />
            </Reveal>

            <Reveal delay={190} className="flex-none">
              <NetworkPanel className="h-[152px]" />
            </Reveal>

            <Reveal delay={250} className="flex-none">
              <MemoryPanel className="h-[104px]" />
            </Reveal>

            <Reveal delay={310} className="min-h-0 flex-1">
              <HudPanel title="voiceprint" meta={mode} className="h-full">
                <div className="flex h-full flex-col justify-between gap-2">
                  <LiveWaveform source="audio" className="h-16 w-full flex-none" />
                  <div className="flex flex-col gap-1">
                    <MetricLine label="inputs" metric="interactions" />
                    <MetricLine label="messages" metric="messages" />
                    <MetricLine label="agents" metric="agentsTotal" />
                    <MetricLine label="nodes" metric="domNodes" />
                  </div>
                  <div className="border-t border-[color:var(--hud-line)] pt-1.5 font-mono text-[6px] uppercase leading-[1.7] tracking-[0.2em] text-[color:var(--hud-ink-dim)]">
                    <div className="flex items-center justify-between gap-2">
                      <span>model</span>
                      <span className="truncate text-[color:var(--hud-ink)]">
                        {selectedModel?.label ?? (catalogueLoading ? 'loading…' : 'none')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>core</span>
                      <span className="truncate text-[color:var(--hud-ink)]">
                        {selectedModel?.provider ?? '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>voice</span>
                      <span className="text-[color:var(--hud-ink)]">{voiceProvider}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>speed</span>
                      <span className="text-[color:var(--hud-ink)]">{speechSpeed.toFixed(1)}x</span>
                    </div>
                  </div>
                </div>
              </HudPanel>
            </Reveal>
          </div>
        </div>

        {/* ---------------- bottom telemetry strip ---------------- */}
        <div className="relative z-20 hidden flex-none items-stretch gap-2 px-3 pb-2 sm:px-5 lg:flex lg:pr-[232px] xl:gap-3">
          <Reveal delay={320} className="w-[24%] max-w-[330px] min-w-[180px]">
            <HudPanel
              title="microphone trace"
              meta={mode === 'listening' || mode === 'speaking' ? 'live' : 'idle'}
              className="h-[76px]"
            >
              <LiveWaveform source="audio" className="h-full w-full" />
            </HudPanel>
          </Reveal>

          <Reveal delay={380} className="w-[15%] max-w-[210px] min-w-[140px]">
            <HudPanel title="spectrum" meta="fft" className="h-[76px]">
              <SpectrumBars className="h-full w-full" bars={16} />
            </HudPanel>
          </Reveal>

          {/* dock reservation */}
          <div className="min-w-[280px] flex-1" />

          <Reveal delay={440} className="w-[18%] max-w-[240px] min-w-[150px]">
            <HudPanel title="heap trace" meta="mb" className="h-[76px]">
              <LiveChart series="heap" className="h-full w-full" showScale unit="mb" />
            </HudPanel>
          </Reveal>

          <Reveal delay={500} className="hidden w-[118px] flex-none 2xl:block">
            <SessionPanel className="h-[76px]" />
          </Reveal>
        </div>

        {/* mobile status rail */}
        <div className="flex flex-none items-center justify-between gap-2 border-t border-[color:var(--hud-line)] px-4 py-1.5 font-mono text-[6.5px] uppercase tracking-[0.26em] text-[color:var(--hud-ink-dim)] md:hidden">
          <span className="flex items-center gap-1.5">
            <ScanLine size={9} /> {status}
          </span>
          <LiveMeta metric="fps" precision={0} suffix=" fps" />
          <span className="text-[color:var(--hud-ink)]">{clock}</span>
        </div>
      </div>

      {/* ---------------------------- overlays ---------------------------- */}
      {/* A failed model call must be visible: the route returns { error, code, fix } */}
      {assistantError && assistantError !== dismissedError && (
        <div className="pointer-events-auto fixed inset-x-3 bottom-[112px] z-[66] mx-auto flex w-fit max-w-[min(94vw,680px)] items-start gap-2 rounded border border-[#ff9d7a]/50 bg-[#1a0a05]/95 px-3 py-2 shadow-[0_0_40px_rgba(255,157,122,0.18)] backdrop-blur-sm">
          <TriangleAlert size={13} className="mt-[2px] flex-none text-[#ff9d7a]" />
          <p className="font-mono text-[8px] uppercase leading-[1.7] tracking-[0.14em] text-[#ffd9c9]">
            {assistantError}
          </p>
          <button
            type="button"
            onClick={() => setDismissedError(assistantError)}
            aria-label="Dismiss error"
            className="ml-1 flex-none rounded border border-[#ff9d7a]/40 p-1 text-[#ff9d7a] transition hover:bg-[#ff9d7a]/15"
          >
            <X size={10} />
          </button>
        </div>
      )}

      <CommandDock
        live={live}
        thinking={thinking}
        chatOpen={consoleOpen}
        onMicToggle={toggleChannel}
        onChatToggle={() => {
          telemetry.bump('interactions');
          setConsoleOpen((open) => !open);
        }}
        onFaceToggle={() => {
          telemetry.bump('interactions');
          setFaceOpen((open) => !open);
        }}
        onSettings={() => setIsSettingsOpen(true)}
        onDeepScan={deepScan}
        onModels={() => setPickerOpen(true)}
        modelLabel={selectedModel?.label}
      />

      <ModelPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        models={catalogueModels}
        providers={catalogueProviders}
        selectedModelId={selectedModelId}
        onSelect={(id) => {
          selectModel(id);
          telemetry.logEvent(`model switched · ${id}`);
        }}
        onDiscover={discover}
        discoverError={discoverError}
        discovering={discovering}
        onReload={reloadCatalogue}
        loading={catalogueLoading}
      />

      <ConsolePanel
        open={consoleOpen}
        onClose={() => setConsoleOpen(false)}
        messages={messages}
        onSubmit={(value) => {
          telemetry.bump('messages');
          telemetry.logEvent('directive dispatched');
          sendMessage(value);
        }}
        thinking={thinking}
        model={selectedModel?.label ?? selectedModelId}
      />

      <FaceCapture
        open={faceOpen}
        onOpenChange={setFaceOpen}
        hideTrigger
        onCaptureSent={() => {
          setScanPass((pass) => pass + 1);
          telemetry.bump('scanPasses');
          telemetry.logEvent('biometric capture uploaded', 'good');
        }}
      />

      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        llmModel={selectedModelId}
        onLlmModelChange={(model) => selectModel(model)}
        models={catalogueModels}
        onOpenModelCatalogue={() => setPickerOpen(true)}
        voiceProvider={voiceProvider}
        onVoiceProviderChange={(provider) => setVoiceProvider(provider as VoiceProvider)}
        speechSpeed={speechSpeed}
        onSpeechSpeedChange={setSpeechSpeed}
        customEndpoint={customEndpoint}
        onCustomEndpointChange={setCustomEndpoint}
        onVoicePromptChange={(blob) => {
          setVoicePrompt(blob);
          if (blob) updateVoicePrompt(blob);
        }}
        onRolePromptChange={(text) => {
          setRolePrompt(text);
          updateRolePrompt(text);
        }}
      />
    </main>
  );
}
