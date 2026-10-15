import { registerPlugin } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import type { WidgetBridge } from './widgetBridge';

interface NimbooWidgetPlugin {
  refresh(): Promise<void>;
}

/** Plugin nativo (NimbooWidgetPlugin.java): só serve para pedir a atualização do widget. */
const Native = registerPlugin<NimbooWidgetPlugin>('NimbooWidget');

const SNAPSHOT = 'widget.json';
const INBOX = 'widget_inbox.json';

/** Resumo e caixa de entrada do widget ficam em arquivos na pasta privada do app (o código nativo lê os mesmos). */
export function nativeWidget(): WidgetBridge {
  return {
    async write(snapshot) {
      await Filesystem.writeFile({ path: SNAPSHOT, directory: Directory.Data, data: JSON.stringify(snapshot), encoding: Encoding.UTF8 });
    },
    async refresh() {
      try {
        await Native.refresh();
      } catch {
        /* sem widget instalado: nada a atualizar */
      }
    },
    async readInbox() {
      try {
        const r = await Filesystem.readFile({ path: INBOX, directory: Directory.Data, encoding: Encoding.UTF8 });
        return typeof r.data === 'string' ? r.data : null;
      } catch {
        return null;
      }
    },
    async clearInbox() {
      try {
        await Filesystem.deleteFile({ path: INBOX, directory: Directory.Data });
      } catch {
        /* já vazia */
      }
    },
  };
}
