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

/** The reminder card's box inside the overlay, in window-relative CSS pixels. */
export interface HitRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowManagerOptions {
  preload: string;
  urlFor: (view: View) => string;
  onPanelClosed: () => void;
}

// Click-through is applied on Windows and macOS. Linux (especially Wayland)
// can't report the cursor over a click-through window, so there the overlay
// simply stays clickable while it is on screen.
const supportsClickThrough = process.platform === 'win32' || process.platform === 'darwin';
const POINTER_POLL_MS = 40;
const HIT_PADDING = 8;

export class WindowManager {
  panel: BrowserWindow | null = null;
  mascot: BrowserWindow | null = null;
  private reminderActive = false;
  private status: Status = 'idle';
  private hitRegion: HitRegion | null = null;
  private pointerTimer: ReturnType<typeof setInterval> | null = null;
  private interactive = false;

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
      // macOS: the overlay is never focused, so without this the first click
      // on a card button would only focus the window instead of pressing it.
      acceptFirstMouse: true,
      webPreferences: this.webPreferences(),
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    // skipTransformProcessType keeps AquaMate's Dock icon and menu bar on macOS
    // (otherwise Electron turns the whole app into a Dock-less background app).
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    if (supportsClickThrough) win.setIgnoreMouseEvents(true);
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
    this.setHitRegion(null);
    win.hide();
    this.reminderActive = false;
    if (this.status === 'active') this.setStatus('idle');
  }

  /**
   * Clicks pass through the transparent overlay except over the reminder card.
   * The renderer reports where the card is (or null when it is hidden), and
   * the main process watches the cursor itself. That works whether or not
   * the overlay is focused, unlike mouse-move forwarding.
   */
  setHitRegion(region: HitRegion | null): void {
    this.hitRegion = region;
    if (region) {
      this.updatePointer();
      this.pointerTimer ??= setInterval(() => this.updatePointer(), POINTER_POLL_MS);
    } else {
      if (this.pointerTimer) clearInterval(this.pointerTimer);
      this.pointerTimer = null;
      this.setInteractive(false);
    }
  }

  private updatePointer(): void {
    const win = this.mascot;
    const r = this.hitRegion;
    if (!win || win.isDestroyed() || !r || !win.isVisible()) return this.setInteractive(false);
    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getContentBounds();
    const x = cursor.x - bounds.x;
    const y = cursor.y - bounds.y;
    this.setInteractive(
      x >= r.x - HIT_PADDING &&
        x <= r.x + r.width + HIT_PADDING &&
        y >= r.y - HIT_PADDING &&
        y <= r.y + r.height + HIT_PADDING,
    );
  }

  private setInteractive(interactive: boolean): void {
    const win = this.mascot;
    if (!win || win.isDestroyed() || interactive === this.interactive) return;
    this.interactive = interactive;
    if (supportsClickThrough) win.setIgnoreMouseEvents(!interactive);
    win.webContents.send('mascot:pointer', interactive);
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
