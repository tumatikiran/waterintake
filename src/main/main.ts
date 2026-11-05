import { app, ipcMain, net, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WindowManager, type HitRegion, type View } from './window-manager';

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIR = path.join(__dirname, '..', 'dist-renderer');
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
].join('; ');

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

let windows: WindowManager | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const panel = windows?.panel;
    if (panel) {
      if (panel.isMinimized()) panel.restore();
      panel.show();
      panel.focus();
    }
  });

  app.whenReady().then(() => {
    if (!DEV_SERVER_URL) serveRenderer();

    windows = new WindowManager({
      preload: path.join(__dirname, 'preload.js'),
      urlFor,
      onPanelClosed: () => app.quit(),
    });
    windows.createWindows();

    ipcMain.on('reminder:test', () => windows?.startReminder());
    ipcMain.on('mascot:ready', () => windows?.showMascot());
    ipcMain.on('mascot:hit-region', (_e, value: unknown) => windows?.setHitRegion(toHitRegion(value)));
    ipcMain.on('mascot:done', () => windows?.hideMascot());
    ipcMain.on('reminder:response', (_e, kind: unknown) => {
      if (kind === 'drank') windows?.setStatus('drank');
      else if (kind === 'dismiss') windows?.setStatus('dismissed');
    });
  });

  app.on('window-all-closed', () => app.quit());
}
