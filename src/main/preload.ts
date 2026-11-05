import { contextBridge, ipcRenderer } from 'electron';

type Unsubscribe = () => void;

function subscribe<T extends unknown[]>(channel: string, cb: (...args: T) => void): Unsubscribe {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  // control panel -> main
  testReminder: () => ipcRenderer.send('reminder:test'),
  onStatus: (cb: (status: string) => void) => subscribe<[string]>('status', cb),
  // main -> mascot
  onReminderStart: (cb: () => void) => subscribe<[]>('reminder:start', cb),
  // mascot -> main
  mascotReady: () => ipcRenderer.send('mascot:ready'),
  setInteractive: (interactive: boolean) => ipcRenderer.send('mascot:interactive', interactive),
  respond: (kind: 'drank' | 'dismiss') => ipcRenderer.send('reminder:response', kind),
  mascotDone: () => ipcRenderer.send('mascot:done'),
};

export type AquaMateApi = typeof api;

contextBridge.exposeInMainWorld('aquamate', api);
