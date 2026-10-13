/**
 * Gera o ícone do app (build/icon.png, 512x512, fundo transparente) desenhando o mesmo blob do
 * mascote. Roda DENTRO do Electron (precisa de renderização), uma vez, e o resultado é versionado:
 *
 *   npx electron scripts/make-icon.cjs
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 512;

const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:transparent;overflow:hidden}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="8 22 184 184">
  <defs>
    <radialGradient id="b" cx="40%" cy="30%" r="80%">
      <stop offset="0%" stop-color="#e4fbd4"/><stop offset="100%" stop-color="#8fd9a8"/>
    </radialGradient>
    <linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="55%" stop-color="#2f8f5b" stop-opacity="0"/><stop offset="100%" stop-color="#2f8f5b" stop-opacity="0.28"/>
    </linearGradient>
    <linearGradient id="l" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0%" stop-color="#5fbf7f"/><stop offset="100%" stop-color="#a6e88f"/>
    </linearGradient>
  </defs>
  <ellipse cx="100" cy="186" rx="60" ry="9" fill="#2b2433" opacity="0.18"/>
  <path d="M100 78 C97 66 99 56 107 48 C117 56 116 70 102 78 Z" fill="url(#l)" stroke="#4aa56e" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M100 74 C142 70 172 98 173 132 C174 162 150 180 100 180 C50 180 26 162 27 132 C28 98 58 70 100 74 Z"
        fill="url(#b)" stroke="#5fb383" stroke-width="3"/>
  <path d="M100 74 C142 70 172 98 173 132 C174 162 150 180 100 180 C50 180 26 162 27 132 C28 98 58 70 100 74 Z" fill="url(#s)"/>
  <ellipse cx="68" cy="100" rx="16" ry="8" fill="#fff" opacity="0.5" transform="rotate(-25 68 100)"/>
  <ellipse cx="58" cy="140" rx="11" ry="7" fill="#ff9fb2"/><ellipse cx="142" cy="140" rx="11" ry="7" fill="#ff9fb2"/>
  <g fill="#3b3040"><ellipse cx="78" cy="124" rx="8" ry="11"/><ellipse cx="122" cy="124" rx="8" ry="11"/></g>
  <circle cx="81" cy="119" r="3" fill="#fff"/><circle cx="125" cy="119" r="3" fill="#fff"/>
  <path d="M91 144 Q100 152 109 144" fill="none" stroke="#3b3040" stroke-width="3.5" stroke-linecap="round"/>
</svg>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: SIZE,
    height: SIZE,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 600));
  const image = await win.webContents.capturePage();
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, image.toPNG());
  console.log('icone gerado:', out, image.getSize());
  app.quit();
});
