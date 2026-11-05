/**
 * Pure scheduling logic (no timers, no Electron), so it can be unit-tested.
 * All times are epoch milliseconds interpreted in the machine's local time zone.
 */
import type { ReminderSettings, TimeWindow } from './types';

export const MINUTE = 60_000;
const DAY_MS = 24 * 60 * MINUTE;
/** Goal mode never nags more often than this, nor waits longer than the max. */
export const GOAL_INTERVAL_BOUNDS = [20, 180] as const;

/** "HH:MM" → minutes after midnight, or null when malformed. */
export function parseTime(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

export function startOfDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Local midnight `n` calendar days after the day containing `t` (DST-safe). */
function addDays(dayStart: number, n: number): number {
  const d = new Date(dayStart);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

function at(dayStart: number, minutes: number): number {
  const d = new Date(dayStart);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minutes / 60), minutes % 60).getTime();
}

/** The [start, end) intervals of all windows that start on the given day. */
export function windowsStartingOn(dayStart: number, schedule: TimeWindow[]): Array<[number, number]> {
  const weekday = new Date(dayStart).getDay();
  const out: Array<[number, number]> = [];
  for (const w of schedule) {
    if (!w.days.includes(weekday as TimeWindow['days'][number])) continue;
    const s = parseTime(w.start);
    const e = parseTime(w.end);
    if (s === null || e === null) continue;
    const start = at(dayStart, s);
    const end = e > s ? at(dayStart, e) : at(addDays(dayStart, 1), e); // overnight / all day
    out.push([start, end === start ? start + DAY_MS : end]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** The window containing `t`, if any (checks windows that started yesterday too). */
export function activeWindowAt(schedule: TimeWindow[], t: number): [number, number] | null {
  const today = startOfDay(t);
  for (const day of [addDays(today, -1), today]) {
    for (const w of windowsStartingOn(day, schedule)) if (t >= w[0] && t < w[1]) return w;
  }
  return null;
}

/** The first window start strictly after `t` within the next 8 days, or null. */
export function nextWindowStart(schedule: TimeWindow[], t: number): number | null {
  const today = startOfDay(t);
  for (let i = 0; i <= 8; i++) {
    for (const [start] of windowsStartingOn(addDays(today, i), schedule)) if (start > t) return start;
  }
  return null;
}

/** `t` if it falls inside a window, otherwise the next window start. */
export function alignToSchedule(schedule: TimeWindow[], t: number): number | null {
  return activeWindowAt(schedule, t) ? t : nextWindowStart(schedule, t);
}

/** Active minutes left between `t` and the next local midnight. */
export function remainingActiveMinutesToday(schedule: TimeWindow[], t: number): number {
  const midnight = addDays(startOfDay(t), 1);
  const today = startOfDay(t);
  let ms = 0;
  for (const day of [addDays(today, -1), today]) {
    for (const [s, e] of windowsStartingOn(day, schedule)) {
      const from = Math.max(s, t);
      const to = Math.min(e, midnight);
      if (to > from) ms += to - from;
    }
  }
  return ms / MINUTE;
}

/**
 * Minutes until the next reminder, or 'goal-reached' when the daily goal is met
 * and the user asked to stop for the day.
 */
export function reminderInterval(r: ReminderSettings, glassesToday: number, t: number): number | 'goal-reached' {
  const goalMet = glassesToday >= r.dailyGoal;
  if (goalMet && r.stopWhenGoalReached) return 'goal-reached';
  if (r.mode === 'fixed' || goalMet) return r.intervalMinutes;
  const left = r.dailyGoal - glassesToday;
  const minutes = remainingActiveMinutesToday(r.schedule, t) / left;
  const [min, max] = GOAL_INTERVAL_BOUNDS;
  return Math.round(Math.min(max, Math.max(min, minutes)));
}

/** What just happened, which decides how far away the next reminder is. */
export type ScheduleTrigger = 'start' | 'settings' | 'drank' | 'skip' | 'later' | 'resume';

export interface NextReminderInput {
  settings: ReminderSettings;
  now: number;
  glassesToday: number;
  after: ScheduleTrigger;
}

export interface PlannedReminder {
  at: number;
  snoozed: boolean;
}

/**
 * The next `count` reminders, assuming no glass is logged in between. Used on
 * Android, where reminders are scheduled ahead of time as notifications; the
 * plan is redone whenever something happens (a glass, a snooze, a settings
 * change). While paused, the plan starts when the pause ends.
 */
export function planReminders(input: NextReminderInput & { count: number; pausedUntil?: number | null }): PlannedReminder[] {
  const paused = input.pausedUntil != null && input.pausedUntil > input.now;
  let now = paused ? input.pausedUntil! : input.now;
  let after: ScheduleTrigger = paused ? 'resume' : input.after;
  const today = startOfDay(input.now);
  const out: PlannedReminder[] = [];
  for (let i = 0; i < input.count; i++) {
    const glassesToday = startOfDay(now) > today ? 0 : input.glassesToday;
    const at = nextReminderTime({ settings: input.settings, now, glassesToday, after });
    if (at === null) break;
    out.push({ at, snoozed: after === 'later' });
    now = at;
    after = 'skip';
  }
  return out;
}

/** When the next reminder should fire, or null when reminders are off or nothing is scheduled. */
export function nextReminderTime({ settings, now, glassesToday, after }: NextReminderInput): number | null {
  if (!settings.enabled) return null;
  let candidate: number;
  if (after === 'later') {
    candidate = now + settings.snoozeMinutes * MINUTE;
  } else if (after === 'resume') {
    candidate = now + MINUTE; // welcome back: nudge soon after a pause ends
  } else {
    const interval = reminderInterval(settings, glassesToday, now);
    // Goal met for today: wait for tomorrow, when the count starts again.
    candidate = interval === 'goal-reached' ? addDays(startOfDay(now), 1) : now + interval * MINUTE;
  }
  return alignToSchedule(settings.schedule, candidate);
}
