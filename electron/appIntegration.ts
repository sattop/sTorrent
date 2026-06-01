import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  Tray
} from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  APP_INTEGRATION_EVENT_CHANNEL,
  APP_INTEGRATION_IPC_CHANNELS,
  DEFAULT_APP_INTEGRATION_SETTINGS,
  buildLoginItemArgs,
  normalizeAppIntegrationSettings,
  parseExternalOpenTargets,
  parseStartupFlags,
  type AppIntegrationEvent,
  type AppIntegrationSettings,
  type AppIntegrationState,
  type ExternalOpenTarget,
  type StartupFlags
} from "./appIntegrationContracts.js";
import type { TorrentCoreEvent, TorrentCoreSnapshot } from "./torrentCore/contracts.js";
import type { WebTorrentCore } from "./torrentCore/webtorrentCore.js";

interface AppIntegrationServiceOptions {
  settingsFilePath: string;
  iconPath: string;
  appUserModelId: string;
  showMainWindow: () => BrowserWindow;
  requestQuit: () => void;
}

export class AppIntegrationService {
  private settings = DEFAULT_APP_INTEGRATION_SETTINGS;
  private readonly startupFlags: StartupFlags;
  private pendingExternalOpenTargets: ExternalOpenTarget[] = [];
  private torrentCore: WebTorrentCore | null = null;
  private tray: Tray | null = null;
  private flushingExternalTargets = false;
  private lastTrayRefreshAt = 0;

  constructor(private readonly options: AppIntegrationServiceOptions) {
    this.startupFlags = parseStartupFlags(process.argv);
  }

  async restore() {
    try {
      const persisted = JSON.parse(
        await fs.readFile(this.options.settingsFilePath, "utf8")
      );
      this.settings = normalizeAppIntegrationSettings(persisted?.settings);
    } catch {
      this.settings = DEFAULT_APP_INTEGRATION_SETTINGS;
    }

    if (this.settings.registerDefaultHandlers) {
      this.registerDefaultHandlersInternal();
    }

    this.applyLoginItemSettings();
    this.syncTray();
  }

  attachTorrentCore(core: WebTorrentCore) {
    this.torrentCore = core;
    core.on("core-event", (event: TorrentCoreEvent) => {
      this.handleCoreEvent(event);
    });
    this.refreshTray();
    void this.flushPendingExternalOpenTargets();
  }

  enqueueExternalOpenTargets(argv: string[]) {
    const targets = parseExternalOpenTargets(argv);

    if (targets.length === 0) {
      return;
    }

    this.pendingExternalOpenTargets = mergeExternalOpenTargets(
      this.pendingExternalOpenTargets,
      targets
    );
    this.emitStateChanged();
    void this.flushPendingExternalOpenTargets();
  }

  handleSecondInstance(argv: string[]) {
    this.enqueueExternalOpenTargets(argv);
    this.options.showMainWindow();
  }

  shouldLaunchMinimized() {
    return (
      this.startupFlags.minimized ||
      (this.startupFlags.launchAtLogin && this.settings.launchMinimized)
    );
  }

  shouldHideOnClose(isQuitting: boolean) {
    return (
      process.platform === "win32" &&
      !isQuitting &&
      this.settings.trayEnabled &&
      this.settings.closeToTray
    );
  }

  shouldKeepAliveWithoutWindows() {
    return (
      process.platform === "win32" &&
      this.settings.trayEnabled &&
      this.settings.closeToTray
    );
  }

  getState(): AppIntegrationState {
    const loginItemArgs = this.getLoginItemArgs();
    const loginItemsSupported = canManageLoginItems();
    const loginItem = getLoginItemState(loginItemsSupported, loginItemArgs);

    return {
      platform: process.platform,
      settings: this.settings,
      defaultHandlers: {
        canRegisterMagnetProtocol: canRegisterMagnetProtocol(),
        magnetProtocolRegistered: this.isDefaultMagnetProtocolClient(),
        torrentFileAssociation: getTorrentFileAssociationState()
      },
      loginItem: {
        canManage: loginItemsSupported,
        openAtLogin: loginItem?.openAtLogin ?? false,
        executableWillLaunchAtLogin:
          loginItem?.executableWillLaunchAtLogin ?? false,
        args: loginItemArgs
      },
      startup: {
        launchedAtLogin: this.startupFlags.launchAtLogin,
        launchedMinimized: this.shouldLaunchMinimized()
      },
      notificationsSupported: Notification.isSupported(),
      pendingExternalOpenCount: this.pendingExternalOpenTargets.length
    };
  }

  async updateSettings(settings: AppIntegrationSettings) {
    const previousSettings = this.settings;
    this.settings = normalizeAppIntegrationSettings(settings);
    await this.persist();

    if (this.settings.registerDefaultHandlers) {
      this.registerDefaultHandlersInternal();
    }

    this.applyLoginItemSettings(previousSettings);
    this.syncTray();
    this.emitStateChanged();
    return this.getState();
  }

  async registerDefaultHandlers() {
    this.settings = {
      ...this.settings,
      registerDefaultHandlers: true
    };
    this.registerDefaultHandlersInternal();
    await this.persist();
    this.emitStateChanged();
    return this.getState();
  }

  dispose() {
    this.destroyTray();
  }

  private async flushPendingExternalOpenTargets() {
    if (!this.torrentCore || this.flushingExternalTargets) {
      return;
    }

    this.flushingExternalTargets = true;

    try {
      while (this.pendingExternalOpenTargets.length > 0) {
        const target = this.pendingExternalOpenTargets.shift()!;
        this.emitStateChanged();
        await this.openExternalTarget(target);
      }
    } finally {
      this.flushingExternalTargets = false;
      this.emitStateChanged();
    }
  }

  private async openExternalTarget(target: ExternalOpenTarget) {
    if (!this.torrentCore) {
      return;
    }

    try {
      const torrent =
        target.type === "torrent_file"
          ? await this.torrentCore.addTorrentFile({ filePath: target.filePath })
          : await this.torrentCore.addMagnet({ magnetUri: target.magnetUri });

      this.showNotification(
        "external",
        "Torrent added",
        `${torrent.name} was added to sTorent.`
      );
    } catch (error) {
      this.showNotification(
        "error",
        "Torrent error",
        getErrorMessage(error)
      );
    }
  }

  private handleCoreEvent(event: TorrentCoreEvent) {
    this.refreshTrayThrottled();

    if (event.type === "torrent.completed") {
      this.showNotification(
        "completed",
        "Download complete",
        `${event.payload.name} has finished downloading.`
      );
      return;
    }

    if (event.type === "torrent.error") {
      this.showNotification("error", "Torrent error", event.payload.message);
      return;
    }

    if (event.type === "automation.watch.added") {
      this.showNotification(
        "watch",
        "Watch folder",
        `${event.payload.torrent.name} was added automatically.`
      );
    }
  }

  private showNotification(
    kind: "completed" | "error" | "watch" | "external",
    title: string,
    body: string
  ) {
    if (!this.settings.notificationsEnabled || !Notification.isSupported()) {
      return;
    }

    if (
      (kind === "completed" && !this.settings.notifyOnTorrentCompleted) ||
      (kind === "error" && !this.settings.notifyOnTorrentError) ||
      (kind === "watch" && !this.settings.notifyOnWatchFolderAdded) ||
      (kind === "external" && !this.settings.notifyOnExternalAdd)
    ) {
      return;
    }

    const notification = new Notification({
      title,
      body: truncateNotificationBody(body),
      icon: this.options.iconPath
    });

    notification.on("click", () => {
      this.options.showMainWindow();
    });
    notification.show();
  }

  private syncTray() {
    if (!this.settings.trayEnabled) {
      this.destroyTray();
      return;
    }

    if (!this.tray) {
      try {
        this.tray = new Tray(this.options.iconPath);
        this.tray.on("click", () => {
          this.options.showMainWindow();
        });
      } catch {
        this.tray = null;
        return;
      }
    }

    this.refreshTray();
  }

  private destroyTray() {
    this.tray?.destroy();
    this.tray = null;
  }

  private refreshTrayThrottled() {
    const now = Date.now();

    if (now - this.lastTrayRefreshAt < 1_000) {
      return;
    }

    this.lastTrayRefreshAt = now;
    this.refreshTray();
  }

  private refreshTray() {
    if (!this.tray) {
      return;
    }

    const snapshot = this.torrentCore?.getSnapshot();
    const tooltip = createTrayTooltip(snapshot);
    this.tray.setToolTip(tooltip);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: tooltip,
          enabled: false
        },
        { type: "separator" },
        {
          label: "Open sTorent",
          click: () => {
            this.options.showMainWindow();
          }
        },
        {
          label: "Quit sTorent",
          click: () => {
            this.options.requestQuit();
          }
        }
      ])
    );
  }

  private registerDefaultHandlersInternal() {
    if (!canRegisterMagnetProtocol()) {
      return;
    }

    try {
      const args = this.getDevelopmentAppPathArg();

      if (args) {
        app.setAsDefaultProtocolClient("magnet", process.execPath, [args]);
      } else {
        app.setAsDefaultProtocolClient("magnet");
      }
    } catch {
      // The state panel will still report the current registered handler.
    }
  }

  private isDefaultMagnetProtocolClient() {
    if (!canRegisterMagnetProtocol()) {
      return false;
    }

    try {
      const args = this.getDevelopmentAppPathArg();
      return args
        ? app.isDefaultProtocolClient("magnet", process.execPath, [args])
        : app.isDefaultProtocolClient("magnet");
    } catch {
      return false;
    }
  }

  private applyLoginItemSettings(previousSettings?: AppIntegrationSettings) {
    if (!canManageLoginItems()) {
      return;
    }

    try {
      const previousArgs = previousSettings
        ? this.getLoginItemArgs(previousSettings)
        : null;
      const nextArgs = this.getLoginItemArgs();

      if (previousArgs && !areStringArraysEqual(previousArgs, nextArgs)) {
        app.setLoginItemSettings({
          openAtLogin: false,
          path: process.execPath,
          args: previousArgs,
          enabled: false,
          name: this.options.appUserModelId
        });
      }

      app.setLoginItemSettings({
        openAtLogin: this.settings.launchAtLogin,
        path: process.execPath,
        args: nextArgs,
        enabled: this.settings.launchAtLogin,
        name: this.options.appUserModelId
      });
    } catch {
      // Windows can reject login item changes in restricted environments.
    }
  }

  private getLoginItemArgs(settings = this.settings) {
    return buildLoginItemArgs(
      settings.launchMinimized,
      this.getDevelopmentAppPathArg()
    );
  }

  private getDevelopmentAppPathArg() {
    if (app.isPackaged) {
      return null;
    }

    const appPathArg = process.argv[1];

    if (!appPathArg || appPathArg.startsWith("-")) {
      return null;
    }

    return path.resolve(appPathArg);
  }

  private async persist() {
    await fs.mkdir(path.dirname(this.options.settingsFilePath), {
      recursive: true
    });
    await fs.writeFile(
      this.options.settingsFilePath,
      JSON.stringify({ settings: this.settings }, null, 2),
      "utf8"
    );
  }

  private emitStateChanged() {
    if (!app.isReady()) {
      return;
    }

    const event: AppIntegrationEvent = {
      type: "appIntegration.state.changed",
      state: this.getState()
    };

    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(APP_INTEGRATION_EVENT_CHANNEL, event);
    }
  }
}

export function registerAppIntegrationIpc(service: AppIntegrationService) {
  ipcMain.handle(APP_INTEGRATION_IPC_CHANNELS.getState, () => service.getState());
  ipcMain.handle(
    APP_INTEGRATION_IPC_CHANNELS.updateSettings,
    async (_event, settings: AppIntegrationSettings) =>
      service.updateSettings(settings)
  );
  ipcMain.handle(
    APP_INTEGRATION_IPC_CHANNELS.registerDefaultHandlers,
    () => service.registerDefaultHandlers()
  );
}

function createTrayTooltip(snapshot: TorrentCoreSnapshot | undefined) {
  if (!snapshot) {
    return "sTorent";
  }

  const activeCount = snapshot.torrents.filter(
    (torrent) => torrent.status === "downloading" || torrent.status === "seeding"
  ).length;

  return [
    "sTorent",
    `${snapshot.torrents.length} torrents, ${activeCount} active`,
    `Down ${formatBytesPerSecond(snapshot.downloadSpeedBytes)} | Up ${formatBytesPerSecond(
      snapshot.uploadSpeedBytes
    )}`
  ].join("\n");
}

function formatBytesPerSecond(value: number) {
  if (value >= 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(1)} MB/s`;
  }

  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB/s`;
  }

  return `${Math.round(value)} B/s`;
}

function getTorrentFileAssociationState():
  | "installer"
  | "available_after_install"
  | "unsupported" {
  if (process.platform !== "win32") {
    return "unsupported";
  }

  return app.isPackaged ? "installer" : "available_after_install";
}

function canRegisterMagnetProtocol() {
  return process.platform === "win32" || process.platform === "darwin";
}

function canManageLoginItems() {
  return process.platform === "win32" || process.platform === "darwin";
}

function getLoginItemState(canManage: boolean, args: string[]) {
  if (!canManage) {
    return null;
  }

  try {
    return app.getLoginItemSettings({
      path: process.execPath,
      args
    });
  } catch {
    return null;
  }
}

function mergeExternalOpenTargets(
  current: ExternalOpenTarget[],
  incoming: ExternalOpenTarget[]
) {
  return parseExternalOpenTargets([
    ...current.map((target) =>
      target.type === "torrent_file" ? target.filePath : target.magnetUri
    ),
    ...incoming.map((target) =>
      target.type === "torrent_file" ? target.filePath : target.magnetUri
    )
  ]);
}

function truncateNotificationBody(value: string) {
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}

function areStringArraysEqual(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
