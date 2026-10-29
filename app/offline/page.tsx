export const metadata = {
  title: 'NEXUS · offline',
};

/**
 * Offline fallback.
 *
 * Pre-cached by the service worker, so it is the one page guaranteed to render
 * with no network. It says what still works (artifacts on disk, on-device
 * models) and what does not (cloud inference) rather than showing a generic
 * dinosaur — the console is offline-first, the providers are not.
 */
export default function OfflinePage() {
  return (
    <main className="hud-root flex min-h-[100dvh] flex-col items-center justify-center gap-6 bg-[#02080a] px-6 text-center">
      <p className="font-mono text-[9px] uppercase tracking-[0.4em] text-[color:var(--hud-ink-dim)]">
        nexus core // 01001
      </p>
      <h1 className="font-mono text-[22px] uppercase tracking-[0.3em] text-[#9ff8ff]">
        channel offline
      </h1>
      <p className="max-w-[46ch] font-mono text-[11px] leading-relaxed tracking-[0.06em] text-[color:var(--hud-ink-dim)]">
        The network is unreachable. The console shell, your artifacts and any
        on-device model you have installed are still available; cloud models and
        FTP uploads are queued until the connection returns.
      </p>
      <a
        href="/"
        className="rounded border border-[#2ef2c0]/60 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.28em] text-[#2ef2c0] transition hover:bg-[#2ef2c0]/10"
      >
        retry console
      </a>
    </main>
  );
}
