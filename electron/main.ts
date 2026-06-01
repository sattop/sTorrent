import { app, BrowserWindow, shell } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { registerAIIpc } from "./aiIpc.js";
import { AIService } from "./aiService.js";
import {
  AppIntegrationService,
  registerAppIntegrationIpc
} from "./appIntegration.js";
import { AppUpdateManager } from "./appUpdates.js";
import { registerTorrentCoreIpc } from "./torrentCore/ipc.js";
import { RemoteAccessServer } from "./torrentCore/remoteAccess.js";
import { registerRemoteAccessIpc } from "./torrentCore/remoteAccessIpc.js";
import { WebTorrentCore } from "./torrentCore/webtorrentCore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const appUserModelId = "app.storent.desktop";
let torrentCore: WebTorrentCore | null = null;
let remoteAccess: RemoteAccessServer | null = null;
let aiService: AIService | null = null;
let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let revealMainWindowWhenReady = false;
let isQuitting = false;
const appUpdates = new AppUpdateManager();

function getWindowIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "assets", "icon.ico");
  }

  return path.join(__dirname, "../assets/icon.ico");
}

const appIntegration = new AppIntegrationService({
  settingsFilePath: path.join(
    app.getPath("userData"),
    "app-integration-settings.json"
  ),
  iconPath: getWindowIconPath(),
  appUserModelId,
  showMainWindow,
  requestQuit
});

function createSplashWindow() {
  if (splashWindow || appIntegration.shouldLaunchMinimized()) {
    return;
  }

  splashWindow = new BrowserWindow({
    width: 420,
    height: 260,
    resizable: false,
    movable: true,
    frame: false,
    show: true,
    center: true,
    skipTaskbar: true,
    alwaysOnTop: false,
    icon: getWindowIconPath(),
    backgroundColor: "#f6f7f9",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  void splashWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(createSplashHtml())}`
  );

  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

function closeSplashWindow() {
  if (!splashWindow || splashWindow.isDestroyed()) {
    return;
  }

  splashWindow.close();
  splashWindow = null;
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  const window = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    title: "sTorent",
    icon: getWindowIconPath(),
    backgroundColor: "#f6f7f9",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;
  appUpdates.setMainWindow(window);

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  window.once("ready-to-show", () => {
    closeSplashWindow();

    if (appIntegration.shouldLaunchMinimized() && !revealMainWindowWhenReady) {
      window.hide();
      return;
    }

    revealMainWindowWhenReady = false;
    window.show();
    window.focus();
  });

  window.on("close", (event) => {
    if (!appIntegration.shouldHideOnClose(isQuitting)) {
      return;
    }

    event.preventDefault();
    window.hide();
  });

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  if (isDevelopment) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    void window.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  return window;
}

function showMainWindow() {
  const window = createMainWindow();

  if (window.webContents.isLoading()) {
    revealMainWindowWhenReady = true;
    return window;
  }

  closeSplashWindow();

  if (window.isMinimized()) {
    window.restore();
  }

  window.show();
  window.focus();
  return window;
}

function requestQuit() {
  isQuitting = true;
  app.quit();
}

app.setName("sTorent");

if (process.platform === "win32") {
  app.setAppUserModelId(appUserModelId);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    appIntegration.handleSecondInstance(argv);
  });
}

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  appIntegration.enqueueExternalOpenTargets([filePath]);
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  appIntegration.enqueueExternalOpenTargets([url]);
});

appUpdates.registerIpc();
registerAppIntegrationIpc(appIntegration);

if (gotSingleInstanceLock) {
  app.whenReady().then(async () => {
    await appIntegration.restore();
    appIntegration.enqueueExternalOpenTargets(process.argv);
    createSplashWindow();

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
      ),
      speedHistoryFilePath: path.join(
        app.getPath("userData"),
        "speed_history.db"
      ),
      statisticsFilePath: path.join(app.getPath("userData"), "statistics.json"),
      eventLogFilePath: path.join(app.getPath("userData"), "event-log.json"),
      eventLogExportDirectoryPath: path.join(
        app.getPath("userData"),
        "log_exports"
      ),
      torrentCacheDirectoryPath: path.join(
        app.getPath("userData"),
        "torrent-cache"
      ),
      assistantProfileUsageFilePath: path.join(
        app.getPath("userData"),
        "assistant",
        "profile_usage.json"
      ),
      assistantWarningDismissedFilePath: path.join(
        app.getPath("userData"),
        "assistant",
        "warning_dismissed.json"
      ),
      speedDoctorReportDirectoryPath: path.join(
        app.getPath("userData"),
        "diagnostic_reports"
      )
    });
    aiService = new AIService({
      settingsFilePath: path.join(app.getPath("userData"), "ai-settings.json"),
      keysFilePath: path.join(app.getPath("userData"), "ai-keys.json")
    });
    registerTorrentCoreIpc(torrentCore);
    registerAIIpc(aiService);
    remoteAccess = new RemoteAccessServer({
      core: torrentCore,
      settingsFilePath: path.join(app.getPath("userData"), "remote-access.json"),
      staticRoot: path.join(__dirname, "../dist")
    });
    registerRemoteAccessIpc(remoteAccess);
    await torrentCore.restoreNetworkSettings();
    await torrentCore.restoreAutomationSettings();
    await torrentCore.restoreSpeedHistory();
    await torrentCore.restoreStatistics();
    await torrentCore.restoreEventLog();
    await torrentCore.restoreAssistantState();
    await aiService.restore();
    await torrentCore.restore();
    await remoteAccess.restore();
    appIntegration.attachTorrentCore(torrentCore);

    createMainWindow();
    appUpdates.scheduleStartupCheck();
    void torrentCore.runWatchFolderScan();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (
    process.platform !== "darwin" &&
    !appIntegration.shouldKeepAliveWithoutWindows()
  ) {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  void remoteAccess?.shutdown();
  torrentCore?.shutdown();
  appIntegration.dispose();
});

function createSplashHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        height: 100vh;
        display: grid;
        place-items: center;
        color: #101828;
        background: #f6f7f9;
        font-family: "Segoe UI", system-ui, sans-serif;
      }
      main {
        width: 100%;
        display: grid;
        gap: 18px;
        justify-items: center;
        padding: 32px;
      }
      img {
        width: 72px;
        height: 72px;
      }
      h1 {
        margin: 0;
        font-size: 28px;
        font-weight: 800;
        letter-spacing: 0;
      }
      p {
        margin: 0;
        color: #667085;
        font-size: 13px;
        font-weight: 600;
      }
      .bar {
        width: 180px;
        height: 4px;
        overflow: hidden;
        border-radius: 999px;
        background: #d8e2f0;
      }
      .bar span {
        display: block;
        width: 70px;
        height: 100%;
        border-radius: inherit;
        background: #2563eb;
        animation: loading 1.1s ease-in-out infinite;
      }
      @keyframes loading {
        0% { transform: translateX(-80px); }
        100% { transform: translateX(190px); }
      }
    </style>
  </head>
  <body>
    <main>
      <img src="${pathToFileURL(getWindowIconPath()).toString()}" alt="" />
      <h1>sTorent</h1>
      <p>Starting torrent engine</p>
      <div class="bar" aria-hidden="true"><span></span></div>
    </main>
  </body>
</html>`;
}
