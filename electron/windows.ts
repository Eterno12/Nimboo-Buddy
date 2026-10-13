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

/**
 * HTML mínimo da linha-dica (sem JavaScript, sem preload). A CSP bloqueia tudo
 * exceto o estilo embutido.
 */
const EDGE_HINT_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  body { transition: opacity .2s ease-out; }
  body.out { opacity: 0; }
  /* Linha rente ao topo que afina nas pontas e perde opacidade (como a ilha, que "pousa" no topo). */
  svg { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible;
        filter: drop-shadow(0 0 4px rgba(255,255,255,.55));
        transform-origin: 50% 0; opacity: 0;
        animation: appear .42s cubic-bezier(.23,1,.32,1) .08s both, glow 3.6s ease-in-out .5s infinite; }
  @keyframes appear { from { transform: scaleX(.18); opacity: 0; } to { transform: none; opacity: .9; } }
  @keyframes glow { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
</style></head><body>
<svg viewBox="0 0 280 8" preserveAspectRatio="none" aria-hidden="true">
  <defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="280" y2="0">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".18" stop-color="#fff" stop-opacity=".28"/>
    <stop offset=".38" stop-color="#fff" stop-opacity=".8"/><stop offset=".5" stop-color="#fff"/>
    <stop offset=".62" stop-color="#fff" stop-opacity=".8"/><stop offset=".82" stop-color="#fff" stop-opacity=".28"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
  <!-- lente: borda superior reta, a de baixo curva até encontrar o topo nas pontas (~2,6px no centro) -->
  <path d="M0 0 L280 0 Q140 5.2 0 0 Z" fill="url(#g)"/>
</svg></body></html>`;

/** Recomeça a animação de aparecer (a janela é reutilizada ao reaparecer). */
export const EDGE_HINT_RESET_JS = `(()=>{document.body.classList.remove('out');const s=document.querySelector('svg');s.style.animation='none';void s.getBoundingClientRect();s.style.animation='';})()`;
/** Esmaece a linha (a ilha está surgindo a partir dela). */
export const EDGE_HINT_FADE_JS = `document.body.classList.add('out')`;

/**
 * Janela da linha branca no topo da tela, mostrada enquanto o Mochi está no canto
 * (a ilha escondida): indica onde levar o cursor para trazer a ilha de volta.
 * Não recebe foco nem cliques (atravessante) e não aparece na barra de tarefas.
 */
export function createEdgeHintWindow(bounds: Rect): BrowserWindow {
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  // O Windows impõe uma altura mínima de janela (~39 px). A forma limita o desenho e a área
  // ocupada à faixa pedida (a linha e o brilho), então o resto da janela não existe na tela.
  win.setShape([{ x: 0, y: 0, width: bounds.width, height: bounds.height }]);
  lockNavigation(win);
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(EDGE_HINT_HTML)}`);
  return win;
}
