import { contextBridge, ipcRenderer } from 'electron';
// Type-only imports: a sandboxed preload can't load other local modules at runtime.
import type { AquaMateApi, Unsubscribe } from '../shared/api';
import type { AppState, HitRegion, ReminderContext } from '../shared/types';

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): Unsubscribe {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: AquaMateApi = {
  // ------------------------------------------------------------ settings UI
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb: (state: AppState) => void) => subscribe<[AppState]>('state', cb),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  updateReminder: (id, patch) => ipcRenderer.invoke('reminders:update', id, patch),
  addReminder: (type) => ipcRenderer.invoke('reminders:add', type),
  removeReminder: (id) => ipcRenderer.invoke('reminders:remove', id),
  testReminder: (id) => ipcRenderer.send('reminder:test', id),
  logGlass: () => ipcRenderer.invoke('glass:log'),
  logDone: (id) => ipcRenderer.invoke('reminders:done', id),
  pause: (minutes) => ipcRenderer.send('reminders:pause', minutes),
  resume: () => ipcRenderer.send('reminders:resume'),
  setRelax: (on) => ipcRenderer.send('relax:set', on === true),

  characters: {
    import: () => ipcRenderer.invoke('characters:import'),
    saveCreated: (input) => ipcRenderer.invoke('characters:save-created', input),
    update: (id, patch) => ipcRenderer.invoke('characters:update', id, patch),
    remove: (id) => ipcRenderer.invoke('characters:delete', id),
    select: (id) => ipcRenderer.invoke('characters:select', id),
    load: (id) => ipcRenderer.invoke('characters:load', id),
  },

  // ---------------------------------------------------------------- overlay
  onReminderStart: (cb: (ctx: ReminderContext) => void) => subscribe<[ReminderContext]>('reminder:start', cb),
  onRelax: (cb: (ctx: ReminderContext | null) => void) => subscribe<[ReminderContext | null]>('relax', cb),
  mascotReady: () => ipcRenderer.send('mascot:ready'),
  /** Where the reminder card is (window-relative CSS px), or null when hidden. */
  setHitRegion: (region: HitRegion | null) => ipcRenderer.send('mascot:hit-region', region),
  /** Whether the cursor is over the card (the overlay is clickable). */
  onPointer: (cb: (overCard: boolean) => void) => subscribe<[boolean]>('mascot:pointer', cb),
  respond: (kind) => ipcRenderer.invoke('reminder:respond', kind),
  mascotDone: () => ipcRenderer.send('mascot:done'),
};

contextBridge.exposeInMainWorld('aquamate', api);
