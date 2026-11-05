// Hosts the Android web bundle (dist-mobile) in a phone-sized Electron window,
// so the phone UI can be tested without an emulator. Capacitor uses its web
// fallbacks here (localStorage, IndexedDB, HTML5 notifications).
const { app, BrowserWindow, net, protocol } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

if (process.env.AQUAMATE_USER_DATA) app.setPath('userData', process.env.AQUAMATE_USER_DATA);
const ROOT = path.resolve(__dirname, '..', 'dist-mobile');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const file = path.resolve(ROOT, decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html');
    if (!file.startsWith(ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  const [width, height] = (process.env.AQUAMATE_PHONE_SIZE || '412x915').split('x').map(Number);
  const win = new BrowserWindow({ width, height, useContentSize: true, title: 'AquaMate (phone)', webPreferences: { contextIsolation: true } });
  win.loadURL('app://aquamate/index.html');
});
app.on('window-all-closed', () => app.quit());
