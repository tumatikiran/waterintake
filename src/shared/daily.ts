/** Today's glass count (no history): it resets at local midnight. Shared by desktop and Android. */

export interface DailyData {
  date: string; // local YYYY-MM-DD
  glasses: number;
  reminders: number; // reminders shown today
}

export function localDate(t = Date.now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function sanitizeDaily(v: unknown): DailyData {
  const r = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < 1000 ? x : 0);
  return { date: typeof r.date === 'string' ? r.date : '', glasses: n(r.glasses), reminders: n(r.reminders) };
}

/** The record for the day containing `now` (a fresh one after midnight). */
export function dayOf(data: DailyData, now = Date.now()): DailyData {
  const date = localDate(now);
  return data.date === date ? data : { date, glasses: 0, reminders: 0 };
}

export function withGlass(data: DailyData, now = Date.now()): DailyData {
  const d = dayOf(data, now);
  return { ...d, glasses: d.glasses + 1 };
}

export function withReminderShown(data: DailyData, now = Date.now()): DailyData {
  const d = dayOf(data, now);
  return { ...d, reminders: d.reminders + 1 };
}
