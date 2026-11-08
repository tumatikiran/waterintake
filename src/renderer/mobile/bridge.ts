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
import type { AppState, CharacterInfo, Reminder, ReminderContext, ReminderReason, ReminderResponse, ReminderTypeId, Settings } from '../../shared/types';
import { mergeSettings, sanitizeSettings, withReminderAdded, withReminderPatch, withReminderRemoved } from '../../shared/settings';
import { mergePlans, planChain, startOfDay, type NextInput, type PlannedReminder, type ScheduleTrigger } from '../../shared/schedule';
import { dayOf, entryOf, sanitizeDaily, shownToday, withDone, withShown } from '../../shared/daily';
import { REMINDER_TYPES, WATER_ID, newReminderId, nextTime, typeOf, waterReminder } from '../../shared/reminders';
import {
  BUILTIN_CHARACTER,
  BUILTIN_CHARACTERS,
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
/** Each reminder type gets its own Android channel (so medicine can be set louder) and buttons. */
const NOTIFY: Record<ReminderTypeId, { channel: string; channelName: string; description: string; actionType: string }> = {
  water: { channel: 'reminders', channelName: 'Water reminders', description: 'Reminders to drink water', actionType: 'AQUAMATE_REMINDER' },
  medicine: { channel: 'medicine', channelName: 'Medicine reminders', description: 'Reminders to take your medicine', actionType: 'AQUAMATE_MEDICINE' },
};
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

/** Each reminder's next time (what the notifications were planned from). */
interface Slot {
  nextAt: number | null;
  snoozed: boolean;
}
interface ScheduleState {
  slots: Record<string, Slot>;
  pausedUntil: number | null;
}
function sanitizeSchedule(v: unknown): ScheduleState {
  const r = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const time = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const slot = (x: unknown): Slot => {
    const o = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
    return { nextAt: time(o.nextAt), snoozed: o.snoozed === true };
  };
  const slots: Record<string, Slot> = {};
  if (typeof r.slots === 'object' && r.slots !== null) for (const [id, x] of Object.entries(r.slots)) slots[id] = slot(x);
  else if ('nextAt' in r) slots[WATER_ID] = slot(r); // version 1: water only
  return { slots, pausedUntil: time(r.pausedUntil) };
}

/** A planned notification and the reminder it's for. */
type Planned = PlannedReminder & { reminderId: string };
const toDone = (actionId: string) => (actionId === 'done' || actionId === 'drank' ? 'done' : actionId === 'later' ? 'later' : undefined);

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
    return [...BUILTIN_CHARACTERS, ...custom];
  }

  // ----------------------------------------------------------------- state
  let permission: NotificationPermission = await checkPermission();
  let reminderActive = false;
  let activeReminder: Reminder | null = null;
  let relaxing = false; // Relax mode on the Today screen (not saved: it ends when the app closes)
  let relaxTimer: number | undefined; // "Relax for": ends Relax mode by itself
  const stateChannel = new Channel<AppState>();
  const startChannel = new Channel<ReminderContext>(true);
  const visibleChannel = new Channel<boolean>(true);

  function appState(): AppState {
    return {
      settings,
      status: {
        glassesToday: entryOf(daily, WATER_ID).done,
        reminders: Object.fromEntries(
          settings.reminders.map((r) => [r.id, { nextAt: schedule.slots[r.id]?.nextAt ?? null, ...entryOf(daily, r.id) }]),
        ),
        nextReminderAt,
        pausedUntil: schedule.pausedUntil,
        reminderActive,
        relaxing,
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
  let nextReminderAt: number | null = null; // the first planned notification

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
    for (const n of Object.values(NOTIFY)) {
      await LocalNotifications.createChannel({
        id: n.channel,
        name: n.channelName,
        description: n.description,
        importance: 4,
        visibility: 1,
        vibration: true,
      }).catch(() => {});
    }
    await LocalNotifications.registerActionTypes({
      types: (Object.keys(NOTIFY) as ReminderTypeId[]).map((type) => ({
        id: NOTIFY[type].actionType,
        actions: [
          { id: 'done', title: REMINDER_TYPES[type].labels.notifyDone },
          { id: 'later', title: REMINDER_TYPES[type].labels.notifyLater },
        ],
      })),
    }).catch(() => {});
  }

  /** Replaces the scheduled notifications with the given plan. */
  async function syncNotifications(plan: Planned[]): Promise<void> {
    if (permission !== 'granted') return;
    try {
      const ids = Array.from({ length: REMINDER_IDS.count }, (_, i) => ({ id: REMINDER_IDS.first + i }));
      await LocalNotifications.cancel({ notifications: ids });
      if (!plan.length) return;
      await LocalNotifications.schedule({
        notifications: plan.map((p, i) => {
          const r = settings.reminders.find((x) => x.id === p.reminderId) ?? waterReminder(settings.reminders);
          const { title, body } = typeOf(r).notification(r, { userName: settings.userName, snoozed: p.snoozed });
          return {
            id: REMINDER_IDS.first + i,
            title,
            body,
            // Inexact but battery-friendly: Android may deliver a few minutes late.
            schedule: { at: new Date(p.at), allowWhileIdle: true },
            channelId: NOTIFY[r.type].channel,
            actionTypeId: NOTIFY[r.type].actionType,
            smallIcon: 'ic_stat_aquamate',
            iconColor: '#2F80ED',
            autoCancel: true,
            extra: { kind: 'reminder', reminderId: r.id, snoozed: p.snoozed },
          };
        }),
      });
    } catch (err) {
      console.warn('[AquaMate] Could not schedule reminders:', err);
    }
  }

  const doneToday = (id: string, now = Date.now()) => entryOf(daily, id, now).done;

  /**
   * The next notifications across every reminder: each one's next time, then
   * its following ones, merged in time order. While paused, everything starts
   * when the pause ends.
   */
  function planAll(now = Date.now()): Planned[] {
    const paused = schedule.pausedUntil !== null && schedule.pausedUntil > now;
    const plans = settings.reminders.map((r): Planned[] => {
      const next = (input: NextInput) => nextTime(r, input);
      const tag = (p: PlannedReminder): Planned => ({ ...p, reminderId: r.id });
      const { done, times } = entryOf(daily, r.id, now);
      if (paused) {
        return planChain(next, { now, doneToday: done, doneTimes: times, after: 'start', count: REMINDER_IDS.count, pausedUntil: schedule.pausedUntil }).map(tag);
      }
      const first = schedule.slots[r.id];
      if (!first || first.nextAt === null) return [];
      const at = first.nextAt;
      const sameDay = startOfDay(at) === startOfDay(now);
      // Then the ones after it, as if each passed unanswered (medicine plans its repeats).
      const rest = planChain(next, {
        now: at,
        doneToday: sameDay ? done : 0,
        doneTimes: sameDay ? times : [],
        after: 'planned',
        count: REMINDER_IDS.count - 1,
      });
      return [{ at, snoozed: first.snoozed }, ...rest].map(tag);
    });
    return mergePlans(plans, REMINDER_IDS.count, settings.reminders.map((r) => typeOf(r).planReserve));
  }

  async function apply(): Promise<void> {
    const plan = planAll();
    nextReminderAt = plan[0]?.at ?? null;
    await writePref('schedule', schedule);
    await syncNotifications(plan);
    push();
  }

  function slotFor(r: Reminder, after: ScheduleTrigger, now = Date.now()): Slot {
    const { done, times } = entryOf(daily, r.id, now);
    return { nextAt: nextTime(r, { now, doneToday: done, doneTimes: times, after }), snoozed: after === 'later' || after === 'missed' };
  }

  /** Recompute one reminder (or all of them) after something happened, then re-plan the notifications. */
  async function reschedule(after: ScheduleTrigger, id?: string): Promise<void> {
    if (schedule.pausedUntil !== null && schedule.pausedUntil <= Date.now()) schedule = { ...schedule, pausedUntil: null };
    const slots: Record<string, Slot> = {};
    for (const r of settings.reminders) slots[r.id] = id === undefined || r.id === id ? slotFor(r, after) : (schedule.slots[r.id] ?? slotFor(r, 'start'));
    schedule = { ...schedule, slots };
    await apply();
  }

  /** On launch / return to the app: keep each upcoming reminder, re-plan the rest. */
  async function refreshPlan(): Promise<void> {
    const now = Date.now();
    daily = dayOf(daily, now);
    if (schedule.pausedUntil !== null && schedule.pausedUntil <= now) schedule = { ...schedule, pausedUntil: null };
    const slots: Record<string, Slot> = {};
    for (const r of settings.reminders) {
      const kept = schedule.slots[r.id];
      slots[r.id] = kept && kept.nextAt !== null && kept.nextAt > now && r.enabled ? kept : slotFor(r, 'start', now);
    }
    schedule = { ...schedule, slots };
    await apply();
  }

  // ---------------------------------------------------------- reminder scene
  /** The reminder a notification is for (older notifications didn't say: water). */
  const reminderFor = (id: unknown) => settings.reminders.find((r) => r.id === id) ?? waterReminder(settings.reminders);

  function startReminder(r: Reminder, reason: ReminderReason, answer?: 'done' | 'later'): void {
    if (reminderActive) return;
    reminderActive = true;
    activeReminder = r;
    const character = allCharacters().find((c) => c.id === settings.characterId) ?? BUILTIN_CHARACTER;
    const ctx: ReminderContext = {
      reason,
      reminder: { id: r.id, type: r.type, name: r.name, detail: typeOf(r).describe(r) ?? undefined },
      userName: settings.userName,
      progress: typeOf(r).progress(r, doneToday(r.id)),
      snoozeMinutes: r.snoozeMinutes,
      exitPath: settings.general.exitPath,
      exitGait: settings.general.exitGait,
      character: { id: character.id, revision: character.revision },
      firstOfDay: shownToday(daily) === 0,
      hour: new Date().getHours(),
      answer,
    };
    daily = withShown(daily, r.id);
    void writePref('today', daily);
    visibleChannel.emit(true);
    startChannel.emit(ctx);
    push();
  }

  void LocalNotifications.addListener('localNotificationActionPerformed', ({ actionId, notification }) => {
    const extra = (notification.extra ?? {}) as { kind?: string; snoozed?: boolean; reminderId?: string };
    if (extra.kind !== 'reminder') return;
    void LocalNotifications.removeAllDeliveredNotifications().catch(() => {});
    const reason: ReminderReason = extra.snoozed ? 'snoozed' : 'scheduled';
    startReminder(reminderFor(extra.reminderId), reason, toDone(actionId));
  });
  // A reminder that comes due while the app is open plays right away, like on desktop.
  void LocalNotifications.addListener('localNotificationReceived', (notification) => {
    const extra = (notification.extra ?? {}) as { kind?: string; snoozed?: boolean; reminderId?: string };
    if (extra.kind === 'reminder' && document.visibilityState === 'visible') startReminder(reminderFor(extra.reminderId), extra.snoozed ? 'snoozed' : 'scheduled');
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
    async updateReminder(id, patch) {
      settings = withReminderPatch(settings, id, patch);
      await writePref('settings', settings);
      await reschedule('settings', id);
      return settings;
    },
    async addReminder(type) {
      const id = newReminderId(type);
      const next = withReminderAdded(settings, type, id);
      if (next === settings) throw new Error("Can't add another reminder of this kind.");
      settings = next;
      await writePref('settings', settings);
      await reschedule('settings', id);
      return { settings, id };
    },
    async removeReminder(id) {
      settings = withReminderRemoved(settings, id);
      await writePref('settings', settings);
      await reschedule('settings');
      return settings;
    },
    testReminder: (id) => startReminder(reminderFor(id), 'manual'),
    setRelax(on) {
      if (relaxing === on) return;
      relaxing = on;
      window.clearTimeout(relaxTimer);
      const minutes = settings.relax.durationMinutes;
      if (on && minutes > 0) relaxTimer = window.setTimeout(() => api.setRelax(false), minutes * 60_000);
      push();
    },
    async logGlass() {
      daily = withDone(daily, WATER_ID);
      await writePref('today', daily);
      void vibrate();
      await reschedule('done', WATER_ID);
      return doneToday(WATER_ID);
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
    onRelax: () => () => {}, // Android relaxes on the Today screen, not in the reminder scene
    mascotReady: () => {},
    setHitRegion: () => {},
    onPointer: () => () => {},
    async respond(raw: ReminderResponse | 'drank') {
      const kind = raw === 'drank' ? 'done' : raw;
      const r = reminderFor(activeReminder?.id);
      if (kind === 'done') {
        daily = withDone(daily, r.id);
        await writePref('today', daily);
        void vibrate();
      }
      await reschedule(kind === 'done' ? 'done' : kind === 'skip' ? 'skip' : kind === 'timeout' ? 'missed' : 'later', r.id);
      void LocalNotifications.removeAllDeliveredNotifications().catch(() => {});
      const progress = typeOf(r).progress(r, doneToday(r.id));
      const { exitPath, exitGait } = settings.general;
      return { progress, goalReached: !!progress && progress.done >= progress.goal, snoozeMinutes: r.snoozeMinutes, exitPath, exitGait };
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
