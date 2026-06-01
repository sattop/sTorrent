import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_INTEGRATION_EVENT_CHANNEL = "appIntegration:event";

export const APP_INTEGRATION_IPC_CHANNELS = {
  getState: "appIntegration:getState",
  updateSettings: "appIntegration:updateSettings",
  registerDefaultHandlers: "appIntegration:registerDefaultHandlers"
} as const;

export interface AppIntegrationSettings {
  registerDefaultHandlers: boolean;
  trayEnabled: boolean;
  closeToTray: boolean;
  launchAtLogin: boolean;
  launchMinimized: boolean;
  notificationsEnabled: boolean;
  notifyOnTorrentCompleted: boolean;
  notifyOnTorrentError: boolean;
  notifyOnWatchFolderAdded: boolean;
  notifyOnExternalAdd: boolean;
}

export interface AppIntegrationDefaultHandlersState {
  canRegisterMagnetProtocol: boolean;
  magnetProtocolRegistered: boolean;
  torrentFileAssociation: "installer" | "available_after_install" | "unsupported";
}

export interface AppIntegrationLoginItemState {
  canManage: boolean;
  openAtLogin: boolean;
  executableWillLaunchAtLogin: boolean;
  args: string[];
}

export interface AppIntegrationStartupState {
  launchedAtLogin: boolean;
  launchedMinimized: boolean;
}

export interface AppIntegrationState {
  platform: NodeJS.Platform;
  settings: AppIntegrationSettings;
  defaultHandlers: AppIntegrationDefaultHandlersState;
  loginItem: AppIntegrationLoginItemState;
  startup: AppIntegrationStartupState;
  notificationsSupported: boolean;
  pendingExternalOpenCount: number;
}

export interface AppIntegrationEvent {
  type: "appIntegration.state.changed";
  state: AppIntegrationState;
}

export type ExternalOpenTarget =
  | {
      type: "torrent_file";
      filePath: string;
    }
  | {
      type: "magnet";
      magnetUri: string;
    };

export interface StartupFlags {
  launchAtLogin: boolean;
  minimized: boolean;
}

export const DEFAULT_APP_INTEGRATION_SETTINGS: AppIntegrationSettings = {
  registerDefaultHandlers: true,
  trayEnabled: true,
  closeToTray: true,
  launchAtLogin: false,
  launchMinimized: true,
  notificationsEnabled: true,
  notifyOnTorrentCompleted: true,
  notifyOnTorrentError: true,
  notifyOnWatchFolderAdded: true,
  notifyOnExternalAdd: true
};

export function normalizeAppIntegrationSettings(
  value: unknown,
  fallback: AppIntegrationSettings = DEFAULT_APP_INTEGRATION_SETTINGS
): AppIntegrationSettings {
  const candidate = isRecord(value) ? value : {};

  return {
    registerDefaultHandlers: toBoolean(
      candidate.registerDefaultHandlers,
      fallback.registerDefaultHandlers
    ),
    trayEnabled: toBoolean(candidate.trayEnabled, fallback.trayEnabled),
    closeToTray: toBoolean(candidate.closeToTray, fallback.closeToTray),
    launchAtLogin: toBoolean(candidate.launchAtLogin, fallback.launchAtLogin),
    launchMinimized: toBoolean(
      candidate.launchMinimized,
      fallback.launchMinimized
    ),
    notificationsEnabled: toBoolean(
      candidate.notificationsEnabled,
      fallback.notificationsEnabled
    ),
    notifyOnTorrentCompleted: toBoolean(
      candidate.notifyOnTorrentCompleted,
      fallback.notifyOnTorrentCompleted
    ),
    notifyOnTorrentError: toBoolean(
      candidate.notifyOnTorrentError,
      fallback.notifyOnTorrentError
    ),
    notifyOnWatchFolderAdded: toBoolean(
      candidate.notifyOnWatchFolderAdded,
      fallback.notifyOnWatchFolderAdded
    ),
    notifyOnExternalAdd: toBoolean(
      candidate.notifyOnExternalAdd,
      fallback.notifyOnExternalAdd
    )
  };
}

export function parseStartupFlags(argv: string[]): StartupFlags {
  const normalizedArgs = argv.map((arg) => trimCommandLineValue(arg).toLowerCase());

  return {
    launchAtLogin: normalizedArgs.includes("--launch-at-login"),
    minimized:
      normalizedArgs.includes("--minimized") ||
      normalizedArgs.includes("--hidden") ||
      normalizedArgs.includes("/minimized")
  };
}

export function buildLoginItemArgs(
  launchMinimized: boolean,
  appPathArg?: string | null
) {
  return [
    ...(appPathArg ? [appPathArg] : []),
    "--launch-at-login",
    ...(launchMinimized ? ["--minimized"] : [])
  ];
}

export function parseExternalOpenTargets(argv: string[]): ExternalOpenTarget[] {
  const targets: ExternalOpenTarget[] = [];
  const seen = new Set<string>();

  for (const rawArg of argv) {
    const arg = trimCommandLineValue(rawArg);

    if (!arg || arg.startsWith("--") || arg.toLowerCase() === "/minimized") {
      continue;
    }

    if (arg.toLowerCase().startsWith("magnet:?")) {
      pushUniqueTarget(targets, seen, {
        type: "magnet",
        magnetUri: arg
      });
      continue;
    }

    const filePath = normalizeTorrentFilePath(arg);

    if (filePath) {
      pushUniqueTarget(targets, seen, {
        type: "torrent_file",
        filePath
      });
    }
  }

  return targets;
}

function normalizeTorrentFilePath(value: string) {
  let candidate = value;

  if (/^file:/i.test(value)) {
    try {
      candidate = fileURLToPath(value);
    } catch {
      return null;
    }
  }

  if (path.extname(candidate).toLowerCase() !== ".torrent") {
    return null;
  }

  return path.resolve(candidate);
}

function pushUniqueTarget(
  targets: ExternalOpenTarget[],
  seen: Set<string>,
  target: ExternalOpenTarget
) {
  const key =
    target.type === "magnet"
      ? `${target.type}:${target.magnetUri.toLowerCase()}`
      : `${target.type}:${path.normalize(target.filePath).toLowerCase()}`;

  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  targets.push(target);
}

function trimCommandLineValue(value: string) {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function toBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
