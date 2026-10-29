/**
 * Meaningful progress.
 *
 * "Meaningful" is defined narrowly on purpose: the URL changed, the title
 * changed, or the accessibility tree changed in a way that is not a spinner.
 * Timers, cursor blinks and clock widgets must not be able to fake progress,
 * so a digest that only differs by volatile text is treated as unchanged.
 */

import type { PageObservation } from './types';

/** Text that changes on its own and must not count as progress. */
const VOLATILE_PATTERNS: RegExp[] = [
  /\b\d{1,2}:\d{2}(:\d{2})?\s?(am|pm)?\b/gi,
  /\b\d+ (second|minute|hour|day)s? ago\b/gi,
  /\bjust now\b/gi,
  /\b\d+%\b/g,
  /\b\d+ ms\b/g,
];

export function stripVolatile(text: string): string {
  let clean = text;
  for (const pattern of VOLATILE_PATTERNS) clean = clean.replace(pattern, '∅');
  return clean;
}

/** FNV-1a — small, synchronous, and good enough to compare page states. */
export function digest(text: string): string {
  let hash = 0x811c9dc5;
  const value = stripVolatile(text);
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function observationDigest(input: { url: string; title: string; text: string }): string {
  return digest(`${input.url}\u0000${input.title}\u0000${input.text}`);
}

/**
 * Did anything meaningful change?
 *
 * A different digest is necessary but not sufficient: a page can re-render the
 * same words with different whitespace, so we also require a shorter excerpt
 * comparison when the digest differs.
 */
export function isMeaningfulChange(previous: PageObservation | null, next: PageObservation | null): boolean {
  if (!next) return false;
  if (!previous) return true;
  if (previous.url !== next.url) return true;
  if (previous.title !== next.title) return true;
  if (previous.digest !== next.digest) return true;
  return false;
}

/** True when two observations are the same page state, ignoring timestamps. */
export function sameState(a: PageObservation | null, b: PageObservation | null): boolean {
  if (!a || !b) return false;
  return a.url === b.url && a.title === b.title && a.digest === b.digest;
}

/** A short, honest description of the current state for the timeline. */
export function describeObservation(observation: PageObservation): string {
  const where = observation.title ? `"${observation.title}"` : observation.url;
  return `${where} · ${observation.elementCount} elements`;
}
