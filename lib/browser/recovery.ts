/**
 * Bounded, state-aware recovery.
 *
 * Two rules shape this file:
 *
 * 1. **Never repeat the identical attempt.** Each recovery pass must change
 *    something — wait, reload, re-inspect, re-locate, or use a different
 *    interaction method. If nothing is left to change, the task stops.
 * 2. **Never blindly retry a sensitive action.** Purchases, payments, account
 *    changes and external submissions are checked for effect *before* any retry;
 *    if we cannot verify the effect, the task hands back to a human instead of
 *    risking a duplicate charge.
 */

import type { BrowserStep, InteractionMethod, Restriction } from './types';

/** The subset of a loop finding recovery cares about. */
export interface LoopFindingLike {
  kind: string;
  message: string;
}

export type RecoveryAction =
  | { kind: 'wait-for-state'; ms: number; reason: string }
  | { kind: 'reload'; reason: string }
  | { kind: 'reinspect'; reason: string }
  | { kind: 'relocate'; method: InteractionMethod; reason: string }
  | { kind: 'alternate-interaction'; method: InteractionMethod; reason: string }
  | { kind: 'alternate-source'; url: string; reason: string }
  | { kind: 'defer-step'; reason: string }
  | { kind: 'request-user'; reason: string }
  | { kind: 'stop'; state: 'BLOCKED' | 'FAILED'; reason: string };

export interface RecoveryContext {
  /** 0-based recovery pass for the current obstacle. */
  attempt: number;
  maxAttempts: number;
  consecutiveFailures: number;
  maxConsecutiveFailures: number;
  step: BrowserStep | null;
  /** Methods already tried for this step — a retry must pick a different one. */
  methodsTried: InteractionMethod[];
  /** Authorised alternatives supplied by the task spec. */
  alternateUrls: string[];
  /** Alternatives already attempted — a second pass must not repeat them. */
  alternatesTried?: string[];
  restriction: Restriction | null;
  lastFinding: LoopFindingLike | null;
  /** True when the previous attempt's effect could not be verified. */
  effectUnverified: boolean;
}

const METHOD_ORDER: InteractionMethod[] = ['auto', 'mouse', 'dom', 'keyboard'];

/** Actions that change the outside world and must never be retried blindly. */
const SENSITIVE_PATTERNS: RegExp[] = [
  /\b(buy|purchase|order|checkout|pay|payment|transfer|donate|bid)\b/i,
  /\b(subscribe|unsubscribe|upgrade|downgrade|renew)\b/i,
  /\b(delete|remove|deactivate|close) (my )?(account|profile|workspace)\b/i,
  /\b(submit|send|post|publish|apply|confirm|authorise|authorize)\b/i,
  /\b(change|update) (password|email|address|payment)\b/i,
];

export function isSensitiveStep(step: BrowserStep | null): boolean {
  if (!step) return false;
  if ('sensitive' in step && step.sensitive) return true;
  const label = describeStep(step);
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(label));
}

export function describeStep(step: BrowserStep): string {
  switch (step.kind) {
    case 'navigate':
      return `navigate ${step.url}`;
    case 'click':
      return `click ${step.target.role ?? ''} ${step.target.name ?? step.target.selector ?? step.target.text ?? ''}`.trim();
    case 'type':
      return `type into ${step.target.role ?? ''} ${step.target.name ?? step.target.selector ?? ''}`.trim();
    case 'press':
      return `press ${step.key}`;
    case 'wait':
      return `wait ${step.ms}ms`;
    case 'verify':
      return `verify ${step.criteria.length} condition(s)`;
  }
}

/** Navigation and verification are naturally idempotent; clicks and typing are not. */
export function isIdempotent(step: BrowserStep | null): boolean {
  if (!step) return true;
  return step.kind === 'navigate' || step.kind === 'verify' || step.kind === 'wait';
}

export function nextMethod(methodsTried: InteractionMethod[]): InteractionMethod | null {
  for (const method of METHOD_ORDER) {
    if (method === 'auto') continue;
    if (!methodsTried.includes(method)) return method;
  }
  return null;
}

/**
 * Decide what to do about the current obstacle.
 *
 * The ladder is evaluated against evidence, not hope: a hard restriction stops
 * the task, a loop forces a different approach, and an exhausted retry budget
 * stops honestly instead of spinning.
 */
export function planRecovery(context: RecoveryContext): RecoveryAction {
  const { attempt, maxAttempts, step, restriction } = context;

  if (restriction?.hard) {
    const untried = context.alternateUrls.find((url) => !(context.alternatesTried ?? []).includes(url));
    if (untried) {
      return {
        kind: 'alternate-source',
        url: untried,
        reason: `${restriction.kind} on the current page — trying an authorised alternative`,
      };
    }
    return {
      kind: 'request-user',
      reason: `${restriction.kind}: ${restriction.fix}`,
    };
  }

  if (context.consecutiveFailures >= context.maxConsecutiveFailures) {
    return {
      kind: 'stop',
      state: 'BLOCKED',
      reason: `${context.consecutiveFailures} consecutive failures — stopping instead of retrying`,
    };
  }

  if (isSensitiveStep(step) && context.effectUnverified) {
    return {
      kind: 'request-user',
      reason:
        'a sensitive action failed and its effect could not be verified — confirm whether it went through before retrying',
    };
  }

  if (attempt >= maxAttempts) {
    return {
      kind: 'stop',
      state: 'BLOCKED',
      reason: `recovery budget exhausted after ${attempt} attempts`,
    };
  }

  switch (attempt) {
    case 0:
      return { kind: 'wait-for-state', ms: 1_500, reason: 'giving the page time to settle' };
    case 1:
      return { kind: 'reload', reason: 'reloading the page to clear a transient state' };
    case 2:
      return { kind: 'reinspect', reason: 're-reading the accessibility tree' };
    case 3: {
      const method = nextMethod(context.methodsTried);
      return method
        ? { kind: 'alternate-interaction', method, reason: `retrying with the ${method} interaction method` }
        : { kind: 'relocate', method: 'auto', reason: 're-locating the target element' };
    }
    default: {
      const method = nextMethod(context.methodsTried);
      if (method) {
        return { kind: 'alternate-interaction', method, reason: `trying the ${method} interaction method` };
      }
      const untried = context.alternateUrls.find((url) => !(context.alternatesTried ?? []).includes(url));
      if (untried) {
        return {
          kind: 'alternate-source',
          url: untried,
          reason: 'the current route is not working; trying an authorised alternative',
        };
      }
      return { kind: 'defer-step', reason: 'recording the obstacle and continuing with the rest of the plan' };
    }
  }
}

/**
 * Whether a failed step may be retried at all.
 *
 * Sensitive steps are only retryable when the caller has positively verified the
 * action did *not* take effect (`effectUnverified === false` means "we checked").
 */
export function canRetry(step: BrowserStep | null, effectVerifiedAbsent: boolean): { ok: boolean; reason?: string } {
  if (!isSensitiveStep(step)) return { ok: true };
  if (effectVerifiedAbsent) return { ok: true };
  return {
    ok: false,
    reason:
      'sensitive action — the effect could not be verified, so retrying could duplicate it; asking the operator instead',
  };
}
