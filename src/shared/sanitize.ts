/** Small validators for data read from disk or sent by the UI. */
import type { TimeWindow, Weekday } from './types';
import { parseTime } from './schedule';

export const ALL_DAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
export const int = (v: unknown, [min, max]: readonly [number, number], d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d;
export const text = (v: unknown, max: number, d: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : d);

export function sanitizeWindow(v: unknown): TimeWindow | null {
  if (!isObj(v)) return null;
  const start = typeof v.start === 'string' && parseTime(v.start) !== null ? v.start : null;
  const end = typeof v.end === 'string' && parseTime(v.end) !== null ? v.end : null;
  if (!start || !end || !Array.isArray(v.days)) return null;
  const days = [...new Set(v.days.filter((d): d is Weekday => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  return { days, start, end };
}
