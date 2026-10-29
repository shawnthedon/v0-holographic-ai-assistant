/**
 * Browser agent domain types.
 *
 * These are shared by the server runner, the API routes and the observation
 * panel, so nothing in this file may import node built-ins or the engine.
 *
 * The vocabulary is deliberately narrow: a task is either making verified
 * progress, recovering, waiting for a human, or finished in one of the four
 * terminal states. There is no "looks busy" state — a task that has an open
 * page but no progress is `stalled`, and the watchdog says so.
 */

/** Non-terminal states from the spec, plus PAUSED for the operator controls. */
export type BrowserTaskState =
  | 'QUEUED'
  | 'RUNNING'
  | 'RECOVERING'
  | 'WAITING_FOR_USER'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED'
  | 'CANCELLED'
  | 'TIMED_OUT';

export const TERMINAL_STATES: BrowserTaskState[] = [
  'COMPLETED',
  'FAILED',
  'BLOCKED',
  'CANCELLED',
  'TIMED_OUT',
];

export function isTerminal(state: BrowserTaskState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** How the observation panel should describe the agent right now. */
export type Activity = 'working' | 'recovering' | 'waiting' | 'paused' | 'stalled' | 'done';

/* ------------------------------------------------------------------ */
/*  limits                                                             */
/* ------------------------------------------------------------------ */

export interface BrowserLimits {
  /** Any single browser action (click, type, navigate) gets this long. */
  actionTimeoutMs: number;
  /** Navigation is slower than a click; it gets its own budget. */
  navigationTimeoutMs: number;
  /** No verified progress for this long → recovery, not more waiting. */
  progressIntervalMs: number;
  /** Wall-clock budget for the whole task. */
  deadlineMs: number;
  /** Total retries across the task. */
  maxRetries: number;
  /** Consecutive failures before the task is blocked. */
  maxConsecutiveFailures: number;
  /** Recovery ladder passes before the task is blocked. */
  maxRecoveryAttempts: number;
  /** Identical actions inside the loop window before we call it a loop. */
  maxRepeats: number;
  /** Open tabs the session may hold before cleanup runs. */
  maxTabs: number;
  /** JS heap ceiling before the browser is recycled. */
  maxHeapMb: number;
  /** Consecutive steps without a verified milestone before escalation. */
  maxUnverifiedSteps: number;
}

export const DEFAULT_LIMITS: BrowserLimits = {
  actionTimeoutMs: 10_000,
  navigationTimeoutMs: 25_000,
  progressIntervalMs: 90_000,
  deadlineMs: 30 * 60_000,
  maxRetries: 6,
  maxConsecutiveFailures: 4,
  maxRecoveryAttempts: 3,
  maxRepeats: 3,
  maxTabs: 6,
  maxHeapMb: 768,
  maxUnverifiedSteps: 12,
};

/* ------------------------------------------------------------------ */
/*  plan                                                               */
/* ------------------------------------------------------------------ */

/** Stable element targeting: accessible role + name first, CSS only as fallback. */
export interface BrowserTarget {
  role?: string;
  name?: string;
  selector?: string;
  text?: string;
  /** Index among matches, for lists that share a name. */
  index?: number;
}

/**
 * Interaction methods in the order the engine prefers them. A retry must use a
 * *different* method — repeating the identical click is what the spec forbids.
 */
export type InteractionMethod = 'auto' | 'mouse' | 'dom' | 'keyboard';

export interface StepExpectation {
  /**
   * Criteria that prove this step took effect. They are what makes a retry safe:
   * before repeating a sensitive action the runner checks whether it already
   * happened, instead of doing it twice.
   */
  expect?: SuccessCriterion[];
}

export type BrowserStep = (
  | { id: string; kind: 'navigate'; url: string; milestone: string }
  | { id: string; kind: 'click'; target: BrowserTarget; milestone: string; sensitive?: boolean }
  | { id: string; kind: 'type'; target: BrowserTarget; text: string; milestone: string; sensitive?: boolean }
  | { id: string; kind: 'press'; key: string; milestone: string }
  | { id: string; kind: 'wait'; ms: number; milestone: string }
  | { id: string; kind: 'verify'; criteria: SuccessCriterion[]; milestone: string }
) &
  StepExpectation;

/** Declarative success checks — they survive serialisation and are re-evaluated live. */
export type SuccessCriterion =
  | { type: 'url-matches'; pattern: string; label?: string }
  | { type: 'title-contains'; text: string; label?: string }
  | { type: 'text-present'; text: string; label?: string }
  | { type: 'text-absent'; text: string; label?: string }
  | { type: 'element-present'; target: BrowserTarget; label?: string }
  | { type: 'download-begun'; label?: string };

export function describeCriterion(criterion: SuccessCriterion): string {
  switch (criterion.type) {
    case 'url-matches':
      return `url matches ${criterion.pattern}`;
    case 'title-contains':
      return `title contains "${criterion.text}"`;
    case 'text-present':
      return `page shows "${criterion.text}"`;
    case 'text-absent':
      return `page no longer shows "${criterion.text}"`;
    case 'element-present':
      return `element ${criterion.target.role ?? ''}${criterion.target.name ? ` "${criterion.target.name}"` : ''}${
        criterion.target.selector ? ` (${criterion.target.selector})` : ''
      } is present`;
    case 'download-begun':
      return 'a download started';
  }
}

/* ------------------------------------------------------------------ */
/*  evidence                                                           */
/* ------------------------------------------------------------------ */

export interface CriterionResult {
  criterion: SuccessCriterion;
  ok: boolean;
  detail: string;
  checkedAt: number;
}

/** What the page actually was. Never inferred, only read. */
export interface PageObservation {
  url: string;
  title: string;
  /** Digest of the accessibility tree — the basis for "meaningful change". */
  digest: string;
  /** Short human-readable excerpt of visible text. */
  excerpt: string;
  nodeCount: number;
  elementCount: number;
  at: number;
}

export interface BrowserEvidence {
  observation: PageObservation;
  /** Screenshot id in the task store, when one was captured. */
  screenshotId?: string;
  criteria?: CriterionResult[];
}

export interface BrowserCheckpoint {
  id: string;
  taskId: string;
  at: number;
  /** Steps completed before this checkpoint. */
  stepIndex: number;
  /** The verified milestone this checkpoint stands on. */
  milestone: string;
  /** Where to re-enter after a crash or restart. */
  nextStepId: string | null;
  url: string;
  title: string;
  digest: string;
  /** Storage state (cookies/localStorage) captured at this point, if the engine supports it. */
  storageStateSaved: boolean;
  evidence: BrowserEvidence;
}

/* ------------------------------------------------------------------ */
/*  timeline                                                           */
/* ------------------------------------------------------------------ */

export type TimelineKind =
  | 'state'
  | 'action'
  | 'milestone'
  | 'retry'
  | 'recovery'
  | 'loop'
  | 'restriction'
  | 'blocker'
  | 'checkpoint'
  | 'health'
  | 'note'
  | 'error';

export interface TimelineEvent {
  at: number;
  kind: TimelineKind;
  /** Short line the operator can scan hours later. */
  message: string;
  /** Extra diagnostic detail, including codes and fixes. */
  detail?: string;
  stepId?: string;
  evidence?: BrowserEvidence;
}

/* ------------------------------------------------------------------ */
/*  restrictions                                                       */
/* ------------------------------------------------------------------ */

export type RestrictionKind =
  | 'captcha'
  | 'bot-check'
  | 'rate-limit'
  | 'access-denied'
  | 'login-required'
  | 'region-blocked';

export interface Restriction {
  kind: RestrictionKind;
  /** What on the page produced this verdict. */
  evidence: string;
  /** What the operator can legitimately do about it. */
  fix: string;
  /** True when the agent must stop rather than retry. */
  hard: boolean;
  at: number;
}

/* ------------------------------------------------------------------ */
/*  health                                                             */
/* ------------------------------------------------------------------ */

export interface BrowserHealth {
  at: number;
  tabs: number;
  heapMb: number;
  /** Null when the platform cannot report CPU — never invented. */
  cpuPercent: number | null;
  screenshotsOk: boolean;
  sessionValid: boolean;
  online: boolean;
  browserAlive: boolean;
  downloadsDirBytes: number;
}

/* ------------------------------------------------------------------ */
/*  task                                                               */
/* ------------------------------------------------------------------ */

export interface BrowserTaskSpec {
  objective: string;
  /** Where the run starts. */
  startUrl: string;
  /** Named browser profile — separate profiles never share cookies or storage. */
  profile: string;
  plan: BrowserStep[];
  /** A task is COMPLETED only when every one of these verifies. */
  successCriteria: SuccessCriterion[];
  /** Steps that mutate the outside world. Never retried blindly. */
  sensitiveStepIds?: string[];
  /** Authorised alternatives to try when the primary URL is blocked. */
  alternateUrls?: string[];
  limits?: Partial<BrowserLimits>;
}

export interface StepRecord {
  stepId: string;
  attempts: number;
  lastAttemptAt: number | null;
  ok: boolean;
  /** Interaction methods already tried, so a retry can pick a different one. */
  methodsTried: InteractionMethod[];
  lastError?: string;
  verifiedAt?: number;
}

export interface BrowserTask {
  id: string;
  createdAt: number;
  updatedAt: number;
  state: BrowserTaskState;
  /** Why the task is in its current state, in one sentence. */
  stateReason: string;
  spec: BrowserTaskSpec;
  limits: BrowserLimits;
  /** Index into `spec.plan` of the step we are about to attempt. */
  stepIndex: number;
  /** Id of the next step, for checkpoint re-entry. */
  nextStepId: string | null;
  steps: Record<string, StepRecord>;
  startedAt: number | null;
  deadlineAt: number;
  finishedAt: number | null;

  lastAction: { label: string; at: number; ok: boolean } | null;
  lastMilestone: { label: string; at: number; verified: boolean } | null;
  lastProgressAt: number;

  consecutiveFailures: number;
  retriesUsed: number;
  recoveryAttempts: number;
  unverifiedSteps: number;
  loopFlags: string[];

  currentUrl: string;
  currentTitle: string;
  /** Null while nothing is executing. */
  currentOperation: { label: string; startedAt: number; stepId: string } | null;
  health: BrowserHealth | null;
  restriction: Restriction | null;
  blocker: { code: string; message: string; fix: string } | null;

  /** Non-fatal honest caveats (single-process host, non-durable store, …). */
  limitations: string[];
  criteriaResults: CriterionResult[];
  checkpoints: BrowserCheckpoint[];
  events: TimelineEvent[];
  /** Last durable checkpoint id, used for resume after a crash. */
  lastCheckpointId: string | null;
  /** Set when the runner was reconstructed from disk rather than started live. */
  restoredAt: number | null;
  evidence: BrowserEvidence | null;
  outcome: string | null;
}

/** What the UI polls. */
export interface BrowserTaskView {
  task: BrowserTask;
  activity: Activity;
  /** ms since the last verified progress — the number the operator cares about. */
  msSinceProgress: number;
  /** ms left before the deadline; negative means expired. */
  msRemaining: number;
  engine: { available: boolean; kind: string; reason?: string; fix?: string };
  durable: boolean;
}

export type BrowserTaskErrorCode =
  | 'browser-unavailable'
  | 'task-not-found'
  | 'task-terminal'
  | 'invalid-plan'
  | 'invalid-target'
  | 'action-timeout'
  | 'navigation-timeout'
  | 'element-not-found'
  | 'browser-crashed'
  | 'navigation-failed'
  | 'restriction'
  | 'session-expired'
  | 'deadline-exceeded'
  | 'resource-limit'
  | 'loop-detected'
  | 'criteria-unverified'
  | 'no-effect'
  | 'sensitive-action'
  | 'unsupported';

export class BrowserTaskError extends Error {
  readonly code: BrowserTaskErrorCode;
  readonly fix: string;
  /** True when the same call could plausibly succeed after reassessment. */
  readonly retryable: boolean;

  constructor(input: { code: BrowserTaskErrorCode; message: string; fix: string; retryable?: boolean }) {
    super(input.message);
    this.name = 'BrowserTaskError';
    this.code = input.code;
    this.fix = input.fix;
    this.retryable = input.retryable ?? false;
  }
}

export function toBrowserError(error: unknown): { code: string; message: string; fix: string } {
  if (error instanceof BrowserTaskError) {
    return { code: error.code, message: error.message, fix: error.fix };
  }
  return {
    code: 'browser-error',
    message: error instanceof Error ? error.message : 'Unknown browser failure',
    fix: 'Inspect the task timeline; if the browser process died, resume the task from its last checkpoint.',
  };
}

export function activityOf(task: BrowserTask, now: number): Activity {
  if (isTerminal(task.state)) return 'done';
  if (task.state === 'PAUSED') return 'paused';
  if (task.state === 'WAITING_FOR_USER') return 'waiting';
  if (task.state === 'RECOVERING') return 'recovering';
  if (now - task.lastProgressAt > task.limits.progressIntervalMs) return 'stalled';
  return 'working';
}
