import { NextRequest, NextResponse } from 'next/server';
import { probeCapabilities } from '@/lib/agent-studio/probe';
import { listAgents, saveVersion } from '@/lib/agent-studio/store';
import { validateDraft } from '@/lib/agent-studio/validate';
import type { AgentConfigRecord, AgentDraft } from '@/lib/agent-studio/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const records = await listAgents();
  return NextResponse.json({
    ok: true,
    agents: records.map((record) => {
      const latest = record.versions[record.versions.length - 1];
      return {
        agentId: record.agentId,
        name: record.name,
        updatedAt: record.updatedAt,
        version: latest?.version ?? 0,
        state: latest?.state ?? 'draft',
        blockers: latest?.validation.blockers ?? 0,
        warnings: latest?.validation.warnings ?? 0,
        runtime: latest?.runtime ?? { connected: false, note: 'No record.' },
        createdAt: record.versions[0]?.createdAt ?? record.updatedAt,
      };
    }),
  });
}

/**
 * Activation.
 *
 * The server re-validates the draft against a *fresh* probe — the browser's word
 * for it is not enough. A blocked configuration is refused with the exact
 * blockers, and an accepted one records whether a runtime is really connected,
 * so "active" never means "we hope so".
 */
export async function POST(request: NextRequest) {
  let body: { draft?: AgentDraft };
  try {
    body = (await request.json()) as { draft?: AgentDraft };
  } catch {
    return NextResponse.json(
      { ok: false, code: 'bad-request', message: 'Body was not JSON.', fix: 'Send { draft }.' },
      { status: 400 },
    );
  }

  const draft = body.draft;
  if (!draft || typeof draft !== 'object' || !draft.selected) {
    return NextResponse.json(
      { ok: false, code: 'no-draft', message: 'No draft in the request.', fix: 'Send the draft produced by the studio.' },
      { status: 400 },
    );
  }

  const snapshot = await probeCapabilities();
  const validation = validateDraft({ draft, availability: snapshot.reports, models: snapshot.models });

  if (!validation.activatable) {
    return NextResponse.json(
      {
        ok: false,
        code: 'configuration-blocked',
        message: `Activation refused: ${validation.blockers.length} blocker(s), ${validation.warnings.length} unacknowledged warning(s).`,
        fix: 'Resolve the blockers and acknowledge the warnings in the Validation panel, then activate again.',
        blockers: validation.blockers,
        warnings: validation.warnings,
      },
      { status: 409 },
    );
  }

  const frameworkId = Object.keys(draft.selected).find((id) => id.startsWith('framework.'));
  const runtimeState = frameworkId ? snapshot.reports[frameworkId] : undefined;
  const runtimeConnected = runtimeState?.availability === 'ready';

  const agentId = draft.id.replace(/^draft-/, 'agent-');
  const now = Date.now();

  const record: AgentConfigRecord = {
    id: `${agentId}-v${draft.version}`,
    agentId,
    name: draft.name.trim() || 'Untitled agent',
    goal: draft.goal,
    role: draft.role,
    version: draft.version,
    createdAt: now,
    state: 'active',
    source: 'studio',
    selected: draft.selected,
    granted: draft.granted,
    validation: {
      at: validation.at,
      activatable: validation.activatable,
      blockers: validation.blockers.length,
      warnings: validation.warnings.length,
      acknowledged: draft.acknowledged,
    },
    runtime: {
      connected: runtimeConnected,
      note: runtimeConnected
        ? `${frameworkId} is connected; this version is the one new runs use.`
        : 'Configuration saved, but no runtime is connected — nothing will execute until one is.',
    },
  };

  const file = await saveVersion(record);

  return NextResponse.json({
    ok: true,
    agent: record,
    versions: file.versions.length,
    features: validation.features,
    permissions: validation.permissions,
  });
}
