/**
 * Reminder types: everything that differs between, say, a water reminder and
 * a medicine reminder lives here, once. The scheduler, the companion's state
 * machine, the overlay and Android's notifications are generic and ask the
 * type. To add a type: add its id to ReminderTypeId (types.ts), describe it
 * below, and give it card wording (renderer/behavior/messages.ts) and, if
 * the companion carries something, a prop (renderer/character/props.ts).
 */
import type { MedicineReminder, Progress, Reminder, ReminderTypeId, TimeWindow, WaterReminder, Weekday } from './types';
import { nextDoseTime, nextReminderTime, parseTime, type NextInput } from './schedule';
import { ALL_DAYS, bool, int, isObj, sanitizeWindow, text } from './sanitize';

/** Things the companion can carry in to show what a reminder is for (and 'tablet', which only appears while taking it). */
export type PropName = 'waterBottle' | 'pillBottle';

/** Scripts that play an answer (renderer/behavior/interactions.ts). */
export type AnswerScript = 'drank' | 'tookMedicine' | 'later' | 'skip' | 'timeout';

export interface ReminderTypeDef<R extends Reminder = Reminder> {
  id: ReminderTypeId;
  label: string;
  icon: string;
  /** Exactly one, always there (it can be turned off, not deleted). */
  singleton: boolean;
  create(id: string): R;
  /** Turns stored or edited data into a valid reminder of this type. */
  sanitize(raw: Record<string, unknown>, id: string): R;
  /** When it fires next after `after` (null: not scheduled). */
  next(r: R, input: NextInput): number | null;
  /** A short line for the card, like "1 tablet · with food" (null: nothing to add). */
  describe(r: R): string | null;
  /** Today's progress towards a goal, if it has one. */
  progress(r: R, doneToday: number): Progress | null;
  /** What the companion carries in. */
  prop: PropName | null;
  /** The script for "done" (drinking for water). */
  doneScript: AnswerScript;
  /** While Relax mode is on: wait until it ends, or wake the companion. */
  duringRelax: 'wait' | 'wake';
  /** Which goes first when several are due (higher first). */
  priority: number;
  /** Android: how many upcoming notifications it always keeps, however many others there are. */
  planReserve: number;
  /** Button and notification wording. */
  labels: { done: string; later: string; notifyDone: string; notifyLater: string };
  notification(r: R, ctx: { userName: string; snoozed: boolean }): { title: string; body: string };
}

export const LIMITS = {
  intervalMinutes: [5, 240],
  dailyGoal: [1, 30],
  snoozeMinutes: [1, 120],
  scheduleWindows: 6,
  name: 40,
  reminders: 20,
  dose: 40,
  notes: 80,
  doseTimes: 6,
  repeatEveryMinutes: [5, 60],
  repeatTimes: [0, 6],
} as const;

const DEFAULT_WINDOW: TimeWindow = { days: [...ALL_DAYS], start: '09:00', end: '21:00' };

const water: ReminderTypeDef<WaterReminder> = {
  id: 'water',
  label: 'Water',
  icon: '💧',
  singleton: true,
  create: (id) => ({
    id,
    type: 'water',
    name: 'Drink water',
    enabled: true,
    mode: 'fixed',
    intervalMinutes: 45,
    dailyGoal: 8,
    stopWhenGoalReached: false,
    snoozeMinutes: 15,
    schedule: [{ ...DEFAULT_WINDOW, days: [...DEFAULT_WINDOW.days] }],
  }),
  sanitize(r, id) {
    const d = water.create(id);
    const schedule = Array.isArray(r.schedule)
      ? r.schedule.map(sanitizeWindow).filter((w): w is TimeWindow => w !== null).slice(0, LIMITS.scheduleWindows)
      : [];
    return {
      id,
      type: 'water',
      name: text(r.name, LIMITS.name, d.name),
      enabled: bool(r.enabled, d.enabled),
      mode: r.mode === 'goal' || r.mode === 'fixed' ? r.mode : d.mode,
      intervalMinutes: int(r.intervalMinutes, LIMITS.intervalMinutes, d.intervalMinutes),
      dailyGoal: int(r.dailyGoal, LIMITS.dailyGoal, d.dailyGoal),
      stopWhenGoalReached: bool(r.stopWhenGoalReached, d.stopWhenGoalReached),
      snoozeMinutes: int(r.snoozeMinutes, LIMITS.snoozeMinutes, d.snoozeMinutes),
      // An empty schedule would silently mean "never remind", so fall back to the default.
      schedule: schedule.length ? schedule : d.schedule,
    };
  },
  next: (r, input) => nextReminderTime({ reminder: r, ...input }),
  describe: () => null,
  progress: (r, doneToday) => ({ done: doneToday, goal: r.dailyGoal }),
  prop: 'waterBottle',
  doneScript: 'drank',
  duringRelax: 'wait',
  priority: 1,
  planReserve: 2,
  labels: { done: 'I Drank Water', later: 'Drink Later', notifyDone: 'I drank water', notifyLater: 'Drink later' },
  notification: (_r, { userName, snoozed }) => {
    const name = userName ? ` ${userName}` : '';
    return {
      title: 'AquaMate',
      body: snoozed ? `Ready now${name ? `,${name}` : ''}? Time to drink some water 💧` : `Hey${name}! Time to drink some water 💧`,
    };
  },
};

const medicine: ReminderTypeDef<MedicineReminder> = {
  id: 'medicine',
  label: 'Medicine',
  icon: '💊',
  singleton: false,
  create: (id) => ({
    id,
    type: 'medicine',
    name: 'Medicine',
    enabled: true,
    dose: '1 tablet',
    notes: '',
    times: ['12:00'],
    days: [...ALL_DAYS],
    snoozeMinutes: 10,
    repeatEveryMinutes: 10,
    repeatTimes: 3, // remind again until taken: on by default
  }),
  sanitize(r, id) {
    const d = medicine.create(id);
    const times = Array.isArray(r.times)
      ? [...new Set(r.times.filter((t): t is string => typeof t === 'string' && parseTime(t) !== null))].sort().slice(0, LIMITS.doseTimes)
      : [];
    const days = Array.isArray(r.days)
      ? [...new Set(r.days.filter((x): x is Weekday => Number.isInteger(x) && x >= 0 && x <= 6))].sort()
      : d.days;
    return {
      id,
      type: 'medicine',
      name: text(r.name, LIMITS.name, d.name),
      enabled: bool(r.enabled, d.enabled),
      dose: typeof r.dose === 'string' ? r.dose.trim().slice(0, LIMITS.dose) : d.dose,
      notes: typeof r.notes === 'string' ? r.notes.trim().slice(0, LIMITS.notes) : d.notes,
      times: times.length ? times : d.times,
      days,
      snoozeMinutes: int(r.snoozeMinutes, LIMITS.snoozeMinutes, d.snoozeMinutes),
      repeatEveryMinutes: int(r.repeatEveryMinutes, LIMITS.repeatEveryMinutes, d.repeatEveryMinutes),
      repeatTimes: int(r.repeatTimes, LIMITS.repeatTimes, d.repeatTimes),
    };
  },
  next: (r, input) => nextDoseTime(r, input),
  describe: (r) => [r.dose, r.notes].filter(Boolean).join(' · ') || null,
  progress: () => null,
  prop: 'pillBottle',
  doneScript: 'tookMedicine',
  duringRelax: 'wake', // medicine can't wait: it wakes a relaxing companion
  priority: 10, // and goes first when water is due too
  planReserve: 4, // the next dose and its repeats
  labels: { done: 'I Took It', later: 'Remind Me Later', notifyDone: 'I took it', notifyLater: 'Later' },
  notification: (r, { snoozed }) => {
    const what = `${r.name}${r.dose ? ` (${r.dose})` : ''}`;
    return { title: 'AquaMate 💊', body: snoozed ? `Reminder: time for your ${what} 💊` : `Time for your ${what} 💊` };
  },
};

export const REMINDER_TYPES: { [K in ReminderTypeId]: ReminderTypeDef<Extract<Reminder, { type: K }>> } = { water, medicine };

/** The id of the built-in water reminder (it always exists). */
export const WATER_ID = 'water';

export function typeOf(r: Reminder): ReminderTypeDef {
  return REMINDER_TYPES[r.type] as unknown as ReminderTypeDef;
}

/** When a reminder fires next (null: off or nothing scheduled). */
export function nextTime(r: Reminder, input: NextInput): number | null {
  return typeOf(r).next(r, input);
}

/** A new reminder's id. */
export function newReminderId(type: ReminderTypeId): string {
  return `${type.slice(0, 3)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function sanitizeReminder(v: unknown, fallbackId: string): Reminder | null {
  if (!isObj(v)) return null;
  const def = typeof v.type === 'string' && (REMINDER_TYPES as Record<string, ReminderTypeDef>)[v.type];
  if (!def) return null;
  const id = typeof v.id === 'string' && /^[\w-]{1,40}$/.test(v.id) ? v.id : fallbackId;
  return def.sanitize(v, def.singleton ? def.id : id);
}

/** The built-in water reminder. */
export function waterReminder(reminders: Reminder[]): WaterReminder {
  return (reminders.find((r) => r.id === WATER_ID && r.type === 'water') as WaterReminder | undefined) ?? water.create(WATER_ID);
}
