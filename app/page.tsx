'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { HudBackdrop } from '@/components/hud/backdrop';
import { BootSequence, Reveal } from '@/components/hud/boot-sequence';
import { HudPanel, Metric, ScanHeader, TickColumn } from '@/components/hud/chrome';
import { CommandDock } from '@/components/hud/dock';
import { ConsolePanel } from '@/components/hud/console-panel';
import { HologramStage } from '@/components/hud/hologram-stage';
import { NeuralLog } from '@/components/hud/neural-log';
import { ArcGauge } from '@/components/hud/instruments/arc-gauge';
import { BarMatrix } from '@/components/hud/instruments/bar-matrix';
import { RingCluster, SegmentedMeter } from '@/components/hud/instruments/ring-cluster';
import { Sparkline } from '@/components/hud/instruments/sparkline';
import { Waveform } from '@/components/hud/instruments/waveform';
import { SettingsPanel } from '@/components/settings-panel';
import { FaceCapture } from '@/components/face-capture';
import { useAiAssistant, type LLMModel, type VoiceProvider } from '@/hooks/use-ai-assistant';
import { useFullDuplexAudio } from '@/hooks/use-full-duplex-audio';
import { usePersonaPlex } from '@/hooks/use-persona-plex';

const MODE_COUNT = 4;

export default function Home() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [faceOpen, setFaceOpen] = useState(false);
  const [scanMode, setScanMode] = useState(0);
  const [scanPass, setScanPass] = useState(1);
  const [clock, setClock] = useState('--:--:--');
  const [progress, setProgress] = useState(42);

  const [llmModel, setLlmModel] = useState<LLMModel>('gemini-2.0-flash');
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>('google');
  const [speechSpeed, setSpeechSpeed] = useState(1);
  const [customEndpoint, setCustomEndpoint] = useState('');
  const [voicePrompt, setVoicePrompt] = useState<Blob | null>(null);
  const [rolePrompt, setRolePrompt] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

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
    toggleMicrophone,
    sendMessage,
  } = useAiAssistant({ model: llmModel, voiceProvider, speechSpeed, customEndpoint });

  /* -------------------- duplex websocket -------------------- */
  useEffect(() => {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!backendUrl) return;

    const ws = new WebSocket(backendUrl);
    wsRef.current = ws;

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
  }, []);

  /* -------------------- derived machine state -------------------- */
  const live = isStreaming || isListening;
  const thinking = isProcessing || isPersonaProcessing;
  const status = live ? 'LIVE' : thinking ? 'SYNTH' : 'IDLE';
  const energy = thinking ? 0.95 : live ? 0.66 : 0.26;

  useEffect(() => {
    setProgress(thinking ? 92 : live ? 71 : 42);
  }, [live, thinking]);

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
    setScanMode((mode) => (mode + direction + MODE_COUNT) % MODE_COUNT);
  }, []);

  const deepScan = useCallback(() => {
    setScanPass((pass) => pass + 1);
  }, []);

  const toggleChannel = useCallback(() => {
    if (isStreaming) {
      stopStreaming();
      return;
    }
    startStreaming().catch((err) => {
      console.error('[hud] microphone channel failed', err);
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
        />

        <div className="relative flex min-h-0 flex-1 items-stretch gap-2 px-3 pt-2 sm:px-5 sm:gap-3">
          {/* ---------------- left rail ---------------- */}
          <div className="hidden w-[164px] flex-none flex-col gap-2 lg:flex xl:w-[188px]">
            <Reveal delay={80} className="flex-none">
              <HudPanel title="sensor array" meta={live ? 'tracking' : 'idle'} className="h-[150px]">
                <div className="flex h-full items-center justify-center">
                  <RingCluster size={104} active={live} label="lidar // 360" />
                </div>
              </HudPanel>
            </Reveal>

            <Reveal delay={160} className="min-h-0 flex-1">
              <HudPanel
                title="neural scan"
                meta={thinking ? 'in progress' : 'stable'}
                className="h-full"
                bodyClassName="overflow-hidden"
              >
                <NeuralLog rows={13} active={live || thinking} className="h-full" />
              </HudPanel>
            </Reveal>

            <Reveal delay={240} className="flex-none">
              <HudPanel title="neural flux" meta="σ 0.42" className="h-[86px]">
                <Sparkline seed={11} className="h-11 w-full" points={30} />
              </HudPanel>
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

            {/* stage heading */}
            <div className="pointer-events-none relative z-10 flex flex-none flex-col items-center gap-1 px-8 pb-2 pt-1">
              <div className="flex items-center gap-2 font-mono text-[6.5px] uppercase tracking-[0.34em] text-[color:var(--hud-ink-dim)]">
                <span className="h-px w-8 bg-[color:var(--hud-line-strong)]" />
                {live
                  ? 'voiceprint acquisition'
                  : thinking
                    ? 'synthesis in progress'
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
                scanIndex={scanPass}
                onScan={deepScan}
              />
            </div>

            {/* compact mobile telemetry */}
            <div className="mt-1 grid flex-none grid-cols-3 gap-2 md:hidden">
              <HudPanel title="flux" className="h-[54px]">
                <Sparkline seed={3} points={18} showMarker={false} className="h-6 w-full" />
              </HudPanel>
              <HudPanel title="level" className="h-[54px]">
                <div className="flex h-full items-center justify-center pt-1">
                  <span className="font-mono text-[13px] tabular-nums text-[color:var(--hud-ink)]">
                    {progress}%
                  </span>
                </div>
              </HudPanel>
              <HudPanel title="cortex" className="h-[54px]">
                <BarMatrix bars={11} active={live} className="h-6" />
              </HudPanel>
            </div>
          </div>

          {/* ---------------- right rail ---------------- */}
          <div className="hidden w-[164px] flex-none flex-col gap-2 xl:flex xl:w-[188px]">
            <Reveal delay={120} className="flex-none">
              <HudPanel title="cerebral" meta="activation" className="h-[150px]">
                <div className="flex h-full items-center justify-between gap-2 px-1">
                  <ArcGauge value={thinking ? 96 : live ? 84 : 76} size={78} stroke={4} />
                  <div className="flex h-full flex-col justify-center gap-1.5">
                    <Metric label="sync" value={live ? 0.94 : 0.72} decimals={2} tone="mint" />
                    <Metric label="load" value={thinking ? 88 : 43} unit="%" />
                    <Metric label="jitter" value={1.4} decimals={1} unit="ms" />
                  </div>
                </div>
              </HudPanel>
            </Reveal>

            <Reveal delay={200} className="flex-none">
              <HudPanel title="output level" meta={`${progress}%`} className="h-[126px]">
                <div className="flex h-full items-center gap-3">
                  <SegmentedMeter value={progress} segments={16} active={live} className="h-full w-2.5 flex-none" />
                  <div className="flex h-full flex-1 flex-col justify-between gap-1 py-0.5">
                    <Metric label="peak" value={live ? 78 : 46} unit="db" />
                    <Metric label="gain" value={live ? 6.2 : 3.1} decimals={1} unit="x" />
                    <Metric label="drive" value={thinking ? 92 : 38} unit="%" tone="lime" />
                  </div>
                </div>
              </HudPanel>
            </Reveal>

            <Reveal delay={280} className="min-h-0 flex-1">
              <HudPanel title="carrier" meta="duplex" className="h-full">
                <div className="flex h-full flex-col justify-between gap-2">
                  <Waveform
                    className="h-16 w-full flex-none"
                    active={live}
                    energy={energy}
                    variant="scope"
                  />

                  <div className="flex-none">
                    <div className="mb-1 flex items-center justify-between font-mono text-[6px] uppercase tracking-[0.24em] text-[color:var(--hud-ink-dim)]">
                      <span>voiceprint</span>
                      <span className="text-[color:var(--hud-lime)]">
                        {live ? 'capturing' : 'armed'}
                      </span>
                    </div>
                    <BarMatrix
                      bars={15}
                      active={live || thinking}
                      intensity={energy}
                      className="h-8 w-full"
                    />
                  </div>

                  <div className="holo-scanlines h-px w-full flex-none" />

                  <div className="flex flex-none flex-col gap-1">
                    <Metric label="rate" value={live ? 48 : 16} unit="khz" />
                    <Metric label="frame" value={thinking ? 92 : 64} unit="ms" />
                    <Metric label="dropout" value={0} unit="%" tone="mint" />
                  </div>

                  <div className="flex-none border-t border-[color:var(--hud-line)] pt-1.5 font-mono text-[6px] uppercase leading-[1.7] tracking-[0.22em] text-[color:var(--hud-ink-dim)]">
                    <div className="flex items-center justify-between">
                      <span>model</span>
                      <span className="truncate text-[color:var(--hud-ink)]">{llmModel}</span>
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
          <Reveal delay={320} className="w-[26%] max-w-[340px] min-w-[190px]">
            <HudPanel title="carrier wave" meta="16 khz" className="h-[76px]">
              <Waveform className="h-full w-full" active={live} energy={energy} />
            </HudPanel>
          </Reveal>

          <Reveal delay={380} className="w-[17%] max-w-[220px] min-w-[150px]">
            <HudPanel title="spectrum" meta={thinking ? 'hot' : 'nominal'} className="h-[76px]">
              <BarMatrix bars={17} active={live || thinking} intensity={energy} className="h-full" />
            </HudPanel>
          </Reveal>

          {/* dock reservation */}
          <div className="min-w-[280px] flex-1" />

          <Reveal delay={440} className="w-[20%] max-w-[260px] min-w-[150px]">
            <HudPanel
              title="subject trace"
              meta={`pass ${String(scanPass).padStart(2, '0')}`}
              className="h-[76px]"
            >
              <Sparkline seed={scanPass + 4} className="h-full w-full" points={34} />
            </HudPanel>
          </Reveal>

          <Reveal delay={500} className="hidden w-[118px] flex-none 2xl:block">
            <HudPanel title="coherence" meta="76" className="h-[76px]">
              <div className="flex h-full items-center justify-center">
                <ArcGauge value={thinking ? 92 : live ? 81 : 76} size={56} stroke={3.5} showValue={false} />
              </div>
            </HudPanel>
          </Reveal>
        </div>

        {/* mobile status rail */}
        <div className="flex flex-none items-center justify-between gap-2 border-t border-[color:var(--hud-line)] px-4 py-1.5 font-mono text-[6.5px] uppercase tracking-[0.26em] text-[color:var(--hud-ink-dim)] md:hidden">
          <span className="flex items-center gap-1.5">
            <ScanLine size={9} /> {status}
          </span>
          <span>{llmModel}</span>
          <span className="text-[color:var(--hud-ink)]">{clock}</span>
        </div>
      </div>

      {/* ---------------------------- overlays ---------------------------- */}
      <CommandDock
        live={live}
        thinking={thinking}
        chatOpen={consoleOpen}
        onMicToggle={toggleChannel}
        onChatToggle={() => setConsoleOpen((open) => !open)}
        onFaceToggle={() => setFaceOpen((open) => !open)}
        onSettings={() => setIsSettingsOpen(true)}
        onDeepScan={deepScan}
      />

      <ConsolePanel
        open={consoleOpen}
        onClose={() => setConsoleOpen(false)}
        messages={messages}
        onSubmit={sendMessage}
        thinking={thinking}
        model={llmModel}
      />

      <FaceCapture
        open={faceOpen}
        onOpenChange={setFaceOpen}
        hideTrigger
        onCaptureSent={() => setScanPass((pass) => pass + 1)}
      />

      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        llmModel={llmModel}
        onLlmModelChange={(model) => setLlmModel(model as LLMModel)}
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
