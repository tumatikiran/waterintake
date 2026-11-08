import type { DeepPartial, ExitPath, GeneralSettings, RelaxSettings, Reminder, ReminderTypeId, Settings } from './types';
import { LIMITS as REMINDER_LIMITS, REMINDER_TYPES, WATER_ID, sanitizeReminder } from './reminders';
import { ALL_DAYS, bool, isObj } from './sanitize';

export { ALL_DAYS };

export const DEFAULT_SETTINGS: Settings = {
  version: 2,
  userName: '',
  reminders: [REMINDER_TYPES.water.create(WATER_ID)],
  general: { exitPath: 'across', exitGait: 'walk', pauseWhenAway: true, systemNotification: false },
  relax: { dozeAfterMinutes: 3, durationMinutes: 0 },
  characterId: 'default',
  openAtLogin: false,
};

export const LIMITS = {
  ...REMINDER_LIMITS,
  relaxMinutes: [0, 240],
  userName: 32,
} as const;

const exitPath = (v: unknown, d: ExitPath): ExitPath => (v === 'across' || v === 'back' ? v : d);

function sanitizeGeneral(v: unknown, legacy: Record<string, unknown>): GeneralSettings {
  const d = DEFAULT_SETTINGS.general;
  // Version 1 kept these with the (only) reminder; laterExit is older still (Drink Later only).
  const g = isObj(v) ? v : legacy;
  return {
    exitPath: exitPath(g.exitPath ?? g.laterExit, d.exitPath),
    exitGait: g.exitGait === 'walk' || g.exitGait === 'run' ? g.exitGait : d.exitGait,
    pauseWhenAway: bool(g.pauseWhenAway, d.pauseWhenAway),
    systemNotification: bool(g.systemNotification, d.systemNotification),
  };
}

/**
 * The reminder list: valid reminders with unique ids, and the built-in water
 * reminder always present (first). Version 1 had one water reminder as an object.
 */
function sanitizeReminders(v: unknown): Reminder[] {
  const raw: unknown[] = Array.isArray(v) ? v : isObj(v) ? [{ ...v, id: WATER_ID, type: 'water' }] : [];
  const seen = new Set<string>();
  const out: Reminder[] = [];
  raw.forEach((item, i) => {
    const r = sanitizeReminder(item, `r${i + 1}`);
    if (!r || seen.has(r.id) || out.length >= LIMITS.reminders) return;
    seen.add(r.id);
    out.push(r);
  });
  const water = out.find((r) => r.id === WATER_ID) ?? REMINDER_TYPES.water.create(WATER_ID);
  return [water, ...out.filter((r) => r.id !== WATER_ID)];
}

function sanitizeRelax(v: unknown): RelaxSettings {
  const d = DEFAULT_SETTINGS.relax;
  const r = isObj(v) ? v : {};
  // Not rounded: fractions of a minute are fine (and handy for tests).
  const minutes = (x: unknown, fallback: number) =>
    typeof x === 'number' && Number.isFinite(x) ? Math.min(LIMITS.relaxMinutes[1], Math.max(LIMITS.relaxMinutes[0], x)) : fallback;
  return { dozeAfterMinutes: minutes(r.dozeAfterMinutes, d.dozeAfterMinutes), durationMinutes: minutes(r.durationMinutes, d.durationMinutes) };
}

/** Turns anything (an older or hand-edited settings file) into valid Settings. */
export function sanitizeSettings(v: unknown): Settings {
  const s = isObj(v) ? v : {};
  const legacy = isObj(s.reminders) ? s.reminders : {};
  return {
    version: 2,
    userName: typeof s.userName === 'string' ? s.userName.trim().slice(0, LIMITS.userName) : '',
    reminders: sanitizeReminders(s.reminders),
    general: sanitizeGeneral(s.general, legacy),
    relax: sanitizeRelax(s.relax),
    characterId:
      typeof s.characterId === 'string' && /^[\w-]{1,64}$/.test(s.characterId) ? s.characterId : DEFAULT_SETTINGS.characterId,
    openAtLogin: bool(s.openAtLogin, DEFAULT_SETTINGS.openAtLogin),
  };
}

/** A settings update from the UI. The reminder list isn't patched this way: see withReminderPatch. */
export type SettingsPatch = DeepPartial<Omit<Settings, 'reminders' | 'version'>>;

/** Applies a partial update (as sent by the settings UI) and re-validates. */
export function mergeSettings(current: Settings, patch: SettingsPatch): Settings {
  const p = isObj(patch) ? (patch as Record<string, unknown>) : {};
  const general = isObj(p.general) ? { ...current.general, ...p.general } : current.general;
  const relax = isObj(p.relax) ? { ...current.relax, ...p.relax } : current.relax;
  return sanitizeSettings({ ...current, ...p, reminders: current.reminders, general, relax });
}

/** Changes one reminder (its id and type stay); unknown ids change nothing. */
export function withReminderPatch(current: Settings, id: string, patch: Record<string, unknown>): Settings {
  if (!isObj(patch) || !current.reminders.some((r) => r.id === id)) return current;
  const reminders = current.reminders.map((r) => (r.id === id ? { ...r, ...patch, id: r.id, type: r.type } : r));
  return sanitizeSettings({ ...current, reminders });
}

/** Adds a new reminder of a type (singleton types can't be added twice). Returns the settings unchanged when it can't. */
export function withReminderAdded(current: Settings, type: ReminderTypeId, id: string): Settings {
  const def = REMINDER_TYPES[type];
  if (!def || def.singleton || current.reminders.length >= LIMITS.reminders || current.reminders.some((r) => r.id === id)) return current;
  return sanitizeSettings({ ...current, reminders: [...current.reminders, def.create(id)] });
}

/** Removes a reminder (the built-in water reminder can only be turned off). */
export function withReminderRemoved(current: Settings, id: string): Settings {
  const r = current.reminders.find((x) => x.id === id);
  if (!r || REMINDER_TYPES[r.type].singleton) return current;
  return { ...current, reminders: current.reminders.filter((x) => x.id !== id) };
}
