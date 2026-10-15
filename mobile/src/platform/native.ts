import { Directory, Filesystem } from '@capacitor/filesystem';
import type { BlobStore } from '../../db/persistence';
import { base64ToBytes, bytesToBase64 } from './base64.ts';

const FILE = 'nimboo.db';

/** Arquivo do banco no armazenamento privado do app (Android). Gravação em arquivo temporário + troca. */
export function filesystemBlobStore(file = FILE): BlobStore {
  return {
    async read() {
      try {
        const r = await Filesystem.readFile({ path: file, directory: Directory.Data });
        const data = typeof r.data === 'string' ? r.data : '';
        return data ? base64ToBytes(data) : null;
      } catch {
        return null; // ainda não existe
      }
    },
    async write(bytes) {
      const tmp = `${file}.tmp`;
      await Filesystem.writeFile({ path: tmp, directory: Directory.Data, data: bytesToBase64(bytes) });
      try {
        await Filesystem.deleteFile({ path: file, directory: Directory.Data });
      } catch {
        /* primeira gravação */
      }
      await Filesystem.rename({ from: tmp, to: file, directory: Directory.Data, toDirectory: Directory.Data });
    },
    async preserveCorrupt(bytes) {
      await Filesystem.writeFile({ path: `${file}.corrupt-${Date.now()}`, directory: Directory.Data, data: bytesToBase64(bytes) });
    },
  };
}
