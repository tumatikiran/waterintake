/**
 * Reminder types: everything that differs between, say, a water reminder and
 * a medicine reminder lives here, once. The scheduler, the companion's state
 * machine, the overlay and Android's notifications are generic and ask the
 * type. To add a type: add its id to ReminderTypeId (types.ts), describe it
 * below, and give it card wording (renderer/behavior/messages.ts) and, if
 * the companion carries something, a prop (renderer/character/props.ts).
 */
import type { Progress, Reminder, ReminderTypeId, TimeWindow, WaterReminder } from './types';
import { nextReminderTime, type NextTime, type ScheduleTrigger } from './schedule';
import { ALL_DAYS, bool, int, isObj, sanitizeWindow, text } from './sanitize';

/** Things the companion can carry in to show what a reminder is for. */
export type PropName = 'waterBottle';

/** Scripts that play an answer (renderer/behavior/interactions.ts). */
export type AnswerScript = 'drank' | 'later' | 'skip' | 'timeout';

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
  next(r: R, input: Parameters<NextTime>[0]): number | null;
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
  progress: (r, doneToday) => ({ done: doneToday, goal: r.dailyGoal }),
  prop: 'waterBottle',
  doneScript: 'drank',
  duringRelax: 'wait',
  priority: 1,
  labels: { done: 'I Drank Water', later: 'Drink Later', notifyDone: 'I drank water', notifyLater: 'Drink later' },
  notification: (_r, { userName, snoozed }) => {
    const name = userName ? ` ${userName}` : '';
    return {
      title: 'AquaMate',
      body: snoozed ? `Ready now${name ? `,${name}` : ''}? Time to drink some water 💧` : `Hey${name}! Time to drink some water 💧`,
    };
  },
};

export const REMINDER_TYPES: { [K in ReminderTypeId]: ReminderTypeDef<Extract<Reminder, { type: K }>> } = { water };

/** The id of the built-in water reminder (it always exists). */
export const WATER_ID = 'water';

export function typeOf(r: Reminder): ReminderTypeDef {
  return REMINDER_TYPES[r.type] as unknown as ReminderTypeDef;
}

/** When a reminder fires next (null: off or nothing scheduled). */
export function nextTime(r: Reminder, input: { now: number; doneToday: number; after: ScheduleTrigger }): number | null {
  return typeOf(r).next(r, input);
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
