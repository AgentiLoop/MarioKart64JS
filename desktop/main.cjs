// Electron shell: serves the Vite build (game/) over app://game so absolute paths and fetch() work.
const { app, BrowserWindow, protocol, net, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, 'game');
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

app.whenReady().then(() => {
  protocol.handle('app', req => {
    const rel = decodeURIComponent(new URL(req.url).pathname);
    const file = path.normalize(path.join(ROOT, rel === '/' ? 'index.html' : rel));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1280, height: 960, backgroundColor: '#000000', title: 'MarioKart64JS',
    webPreferences: { contextIsolation: true, sandbox: true, autoplayPolicy: 'no-user-gesture-required' },
  });
  win.on('page-title-updated', e => e.preventDefault()); // keep "MarioKart64JS" instead of the page <title>
  win.loadURL('app://game/index.html');
});

app.on('window-all-closed', () => app.quit());
