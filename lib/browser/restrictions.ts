/**
 * Website restrictions and session expiry.
 *
 * A blocked site is information, not an obstacle to grind against. Recognising
 * it is the difference between "the agent tried 400 times" and "the agent told
 * you the site refused, kept what it had, and stopped".
 *
 * What this module deliberately does **not** do: solve CAPTCHAs, forge
 * fingerprints, rotate identities to defeat a block, or retry an access control.
 * Those are not recovery strategies.
 */

import type { Restriction, RestrictionKind } from './types';

interface Pattern {
  kind: RestrictionKind;
  test: RegExp;
  fix: string;
  hard: boolean;
}

/**
 * Ordered by specificity: a page that says "verify you are human" is a CAPTCHA
 * even if it also contains the word "access".
 */
const PATTERNS: Pattern[] = [
  {
    kind: 'captcha',
    test: /\b(captcha|recaptcha|hcaptcha|verify (that )?you are (a )?human|i'?m not a robot|press and hold)\b/i,
    fix: 'A CAPTCHA needs a human. Open the site yourself to clear it, then resume the task; the agent will not attempt to solve it.',
    hard: true,
  },
  {
    kind: 'bot-check',
    test: /\b(unusual traffic|automated (queries|requests)|suspicious activity|are you a robot|checking your browser|cloudflare)\b/i,
    fix: 'The site has flagged automated traffic. Complete the check in your own browser, or use the site’s official API.',
    hard: true,
  },
  {
    kind: 'rate-limit',
    test: /\b(too many requests|rate limit(ed)?|slow down|try again later|429)\b/i,
    fix: 'Back off and retry later, or use an authorised API with a documented quota. Do not hammer the endpoint.',
    hard: true,
  },
  {
    kind: 'access-denied',
    test: /\b(403 forbidden|access denied|not authorised|not authorized|permission denied|you do not have (access|permission))\b/i,
    fix: 'The account or session lacks permission. Ask the owner for access, or use a source you are entitled to read.',
    hard: true,
  },
  {
    kind: 'login-required',
    test: /\b(sign in to continue|log in to continue|please (sign|log) in|session (has )?expired|authentication required)\b/i,
    fix: 'The session is not valid. The task will pause and ask you to sign in — the agent will not attempt to bypass authentication.',
    hard: true,
  },
  {
    kind: 'region-blocked',
    test: /\b(not available in your (country|region)|geo[- ]?blocked|unavailable in your location)\b/i,
    fix: 'The content is restricted by region. Use an authorised local source; do not use a proxy to bypass a regional restriction.',
    hard: true,
  },
];

/** HTTP statuses that mean "stop", mapped to the restriction they represent. */
export function restrictionForStatus(status: number): RestrictionKind | null {
  if (status === 401) return 'login-required';
  if (status === 403) return 'access-denied';
  if (status === 429) return 'rate-limit';
  return null;
}

export interface RestrictionScanInput {
  url: string;
  title: string;
  text: string;
  status?: number;
  /** True when a CAPTCHA widget was found in the DOM, not just mentioned in text. */
  captchaWidget?: boolean;
  at: number;
}

export function detectRestriction(input: RestrictionScanInput): Restriction | null {
  const haystack = `${input.url}\n${input.title}\n${input.text}`;

  const statusKind = input.status ? restrictionForStatus(input.status) : null;
  if (statusKind) {
    const pattern = PATTERNS.find((entry) => entry.kind === statusKind)!;
    return {
      kind: statusKind,
      evidence: `HTTP ${input.status} from ${input.url}`,
      fix: pattern.fix,
      hard: pattern.hard,
      at: input.at,
    };
  }

  if (input.captchaWidget) {
    const pattern = PATTERNS[0];
    return {
      kind: 'captcha',
      evidence: `a CAPTCHA widget is present on ${input.url}`,
      fix: pattern.fix,
      hard: true,
      at: input.at,
    };
  }

  for (const pattern of PATTERNS) {
    const match = pattern.test.exec(haystack);
    if (match) {
      return {
        kind: pattern.kind,
        evidence: `page text matched "${match[0].trim().slice(0, 80)}"`,
        fix: pattern.fix,
        hard: pattern.hard,
        at: input.at,
      };
    }
  }

  return null;
}

/**
 * Session expiry is a restriction we can recognise cheaply: a login form where
 * an authenticated page used to be, or an explicit "session expired".
 */
export function detectSessionExpiry(input: {
  url: string;
  text: string;
  passwordFieldPresent: boolean;
  previouslyAuthenticated: boolean;
}): boolean {
  if (/session (has )?expired|please (sign|log) in again|your session timed out/i.test(input.text)) return true;
  if (!input.previouslyAuthenticated) return false;
  const loginish = /\/(login|signin|sign-in|auth|session)\b/i.test(input.url);
  return input.passwordFieldPresent && loginish;
}

/** What the agent may legitimately do next after a restriction. */
export function alternativesFor(
  restriction: Restriction,
  options: { alternateUrls?: string[] },
): { url: string; reason: string }[] {
  const alternates = options.alternateUrls ?? [];
  return alternates.map((url) => ({
    url,
    reason: `authorised alternative for ${restriction.kind}`,
  }));
}
