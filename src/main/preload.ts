import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // IPC communication
  send: (channel: string, data: unknown) => {
    const validChannels = ["toMain"];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receive: (channel: string, callback: (...args: unknown[]) => void) => {
    const validChannels = ["fromMain"];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    }
  },

  // Electron store
  store: {
    get: (key: string) => ipcRenderer.invoke("store:get", key),
    set: (key: string, value: unknown) =>
      ipcRenderer.invoke("store:set", key, value),
  },
});
