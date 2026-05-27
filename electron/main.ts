import { app, BrowserWindow, shell } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { registerTorrentCoreIpc } from "./torrentCore/ipc.js";
import { RemoteAccessServer } from "./torrentCore/remoteAccess.js";
import { registerRemoteAccessIpc } from "./torrentCore/remoteAccessIpc.js";
import { WebTorrentCore } from "./torrentCore/webtorrentCore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
let torrentCore: WebTorrentCore | null = null;
let remoteAccess: RemoteAccessServer | null = null;

function getWindowIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "assets", "icon.ico");
  }

  return path.join(__dirname, "../assets/icon.ico");
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    title: "sTorent",
    icon: getWindowIconPath(),
    backgroundColor: "#f6f7f9",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDevelopment) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    void window.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.setName("sTorent");

if (process.platform === "win32") {
  app.setAppUserModelId("app.storent.desktop");
}

app.whenReady().then(async () => {
  torrentCore = new WebTorrentCore({
    defaultDownloadPath: app.getPath("downloads"),
    stateFilePath: path.join(app.getPath("userData"), "torrents.json"),
    networkSettingsFilePath: path.join(
      app.getPath("userData"),
      "network-settings.json"
    ),
    automationSettingsFilePath: path.join(
      app.getPath("userData"),
      "automation-settings.json"
    )
  });
  registerTorrentCoreIpc(torrentCore);
  remoteAccess = new RemoteAccessServer({
    core: torrentCore,
    settingsFilePath: path.join(app.getPath("userData"), "remote-access.json"),
    staticRoot: path.join(__dirname, "../dist")
  });
  registerRemoteAccessIpc(remoteAccess);
  await torrentCore.restoreNetworkSettings();
  await torrentCore.restoreAutomationSettings();
  await torrentCore.restore();
  await remoteAccess.restore();

  createMainWindow();
  void torrentCore.runWatchFolderScan();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void remoteAccess?.shutdown();
  torrentCore?.shutdown();
});
