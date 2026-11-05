import { BrowserWindow, screen } from 'electron';

/**
 * Owns the two windows of the prototype:
 *  - the control panel (a small, normal window with the "Test Reminder" button)
 *  - the mascot overlay (frameless, transparent, always-on-top, click-through)
 *
 * Window flags and the bottom-right positioning are adapted from
 * hydrate-buddy (MIT, (c) 2026 sharada-dev); see THIRD_PARTY_NOTICES.md.
 */

// The mascot window is a fixed "stage" in the bottom-right corner of the work
// area. The window itself never moves while visible: the character walks
// inside it, which keeps motion smooth and avoids the jitter/flicker that
// per-frame setBounds() calls cause on Windows and macOS.
export const MASCOT_WIDTH = 720;
export const MASCOT_HEIGHT = 440;

export type View = 'panel' | 'mascot';
export type Status = 'idle' | 'active' | 'drank' | 'dismissed';

export interface WindowManagerOptions {
  preload: string;
  urlFor: (view: View) => string;
  onPanelClosed: () => void;
}

const supportsClickThroughForwarding = process.platform === 'win32' || process.platform === 'darwin';

export class WindowManager {
  panel: BrowserWindow | null = null;
  mascot: BrowserWindow | null = null;
  private reminderActive = false;
  private status: Status = 'idle';

  constructor(private readonly opts: WindowManagerOptions) {}

  createWindows(): void {
    this.mascot = this.createMascot();
    this.panel = this.createPanel();
    screen.on('display-metrics-changed', () => this.positionMascot());
    screen.on('display-removed', () => this.positionMascot());
  }

  // ------------------------------------------------------------ control panel
  private createPanel(): BrowserWindow {
    const win = new BrowserWindow({
      width: 320,
      height: 240,
      title: 'AquaMate',
      show: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      backgroundColor: '#f4f8fd',
      webPreferences: this.webPreferences(),
    });
    win.setMenuBarVisibility(false);
    this.harden(win);
    win.loadURL(this.opts.urlFor('panel'));
    win.once('ready-to-show', () => win.show());
    win.webContents.on('did-finish-load', () => this.sendStatus());
    win.on('closed', () => {
      this.panel = null;
      this.opts.onPanelClosed();
    });
    return win;
  }

  // ----------------------------------------------------------- mascot overlay
  private createMascot(): BrowserWindow {
    const win = new BrowserWindow({
      width: MASCOT_WIDTH,
      height: MASCOT_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false, // a shadow around a transparent window shows as a ghost box on macOS
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      roundedCorners: false,
      webPreferences: this.webPreferences(),
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.setInteractive(false, win);
    this.harden(win);
    win.loadURL(this.opts.urlFor('mascot'));
    return win;
  }

  /** Bottom-right corner of the display the user is working on. */
  positionMascot(): void {
    const win = this.mascot;
    if (!win || win.isDestroyed()) return;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { x, y, width, height } = display.workArea;
    win.setBounds({
      x: Math.round(x + width - MASCOT_WIDTH),
      y: Math.round(y + height - MASCOT_HEIGHT),
      width: MASCOT_WIDTH,
      height: MASCOT_HEIGHT,
    });
  }

  /** Step 1: place the (still hidden) overlay and let the renderer reset its scene. */
  startReminder(): void {
    const win = this.mascot;
    if (!win || win.isDestroyed() || this.reminderActive) return;
    this.reminderActive = true;
    this.setStatus('active');
    this.positionMascot();
    win.webContents.send('reminder:start');
  }

  /** Step 2: the renderer has the character staged off-screen, so showing cannot flash old frames. */
  showMascot(): void {
    const win = this.mascot;
    if (!win || win.isDestroyed() || !this.reminderActive) return;
    win.showInactive(); // never steal keyboard focus from the user's work
    win.setAlwaysOnTop(true, 'screen-saver'); // re-assert after show (macOS)
    win.moveTop();
  }

  /** Step 3: the character has walked out of view. */
  hideMascot(): void {
    const win = this.mascot;
    if (!win || win.isDestroyed()) return;
    this.setInteractive(false, win);
    win.hide();
    this.reminderActive = false;
    if (this.status === 'active') this.setStatus('idle');
  }

  /** Clicks pass through the transparent overlay except over the reminder card. */
  setInteractive(interactive: boolean, win = this.mascot): void {
    if (!win || win.isDestroyed()) return;
    if (!supportsClickThroughForwarding) return; // Linux cannot forward mouse moves; keep it clickable
    if (interactive) win.setIgnoreMouseEvents(false);
    else win.setIgnoreMouseEvents(true, { forward: true });
  }

  setStatus(status: Status): void {
    this.status = status;
    this.sendStatus();
  }

  private sendStatus(): void {
    if (this.panel && !this.panel.isDestroyed()) this.panel.webContents.send('status', this.status);
  }

  private webPreferences(): Electron.WebPreferences {
    return {
      preload: this.opts.preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    };
  }

  private harden(win: BrowserWindow): void {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
  }
}
