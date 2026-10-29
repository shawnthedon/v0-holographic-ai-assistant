'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { telemetry } from '@/lib/hud/telemetry';

interface Props {
  children: ReactNode;
  /** Shown above the error text, e.g. "transcript". */
  label?: string;
  /** Compact renders a single inline line instead of a full panel. */
  compact?: boolean;
}

interface State {
  error: Error | null;
  errorId: number;
}

/**
 * Crash containment.
 *
 * React unmounts the whole tree when a render throws, which is what "the chat
 * window keeps crashing the app" looks like from the outside: the console goes
 * blank and the only way back is a reload. This boundary keeps the failure
 * local, shows the actual message, and records it in the HUD insight log so the
 * next occurrence is diagnosable instead of mysterious.
 *
 * It is not a fix for an underlying bug — it is what makes one survivable.
 */
export class HudErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorId: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const where = this.props.label ? ` · ${this.props.label}` : '';
    // Never log message content — only the failure itself.
    telemetry.logEvent(`ui fault${where} · ${error.name}`, 'warn');
    console.error('[hud] contained render error', error, info.componentStack);
  }

  private reset = () => {
    this.setState((current) => ({ error: null, errorId: current.errorId + 1 }));
  };

  render() {
    const { error } = this.state;
    if (!error) return <div key={this.state.errorId} className="contents">{this.props.children}</div>;

    const detail = error.message || error.name || 'unknown error';

    if (this.props.compact) {
      return (
        <div className="flex items-start gap-2 rounded border border-[#ff9d7a]/50 bg-[#1a0a05]/90 px-2.5 py-2 font-mono text-[8px] uppercase leading-[1.6] tracking-[0.14em] text-[#ff9d7a]">
          <span className="flex-1">
            {this.props.label ?? 'panel'} faulted · {detail.slice(0, 160)}
          </span>
          <button
            type="button"
            onClick={this.reset}
            className="rounded border border-[#ff9d7a]/60 px-1.5 py-[2px] hover:bg-[#ff9d7a]/10"
          >
            retry
          </button>
        </div>
      );
    }

    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-mono text-[9px] uppercase tracking-[0.34em] text-[#ff9d7a]">
          {this.props.label ?? 'interface'} fault
        </p>
        <p className="max-w-[46ch] font-mono text-[10px] leading-relaxed text-[color:var(--hud-ink-dim)]">
          {detail}
        </p>
        <p className="max-w-[46ch] font-mono text-[8px] uppercase leading-[1.7] tracking-[0.16em] text-[color:var(--hud-ink-dim)]/70">
          recorded in the insight log · the rest of the console keeps running
        </p>
        <button
          type="button"
          onClick={this.reset}
          className="rounded border border-[color:var(--hud-line-strong)] px-3 py-1.5 font-mono text-[8px] uppercase tracking-[0.24em] text-[color:var(--hud-ink)] transition hover:border-[color:var(--hud-lime)] hover:text-[color:var(--hud-lime)]"
        >
          restore view
        </button>
      </div>
    );
  }
}
