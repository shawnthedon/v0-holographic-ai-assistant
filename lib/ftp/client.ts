/**
 * Server-side FTP/FTPS client.
 *
 * A browser cannot speak FTP — there is no raw TCP socket in the platform — so
 * this is the one part of the artifact system that must run on the server. That
 * is a real constraint, not an implementation choice, and the UI says so where
 * it matters (the upload needs a reachable deployment, not just a browser).
 *
 * Everything here is bounded: connect timeout, per-operation timeout, batch size
 * limits enforced by the caller, and a host allowlist checked before this module
 * is ever reached. Credentials are never logged and never included in an error
 * message.
 */

import { createHash } from 'node:crypto';
import { Client } from 'basic-ftp';
import type { FtpUploadItem, FtpUploadResult } from './types';

export interface FtpConnection {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  remoteDir: string;
}

export interface FtpFailure {
  code: string;
  message: string;
  fix: string;
}

const CONNECT_TIMEOUT_MS = 15_000;
const OP_TIMEOUT_MS = 30_000;

export class FtpClientError extends Error {
  readonly code: string;
  readonly fix: string;

  constructor(failure: FtpFailure) {
    super(failure.message);
    this.name = 'FtpClientError';
    this.code = failure.code;
    this.fix = failure.fix;
  }
}

/** Strip anything that could be a credential from an upstream message. */
function redact(message: string, connection: FtpConnection): string {
  let clean = message;
  if (connection.password) clean = clean.split(connection.password).join('***');
  if (connection.username) {
    clean = clean.replace(new RegExp(`${connection.username}`, 'g'), '***');
  }
  return clean.replace(/[\r\n]+/g, ' ').slice(0, 300);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, code: string, fix: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new FtpClientError({ code, message: `Operation timed out after ${ms / 1000}s`, fix })), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function connect(connection: FtpConnection): Promise<Client> {
  const client = new Client(CONNECT_TIMEOUT_MS);
  client.ftp.verbose = false;

  try {
    await withTimeout(
      client.access({
        host: connection.host,
        port: connection.port,
        user: connection.username,
        password: connection.password,
        secure: connection.secure,
        // Plain FTP is permitted but the connection is not silently downgraded
        // from a secure request: FTPS without a valid certificate fails here.
        secureOptions: connection.secure ? { rejectUnauthorized: true } : undefined,
      }),
      CONNECT_TIMEOUT_MS + 1000,
      'ftp-timeout',
      'Check the host, port and firewall. Passive-mode FTP needs the control and data ports open.',
    );
  } catch (error) {
    if (error instanceof FtpClientError) throw error;
    const message = redact(error instanceof Error ? error.message : String(error), connection);
    throw new FtpClientError({
      code: /430|530|532/i.test(message) ? 'ftp-auth-failed' : 'ftp-connect-failed',
      message: `FTP connection to ${connection.host}:${connection.port} failed — ${message}`,
      fix: /430|530|532/i.test(message)
        ? 'The server rejected the credentials. Re-enter the user name and password.'
        : 'Verify the host and port, and that the server allows passive mode from this network.',
    });
  }

  return client;
}

export async function testConnection(connection: FtpConnection): Promise<{ dir: string }> {
  const client = await connect(connection);
  try {
    const dir = await ensureDir(client, connection.remoteDir);
    return { dir };
  } finally {
    client.close();
  }
}

async function ensureDir(client: Client, remoteDir: string): Promise<string> {
  const target = remoteDir === '/' ? '/' : remoteDir;
  if (target === '/') return '/';

  try {
    await withTimeout(
      client.cd(target),
      OP_TIMEOUT_MS,
      'ftp-timeout',
      'The server did not answer the directory change.',
    );
    return target;
  } catch {
    // Missing directory is the common case — create it, then re-enter.
    try {
      await withTimeout(
        client.ensureDir(target),
        OP_TIMEOUT_MS,
        'ftp-timeout',
        'The server did not answer the directory creation.',
      );
      await withTimeout(client.cd(target), OP_TIMEOUT_MS, 'ftp-timeout', 'Could not enter the directory.');
      return target;
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : String(error), {
        ...({} as FtpConnection),
        password: '',
        username: '',
      } as FtpConnection);
      throw new FtpClientError({
        code: 'ftp-dir-failed',
        message: `Could not open or create ${target} — ${message}`,
        fix: 'Check that the account may write to this directory, or point at one it owns.',
      });
    }
  }
}

/**
 * Upload one batch. Returns per-file results; a single bad file does not abort
 * the rest, but the caller gets the failures and decides how to report them.
 */
export async function uploadBatch(
  connection: FtpConnection,
  items: FtpUploadItem[],
): Promise<{ uploaded: FtpUploadResult[]; failures: Array<FtpFailure & { name: string }> }> {
  const client = await connect(connection);
  const uploaded: FtpUploadResult[] = [];
  const failures: Array<FtpFailure & { name: string }> = [];

  try {
    const dir = await ensureDir(client, connection.remoteDir);

    for (const item of items) {
      try {
        const buffer = Buffer.from(item.contentBase64, 'base64');
        const remotePath = dir === '/' ? `/${item.name}` : `${dir}/${item.name}`;
        const { Readable } = await import('node:stream');

        await withTimeout(
          client.uploadFrom(Readable.from(buffer), item.name),
          OP_TIMEOUT_MS,
          'ftp-timeout',
          `The server did not accept ${item.name}.`,
        );

        uploaded.push({
          name: item.name,
          bytes: buffer.byteLength,
          remotePath,
          sha256: createHash('sha256').update(buffer).digest('hex'),
        });
      } catch (error) {
        const message = redact(error instanceof Error ? error.message : String(error), connection);
        failures.push({
          name: item.name,
          code: /550|553/.test(message) ? 'ftp-permission-denied' : 'ftp-upload-failed',
          message: `${item.name}: ${message}`,
          fix: /550|553/.test(message)
            ? 'The server refused the write. Check directory permissions and available quota.'
            : 'Retry. If it repeats, test the connection and check the server log.',
        });
      }
    }
  } finally {
    client.close();
  }

  return { uploaded, failures };
}
