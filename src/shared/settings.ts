import type { DeepPartial, ExitPath, RelaxSettings, ReminderSettings, Settings, TimeWindow, Weekday } from './types';
import { parseTime } from './schedule';

export const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  userName: '',
  reminders: {
    enabled: true,
    mode: 'fixed',
    intervalMinutes: 45,
    dailyGoal: 8,
    stopWhenGoalReached: false,
    snoozeMinutes: 15,
    exitPath: 'across',
    exitGait: 'walk',
    schedule: [{ days: [...ALL_DAYS], start: '09:00', end: '21:00' }],
    pauseWhenAway: true,
    systemNotification: false,
  },
  relax: { dozeAfterMinutes: 3, durationMinutes: 0 },
  characterId: 'default',
  openAtLogin: false,
};

export const LIMITS = {
  intervalMinutes: [5, 240],
  dailyGoal: [1, 30],
  snoozeMinutes: [1, 120],
  relaxMinutes: [0, 240],
  userName: 32,
  scheduleWindows: 8,
} as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const exitPath = (v: unknown, d: ExitPath): ExitPath => (v === 'across' || v === 'back' ? v : d);
const int = (v: unknown, [min, max]: readonly [number, number], d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d;

function sanitizeWindow(v: unknown): TimeWindow | null {
  if (!isObj(v)) return null;
  const start = typeof v.start === 'string' && parseTime(v.start) !== null ? v.start : null;
  const end = typeof v.end === 'string' && parseTime(v.end) !== null ? v.end : null;
  if (!start || !end || !Array.isArray(v.days)) return null;
  const days = [...new Set(v.days.filter((d): d is Weekday => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  return { days, start, end };
}

function sanitizeReminders(v: unknown): ReminderSettings {
  const d = DEFAULT_SETTINGS.reminders;
  const r = isObj(v) ? v : {};
  const schedule = Array.isArray(r.schedule)
    ? r.schedule.map(sanitizeWindow).filter((w): w is TimeWindow => w !== null).slice(0, LIMITS.scheduleWindows)
    : [];
  return {
    enabled: bool(r.enabled, d.enabled),
    mode: r.mode === 'goal' || r.mode === 'fixed' ? r.mode : d.mode,
    intervalMinutes: int(r.intervalMinutes, LIMITS.intervalMinutes, d.intervalMinutes),
    dailyGoal: int(r.dailyGoal, LIMITS.dailyGoal, d.dailyGoal),
    stopWhenGoalReached: bool(r.stopWhenGoalReached, d.stopWhenGoalReached),
    snoozeMinutes: int(r.snoozeMinutes, LIMITS.snoozeMinutes, d.snoozeMinutes),
    // laterExit: the Drink Later-only setting this replaced; keep the user's choice.
    exitPath: exitPath(r.exitPath ?? r.laterExit, d.exitPath),
    exitGait: r.exitGait === 'walk' || r.exitGait === 'run' ? r.exitGait : d.exitGait,
    // An empty schedule would silently mean "never remind", so fall back to the default.
    schedule: schedule.length ? schedule : d.schedule.map((w) => ({ ...w, days: [...w.days] })),
    pauseWhenAway: bool(r.pauseWhenAway, d.pauseWhenAway),
    systemNotification: bool(r.systemNotification, d.systemNotification),
  };
}

function sanitizeRelax(v: unknown): RelaxSettings {
  const d = DEFAULT_SETTINGS.relax;
  const r = isObj(v) ? v : {};
  // Not rounded: fractions of a minute are fine (and handy for tests).
  const minutes = (x: unknown, fallback: number) =>
    typeof x === 'number' && Number.isFinite(x) ? Math.min(LIMITS.relaxMinutes[1], Math.max(LIMITS.relaxMinutes[0], x)) : fallback;
  return { dozeAfterMinutes: minutes(r.dozeAfterMinutes, d.dozeAfterMinutes), durationMinutes: minutes(r.durationMinutes, d.durationMinutes) };
}

/** Turns anything (an old or hand-edited settings file) into valid Settings. */
export function sanitizeSettings(v: unknown): Settings {
  const s = isObj(v) ? v : {};
  return {
    version: 1,
    userName: typeof s.userName === 'string' ? s.userName.trim().slice(0, LIMITS.userName) : '',
    reminders: sanitizeReminders(s.reminders),
    relax: sanitizeRelax(s.relax),
    characterId:
      typeof s.characterId === 'string' && /^[\w-]{1,64}$/.test(s.characterId) ? s.characterId : DEFAULT_SETTINGS.characterId,
    openAtLogin: bool(s.openAtLogin, DEFAULT_SETTINGS.openAtLogin),
  };
}

/** Applies a partial update (as sent by the settings UI) and re-validates. */
export function mergeSettings(current: Settings, patch: DeepPartial<Settings>): Settings {
  const p = isObj(patch) ? (patch as Record<string, unknown>) : {};
  const reminders = isObj(p.reminders) ? { ...current.reminders, ...p.reminders } : current.reminders;
  const relax = isObj(p.relax) ? { ...current.relax, ...p.relax } : current.relax;
  return sanitizeSettings({ ...current, ...p, reminders, relax });
}
