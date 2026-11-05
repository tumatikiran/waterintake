import type { ReminderReason, ReminderSettings } from '../shared/types';
import { nextReminderTime, type ScheduleTrigger } from '../shared/schedule';

/**
 * Short ticks that compare against the wall clock (never one long setTimeout),
 * so reminders survive sleep/wake and clock changes.
 */
const TICK_MS = 15_000;
/** If the overlay never answers (it should), stop waiting after this long. */
const RESPONSE_TIMEOUT_MS = 10 * 60_000;

export interface SchedulerDeps {
  settings(): ReminderSettings;
  glassesToday(): number;
  isUserAway(): boolean;
  isBusy(): boolean;
  fire(reason: ReminderReason): void;
  changed(): void;
  now?: () => number;
}

export class ReminderScheduler {
  nextAt: number | null = null;
  pausedUntil: number | null = null;
  private snoozed = false;
  private shownAt: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: SchedulerDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  start(): void {
    this.reschedule('start');
    this.timer ??= setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Recompute the next reminder after something happened. */
  reschedule(after: ScheduleTrigger): void {
    this.shownAt = null;
    this.snoozed = after === 'later';
    this.nextAt = nextReminderTime({
      settings: this.deps.settings(),
      now: this.now(),
      glassesToday: this.deps.glassesToday(),
      after,
    });
    this.deps.changed();
  }

  pause(until: number): void {
    this.pausedUntil = until;
    this.deps.changed();
  }

  resume(): void {
    if (this.pausedUntil === null) return;
    this.pausedUntil = null;
    this.reschedule('resume');
  }

  /** A reminder started outside the schedule (Test reminder / tray). */
  manualShown(): void {
    this.shownAt = this.now();
  }

  tick(): void {
    const now = this.now();
    if (this.pausedUntil !== null) {
      if (now >= this.pausedUntil) this.resume();
      return;
    }
    if (this.shownAt !== null) {
      if (now - this.shownAt > RESPONSE_TIMEOUT_MS) this.reschedule('skip');
      return;
    }
    if (this.nextAt === null || now < this.nextAt) return;
    if (this.deps.isBusy()) return;
    // Smart: hold the reminder while the computer is idle or locked; it fires
    // as soon as the user is back (one reminder, not a backlog).
    if (this.deps.settings().pauseWhenAway && this.deps.isUserAway()) return;
    this.shownAt = now;
    this.nextAt = null;
    this.deps.fire(this.snoozed ? 'snoozed' : 'scheduled');
    this.deps.changed();
  }
}
