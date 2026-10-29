/**
 * Browser engine contract.
 *
 * The runner never talks to Puppeteer directly. It talks to this interface, which
 * is small enough to be implemented by a real browser, a fixture in tests, or a
 * remote browser service — and honest enough that "the engine is not available"
 * is a first-class answer rather than an exception.
 */

import type { BrowserHealth, BrowserTarget, InteractionMethod, PageObservation } from './types';

/** Subset of the accessibility tree the runner reasons about. */
export interface AccessibilitySnapshot {
  at: number;
  nodeCount: number;
  /** Flat list of interactive landmarks — enough to re-locate a target. */
  nodes: { role: string; name: string; value?: string }[];
  text: string;
}

export interface EngineAvailability {
  available: boolean;
  kind: string;
  reason?: string;
  fix?: string;
}

export interface LaunchOptions {
  /** Named profile — cookies and storage are namespaced per profile. */
  profile: string;
  downloadsDir: string;
  storageState?: StorageState | null;
  viewport?: { width: number; height: number };
  /** Set for an operator whose site legitimately requires a proxy. */
  proxy?: string | null;
}

export interface StorageState {
  cookies: unknown[];
  origins: { origin: string; localStorage: { name: string; value: string }[] }[];
}

export interface NavigationResult {
  status: number;
  url: string;
  redirected: boolean;
  timedOut: boolean;
}

export interface ResolvedTarget {
  found: boolean;
  /** Engine-internal handle (a `data-nexus-target` value for the DOM engine). */
  handle?: string;
  detail: string;
  /** Interaction methods this target actually supports. */
  methods: InteractionMethod[];
}

export interface ScreenshotResult {
  base64: string;
  bytes: number;
  ok: boolean;
  reason?: string;
}

export interface DownloadRecord {
  name: string;
  path: string;
  bytes: number;
  at: number;
}

export interface BrowserSession {
  readonly id: string;
  readonly profile: string;

  navigate(url: string, options: { timeoutMs: number; signal?: AbortSignal }): Promise<NavigationResult>;
  observe(): Promise<PageObservation>;
  snapshot(): Promise<AccessibilitySnapshot>;
  resolve(target: BrowserTarget): Promise<ResolvedTarget>;

  click(target: BrowserTarget, method: InteractionMethod, options: { timeoutMs: number }): Promise<void>;
  type(target: BrowserTarget, text: string, options: { timeoutMs: number }): Promise<void>;
  press(key: string, options: { timeoutMs: number }): Promise<void>;
  wait(ms: number, signal?: AbortSignal): Promise<void>;

  screenshot(): Promise<ScreenshotResult>;
  saveStorageState(): Promise<StorageState | null>;
  health(): Promise<BrowserHealth>;
  downloads(): DownloadRecord[];

  /** True when the underlying browser is still connected. */
  isAlive(): boolean;
  closeExtraTabs(limit: number): Promise<number>;
  close(): Promise<void>;
}

export interface BrowserEngine {
  readonly kind: string;
  availability(): Promise<EngineAvailability>;
  launch(options: LaunchOptions): Promise<BrowserSession>;
}
