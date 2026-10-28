/**
 * Minimal, safe structured logging for the LLM layer.
 *
 * Never logs prompts, completions or credentials — only routing metadata, so
 * the console can show what happened without leaking conversation content.
 */
export function telemetryServerLog(event: string, fields: Record<string, string | number | boolean | undefined>) {
  if (process.env.LLM_LOG === 'off') return;
  const clean = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
  console.log(`[llm] ${event} ${JSON.stringify(clean)}`);
}
