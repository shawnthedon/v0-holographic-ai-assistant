/**
 * Artifact domain types.
 *
 * An artifact is anything an agent (or the operator) produced that is worth
 * keeping, listing, opening and moving somewhere: a source file, a config, a
 * report, a data table, or a format we do not recognise. The kind is derived
 * from the file extension — never guessed from the content — so an unfamiliar
 * extension lands in `custom` instead of being mislabelled.
 */

export type ArtifactKind = 'code' | 'config' | 'report' | 'data' | 'custom';

export type ArtifactSource = 'agent' | 'operator' | 'import';

export interface ArtifactRemote {
  /** Remote FTP host the file was published to (no credentials, ever). */
  host: string;
  dir: string;
  uploadedAt: number;
  bytes: number;
}

export interface Artifact {
  id: string;
  /** Sanitised file name with extension, e.g. `report.md`. */
  name: string;
  /** Human readable label, e.g. `Q3 throughput report`. */
  title: string;
  kind: ArtifactKind;
  mime: string;
  extension: string;
  language?: string;
  sizeBytes: number;
  /** Inline text for small artifacts; null when stored as a blob. */
  text: string | null;
  /** Key into the `blobs` store, or null when the body is inline. */
  blobId: string | null;
  /** SHA-256 of the bytes, hex. Empty until computed. */
  hash: string;
  createdAt: number;
  updatedAt: number;
  source: ArtifactSource;
  agentId?: string;
  agentName?: string;
  description?: string;
  tags: string[];
  /** Where this was published, if it ever was. */
  remote?: ArtifactRemote;
}

export interface ArtifactBlob {
  id: string;
  bytes: ArrayBuffer;
  mime: string;
}

export interface ArtifactDraft {
  name: string;
  title?: string;
  kind?: ArtifactKind;
  text: string;
  language?: string;
  description?: string;
}

export interface ArtifactFilter {
  kind?: ArtifactKind | 'all';
  source?: ArtifactSource | 'all';
  query?: string;
  tag?: string;
}

export interface ArtifactStats {
  total: number;
  bytes: number;
  byKind: Record<ArtifactKind, number>;
  pendingSync: number;
}

export const ARTIFACT_KINDS: ArtifactKind[] = ['code', 'config', 'report', 'data', 'custom'];

/** Hard ceilings. A browser tab is not a file server. */
export const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;
/** Above this a body is stored as a blob instead of inline text. */
export const INLINE_LIMIT_BYTES = 512 * 1024;
/** What we are willing to pull back out of one agent message. */
export const MAX_DRAFTS_PER_MESSAGE = 8;

export class ArtifactError extends Error {
  readonly code: string;
  readonly fix: string;

  constructor(input: { code: string; message: string; fix: string }) {
    super(input.message);
    this.name = 'ArtifactError';
    this.code = input.code;
    this.fix = input.fix;
  }
}

export function toArtifactError(error: unknown): { code: string; message: string; fix: string } {
  if (error instanceof ArtifactError) {
    return { code: error.code, message: error.message, fix: error.fix };
  }
  return {
    code: 'artifact-error',
    message: error instanceof Error ? error.message : 'Unknown artifact failure',
    fix: 'Retry the action. If it persists, export the artifact and reload the console.',
  };
}
