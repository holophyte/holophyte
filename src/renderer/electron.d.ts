export interface ElectronAPI {
  send: (channel: string, data: unknown) => void;
  receive: (channel: string, callback: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
