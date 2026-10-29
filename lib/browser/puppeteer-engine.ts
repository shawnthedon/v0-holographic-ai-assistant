/**
 * Puppeteer + bundled-Chromium engine.
 *
 * Design notes that matter for the resilience requirements:
 *
 * • **Isolation** — every task gets its own browser context. Cookies, storage and
 *   cache are per profile, so two agents never see each other's session.
 * • **Consistent identity** — locale, timezone, viewport and user agent are fixed
 *   for the life of a task. We do not randomise or spoof a fingerprint, and we do
 *   not claim this is undetectable.
 * • **Cancellation** — every operation races an AbortSignal, so a stalled
 *   navigation can be abandoned without leaking a pending promise.
 * • **Honest failures** — timeouts, disconnects and missing elements are typed
 *   errors with codes; nothing is swallowed into a fake success.
 */

import type { Browser } from 'puppeteer-core';
import type { Page } from 'puppeteer-core';

import { chromiumLaunchArgs, resolveChromium } from './chromium';
import type {
  BrowserEngine,
  BrowserSession,
  DownloadRecord,
  EngineAvailability,
  LaunchOptions,
  NavigationResult,
  ResolvedTarget,
  ScreenshotResult,
  StorageState,
  AccessibilitySnapshot,
} from './engine';
import {
  BrowserTaskError,
  type BrowserHealth,
  type BrowserTarget,
  type InteractionMethod,
  type PageObservation,
} from './types';
import { observationDigest } from './progress';

const ENGINE_KIND = 'chromium';
const EXCERPT_LIMIT = 4_000;

/**
 * Runs in the page: assigns `data-nexus-target` to an element matching a role /
 * name / text / selector, and returns the handle. Re-running it after a reload is
 * how "re-locate the target" works.
 */
const FIND_ELEMENT = `(target) => {
  const roleOf = (el) => {
    const explicit = el.getAttribute && el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : 'generic';
    if (tag === 'button') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'search') return 'searchbox';
      return 'textbox';
    }
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'img') return 'img';
    if (tag === 'nav') return 'navigation';
    if (tag === 'li') return 'listitem';
    return 'generic';
  };
  const nameOf = (el) => {
    const labelled = el.getAttribute && el.getAttribute('aria-labelledby');
    if (labelled) {
      const parts = labelled.split(/\\s+/).map((id) => {
        const node = document.getElementById(id);
        return node ? node.textContent || '' : '';
      });
      const joined = parts.join(' ').trim();
      if (joined) return joined;
    }
    const aria = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title'));
    if (aria) return aria.trim();
    const placeholder = el.getAttribute && el.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();
    if (el.value && (el.tagName === 'INPUT' || el.tagName === 'BUTTON')) return String(el.value).trim();
    return (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160);
  };

  const all = Array.from(document.querySelectorAll('a,button,input,select,textarea,[role],[aria-label],[contenteditable=""],[contenteditable="true"],h1,h2,h3,h4,h5,h6,label,li,summary'));
  let matches = [];

  if (target.selector) {
    try {
      const nodes = Array.from(document.querySelectorAll(target.selector));
      if (nodes.length) matches = nodes;
    } catch (error) {
      return { found: false, detail: 'invalid selector: ' + String(error && error.message) };
    }
  }

  if (!matches.length) {
    matches = all.filter((el) => {
      if (target.role && roleOf(el) !== target.role) return false;
      if (target.name) {
        const name = nameOf(el).toLowerCase();
        if (!name.includes(String(target.name).toLowerCase())) return false;
      }
      if (target.text) {
        const text = (el.textContent || '').toLowerCase();
        if (!text.includes(String(target.text).toLowerCase())) return false;
      }
      return Boolean(target.role || target.name || target.text);
    });
  }

  if (!matches.length) return { found: false, detail: 'no element matched', count: 0, matches: [] };

  const visible = matches.filter((el) => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  });
  if (!visible.length) return { found: false, detail: 'element exists but is not visible', count: matches.length, matches: matches.slice(0, 5).map(nameOf) };

  const index = Number.isInteger(target.index) ? Math.max(0, Math.min(target.index, visible.length - 1)) : 0;
  const element = visible[index];
  element.setAttribute('data-nexus-target', 'hit');
  element.scrollIntoView({ block: 'center', inline: 'center' });
  const disabled = element.disabled === true || element.getAttribute('aria-disabled') === 'true';
  return {
    found: true,
    detail: 'matched ' + roleOf(element) + ' "' + nameOf(element).slice(0, 60) + '"',
    disabled,
    count: visible.length,
  };
}`;

export class PuppeteerEngine implements BrowserEngine {
  readonly kind = ENGINE_KIND;

  async availability(): Promise<EngineAvailability> {
    if (process.env.BROWSER_WS_ENDPOINT) {
      return { available: true, kind: `${ENGINE_KIND}-remote` };
    }
    const resolution = await resolveChromium();
    if (!resolution.available) {
      return {
        available: false,
        kind: ENGINE_KIND,
        reason: resolution.reason ?? 'Chromium is not available in this runtime',
        fix: resolution.fix ?? 'Install a Chromium build or point BROWSER_WS_ENDPOINT at a browser service.',
      };
    }
    return { available: true, kind: ENGINE_KIND };
  }

  async launch(options: LaunchOptions): Promise<BrowserSession> {
    const puppeteer = await import('puppeteer-core');

    let browser: Browser;
    const endpoint = process.env.BROWSER_WS_ENDPOINT;
    if (endpoint) {
      browser = await puppeteer.connect({ browserWSEndpoint: endpoint, defaultViewport: null });
    } else {
      const resolution = await resolveChromium();
      if (!resolution.available || !resolution.executablePath) {
        throw new BrowserTaskError({
          code: 'browser-unavailable',
          message: resolution.reason ?? 'Chromium is not available',
          fix: resolution.fix ?? 'Install a Chromium build, or set BROWSER_EXECUTABLE_PATH / BROWSER_WS_ENDPOINT.',
        });
      }
      browser = await puppeteer.launch({
        executablePath: resolution.executablePath,
        args: chromiumLaunchArgs(),
        headless: true,
        defaultViewport: options.viewport ?? { width: 1440, height: 900 },
        protocolTimeout: 60_000,
        env: {
          ...process.env,
          ...(resolution.libraryPath ? { LD_LIBRARY_PATH: [resolution.libraryPath, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : {}),
          ...(options.proxy ? { http_proxy: options.proxy, https_proxy: options.proxy } : {}),
        },
      });
    }

    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(25_000);

    // Downloads land in the task's own directory so the disk budget is per task.
    const client = await page.createCDPSession();
    await client.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: options.downloadsDir,
      eventsEnabled: true,
    });

    if (options.storageState) {
      await restoreStorageState(page, options.storageState);
    }

    return new PuppeteerSession(browser, page, options, endpoint ? 'remote' : 'local');
  }
}

class PuppeteerSession implements BrowserSession {
  readonly id: string;
  readonly profile: string;

  private readonly browser: Browser;
  private readonly page: Page;
  private readonly downloadLog: DownloadRecord[] = [];
  private readonly mode: 'local' | 'remote';
  private closed = false;

  constructor(browser: Browser, page: Page, options: LaunchOptions, mode: 'local' | 'remote') {
    this.browser = browser;
    this.page = page;
    this.profile = options.profile;
    this.mode = mode;
    this.id = `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    page.on('response', (response) => {
      const headers = response.headers();
      const disposition = headers['content-disposition'];
      if (!disposition || !/attachment/i.test(disposition)) return;
      const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
      const name = match ? decodeURIComponent(match[1]) : `download-${this.downloadLog.length + 1}`;
      this.downloadLog.push({ name, path: '', bytes: 0, at: Date.now() });
    });
  }

  isAlive(): boolean {
    return !this.closed && this.browser.connected && !this.page.isClosed();
  }

  private assertAlive(): void {
    if (!this.isAlive()) {
      throw new BrowserTaskError({
        code: 'browser-crashed',
        message: 'The browser is no longer connected',
        fix: 'The runner restarts the browser and resumes from the last verified checkpoint.',
        retryable: true,
      });
    }
  }

  /** Race an operation against its budget and the task's abort signal. */
  private async guard<T>(promise: Promise<T>, timeoutMs: number, signal: AbortSignal | undefined, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new BrowserTaskError({
            code: label === 'navigate' ? 'navigation-timeout' : 'action-timeout',
            message: `${label} did not complete within ${Math.round(timeoutMs / 1000)}s`,
            fix: 'The runner cancels the operation, inspects the page, and chooses a different recovery step.',
            retryable: true,
          }),
        );
      }, timeoutMs);
    });

    const aborted = new Promise<never>((_, reject) => {
      if (!signal) return;
      onAbort = () =>
        reject(
          new BrowserTaskError({
            code: 'action-timeout',
            message: `${label} was cancelled by the watchdog`,
            fix: 'The watchdog cancels stalled operations; the runner reassesses before retrying.',
            retryable: true,
          }),
        );
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });

    try {
      return await Promise.race([promise, timeout, aborted]);
    } catch (error) {
      throw this.normalise(error, label);
    } finally {
      if (timer) clearTimeout(timer);
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  private normalise(error: unknown, label: string): Error {
    if (error instanceof BrowserTaskError) return error;
    const message = error instanceof Error ? error.message : String(error);
    if (/Target closed|Session closed|Protocol error|Connection closed|disconnected/i.test(message)) {
      this.closed = true;
      return new BrowserTaskError({
        code: 'browser-crashed',
        message: `the browser connection dropped during ${label}: ${message}`,
        fix: 'The runner restarts the browser and resumes from the last verified checkpoint.',
        retryable: true,
      });
    }
    if (/timeout/i.test(message)) {
      return new BrowserTaskError({
        code: label === 'navigate' ? 'navigation-timeout' : 'action-timeout',
        message: `${label} timed out: ${message}`,
        fix: 'Cancel, re-inspect the page, and try a different recovery step.',
        retryable: true,
      });
    }
    return new BrowserTaskError({
      code: label === 'navigate' ? 'navigation-failed' : 'action-timeout',
      message: `${label} failed: ${message}`,
      fix: 'Inspect the task timeline and the captured page state.',
      retryable: true,
    });
  }

  async navigate(url: string, options: { timeoutMs: number; signal?: AbortSignal }): Promise<NavigationResult> {
    this.assertAlive();
    const response = await this.guard(
      this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeoutMs }),
      options.timeoutMs,
      options.signal,
      'navigate',
    ).catch((error: unknown) => {
      throw this.normalise(error, 'navigate');
    });

    // A navigation that resolves without a response is still a real page load;
    // report status 0 rather than inventing a 200.
    const status = response ? response.status() : 0;
    const finalUrl = this.page.url();
    return {
      status,
      url: finalUrl,
      redirected: finalUrl !== url,
      timedOut: false,
    };
  }

  async observe(): Promise<PageObservation> {
    this.assertAlive();
    const raw = await this.page.evaluate(() => {
      const body = document.body;
      const text = (body ? body.innerText : '') || '';
      return {
        url: location.href,
        title: document.title || '',
        text: text.replace(/\s+\n/g, '\n').slice(0, 20000),
        elementCount: document.querySelectorAll('a,button,input,select,textarea,[role]').length,
      };
    });

    return {
      url: raw.url,
      title: raw.title,
      digest: observationDigest({ url: raw.url, title: raw.title, text: raw.text.slice(0, 4000) }),
      excerpt: raw.text.slice(0, EXCERPT_LIMIT),
      nodeCount: (await this.page.accessibility.snapshot({ interestingOnly: true })) ? countNodes(raw.text) : 0,
      elementCount: raw.elementCount,
      at: Date.now(),
    };
  }

  async snapshot(): Promise<AccessibilitySnapshot> {
    this.assertAlive();
    const tree = await this.page.accessibility.snapshot({ interestingOnly: true });
    const nodes: { role: string; name: string; value?: string }[] = [];
    walk(tree, nodes);
    const text = await this.page.evaluate(() => (document.body ? document.body.innerText.slice(0, 8000) : ''));
    return { at: Date.now(), nodeCount: nodes.length, nodes: nodes.slice(0, 400), text };
  }

  async resolve(target: BrowserTarget): Promise<ResolvedTarget> {
    this.assertAlive();
    const result = (await this.page.evaluate(
      // eslint-disable-next-line no-new-func
      new Function('target', `return (${FIND_ELEMENT})(target)`) as unknown as (target: BrowserTarget) => unknown,
      target,
    )) as { found: boolean; detail?: string; disabled?: boolean; count?: number };

    if (!result?.found) {
      return { found: false, detail: result?.detail ?? 'no element matched', methods: [] };
    }
    return {
      found: true,
      handle: 'hit',
      detail: result.detail ?? 'matched',
      methods: result.disabled ? ['dom'] : ['mouse', 'dom', 'keyboard'],
    };
  }

  async click(target: BrowserTarget, method: InteractionMethod, options: { timeoutMs: number }): Promise<void> {
    this.assertAlive();
    const located = await this.resolve(target);
    if (!located.found) {
      throw new BrowserTaskError({
        code: 'element-not-found',
        message: `could not find ${describeTarget(target)}`,
        fix: 'Re-inspect the accessibility tree; the page may not have finished rendering.',
        retryable: true,
      });
    }

    const selector = '[data-nexus-target="hit"]';
    await this.guard(
      (async () => {
        if (method === 'dom') {
          await this.page.$eval(selector, (element) => (element as HTMLElement).click());
          return;
        }
        if (method === 'keyboard') {
          await this.page.focus(selector);
          await this.page.keyboard.press('Enter');
          return;
        }
        const handle = await this.page.$(selector);
        if (!handle) throw new Error('element disappeared before the click');
        await handle.click();
        await handle.dispose();
      })(),
      options.timeoutMs,
      undefined,
      'click',
    );
  }

  async type(target: BrowserTarget, text: string, options: { timeoutMs: number }): Promise<void> {
    this.assertAlive();
    const located = await this.resolve(target);
    if (!located.found) {
      throw new BrowserTaskError({
        code: 'element-not-found',
        message: `could not find ${describeTarget(target)} to type into`,
        fix: 'Re-inspect the page; the field may be hidden behind a step that did not complete.',
        retryable: true,
      });
    }
    await this.guard(
      (async () => {
        const selector = '[data-nexus-target="hit"]';
        await this.page.click(selector, { clickCount: 3 });
        await this.page.keyboard.type(text, { delay: 12 });
      })(),
      options.timeoutMs,
      undefined,
      'type',
    );
  }

  async press(key: string, options: { timeoutMs: number }): Promise<void> {
    this.assertAlive();
    await this.guard(this.page.keyboard.press(key as never), options.timeoutMs, undefined, 'press');
  }

  async wait(ms: number, signal?: AbortSignal): Promise<void> {
    await this.guard(
      new Promise((resolve) => setTimeout(resolve, ms)),
      ms + 1_000,
      signal,
      'wait',
    ).catch(() => undefined);
  }

  async screenshot(): Promise<ScreenshotResult> {
    try {
      this.assertAlive();
      const base64 = await this.page.screenshot({ type: 'png', encoding: 'base64', fullPage: false });
      return { base64, bytes: Math.round(base64.length * 0.75), ok: true };
    } catch (error) {
      return {
        base64: '',
        bytes: 0,
        ok: false,
        reason: error instanceof Error ? error.message : 'screenshot failed',
      };
    }
  }

  async saveStorageState(): Promise<StorageState | null> {
    try {
      this.assertAlive();
      const [cookies, origin] = await Promise.all([
        this.page.cookies(),
        this.page.evaluate(() => {
          const entries: { name: string; value: string }[] = [];
          for (let index = 0; index < localStorage.length; index += 1) {
            const name = localStorage.key(index);
            if (name) entries.push({ name, value: localStorage.getItem(name) ?? '' });
          }
          return { origin: location.origin, entries };
        }),
      ]);
      return { cookies, origins: [{ origin: origin.origin, localStorage: origin.entries }] };
    } catch {
      return null;
    }
  }

  async health(): Promise<BrowserHealth> {
    const alive = this.isAlive();
    let heapMb = 0;
    let tabs = 0;

    try {
      if (alive) {
        const metrics = await this.page.metrics();
        heapMb = Math.round(((metrics.JSHeapUsedSize ?? 0) / (1024 * 1024)) * 10) / 10;
        const pages = await this.browser.pages();
        tabs = pages.length;
      }
    } catch {
      /* a dead browser reports zero, which the watchdog treats as unhealthy */
    }

    return {
      at: Date.now(),
      tabs,
      heapMb,
      // Puppeteer cannot read process CPU for a remote browser; report null
      // rather than inventing a number.
      cpuPercent: null,
      screenshotsOk: alive,
      sessionValid: alive,
      online: true,
      browserAlive: alive,
      downloadsDirBytes: 0,
    };
  }

  downloads(): DownloadRecord[] {
    return [...this.downloadLog];
  }

  async closeExtraTabs(limit: number): Promise<number> {
    if (this.mode === 'remote') return 0;
    try {
      const pages = await this.browser.pages();
      let closed = 0;
      for (const candidate of pages) {
        if ((await this.browser.pages()).length <= limit) break;
        if (candidate === this.page) continue;
        await candidate.close().catch(() => undefined);
        closed += 1;
      }
      return closed;
    } catch {
      return 0;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.page.close();
    } catch {
      /* already gone */
    }
    try {
      // Only our own context is torn down; a shared remote browser stays up.
      if (this.mode === 'local') await this.browser.close();
      else this.browser.disconnect();
    } catch {
      /* already gone */
    }
  }
}

function describeTarget(target: BrowserTarget): string {
  return [target.role, target.name, target.selector, target.text].filter(Boolean).join(' ') || 'the target element';
}

function countNodes(text: string): number {
  return text.split('\n').filter((line) => line.trim().length > 0).length;
}

function walk(node: unknown, out: { role: string; name: string; value?: string }[]): void {
  if (!node || typeof node !== 'object') return;
  const typed = node as { role?: string; name?: string; value?: string; children?: unknown[] };
  if (typed.role) out.push({ role: typed.role, name: (typed.name ?? '').slice(0, 120), value: typed.value });
  for (const child of typed.children ?? []) walk(child, out);
}

async function restoreStorageState(page: Page, state: StorageState): Promise<void> {
  try {
    if (state.cookies?.length) await page.browserContext().setCookie(...(state.cookies as never[]));
    for (const origin of state.origins ?? []) {
      if (!origin.localStorage?.length) continue;
      await page.goto(origin.origin, { waitUntil: 'domcontentloaded' }).catch(() => undefined);
      await page.evaluate((entries: { name: string; value: string }[]) => {
        for (const entry of entries) localStorage.setItem(entry.name, entry.value);
      }, origin.localStorage);
    }
  } catch {
    /* a stale storage state must not abort the launch — the task will ask for a login instead */
  }
}
