// Abre uma janela do Electron numa URL (para testar a versão web do app móvel com o Chromium real).
// Uso: electron browser-host.cjs --user-data-dir=... --remote-debugging-port=... -- <url>
const { app, BrowserWindow } = require('electron');

const url = process.argv[process.argv.length - 1];
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 390, height: 780, show: false, webPreferences: { contextIsolation: true } });
  win.loadURL(url);
});
app.on('window-all-closed', () => app.quit());
