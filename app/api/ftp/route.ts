import { NextRequest, NextResponse } from 'next/server';
import { FtpClientError, testConnection, uploadBatch } from '@/lib/ftp/client';
import { hostPolicyFromEnv, normaliseRemoteDir, validateBatch, validateTarget } from '@/lib/ftp/guard';
import { FTP_DEFAULT_PORT, FTPS_DEFAULT_PORT, FTP_MAX_BATCH_BYTES, FTP_MAX_FILES } from '@/lib/ftp/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * FTP/FTPS for artifacts.
 *
 * GET  /api/ftp  — what this deployment permits (host allowlist, limits)
 * POST /api/ftp  — { action: 'test' | 'upload', target, files? }
 *
 * The browser cannot open a TCP socket, so this is server-side by necessity.
 * A deployment with no allowlist answers 403 with the exact variable to set,
 * rather than failing later with an unexplained socket error.
 */

export async function GET() {
  const policy = hostPolicyFromEnv();
  return NextResponse.json(
    {
      available: true,
      allowAny: policy.allowAny,
      allowedHosts: policy.allowed,
      configured: policy.allowAny || policy.allowed.length > 0,
      limits: { maxFiles: FTP_MAX_FILES, maxBytes: FTP_MAX_BATCH_BYTES },
      ports: { ftp: FTP_DEFAULT_PORT, ftps: FTPS_DEFAULT_PORT },
      note: 'FTP runs on the server: the browser cannot open a raw TCP connection. Credentials are sent per request and never stored.',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

interface FtpRequestBody {
  action?: 'test' | 'upload';
  target?: {
    host?: string;
    port?: number;
    secure?: boolean;
    username?: string;
    password?: string;
    remoteDir?: string;
  };
  files?: unknown;
}

export async function POST(request: NextRequest) {
  let body: FtpRequestBody;
  try {
    body = (await request.json()) as FtpRequestBody;
  } catch {
    return NextResponse.json(
      { error: 'Body must be JSON', code: 'bad-request', fix: 'Send { action, target, files }.' },
      { status: 400 },
    );
  }

  const action = body.action ?? 'upload';
  if (action !== 'test' && action !== 'upload') {
    return NextResponse.json(
      { error: `Unknown action "${action}"`, code: 'bad-request', fix: 'Use action "test" or "upload".' },
      { status: 400 },
    );
  }

  const policy = hostPolicyFromEnv();
  const validated = validateTarget(body.target ?? {}, policy);
  if (!validated.ok) {
    return NextResponse.json(
      { error: validated.error.message, code: validated.error.code, fix: validated.error.fix },
      { status: 403 },
    );
  }

  const target = validated.target;

  if (action === 'test') {
    try {
      const { dir } = await testConnection(target);
      return NextResponse.json(
        {
          ok: true,
          host: target.host,
          port: target.port,
          secure: target.secure,
          dir: normaliseRemoteDir(dir),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } catch (error) {
      return failureResponse(error);
    }
  }

  const batch = validateBatch(body.files);
  if (!batch.ok) {
    return NextResponse.json(
      { error: batch.error.message, code: batch.error.code, fix: batch.error.fix },
      { status: 400 },
    );
  }

  try {
    const { uploaded, failures } = await uploadBatch(target, batch.items);
    const status = uploaded.length === 0 ? 502 : 200;

    return NextResponse.json(
      {
        ok: uploaded.length > 0,
        host: target.host,
        dir: target.remoteDir,
        uploaded,
        failures,
        error: uploaded.length === 0 ? failures[0]?.message ?? 'Upload failed' : undefined,
        code: uploaded.length === 0 ? failures[0]?.code ?? 'ftp-upload-failed' : undefined,
        fix: uploaded.length === 0 ? failures[0]?.fix : undefined,
      },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return failureResponse(error);
  }
}

function failureResponse(error: unknown) {
  if (error instanceof FtpClientError) {
    return NextResponse.json(
      { error: error.message, code: error.code, fix: error.fix },
      { status: 502 },
    );
  }
  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : 'FTP operation failed',
      code: 'ftp-failed',
      fix: 'Retry. If it repeats, run the connection test and check the server log.',
    },
    { status: 502 },
  );
}
