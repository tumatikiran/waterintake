/**
 * Reminder types: everything that differs between, say, a water reminder and
 * a medicine reminder lives here, once. The scheduler, the companion's state
 * machine, the overlay and Android's notifications are generic and ask the
 * type. To add a type: add its id to ReminderTypeId (types.ts), describe it
 * below, and give it card wording (renderer/behavior/messages.ts) and, if
 * the companion carries something, a prop (renderer/character/props.ts).
 */
import type {
  CustomReminder,
  EyeRestReminder,
  IntervalFields,
  MedicineReminder,
  MovementReminder,
  Progress,
  Reminder,
  ReminderTypeId,
  TimeWindow,
  TimesFields,
  TodoReminder,
  WaterReminder,
  Weekday,
} from './types';
import { nextDoseTime, nextReminderTime, parseTime, type NextInput } from './schedule';
import { ALL_DAYS, bool, int, isObj, sanitizeWindow, text } from './sanitize';

/** Things the companion can carry in to show what a reminder is for. A sign shows a label (see `sign`). */
export type PropName = 'waterBottle' | 'pillBottle' | 'dumbbell' | 'sign';

/** What a sign says. */
export interface SignLabel {
  emoji: string;
  text: string;
}

/** Scripts that play an answer (renderer/behavior/interactions.ts). */
export type AnswerScript = 'drank' | 'tookMedicine' | 'restedEyes' | 'stretched' | 'didIt' | 'later' | 'skip' | 'timeout';

export interface ReminderTypeDef<R extends Reminder = Reminder> {
  id: ReminderTypeId;
  label: string;
  icon: string;
  /** Always there: it can be turned off, not deleted (water). */
  builtin: boolean;
  /** At most one (its id is the type's id). */
  singleton: boolean;
  /** One line for the "Add" menu. */
  blurb: string;
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
  /** What a sign prop says. */
  sign?(r: R): SignLabel;
  /** The script for "done" (drinking for water). */
  doneScript: AnswerScript;
  /** While Relax mode is on: wait until it ends, or wake the companion (fixed times can't wait). */
  duringRelax(r: R): 'wait' | 'wake';
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
  emoji: 8,
} as const;

const DEFAULT_WINDOW: TimeWindow = { days: [...ALL_DAYS], start: '09:00', end: '21:00' };

// Shared field groups, for the types that use them.
const intervalDefaults = (intervalMinutes: number): IntervalFields => ({ intervalMinutes, schedule: [{ ...DEFAULT_WINDOW, days: [...DEFAULT_WINDOW.days] }] });
function sanitizeInterval(r: Record<string, unknown>, d: IntervalFields): IntervalFields {
  const schedule = Array.isArray(r.schedule)
    ? r.schedule.map(sanitizeWindow).filter((w): w is TimeWindow => w !== null).slice(0, LIMITS.scheduleWindows)
    : [];
  return { intervalMinutes: int(r.intervalMinutes, LIMITS.intervalMinutes, d.intervalMinutes), schedule: schedule.length ? schedule : d.schedule };
}
const timesDefaults = (times: string[], repeatTimes: number): TimesFields => ({ times, days: [...ALL_DAYS], repeatEveryMinutes: 10, repeatTimes });
function sanitizeTimes(r: Record<string, unknown>, d: TimesFields): TimesFields {
  const times = Array.isArray(r.times)
    ? [...new Set(r.times.filter((t): t is string => typeof t === 'string' && parseTime(t) !== null))].sort().slice(0, LIMITS.doseTimes)
    : [];
  const days = Array.isArray(r.days) ? [...new Set(r.days.filter((x): x is Weekday => Number.isInteger(x) && x >= 0 && x <= 6))].sort() : d.days;
  return {
    times: times.length ? times : d.times,
    days,
    repeatEveryMinutes: int(r.repeatEveryMinutes, LIMITS.repeatEveryMinutes, d.repeatEveryMinutes),
    repeatTimes: int(r.repeatTimes, LIMITS.repeatTimes, d.repeatTimes),
  };
}
/** "Every N minutes inside active hours", for types without a daily goal. */
const intervalNext = (r: Reminder & IntervalFields, input: NextInput) =>
  nextReminderTime({ reminder: { ...r, mode: 'fixed', dailyGoal: LIMITS.dailyGoal[1], stopWhenGoalReached: false }, ...input });
const common = (r: Record<string, unknown>, d: Reminder) => ({
  name: text(r.name, LIMITS.name, d.name),
  enabled: bool(r.enabled, d.enabled),
  snoozeMinutes: int(r.snoozeMinutes, LIMITS.snoozeMinutes, d.snoozeMinutes),
});
const later = (verb = 'Later') => ({ later: verb, notifyLater: 'Later' });

const water: ReminderTypeDef<WaterReminder> = {
  id: 'water',
  label: 'Water',
  icon: '💧',
  builtin: true,
  singleton: true,
  blurb: 'Drink water through the day',
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
  duringRelax: () => 'wait',
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
  builtin: false,
  singleton: false,
  blurb: 'Tablets or medicine at set times',
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
    return {
      id,
      type: 'medicine',
      ...common(r, d),
      dose: typeof r.dose === 'string' ? r.dose.trim().slice(0, LIMITS.dose) : d.dose,
      notes: typeof r.notes === 'string' ? r.notes.trim().slice(0, LIMITS.notes) : d.notes,
      ...sanitizeTimes(r, d),
    };
  },
  next: (r, input) => nextDoseTime(r, input),
  describe: (r) => [r.dose, r.notes].filter(Boolean).join(' · ') || null,
  progress: () => null,
  prop: 'pillBottle',
  doneScript: 'tookMedicine',
  duringRelax: () => 'wake', // medicine can't wait: it wakes a relaxing companion
  priority: 10, // and goes first when water is due too
  planReserve: 4, // the next dose and its repeats
  labels: { done: 'I Took It', later: 'Remind Me Later', notifyDone: 'I took it', notifyLater: 'Later' },
  notification: (r, { snoozed }) => {
    const what = `${r.name}${r.dose ? ` (${r.dose})` : ''}`;
    return { title: 'AquaMate 💊', body: snoozed ? `Reminder: time for your ${what} 💊` : `Time for your ${what} 💊` };
  },
};

const eyeRest: ReminderTypeDef<EyeRestReminder> = {
  id: 'eyeRest',
  label: 'Eye rest',
  icon: '👀',
  builtin: false,
  singleton: true,
  blurb: 'Look away from the screen (the 20-20-20 rule)',
  create: (id) => ({ id, type: 'eyeRest', name: 'Rest your eyes', enabled: true, snoozeMinutes: 5, ...intervalDefaults(20) }),
  sanitize(r, id) {
    const d = eyeRest.create(id);
    return { id, type: 'eyeRest', ...common(r, d), ...sanitizeInterval(r, d) };
  },
  next: intervalNext,
  describe: () => 'Look at something far away for 20 seconds',
  progress: () => null,
  prop: 'sign',
  sign: () => ({ emoji: '👀', text: 'Rest your eyes' }),
  doneScript: 'restedEyes',
  duringRelax: () => 'wait', // relaxing already rests the eyes
  priority: 2,
  planReserve: 1,
  labels: { done: 'I Rested My Eyes', notifyDone: 'Done', ...later() },
  notification: () => ({ title: 'AquaMate 👀', body: 'Time to rest your eyes: look at something far away for 20 seconds.' }),
};

const movement: ReminderTypeDef<MovementReminder> = {
  id: 'movement',
  label: 'Movement',
  icon: '🙆',
  builtin: false,
  singleton: true,
  blurb: 'Stand up, stretch and move',
  create: (id) => ({ id, type: 'movement', name: 'Stretch and move', enabled: true, snoozeMinutes: 10, ...intervalDefaults(60) }),
  sanitize(r, id) {
    const d = movement.create(id);
    return { id, type: 'movement', ...common(r, d), ...sanitizeInterval(r, d) };
  },
  next: intervalNext,
  describe: () => null,
  progress: () => null,
  prop: 'dumbbell',
  doneScript: 'stretched',
  duringRelax: () => 'wait',
  priority: 3,
  planReserve: 1,
  labels: { done: 'I Stretched', notifyDone: 'Done', ...later() },
  notification: () => ({ title: 'AquaMate 🙆', body: 'Time to stand up, stretch and move a little.' }),
};

const todo: ReminderTypeDef<TodoReminder> = {
  id: 'todo',
  label: 'To-do',
  icon: '✅',
  builtin: false,
  singleton: false,
  blurb: 'A daily activity or task at set times',
  create: (id) => ({ id, type: 'todo', name: 'My to-do', enabled: true, snoozeMinutes: 10, notes: '', ...timesDefaults(['18:00'], 0) }),
  sanitize(r, id) {
    const d = todo.create(id);
    return { id, type: 'todo', ...common(r, d), notes: typeof r.notes === 'string' ? r.notes.trim().slice(0, LIMITS.notes) : d.notes, ...sanitizeTimes(r, d) };
  },
  next: (r, input) => nextDoseTime(r, input),
  describe: (r) => r.notes || null,
  progress: () => null,
  prop: 'sign',
  sign: (r) => ({ emoji: '✅', text: r.name }),
  doneScript: 'didIt',
  duringRelax: () => 'wake', // set times can't wait
  priority: 5,
  planReserve: 2,
  labels: { done: 'Done', notifyDone: 'Done', ...later() },
  notification: (r, { snoozed }) => ({ title: 'AquaMate ✅', body: `${snoozed ? 'Reminder: ' : 'Time to: '}${r.name}` }),
};

const custom: ReminderTypeDef<CustomReminder> = {
  id: 'custom',
  label: 'Custom',
  icon: '⭐',
  builtin: false,
  singleton: false,
  blurb: 'Your own emoji and title, on your schedule',
  create: (id) => ({
    id,
    type: 'custom',
    name: 'My reminder',
    enabled: true,
    snoozeMinutes: 10,
    emoji: '⭐',
    scheduleKind: 'interval',
    ...intervalDefaults(60),
    ...timesDefaults(['12:00'], 0),
  }),
  sanitize(r, id) {
    const d = custom.create(id);
    const emoji = typeof r.emoji === 'string' && r.emoji.trim() ? [...r.emoji.trim()].slice(0, 2).join('').slice(0, LIMITS.emoji) : d.emoji;
    return {
      id,
      type: 'custom',
      ...common(r, d),
      emoji,
      scheduleKind: r.scheduleKind === 'times' || r.scheduleKind === 'interval' ? r.scheduleKind : d.scheduleKind,
      ...sanitizeInterval(r, d),
      ...sanitizeTimes(r, d),
    };
  },
  next: (r, input) => (r.scheduleKind === 'times' ? nextDoseTime(r, input) : intervalNext(r, input)),
  describe: () => null,
  progress: () => null,
  prop: 'sign',
  sign: (r) => ({ emoji: r.emoji, text: r.name }),
  doneScript: 'didIt',
  duringRelax: (r) => (r.scheduleKind === 'times' ? 'wake' : 'wait'),
  priority: 4,
  planReserve: 2,
  labels: { done: 'Done', notifyDone: 'Done', ...later() },
  notification: (r) => ({ title: `AquaMate ${r.emoji}`, body: r.name }),
};

export const REMINDER_TYPES: { [K in ReminderTypeId]: ReminderTypeDef<Extract<Reminder, { type: K }>> } = {
  water,
  medicine,
  eyeRest,
  movement,
  todo,
  custom,
};

/** Types that come at set times (shown on the Today checklist). */
export function isTimed(r: Reminder): r is Extract<Reminder, TimesFields> {
  return r.type === 'medicine' || r.type === 'todo' || (r.type === 'custom' && r.scheduleKind === 'times');
}

/** Whether a reminder waits for Relax mode to end (rather than waking the companion). */
export function waitsDuringRelax(r: Reminder): boolean {
  return typeOf(r).duringRelax(r) === 'wait';
}

/** What a sign prop says for this reminder (null: it carries no sign). */
export function signFor(r: Reminder): SignLabel | null {
  const def = typeOf(r);
  return def.prop === 'sign' && def.sign ? def.sign(r) : null;
}

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

/** What the overlay needs to know about a reminder (ReminderContext.reminder). */
export function sceneReminder(r: Reminder): { id: string; type: ReminderTypeId; name: string; detail?: string; emoji: string; sign?: SignLabel } {
  const def = typeOf(r);
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    detail: def.describe(r) ?? undefined,
    emoji: r.type === 'custom' ? r.emoji : def.icon,
    sign: signFor(r) ?? undefined,
  };
}
