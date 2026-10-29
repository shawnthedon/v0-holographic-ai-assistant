/**
 * Success criteria evaluation.
 *
 * A task is COMPLETED only when every criterion evaluates true against the live
 * page **and** the check records what it saw. This is the mechanism behind
 * AT-26 (honest completion): there is no code path that marks a task complete
 * without running this function.
 */

import type {
  BrowserTarget,
  CriterionResult,
  PageObservation,
  SuccessCriterion,
} from './types';
import { describeCriterion } from './types';

export interface CriteriaContext {
  observation: PageObservation;
  /** Resolve a target against the current page. */
  resolve: (target: BrowserTarget) => Promise<{ found: boolean; detail: string }>;
  /** Whether any download started during this task. */
  downloadStarted: boolean;
  now: number;
}

export async function evaluateCriterion(
  criterion: SuccessCriterion,
  context: CriteriaContext,
): Promise<CriterionResult> {
  const { observation, now } = context;

  switch (criterion.type) {
    case 'url-matches': {
      const ok = matchPattern(observation.url, criterion.pattern);
      return { criterion, ok, checkedAt: now, detail: `url is ${observation.url}` };
    }
    case 'title-contains': {
      const ok = observation.title.toLowerCase().includes(criterion.text.toLowerCase());
      return { criterion, ok, checkedAt: now, detail: `title is "${observation.title}"` };
    }
    case 'text-present': {
      const ok = observation.excerpt.toLowerCase().includes(criterion.text.toLowerCase());
      return {
        criterion,
        ok,
        checkedAt: now,
        detail: ok ? `found "${criterion.text}"` : `"${criterion.text}" is not on the page`,
      };
    }
    case 'text-absent': {
      const ok = !observation.excerpt.toLowerCase().includes(criterion.text.toLowerCase());
      return {
        criterion,
        ok,
        checkedAt: now,
        detail: ok ? `"${criterion.text}" is gone` : `"${criterion.text}" is still present`,
      };
    }
    case 'element-present': {
      const resolved = await context.resolve(criterion.target);
      return { criterion, ok: resolved.found, checkedAt: now, detail: resolved.detail };
    }
    case 'download-begun': {
      return {
        criterion,
        ok: context.downloadStarted,
        checkedAt: now,
        detail: context.downloadStarted ? 'a download started' : 'no download was observed',
      };
    }
  }
}

export async function evaluateCriteria(
  criteria: SuccessCriterion[],
  context: CriteriaContext,
): Promise<CriterionResult[]> {
  const results: CriterionResult[] = [];
  for (const criterion of criteria) results.push(await evaluateCriterion(criterion, context));
  return results;
}

export function allSatisfied(results: CriterionResult[]): boolean {
  return results.length > 0 && results.every((result) => result.ok);
}

/** Human line for the timeline and the completion banner. */
export function summariseCriteria(results: CriterionResult[]): string {
  if (results.length === 0) return 'no success criteria were defined';
  const failed = results.filter((result) => !result.ok);
  if (failed.length === 0) return `all ${results.length} success criteria verified`;
  return `${failed.length}/${results.length} criteria unverified: ${failed
    .map((result) => describeCriterion(result.criterion))
    .join('; ')}`;
}

/** Glob-ish URL matching: `*` is the only wildcard, everything else is literal. */
export function matchPattern(value: string, pattern: string): boolean {
  if (!pattern.includes('*')) return value.includes(pattern);
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`, 'i').test(value) || new RegExp(escaped, 'i').test(value);
}
