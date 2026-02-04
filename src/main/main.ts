import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import { store } from "./store";

function createWindow() {
  const bounds = store.get("windowBounds");

  const mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Save window bounds on resize/move
  mainWindow.on("resized", () => {
    const { width, height, x, y } = mainWindow.getBounds();
    store.set("windowBounds", { width, height, x, y });
  });

  mainWindow.on("moved", () => {
    const { width, height, x, y } = mainWindow.getBounds();
    store.set("windowBounds", { width, height, x, y });
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

// IPC handlers for store
ipcMain.handle("store:get", (_event, key: string) => {
  return store.get(key);
});

ipcMain.handle("store:set", (_event, key: string, value: unknown) => {
  store.set(key, value);
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
