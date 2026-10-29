import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/device-ai/hf?repo=<owner>/<name>
 *
 * Lists the actual `.gguf` files in a Hugging Face repo with their real sizes,
 * so the console can pin the exact file instead of trusting a hard-coded name.
 * Preset filenames rot; this is how the UI resolves them at download time.
 *
 * Server-side only, strictly allowlisted: it never fetches a host the caller
 * chooses, only `huggingface.co/api/models/<repo>/tree/main`.
 */

const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

interface HfTreeEntry {
  type?: string;
  path?: string;
  size?: number;
  lfs?: { oid?: string; size?: number };
}

export async function GET(request: NextRequest) {
  const repo = request.nextUrl.searchParams.get('repo') ?? '';
  if (!REPO_PATTERN.test(repo)) {
    return NextResponse.json(
      {
        error: 'Invalid repo — expected "<owner>/<name>"',
        code: 'bad-request',
        fix: 'Pass a Hugging Face repo id, e.g. ?repo=bartowski/Qwen2.5-0.5B-Instruct-GGUF',
      },
      { status: 400 },
    );
  }

  const url = `https://huggingface.co/api/models/${repo}/tree/main`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      // The Hub is public data; no cookies, no credentials.
      credentials: 'omit',
      cache: 'no-store',
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `Hugging Face answered ${response.status} for ${repo}`,
          code: response.status === 404 ? 'invalid-file' : 'network-error',
          fix:
            response.status === 404
              ? 'That repo does not exist or is private. Open the model card and copy the exact repo id.'
              : 'Retry. If it persists, the Hub may be rate limiting this deployment.',
          repo,
          files: [],
        },
        { status: response.status === 404 ? 404 : 502 },
      );
    }

    const tree = (await response.json()) as HfTreeEntry[];
    const files = tree
      .filter((entry) => entry.type === 'file' && /\.gguf$/i.test(entry.path ?? ''))
      .map((entry) => ({
        name: entry.path!.split('/').pop()!,
        path: entry.path!,
        sizeBytes: entry.lfs?.size ?? entry.size ?? 0,
        sha256: entry.lfs?.oid && entry.lfs.oid.length === 64 ? entry.lfs.oid : undefined,
        url: `https://huggingface.co/${repo}/resolve/main/${entry.path!}`,
      }))
      .sort((a, b) => a.sizeBytes - b.sizeBytes);

    return NextResponse.json(
      { repo, files, count: files.length },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const aborted = controller.signal.aborted;
    return NextResponse.json(
      {
        error: aborted ? 'Hugging Face did not answer in time' : 'Could not reach Hugging Face',
        code: 'network-error',
        fix: 'Retry in a moment, or paste the direct file URL from the model card instead.',
        repo,
        files: [],
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
