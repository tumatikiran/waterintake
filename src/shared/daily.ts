/**
 * Today's log, per reminder: how often it was done and shown, and when it was
 * done (medicine shows "taken 12:04"). No history: it resets at local
 * midnight. Shared by desktop and Android.
 */
import { WATER_ID } from './reminders';

export interface DayEntry {
  done: number; // glasses drunk, doses taken…
  shown: number; // reminders shown
  times: number[]; // when it was done
}

export interface DailyData {
  date: string; // local YYYY-MM-DD
  entries: Record<string, DayEntry>;
}

const MAX_TIMES = 50;
const EMPTY: DayEntry = { done: 0, shown: 0, times: [] };

export function localDate(t = Date.now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const count = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < 1000 ? x : 0);

function sanitizeEntry(v: unknown): DayEntry {
  const r = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const times = Array.isArray(r.times) ? r.times.filter((t): t is number => typeof t === 'number' && Number.isFinite(t)).slice(-MAX_TIMES) : [];
  return { done: count(r.done), shown: count(r.shown), times };
}

export function sanitizeDaily(v: unknown): DailyData {
  const r = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const date = typeof r.date === 'string' ? r.date : '';
  const entries: Record<string, DayEntry> = {};
  if (typeof r.entries === 'object' && r.entries !== null) {
    for (const [id, e] of Object.entries(r.entries as Record<string, unknown>)) if (/^[\w-]{1,40}$/.test(id)) entries[id] = sanitizeEntry(e);
  } else if ('glasses' in r || 'reminders' in r) {
    // Version 1: water only.
    entries[WATER_ID] = { done: count(r.glasses), shown: count(r.reminders), times: [] };
  }
  return { date, entries };
}

/** The record for the day containing `now` (a fresh one after midnight). */
export function dayOf(data: DailyData, now = Date.now()): DailyData {
  const date = localDate(now);
  return data.date === date ? data : { date, entries: {} };
}

export function entryOf(data: DailyData, id: string, now = Date.now()): DayEntry {
  return dayOf(data, now).entries[id] ?? EMPTY;
}

/** Reminders shown today, all kinds together (the first one of the day says good morning). */
export function shownToday(data: DailyData, now = Date.now()): number {
  return Object.values(dayOf(data, now).entries).reduce((n, e) => n + e.shown, 0);
}

function withEntry(data: DailyData, id: string, now: number, change: (e: DayEntry) => DayEntry): DailyData {
  const d = dayOf(data, now);
  return { ...d, entries: { ...d.entries, [id]: change(d.entries[id] ?? EMPTY) } };
}

/** It was done (a glass drunk, a dose taken). */
export function withDone(data: DailyData, id: string, now = Date.now()): DailyData {
  return withEntry(data, id, now, (e) => ({ ...e, done: e.done + 1, times: [...e.times, now].slice(-MAX_TIMES) }));
}

export function withShown(data: DailyData, id: string, now = Date.now()): DailyData {
  return withEntry(data, id, now, (e) => ({ ...e, shown: e.shown + 1 }));
}
