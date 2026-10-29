import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/device-ai/proxy?url=<https://huggingface.co/…/file.gguf>
 *
 * Last-resort byte relay for model hosts that do not send CORS headers. The
 * browser still writes the bytes to disk itself; this only fixes the origin
 * problem. Range requests are forwarded so the download manager's resume stays
 * real.
 *
 * Deliberately narrow:
 *   • https only, host allowlist (no SSRF to internal addresses),
 *   • `.gguf` paths only,
 *   • redirects are validated hop by hop (the final host must also be allowed),
 *   • no cookies, no credentials, no caching, no request bodies.
 */

const ALLOWED_HOSTS = new Set([
  'huggingface.co',
  'cdn-lfs.huggingface.co',
  'cdn-lfs-us-1.huggingface.co',
  'cdn-lfs-eu-1.huggingface.co',
]);

function fail(status: number, error: string, code: string, fix: string) {
  return NextResponse.json({ error, code, fix }, { status });
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('url');
  if (!raw) {
    return fail(400, 'Missing ?url', 'bad-request', 'Pass a direct .gguf https URL from an approved model host.');
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return fail(400, 'Not a valid URL', 'bad-request', 'Check the URL and try again.');
  }

  if (target.protocol !== 'https:') {
    return fail(400, 'Only https downloads are proxied', 'bad-request', 'Use an https:// model URL.');
  }
  if (!ALLOWED_HOSTS.has(target.hostname)) {
    return fail(
      400,
      `Host "${target.hostname}" is not allowed`,
      'bad-request',
      `Approved hosts: ${[...ALLOWED_HOSTS].join(', ')}.`,
    );
  }
  if (!/\.gguf$/i.test(target.pathname)) {
    return fail(400, 'Only .gguf files are proxied', 'bad-request', 'Point the URL at a .gguf file.');
  }

  const headers: Record<string, string> = { accept: 'application/octet-stream' };
  const range = request.headers.get('range');
  if (range) headers.range = range;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 290_000);

  try {
    const upstream = await fetch(target.toString(), {
      headers,
      signal: controller.signal,
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
    });

    // Validate where the redirects actually landed, not where we started.
    const finalHost = new URL(upstream.url).hostname;
    if (!ALLOWED_HOSTS.has(finalHost)) {
      return fail(
        502,
        `The download redirected to an unapproved host (${finalHost})`,
        'network-error',
        'Copy the direct file URL from the model card instead of the redirecting one.',
      );
    }

    if (!upstream.ok && upstream.status !== 206) {
      return fail(
        upstream.status === 404 ? 404 : 502,
        `Model host answered ${upstream.status} ${upstream.statusText}`,
        upstream.status === 404 ? 'invalid-file' : 'network-error',
        upstream.status === 404
          ? 'The file has moved. Use “browse files” to pick the current GGUF name.'
          : 'Retry, or download the file in a browser and use Import instead.',
      );
    }

    const outHeaders = new Headers();
    for (const key of ['content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
      const value = upstream.headers.get(key);
      if (value) outHeaders.set(key, value);
    }
    outHeaders.set('content-type', 'application/octet-stream');
    outHeaders.set('cache-control', 'no-store');
    outHeaders.set('x-proxied-host', finalHost);

    // Stream straight through: never buffer a model in server memory.
    return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
  } catch (error) {
    const aborted = controller.signal.aborted;
    return fail(
      aborted ? 504 : 502,
      aborted ? 'The proxy timed out' : 'The proxy could not reach the model host',
      'network-error',
      'Model hosts limit long transfers. Prefer a direct download from a browser that allows CORS, or import the file manually.',
    );
  } finally {
    clearTimeout(timer);
  }
}
