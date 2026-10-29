/**
 * Loop detection.
 *
 * The failure mode this file prevents is the one that wastes hours: an agent
 * that clicks the same button, gets the same error, and clicks it again — while
 * reporting that it is "working". Repetition is only acceptable when the page
 * actually changed between attempts; otherwise it is a loop and the runner must
 * stop, keep the evidence, and try something materially different.
 *
 * Pure and deterministic: the runner feeds it signatures, it returns findings.
 */

export type LoopKind =
  | 'repeated-action'
  | 'navigation-pingpong'
  | 'identical-results'
  | 'repeated-error'
  | 'retry-after-block'
  | 'repeated-download';

export interface LoopFinding {
  kind: LoopKind;
  /** Stable key so the UI can dedupe and the runner can count distinct loops. */
  signature: string;
  /** How many times the pattern was seen. */
  count: number;
  message: string;
  /** What to do instead — never "try the same thing again". */
  advice: string;
}

export interface LoopOptions {
  /** How many recent observations to keep per channel. */
  window?: number;
  /** Repetitions before the pattern counts as a loop. */
  threshold?: number;
}

interface Recording {
  key: string;
  count: number;
  at: number;
}

const DEFAULT_WINDOW = 12;
const DEFAULT_THRESHOLD = 3;

export class LoopDetector {
  private readonly window: number;
  private readonly threshold: number;

  private actions: Recording[] = [];
  private navigations: string[] = [];
  private results: Recording[] = [];
  private errors: Recording[] = [];
  private downloads: Recording[] = [];

  private blockedSignature: string | null = null;
  private findings = new Map<string, LoopFinding>();

  constructor(options: LoopOptions = {}) {
    this.window = options.window ?? DEFAULT_WINDOW;
    this.threshold = options.threshold ?? DEFAULT_THRESHOLD;
  }

  /**
   * Record an attempted action.
   *
   * `stateDigest` is the page digest *before* the action, so the same click on
   * a page that genuinely changed is not counted as a repeat.
   */
  recordAction(stepId: string, target: string, stateDigest: string, at: number): LoopFinding | null {
    const key = `${stepId}|${target}|${stateDigest}`;
    const count = bump(this.actions, key, at, this.window);

    if (this.blockedSignature && key.includes(this.blockedSignature)) {
      return this.remember({
        kind: 'retry-after-block',
        signature: key,
        count,
        message: 'the agent tried the blocked action again',
        advice: 'Stop this action entirely: the site already refused it. Use an authorised alternative or hand the task back.',
      });
    }

    if (count >= this.threshold) {
      return this.remember({
        kind: 'repeated-action',
        signature: key,
        count,
        message: `the same action (${stepId} → ${target}) was repeated ${count}× with no page change`,
        advice: 'Stop repeating it. Re-inspect the page, pick a different interaction method, or choose another route.',
      });
    }
    return null;
  }

  /** Navigation ping-pong: A → B → A → B … */
  recordNavigation(url: string): LoopFinding | null {
    this.navigations.push(stripHash(url));
    if (this.navigations.length > this.window) this.navigations.shift();

    const tail = this.navigations.slice(-6);
    if (tail.length >= 4 && isAlternating(tail)) {
      return this.remember({
        kind: 'navigation-pingpong',
        signature: `nav:${tail.slice(-2).join('↔')}`,
        count: tail.length,
        message: `the agent is bouncing between ${tail[0]} and ${tail[1]}`,
        advice: 'Neither page is advancing the task. Break the cycle or record the obstacle and continue elsewhere.',
      });
    }
    return null;
  }

  /** The same query producing the same result set, again and again. */
  recordResults(key: string, resultDigest: string, at: number): LoopFinding | null {
    const combined = `${key}|${resultDigest}`;
    const count = bump(this.results, combined, at, this.window);
    if (count >= this.threshold) {
      return this.remember({
        kind: 'identical-results',
        signature: combined,
        count,
        message: `"${key}" returned the same results ${count}×`,
        advice: 'Change the query, the source, or the page — repeating it cannot produce new information.',
      });
    }
    return null;
  }

  recordError(errorKey: string, at: number): LoopFinding | null {
    const count = bump(this.errors, errorKey, at, this.window);
    if (count >= this.threshold) {
      return this.remember({
        kind: 'repeated-error',
        signature: errorKey,
        count,
        message: `the same browser error occurred ${count}× (${errorKey})`,
        advice: 'The retry strategy is not working. Reassess the target, the URL, or hand the task back with this error.',
      });
    }
    return null;
  }

  recordDownload(key: string, at: number): LoopFinding | null {
    const count = bump(this.downloads, key, at, this.window);
    if (count >= 2) {
      return this.remember({
        kind: 'repeated-download',
        signature: key,
        count,
        message: `the same file was downloaded ${count}×`,
        advice: 'The download already succeeded — reuse the existing file instead of fetching it again.',
      });
    }
    return null;
  }

  /**
   * Called when a restriction is detected. Any further attempt at that
   * signature is reported as `retry-after-block` immediately.
   */
  markBlocked(signature: string): void {
    this.blockedSignature = signature;
  }

  clearBlock(): void {
    this.blockedSignature = null;
  }

  get isBlocked(): boolean {
    return this.blockedSignature !== null;
  }

  /** Distinct findings, most recent first — this is what the UI lists. */
  list(): LoopFinding[] {
    return [...this.findings.values()];
  }

  reset(): void {
    this.actions = [];
    this.navigations = [];
    this.results = [];
    this.errors = [];
    this.downloads = [];
    this.blockedSignature = null;
    this.findings.clear();
  }

  private remember(finding: LoopFinding): LoopFinding {
    this.findings.set(`${finding.kind}:${finding.signature}`, finding);
    return finding;
  }
}

function bump(list: Recording[], key: string, at: number, window: number): number {
  const existing = list.find((entry) => entry.key === key);
  if (existing) {
    existing.count += 1;
    existing.at = at;
  } else {
    list.push({ key, count: 1, at });
  }
  while (list.length > window) list.shift();
  return existing ? existing.count : 1;
}

function isAlternating(urls: string[]): boolean {
  const [a, b] = urls;
  if (a === b) return false;
  return urls.every((url, index) => url === (index % 2 === 0 ? a : b));
}

export function stripHash(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url.split('#')[0];
  }
}
