import { BrowserWindow, dialog, ipcMain } from "electron";
import {
  TORRENT_CORE_EVENT_CHANNEL,
  TORRENT_IPC_CHANNELS,
  type AddMagnetRequest,
  type AddTorrentFileRequest,
  type AutomationSettings,
  type NetworkSettings,
  type SetTorrentFilePriorityRequest,
  type TorrentCoreEvent,
  type TorrentCoreResult,
  type UpdateTorrentProfileRequest,
  type UpdateTorrentLabelsRequest
} from "./contracts.js";
import type { WebTorrentCore } from "./webtorrentCore.js";

export function registerTorrentCoreIpc(core: WebTorrentCore) {
  core.on("core-event", (event: TorrentCoreEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(TORRENT_CORE_EVENT_CHANNEL, event);
    }
  });

  ipcMain.handle(
    TORRENT_IPC_CHANNELS.addTorrentFile,
    async (_event, request: AddTorrentFileRequest) =>
      toResult(async () => {
        let filePath = request.filePath;

        if (!filePath) {
          const selection = await dialog.showOpenDialog({
            properties: ["openFile"],
            filters: [{ name: ".torrent", extensions: ["torrent"] }]
          });

          if (selection.canceled || selection.filePaths.length === 0) {
            throw createCodedError("cancelled", "Torrent file selection cancelled.");
          }

          filePath = selection.filePaths[0];
        }

        return core.addTorrentFile({ ...request, filePath });
      })
  );

  ipcMain.handle(
    TORRENT_IPC_CHANNELS.addMagnet,
    async (_event, request: AddMagnetRequest) =>
      toResult(() => core.addMagnet(request))
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.pause, async (_event, id: string) =>
    toResult(() => core.pause(id))
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.resume, async (_event, id: string) =>
    toResult(() => core.resume(id))
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.remove, async (_event, id: string) =>
    toResult(() => core.remove(id))
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.recheck, async (_event, id: string) =>
    toResult(() => core.recheck(id))
  );

  ipcMain.handle(
    TORRENT_IPC_CHANNELS.updateLabels,
    async (_event, request: UpdateTorrentLabelsRequest) =>
      toResult(() => core.updateLabels(request))
  );

  ipcMain.handle(
    TORRENT_IPC_CHANNELS.updateProfile,
    async (_event, request: UpdateTorrentProfileRequest) =>
      toResult(() => core.updateProfile(request))
  );

  ipcMain.handle(
    TORRENT_IPC_CHANNELS.setFilePriority,
    async (_event, request: SetTorrentFilePriorityRequest) =>
      toResult(() => core.setFilePriority(request))
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.getSnapshot, async () =>
    toResult(() => core.getSnapshot())
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.getNetworkSettings, async () =>
    toResult(() => core.getNetworkSettingsState())
  );

  ipcMain.handle(
    TORRENT_IPC_CHANNELS.updateNetworkSettings,
    async (_event, request: NetworkSettings) =>
      toResult(() => core.updateNetworkSettings(request))
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.runNetworkDiagnostics, async () =>
    toResult(() => core.runNetworkDiagnostics())
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.runSpeedDoctor, async (_event, id: string) =>
    toResult(() => core.runSpeedDoctor(id))
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.getAutomationSettings, async () =>
    toResult(() => core.getAutomationSettingsState())
  );

  ipcMain.handle(
    TORRENT_IPC_CHANNELS.updateAutomationSettings,
    async (_event, request: AutomationSettings) =>
      toResult(() => core.updateAutomationSettings(request))
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.runWatchFolderScan, async () =>
    toResult(() => core.runWatchFolderScan())
  );
}

async function toResult<T>(
  action: () => T | Promise<T>
): Promise<TorrentCoreResult<T>> {
  try {
    return {
      ok: true,
      value: await action()
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: getErrorCode(error),
        message: getErrorMessage(error)
      }
    };
  }
}

function createCodedError(code: string, message: string) {
  const error = new Error(message);
  (error as Error & { code: string }).code = code;
  return error;
}

function getErrorCode(error: unknown) {
  if (error instanceof Error && "code" in error) {
    return String((error as Error & { code: string }).code);
  }

  return "torrent_core_error";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
