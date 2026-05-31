import { createRequire } from "node:module";
import { BrowserWindow, app, ipcMain } from "electron";
import { type ProgressInfo, type UpdateInfo } from "builder-util-runtime";
import type { AppUpdater } from "electron-updater";
import {
  APP_UPDATE_EVENT_CHANNEL,
  APP_UPDATE_IPC_CHANNELS,
  type AppUpdateEvent,
  type AppUpdateProgress,
  type AppUpdateReleaseInfo,
  type AppUpdateState
} from "./appUpdateContracts.js";

const require = createRequire(import.meta.url);
const { autoUpdater } = require("electron-updater") as {
  autoUpdater: AppUpdater;
};

export class AppUpdateManager {
  private mainWindow: BrowserWindow | null = null;
  private state: AppUpdateState = {
    status: app.isPackaged ? "idle" : "disabled",
    currentVersion: app.getVersion(),
    canCheckForUpdates: app.isPackaged,
    checkedAt: null,
    update: null,
    progress: null,
    errorMessage: app.isPackaged ? null : "Updates are available only in packaged builds."
  };

  constructor() {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.fullChangelog = true;
    autoUpdater.logger = null;

    autoUpdater.on("checking-for-update", () => {
      this.patchState({
        status: "checking",
        progress: null,
        errorMessage: null
      });
    });

    autoUpdater.on("update-available", (info) => {
      this.patchState({
        status: "available",
        checkedAt: new Date().toISOString(),
        update: toReleaseInfo(info),
        progress: null,
        errorMessage: null
      });
    });

    autoUpdater.on("update-not-available", (info) => {
      this.patchState({
        status: "not_available",
        checkedAt: new Date().toISOString(),
        update: toReleaseInfo(info),
        progress: null,
        errorMessage: null
      });
    });

    autoUpdater.on("download-progress", (progress) => {
      this.patchState({
        status: "downloading",
        progress: toProgress(progress),
        errorMessage: null
      });
    });

    autoUpdater.on("update-downloaded", (event) => {
      this.patchState({
        status: "downloaded",
        update: toReleaseInfo(event),
        progress: null,
        errorMessage: null
      });
    });

    autoUpdater.on("error", (error) => {
      this.patchState({
        status: "error",
        progress: null,
        errorMessage: getErrorMessage(error)
      });
    });
  }

  registerIpc() {
    ipcMain.handle(APP_UPDATE_IPC_CHANNELS.getState, () => this.getState());
    ipcMain.handle(APP_UPDATE_IPC_CHANNELS.checkForUpdates, () =>
      this.checkForUpdates()
    );
    ipcMain.handle(APP_UPDATE_IPC_CHANNELS.downloadUpdate, () =>
      this.downloadUpdate()
    );
    ipcMain.handle(APP_UPDATE_IPC_CHANNELS.installUpdate, () =>
      this.installUpdate()
    );
  }

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window;
    window.on("closed", () => {
      if (this.mainWindow === window) {
        this.mainWindow = null;
      }
    });
  }

  getState() {
    return this.state;
  }

  scheduleStartupCheck() {
    if (!this.state.canCheckForUpdates) {
      return;
    }

    const timer = setTimeout(() => {
      void this.checkForUpdates();
    }, 10_000);
    timer.unref();
  }

  async checkForUpdates() {
    if (!this.state.canCheckForUpdates) {
      return this.state;
    }

    if (this.state.status === "checking" || this.state.status === "downloading") {
      return this.state;
    }

    try {
      this.patchState({
        status: "checking",
        progress: null,
        errorMessage: null
      });
      const result = await autoUpdater.checkForUpdates();

      if (result === null) {
        this.patchState({
          status: "disabled",
          canCheckForUpdates: false,
          errorMessage: "Updater is disabled for this build."
        });
      }
    } catch (error) {
      this.patchState({
        status: "error",
        progress: null,
        errorMessage: getErrorMessage(error)
      });
    }

    return this.state;
  }

  async downloadUpdate() {
    if (!this.state.canCheckForUpdates) {
      return this.state;
    }

    if (this.state.status !== "available") {
      return this.state;
    }

    try {
      this.patchState({
        status: "downloading",
        progress: {
          percent: 0,
          transferredBytes: 0,
          totalBytes: 0,
          bytesPerSecond: 0
        },
        errorMessage: null
      });
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.patchState({
        status: "error",
        progress: null,
        errorMessage: getErrorMessage(error)
      });
    }

    return this.state;
  }

  installUpdate() {
    if (this.state.status === "downloaded") {
      autoUpdater.quitAndInstall(true, true);
    }

    return this.state;
  }

  private patchState(patch: Partial<AppUpdateState>) {
    this.state = {
      ...this.state,
      ...patch,
      currentVersion: app.getVersion(),
      canCheckForUpdates:
        patch.canCheckForUpdates ?? this.state.canCheckForUpdates
    };
    this.broadcast();
    return this.state;
  }

  private broadcast() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    this.mainWindow.webContents.send(APP_UPDATE_EVENT_CHANNEL, {
      state: this.state
    } satisfies AppUpdateEvent);
  }
}

function toReleaseInfo(info: UpdateInfo): AppUpdateReleaseInfo {
  return {
    version: info.version,
    releaseName: info.releaseName ?? null,
    releaseDate: info.releaseDate ?? null,
    releaseNotes: formatReleaseNotes(info.releaseNotes)
  };
}

function toProgress(progress: ProgressInfo): AppUpdateProgress {
  return {
    percent: Math.max(0, Math.min(100, progress.percent)),
    transferredBytes: progress.transferred,
    totalBytes: progress.total,
    bytesPerSecond: progress.bytesPerSecond
  };
}

function formatReleaseNotes(notes: UpdateInfo["releaseNotes"]) {
  if (Array.isArray(notes)) {
    return notes
      .map((note) =>
        [note.version, note.note].filter((item): item is string => Boolean(item)).join(
          "\n"
        )
      )
      .filter(Boolean)
      .join("\n\n");
  }

  return notes ?? null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
