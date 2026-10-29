/**
 * The browser task runner.
 *
 * This is where the resilience requirements live. The shape of the loop is the
 * argument: every tick asks the watchdog whether the task is still making
 * progress, and every exit is either a verified success or an explicit terminal
 * state with a reason. There is no branch that quietly waits forever.
 *
 *     QUEUED → RUNNING → RECOVERING → RUNNING → COMPLETED
 *                   ↘ WAITING_FOR_USER ↗
 *                   ↘ FAILED / BLOCKED / CANCELLED / TIMED_OUT
 *
 * Design commitments:
 *  • one action at a time, each with a deadline and an abort signal;
 *  • a step only advances after its effect is observed, not after the call returns;
 *  • repeated identical actions are a loop, not persistence;
 *  • checkpoints are written at verified milestones and are what a restart resumes from;
 *  • COMPLETED requires evaluated criteria and captured evidence.
 */

import { allSatisfied, evaluateCriteria, summariseCriteria } from './criteria';
import type { BrowserEngine, BrowserSession, StorageState } from './engine';
import { LoopDetector, type LoopFinding } from './loops';
import { isMeaningfulChange, sameState } from './progress';
import { planRecovery, describeStep, isSensitiveStep, canRetry, type RecoveryAction } from './recovery';
import { detectRestriction, detectSessionExpiry } from './restrictions';
import type { BrowserTaskStore } from './store';
import { inspectWatchdog, needsRecovery, formatDuration } from './watchdog';
import {
  BrowserTaskError,
  DEFAULT_LIMITS,
  activityOf,
  isTerminal,
  toBrowserError,
  type BrowserCheckpoint,
  type BrowserEvidence,
  type BrowserLimits,
  type BrowserStep,
  type BrowserTarget,
  type BrowserTask,
  type BrowserTaskSpec,
  type CriterionResult,
  type InteractionMethod,
  type PageObservation,
  type Restriction,
  type StepRecord,
  type SuccessCriterion,
  type TimelineEvent,
  type TimelineKind,
} from './types';

const MAX_EVENTS = 400;
const MAX_CHECKPOINTS = 40;
const TICK_PAUSE_MS = 150;

export interface RunnerDeps {
  engine: BrowserEngine;
  store: BrowserTaskStore;
  /** Injected clock — tests drive hours in milliseconds. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Schedule a cancellation timer. Defaults to `setTimeout`; tests inject a
   * virtual scheduler so a ten-minute budget costs no real time.
   */
  timer?: (ms: number, fire: () => void) => () => void;
  onUpdate?: (task: BrowserTask) => void;
  downloadsDir?: string;
}

export function newTaskId(): string {
  return `bt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Validate a spec before it becomes a task — a task with no criteria can never complete honestly. */
export function validateSpec(spec: BrowserTaskSpec): void {
  if (!spec.objective?.trim()) {
    throw new BrowserTaskError({
      code: 'invalid-plan',
      message: 'the task has no objective',
      fix: 'Describe what the agent should accomplish, in one sentence.',
    });
  }
  if (!spec.startUrl || !/^https?:\/\//i.test(spec.startUrl)) {
    throw new BrowserTaskError({
      code: 'invalid-plan',
      message: 'startUrl must be an absolute http(s) URL',
      fix: 'Pass a full URL such as https://example.com/report.',
    });
  }
  if (!spec.plan?.length) {
    throw new BrowserTaskError({
      code: 'invalid-plan',
      message: 'the task has no steps',
      fix: 'Add at least one step: navigate, click, type, press, wait or verify.',
    });
  }
  if (!spec.successCriteria?.length) {
    throw new BrowserTaskError({
      code: 'invalid-plan',
      message: 'the task defines no success criteria',
      fix: 'Add a criterion (url, title, text or element). Without one, success cannot be verified and the task will not be reported as complete.',
    });
  }
  const ids = new Set<string>();
  for (const step of spec.plan) {
    if (!step.id) {
      throw new BrowserTaskError({ code: 'invalid-plan', message: 'every step needs an id', fix: 'Give each step a stable id.' });
    }
    if (ids.has(step.id)) {
      throw new BrowserTaskError({
        code: 'invalid-plan',
        message: `duplicate step id ${step.id}`,
        fix: 'Step ids must be unique — checkpoints resume by id.',
      });
    }
    ids.add(step.id);
  }
}

export function createTask(spec: BrowserTaskSpec, now = Date.now()): BrowserTask {
  validateSpec(spec);
  const limits: BrowserLimits = { ...DEFAULT_LIMITS, ...spec.limits };

  return {
    id: newTaskId(),
    createdAt: now,
    updatedAt: now,
    state: 'QUEUED',
    stateReason: 'queued',
    spec,
    limits,
    stepIndex: 0,
    nextStepId: spec.plan[0]?.id ?? null,
    steps: {},
    startedAt: null,
    deadlineAt: now + limits.deadlineMs,
    finishedAt: null,
    lastAction: null,
    lastMilestone: null,
    lastProgressAt: now,
    consecutiveFailures: 0,
    retriesUsed: 0,
    recoveryAttempts: 0,
    unverifiedSteps: 0,
    loopFlags: [],
    currentUrl: spec.startUrl,
    currentTitle: '',
    currentOperation: null,
    health: null,
    restriction: null,
    blocker: null,
    limitations: [],
    criteriaResults: [],
    checkpoints: [],
    events: [],
    lastCheckpointId: null,
    restoredAt: null,
    evidence: null,
    outcome: null,
  };
}

export class BrowserTaskRunner {
  private task: BrowserTask;
  private readonly deps: RunnerDeps;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timer: (ms: number, fire: () => void) => () => void;

  private session: BrowserSession | null = null;
  private loops: LoopDetector;
  private observation: PageObservation | null = null;
  private abort: AbortController | null = null;
  private pauseRequested = false;
  private cancelRequested = false;
  private runPromise: Promise<BrowserTask> | null = null;
  private ticks = 0;

  /** Interaction method to use on the next attempt of a specific step. */
  private methodOverride = new Map<string, InteractionMethod>();
  /** Steps the agent could not complete and deliberately deferred. */
  private deferred = new Set<string>();
  /** Authorised alternatives already used, so we never loop through them. */
  private alternatesTried = new Set<string>();
  /** Pending browser restart (crash or resource ceiling). */
  private restartPending = false;
  private crashes = 0;
  private heapRecycles = 0;
  private lastStatus = 0;
  private downloadStarted = false;
  private storageState: StorageState | null = null;

  constructor(task: BrowserTask, deps: RunnerDeps) {
    this.task = task;
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timer =
      deps.timer ??
      ((ms, fire) => {
        const handle = setTimeout(fire, ms);
        return () => clearTimeout(handle);
      });
    this.loops = new LoopDetector({ threshold: task.limits.maxRepeats });

    if (process.env.VERCEL) {
      task.limitations = unique([
        ...task.limitations,
        'Running on a serverless host: the browser lives inside one function invocation, and a task cannot outlive it. Use a long-running Node host for multi-hour runs.',
      ]);
    }
  }

  get snapshot(): BrowserTask {
    return this.task;
  }

  /* ---------------------------------------------------------------- */
  /*  public controls                                                  */
  /* ---------------------------------------------------------------- */

  async run(): Promise<BrowserTask> {
    if (this.runPromise) return this.runPromise;
    this.runPromise = this.loop().finally(() => {
      this.runPromise = null;
      void this.closeSession();
    });
    return this.runPromise;
  }

  /** Resume after a pause, a crash, or a service restart. */
  async resume(): Promise<BrowserTask> {
    if (isTerminal(this.task.state)) return this.task;
    this.pauseRequested = false;
    this.cancelRequested = false;

    if (this.task.state === 'PAUSED') {
      this.setState('RUNNING', 'resumed by operator');
    } else if (this.task.state === 'WAITING_FOR_USER') {
      this.setState('RUNNING', 'operator acknowledged the blocker — continuing');
      this.task.blocker = null;
      this.task.restriction = null;
      this.loops.clearBlock();
      this.task.consecutiveFailures = 0;
      this.task.recoveryAttempts = 0;
    }
    await this.persist();
    return this.run();
  }

  async pause(reason = 'paused by operator'): Promise<void> {
    if (isTerminal(this.task.state)) return;
    this.pauseRequested = true;
    this.abort?.abort();
    this.setState('PAUSED', reason);
    this.task.currentOperation = null;
    await this.persist();
  }

  async cancel(reason = 'cancelled by operator'): Promise<void> {
    if (isTerminal(this.task.state)) return;
    this.cancelRequested = true;
    this.abort?.abort();
    this.setState('CANCELLED', reason);
    this.task.finishedAt = this.now();
    this.task.outcome = `Cancelled: ${reason}`;
    await this.closeSession();
    await this.persist();
  }

  /** Read the live page without advancing the plan (UI "inspect"). */
  async inspect(): Promise<BrowserTask> {
    try {
      const session = await this.ensureSession();
      const observation = await session.observe();
      this.task.currentUrl = observation.url;
      this.task.currentTitle = observation.title;
      const health = await session.health();
      this.task.health = health;
      this.emit('note', 'inspected the live page', `${observation.url} · ${observation.elementCount} elements`);
    } catch (error) {
      const failure = toBrowserError(error);
      this.emit('error', 'inspect failed', `${failure.code}: ${failure.message}`);
    }
    await this.persist();
    return this.task;
  }

  /* ---------------------------------------------------------------- */
  /*  main loop                                                        */
  /* ---------------------------------------------------------------- */

  private async loop(): Promise<BrowserTask> {
    if (this.task.state === 'QUEUED') {
      this.task.startedAt = this.now();
      this.task.deadlineAt = this.now() + this.task.limits.deadlineMs;
      this.emit('state', 'task started', this.task.spec.objective);
    }

    if (this.task.restoredAt) {
      this.restartPending = true;
      this.setState('RECOVERING', 'restored from disk after a restart — inspecting existing state first');
      this.emit(
        'recovery',
        'task restored from its last checkpoint',
        `last checkpoint: ${this.lastCheckpoint()?.milestone ?? 'none'}`,
      );
    } else if (this.task.state !== 'RECOVERING') {
      this.setState('RUNNING', 'running');
    }

    const hardTickLimit = this.task.spec.plan.length * (this.task.limits.maxRepeats + 4) + 60;

    while (!this.stopRequested()) {
      this.ticks += 1;
      if (this.ticks > hardTickLimit) {
        this.task.loopFlags = unique([...this.task.loopFlags, 'tick-budget']);
        this.block('loop-detected', 'The task exceeded its step budget without finishing', 'Inspect the timeline: a step is not advancing. Adjust the plan or the target.');
        break;
      }

      const symptom = inspectWatchdog({
        now: this.now(),
        operationStartedAt: this.task.currentOperation?.startedAt ?? null,
        operationTimeoutMs: this.task.currentOperation
          ? this.currentStep()?.kind === 'navigate'
            ? this.task.limits.navigationTimeoutMs
            : this.task.limits.actionTimeoutMs
          : this.task.limits.actionTimeoutMs,
        lastProgressAt: this.task.lastProgressAt,
        progressIntervalMs: this.task.limits.progressIntervalMs,
        deadlineAt: this.task.deadlineAt,
      });

      if (symptom.kind === 'deadline') {
        this.timedOut(`deadline expired — ${symptom.detail}`);
        break;
      }

      if (symptom.kind === 'action-timeout' || symptom.kind === 'no-progress') {
        this.emit('recovery', 'watchdog detected a stall', symptom.detail);
        this.abort?.abort();
        this.abort = null;
        this.task.currentOperation = null;
        this.setState('RECOVERING', symptom.detail);
        this.task.recoveryAttempts += 1;
        if (this.task.recoveryAttempts > this.task.limits.maxRecoveryAttempts) {
          this.block(
            'loop-detected',
            'The task stalled repeatedly and recovery was exhausted',
            'Open the timeline for the captured state, then resume with a narrower objective or a different route.',
          );
          break;
        }
      }

      try {
        if (this.restartPending) {
          await this.handleRestart();
        } else if (this.task.state === 'RECOVERING') {
          await this.recover();
        } else {
          await this.step();
        }
      } catch (error) {
        await this.handleFatal(error);
      }

      await this.persist();
      if (this.sleep === undefined) break;
      if (this.stopRequested()) break;
      await this.sleep(TICK_PAUSE_MS);
    }

    this.task.currentOperation = null;
    /*
     * An in-flight tick can still write RECOVERING/RUNNING after the pause was
     * requested; the operator asked for paused, so that is the state it ends in.
     */
    if (this.pauseRequested && !isTerminal(this.task.state) && this.task.state !== 'PAUSED') {
      this.setState('PAUSED', 'paused by operator');
    }
    await this.persist();
    return this.task;
  }

  private stopRequested(): boolean {
    return (
      this.pauseRequested ||
      this.cancelRequested ||
      isTerminal(this.task.state) ||
      this.task.state === 'WAITING_FOR_USER'
    );
  }

  /* ---------------------------------------------------------------- */
  /*  steps                                                            */
  /* ---------------------------------------------------------------- */

  private currentStep(): BrowserStep | null {
    return this.task.spec.plan[this.task.stepIndex] ?? null;
  }

  private async step(): Promise<void> {
    const step = this.currentStep();
    if (!step) {
      await this.complete();
      return;
    }

    if (this.deferred.has(step.id)) {
      this.advance(step, 'skipped — deferred earlier');
      return;
    }

    const session = await this.ensureSession();
    await this.checkResources(session);
    // The health check may have decided to recycle the browser; restarting is
    // the next tick's job, and running a step against a dying browser is noise.
    if (this.restartPending) return;

    const before = await this.observeQuietly(session);
    const target = targetOf(step);
    const finding = this.loops.recordAction(step.id, target, before?.digest ?? 'none', this.now());
    if (finding) {
      await this.handleLoop(finding, step);
      return;
    }

    this.abort = new AbortController();
    this.task.currentOperation = { label: describeStep(step), startedAt: this.now(), stepId: step.id };
    this.emit('action', describeStep(step), before ? `${before.url}` : undefined, step.id);
    await this.persist();

    const record = this.recordFor(step.id);
    record.attempts += 1;
    record.lastAttemptAt = this.now();

    try {
      // Belt and braces: the engine has its own timeout, and the runner races the
      // same budget here. If an engine call never settles, the watchdog can still
      // cancel it instead of the task hanging on an awaited promise.
      await this.raceTimeout(
        this.perform(step, session),
        step.kind === 'navigate' ? this.task.limits.navigationTimeoutMs : this.task.limits.actionTimeoutMs,
        step.kind === 'navigate' ? 'navigation' : 'action',
      );
      const after = await this.observeQuietly(session);
      await this.afterStep(step, before, after);
    } catch (error) {
      await this.handleStepFailure(step, error, before);
    } finally {
      this.abort = null;
      this.task.currentOperation = null;
    }
  }

  /**
   * Race work against a budget.
   *
   * The deadline rides on an injectable timer, so the tests can drive a
   * ten-minute navigation timeout in virtual time and production still gets a
   * real wall-clock deadline. If the work wins, the timer is cancelled — a
   * successful action never consumes its budget.
   */
  private async raceTimeout<T>(work: Promise<T>, budgetMs: number, label: string): Promise<T> {
    let cancel: (() => void) | undefined;
    const budget = new Promise<never>((_, reject) => {
      cancel = this.timer(budgetMs, () => {
        reject(
          new BrowserTaskError({
            code: label === 'navigation' ? 'navigation-timeout' : 'action-timeout',
            message: `${label} exceeded its ${formatDuration(budgetMs)} budget and was cancelled`,
            fix: 'The runner cancels stalled operations, inspects the page, and retries with a different strategy.',
            retryable: true,
          }),
        );
      });
    });

    try {
      return await Promise.race([work, budget]);
    } finally {
      cancel?.();
      budget.catch(() => undefined);
    }
  }

  private async perform(step: BrowserStep, session: BrowserSession): Promise<void> {
    const signal = this.abort?.signal;
    const method = this.methodOverride.get(step.id) ?? 'auto';

    switch (step.kind) {
      case 'navigate': {
        const result = await session.navigate(step.url, {
          timeoutMs: this.task.limits.navigationTimeoutMs,
          signal,
        });
        this.lastStatus = result.status;
        this.task.currentUrl = result.url;
        this.emit('action', `navigation returned ${result.status || 'no status'}`, result.url, step.id);
        return;
      }
      case 'click':
        await session.click(step.target, method, { timeoutMs: this.task.limits.actionTimeoutMs });
        return;
      case 'type':
        await session.type(step.target, step.text, { timeoutMs: this.task.limits.actionTimeoutMs });
        return;
      case 'press':
        await session.press(step.key, { timeoutMs: this.task.limits.actionTimeoutMs });
        return;
      case 'wait':
        await session.wait(step.ms, signal);
        return;
      case 'verify': {
        const results = await this.evaluate(step.criteria, session);
        if (!allSatisfied(results)) {
          throw new BrowserTaskError({
            code: 'criteria-unverified',
            message: summariseCriteria(results),
            fix: 'The page did not reach the expected state. Reinspect before continuing.',
            retryable: true,
          });
        }
        return;
      }
    }
  }

  private async afterStep(
    step: BrowserStep,
    before: PageObservation | null,
    after: PageObservation | null,
  ): Promise<void> {
    const session = await this.ensureSession();

    if (after) {
      this.observation = after;
      this.task.currentUrl = after.url;
      this.task.currentTitle = after.title;
      // A navigation loop is only visible across pages, so both channels feed it.
      const navFinding = step.kind === 'navigate' ? this.loops.recordNavigation(after.url) : null;
      if (navFinding) {
        await this.handleLoop(navFinding, step);
        return;
      }
    }

    const restriction = await this.scanPage(session, after);
    if (restriction) {
      await this.handleRestriction(restriction, step);
      return;
    }

    let verified = false;
    let results: CriterionResult[] = [];
    if (step.expect?.length && after) {
      results = await this.evaluate(step.expect, session);
      verified = allSatisfied(results);
      if (!verified) {
        await this.handleStepFailure(
          step,
          new BrowserTaskError({
            code: 'criteria-unverified',
            message: `the action ran but its effect was not observed: ${summariseCriteria(results)}`,
            fix: 'Reinspect the page; the control may be disabled or the site may have rejected the action silently.',
            retryable: true,
          }),
          before,
        );
        return;
      }
    }

    /*
     * An interaction that changed nothing is not a success. Without this, an
     * agent that clicks a button the site ignores would march through its plan
     * and "finish" having accomplished nothing. The plan can opt out by
     * declaring `expect` — which is the honest way to say "this action is
     * supposed to be invisible".
     */
    const interacted = step.kind === 'click' || step.kind === 'type' || step.kind === 'press';
    if (interacted && !step.expect?.length && after && before && !isMeaningfulChange(before, after)) {
      await this.handleStepFailure(
        step,
        new BrowserTaskError({
          code: 'no-effect',
          message: `${describeStep(step)} produced no observable change in the page`,
          fix: 'The control may be disabled, covered, or ignored by the site. Try a different interaction method or re-locate the target.',
          retryable: true,
        }),
        before,
      );
      return;
    }

    const record = this.recordFor(step.id);
    record.ok = true;
    record.verifiedAt = this.now();
    record.lastError = undefined;
    this.task.consecutiveFailures = 0;
    this.task.lastAction = { label: describeStep(step), at: this.now(), ok: true };
    this.task.lastMilestone = { label: step.milestone, at: this.now(), verified };

    const progressed = isMeaningfulChange(before, after) || verified;
    if (progressed) {
      /*
       * A navigation that genuinely changed the page is progress, whether or not
       * the step declared an `expect`. Counting those against the milestone
       * budget made a 40-page crawl look like a stalled agent.
       */
      this.task.lastProgressAt = this.now();
      /*
       * Verified progress resets the recovery budget. Otherwise a long task that
       * survives one hiccup per hour would spend its whole allowance and stop,
       * even though every recovery worked.
       */
      this.task.recoveryAttempts = 0;
      if (verified) this.task.unverifiedSteps = 0;
    } else if (step.kind !== 'wait') {
      this.task.unverifiedSteps += 1;
      this.emit('note', 'step completed without an observable change', step.milestone, step.id);
    }

    this.emit(
      'milestone',
      step.milestone,
      verified ? 'verified against the live page' : 'completed (not independently verified)',
      step.id,
    );

    if (verified || step.kind === 'navigate') {
      await this.saveCheckpoint(step, after, results);
    }

    if (this.task.unverifiedSteps > this.task.limits.maxUnverifiedSteps) {
      this.emit('recovery', 'too many unverified steps', `${this.task.unverifiedSteps} steps produced no verifiable milestone`);
      this.setState('RECOVERING', 'milestone discipline: too many unverified steps');
      this.task.recoveryAttempts += 1;
      return;
    }

    this.advance(step, 'ok');
  }

  private advance(step: BrowserStep, note: string): void {
    this.task.stepIndex += 1;
    const next = this.currentStep();
    this.task.nextStepId = next?.id ?? null;
    this.methodOverride.delete(step.id);
    if (note !== 'ok') this.emit('note', `${step.id}: ${note}`, step.milestone, step.id);
  }

  /* ---------------------------------------------------------------- */
  /*  failure handling                                                 */
  /* ---------------------------------------------------------------- */

  private async handleStepFailure(step: BrowserStep, error: unknown, before: PageObservation | null): Promise<void> {
    const failure = this.classifyFailure(error);
    const record = this.recordFor(step.id);
    record.lastError = `${failure.code}: ${failure.message}`;

    this.task.consecutiveFailures += 1;
    this.task.retriesUsed += 1;
    this.task.lastAction = { label: describeStep(step), at: this.now(), ok: false };
    this.emit('error', `${step.id} failed`, `${failure.code}: ${failure.message}`, step.id);

    const finding = this.loops.recordError(`${failure.code}:${step.id}`, this.now());
    if (finding) this.task.loopFlags = unique([...this.task.loopFlags, finding.kind]);

    if (failure.code === 'browser-crashed') {
      await this.handleCrash(failure.message);
      return;
    }

    // Sensitive actions are checked for effect before anything else happens.
    if (isSensitiveStep(step)) {
      const effectPresent = await this.verifyEffect(step);
      if (effectPresent) {
        this.emit(
          'note',
          'sensitive action had already taken effect',
          'the retry was skipped to avoid performing it twice',
          step.id,
        );
        record.ok = true;
        this.task.consecutiveFailures = 0;
        this.task.lastProgressAt = this.now();
        this.advance(step, 'already effective — not repeated');
        return;
      }
      const verdict = canRetry(step, effectPresent);
      if (!verdict.ok) {
        this.waitForUser('sensitive-action', `${failure.message} — ${verdict.reason}`, failure.fix);
        return;
      }
    }

    if (this.task.retriesUsed >= this.task.limits.maxRetries) {
      this.block(
        'loop-detected',
        `retry budget exhausted after ${this.task.retriesUsed} attempts`,
        'The plan is not working on this site. Review the timeline and resume with a narrower objective or a different route.',
      );
      return;
    }

    if (this.task.consecutiveFailures >= this.task.limits.maxConsecutiveFailures) {
      this.block(
        'resource-limit',
        `${this.task.consecutiveFailures} consecutive failures`,
        'Inspect the captured page state; the target may be gone or the site may be refusing the session.',
      );
      return;
    }

    this.task.recoveryAttempts += 1;
    this.setState('RECOVERING', `${failure.code}: ${failure.message}`);
    void before;
  }

  /**
   * Engines normally raise typed errors, but a raw "Session closed" from the
   * protocol must still be recognised as a crash — otherwise the runner retries
   * against a browser that no longer exists.
   */
  private classifyFailure(error: unknown): { code: string; message: string; fix: string } {
    const failure = toBrowserError(error);
    if (failure.code === 'browser-crashed') return failure;
    if (/target closed|session closed|connection closed|browser has disconnected|protocol error|websocket/i.test(failure.message)) {
      return {
        code: 'browser-crashed',
        message: failure.message,
        fix: 'The runner restarts the browser and resumes from the last verified checkpoint.',
      };
    }
    return failure;
  }

  private async handleLoop(finding: LoopFinding, step: BrowserStep): Promise<void> {
    this.task.loopFlags = unique([...this.task.loopFlags, finding.kind]);
    this.emit('loop', `loop detected: ${finding.message}`, finding.advice, step.id);

    // Stop the repeated action first — the loop is in the repetition, not the page.
    const method = nextUntriedMethod(this.recordFor(step.id).methodsTried);
    if (method) {
      this.methodOverride.set(step.id, method);
      this.setState('RECOVERING', `loop detected — switching to the ${method} interaction method`);
      this.task.recoveryAttempts += 1;
      return;
    }

    if (this.task.spec.alternateUrls?.length) {
      this.setState('RECOVERING', 'loop detected — trying an authorised alternative route');
      this.task.recoveryAttempts += 1;
      return;
    }

    this.block('loop-detected', finding.message, finding.advice);
  }

  private async handleRestriction(restriction: Restriction, step: BrowserStep): Promise<void> {
    this.task.restriction = restriction;
    this.loops.markBlocked(step.id);
    this.emit(
      'restriction',
      `site restriction: ${restriction.kind}`,
      `${restriction.evidence} — ${restriction.fix}`,
      step.id,
    );

    if (restriction.kind === 'login-required' || restriction.kind === 'captcha' || restriction.kind === 'bot-check') {
      this.waitForUser('session-expired', restriction.evidence, restriction.fix);
      return;
    }

    // A blocked route is not necessarily a blocked task: if the spec names an
    // authorised alternative and we have not used it yet, try that instead of
    // retrying the page that refused us.
    const alternates = this.task.spec.alternateUrls ?? [];
    if (alternates.length > 0 && !this.alternatesTried.has(alternates[0])) {
      this.emit('restriction', 'switching to an authorised alternative', alternates[0], step.id);
      this.setState('RECOVERING', `${restriction.kind} — trying an authorised alternative source`);
      this.task.recoveryAttempts += 1;
      return;
    }

    this.block('restriction', `${restriction.kind}: ${restriction.evidence}`, restriction.fix);
  }

  /* ---------------------------------------------------------------- */
  /*  recovery                                                         */
  /* ---------------------------------------------------------------- */

  private async recover(): Promise<void> {
    if (this.pauseRequested || this.cancelRequested) return;
    const step = this.currentStep();
    const record = step ? this.recordFor(step.id) : null;

    const action = planRecovery({
      attempt: this.task.recoveryAttempts,
      maxAttempts: this.task.limits.maxRecoveryAttempts,
      consecutiveFailures: this.task.consecutiveFailures,
      maxConsecutiveFailures: this.task.limits.maxConsecutiveFailures,
      step,
      methodsTried: record?.methodsTried ?? [],
      alternateUrls: this.task.spec.alternateUrls ?? [],
      alternatesTried: [...this.alternatesTried],
      restriction: this.task.restriction,
      lastFinding: null,
      effectUnverified: step ? isSensitiveStep(step) : false,
    });

    this.emit('recovery', `recovery step: ${action.kind}`, action.reason, step?.id);
    await this.applyRecovery(action, step);
  }

  private async applyRecovery(action: RecoveryAction, step: BrowserStep | null): Promise<void> {
    switch (action.kind) {
      case 'wait-for-state': {
        await this.sleep(action.ms);
        this.setState('RUNNING', 'retrying after the page settled');
        return;
      }
      case 'reload': {
        const session = await this.ensureSession();
        await session.navigate(this.task.currentUrl || this.task.spec.startUrl, {
          timeoutMs: this.task.limits.navigationTimeoutMs,
        });
        await this.observeQuietly(session);
        this.setState('RUNNING', 'reloaded the page');
        return;
      }
      case 'reinspect': {
        const session = await this.ensureSession();
        const snapshot = await session.snapshot();
        this.emit(
          'recovery',
          're-inspected the accessibility tree',
          `${snapshot.nodeCount} nodes · ${snapshot.nodes.slice(0, 4).map((node) => `${node.role}${node.name ? `:${node.name}` : ''}`).join(', ')}`,
          step?.id,
        );
        this.observeQuietly(session).catch(() => undefined);
        this.setState('RUNNING', 're-inspected the page');
        return;
      }
      case 'relocate': {
        const session = await this.ensureSession();
        if (step && 'target' in step) {
          const resolved = await session.resolve(step.target);
          this.emit(
            'recovery',
            resolved.found ? 're-located the target' : 'target is still missing',
            resolved.detail,
            step.id,
          );
          if (!resolved.found) {
            this.task.consecutiveFailures += 1;
          }
        }
        this.setState('RUNNING', 're-located the target');
        return;
      }
      case 'alternate-interaction': {
        if (step) {
          this.methodOverride.set(step.id, action.method);
          this.recordFor(step.id).methodsTried = unique([
            ...this.recordFor(step.id).methodsTried,
            action.method,
          ]) as InteractionMethod[];
        }
        this.setState('RUNNING', `retrying with the ${action.method} method`);
        return;
      }
      case 'alternate-source': {
        const session = await this.ensureSession();
        this.alternatesTried.add(action.url);
        await session.navigate(action.url, { timeoutMs: this.task.limits.navigationTimeoutMs });
        const observation = await this.observeQuietly(session);
        this.emit('recovery', 'switched to an authorised alternative', action.url, step?.id);
        /*
         * The restriction stays on the record: it happened, and the operator
         * needs to know the result was collected from somewhere else. Only the
         * behavioural block is cleared.
         */
        if (this.task.restriction) {
          this.emit('restriction', 'restriction bypassed via an authorised alternative', action.url, step?.id);
        }
        this.loops.clearBlock();
        if (step && step.kind === 'navigate' && observation) {
          // The navigation step is satisfied by the alternative route.
          this.recordFor(step.id).ok = true;
          this.recordFor(step.id).verifiedAt = this.now();
          this.task.lastProgressAt = this.now();
          this.advance(step, 'satisfied via an authorised alternative');
        }
        this.setState('RUNNING', `using ${action.url}`);
        return;
      }
      case 'defer-step': {
        if (step) {
          this.deferred.add(step.id);
          this.emit('note', 'obstacle recorded, continuing elsewhere', action.reason, step.id);
          this.advance(step, 'deferred');
        }
        this.setState('RUNNING', 'continued with the rest of the plan');
        return;
      }
      case 'request-user': {
        this.waitForUser(this.task.restriction?.kind ?? 'restriction', action.reason, this.task.restriction?.fix ?? 'Resolve the blocker in your own browser, then resume.');
        return;
      }
      case 'stop': {
        this.block('loop-detected', action.reason, 'Review the timeline to see what the agent tried.');
        return;
      }
    }
  }

  private async handleCrash(reason: string): Promise<void> {
    this.crashes += 1;
    this.emit('error', 'browser crashed', reason);
    await this.closeSession();

    if (this.crashes > 2) {
      this.block(
        'browser-crashed',
        'The browser crashed repeatedly',
        'The runtime cannot keep a browser alive here. Run the agent on a host with enough memory, or point BROWSER_WS_ENDPOINT at a browser service.',
      );
      return;
    }

    this.restartPending = true;
    this.task.recoveryAttempts += 1;
    this.setState('RECOVERING', `browser crashed (${this.crashes}) — restarting from the last checkpoint`);
  }

  private async handleRestart(): Promise<void> {
    const session = await this.ensureSession();
    const checkpoint = this.lastCheckpoint();

    if (checkpoint) {
      this.emit('recovery', 'restoring from checkpoint', `${checkpoint.milestone} @ ${checkpoint.url}`);
      try {
        if (checkpoint.url && checkpoint.url !== 'about:blank') {
          await session.navigate(checkpoint.url, { timeoutMs: this.task.limits.navigationTimeoutMs });
        }
        if (checkpoint.storageStateSaved && this.storageState) {
          await session.saveStorageState();
        }
      } catch (error) {
        this.emit('error', 'could not reopen the checkpointed page', toBrowserError(error).message);
      }
    }

    const observation = await this.observeQuietly(session);
    if (checkpoint && observation) {
      const matches = observation.digest === checkpoint.digest;
      this.emit(
        'recovery',
        matches ? 'page state matches the checkpoint' : 'page state differs from the checkpoint',
        `${observation.url} · digest ${observation.digest}`,
      );
    }

    // Inspect before repeating: if the interrupted step already took effect,
    // advancing is correct. Re-running it would duplicate the work (AT-23/24).
    const step = this.currentStep();
    if (step) {
      const effect = await this.verifyEffect(step);
      if (effect) {
        this.emit('note', 'the interrupted step had already taken effect', 'advancing instead of repeating it', step.id);
        this.recordFor(step.id).ok = true;
        this.advance(step, 'already effective — not repeated');
      }
    }

    this.restartPending = false;
    this.task.recoveryAttempts = 0;
    this.setState('RUNNING', 'resumed from checkpoint');
  }

  /* ---------------------------------------------------------------- */
  /*  resource limits                                                  */
  /* ---------------------------------------------------------------- */

  private async checkResources(session: BrowserSession): Promise<void> {
    const health = await session.health().catch(() => null);
    if (!health) return;
    this.task.health = health;

    if (!health.browserAlive) {
      await this.handleCrash('health probe reported a dead browser');
      return;
    }

    if (health.tabs > this.task.limits.maxTabs) {
      const closed = await session.closeExtraTabs(this.task.limits.maxTabs);
      this.emit('health', `closed ${closed} extra tab(s)`, `${health.tabs} tabs open, limit ${this.task.limits.maxTabs}`);
    }

    if (health.heapMb > this.task.limits.maxHeapMb) {
      this.heapRecycles += 1;
      this.emit('health', 'heap ceiling reached — recycling the browser', `${health.heapMb} MB > ${this.task.limits.maxHeapMb} MB`);
      if (this.heapRecycles > 2) {
        this.block(
          'resource-limit',
          `the browser stayed above its ${this.task.limits.maxHeapMb} MB heap ceiling after ${this.heapRecycles} restarts`,
          'Give this runtime more memory, narrow the task (fewer pages per run), or point BROWSER_WS_ENDPOINT at a browser service.',
        );
        return;
      }
      await this.handleCrash(`heap ${health.heapMb} MB exceeded the ${this.task.limits.maxHeapMb} MB ceiling`);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  completion                                                       */
  /* ---------------------------------------------------------------- */

  private async complete(): Promise<void> {
    let session: BrowserSession;
    try {
      session = await this.ensureSession();
    } catch (error) {
      if (this.classifyFailure(error).code === 'browser-crashed') {
        await this.handleCrash('the browser died before the result could be verified');
        return;
      }
      throw error;
    }
    const observation = await this.observeQuietly(session);
    const results = observation ? await this.evaluate(this.task.spec.successCriteria, session) : [];
    this.task.criteriaResults = results;

    if (observation && allSatisfied(results)) {
      const evidence = await this.captureEvidence(observation, results);
      this.task.evidence = evidence;
      this.task.finishedAt = this.now();
      this.task.outcome = `Verified ${results.length}/${results.length} success criteria at ${observation.url}`;
      this.setState('COMPLETED', summariseCriteria(results));
      this.emit('milestone', 'task completed', this.task.outcome, undefined, evidence);
      await this.persist();
      return;
    }

    const summary = results.length ? summariseCriteria(results) : 'the page could not be read to verify completion';
    this.task.criteriaResults = results;
    this.task.finishedAt = this.now();
    this.task.outcome = `Not completed: ${summary}`;
    this.setState('FAILED', `success criteria were not met — ${summary}`);
    this.task.blocker = {
      code: 'criteria-unverified',
      message: `The plan finished but the success criteria were not met: ${summary}`,
      fix: 'The task was not reported as complete. Inspect the evidence, then resume with a corrected plan.',
    };
    this.emit('error', 'finished without meeting its success criteria', summary);
    await this.persist();
  }

  /* ---------------------------------------------------------------- */
  /*  helpers                                                          */
  /* ---------------------------------------------------------------- */

  private async ensureSession(): Promise<BrowserSession> {
    if (this.session) {
      if (this.session.isAlive()) return this.session;
      /*
       * A dead session is a crash, not an inconvenience. Silently launching a
       * replacement here would put the agent on a blank page with no checkpoint
       * restore and no timeline entry — the exact silent restart the spec
       * forbids. Fail loudly so the crash path runs.
       */
      const dead = this.session;
      this.session = null;
      try {
        await dead.close();
      } catch {
        /* already gone */
      }
      throw new BrowserTaskError({
        code: 'browser-crashed',
        message: 'the browser session is no longer alive',
        fix: 'The runner restarts the browser and resumes from the last verified checkpoint.',
        retryable: true,
      });
    }

    const availability = await this.deps.engine.availability();
    if (!availability.available) {
      this.block(
        'browser-unavailable',
        availability.reason ?? 'no browser is available in this runtime',
        availability.fix ?? 'Install a Chromium build, or point BROWSER_WS_ENDPOINT at a browser service.',
      );
      throw new BrowserTaskError({
        code: 'browser-unavailable',
        message: 'no browser is available',
        fix: 'Install a Chromium build.',
      });
    }

    try {
      this.session = await this.deps.engine.launch({
        profile: this.task.spec.profile,
        downloadsDir: this.deps.downloadsDir ?? `${process.cwd()}/.nexus/browser/downloads`,
        storageState: this.storageState,
        proxy: process.env.BROWSER_PROXY ?? null,
      });
      this.emit('note', 'browser session started', `${this.deps.engine.kind} · profile ${this.task.spec.profile}`);
      return this.session;
    } catch (error) {
      const failure = toBrowserError(error);
      this.block('browser-unavailable', failure.message, failure.fix);
      throw error;
    }
  }

  private async closeSession(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (!session) return;
    try {
      await session.close();
    } catch {
      /* the browser is already gone; that is what we wanted */
    }
  }

  private async observeQuietly(session: BrowserSession): Promise<PageObservation | null> {
    try {
      const observation = await session.observe();
      this.observation = observation;
      this.task.currentUrl = observation.url;
      this.task.currentTitle = observation.title;
      return observation;
    } catch {
      return null;
    }
  }

  private async scanPage(session: BrowserSession, observation: PageObservation | null): Promise<Restriction | null> {
    if (!observation) return null;
    const sessionExpired = detectSessionExpiry({
      url: observation.url,
      text: observation.excerpt,
      passwordFieldPresent: /password/i.test(observation.excerpt),
      previouslyAuthenticated: (this.task.spec.plan ?? []).some(
        (step) => step.kind === 'click' && /log ?in|sign ?in/i.test(step.milestone),
      ),
    });

    if (sessionExpired) {
      return {
        kind: 'login-required',
        evidence: `session expired at ${observation.url}`,
        fix: 'Sign in again in your own browser (or re-import the profile), then resume the task.',
        hard: true,
        at: this.now(),
      };
    }

    const restriction = detectRestriction({
      url: observation.url,
      title: observation.title,
      text: observation.excerpt,
      status: this.lastStatus || undefined,
      captchaWidget: /recaptcha|hcaptcha|cf-turnstile/i.test(observation.excerpt),
      at: this.now(),
    });
    this.lastStatus = 0;
    void session;
    return restriction;
  }

  private async evaluate(
    criteria: SuccessCriterion[],
    session: BrowserSession,
    fresh?: PageObservation | null,
  ): Promise<CriterionResult[]> {
    const observation = fresh ?? this.observation ?? (await this.observeQuietly(session));
    if (!observation) return [];
    return evaluateCriteria(criteria, {
      observation,
      now: this.now(),
      downloadStarted: this.downloadStarted || session.downloads().length > 0,
      resolve: async (target) => {
        const resolved = await session.resolve(target);
        return { found: resolved.found, detail: resolved.detail };
      },
    });
  }

  /**
   * Did the interrupted step already take effect? Used before any retry.
   *
   * The check always reads the live page: deciding whether a payment went
   * through from a cached observation would be exactly the kind of guess this
   * subsystem exists to avoid.
   */
  private async verifyEffect(step: BrowserStep): Promise<boolean> {
    if (!step.expect?.length) return false;
    try {
      const session = await this.ensureSession();
      const observation = await this.observeQuietly(session);
      if (!observation) return false;
      const results = await this.evaluate(step.expect, session, observation);
      return allSatisfied(results);
    } catch {
      return false;
    }
  }

  private async captureEvidence(observation: PageObservation, results: CriterionResult[]): Promise<BrowserEvidence> {
    const evidence: BrowserEvidence = { observation, criteria: results };
    try {
      const session = await this.ensureSession();
      const shot = await session.screenshot();
      if (shot.ok && shot.base64) {
        const id = `shot-${this.now().toString(36)}`;
        await this.deps.store.saveScreenshot(this.task.id, id, shot.base64);
        evidence.screenshotId = id;
      } else if (!shot.ok) {
        this.emit('health', 'screenshot failed', shot.reason ?? 'unknown reason');
      }
    } catch {
      /* evidence without a screenshot is still evidence */
    }
    return evidence;
  }

  private async saveCheckpoint(
    step: BrowserStep,
    observation: PageObservation | null,
    results: CriterionResult[],
  ): Promise<void> {
    if (!observation) return;
    const session = this.session;
    let storageStateSaved = false;
    try {
      const state = await session?.saveStorageState();
      if (state) {
        this.storageState = state;
        storageStateSaved = true;
      }
    } catch {
      /* profile persistence is best-effort; the checkpoint is still valid */
    }

    const checkpoint: BrowserCheckpoint = {
      id: `cp-${this.now().toString(36)}-${this.task.checkpoints.length}`,
      taskId: this.task.id,
      at: this.now(),
      stepIndex: this.task.stepIndex + 1,
      milestone: step.milestone,
      nextStepId: this.task.spec.plan[this.task.stepIndex + 1]?.id ?? null,
      url: observation.url,
      title: observation.title,
      digest: observation.digest,
      storageStateSaved,
      evidence: { observation, criteria: results },
    };

    const evidence = await this.captureEvidence(observation, results);
    checkpoint.evidence = evidence;

    this.task.checkpoints = [...this.task.checkpoints, checkpoint].slice(-MAX_CHECKPOINTS);
    this.task.lastCheckpointId = checkpoint.id;
    this.emit('checkpoint', `checkpoint: ${step.milestone}`, `${observation.url}`, step.id, evidence);
  }

  private lastCheckpoint(): BrowserCheckpoint | null {
    return this.task.checkpoints[this.task.checkpoints.length - 1] ?? null;
  }

  private recordFor(stepId: string): StepRecord {
    const existing = this.task.steps[stepId];
    if (existing) return existing;
    const created: StepRecord = {
      stepId,
      attempts: 0,
      lastAttemptAt: null,
      ok: false,
      methodsTried: [],
    };
    this.task.steps[stepId] = created;
    return created;
  }

  private setState(next: BrowserTask['state'], reason: string): void {
    const previous = this.task.state;
    this.task.state = next;
    this.task.stateReason = reason;
    this.task.updatedAt = this.now();
    if (previous !== next) this.emit('state', `${previous} → ${next}`, reason);
  }

  private waitForUser(code: string, message: string, fix: string): void {
    this.task.blocker = { code, message, fix };
    this.task.finishedAt = null;
    this.setState('WAITING_FOR_USER', message);
    this.emit('blocker', 'waiting for the operator', `${message} — ${fix}`);
  }

  private block(code: string, message: string, fix: string): void {
    if (isTerminal(this.task.state)) return;
    this.task.blocker = { code, message, fix };
    this.task.finishedAt = this.now();
    this.task.outcome = `Blocked: ${message}`;
    this.setState('BLOCKED', message);
    this.emit('blocker', 'task blocked', `${message} — ${fix}`);
  }

  private timedOut(reason: string): void {
    if (isTerminal(this.task.state)) return;
    this.task.finishedAt = this.now();
    this.task.outcome = `Timed out: ${reason}`;
    this.task.blocker = {
      code: 'deadline-exceeded',
      message: reason,
      fix: 'Extend the deadline (limited by the site’s own limits) or split the objective into smaller tasks.',
    };
    this.setState('TIMED_OUT', reason);
    this.emit('state', 'deadline reached — task stopped', reason);
  }

  private emit(kind: TimelineKind, message: string, detail?: string, stepId?: string, evidence?: BrowserEvidence): void {
    const event: TimelineEvent = { at: this.now(), kind, message, detail, stepId, evidence };
    this.task.events = [...this.task.events, event].slice(-MAX_EVENTS);
  }

  private async handleFatal(error: unknown): Promise<void> {
    const failure = toBrowserError(error);
    if (failure.code === 'browser-unavailable') return; // already blocked with a reason
    this.emit('error', 'runner error', `${failure.code}: ${failure.message}`);
    if (this.task.state === 'RECOVERING') {
      this.task.recoveryAttempts += 1;
      if (this.task.recoveryAttempts > this.task.limits.maxRecoveryAttempts) {
        this.block('loop-detected', 'recovery could not make progress', failure.fix);
      }
      return;
    }
    this.block('unsupported', failure.message, failure.fix);
  }

  private async persist(): Promise<void> {
    this.task.updatedAt = this.now();
    try {
      await this.deps.store.save(this.task);
    } catch {
      this.task.limitations = unique([...this.task.limitations, 'the task store refused a write — checkpoints may not survive a restart']);
    }
    this.deps.onUpdate?.(this.task);
  }

  /** Exposed for the UI: what the agent is doing right now, in plain words. */
  activity(): ReturnType<typeof activityOf> {
    return activityOf(this.task, this.now());
  }

  /** Human summary of the wait, used in the panel header. */
  stallLabel(): string {
    return `no verified progress for ${formatDuration(this.now() - this.task.lastProgressAt)}`;
  }
}

/* ------------------------------------------------------------------ */
/*  small helpers                                                      */
/* ------------------------------------------------------------------ */

function targetOf(step: BrowserStep): string {
  if ('target' in step) {
    return [step.target.role, step.target.name, step.target.selector, step.target.text]
      .filter(Boolean)
      .join(' ') || 'target';
  }
  if (step.kind === 'navigate') return step.url;
  if (step.kind === 'press') return step.key;
  return step.kind;
}

function nextUntriedMethod(tried: InteractionMethod[]): InteractionMethod | null {
  for (const method of ['mouse', 'dom', 'keyboard'] as InteractionMethod[]) {
    if (!tried.includes(method)) return method;
  }
  return null;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

/** Used by the panel to explain "nothing happened yet" honestly. */
export function emptyObservation(url: string): PageObservation {
  return {
    url,
    title: '',
    digest: 'none',
    excerpt: '',
    nodeCount: 0,
    elementCount: 0,
    at: Date.now(),
  };
}

export { sameState };
