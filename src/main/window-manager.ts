import { BrowserWindow, nativeTheme, screen } from 'electron';
import type { HitRegion, ReminderContext } from '../shared/types';

/**
 * Owns the two windows:
 *  - the settings window (today's progress, reminder options, characters)
 *  - the mascot overlay (frameless, transparent, always-on-top, click-through)
 *
 * Overlay flags and bottom-of-screen positioning are adapted from
 * hydrate-buddy (MIT, (c) 2026 sharada-dev); see THIRD_PARTY_NOTICES.md.
 */

// The overlay is a fixed strip along the bottom of the work area, as wide as
// the screen, so the character can walk all the way across it. The window
// never moves while visible; the character walks inside it, which keeps
// motion smooth and avoids the flicker of per-frame setBounds() calls.
export const MASCOT_HEIGHT = 440;

export type View = 'settings' | 'mascot';

export interface WindowManagerOptions {
  preload: string;
  urlFor: (view: View) => string;
  onSettingsReady: () => void;
}

// Click-through is applied on Windows and macOS. Linux (especially Wayland)
// can't report the cursor over a click-through window, so there the overlay
// simply stays clickable while it is on screen.
const supportsClickThrough = process.platform === 'win32' || process.platform === 'darwin';
const POINTER_POLL_MS = 40;
const HIT_PADDING = 8;

export class WindowManager {
  settings: BrowserWindow | null = null;
  mascot: BrowserWindow | null = null;
  quitting = false;
  private active = false;
  private hitRegion: HitRegion | null = null;
  private pointerTimer: ReturnType<typeof setInterval> | null = null;
  private interactive = false;

  constructor(private readonly opts: WindowManagerOptions) {
    screen.on('display-metrics-changed', () => this.positionMascot());
    screen.on('display-removed', () => this.positionMascot());
  }

  get reminderActive(): boolean {
    return this.active;
  }

  // ---------------------------------------------------------------- settings
  showSettings(): void {
    if (this.settings && !this.settings.isDestroyed()) {
      if (this.settings.isMinimized()) this.settings.restore();
      this.settings.show();
      this.settings.focus();
      return;
    }
    const win = new BrowserWindow({
      width: 960,
      height: 680,
      minWidth: 860,
      minHeight: 600,
      title: 'AquaMate',
      show: false,
      autoHideMenuBar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#14171c' : '#f3f6fa',
      webPreferences: this.webPreferences(),
    });
    this.settings = win;
    this.harden(win);
    win.loadURL(this.opts.urlFor('settings'));
    win.once('ready-to-show', () => {
      win.show();
      win.focus();
    });
    win.webContents.on('did-finish-load', () => this.opts.onSettingsReady());
    // Closing hides the window: AquaMate keeps reminding from the tray.
    win.on('close', (e) => {
      if (!this.quitting) {
        e.preventDefault();
        win.hide();
      }
    });
    win.on('closed', () => {
      this.settings = null;
    });
  }

  sendToSettings(channel: string, payload: unknown): void {
    const win = this.settings;
    if (win && !win.isDestroyed() && !win.webContents.isLoading()) win.webContents.send(channel, payload);
  }

  // ----------------------------------------------------------------- overlay
  createMascot(): void {
    const win = new BrowserWindow({
      width: 800,
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
    this.mascot = win;
    this.positionMascot(); // full width from the start, so the first layout is already right
    win.loadURL(this.opts.urlFor('mascot'));
  }

  /** The bottom strip of the display the user is working on. */
  positionMascot(): void {
    const win = this.mascot;
    if (!win || win.isDestroyed()) return;
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { x, y, width, height } = display.workArea;
    win.setBounds({ x, y: y + height - MASCOT_HEIGHT, width, height: MASCOT_HEIGHT });
  }

  /** Step 1: place the (still hidden) overlay and let the renderer stage the character off-screen. */
  startReminder(ctx: ReminderContext): boolean {
    const win = this.mascot;
    if (!win || win.isDestroyed() || this.active) return false;
    this.active = true;
    this.positionMascot();
    win.webContents.send('reminder:start', ctx);
    return true;
  }

  /** Step 2: the renderer is staged, so showing cannot flash stale frames. */
  showMascot(): void {
    const win = this.mascot;
    if (!win || win.isDestroyed() || !this.active) return;
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
    this.active = false;
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

  isFrom(e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent, view: View): boolean {
    const win = view === 'settings' ? this.settings : this.mascot;
    return !!win && !win.isDestroyed() && e.sender === win.webContents;
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
