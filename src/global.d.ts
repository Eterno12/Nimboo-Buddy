import type { MochiApi } from '../shared/ipc';

declare global {
  interface Window {
    /** Exposta pelo preload via contextBridge. */
    mochi: MochiApi;
  }
}

export {};
