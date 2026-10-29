'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { animate } from 'animejs';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Cpu,
  Download,
  HardDrive,
  Import,
  Loader2,
  Pause,
  Play,
  ShieldCheck,
  Square,
  Trash2,
  Unplug,
  X,
} from 'lucide-react';
import { EASE, useReducedMotion } from '@/lib/hud/motion';
import { formatBytes, RAM_CAUTION } from '@/lib/device-ai/catalogue';
import type { DownloadJob, LocalModel } from '@/lib/device-ai/types';
import type { HfFile } from '@/hooks/use-device-ai';

type DeviceAi = ReturnType<typeof import('@/hooks/use-device-ai').useDeviceAi>;

interface LocalAiPanelProps {
  open: boolean;
  onClose: () => void;
  device: DeviceAi;
  /** Selecting an installed model routes chat to it. */
  onUseModel?: (modelId: string) => void;
}

const STATE_TONE: Record<LocalModel['state'], string> = {
  installed: 'text-[color:var(--hud-mint)]',
  loaded: 'text-[color:var(--hud-lime)]',
  downloading: 'text-[color:var(--hud-cyan,#5fd3ff)]',
  paused: 'text-[#ffd27a]',
  verifying: 'text-[#ffd27a]',
  importing: 'text-[#ffd27a]',
  loading: 'text-[#ffd27a]',
  unloading: 'text-[#ffd27a]',
  available: 'text-[color:var(--hud-ink-dim)]',
  queued: 'text-[color:var(--hud-ink-dim)]',
  error: 'text-[#ff9d7a]',
  cancelled: 'text-[#ff9d7a]',
};

function Spark({ value }: { value: number }) {
  const filled = Math.max(0, Math.min(1, value));
  return (
    <span className="relative block h-1 w-full overflow-hidden rounded-full bg-white/10">
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--hud-lime)] transition-[width] duration-200"
        style={{ width: `${filled * 100}%` }}
      />
    </span>
  );
}

export function LocalAiPanel({ open, onClose, device, onUseModel }: LocalAiPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const reduced = useReducedMotion();
  const [tab, setTab] = useState<'library' | 'catalogue' | 'system'>('library');
  const [customUrl, setCustomUrl] = useState('');
  const [repo, setRepo] = useState('');
  const [files, setFiles] = useState<HfFile[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [testPrompt, setTestPrompt] = useState('In one sentence, what are you?');
  const [output, setOutput] = useState('');
  const [generated, setGenerated] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  useEffect(() => {
    if (!open || reduced || !panelRef.current) return;
    animate(panelRef.current, {
      opacity: [0, 1],
      scale: [0.98, 1],
      translateY: [12, 0],
      duration: 320,
      ease: EASE.out,
    });
  }, [open, reduced]);

  const jobsByModel = useMemo(() => {
    const map = new Map<string, DownloadJob>();
    for (const job of device.jobs) {
      if (!map.has(job.modelId)) map.set(job.modelId, job);
    }
    return map;
  }, [device.jobs]);

  /** Catalogue entries that are not installed yet. */
  const installable = useMemo(
    () => device.catalogue.filter((entry) => !device.models.some((model) => model.id === entry.id)),
    [device.catalogue, device.models],
  );

  if (!open) return null;

  const caps = device.capabilities;
  const storage = device.storage;

  const runTest = async () => {
    setOutput('');
    const result = await device.generate(testPrompt, { maxTokens: 120 });
    if (result) {
      setOutput(result.text);
      setGenerated(
        [
          result.tokens ? `${result.tokens} tokens` : 'tokens n/a',
          result.firstTokenMs !== null ? `first token ${result.firstTokenMs}ms` : 'first token n/a',
          result.tokensPerSecond ? `${result.tokensPerSecond} tok/s` : 'rate n/a',
          result.stopped ? 'stopped' : 'completed',
        ].join(' · '),
      );
    }
  };

  return (
    <div className="fixed inset-0 z-[72] flex items-start justify-center bg-black/85 p-3 pt-[5vh] backdrop-blur-sm">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Local AI"
        className="relative flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded border border-[color:var(--hud-line-strong)] bg-[#030c10]/97 shadow-[0_0_80px_rgba(46,242,192,0.16)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[color:var(--hud-line)] px-4 py-3">
          <div>
            <p className="font-mono text-[8px] uppercase tracking-[0.34em] text-[color:var(--hud-ink-dim)]">
              local inference · on device
            </p>
            <h2 className="font-mono text-[13px] tracking-[0.18em] text-[color:var(--hud-ink)]">
              OFFLINE MODEL BAY
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close local AI"
            className="rounded border border-[color:var(--hud-line)] p-1.5 text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-line-strong)] hover:text-[color:var(--hud-ink)]"
          >
            <X size={14} />
          </button>
        </header>

        {/* capability strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[color:var(--hud-line)] px-4 py-2 font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-ink-dim)]">
          <span className="flex items-center gap-1">
            <Cpu size={9} /> {caps ? `${caps.tier} · ${caps.hardwareConcurrency} cores` : 'probing device…'}
          </span>
          <span className={caps?.wasmSimd ? 'text-[color:var(--hud-mint)]' : 'text-[#ffd27a]'}>
            wasm{caps?.wasmSimd ? '+simd' : ' (no simd)'}
          </span>
          <span className={caps?.opfs ? 'text-[color:var(--hud-mint)]' : 'text-[#ff9d7a]'}>
            {caps?.opfs ? 'storage ok' : 'no opfs'}
          </span>
          <span
            className={
              caps?.runtimeBuild === 'default'
                ? 'text-[color:var(--hud-mint)]'
                : caps?.runtimeBuild === 'compat'
                  ? 'text-[#ffd27a]'
                  : 'text-[#ff9d7a]'
            }
          >
            runtime · {caps?.runtimeBuild ?? '…'}
          </span>
          <span className="flex items-center gap-1">
            <HardDrive size={9} />
            {storage
              ? `${formatBytes(storage.modelsBytes)} models · ${formatBytes(storage.availableBytes)} free`
              : 'storage n/a'}
          </span>
          {device.loaded && (
            <span className="flex items-center gap-1 text-[color:var(--hud-lime)]">
              <ShieldCheck size={9} /> loaded · {device.loaded.backend} · ctx {device.loaded.contextLength}
            </span>
          )}
        </div>

        {/* tabs */}
        <div className="flex items-center gap-1 border-b border-[color:var(--hud-line)] px-3 py-1.5">
          {(['library', 'catalogue', 'system'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={`rounded border px-2 py-1 font-mono text-[7px] uppercase tracking-[0.22em] transition ${
                tab === key
                  ? 'border-[color:var(--hud-lime)] text-[color:var(--hud-lime)]'
                  : 'border-transparent text-[color:var(--hud-ink-dim)] hover:border-[color:var(--hud-line)]'
              }`}
            >
              {key}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1 rounded border border-[color:var(--hud-line)] px-2 py-1 font-mono text-[7px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)]"
            >
              <Import size={9} /> import .gguf
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".gguf,application/octet-stream"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = '';
                if (file) void device.importFile(file);
              }}
            />
          </span>
        </div>

        {device.error && (
          <div className="flex items-start gap-2 border-b border-[#ff9d7a]/40 bg-[#ff9d7a]/10 px-4 py-2 font-mono text-[8px] uppercase leading-[1.6] tracking-[0.12em] text-[#ffd9c9]">
            <AlertTriangle size={12} className="mt-[1px] flex-none text-[#ff9d7a]" />
            <span className="flex-1">
              <span className="text-[#ff9d7a]">{device.error.code}</span> · {device.error.message}
              <span className="mt-1 block normal-case tracking-[0.04em] text-[color:var(--hud-ink-dim)]">
                {device.error.fix}
              </span>
            </span>
            <button type="button" onClick={device.clearError} aria-label="Dismiss" className="flex-none">
              <X size={11} />
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {/* ------------------------------- library ------------------------------- */}
          {tab === 'library' && (
            <div className="space-y-2">
              {device.models.length === 0 && (
                <p className="px-2 py-8 text-center font-mono text-[8px] uppercase leading-[2] tracking-[0.24em] text-[color:var(--hud-ink-dim)]">
                  no models on this device
                  <br />
                  import a .gguf or install one from the catalogue
                </p>
              )}

              {device.models.map((model) => {
                const job = jobsByModel.get(model.id);
                const progress = job?.totalBytes ? job.receivedBytes / job.totalBytes : 0;
                const loadedHere = device.loaded?.modelId === model.id;
                const downloading = job?.state === 'downloading';
                return (
                  <div
                    key={model.id}
                    className="rounded border border-[color:var(--hud-line)] bg-black/30 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-[11px] tracking-[0.08em] text-[color:var(--hud-ink)]">
                        {model.name}
                      </span>
                      <span className={`font-mono text-[7px] uppercase tracking-[0.2em] ${STATE_TONE[model.state]}`}>
                        {model.state}
                      </span>
                      <span className="font-mono text-[7px] uppercase tracking-[0.16em] text-[color:var(--hud-ink-dim)]">
                        {model.quantization} · {formatBytes(model.sizeBytes)} · {model.architecture}
                        {model.contextLength ? ` · ${model.contextLength} ctx` : ''}
                      </span>
                      {model.integrity === 'header-ok' && (
                        <span className="flex items-center gap-1 font-mono text-[7px] uppercase tracking-[0.16em] text-[color:var(--hud-mint)]">
                          <Check size={8} /> header verified
                        </span>
                      )}
                    </div>

                    <p className="mt-1 font-mono text-[7px] uppercase tracking-[0.14em] text-[color:var(--hud-ink-dim)]">
                      {model.source.label} · {model.source.licence}
                    </p>

                    {job && (downloading || job.state === 'paused' || job.state === 'verifying') && (
                      <div className="mt-2 space-y-1">
                        <Spark value={progress} />
                        <div className="flex flex-wrap items-center gap-x-3 font-mono text-[7px] uppercase tracking-[0.16em] text-[color:var(--hud-ink-dim)]">
                          <span className="text-[color:var(--hud-ink)]">
                            {job.totalBytes
                              ? `${formatBytes(job.receivedBytes)} / ${formatBytes(job.totalBytes)} (${Math.round(progress * 100)}%)`
                              : formatBytes(job.receivedBytes)}
                          </span>
                          {job.bytesPerSecond > 0 && <span>{formatBytes(job.bytesPerSecond)}/s</span>}
                          <span>{job.resumable ? 'resume supported' : 'resume not supported by host'}</span>
                        </div>
                      </div>
                    )}

                    {model.lastError && (
                      <p className="mt-1 font-mono text-[7px] uppercase leading-[1.7] tracking-[0.12em] text-[#ff9d7a]">
                        {model.lastError.code}: {model.lastError.message}
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {model.state === 'installed' && !loadedHere && (
                        <button
                          type="button"
                          onClick={() => void device.load(model.id)}
                          disabled={device.busy === `load:${model.id}`}
                          className="flex items-center gap-1 rounded border border-[color:var(--hud-line)] px-2 py-[3px] font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-ink)] transition hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)] disabled:opacity-50"
                        >
                          {device.busy === `load:${model.id}` ? <Loader2 size={9} className="animate-spin" /> : <Play size={9} />}
                          load
                        </button>
                      )}
                      {loadedHere && (
                        <>
                          <span className="flex items-center gap-1 rounded border border-[color:var(--hud-lime)]/50 px-2 py-[3px] font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-lime)]">
                            <ShieldCheck size={9} /> in memory
                          </span>
                          <button
                            type="button"
                            onClick={() => void device.unload(model.id)}
                            className="flex items-center gap-1 rounded border border-[color:var(--hud-line)] px-2 py-[3px] font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-ink-dim)] transition hover:border-[#ffd27a] hover:text-[#ffd27a]"
                          >
                            <Unplug size={9} /> unload
                          </button>
                          {onUseModel && (
                            <button
                              type="button"
                              onClick={() => onUseModel(model.id)}
                              className="flex items-center gap-1 rounded border border-[color:var(--hud-lime)] px-2 py-[3px] font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-lime)]"
                            >
                              use for chat
                            </button>
                          )}
                        </>
                      )}
                      {downloading && job && (
                        <button
                          type="button"
                          onClick={() => device.pause(job.id)}
                          className="flex items-center gap-1 rounded border border-[color:var(--hud-line)] px-2 py-[3px] font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-ink-dim)] transition hover:border-[#ffd27a] hover:text-[#ffd27a]"
                        >
                          <Pause size={9} /> pause
                        </button>
                      )}
                      {(job?.state === 'paused' ||
                        job?.state === 'cancelled' ||
                        model.state === 'cancelled' ||
                        model.state === 'error') && (
                        <button
                          type="button"
                          onClick={() => void device.resume(model.id)}
                          className="flex items-center gap-1 rounded border border-[color:var(--hud-line)] px-2 py-[3px] font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)]"
                        >
                          <Download size={9} /> resume
                        </button>
                      )}
                      {(downloading || job?.state === 'paused') && job && (
                        <button
                          type="button"
                          onClick={() => device.cancel(job.id)}
                          className="flex items-center gap-1 rounded border border-[color:var(--hud-line)] px-2 py-[3px] font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-ink-dim)] transition hover:border-[#ff9d7a] hover:text-[#ff9d7a]"
                        >
                          <Square size={9} /> cancel
                        </button>
                      )}
                      {loadedHere ? (
                        <span className="font-mono text-[7px] uppercase tracking-[0.16em] text-[color:var(--hud-ink-dim)]">
                          unload before delete
                        </span>
                      ) : deleteId === model.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              void device.remove(model.id);
                              setDeleteId(null);
                            }}
                            className="rounded border border-[#ff9d7a] px-2 py-[3px] font-mono text-[7px] uppercase tracking-[0.18em] text-[#ff9d7a]"
                          >
                            confirm delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteId(null)}
                            className="rounded border border-[color:var(--hud-line)] px-2 py-[3px] font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-ink-dim)]"
                          >
                            keep
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setDeleteId(model.id)}
                          className="flex items-center gap-1 rounded border border-[color:var(--hud-line)] px-2 py-[3px] font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-ink-dim)] transition hover:border-[#ff9d7a] hover:text-[#ff9d7a]"
                        >
                          <Trash2 size={9} /> delete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* generation test */}
              {device.loaded && (
                <div className="mt-3 rounded border border-[color:var(--hud-lime)]/30 bg-black/40 px-3 py-2">
                  <p className="font-mono text-[7px] uppercase tracking-[0.24em] text-[color:var(--hud-lime)]">
                    local generation test · offline
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <input
                      value={testPrompt}
                      onChange={(event) => setTestPrompt(event.target.value)}
                      className="flex-1 rounded border border-[color:var(--hud-line)] bg-black/40 px-2 py-1 font-mono text-[9px] text-[color:var(--hud-ink)] outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void runTest()}
                      disabled={device.busy === 'generate'}
                      className="flex items-center gap-1 rounded border border-[color:var(--hud-lime)] px-2 py-1 font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-lime)] disabled:opacity-50"
                    >
                      {device.busy === 'generate' ? <Loader2 size={9} className="animate-spin" /> : <Play size={9} />}
                      run
                    </button>
                  </div>
                  {output && (
                    <p className="mt-2 whitespace-pre-wrap font-mono text-[9px] leading-[1.7] text-[color:var(--hud-ink)]">
                      {output}
                    </p>
                  )}
                  {generated && (
                    <p className="mt-1 font-mono text-[7px] uppercase tracking-[0.16em] text-[color:var(--hud-ink-dim)]">
                      measured · {generated}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ------------------------------ catalogue ------------------------------ */}
          {tab === 'catalogue' && (
            <div className="space-y-2">
              <p className="px-1 font-mono text-[7px] uppercase leading-[1.7] tracking-[0.14em] text-[color:var(--hud-ink-dim)]">
                {RAM_CAUTION}
              </p>

              {installable.length === 0 && (
                <p className="px-2 py-6 text-center font-mono text-[8px] uppercase tracking-[0.24em] text-[color:var(--hud-ink-dim)]">
                  every catalogue model is installed
                </p>
              )}

              {installable.map((entry) => (
                <div key={entry.id} className="rounded border border-[color:var(--hud-line)] bg-black/30 px-3 py-2">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-[11px] tracking-[0.08em] text-[color:var(--hud-ink)]">{entry.name}</span>
                    <span className="font-mono text-[7px] uppercase tracking-[0.16em] text-[color:var(--hud-ink-dim)]">
                      {entry.quantization} · ≈{formatBytes(entry.approxBytes)} · {entry.contextLength} ctx
                    </span>
                    {entry.resourceHeavy && (
                      <span className="font-mono text-[7px] uppercase tracking-[0.16em] text-[#ffd27a]">resource heavy</span>
                    )}
                    {entry.verification === 'unverified' && (
                      <span className="font-mono text-[7px] uppercase tracking-[0.16em] text-[#ffd27a]">
                        file name unverified
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-[7px] leading-[1.7] tracking-[0.1em] text-[color:var(--hud-ink-dim)]">
                    {entry.licence}
                    {entry.licenceNote ? ` — ${entry.licenceNote}` : ''}
                  </p>
                  {entry.runtimeNotes && (
                    <p className="mt-0.5 font-mono text-[7px] normal-case leading-[1.6] tracking-[0.04em] text-[color:var(--hud-ink-dim)]">
                      {entry.runtimeNotes}
                    </p>
                  )}

                  {confirmId === entry.id ? (
                    <div className="mt-2 space-y-1.5">
                      <p className="font-mono text-[7px] uppercase leading-[1.7] tracking-[0.12em] text-[#ffd27a]">
                        confirm you have checked the exact file and licence on the model card
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            void device.download(entry.id, { licenceAccepted: true });
                            setConfirmId(null);
                          }}
                          className="rounded border border-[color:var(--hud-lime)] px-2 py-[3px] font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-lime)]"
                        >
                          accept & download
                        </button>
                        <a
                          href={entry.modelCard}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded border border-[color:var(--hud-line)] px-2 py-[3px] font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-ink-dim)] hover:text-[color:var(--hud-ink)]"
                        >
                          model card
                        </a>
                        <button
                          type="button"
                          onClick={() => setConfirmId(null)}
                          className="rounded border border-[color:var(--hud-line)] px-2 py-[3px] font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-ink-dim)]"
                        >
                          cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setConfirmId(entry.id)}
                        className="flex items-center gap-1 rounded border border-[color:var(--hud-line)] px-2 py-[3px] font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-ink)] transition hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)]"
                      >
                        <Download size={9} /> download
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const repoGuess = entry.downloadUrl.split('/').slice(3, 5).join('/');
                          setRepo(repoGuess);
                          setBrowsing(true);
                          void device.browseRepo(repoGuess).then((found) => {
                            setFiles(found);
                            setBrowsing(false);
                          });
                        }}
                        className="rounded border border-[color:var(--hud-line)] px-2 py-[3px] font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)]"
                      >
                        browse files
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {/* Hub browser: pins the real file name and size */}
              <div className="rounded border border-[color:var(--hud-line)] bg-black/30 px-3 py-2">
                <p className="font-mono text-[7px] uppercase tracking-[0.24em] text-[color:var(--hud-ink-dim)]">
                  resolve a file from hugging face
                </p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <input
                    value={repo}
                    onChange={(event) => setRepo(event.target.value)}
                    placeholder="owner/repo-GGUF"
                    className="flex-1 rounded border border-[color:var(--hud-line)] bg-black/40 px-2 py-1 font-mono text-[9px] text-[color:var(--hud-ink)] outline-none placeholder:text-[color:var(--hud-ink-dim)]"
                  />
                  <button
                    type="button"
                    disabled={browsing || !repo.includes('/')}
                    onClick={() => {
                      setBrowsing(true);
                      void device.browseRepo(repo).then((found) => {
                        setFiles(found);
                        setBrowsing(false);
                      });
                    }}
                    className="rounded border border-[color:var(--hud-line)] px-2 py-1 font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)] disabled:opacity-50"
                  >
                    {browsing ? 'listing…' : 'list'}
                  </button>
                </div>
                {files.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {files.map((file) => (
                      <li key={file.path} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate font-mono text-[8px] text-[color:var(--hud-ink)]">
                          {file.name}
                        </span>
                        <span className="font-mono text-[7px] text-[color:var(--hud-ink-dim)]">
                          {formatBytes(file.sizeBytes)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const id = `local/${file.name.replace(/\.gguf$/i, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`;
                            void device.download(id, { url: file.url, licenceAccepted: true });
                          }}
                          className="rounded border border-[color:var(--hud-line)] px-1.5 py-[2px] font-mono text-[7px] uppercase tracking-[0.16em] text-[color:var(--hud-ink-dim)] hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)]"
                        >
                          get
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    value={customUrl}
                    onChange={(event) => setCustomUrl(event.target.value)}
                    placeholder="https://huggingface.co/…/model.gguf"
                    className="flex-1 rounded border border-[color:var(--hud-line)] bg-black/40 px-2 py-1 font-mono text-[8px] text-[color:var(--hud-ink)] outline-none placeholder:text-[color:var(--hud-ink-dim)]"
                  />
                  <button
                    type="button"
                    disabled={!/^https:\/\//.test(customUrl)}
                    onClick={() => {
                      const id = `local/${customUrl.split('/').pop()!.replace(/\.gguf$/i, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`;
                      void device.download(id, { url: customUrl, licenceAccepted: true });
                      setCustomUrl('');
                    }}
                    className="flex items-center gap-1 rounded border border-[color:var(--hud-line)] px-2 py-1 font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)] disabled:opacity-50"
                  >
                    <Download size={9} /> fetch
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* -------------------------------- system -------------------------------- */}
          {tab === 'system' && (
            <div className="space-y-2">
              <div className="rounded border border-[color:var(--hud-line)] bg-black/30 px-3 py-2">
                <p className="font-mono text-[7px] uppercase tracking-[0.24em] text-[color:var(--hud-ink-dim)]">
                  device probe
                </p>
                <ul className="mt-1 space-y-0.5 font-mono text-[8px] leading-[1.8] text-[color:var(--hud-ink)]">
                  <li>platform · {caps?.platform ?? 'probing'}</li>
                  <li>tier · {caps?.tier ?? '—'}</li>
                  <li>cores · {caps?.hardwareConcurrency ?? '—'} · deviceMemory · {caps?.deviceMemoryGb ? `${caps.deviceMemoryGb} GiB` : 'not exposed'}</li>
                  <li>wasm · {caps?.wasm ? 'yes' : 'no'} · simd · {caps?.wasmSimd ? 'yes' : 'no'} · threads · {caps?.wasmThreads ? 'yes' : 'no (not cross-origin isolated)'}</li>
                  <li>webgpu · {caps?.webgpu ? 'exposed (unused)' : 'no'} · opfs · {caps?.opfs ? 'yes' : 'no'}</li>
                  <li>
                    jspi · {caps?.wasmJspi ? 'yes' : 'no'} · memory64 · {caps?.wasmMemory64 ? 'yes' : 'no'} · build ·{' '}
                    {caps?.runtimeBuild ?? '—'}
                  </li>
                  <li>
                    ceiling · {caps?.recommendedMaxModelBytes ? `≈${formatBytes(caps.recommendedMaxModelBytes)}` : '—'}
                  </li>
                  <li>
                    storage · {storage ? `${formatBytes(storage.usageBytes)} used of ${formatBytes(storage.quotaBytes)} · persisted ${storage.persisted ? 'yes' : 'no'}` : '—'}
                  </li>
                </ul>
                <button
                  type="button"
                  onClick={() => void device.requestPersistence()}
                  className="mt-2 rounded border border-[color:var(--hud-line)] px-2 py-[3px] font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-ink-dim)] hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)]"
                >
                  ask browser to keep models
                </button>
              </div>

              <div className="rounded border border-[#ffd27a]/40 bg-[#ffd27a]/5 px-3 py-2">
                <p className="font-mono text-[7px] uppercase tracking-[0.24em] text-[#ffd27a]">
                  platform limits · stated, not simulated
                </p>
                <ul className="mt-1 space-y-1 font-mono text-[8px] normal-case leading-[1.7] text-[color:var(--hud-ink-dim)]">
                  {caps?.limitations.map((line) => <li key={line}>• {line}</li>)}
                  {caps?.notes.map((line) => <li key={line}>· {line}</li>)}
                </ul>
              </div>

              <div className="rounded border border-[#ff9d7a]/40 bg-[#ff9d7a]/5 px-3 py-2">
                <p className="font-mono text-[7px] uppercase tracking-[0.24em] text-[#ff9d7a]">
                  local image generation · {device.imageGeneration.state}
                </p>
                <p className="mt-1 font-mono text-[8px] normal-case leading-[1.7] text-[color:var(--hud-ink-dim)]">
                  {device.imageGeneration.reason}
                </p>
                <ul className="mt-1 space-y-0.5 font-mono text-[7.5px] normal-case leading-[1.6] text-[color:var(--hud-ink-dim)]">
                  {device.imageGeneration.requirements.map((line) => <li key={line}>• {line}</li>)}
                </ul>
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-[color:var(--hud-line)] px-4 py-2 font-mono text-[7px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)]">
          <span>
            {device.models.length} installed · {device.jobs.filter((job) => job.state === 'downloading').length} active
          </span>
          <span className="flex items-center gap-2">
            <ChevronDown size={9} /> local only · no cloud fallback
          </span>
        </footer>
      </div>
    </div>
  );
}
