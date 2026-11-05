/**
 * Types shared by the main process, the preload bridge and the renderer.
 * Keep this file free of runtime code that touches Node or the DOM.
 */

/** 0 = Sunday … 6 = Saturday, matching Date#getDay(). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * A period of the week when reminders may fire. `end` at or before `start`
 * means the window runs past midnight (for example 22:00–06:00); equal times
 * mean the whole day. `days` are the days the window *starts* on.
 */
export interface TimeWindow {
  days: Weekday[];
  start: string; // "HH:MM", 24-hour
  end: string; // "HH:MM", 24-hour
}

/** fixed: every N minutes. goal: spread the remaining daily goal over the remaining active time. */
export type IntervalMode = 'fixed' | 'goal';

export interface ReminderSettings {
  enabled: boolean;
  mode: IntervalMode;
  intervalMinutes: number;
  dailyGoal: number; // glasses per day
  stopWhenGoalReached: boolean;
  snoozeMinutes: number; // "Drink Later"
  schedule: TimeWindow[];
  pauseWhenAway: boolean; // hold reminders while the computer is idle or locked
  systemNotification: boolean; // also show an OS notification
}

export interface Settings {
  version: 1;
  userName: string;
  reminders: ReminderSettings;
  characterId: string;
  openAtLogin: boolean;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

// ------------------------------------------------------------- characters --
export type HairStyle = 'short' | 'spiky' | 'long' | 'bun' | 'buzz';

/** Everything needed to rebuild a character made in the creator. */
export interface CharacterRecipe {
  skinTone: string;
  hairStyle: HairStyle;
  hairColor: string;
  shirtColor: string;
  accentColor: string;
  pantsColor: string;
  shoeColor: string;
  glasses: boolean;
  beard: boolean;
}

export type CharacterKind = 'builtin' | 'created' | 'uploaded';

export interface CharacterInfo {
  id: string;
  name: string;
  kind: CharacterKind;
  /** Bumped whenever the model file changes, so renderers drop cached copies. */
  revision: number;
  thumbnail?: string; // data:image/png;base64,…
  recipe?: CharacterRecipe; // created characters only
  animations?: string[]; // roles found in an uploaded model
  createdAt: number;
}

// -------------------------------------------------------------- reminders --
export type ReminderReason = 'scheduled' | 'snoozed' | 'manual';
export type ReminderResponse = 'drank' | 'later' | 'skip' | 'timeout';

/** Sent to the overlay when a reminder starts. */
export interface ReminderContext {
  reason: ReminderReason;
  userName: string;
  glassesToday: number;
  dailyGoal: number;
  snoozeMinutes: number;
  character: { id: string; revision: number };
  firstOfDay: boolean;
  hour: number; // local hour, for greetings
  /** Already answered with a notification button (Android): play that response right after arriving. */
  answer?: 'drank' | 'later';
}

/** Returned to the overlay after the user answers. */
export interface ResponseResult {
  glassesToday: number;
  dailyGoal: number;
  goalReached: boolean;
  snoozeMinutes: number;
}

export interface StatusSnapshot {
  glassesToday: number;
  nextReminderAt: number | null;
  pausedUntil: number | null;
  reminderActive: boolean;
}

export interface AppState {
  settings: Settings;
  status: StatusSnapshot;
  characters: CharacterInfo[];
  app: {
    version: string;
    platform: string; // darwin | win32 | linux | android | web
    isPackaged: boolean;
    dataPath: string;
    mobile: boolean;
    notifications?: 'granted' | 'denied' | 'prompt'; // Android
  };
}

export type ImportResult = { ok: true; character: CharacterInfo } | { ok: false; error: string } | { ok: false; canceled: true };

export interface SaveCreatedInput {
  id?: string; // present when editing an existing created character
  name: string;
  recipe: CharacterRecipe;
  glb: Uint8Array;
  thumbnail: string;
}

export interface HitRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}
