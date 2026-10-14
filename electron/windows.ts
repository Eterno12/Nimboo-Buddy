import os from 'node:os';
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
  if (glassSupported() && GLASS_PAGES.has(hash.split('=')[0])) {
    // A interface desenha a barra de título (a janela não tem moldura do sistema).
    win.webContents.on('dom-ready', () => {
      void win.webContents.executeJavaScript("document.documentElement.dataset.frameless = '1'").catch(() => undefined);
    });
  }
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

/**
 * Vidro escuro: acrílico nativo no Windows 11 22H2+ (a janela fica transparente e o sistema borra o que está
 * atrás); antes disso, um fundo escuro sólido sob as camadas translúcidas do CSS dá quase o mesmo visual.
 */
export function glassSupported(): boolean {
  return process.platform === 'win32' && Number(os.release().split('.')[2] ?? 0) >= 22621;
}

/**
 * Só a combinação janela transparente + sem moldura recebe o acrílico de verdade (testado em campo: com a
 * moldura do sistema o Windows ignora o material). Por isso a barra de título é desenhada pela interface.
 */
function glassOptions(_dark: boolean): {
  backgroundColor: string;
  backgroundMaterial?: 'acrylic';
  transparent?: boolean;
  frame?: boolean;
} {
  return glassSupported()
    ? { backgroundColor: '#00000000', backgroundMaterial: 'acrylic', transparent: true, frame: false }
    : { backgroundColor: '#2b2335' };
}

const GLASS_PAGES = new Set(['panel', 'assistant', 'achievements', 'welcome', 'notes']);

export function createPanelWindow(dark = false): BrowserWindow {
  const win = new BrowserWindow({
    width: 400,
    height: 680,
    minWidth: 320,
    minHeight: 440,
    title: 'Nimboo',
    autoHideMenuBar: true,
    show: false,
    ...glassOptions(dark),
    webPreferences: secureWebPreferences(),
  });
  lockNavigation(win);
  loadRenderer(win, 'panel');
  return win;
}

/** Janela de conversa do assistente. */
export function createAssistantWindow(dark: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 440,
    height: 660,
    minWidth: 340,
    minHeight: 420,
    title: 'Assistente — Nimboo',
    autoHideMenuBar: true,
    show: false,
    ...glassOptions(dark),
    webPreferences: secureWebPreferences(),
  });
  lockNavigation(win);
  loadRenderer(win, 'assistant');
  win.once('ready-to-show', () => win.show());
  return win;
}

/** Janela de boas-vindas (primeira execução guiada). */
export function createWelcomeWindow(dark: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 560,
    height: 640,
    minWidth: 400,
    minHeight: 520,
    title: 'Bem-vindo — Nimboo',
    autoHideMenuBar: true,
    show: false,
    center: true,
    ...glassOptions(dark),
    webPreferences: secureWebPreferences(),
  });
  lockNavigation(win);
  loadRenderer(win, 'welcome');
  win.once('ready-to-show', () => win.show());
  return win;
}

/** Janela das conquistas (perfil de vínculo e lista de troféus). */
export function createAchievementsWindow(dark: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 560,
    height: 700,
    minWidth: 420,
    minHeight: 460,
    title: 'Conquistas — Nimboo',
    autoHideMenuBar: true,
    show: false,
    ...glassOptions(dark),
    webPreferences: secureWebPreferences(),
  });
  lockNavigation(win);
  loadRenderer(win, 'achievements');
  win.once('ready-to-show', () => win.show());
  return win;
}

/**
 * Aviso de conquista (estilo "troféu"): cartão sem borda no canto inferior direito, por cima de tudo,
 * sem tirar o foco de quem está trabalhando e sem aparecer na barra de tarefas.
 */
export function createToastWindow(achievementId: string, workArea: Rect): BrowserWindow {
  const width = 380;
  const height = 104;
  const win = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - 16,
    y: workArea.y + workArea.height - height - 16,
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
    webPreferences: secureWebPreferences(),
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  lockNavigation(win);
  loadRenderer(win, `toast=${achievementId}`);
  win.once('ready-to-show', () => win.showInactive());
  return win;
}

/** Cor de fundo das janelas de nota (igual à do papel em notes.css; a janela nasce já pintada). */
const NOTE_PAPER: Record<string, string> = {
  yellow: '#fff3a8',
  pink: '#ffd9e4',
  blue: '#d6ecff',
  green: '#d9f5d3',
  lilac: '#e6dcff',
  white: '#fffdf8',
};

/** Janela de gerenciamento das notas (lista, busca e editor), redimensionável. */
export function createNotesWindow(openId: string | null, dark: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 860,
    height: 600,
    minWidth: 560,
    minHeight: 380,
    title: 'Notas — Nimboo',
    autoHideMenuBar: true,
    show: false,
    ...glassOptions(dark),
    webPreferences: secureWebPreferences(),
  });
  lockNavigation(win);
  loadRenderer(win, openId ? `notes=${openId}` : 'notes');
  win.once('ready-to-show', () => win.show());
  return win;
}

/**
 * Nota flutuante: uma folha solta na área de trabalho. NÃO fica sobre os outros aplicativos (não é
 * "sempre no topo": é uma janela comum, sem borda e fora da barra de tarefas).
 */
export function createNoteWindow(id: string, color: string, bounds: Rect): BrowserWindow {
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 220,
    minHeight: 160,
    frame: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    hasShadow: true,
    show: false,
    title: 'Nota — Nimboo',
    backgroundColor: NOTE_PAPER[color] ?? NOTE_PAPER.yellow,
    webPreferences: secureWebPreferences(),
  });
  lockNavigation(win);
  loadRenderer(win, `note=${id}`);
  win.once('ready-to-show', () => win.show());
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
 * Janela da linha branca no topo da tela, mostrada enquanto o Nimboo está no canto
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
