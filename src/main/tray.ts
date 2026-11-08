import { Menu, Tray, nativeImage } from 'electron';
import path from 'node:path';

export interface TrayStatus {
  enabled: boolean;
  glassesToday: number;
  dailyGoal: number;
  nextReminderAt: number | null;
  pausedUntil: number | null;
  relaxing: boolean;
  /** Relax mode can start now (nothing else is on screen). */
  canRelax: boolean;
}

export interface TrayActions {
  remindNow(): void;
  logGlass(): void;
  setRelax(on: boolean): void;
  pause(minutes: number | 'tomorrow'): void;
  resume(): void;
  openSettings(): void;
  quit(): void;
}

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function whenLabel(t: number): string {
  const sameDay = new Date(t).toDateString() === new Date().toDateString();
  return sameDay ? time(t) : `${new Date(t).toLocaleDateString([], { weekday: 'short' })} ${time(t)}`;
}

/** Menu-bar (macOS) / system-tray (Windows, Linux) icon. Reminders keep running while the settings window is closed. */
export class AppTray {
  private tray: Tray | null = null;

  constructor(
    iconDir: string,
    private readonly actions: TrayActions,
  ) {
    try {
      const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
      const icon = nativeImage.createFromPath(path.join(iconDir, file));
      if (process.platform === 'darwin') icon.setTemplateImage(true);
      this.tray = new Tray(icon);
      this.tray.setToolTip('AquaMate');
      if (process.platform === 'win32') this.tray.on('click', () => actions.openSettings());
    } catch (err) {
      // Some Linux desktops have no tray; the settings window still works.
      console.warn('[AquaMate] Tray unavailable:', err);
    }
  }

  update(s: TrayStatus): void {
    if (!this.tray) return;
    const a = this.actions;
    const schedule = !s.enabled
      ? 'Reminders are off'
      : s.pausedUntil
        ? `Paused until ${whenLabel(s.pausedUntil)}`
        : s.nextReminderAt
          ? `Next reminder: ${whenLabel(s.nextReminderAt)}`
          : 'No reminders scheduled';
    const progress = `${s.glassesToday} of ${s.dailyGoal} glasses today`;
    this.tray.setToolTip(`AquaMate · ${progress}`);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: progress, enabled: false },
        { label: schedule, enabled: false },
        { type: 'separator' },
        { label: 'Remind me now', click: () => a.remindNow() },
        { label: 'I drank a glass 💧', click: () => a.logGlass() },
        {
          label: 'Relax mode 🌿',
          type: 'checkbox',
          checked: s.relaxing,
          enabled: s.relaxing || s.canRelax,
          click: () => a.setRelax(!s.relaxing),
        },
        { type: 'separator' },
        ...(s.pausedUntil
          ? [{ label: 'Resume reminders', click: () => a.resume() }]
          : [
              { label: 'Pause for 1 hour', click: () => a.pause(60), enabled: s.enabled },
              { label: 'Pause until tomorrow', click: () => a.pause('tomorrow'), enabled: s.enabled },
            ]),
        { type: 'separator' },
        { label: 'Settings…', click: () => a.openSettings() },
        { label: 'Quit AquaMate', click: () => a.quit() },
      ]),
    );
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}
