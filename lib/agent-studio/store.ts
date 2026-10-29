/**
 * Durable studio records (server only).
 *
 * One JSON document per agent, keyed by agent id, holding its configuration
 * versions newest-last. Writes are atomic (temp file + rename) so a crash never
 * leaves half a configuration on disk, and the file is the audit trail: which
 * version exists, when it was activated, what validation allowed it, and whether
 * a runtime was actually connected.
 */

import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentConfigRecord } from './types';

export interface AgentRecordFile {
  agentId: string;
  name: string;
  updatedAt: number;
  versions: AgentConfigRecord[];
}

const MAX_VERSIONS = 25;

function directory(): string {
  return process.env.AGENT_STUDIO_DIR ?? path.join(process.cwd(), '.nexus', 'agents');
}

function fileFor(agentId: string): string {
  const safe = agentId.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80);
  return path.join(directory(), `${safe}.json`);
}

async function ensureDirectory(): Promise<void> {
  await mkdir(directory(), { recursive: true });
}

async function readJson(file: string): Promise<AgentRecordFile | null> {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as AgentRecordFile;
    if (!parsed || !Array.isArray(parsed.versions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function listAgents(): Promise<AgentRecordFile[]> {
  await ensureDirectory();
  const entries = await readdir(directory()).catch(() => [] as string[]);
  const files = entries.filter((entry) => entry.endsWith('.json'));
  const records = await Promise.all(files.map((entry) => readJson(path.join(directory(), entry))));
  return records
    .filter((record): record is AgentRecordFile => Boolean(record))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getAgent(agentId: string): Promise<AgentRecordFile | null> {
  await ensureDirectory();
  return readJson(fileFor(agentId));
}

export async function saveVersion(record: AgentConfigRecord): Promise<AgentRecordFile> {
  await ensureDirectory();
  const file = fileFor(record.agentId);
  const existing = (await readJson(file)) ?? { agentId: record.agentId, name: record.name, updatedAt: record.createdAt, versions: [] };

  const versions = existing.versions.filter((version) => version.version !== record.version);
  versions.push(record);
  versions.sort((a, b) => a.version - b.version);

  const next: AgentRecordFile = {
    agentId: record.agentId,
    name: record.name,
    updatedAt: Date.now(),
    versions: versions.slice(-MAX_VERSIONS),
  };

  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(next, null, 2), 'utf8');
  await rename(temp, file);
  return next;
}

export async function setAgentState(agentId: string, state: AgentConfigRecord['state'] | 'archived'): Promise<AgentRecordFile | null> {
  const record = await getAgent(agentId);
  if (!record || record.versions.length === 0) return null;
  const latest = record.versions[record.versions.length - 1];
  const updated: AgentConfigRecord = {
    ...latest,
    state: state === 'archived' ? 'draft' : state,
  };
  const next: AgentRecordFile = {
    ...record,
    updatedAt: Date.now(),
    versions: [...record.versions.slice(0, -1), updated],
  };
  const file = fileFor(agentId);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(next, null, 2), 'utf8');
  await rename(temp, file);
  return next;
}

export async function deleteAgent(agentId: string): Promise<boolean> {
  try {
    await unlink(fileFor(agentId));
    return true;
  } catch {
    return false;
  }
}
