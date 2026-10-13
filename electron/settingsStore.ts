import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, parseSettings, type Settings } from '../shared/settings.ts';

export interface SettingsStore {
  get(): Settings;
  /** Mescla o patch e agenda a gravação (com debounce). */
  update(patch: Partial<Omit<Settings, 'version'>>): void;
  /** Grava imediatamente o que estiver pendente (use ao sair). */
  flush(): void;
}

/**
 * Armazena preferências em um JSON pequeno, com escrita atômica (arquivo
 * temporário + rename). Arquivo ausente usa os padrões; arquivo corrompido é
 * preservado como `.bak` e o app segue com os padrões.
 * Não depende do Electron, então é testável com o runner nativo do Node.
 */
export function createSettingsStore(filePath: string, debounceMs = 300): SettingsStore {
  let current: Settings = load();
  let dirty = false;
  let timer: NodeJS.Timeout | undefined;

  function load(): Settings {
    let text: string;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch {
      return parseSettings(DEFAULT_SETTINGS);
    }
    try {
      return parseSettings(JSON.parse(text));
    } catch {
      try {
        fs.renameSync(filePath, `${filePath}.bak`);
      } catch {
        /* sem cópia de segurança; segue com os padrões */
      }
      return parseSettings(DEFAULT_SETTINGS);
    }
  }

  function write(): void {
    dirty = false;
    const tmp = `${filePath}.tmp`;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(current, null, 2), 'utf8');
      fs.renameSync(tmp, filePath);
    } catch (error) {
      console.error('Falha ao salvar preferências:', error);
    }
  }

  return {
    get: () => ({ ...current, floating: current.floating ? { ...current.floating } : null }),
    update(patch) {
      current = parseSettings({ ...current, ...patch, version: 3 });
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(write, debounceMs);
    },
    flush() {
      clearTimeout(timer);
      if (dirty) write();
    },
  };
}
