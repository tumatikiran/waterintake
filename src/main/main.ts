import { app, dialog, ipcMain, net, Notification, powerMonitor, protocol, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  AppState,
  DeepPartial,
  HitRegion,
  ImportResult,
  ReminderContext,
  ReminderReason,
  ReminderResponse,
  ResponseResult,
  Reminder,
  SaveCreatedInput,
  Settings,
} from '../shared/types';
import { mergeSettings, sanitizeSettings, withReminderPatch, type SettingsPatch } from '../shared/settings';
import { WATER_ID, typeOf, waterReminder } from '../shared/reminders';
import { startOfDay } from '../shared/schedule';
import { WindowManager, type View } from './window-manager';
import { DailyLog, JsonFile } from './stores';
import { ReminderScheduler } from './scheduler';
import { BUILTIN_CHARACTER, CharacterStore } from './character-store';
import { AppTray } from './tray';

// Tests (and power users) can point AquaMate at a separate data folder.
if (process.env.AQUAMATE_USER_DATA) app.setPath('userData', process.env.AQUAMATE_USER_DATA);

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const APP_ROOT = path.join(__dirname, '..', '..');
const RENDERER_DIR = path.join(APP_ROOT, 'dist-renderer');
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
].join('; ');
const IDLE_THRESHOLD_S = 5 * 60;

// The packaged renderer is served from app:// rather than file:// so that
// fetch() (used by GLTFLoader to load the .glb) works and paths stay relative.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function serveRenderer(): void {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const relative = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(RENDERER_DIR, relative);
    if (!file.startsWith(RENDERER_DIR + path.sep)) return new Response('Forbidden', { status: 403 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    if (file.endsWith('.html')) headers.set('Content-Security-Policy', CSP);
    if (file.endsWith('.glb')) headers.set('Content-Type', 'model/gltf-binary');
    return new Response(res.body, { status: res.status, headers });
  });
}

function urlFor(view: View): string {
  const base = DEV_SERVER_URL ?? 'app://aquamate/index.html';
  return `${base}${base.includes('?') ? '&' : '?'}view=${view}`;
}

/** Validates the card box sent by the renderer; anything malformed means "no card". */
function toHitRegion(value: unknown): HitRegion | null {
  if (!value || typeof value !== 'object') return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  const nums = [x, y, width, height];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return { x: x as number, y: y as number, width: Math.max(0, width as number), height: Math.max(0, height as number) };
}

const RESPONSES: ReminderResponse[] = ['done', 'later', 'skip', 'timeout'];
/** 'drank' is what older builds (and Android notification buttons) called "done". */
const toResponse = (kind: unknown): ReminderResponse | null =>
  kind === 'drank' ? 'done' : RESPONSES.includes(kind as ReminderResponse) ? (kind as ReminderResponse) : null;

function main(): void {
  const dataDir = app.getPath('userData');
  const settingsFile = new JsonFile<Settings>(path.join(dataDir, 'settings.json'), sanitizeSettings);
  let settings = settingsFile.read();
  const log = new DailyLog(path.join(dataDir, 'today.json'));
  const characters = new CharacterStore(path.join(dataDir, 'characters'));
  if (!characters.get(settings.characterId)) settings = { ...settings, characterId: BUILTIN_CHARACTER.id };

  const saveSettings = (next: Settings) => {
    settings = next;
    settingsFile.write(settings);
    if (app.isPackaged) {
      try {
        app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, args: ['--hidden'] });
      } catch (err) {
        console.warn('[AquaMate] Could not update the login item:', err);
      }
    }
  };

  const windows = new WindowManager({
    preload: path.join(__dirname, 'preload.js'),
    urlFor,
    onSettingsReady: () => pushState(),
  });

  const scheduler = new ReminderScheduler({
    reminders: () => settings.reminders,
    doneToday: (id) => log.doneToday(id),
    pauseWhenAway: () => settings.general.pauseWhenAway,
    isUserAway: () => {
      const state = powerMonitor.getSystemIdleState(IDLE_THRESHOLD_S);
      return state === 'idle' || state === 'locked';
    },
    // Some types wait while you relax (water), others wake the companion; "Remind me now" always does.
    isBusy: (r) => windows.busy || (windows.relaxing && typeOf(r).duringRelax === 'wait'),
    fire: (r, reason) => startReminder(r, reason),
    changed: () => pushState(),
  });
  /** The reminder on screen (its answer is logged against it). */
  let activeReminder: Reminder | null = null;
  const water = () => waterReminder(settings.reminders);

  const tray = new AppTray(path.join(APP_ROOT, 'assets', 'tray'), {
    remindNow: () => startReminder(water(), 'manual'),
    logGlass: () => logGlass(),
    setRelax: (on) => setRelax(on),
    pause: (minutes) => pause(minutes),
    resume: () => scheduler.resume(),
    openSettings: () => windows.showSettings(),
    quit: () => app.quit(),
  });

  function appState(): AppState {
    return {
      settings,
      status: {
        glassesToday: log.doneToday(WATER_ID),
        reminders: Object.fromEntries(
          settings.reminders.map((r) => [r.id, { nextAt: scheduler.nextFor(r.id), ...log.entry(r.id) }]),
        ),
        nextReminderAt: scheduler.nextAt,
        pausedUntil: scheduler.pausedUntil,
        reminderActive: windows.reminderActive,
        relaxing: windows.relaxing,
      },
      characters: characters.list(),
      app: { version: app.getVersion(), platform: process.platform, isPackaged: app.isPackaged, dataPath: dataDir, mobile: false },
    };
  }

  function pushState(): void {
    const state = appState();
    windows.sendToSettings('state', state);
    tray.update({
      enabled: settings.reminders.some((r) => r.enabled),
      glassesToday: state.status.glassesToday,
      dailyGoal: water().dailyGoal,
      nextReminderAt: state.status.nextReminderAt,
      pausedUntil: state.status.pausedUntil,
      relaxing: state.status.relaxing,
      canRelax: !windows.relaxing && !windows.busy, // nothing else on screen
    });
  }

  /** Everything the overlay needs to know about the companion and the user right now. */
  function sceneContext(reason: ReminderReason, r: Reminder): ReminderContext {
    const character = characters.get(settings.characterId) ?? BUILTIN_CHARACTER;
    return {
      reason,
      reminder: { id: r.id, type: r.type, name: r.name },
      userName: settings.userName,
      progress: typeOf(r).progress(r, log.doneToday(r.id)),
      snoozeMinutes: r.snoozeMinutes,
      exitPath: settings.general.exitPath,
      exitGait: settings.general.exitGait,
      character: { id: character.id, revision: character.revision },
      firstOfDay: log.remindersToday() === 0,
      hour: new Date().getHours(),
    };
  }

  function startReminder(r: Reminder, reason: ReminderReason): void {
    if (windows.busy) return;
    if (!windows.startReminder(sceneContext(reason, r))) return;
    clearTimeout(relaxTimer); // a reminder ends Relax mode
    activeReminder = r;
    log.shown(r.id);
    if (reason === 'manual') scheduler.manualShown(r.id);
    if (reason !== 'manual' && settings.general.systemNotification && Notification.isSupported()) {
      const { title, body } = typeOf(r).notification(r, { userName: settings.userName, snoozed: reason === 'snoozed' });
      new Notification({ title, body }).show();
    }
    pushState();
  }

  /** Relax mode on or off. Ignored while a reminder is on screen. "Relax for" ends it by itself. */
  let relaxTimer: ReturnType<typeof setTimeout> | undefined;
  function setRelax(on: boolean): void {
    clearTimeout(relaxTimer);
    const { dozeAfterMinutes, durationMinutes } = settings.relax;
    if (on ? windows.startRelax({ ...sceneContext('manual', water()), dozeAfterMinutes }) : windows.stopRelax()) pushState();
    if (on && windows.relaxing && durationMinutes > 0) relaxTimer = setTimeout(() => setRelax(false), durationMinutes * 60_000);
  }

  /** A glass logged without a reminder (tray, "+ 1 glass"). */
  function logGlass(): number {
    const count = log.done(WATER_ID);
    scheduler.reschedule(WATER_ID, 'done');
    return count;
  }

  function pause(minutes: unknown): void {
    if (minutes === 'tomorrow') {
      const tomorrow = new Date(startOfDay(Date.now()));
      tomorrow.setDate(tomorrow.getDate() + 1);
      scheduler.pause(tomorrow.getTime());
    } else if (typeof minutes === 'number' && minutes > 0 && minutes <= 24 * 60) {
      scheduler.pause(Date.now() + minutes * 60_000);
    }
  }

  // ---------------------------------------------------------- IPC: settings
  const fromSettings = (e: IpcMainInvokeEvent | Electron.IpcMainEvent) => windows.isFrom(e, 'settings');
  const fromMascot = (e: IpcMainInvokeEvent | Electron.IpcMainEvent) => windows.isFrom(e, 'mascot');

  ipcMain.handle('state:get', (e) => {
    if (!fromSettings(e)) throw new Error('Not allowed');
    return appState();
  });
  ipcMain.handle('settings:update', (e, patch: SettingsPatch) => {
    if (!fromSettings(e)) throw new Error('Not allowed');
    const next = mergeSettings(settings, patch);
    if (!characters.get(next.characterId)) next.characterId = settings.characterId;
    saveSettings(next);
    scheduler.sync('settings');
    return settings;
  });
  ipcMain.handle('reminders:update', (e, id: unknown, patch: unknown) => {
    if (!fromSettings(e) || typeof id !== 'string' || typeof patch !== 'object' || patch === null) throw new Error('Not allowed');
    saveSettings(withReminderPatch(settings, id, patch as Record<string, unknown>));
    scheduler.reschedule(id, 'settings');
    return settings;
  });
  ipcMain.on('reminder:test', (e, id: unknown) => {
    if (!fromSettings(e)) return;
    startReminder(settings.reminders.find((r) => r.id === id) ?? water(), 'manual');
  });
  ipcMain.handle('glass:log', (e) => {
    if (!fromSettings(e)) throw new Error('Not allowed');
    return logGlass();
  });
  ipcMain.on('reminders:pause', (e, minutes: unknown) => fromSettings(e) && pause(minutes));
  ipcMain.on('reminders:resume', (e) => fromSettings(e) && scheduler.resume());
  ipcMain.on('relax:set', (e, on: unknown) => fromSettings(e) && typeof on === 'boolean' && setRelax(on));

  // -------------------------------------------------------- IPC: characters
  ipcMain.handle('characters:import', async (e): Promise<ImportResult> => {
    if (!fromSettings(e) || !windows.settings) throw new Error('Not allowed');
    const pick = await dialog.showOpenDialog(windows.settings, {
      title: 'Upload a 3D character',
      buttonLabel: 'Upload',
      properties: ['openFile'],
      filters: [{ name: '3D character (binary glTF)', extensions: ['glb'] }],
    });
    if (pick.canceled || !pick.filePaths[0]) return { ok: false, canceled: true };
    try {
      const character = await characters.importGlb(pick.filePaths[0]);
      pushState();
      return { ok: true, character };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'The model could not be imported.' };
    }
  });
  ipcMain.handle('characters:save-created', async (e, input: SaveCreatedInput) => {
    if (!fromSettings(e)) throw new Error('Not allowed');
    const info = await characters.saveCreated(input);
    pushState();
    return info;
  });
  ipcMain.handle('characters:update', (e, id: unknown, patch: Record<string, unknown>) => {
    if (!fromSettings(e) || typeof id !== 'string') throw new Error('Not allowed');
    const info = characters.update(id, patch ?? {});
    pushState();
    return info;
  });
  ipcMain.handle('characters:delete', async (e, id: unknown) => {
    if (!fromSettings(e) || typeof id !== 'string') throw new Error('Not allowed');
    const removed = await characters.remove(id);
    if (removed && settings.characterId === id) saveSettings({ ...settings, characterId: BUILTIN_CHARACTER.id });
    pushState();
    return removed;
  });
  ipcMain.handle('characters:select', (e, id: unknown) => {
    if (!fromSettings(e) || typeof id !== 'string' || !characters.get(id)) throw new Error('Not allowed');
    saveSettings({ ...settings, characterId: id });
    pushState();
    return settings;
  });
  // Both windows load custom models (the overlay to show it, settings to preview it).
  ipcMain.handle('characters:load', (e, id: unknown) => {
    if ((!fromSettings(e) && !fromMascot(e)) || typeof id !== 'string') throw new Error('Not allowed');
    return characters.readModel(id);
  });

  // ----------------------------------------------------------- IPC: overlay
  ipcMain.on('mascot:ready', (e) => fromMascot(e) && windows.showMascot());
  ipcMain.on('mascot:hit-region', (e, value: unknown) => fromMascot(e) && windows.setHitRegion(toHitRegion(value)));
  ipcMain.on('mascot:done', (e) => {
    if (!fromMascot(e)) return;
    windows.hideMascot();
    pushState();
  });
  ipcMain.handle('reminder:respond', (e, raw: unknown): ResponseResult => {
    const kind = toResponse(raw);
    if (!fromMascot(e) || !kind) throw new Error('Not allowed');
    // The reminder on screen, as currently configured.
    const r = settings.reminders.find((x) => x.id === activeReminder?.id) ?? activeReminder ?? water();
    const done = kind === 'done' ? log.done(r.id) : log.doneToday(r.id);
    scheduler.reschedule(r.id, kind === 'done' ? 'done' : kind === 'skip' ? 'skip' : 'later');
    const progress = typeOf(r).progress(r, done);
    const { exitPath, exitGait } = settings.general;
    return { progress, goalReached: !!progress && progress.done >= progress.goal, snoozeMinutes: r.snoozeMinutes, exitPath, exitGait };
  });

  // ------------------------------------------------------------- lifecycle
  windows.createMascot();
  scheduler.start();
  pushState();

  const openedAtLogin =
    process.argv.includes('--hidden') ||
    (process.platform === 'darwin' && app.isPackaged && app.getLoginItemSettings().wasOpenedAtLogin);
  if (!openedAtLogin) windows.showSettings();

  // Re-check right away when the laptop wakes or the user comes back.
  for (const event of ['resume', 'unlock-screen', 'user-did-become-active'] as const) {
    try {
      powerMonitor.on(event as 'resume', () => scheduler.tick());
    } catch {
      /* event not available on this platform */
    }
  }

  app.on('second-instance', () => windows.showSettings());
  app.on('activate', () => windows.showSettings()); // macOS: Dock icon clicked
  app.on('before-quit', () => {
    windows.quitting = true;
    scheduler.stop();
    tray.destroy();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    if (!DEV_SERVER_URL) serveRenderer();
    main();
  });
  // Keep running in the tray when windows are closed; quit from the tray menu.
  app.on('window-all-closed', () => {});
}
