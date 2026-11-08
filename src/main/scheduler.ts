import type { Reminder, ReminderReason } from '../shared/types';
import type { ScheduleTrigger } from '../shared/schedule';
import { nextTime, typeOf } from '../shared/reminders';

/**
 * Short ticks that compare against the wall clock (never one long setTimeout),
 * so reminders survive sleep/wake and clock changes.
 */
const TICK_MS = 15_000;
/** If the overlay never answers (it should), stop waiting after this long. */
const RESPONSE_TIMEOUT_MS = 10 * 60_000;

export interface SchedulerDeps {
  reminders(): Reminder[];
  /** Today's log for a reminder: how often and when it was done. */
  today(id: string): { done: number; times: number[] };
  pauseWhenAway(): boolean;
  isUserAway(): boolean;
  /** This reminder can't be shown right now (something else is on screen, or it waits for Relax mode to end). */
  isBusy(reminder: Reminder): boolean;
  fire(reminder: Reminder, reason: ReminderReason): void;
  changed(): void;
  now?: () => number;
}

interface Slot {
  nextAt: number | null;
  snoozed: boolean;
}

/**
 * Keeps one next time per reminder and shows due ones one at a time: two
 * reminders due together are shown one after the other, the higher-priority
 * type first.
 */
export class ReminderScheduler {
  pausedUntil: number | null = null;
  private readonly slots = new Map<string, Slot>();
  private shown: { id: string; at: number } | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: SchedulerDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** The soonest reminder of all (null: nothing scheduled). */
  get nextAt(): number | null {
    let min: number | null = null;
    for (const s of this.slots.values()) if (s.nextAt !== null && (min === null || s.nextAt < min)) min = s.nextAt;
    return min;
  }

  nextFor(id: string): number | null {
    return this.slots.get(id)?.nextAt ?? null;
  }

  start(): void {
    this.sync('start');
    this.timer ??= setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Reminders were added, removed or changed: recompute every one. */
  sync(after: ScheduleTrigger = 'settings'): void {
    const reminders = this.deps.reminders();
    for (const id of this.slots.keys()) if (!reminders.some((r) => r.id === id)) this.slots.delete(id);
    if (this.shown && !reminders.some((r) => r.id === this.shown!.id)) this.shown = null;
    for (const r of reminders) this.compute(r, after);
    this.deps.changed();
  }

  /** Recompute one reminder after something happened to it. */
  reschedule(id: string, after: ScheduleTrigger): void {
    if (this.shown?.id === id) this.shown = null;
    const r = this.deps.reminders().find((x) => x.id === id);
    if (r) this.compute(r, after);
    this.deps.changed();
  }

  pause(until: number): void {
    this.pausedUntil = until;
    this.deps.changed();
  }

  resume(): void {
    if (this.pausedUntil === null) return;
    this.pausedUntil = null;
    this.sync('resume');
  }

  /** A reminder started outside the schedule (Test reminder / tray): wait for its answer. */
  manualShown(id: string): void {
    this.shown = { id, at: this.now() };
  }

  tick(): void {
    const now = this.now();
    if (this.pausedUntil !== null) {
      if (now >= this.pausedUntil) this.resume();
      return;
    }
    if (this.shown) {
      if (now - this.shown.at > RESPONSE_TIMEOUT_MS) this.reschedule(this.shown.id, 'skip');
      return;
    }
    const due = this.deps
      .reminders()
      .filter((r) => {
        const at = this.slots.get(r.id)?.nextAt;
        return at != null && at <= now;
      })
      .sort((a, b) => typeOf(b).priority - typeOf(a).priority || this.slots.get(a.id)!.nextAt! - this.slots.get(b.id)!.nextAt!);
    const r = due.find((x) => !this.deps.isBusy(x));
    if (!r) return;
    // Smart: hold reminders while the computer is idle or locked; they fire
    // as soon as the user is back (one at a time, not a backlog).
    if (this.deps.pauseWhenAway() && this.deps.isUserAway()) return;
    const slot = this.slots.get(r.id)!;
    this.shown = { id: r.id, at: now };
    this.slots.set(r.id, { ...slot, nextAt: null });
    this.deps.fire(r, slot.snoozed ? 'snoozed' : 'scheduled');
    this.deps.changed();
  }

  private compute(r: Reminder, after: ScheduleTrigger): void {
    const { done, times } = this.deps.today(r.id);
    const nextAt = nextTime(r, { now: this.now(), doneToday: done, doneTimes: times, after });
    this.slots.set(r.id, { nextAt, snoozed: after === 'later' || after === 'missed' });
  }
}
