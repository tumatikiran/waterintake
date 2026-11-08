/**
 * Pure scheduling logic (no timers, no Electron), so it can be unit-tested.
 * All times are epoch milliseconds interpreted in the machine's local time zone.
 */
import type { TimeWindow, WaterReminder } from './types';

/** What interval scheduling needs from a reminder (water's settings). */
export type IntervalSchedule = Pick<WaterReminder, 'enabled' | 'mode' | 'intervalMinutes' | 'dailyGoal' | 'stopWhenGoalReached' | 'snoozeMinutes' | 'schedule'>;

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
export function reminderInterval(r: IntervalSchedule, doneToday: number, t: number): number | 'goal-reached' {
  const goalMet = doneToday >= r.dailyGoal;
  if (goalMet && r.stopWhenGoalReached) return 'goal-reached';
  if (r.mode === 'fixed' || goalMet) return r.intervalMinutes;
  const left = r.dailyGoal - doneToday;
  const minutes = remainingActiveMinutesToday(r.schedule, t) / left;
  const [min, max] = GOAL_INTERVAL_BOUNDS;
  return Math.round(Math.min(max, Math.max(min, minutes)));
}

/** What just happened, which decides how far away the next reminder is. */
/**
 * missed: shown but not answered. planned: planning further ahead, assuming
 * the one before passed without an answer (Android schedules ahead).
 */
export type ScheduleTrigger = 'start' | 'settings' | 'done' | 'skip' | 'later' | 'missed' | 'planned' | 'resume';

export interface NextReminderInput {
  reminder: IntervalSchedule;
  now: number;
  doneToday: number;
  after: ScheduleTrigger;
}

/** What a type's scheduling rule gets: the time, today's log, and what just happened. */
export interface NextInput {
  now: number;
  doneToday: number;
  /** When it was done today (medicine: which doses were taken). */
  doneTimes: number[];
  after: ScheduleTrigger;
}

export interface PlannedReminder {
  at: number;
  snoozed: boolean;
}

/** One reminder's next time, given what just happened (see shared/reminders.ts for each type's rule). */
export type NextTime = (input: NextInput) => number | null;

/**
 * The next `count` reminders, assuming no glass is logged in between. Used on
 * Android, where reminders are scheduled ahead of time as notifications; the
 * plan is redone whenever something happens (a glass, a snooze, a settings
 * change). While paused, the plan starts when the pause ends.
 */
export function planReminders(input: NextReminderInput & { count: number; pausedUntil?: number | null }): PlannedReminder[] {
  const next: NextTime = ({ now, doneToday, after }) => nextReminderTime({ reminder: input.reminder, now, doneToday, after });
  return planChain(next, { ...input, doneTimes: [] });
}

/** A reminder's next `count` times from `now` (after `after`), assuming nothing is done in between. */
export function planChain(
  next: NextTime,
  input: { now: number; doneToday: number; doneTimes: number[]; after: ScheduleTrigger; count: number; pausedUntil?: number | null },
): PlannedReminder[] {
  const paused = input.pausedUntil != null && input.pausedUntil > input.now;
  let now = paused ? input.pausedUntil! : input.now;
  let after: ScheduleTrigger = paused ? 'resume' : input.after;
  const today = startOfDay(input.now);
  const out: PlannedReminder[] = [];
  for (let i = 0; i < input.count; i++) {
    const newDay = startOfDay(now) > today;
    const at = next({ now, doneToday: newDay ? 0 : input.doneToday, doneTimes: newDay ? [] : input.doneTimes, after });
    if (at === null) break;
    out.push({ at, snoozed: after === 'later' || after === 'missed' });
    now = at;
    after = 'planned';
  }
  return out;
}

/**
 * Several reminders' plans merged into at most `count` notifications (Android
 * schedules a fixed number ahead). Each plan keeps its first `reserve[i]`
 * items, so a frequent reminder (water) can't crowd out a rarer one
 * (tomorrow's medicine); the rest of the room goes to the soonest.
 */
export function mergePlans<T extends PlannedReminder>(plans: T[][], count: number, reserve: number[] = []): T[] {
  const kept = new Set<T>();
  plans.forEach((plan, i) => plan.slice(0, reserve[i] ?? 0).forEach((p) => kept.add(p)));
  const reserved = [...kept].sort((a, b) => a.at - b.at).slice(0, count);
  const rest = plans
    .flat()
    .filter((p) => !kept.has(p))
    .sort((a, b) => a.at - b.at)
    .slice(0, count - reserved.length);
  return [...reserved, ...rest].sort((a, b) => a.at - b.at);
}

/** When the next water (interval) reminder should fire, or null when it's off or nothing is scheduled. */
export function nextReminderTime({ reminder, now, doneToday, after }: NextReminderInput): number | null {
  if (!reminder.enabled) return null;
  let candidate: number;
  // Not answered: come back after the snooze, as if "later" was picked.
  if (after === 'later' || after === 'missed') {
    candidate = now + reminder.snoozeMinutes * MINUTE;
  } else if (after === 'resume') {
    candidate = now + MINUTE; // welcome back: nudge soon after a pause ends
  } else {
    const interval = reminderInterval(reminder, doneToday, now);
    // Goal met for today: wait for tomorrow, when the count starts again.
    candidate = interval === 'goal-reached' ? addDays(startOfDay(now), 1) : now + interval * MINUTE;
  }
  return alignToSchedule(reminder.schedule, candidate);
}

// ------------------------------------------------------------------ medicine
/** A dose counts as taken if it was done up to this long before its time (or any time after, until the next dose). */
export const TAKEN_EARLY = 60 * MINUTE;

/** The dose times on the day starting at `dayStart`, earliest first (none on days it isn't taken). */
export function doseTimes(r: { times: string[]; days: number[] }, dayStart: number): number[] {
  if (!r.days.includes(new Date(dayStart).getDay())) return [];
  return r.times
    .map(parseTime)
    .filter((m): m is number => m !== null)
    .map((m) => at(dayStart, m))
    .sort((a, b) => a - b);
}

function taken(dose: number, nextDose: number | null, doneTimes: number[]): boolean {
  return doneTimes.some((t) => t >= dose - TAKEN_EARLY && (nextDose === null || t < nextDose - TAKEN_EARLY));
}

export interface DoseSchedule {
  enabled: boolean;
  times: string[];
  days: number[];
  snoozeMinutes: number;
  repeatEveryMinutes: number;
  repeatTimes: number;
}

/**
 * The next medicine reminder: the next dose not yet taken, or, while the
 * latest dose is due and untaken, a repeat ("remind again until taken"):
 * every repeatEveryMinutes, repeatTimes times. ✕ (skip) gives up on that
 * dose; "later" snoozes; opening the app with a dose overdue nudges soon.
 */
export function nextDoseTime(r: DoseSchedule, { now, doneTimes, after }: NextInput): number | null {
  if (!r.enabled || !r.times.length || !r.days.length) return null;
  if (after === 'later') return now + r.snoozeMinutes * MINUTE;
  const today = startOfDay(now);
  const candidates: number[] = [];
  const todays = doseTimes(r, today);
  const due = todays.filter((t) => t <= now).length - 1;
  if (due >= 0 && r.repeatTimes > 0 && after !== 'skip' && after !== 'done') {
    const dose = todays[due];
    if (!taken(dose, todays[due + 1] ?? null, doneTimes)) {
      const windowEnd = dose + r.repeatEveryMinutes * r.repeatTimes * MINUTE;
      if ((after === 'start' || after === 'resume') && now < windowEnd) candidates.push(now + MINUTE);
      for (let k = 1; k <= r.repeatTimes; k++) {
        const t = dose + k * r.repeatEveryMinutes * MINUTE;
        if (t > now) candidates.push(t);
      }
    }
  }
  for (let d = 0; d < 8; d++) {
    const times = doseTimes(r, addDays(today, d));
    times.forEach((t, i) => {
      if (t > now && !(d === 0 && taken(t, times[i + 1] ?? null, doneTimes))) candidates.push(t);
    });
  }
  return candidates.length ? Math.min(...candidates) : null;
}

/** One of today's doses, for the Today checklist. */
export interface DoseStatus {
  at: number;
  state: 'taken' | 'due' | 'missed' | 'upcoming';
  takenAt: number | null;
}

/**
 * Today's doses and what happened to each: taken (and when), due (its time
 * has come; still within the reminders or the first half hour), missed, or
 * upcoming.
 */
export function dosesToday(r: DoseSchedule, doneTimes: number[], now: number): DoseStatus[] {
  if (!r.enabled) return [];
  const times = doseTimes(r, startOfDay(now));
  return times.map((at, i) => {
    const nextDose = times[i + 1] ?? null;
    const takenAt = doneTimes.find((t) => t >= at - TAKEN_EARLY && (nextDose === null || t < nextDose - TAKEN_EARLY)) ?? null;
    if (takenAt !== null) return { at, state: 'taken', takenAt };
    if (at > now) return { at, state: 'upcoming', takenAt };
    let dueUntil = at + Math.max(r.repeatEveryMinutes * r.repeatTimes, 30) * MINUTE;
    if (nextDose !== null) dueUntil = Math.min(dueUntil, nextDose - TAKEN_EARLY);
    return { at, state: now < dueUntil ? 'due' : 'missed', takenAt };
  });
}

/** The dose "Took it" would count for: due, missed or coming up within the hour (null: nothing to take now). */
export function doseToTake(doses: DoseStatus[], now: number): DoseStatus | null {
  return doses.find((d) => d.state === 'due') ?? doses.find((d) => d.state === 'upcoming' && d.at - now <= TAKEN_EARLY) ?? doses.filter((d) => d.state === 'missed').pop() ?? null;
}
