import { contextBridge, ipcRenderer } from 'electron';
// Type-only imports: a sandboxed preload can't load other local modules at runtime.
import type {
  AppState,
  CharacterInfo,
  DeepPartial,
  HitRegion,
  ImportResult,
  ReminderContext,
  ReminderResponse,
  ResponseResult,
  SaveCreatedInput,
  Settings,
} from '../shared/types';

type Unsubscribe = () => void;

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): Unsubscribe {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  // ------------------------------------------------------------ settings UI
  getState: (): Promise<AppState> => ipcRenderer.invoke('state:get'),
  onState: (cb: (state: AppState) => void) => subscribe<[AppState]>('state', cb),
  updateSettings: (patch: DeepPartial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:update', patch),
  testReminder: () => ipcRenderer.send('reminder:test'),
  logGlass: (): Promise<number> => ipcRenderer.invoke('glass:log'),
  pause: (minutes: number | 'tomorrow') => ipcRenderer.send('reminders:pause', minutes),
  resume: () => ipcRenderer.send('reminders:resume'),

  characters: {
    import: (): Promise<ImportResult> => ipcRenderer.invoke('characters:import'),
    saveCreated: (input: SaveCreatedInput): Promise<CharacterInfo> => ipcRenderer.invoke('characters:save-created', input),
    update: (id: string, patch: { name?: string; thumbnail?: string; animations?: string[] }): Promise<CharacterInfo | null> =>
      ipcRenderer.invoke('characters:update', id, patch),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke('characters:delete', id),
    select: (id: string): Promise<Settings> => ipcRenderer.invoke('characters:select', id),
    load: (id: string): Promise<Uint8Array | null> => ipcRenderer.invoke('characters:load', id),
  },

  // ---------------------------------------------------------------- overlay
  onReminderStart: (cb: (ctx: ReminderContext) => void) => subscribe<[ReminderContext]>('reminder:start', cb),
  mascotReady: () => ipcRenderer.send('mascot:ready'),
  /** Where the reminder card is (window-relative CSS px), or null when hidden. */
  setHitRegion: (region: HitRegion | null) => ipcRenderer.send('mascot:hit-region', region),
  /** Whether the cursor is over the card (the overlay is clickable). */
  onPointer: (cb: (overCard: boolean) => void) => subscribe<[boolean]>('mascot:pointer', cb),
  respond: (kind: ReminderResponse): Promise<ResponseResult> => ipcRenderer.invoke('reminder:respond', kind),
  mascotDone: () => ipcRenderer.send('mascot:done'),
};

export type AquaMateApi = typeof api;

contextBridge.exposeInMainWorld('aquamate', api);
