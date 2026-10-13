import { BrowserWindow, shell } from 'electron';
import path from 'node:path';
import type { Rect } from '../shared/geometry';

/** Lado da janela do mascote no modo flutuante (DIP). */
export const MASCOT_SIZE = 240;

const devServerUrl = process.env.VITE_DEV_SERVER_URL;

function secureWebPreferences(): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
  };
}

function lockNavigation(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}

function loadRenderer(win: BrowserWindow, hash: string): void {
  if (devServerUrl) {
    void win.loadURL(`${devServerUrl}#${hash}`);
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash });
  }
}

export interface MascotWindowOptions {
  /** A ilha recolhida não deve roubar o foco do app em que o usuário está. */
  focusable: boolean;
}

export function createMascotWindow(bounds: Rect, options: MascotWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    focusable: options.focusable,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: secureWebPreferences(),
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  lockNavigation(win);
  win.once('ready-to-show', () => win.show());
  loadRenderer(win, 'mascot');
  return win;
}

export function createPanelWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 380,
    height: 520,
    title: 'Mochi',
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#fdf8f3',
    webPreferences: secureWebPreferences(),
  });
  lockNavigation(win);
  loadRenderer(win, 'panel');
  return win;
}
