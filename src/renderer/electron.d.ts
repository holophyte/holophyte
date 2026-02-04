export interface ElectronStore {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<void>;
}

export interface ElectronAPI {
  send: (channel: string, data: unknown) => void;
  receive: (channel: string, callback: (...args: unknown[]) => void) => void;
  store: ElectronStore;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
