'use client';

import { useEffect, useRef, useState } from 'react';
import { animate } from 'animejs';
import { ArrowUpRight, X } from 'lucide-react';
import { EASE, useReducedMotion } from '@/lib/hud/motion';
import { CornerBrackets } from '@/components/hud/chrome';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function ConsolePanel({
  open,
  onClose,
  messages,
  onSubmit,
  thinking,
  model,
}: {
  open: boolean;
  onClose: () => void;
  messages: Message[];
  onSubmit: (value: string) => void;
  thinking: boolean;
  model: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const reduced = useReducedMotion();

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (reduced) {
      panel.style.opacity = open ? '1' : '0';
      panel.style.transform = open ? 'none' : 'translateX(28px)';
      panel.style.pointerEvents = open ? 'auto' : 'none';
      return;
    }
    animate(panel, {
      opacity: open ? 1 : 0,
      translateX: open ? 0 : 28,
      scale: open ? 1 : 0.985,
      filter: open ? 'blur(0px)' : 'blur(6px)',
      duration: open ? 480 : 260,
      ease: open ? EASE.out : 'inOutQuad',
    });
    panel.style.pointerEvents = open ? 'auto' : 'none';
  }, [open, reduced]);

  useEffect(() => {
    if (!listRef.current) return;
    const rows = listRef.current.querySelectorAll<HTMLElement>('.console-row');
    const last = rows[rows.length - 1];
    if (!last || reduced) return;
    animate(last, {
      opacity: [0, 1],
      translateY: [10, 0],
      duration: 460,
      ease: EASE.out,
    });
  }, [messages, reduced]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <aside
      ref={panelRef}
      className="hud-panel hud-console absolute right-2 top-[70px] z-40 flex w-[min(92vw,360px)] flex-col p-0"
      style={{
        pointerEvents: 'none',
        opacity: 0,
        // parked off-canvas with `transform` so anime.js can drive the slide
        transform: 'translateX(28px) scale(0.985)',
      }}
      aria-hidden={!open}
    >
      <CornerBrackets />
      <header className="flex items-center justify-between border-b border-[color:var(--hud-line)] px-3 py-2.5 font-mono text-[7px] uppercase tracking-[0.28em]">
        <span className="flex items-center gap-2 text-[color:var(--hud-ink-dim)]">
          <span className="hud-dot" data-state={thinking ? 'live' : 'idle'} />
          transcript
        </span>
        <span className="text-[color:var(--hud-ink)]">{model}</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-2 flex h-6 w-6 items-center justify-center rounded border border-[color:var(--hud-line)] text-[color:var(--hud-ink-dim)] transition-colors duration-150 hover:text-[color:var(--hud-ink)] active:scale-95"
          aria-label="Close transcript"
        >
          <X size={12} />
        </button>
      </header>

      <div
        ref={listRef}
        className="flex-1 space-y-3 overflow-y-auto px-3 py-3 font-mono text-[10px] leading-relaxed"
      >
        {messages.length === 0 && (
          <div className="space-y-1.5 text-[color:var(--hud-ink-dim)]">
            <p className="text-[color:var(--hud-ink)]">channel open.</p>
            <p>speak, or type a directive below. the projection responds in real time.</p>
          </div>
        )}

        {messages.map((message, index) => (
          <div key={index} className="console-row">
            <div className="mb-1 flex items-center gap-2 text-[6.5px] uppercase tracking-[0.24em] text-[color:var(--hud-ink-dim)]">
              <span>{message.role === 'user' ? 'operator' : 'nexus'}</span>
              <span className="h-px flex-1 bg-[color:var(--hud-line)]" />
              <span className="tabular-nums">
                {new Date(message.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
            <p
              className={
                message.role === 'user'
                  ? 'text-[color:var(--hud-ink-dim)]'
                  : 'text-[color:var(--hud-ink)]'
              }
            >
              {message.content}
            </p>
          </div>
        ))}

        {thinking && (
          <div className="flex items-center gap-2 text-[color:var(--hud-lime)]">
            <span className="flex gap-[3px]">
              {[0, 1, 2].map((dot) => (
                <span
                  key={dot}
                  className="h-1 w-1 rounded-full bg-current"
                  style={{ animation: `hud-blink 1100ms ease-in-out ${dot * 160}ms infinite` }}
                />
              ))}
            </span>
            synthesising
          </div>
        )}
      </div>

      <form
        className="border-t border-[color:var(--hud-line)] p-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim()) return;
          onSubmit(draft.trim());
          setDraft('');
          // caret feedback — the new message animates itself in on the next render
          if (listRef.current) {
            animate(listRef.current, {
              opacity: [0.92, 1],
              duration: 200,
              ease: EASE.out,
            });
          }
        }}
      >
        <div className="flex items-center gap-2 border border-[color:var(--hud-line)] bg-black/40 px-2 py-1.5 focus-within:border-[color:var(--hud-ink)]/60">
          <span className="font-mono text-[9px] text-[color:var(--hud-lime)]">›</span>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="enter directive"
            className="w-full bg-transparent font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--hud-ink)] outline-none placeholder:text-[color:var(--hud-ink-dim)]/60"
          />
          <button
            type="submit"
            className="flex h-6 w-6 flex-none items-center justify-center rounded-sm border border-[color:var(--hud-ink)]/40 text-[color:var(--hud-ink)] transition-colors duration-150 hover:bg-[color:var(--hud-ink)]/10 active:scale-95"
            aria-label="Send directive"
          >
            <ArrowUpRight size={12} />
          </button>
        </div>
      </form>
    </aside>
  );
}
