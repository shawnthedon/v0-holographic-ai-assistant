'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CloudOff,
  Download,
  FileBox,
  FileCode2,
  FileJson,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useArtifacts } from '@/hooks/use-artifacts';
import { useOffline } from '@/hooks/use-offline';
import type { Artifact, ArtifactKind } from '@/lib/artifacts/types';
import { formatBytes } from '@/lib/artifacts/classify';
import type { FtpTarget } from '@/lib/ftp/types';

const KIND_LABEL: Record<ArtifactKind | 'all', string> = {
  all: 'all',
  code: 'code',
  config: 'config',
  report: 'report',
  data: 'data',
  custom: 'custom',
};

const KIND_ICON: Record<ArtifactKind, typeof FileCode2> = {
  code: FileCode2,
  config: FileJson,
  report: FileText,
  data: FileSpreadsheet,
  custom: FileBox,
};

interface FtpForm extends FtpTarget {
  secure: boolean;
}

const EMPTY_FTP: FtpForm = {
  host: '',
  port: 21,
  secure: false,
  username: '',
  password: '',
  remoteDir: '/artifacts',
};

export function ArtifactPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    artifacts,
    stats,
    filter,
    setFilter,
    loading,
    busy,
    error,
    notice,
    clearNotice,
    refresh,
    create,
    upload,
    remove,
    rename,
    download,
    publish,
    testConnection,
    readText,
    getBlob,
  } = useArtifacts();
  const offline = useOffline();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; text: string; truncated: boolean } | null>(null);
  const [composer, setComposer] = useState<{ open: boolean; name: string; text: string }>({
    open: false,
    name: '',
    text: '',
  });
  const [ftp, setFtp] = useState<FtpForm>(EMPTY_FTP);
  const [ftpOpen, setFtpOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedId) ?? null,
    [artifacts, selectedId],
  );

  const commitRename = () => {
    if (!renaming) return;
    const next = renaming.value.trim();
    setRenaming(null);
    if (!next) return;
    void rename(renaming.id, next).then((artifact) => {
      if (artifact) setSelectedId(artifact.id);
    });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  // Keep the selection valid as the list changes underneath it.
  useEffect(() => {
    if (selectedId && !artifacts.some((artifact) => artifact.id === selectedId)) setSelectedId(null);
  }, [artifacts, selectedId]);

  useEffect(() => {
    let cancelled = false;
    if (!selected) {
      setPreview(null);
      return;
    }
    void (async () => {
      if (selected.mime.startsWith('image/')) {
        setPreview({ name: selected.name, text: '[image artifact — download to view]', truncated: false });
        return;
      }
      if (!selected.text && !selected.blobId) return;
      if (selected.sizeBytes > 400_000) {
        setPreview({
          name: selected.name,
          text: `[${formatBytes(selected.sizeBytes)} body — too large to preview inline. Use download.]`,
          truncated: true,
        });
        return;
      }
      try {
        const text = await readText(selected);
        if (!cancelled) setPreview({ name: selected.name, text, truncated: false });
      } catch {
        if (!cancelled) setPreview({ name: selected.name, text: '[binary or unreadable body]', truncated: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readText, selected]);

  if (!open) return null;

  const totalBytes = stats?.bytes ?? 0;

  return (
    <div className="fixed inset-0 z-[72] flex items-start justify-center bg-black/85 p-3 pt-[4vh] backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Artifact archive"
        className="relative flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded border border-[color:var(--hud-line-strong)] bg-[#030c10]/97 shadow-[0_0_80px_rgba(46,242,192,0.14)]"
      >
        {/* ---------------- header ---------------- */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--hud-line)] px-4 py-3">
          <div>
            <p className="font-mono text-[8px] uppercase tracking-[0.34em] text-[color:var(--hud-ink-dim)]">
              artifact archive
            </p>
            <h2 className="font-mono text-[13px] tracking-[0.18em] text-[color:var(--hud-ink)]">
              FILES PRODUCED BY AGENTS
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono text-[7px] uppercase tracking-[0.2em]">
            <span
              className={`flex items-center gap-1 rounded border px-2 py-[3px] ${
                offline.online
                  ? 'border-[color:var(--hud-lime)]/50 text-[color:var(--hud-lime)]'
                  : 'border-[#ffd27a]/60 text-[#ffd27a]'
              }`}
            >
              {offline.online ? <Server size={9} /> : <CloudOff size={9} />}
              {offline.online ? 'online' : 'offline'}
            </span>
            {offline.pending > 0 && (
              <span className="rounded border border-[color:var(--hud-line)] px-2 py-[3px] text-[color:var(--hud-ink-dim)]">
                {offline.pending} queued
              </span>
            )}
            <span className="rounded border border-[color:var(--hud-line)] px-2 py-[3px] text-[color:var(--hud-ink-dim)]">
              {stats?.total ?? 0} files · {formatBytes(totalBytes)}
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close artifact archive"
              className="rounded border border-[color:var(--hud-line)] p-1.5 text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-line-strong)] hover:text-[color:var(--hud-ink)]"
            >
              <X size={14} />
            </button>
          </div>
        </header>

        {/* ---------------- toolbar ---------------- */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--hud-line)] px-4 py-2.5">
          <label className="flex min-w-[180px] flex-1 items-center gap-2 rounded border border-[color:var(--hud-line)] bg-black/40 px-2 py-1.5">
            <Search size={12} className="text-[color:var(--hud-ink-dim)]" />
            <input
              value={filter.query ?? ''}
              onChange={(event) => setFilter({ ...filter, query: event.target.value })}
              placeholder="search files, agents, tags…"
              className="w-full bg-transparent font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--hud-ink)] outline-none placeholder:text-[color:var(--hud-ink-dim)]"
            />
          </label>

          <div className="flex flex-wrap gap-1">
            {(['all', 'code', 'config', 'report', 'data', 'custom'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setFilter({ ...filter, kind })}
                aria-pressed={(filter.kind ?? 'all') === kind}
                className={`rounded border px-2 py-1 font-mono text-[7px] uppercase tracking-[0.2em] transition ${
                  (filter.kind ?? 'all') === kind
                    ? 'border-[color:var(--hud-lime)] text-[color:var(--hud-lime)]'
                    : 'border-[color:var(--hud-line)] text-[color:var(--hud-ink-dim)] hover:border-[color:var(--hud-line-strong)]'
                }`}
              >
                {KIND_LABEL[kind]}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setComposer((current) => ({ ...current, open: !current.open }))}
              className="flex items-center gap-1 rounded border border-[color:var(--hud-line)] px-2 py-1 font-mono text-[7px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)]"
            >
              <Plus size={9} /> new
            </button>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={busy === 'upload'}
              className="flex items-center gap-1 rounded border border-[color:var(--hud-line)] px-2 py-1 font-mono text-[7px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)] disabled:opacity-50"
            >
              <Upload size={9} /> import
            </button>
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              multiple
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = '';
                for (const file of files) void upload(file);
              }}
            />
            <button
              type="button"
              onClick={() => void refresh()}
              className="flex items-center gap-1 rounded border border-[color:var(--hud-line)] px-2 py-1 font-mono text-[7px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)]"
            >
              <RefreshCw size={9} className={busy ? 'animate-spin' : ''} /> reload
            </button>
          </div>
        </div>

        {/* ---------------- messages ---------------- */}
        {error && (
          <p className="flex items-start gap-2 border-b border-[#ff9d7a]/40 bg-[#ff9d7a]/10 px-4 py-2 font-mono text-[8px] uppercase leading-[1.6] tracking-[0.14em] text-[#ff9d7a]">
            <span className="flex-1">
              <span className="mr-2 rounded border border-[#ff9d7a]/50 px-1 py-[1px] text-[7px] tracking-[0.16em]">
                {error.code}
              </span>{' '}
              {error.message} — {error.fix}
            </span>
            <button type="button" onClick={clearNotice} aria-label="Dismiss error">
              <X size={11} />
            </button>
          </p>
        )}
        {notice && (
          <p className="flex items-start gap-2 border-b border-[color:var(--hud-lime)]/30 bg-[color:var(--hud-lime)]/5 px-4 py-2 font-mono text-[8px] uppercase leading-[1.6] tracking-[0.14em] text-[color:var(--hud-lime)]">
            <span className="flex-1">{notice}</span>
            <button type="button" onClick={clearNotice} aria-label="Dismiss notice">
              <X size={11} />
            </button>
          </p>
        )}

        {/* ---------------- composer ---------------- */}
        {composer.open && (
          <form
            className="border-b border-[color:var(--hud-line)] bg-black/30 px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!composer.name.trim() || !composer.text.trim()) return;
              void create({ name: composer.name, text: composer.text }).then((artifact) => {
                if (artifact) {
                  setComposer({ open: false, name: '', text: '' });
                  setSelectedId(artifact.id);
                }
              });
            }}
          >
            <div className="mb-2 flex items-center gap-2">
              <input
                value={composer.name}
                onChange={(event) => setComposer((current) => ({ ...current, name: event.target.value }))}
                placeholder="file name (e.g. report.md)"
                className="flex-1 rounded border border-[color:var(--hud-line)] bg-black/40 px-2 py-1.5 font-mono text-[10px] text-[color:var(--hud-ink)] outline-none placeholder:text-[color:var(--hud-ink-dim)]"
              />
              <button
                type="submit"
                className="rounded border border-[color:var(--hud-lime)]/60 px-2.5 py-1.5 font-mono text-[8px] uppercase tracking-[0.2em] text-[color:var(--hud-lime)] transition hover:bg-[color:var(--hud-lime)]/10"
              >
                save
              </button>
            </div>
            <textarea
              value={composer.text}
              onChange={(event) => setComposer((current) => ({ ...current, text: event.target.value }))}
              placeholder="paste content — extension decides the artifact type"
              rows={4}
              className="w-full resize-y rounded border border-[color:var(--hud-line)] bg-black/40 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-[color:var(--hud-ink)] outline-none placeholder:text-[color:var(--hud-ink-dim)]"
            />
          </form>
        )}

        {/* ---------------- body ---------------- */}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* list */}
          <div className="min-h-0 flex-1 overflow-y-auto border-[color:var(--hud-line)] md:border-r">
            {loading && (
              <p className="px-4 py-6 text-center font-mono text-[8px] uppercase tracking-[0.3em] text-[color:var(--hud-ink-dim)]">
                reading archive…
              </p>
            )}
            {!loading && artifacts.length === 0 && (
              <div className="px-6 py-10 text-center">
                <FolderOpen size={20} className="mx-auto mb-3 text-[color:var(--hud-ink-dim)]" />
                <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-[color:var(--hud-ink-dim)]">
                  no artifacts yet
                </p>
                <p className="mx-auto mt-2 max-w-[42ch] font-mono text-[8px] leading-[1.7] tracking-[0.08em] text-[color:var(--hud-ink-dim)]/80">
                  Ask an agent for a file — any fenced code block with a filename becomes an artifact
                  automatically. You can also import from disk or create one here.
                </p>
              </div>
            )}

            {artifacts.map((artifact) => {
              const Icon = KIND_ICON[artifact.kind];
              const active = artifact.id === selectedId;
              return (
                <button
                  key={artifact.id}
                  type="button"
                  onClick={() => setSelectedId(artifact.id)}
                  className={`flex w-full items-start gap-3 border-b border-[color:var(--hud-line)]/60 px-4 py-2.5 text-left transition ${
                    active ? 'bg-[color:var(--hud-mint)]/10' : 'hover:bg-white/[0.03]'
                  }`}
                >
                  <Icon size={14} className="mt-[2px] flex-none text-[color:var(--hud-mint)]" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className="truncate font-mono text-[11px] tracking-[0.06em] text-[color:var(--hud-ink)]">
                        {artifact.name}
                      </span>
                      <span className="font-mono text-[7px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)]">
                        {artifact.kind}
                      </span>
                      {artifact.source === 'agent' && (
                        <span className="font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-lime)]">
                          agent
                        </span>
                      )}
                      {artifact.remote && (
                        <span className="font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-mint)]">
                          published
                        </span>
                      )}
                    </span>
                    <span className="mt-[3px] flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[7px] uppercase tracking-[0.16em] text-[color:var(--hud-ink-dim)]">
                      <span>{formatBytes(artifact.sizeBytes)}</span>
                      <span>{new Date(artifact.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {artifact.agentName && <span className="normal-case">{artifact.agentName}</span>}
                      {artifact.hash && <span className="lowercase">#{artifact.hash.slice(0, 8)}</span>}
                    </span>
                    {artifact.description && (
                      <span className="mt-1 block truncate font-mono text-[7.5px] normal-case tracking-[0.05em] text-[color:var(--hud-ink-dim)]/80">
                        {artifact.description}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {/* preview + actions */}
          <div className="flex min-h-0 w-full flex-col md:w-[54%]">
            {!selected ? (
              <div className="flex flex-1 items-center justify-center px-6 text-center">
                <p className="font-mono text-[8px] uppercase leading-[1.8] tracking-[0.24em] text-[color:var(--hud-ink-dim)]">
                  select a file to preview,
                  <br />
                  download it or publish it over ftp
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-1.5 border-b border-[color:var(--hud-line)] px-3 py-2">
                  {renaming && renaming.id === selected.id ? (
                    <input
                      autoFocus
                      aria-label="New file name"
                      value={renaming.value}
                      onChange={(event) => setRenaming({ id: selected.id, value: event.target.value })}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitRename();
                        } else if (event.key === 'Escape') {
                          event.stopPropagation();
                          setRenaming(null);
                        }
                      }}
                      className="mr-auto w-[46%] min-w-[120px] rounded border border-[color:var(--hud-lime)]/50 bg-black/50 px-1.5 py-1 font-mono text-[9px] text-[color:var(--hud-ink)] outline-none"
                    />
                  ) : (
                    <span className="mr-auto truncate font-mono text-[9px] tracking-[0.1em] text-[color:var(--hud-ink)]">
                      {selected.name}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setRenaming({ id: selected.id, value: selected.name })}
                    disabled={busy !== null}
                    aria-label="Rename artifact"
                    className="flex items-center gap-1 rounded border border-[color:var(--hud-line)] px-1.5 py-[3px] font-mono text-[7px] uppercase tracking-[0.16em] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-ink)] hover:text-[color:var(--hud-ink)] disabled:opacity-40"
                  >
                    <Pencil size={9} /> rename
                  </button>
                  <button
                    type="button"
                    onClick={() => void download(selected)}
                    className="flex items-center gap-1 rounded border border-[color:var(--hud-line)] px-1.5 py-[3px] font-mono text-[7px] uppercase tracking-[0.16em] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)]"
                  >
                    <Download size={9} /> download
                  </button>
                  <button
                    type="button"
                    onClick={() => setFtpOpen((value) => !value)}
                    className="flex items-center gap-1 rounded border border-[color:var(--hud-line)] px-1.5 py-[3px] font-mono text-[7px] uppercase tracking-[0.16em] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-mint)] hover:text-[color:var(--hud-mint)]"
                  >
                    <Server size={9} /> ftp
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(selected.id)}
                    className="flex items-center gap-1 rounded border border-[#ff9d7a]/40 px-1.5 py-[3px] font-mono text-[7px] uppercase tracking-[0.16em] text-[#ff9d7a] transition hover:bg-[#ff9d7a]/10"
                  >
                    <Trash2 size={9} /> delete
                  </button>
                </div>

                {ftpOpen && (
                  <form
                    className="border-b border-[color:var(--hud-line)] bg-black/40 px-3 py-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!selected) return;
                      const target: FtpTarget = {
                        host: ftp.host.trim(),
                        port: Number(ftp.port) || 21,
                        secure: ftp.secure,
                        username: ftp.username,
                        password: ftp.password,
                        remoteDir: ftp.remoteDir,
                      };
                      void publish(selected, target).then((result) => {
                        if (result) setFtpOpen(false);
                      });
                    }}
                  >
                    <p className="mb-2 font-mono text-[7px] uppercase leading-[1.6] tracking-[0.16em] text-[color:var(--hud-ink-dim)]">
                      ftp runs on the server — the browser cannot open a raw socket.
                      <br />
                      credentials are kept in this tab only and never written to disk.
                    </p>
                    <div className="grid grid-cols-2 gap-1.5">
                      <FtpField label="host" value={ftp.host} placeholder="ftp.example.com" onChange={(value) => setFtp((c) => ({ ...c, host: value }))} />
                      <FtpField label="port" value={String(ftp.port)} placeholder="21" onChange={(value) => setFtp((c) => ({ ...c, port: Number(value) || 21 }))} mono />
                      <FtpField label="user" value={ftp.username} placeholder="deploy" onChange={(value) => setFtp((c) => ({ ...c, username: value }))} />
                      <FtpField label="password" value={ftp.password} placeholder="••••••" type="password" onChange={(value) => setFtp((c) => ({ ...c, password: value }))} />
                      <FtpField label="remote dir" value={ftp.remoteDir} placeholder="/artifacts" onChange={(value) => setFtp((c) => ({ ...c, remoteDir: value }))} />
                      <label className="flex items-center gap-2 px-1 font-mono text-[7px] uppercase tracking-[0.18em] text-[color:var(--hud-ink-dim)]">
                        <input
                          type="checkbox"
                          checked={ftp.secure}
                          onChange={(event) => setFtp((c) => ({ ...c, secure: event.target.checked, port: event.target.checked ? 990 : 21 }))}
                          className="accent-[color:var(--hud-lime)]"
                        />
                        explicit tls
                      </label>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void testConnection({
                            host: ftp.host.trim(),
                            port: Number(ftp.port) || 21,
                            secure: ftp.secure,
                            username: ftp.username,
                            password: ftp.password,
                            remoteDir: ftp.remoteDir,
                          })
                        }
                        className="rounded border border-[color:var(--hud-line)] px-2 py-1 font-mono text-[7px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-ink)] hover:text-[color:var(--hud-ink)]"
                      >
                        test
                      </button>
                      <button
                        type="submit"
                        className="rounded border border-[color:var(--hud-mint)]/60 px-2 py-1 font-mono text-[7px] uppercase tracking-[0.2em] text-[color:var(--hud-mint)] transition hover:bg-[color:var(--hud-mint)]/10"
                      >
                        {offline.online ? 'upload' : 'queue for upload'}
                      </button>
                      {!offline.online && (
                        <span className="font-mono text-[7px] uppercase tracking-[0.16em] text-[#ffd27a]">
                          will send when the connection returns
                        </span>
                      )}
                    </div>
                  </form>
                )}

                <div className="min-h-0 flex-1 overflow-auto bg-black/50 px-3 py-2">
                  {preview ? (
                    <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-[1.55] text-[color:var(--hud-ink)]/90">
                      {preview.text.slice(0, 60_000)}
                      {preview.text.length > 60_000 ? '\n\n… truncated for the preview' : ''}
                    </pre>
                  ) : (
                    <p className="font-mono text-[8px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)]">
                      loading body…
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[color:var(--hud-line)] px-3 py-2 font-mono text-[7px] uppercase tracking-[0.16em] text-[color:var(--hud-ink-dim)]">
                  <span>{selected.mime}</span>
                  <span>{formatBytes(selected.sizeBytes)}</span>
                  <span>sha256 {selected.hash ? selected.hash.slice(0, 12) : 'pending'}</span>
                  {selected.remote && (
                    <span className="text-[color:var(--hud-mint)]">
                      {selected.remote.host}:{selected.remote.dir}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ---------------- footer ---------------- */}
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--hud-line)] px-4 py-2 font-mono text-[7px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)]">
          <span>
            {artifacts.length} shown · {stats?.total ?? 0} stored · {formatBytes(totalBytes)} of origin quota
            {offline.failed > 0 && <span className="ml-2 text-[#ff9d7a]">{offline.failed} failed syncs</span>}
          </span>
          <span className="flex items-center gap-3">
            <span>power · {offline.profile}</span>
            <span>{offline.batteryLabel}</span>
            <button
              type="button"
              onClick={offline.syncNow}
              className="rounded border border-[color:var(--hud-line)] px-2 py-[3px] text-[color:var(--hud-ink-dim)] transition hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)]"
            >
              {offline.syncing ? 'syncing…' : 'sync now'}
            </button>
            <span>esc to close</span>
          </span>
        </footer>
      </div>
    </div>
  );
}

function FtpField({
  label,
  value,
  placeholder,
  onChange,
  type = 'text',
  mono = false,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  type?: 'text' | 'password';
  mono?: boolean;
}) {
  return (
    <label className="flex flex-col gap-[2px]">
      <span className="font-mono text-[6.5px] uppercase tracking-[0.2em] text-[color:var(--hud-ink-dim)]">
        {label}
      </span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        className={`rounded border border-[color:var(--hud-line)] bg-black/50 px-1.5 py-1 font-mono text-[9px] text-[color:var(--hud-ink)] outline-none placeholder:text-[color:var(--hud-ink-dim)]/60 focus:border-[color:var(--hud-lime)]/60 ${
          mono ? 'tabular-nums' : ''
        }`}
      />
    </label>
  );
}

export type { Artifact };
