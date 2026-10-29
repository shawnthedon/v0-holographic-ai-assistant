/**
 * Live capability probe (server only).
 *
 * The studio may not assume a capability works because it is listed. This probe
 * asks the deployment what is actually here — providers with credentials, the
 * bundled browser, the FTP allowlist, speech keys, runtime and memory URLs —
 * and returns an `AvailabilityReport` per capability.
 *
 * A probe can confirm a capability, lower it, or leave it `check-required`.
 * It never raises a static `unsupported`, and it never invents a success.
 */

import { catalogue, providers } from '@/lib/llm/service';
import type { ModelSpec } from '@/lib/llm/types';
import type { Availability, AvailabilityReport, Feature } from './types';
import type { ModelOption } from './validate';

export interface CapabilitySnapshot {
  at: number;
  modelCount: number;
  configuredProviders: Array<{ id: string; label: string; configured: boolean }>;
  models: ModelOption[];
  defaultModelId: string;
  reports: Record<string, AvailabilityReport>;
  summary: {
    browsers: boolean;
    persistentMemory: boolean;
    markitdown: boolean;
    scheduler: boolean;
    ftp: boolean;
  };
}

/** Model roles → studio features. Only what the catalogue actually declares. */
export function featuresOf(model: ModelSpec): Feature[] {
  const features = new Set<Feature>();
  for (const role of model.roles) {
    if (role === 'chat' || role === 'code') features.add('text');
    if (role === 'vision') features.add('vision-in');
    if (role === 'speech-in') features.add('audio-in');
    if (role === 'speech-out') features.add('audio-out');
    if (role === 'omni') {
      features.add('text');
      features.add('vision-in');
      features.add('audio-in');
      features.add('audio-out');
    }
  }
  return Array.from(features);
}

function report(capabilityId: string, availability: Availability, note: string, detail?: string): AvailabilityReport {
  return { capabilityId, availability, note, detail, checkedAt: Date.now() };
}

const env = (key: string) => (process.env[key] ?? '').trim();

const RUNTIME_ENV: Record<string, string> = {
  'framework.langgraph': 'AGENT_RUNTIME_LANGGRAPH_URL',
  'framework.crewai': 'AGENT_RUNTIME_CREWAI_URL',
  'framework.ag2': 'AGENT_RUNTIME_AG2_URL',
  'framework.openclaw': 'AGENT_RUNTIME_OPENCLAW_URL',
};

let browserProbe: Promise<{ ok: boolean; note: string }> | null = null;

/**
 * Ask the browser bootstrap whether it can actually produce a binary. Cached
 * per process: the extraction is expensive and the answer does not change.
 */
function probeBrowser(): Promise<{ ok: boolean; note: string }> {
  if (browserProbe) return browserProbe;
  browserProbe = (async () => {
    try {
      const { probeBrowserBinary } = await import('@/lib/browser/chromium');
      const resolution = await Promise.race([
        probeBrowserBinary(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
      ]);
      if (!resolution) {
        return { ok: false, note: 'The browser check timed out — unproven, not working.' };
      }
      if (!resolution.available) {
        return { ok: false, note: resolution.reason ?? 'No Chromium binary could be resolved.' };
      }
      return { ok: true, note: resolution.note ?? 'Bundled Chromium resolved.' };
    } catch (error) {
      return { ok: false, note: `Browser bootstrap failed: ${(error as Error).message}` };
    }
  })();
  return browserProbe;
}

export async function probeCapabilities(): Promise<CapabilitySnapshot> {
  const at = Date.now();
  const providerStatuses = providers();
  const models = catalogue();

  const configured = new Set(providerStatuses.filter((provider) => provider.configured).map((provider) => provider.provider));

  const options: ModelOption[] = models
    .map((model) => ({
      id: model.id,
      label: model.label,
      provider: model.provider,
      features: featuresOf(model),
      configured: configured.has(model.provider),
      note: model.notes,
    }))
    .sort((a, b) => Number(b.configured) - Number(a.configured) || a.label.localeCompare(b.label));

  const browser = await probeBrowser();

  const hasSpeechOut = Boolean(env('ELEVENLABS_API_KEY') || env('GOOGLE_API_KEY'));
  const hasSpeechIn = Boolean(env('GOOGLE_API_KEY'));
  const ftpAllowlist = env('FTP_ALLOWED_HOSTS') || env('FTP_ALLOW_ANY');
  const memoryUrl = env('MEMORY_SUPERLOCAL_URL');
  const markitdownUrl = env('INGEST_MARKITDOWN_URL');
  const scheduler = env('AGENT_STUDIO_SCHEDULER') === '1';

  const reports: Record<string, AvailabilityReport> = {};

  reports['framework.task-runner'] = report(
    'framework.task-runner',
    'ready',
    'Installed in this build; executes supervised browser plans with checkpoints.',
  );

  for (const [id, key] of Object.entries(RUNTIME_ENV)) {
    const url = env(key);
    reports[id] = report(
      id,
      url ? 'ready' : 'needs-setup',
      url ? `Runtime configured at ${url.replace(/\/\/[^@]*@/, '//')}.` : `No runtime URL configured (${key}).`,
      url || undefined,
    );
  }

  reports['model.brain'] = report(
    'model.brain',
    configured.size > 0 ? 'ready' : 'needs-setup',
    configured.size > 0
      ? `${configured.size} of ${providerStatuses.length} providers have credentials.`
      : 'No provider has credentials — add a key in Settings or configure a custom endpoint.',
  );

  reports['memory.superlocal'] = report(
    'memory.superlocal',
    memoryUrl ? 'ready' : 'needs-setup',
    memoryUrl
      ? `Memory service configured at ${memoryUrl}.`
      : 'No SuperLocalMemory service is configured (MEMORY_SUPERLOCAL_URL).',
  );
  reports['memory.session'] = report('memory.session', 'ready', 'In-process only; nothing persists.');

  reports['interaction.text'] = report('interaction.text', 'ready', 'Console transcript is available.');
  reports['interaction.vision'] = report('interaction.vision', 'ready', 'Available when the routed model declares image input.');
  reports['interaction.voice-in'] = report(
    'interaction.voice-in',
    hasSpeechIn ? 'ready' : 'check-required',
    hasSpeechIn ? 'Speech-to-text credentials present.' : 'No speech-to-text credentials — microphone input cannot be transcribed.',
  );
  reports['interaction.voice-out'] = report(
    'interaction.voice-out',
    hasSpeechOut ? 'ready' : 'check-required',
    hasSpeechOut ? 'Text-to-speech credentials present.' : 'No text-to-speech credentials configured.',
  );

  reports['tools.browser'] = report(
    'tools.browser',
    browser.ok ? 'ready' : 'check-required',
    browser.note,
  );
  reports['tools.artifacts'] = report('tools.artifacts', 'ready', 'Local archive available.');
  reports['tools.ingest-local'] = report('tools.ingest-local', 'ready', 'Text, markdown, code, CSV and JSON only.');
  reports['tools.markitdown'] = report(
    'tools.markitdown',
    markitdownUrl ? 'ready' : 'needs-setup',
    markitdownUrl
      ? `MarkItDown worker configured at ${markitdownUrl}.`
      : 'No MarkItDown worker configured (INGEST_MARKITDOWN_URL) — PDF/Office stay unreadable.',
  );
  reports['tools.ftp'] = report(
    'tools.ftp',
    ftpAllowlist ? 'ready' : 'needs-setup',
    ftpAllowlist ? 'A host allowlist is configured.' : 'FTP_ALLOWED_HOSTS is empty, so no upload can be authorised.',
  );

  reports['knowledge.artifacts'] = report('knowledge.artifacts', 'ready', 'Reads the local archive.');
  reports['knowledge.uploads'] = report('knowledge.uploads', 'ready', 'Operator uploads accepted.');
  reports['knowledge.web'] = report('knowledge.web', browser.ok ? 'ready' : 'check-required', browser.note);

  reports['behaviour.respond'] = report('behaviour.respond', 'ready', 'Always available.');
  reports['behaviour.guided'] = report('behaviour.guided', 'ready', 'Approval prompt per action.');
  reports['behaviour.bounded'] = report('behaviour.bounded', 'ready', 'Allowlist + limits enforced by the runner.');
  reports['behaviour.scheduled'] = report(
    'behaviour.scheduled',
    scheduler ? 'ready' : 'check-required',
    scheduler ? 'Scheduler enabled for this deployment.' : 'No scheduler in this deployment — scheduled runs will not start on their own.',
  );

  reports['permissions.approval-gate'] = report('permissions.approval-gate', 'ready', 'Enforced by the console runtime.');

  const defaultModelId = options.find((model) => model.configured)?.id ?? options[0]?.id ?? '';

  return {
    at,
    modelCount: options.length,
    configuredProviders: providerStatuses.map((provider) => ({
      id: provider.provider,
      label: provider.label,
      configured: provider.configured,
    })),
    models: options,
    defaultModelId,
    reports,
    summary: {
      browsers: browser.ok,
      persistentMemory: Boolean(memoryUrl),
      markitdown: Boolean(markitdownUrl),
      scheduler,
      ftp: Boolean(ftpAllowlist),
    },
  };
}
