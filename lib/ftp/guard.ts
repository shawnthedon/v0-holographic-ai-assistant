/**
 * Validation for FTP targets and upload batches.
 *
 * Pure functions — no `net`, no credentials, no I/O — so the rules can be
 * exercised by tests and reused by the route without dragging Node built-ins
 * into a client bundle.
 *
 * The host check is an allowlist. An endpoint that opens an outbound connection
 * to any host the caller names is a port-scanning primitive: without this, the
 * console becomes a way to probe an internal network from the deployment. The
 * allowlist is `FTP_ALLOWED_HOSTS` (comma separated, supports `*.example.com`),
 * or `FTP_ALLOW_ANY=1` for self-hosted installs that want open targets.
 */

import {
  FTP_MAX_BATCH_BYTES,
  FTP_MAX_FILES,
  type FtpError,
  type FtpTarget,
  type FtpUploadItem,
} from './types';

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export interface HostPolicy {
  allowed: string[];
  allowAny: boolean;
}

export function hostPolicyFromEnv(env: Record<string, string | undefined> = process.env): HostPolicy {
  const allowed = (env.FTP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return { allowed, allowAny: env.FTP_ALLOW_ANY === '1' };
}

/** `*.example.com` matches any subdomain; an exact entry matches only itself. */
export function hostAllowed(host: string, policy: HostPolicy): boolean {
  const clean = host.trim().toLowerCase().replace(/\.$/, '');
  if (!clean) return false;
  if (policy.allowAny) return true;
  return policy.allowed.some((entry) => {
    if (entry === clean) return true;
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1); // ".example.com"
      return clean.endsWith(suffix) && clean.length > suffix.length;
    }
    return false;
  });
}

export function validateTarget(
  input: Partial<FtpTarget>,
  policy: HostPolicy,
): { ok: true; target: FtpTarget } | { ok: false; error: FtpError } {
  const host = String(input.host ?? '').trim();
  if (!host) {
    return fail('ftp-invalid-host', 'No FTP host supplied', 'Enter the host name, e.g. ftp.example.com.');
  }
  if (!HOSTNAME.test(host) || host.includes('..')) {
    return fail(
      'ftp-invalid-host',
      `"${host}" is not a valid host name`,
      'Use a DNS name or IPv4 address without a scheme, path or port.',
    );
  }
  if (!hostAllowed(host, policy)) {
    return fail(
      'ftp-host-blocked',
      `FTP to ${host} is not allowed by this deployment`,
      policy.allowed.length
        ? `Add it to FTP_ALLOWED_HOSTS (currently: ${policy.allowed.join(', ')}).`
        : 'Set FTP_ALLOWED_HOSTS to the hosts you upload to, or FTP_ALLOW_ANY=1 on a self-hosted install.',
    );
  }

  const port = Number(input.port ?? 21);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return fail('ftp-invalid-port', `Port ${input.port} is out of range`, 'Use 21 for FTP or 990 for implicit FTPS.');
  }

  const username = String(input.username ?? '').trim();
  if (!username) {
    return fail('ftp-no-username', 'No FTP user supplied', 'Enter the account user name for this host.');
  }
  if (username.includes('\n') || username.includes('\r')) {
    return fail('ftp-invalid-username', 'User name contains a newline', 'Re-enter the user name.');
  }

  // Anonymous is allowed, but a password containing a newline is a protocol
  // injection into the PASS command — reject rather than sanitise.
  const password = String(input.password ?? '');
  if (/[\r\n]/.test(password)) {
    return fail('ftp-invalid-password', 'Password contains a newline', 'Re-enter the password.');
  }

  const remoteDir = normaliseRemoteDir(input.remoteDir);

  return {
    ok: true,
    target: { host, port, secure: Boolean(input.secure), username, password, remoteDir },
  };
}

/**
 * Remote directory hygiene: absolute, no `..`, no control characters, no
 * leading `~`. It is passed to CWD/MKD, so traversal here would write outside
 * the account's home.
 */
export function normaliseRemoteDir(input: string | undefined): string {
  const raw = String(input ?? '').trim();
  if (!raw || raw === '/') return '/';

  const segments = raw
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .map((segment) => segment.replace(/[\u0000-\u001f\u007f]/g, '').replace(/[^\w .-]/g, '_'));

  if (segments.length === 0) return '/';
  return `/${segments.join('/')}`;
}

export function validateBatch(input: unknown): { ok: true; items: FtpUploadItem[] } | { ok: false; error: FtpError } {
  if (!Array.isArray(input) || input.length === 0) {
    return fail('ftp-empty-batch', 'No files were supplied', 'Select at least one artifact to upload.');
  }
  if (input.length > FTP_MAX_FILES) {
    return fail(
      'ftp-batch-too-large',
      `A batch is limited to ${FTP_MAX_FILES} files (got ${input.length})`,
      'Upload in smaller groups.',
    );
  }

  let total = 0;
  const items: FtpUploadItem[] = [];

  for (const entry of input as Array<Record<string, unknown>>) {
    const name = String(entry?.name ?? '').trim();
    const contentBase64 = String(entry?.contentBase64 ?? '');
    if (!name || !contentBase64) {
      return fail('ftp-invalid-item', 'A file is missing its name or content', 'Re-add the artifact and retry.');
    }
    const isDotName = name === '.' || name === '..';
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(name) || name.includes('..') || isDotName) {
      return fail(
        'ftp-invalid-name',
        `"${name}" is not a safe remote file name`,
        'Use letters, digits, dot, dash and underscore only.',
      );
    }

    const decoded = Math.floor((contentBase64.length * 3) / 4);
    total += decoded;
    if (total > FTP_MAX_BATCH_BYTES) {
      return fail(
        'ftp-batch-too-large',
        `Batch exceeds ${(FTP_MAX_BATCH_BYTES / 1048576).toFixed(0)} MB decoded`,
        'Upload fewer or smaller files per request.',
      );
    }

    items.push({ name, contentBase64, sizeBytes: decoded });
  }

  return { ok: true, items };
}

function fail(code: string, message: string, fix: string): { ok: false; error: FtpError } {
  return { ok: false, error: { code, message, fix } };
}
