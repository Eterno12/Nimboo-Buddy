import fs from 'node:fs';
import { app, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { IPC } from '../shared/ipc';
import { EMPTY_MEDIA, parseMediaCommand, type MediaCommand, type MediaState } from '../shared/media';
import { createFixtureMedia, createMediaSession, type MediaSource } from './media/mediaSession';

export interface MediaService {
  /** Liga ou desliga o leitor (preferência `mediaPlayer`). */
  setEnabled(enabled: boolean): void;
  command(cmd: MediaCommand): void;
  state(): MediaState;
  close(): void;
}

interface MediaServiceOptions {
  isAppUrl(url: string): boolean;
  enabled: boolean;
}

/**
 * Player de música: lê o que está tocando no Windows e repassa comandos (tocar/pausar, próxima, anterior,
 * ir para). Só roda com a preferência ligada; tudo é local, sem rede.
 */
export function startMediaService({ isAppUrl, enabled }: MediaServiceOptions): MediaService {
  const broadcast = (state: MediaState) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        win.webContents.send(IPC.mediaChanged, state);
      } catch {
        /* janela fechando */
      }
    }
  };

  const fixture = !app.isPackaged ? process.env.MOCHI_E2E_MEDIA_FIXTURE : undefined;
  const source: MediaSource =
    fixture && fs.existsSync(fixture)
      ? createFixtureMedia(fixture, broadcast)
      : createMediaSession({ onChange: broadcast });
  let running = false;

  const setEnabled = (on: boolean) => {
    if (on && !running) {
      running = true;
      source.start();
    } else if (!on && running) {
      running = false;
      source.stop();
    }
  };

  const trusted = (event: IpcMainInvokeEvent | IpcMainEvent): boolean => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return false;
    if (event.senderFrame !== event.sender.mainFrame) return false;
    return isAppUrl(event.senderFrame?.url ?? '');
  };

  ipcMain.handle(IPC.mediaGet, (event): MediaState => (trusted(event) ? source.state() : { ...EMPTY_MEDIA }));
  const onCommand = (event: IpcMainEvent, raw: unknown) => {
    if (!trusted(event) || !running) return;
    const cmd = parseMediaCommand(raw);
    if (cmd) source.command(cmd);
  };
  ipcMain.on(IPC.mediaCommand, onCommand);

  setEnabled(enabled);

  return {
    setEnabled,
    command: (cmd) => {
      if (running) source.command(cmd);
    },
    state: () => source.state(),
    close() {
      setEnabled(false);
      ipcMain.removeHandler(IPC.mediaGet);
      ipcMain.removeListener(IPC.mediaCommand, onCommand);
    },
  };
}
