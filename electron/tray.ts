import { nativeImage, Tray, type Menu } from 'electron';

/** Gera um ícone 32x32 (círculo menta) em memória, sem depender de arquivos. */
function createTrayIcon() {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const i = (y * size + x) * 4;
      const alpha = Math.max(0, Math.min(1, c - d + 0.5));
      // BGRA
      buf[i] = 0xb4;
      buf[i + 1] = 0xe0;
      buf[i + 2] = 0x7f;
      buf[i + 3] = Math.round(alpha * 255);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

export function createTray(menuProvider: () => Menu, onActivate: () => void): Tray {
  const tray = new Tray(createTrayIcon());
  tray.setToolTip('Mochi');
  tray.on('click', onActivate);
  tray.on('right-click', () => tray.popUpContextMenu(menuProvider()));
  return tray;
}
