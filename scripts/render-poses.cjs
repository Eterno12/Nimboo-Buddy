/**
 * Gera as imagens de pose do mascote para o widget do Android (uma por personagem, cor, acessório e pose).
 * Uso (com `npm run dev:mobile` rodando em 5174):
 *   electron scripts/render-poses.cjs <pasta de saída>
 * Saída: <char>_<cor>_<acessório|none>_<pose>.png (256×256, fundo transparente).
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ALL = ['mochi', 'pineapple', 'square', 'mushroom', 'cactus', 'cloud', 'planet', 'ghost'];
const CHARACTERS = process.env.ONLY ? process.env.ONLY.split(',') : ALL;
const COLORS = ['mint', 'peach', 'sky', 'lilac', 'lemon', 'rose'];
const POSES = ['idle', 'happy', 'curious', 'sleepy', 'celebrate', 'surprised'];
// Os acessórios de cada personagem (ids em shared/skins.ts).
const SKINS = {
  mochi: ['mochi.laco', 'mochi.oculos'],
  pineapple: ['pineapple.faixa', 'pineapple.colar'],
  square: ['square.gravata', 'square.cartola'],
  mushroom: ['mushroom.flor', 'mushroom.leitura'],
  cactus: ['cactus.bandana', 'cactus.escuros'],
  cloud: ['cloud.arco', 'cloud.gorro'],
  planet: ['planet.antena', 'planet.capacete'],
  ghost: ['ghost.festa', 'ghost.mascara'],
};

const out = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0];
const base = process.env.POSES_URL || 'http://localhost:5174/poses.html';
app.disableHardwareAcceleration();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(out, { recursive: true });
  const win = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  win.webContents.setFrameRate(10);
  let count = 0;
  for (const c of CHARACTERS) {
    const colors = c === 'mochi' ? COLORS : ['mint'];
    for (const color of colors) {
      for (const skin of [null, ...SKINS[c]]) {
        for (const state of POSES) {
          const q = new URLSearchParams({ c, color, state });
          if (skin) q.set('skin', skin);
          await win.loadURL(`${base}?${q}`);
          for (let i = 0; i < 40 && !(await win.webContents.executeJavaScript('window.__poseReady === true')); i++) await sleep(50);
          await sleep(420); // deixa as transições do rosto terminarem
          const img = await win.webContents.capturePage();
          const file = path.join(out, `${c}_${color}_${skin ? skin.split('.')[1] : 'none'}_${state}.png`);
          fs.writeFileSync(file, img.toPNG());
          count++;
        }
      }
    }
  }
  console.log('imagens:', count);
  app.quit();
});
