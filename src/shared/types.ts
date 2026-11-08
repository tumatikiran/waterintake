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

/** Which way the companion leaves: across the screen (to the far left), or back the way he came (to the right). */
export type ExitPath = 'across' | 'back';
/** How the companion moves when he leaves. */
export type ExitGait = 'walk' | 'run';

/** fixed: every N minutes. goal: spread the remaining daily goal over the remaining active time. */
export type IntervalMode = 'fixed' | 'goal';

/**
 * Reminder types. Each one is described once in shared/reminders.ts (how it's
 * scheduled, what the companion carries, the wording); everything else is
 * generic. Water is the built-in, permanent one.
 */
export type ReminderTypeId = 'water' | 'medicine';

interface ReminderBase {
  id: string;
  type: ReminderTypeId;
  name: string;
  enabled: boolean;
  snoozeMinutes: number; // "later"
}

/** Drink water: at an interval (or spread over the daily goal), inside active hours. */
export interface WaterReminder extends ReminderBase {
  type: 'water';
  mode: IntervalMode;
  intervalMinutes: number;
  dailyGoal: number; // glasses per day
  stopWhenGoalReached: boolean;
  schedule: TimeWindow[];
}

/** Medicine: at fixed times on chosen days, reminded again until it's taken. */
export interface MedicineReminder extends ReminderBase {
  type: 'medicine';
  dose: string; // "1 tablet"
  notes: string; // "with food"
  times: string[]; // "HH:MM", sorted
  days: Weekday[];
  repeatEveryMinutes: number; // remind again this often until taken…
  repeatTimes: number; // …this many times (0: don't)
}

export type Reminder = WaterReminder | MedicineReminder;

/** Choices that apply to every reminder. */
export interface GeneralSettings {
  exitPath: ExitPath; // how he leaves every reminder: after the answer, Later, ✕ or no answer
  exitGait: ExitGait;
  pauseWhenAway: boolean; // hold reminders while the computer is idle or locked
  systemNotification: boolean; // also show an OS notification
}

/** Relax mode. Minutes may be fractional (tests use seconds); 0 means never / until I stop. */
export interface RelaxSettings {
  dozeAfterMinutes: number; // sitting quietly this long, the companion dozes off
  durationMinutes: number; // Relax mode ends by itself after this long
}

export interface Settings {
  version: 2;
  userName: string;
  reminders: Reminder[];
  general: GeneralSettings;
  relax: RelaxSettings;
  characterId: string;
  openAtLogin: boolean;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

// ------------------------------------------------------------- characters --
export type HairStyle = 'short' | 'spiky' | 'long' | 'bun' | 'buzz';

/** Everything needed to rebuild a character made in the creator. */
/** Body shape of a created character. Both share one skeleton, so every animation fits either. */
export type BodyType = 'male' | 'female';

export interface CharacterRecipe {
  body: BodyType;
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
/** done: did it (drank, took it…). Older Android notifications may still say 'drank'. */
export type ReminderResponse = 'done' | 'later' | 'skip' | 'timeout';

/** Today's progress for reminders that count towards a goal (glasses of water). */
export interface Progress {
  done: number;
  goal: number;
}

/** Sent to the overlay when a reminder starts. */
export interface ReminderContext {
  reason: ReminderReason;
  /** Which reminder (Relax mode: the water reminder, for wording only). */
  reminder: { id: string; type: ReminderTypeId; name: string; detail?: string };
  userName: string;
  progress: Progress | null;
  snoozeMinutes: number;
  exitPath: ExitPath;
  exitGait: ExitGait;
  character: { id: string; revision: number };
  firstOfDay: boolean;
  hour: number; // local hour, for greetings
  /** Relax mode only: how long the companion rests before dozing off (0 = never). */
  dozeAfterMinutes?: number;
  /** Already answered with a notification button (Android): play that response right after arriving. */
  answer?: 'done' | 'later';
}

/** Returned to the overlay after the user answers. */
export interface ResponseResult {
  progress: Progress | null;
  goalReached: boolean;
  snoozeMinutes: number;
  exitPath: ExitPath;
  exitGait: ExitGait;
}

/** One reminder's day so far. */
export interface ReminderStatus {
  nextAt: number | null;
  done: number;
  shown: number;
  times: number[];
}

export interface StatusSnapshot {
  /** The water reminder's count, used all over the UI. */
  glassesToday: number;
  /** Every reminder's next time and today's log, by id. */
  reminders: Record<string, ReminderStatus>;
  nextReminderAt: number | null;
  pausedUntil: number | null;
  reminderActive: boolean;
  /** Relax mode: the companion is sitting on screen, eyes closed, until it is turned off. */
  relaxing: boolean;
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
