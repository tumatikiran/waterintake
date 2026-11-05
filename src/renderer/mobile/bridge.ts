/**
 * Android implementation of the window.aquamate API (see src/shared/api.ts).
 *
 * The desktop app keeps a process running and checks the clock; an Android
 * app is usually not running. So here reminders are planned ahead
 * (planReminders) and handed to Android as scheduled notifications with
 * "I drank water" / "Drink later" buttons. The plan is redone whenever
 * something happens: a glass, a snooze, a settings change, the app opening.
 *
 * Storage: settings, today's count and the schedule in Preferences
 * (SharedPreferences); custom characters as files in the app's private storage.
 * In a browser, Capacitor's web fallbacks are used, which is how it is tested.
 */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import type { AquaMateApi, NotificationPermission, Unsubscribe } from '../../shared/api';
import type { AppState, CharacterInfo, ReminderContext, ReminderReason, ReminderResponse, Settings } from '../../shared/types';
import { mergeSettings, sanitizeSettings } from '../../shared/settings';
import { planReminders, startOfDay, type PlannedReminder, type ScheduleTrigger } from '../../shared/schedule';
import { dayOf, sanitizeDaily, withGlass, withReminderShown } from '../../shared/daily';
import {
  BUILTIN_CHARACTER,
  CHARACTER_ID,
  CHARACTER_LIMITS,
  assertGlb,
  createdRecord,
  newCharacterId,
  patchRecord,
  sanitizeCharacterIndex,
  uploadedRecord,
} from '../../shared/characters';

const REMINDER_IDS = { first: 1000, count: 8 }; // the next 8 reminders are scheduled at any time
const CHANNEL_ID = 'reminders';
const ACTION_TYPE = 'AQUAMATE_REMINDER';
const CHAR_DIR = 'characters';

/** A small event channel. `hold` keeps the last event until someone listens (cold start from a notification). */
class Channel<T> {
  private readonly listeners = new Set<(v: T) => void>();
  private held: T[] = [];
  constructor(private readonly hold = false) {}
  on(cb: (v: T) => void): Unsubscribe {
    this.listeners.add(cb);
    const held = this.held;
    this.held = [];
    held.forEach(cb);
    return () => this.listeners.delete(cb);
  }
  emit(v: T): void {
    if (!this.listeners.size && this.hold) this.held = [v];
    else this.listeners.forEach((l) => l(v));
  }
}

interface ScheduleState {
  nextAt: number | null;
  snoozed: boolean;
  pausedUntil: number | null;
}
function sanitizeSchedule(v: unknown): ScheduleState {
  const r = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const time = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  return { nextAt: time(r.nextAt), snoozed: r.snoozed === true, pausedUntil: time(r.pausedUntil) };
}

async function readPref<T>(key: string, sanitize: (raw: unknown) => T): Promise<T> {
  try {
    const { value } = await Preferences.get({ key });
    return sanitize(value ? JSON.parse(value) : undefined);
  } catch {
    return sanitize(undefined);
  }
}
const writePref = (key: string, value: unknown) => Preferences.set({ key, value: JSON.stringify(value) });

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Opens the system file picker; resolves null if the user backs out. Must be called from a tap. */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    const done = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => done(null), { once: true });
    input.click();
  });
}

const vibrate = () => Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});

export async function createMobileBridge(): Promise<AquaMateApi> {
  const native = Capacitor.isNativePlatform();

  // --------------------------------------------------------------- storage
  let settings = await readPref('settings', sanitizeSettings);
  let daily = await readPref('today', sanitizeDaily);
  let schedule = await readPref('schedule', sanitizeSchedule);
  let custom = await readIndex();
  if (!allCharacters().some((c) => c.id === settings.characterId)) settings = { ...settings, characterId: BUILTIN_CHARACTER.id };

  async function readIndex(): Promise<CharacterInfo[]> {
    try {
      const { data } = await Filesystem.readFile({ path: `${CHAR_DIR}/index.json`, directory: Directory.Data, encoding: Encoding.UTF8 });
      return sanitizeCharacterIndex(JSON.parse(typeof data === 'string' ? data : await data.text()));
    } catch {
      return [];
    }
  }
  async function saveIndex(): Promise<void> {
    await Filesystem.writeFile({
      path: `${CHAR_DIR}/index.json`,
      data: JSON.stringify(custom),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  }
  const modelPath = (id: string) => {
    if (!CHARACTER_ID.test(id)) throw new Error('Invalid character id');
    return `${CHAR_DIR}/${id}.glb`;
  };
  async function writeModel(id: string, bytes: Uint8Array): Promise<void> {
    await Filesystem.writeFile({ path: modelPath(id), data: toBase64(bytes), directory: Directory.Data, recursive: true });
  }
  function allCharacters(): CharacterInfo[] {
    return [BUILTIN_CHARACTER, ...custom];
  }

  // ----------------------------------------------------------------- state
  let permission: NotificationPermission = await checkPermission();
  let reminderActive = false;
  const stateChannel = new Channel<AppState>();
  const startChannel = new Channel<ReminderContext>(true);
  const visibleChannel = new Channel<boolean>(true);

  function appState(): AppState {
    return {
      settings,
      status: {
        glassesToday: dayOf(daily).glasses,
        nextReminderAt: schedule.nextAt,
        pausedUntil: schedule.pausedUntil,
        reminderActive,
      },
      characters: allCharacters(),
      app: {
        version: __APP_VERSION__,
        platform: Capacitor.getPlatform(),
        isPackaged: native,
        dataPath: 'This phone (private app storage)',
        mobile: true,
        notifications: permission,
      },
    };
  }
  const push = () => stateChannel.emit(appState());

  // --------------------------------------------------------- notifications
  async function checkPermission(): Promise<NotificationPermission> {
    try {
      const { display } = await LocalNotifications.checkPermissions();
      return display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'prompt';
    } catch {
      return 'denied';
    }
  }

  async function setupAndroidNotifications(): Promise<void> {
    if (!native) return;
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Water reminders',
      description: 'Reminders to drink water',
      importance: 4,
      visibility: 1,
      vibration: true,
    }).catch(() => {});
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: ACTION_TYPE,
          actions: [
            { id: 'drank', title: 'I drank water' },
            { id: 'later', title: 'Drink later' },
          ],
        },
      ],
    }).catch(() => {});
  }

  function notificationText(snoozed: boolean): string {
    const name = settings.userName ? ` ${settings.userName}` : '';
    return snoozed ? `Ready now${name ? `,${name}` : ''}? Time to drink some water 💧` : `Hey${name}! Time to drink some water 💧`;
  }

  /** Replaces the scheduled notifications with the given plan. */
  async function syncNotifications(plan: PlannedReminder[]): Promise<void> {
    if (permission !== 'granted') return;
    try {
      const ids = Array.from({ length: REMINDER_IDS.count }, (_, i) => ({ id: REMINDER_IDS.first + i }));
      await LocalNotifications.cancel({ notifications: ids });
      if (!plan.length) return;
      await LocalNotifications.schedule({
        notifications: plan.map((p, i) => ({
          id: REMINDER_IDS.first + i,
          title: 'AquaMate',
          body: notificationText(p.snoozed),
          // Inexact but battery-friendly: Android may deliver a few minutes late.
          schedule: { at: new Date(p.at), allowWhileIdle: true },
          channelId: CHANNEL_ID,
          actionTypeId: ACTION_TYPE,
          smallIcon: 'ic_stat_aquamate',
          iconColor: '#2F80ED',
          autoCancel: true,
          extra: { kind: 'reminder', snoozed: p.snoozed },
        })),
      });
    } catch (err) {
      console.warn('[AquaMate] Could not schedule reminders:', err);
    }
  }

  async function apply(plan: PlannedReminder[]): Promise<void> {
    schedule = { ...schedule, nextAt: plan[0]?.at ?? null, snoozed: plan[0]?.snoozed ?? false };
    await writePref('schedule', schedule);
    await syncNotifications(plan);
    push();
  }

  async function reschedule(after: ScheduleTrigger): Promise<void> {
    if (schedule.pausedUntil !== null && schedule.pausedUntil <= Date.now()) schedule = { ...schedule, pausedUntil: null };
    const plan = planReminders({
      settings: settings.reminders,
      now: Date.now(),
      glassesToday: dayOf(daily).glasses,
      after,
      count: REMINDER_IDS.count,
      pausedUntil: schedule.pausedUntil,
    });
    await apply(plan);
  }

  /** On launch / return to the app: keep the upcoming reminder, re-plan the rest. */
  async function refreshPlan(): Promise<void> {
    const now = Date.now();
    daily = dayOf(daily, now);
    if (schedule.pausedUntil !== null && schedule.pausedUntil <= now) schedule = { ...schedule, pausedUntil: null };
    if (schedule.nextAt !== null && schedule.nextAt > now && schedule.pausedUntil === null && settings.reminders.enabled) {
      const rest = planReminders({
        settings: settings.reminders,
        now: schedule.nextAt,
        glassesToday: startOfDay(schedule.nextAt) > startOfDay(now) ? 0 : daily.glasses,
        after: 'skip',
        count: REMINDER_IDS.count - 1,
      });
      await apply([{ at: schedule.nextAt, snoozed: schedule.snoozed }, ...rest]);
    } else {
      await reschedule('start');
    }
  }

  // ---------------------------------------------------------- reminder scene
  function startReminder(reason: ReminderReason, answer?: 'drank' | 'later'): void {
    if (reminderActive) return;
    reminderActive = true;
    const character = allCharacters().find((c) => c.id === settings.characterId) ?? BUILTIN_CHARACTER;
    const today = dayOf(daily);
    const ctx: ReminderContext = {
      reason,
      userName: settings.userName,
      glassesToday: today.glasses,
      dailyGoal: settings.reminders.dailyGoal,
      snoozeMinutes: settings.reminders.snoozeMinutes,
      character: { id: character.id, revision: character.revision },
      firstOfDay: today.reminders === 0,
      hour: new Date().getHours(),
      answer,
    };
    daily = withReminderShown(daily);
    void writePref('today', daily);
    visibleChannel.emit(true);
    startChannel.emit(ctx);
    push();
  }

  void LocalNotifications.addListener('localNotificationActionPerformed', ({ actionId, notification }) => {
    const extra = (notification.extra ?? {}) as { kind?: string; snoozed?: boolean };
    if (extra.kind !== 'reminder') return;
    void LocalNotifications.removeAllDeliveredNotifications().catch(() => {});
    const reason: ReminderReason = extra.snoozed ? 'snoozed' : 'scheduled';
    startReminder(reason, actionId === 'drank' || actionId === 'later' ? actionId : undefined);
  });
  // A reminder that comes due while the app is open plays right away, like on desktop.
  void LocalNotifications.addListener('localNotificationReceived', (notification) => {
    const extra = (notification.extra ?? {}) as { kind?: string; snoozed?: boolean };
    if (extra.kind === 'reminder' && document.visibilityState === 'visible') startReminder(extra.snoozed ? 'snoozed' : 'scheduled');
  });
  void App.addListener('resume', async () => {
    permission = await checkPermission();
    await refreshPlan();
  });
  // Keep "paused until" and the date fresh while the app stays open.
  window.setInterval(() => {
    const before = JSON.stringify(appState().status);
    if (schedule.pausedUntil !== null && schedule.pausedUntil <= Date.now()) void reschedule('resume');
    else if (JSON.stringify(appState().status) !== before) push();
  }, 30_000);

  await setupAndroidNotifications();
  await refreshPlan();

  // -------------------------------------------------------------------- API
  const api: AquaMateApi = {
    getState: async () => appState(),
    onState: (cb) => stateChannel.on(cb),
    async updateSettings(patch) {
      const next: Settings = mergeSettings(settings, patch);
      if (!allCharacters().some((c) => c.id === next.characterId)) next.characterId = settings.characterId;
      settings = next;
      await writePref('settings', settings);
      await reschedule('settings');
      return settings;
    },
    testReminder: () => startReminder('manual'),
    async logGlass() {
      daily = withGlass(daily);
      await writePref('today', daily);
      void vibrate();
      await reschedule('drank');
      return daily.glasses;
    },
    pause(minutes) {
      const until =
        minutes === 'tomorrow'
          ? new Date(new Date(startOfDay(Date.now())).setDate(new Date().getDate() + 1)).getTime()
          : Date.now() + Math.min(24 * 60, Math.max(1, minutes)) * 60_000;
      schedule = { ...schedule, pausedUntil: until };
      void reschedule('start');
    },
    resume() {
      if (schedule.pausedUntil === null) return;
      schedule = { ...schedule, pausedUntil: null };
      void reschedule('resume');
    },

    characters: {
      async import() {
        const file = await pickFile('.glb,model/gltf-binary,application/octet-stream');
        if (!file) return { ok: false, canceled: true };
        try {
          if (file.size > CHARACTER_LIMITS.uploadBytes) throw new Error('The model is larger than 30 MB. Please use a lighter model.');
          const bytes = new Uint8Array(await file.arrayBuffer());
          assertGlb(bytes);
          const info = uploadedRecord(newCharacterId(), file.name);
          await writeModel(info.id, bytes);
          custom = [...custom, info];
          await saveIndex();
          push();
          return { ok: true, character: info };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : 'The model could not be imported.' };
        }
      },
      async saveCreated(input) {
        const glb = input.glb instanceof Uint8Array ? input.glb : new Uint8Array();
        if (glb.byteLength > CHARACTER_LIMITS.createdBytes) throw new Error('The character is too large.');
        assertGlb(glb);
        const existing = input.id ? custom.find((c) => c.id === input.id && c.kind === 'created') : undefined;
        const info = createdRecord(existing?.id ?? newCharacterId(), input, existing);
        await writeModel(info.id, glb);
        custom = existing ? custom.map((c) => (c.id === info.id ? info : c)) : [...custom, info];
        await saveIndex();
        push();
        return info;
      },
      async update(id, patch) {
        const item = custom.find((c) => c.id === id);
        if (!item) return null;
        const next = patchRecord(item, patch);
        custom = custom.map((c) => (c.id === id ? next : c));
        await saveIndex();
        push();
        return next;
      },
      async remove(id) {
        if (!custom.some((c) => c.id === id)) return false;
        custom = custom.filter((c) => c.id !== id);
        await saveIndex();
        await Filesystem.deleteFile({ path: modelPath(id), directory: Directory.Data }).catch(() => {});
        if (settings.characterId === id) {
          settings = { ...settings, characterId: BUILTIN_CHARACTER.id };
          await writePref('settings', settings);
        }
        push();
        return true;
      },
      async select(id) {
        if (!allCharacters().some((c) => c.id === id)) throw new Error('Unknown character');
        settings = { ...settings, characterId: id };
        await writePref('settings', settings);
        push();
        return settings;
      },
      async load(id) {
        if (!custom.some((c) => c.id === id)) return null;
        try {
          const { data } = await Filesystem.readFile({ path: modelPath(id), directory: Directory.Data });
          return typeof data === 'string' ? fromBase64(data) : new Uint8Array(await data.arrayBuffer());
        } catch {
          return null;
        }
      },
    },

    onReminderStart: (cb) => startChannel.on(cb),
    mascotReady: () => {},
    setHitRegion: () => {},
    onPointer: () => () => {},
    async respond(kind: ReminderResponse) {
      if (kind === 'drank') {
        daily = withGlass(daily);
        await writePref('today', daily);
        void vibrate();
      }
      await reschedule(kind === 'drank' ? 'drank' : kind === 'skip' ? 'skip' : 'later');
      void LocalNotifications.removeAllDeliveredNotifications().catch(() => {});
      const glassesToday = dayOf(daily).glasses;
      const { dailyGoal, snoozeMinutes } = settings.reminders;
      return { glassesToday, dailyGoal, goalReached: glassesToday >= dailyGoal, snoozeMinutes };
    },
    mascotDone() {
      reminderActive = false;
      visibleChannel.emit(false);
      push();
    },

    mobile: {
      onReminderVisible: (cb) => visibleChannel.on(cb),
      async requestNotifications() {
        try {
          const { display } = await LocalNotifications.requestPermissions();
          permission = display === 'granted' ? 'granted' : display === 'denied' ? 'denied' : 'prompt';
        } catch {
          permission = 'denied';
        }
        if (permission === 'granted') {
          await setupAndroidNotifications();
          await refreshPlan();
        }
        push();
        return permission;
      },
    },
  };
  return api;
}
