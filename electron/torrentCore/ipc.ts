import { BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import { ASSISTANT_EVENT_CHANNEL, isAssistantEvent } from "../assistantEvents.js";
import {
  ASSISTANT_IPC_CHANNELS,
  TORRENT_CORE_EVENT_CHANNEL,
  TORRENT_IPC_CHANNELS,
  type AddMagnetRequest,
  type AddTorrentFileRequest,
  type AddTorrentUrlRequest,
  type AssistantProfileApplyRequest,
  type AssistantWarningDismissRequest,
  type AutomationSettings,
  type CommitPreparedTorrentAddRequest,
  type ExportTorrentFileRequest,
  type MoveTorrentDataRequest,
  type NetworkSettings,
  type RenameTorrentRequest,
  type RunSpeedDoctorRequest,
  type SetTorrentFilePriorityRequest,
  type SetTorrentFilePrioritiesRequest,
  type SpeedDoctorScanMode,
  type TorrentCoreEvent,
  type TorrentCoreResult,
  type OpenTorrentFileRequest,
  type RemoveTorrentRequest,
  type UpdateTorrentProfileRequest,
  type UpdateTorrentLabelsRequest,
  type UpdateTorrentQueuePositionRequest
} from "./contracts.js";
import type { WebTorrentCore } from "./webtorrentCore.js";

export function registerTorrentCoreIpc(core: WebTorrentCore) {
  core.on("core-event", (event: TorrentCoreEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(TORRENT_CORE_EVENT_CHANNEL, event);

      if (isAssistantEvent(event)) {
        window.webContents.send(ASSISTANT_EVENT_CHANNEL, event);
      }
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
    TORRENT_IPC_CHANNELS.addTorrentUrl,
    async (_event, request: AddTorrentUrlRequest) =>
      toResult(() => core.addTorrentUrl(request))
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

  ipcMain.handle(TORRENT_IPC_CHANNELS.forceStart, async (_event, id: string) =>
    toResult(() => core.forceStart(id))
  );

  ipcMain.handle(
    TORRENT_IPC_CHANNELS.remove,
    async (_event, request: string | RemoveTorrentRequest) =>
      toResult(() => core.remove(request))
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.recheck, async (_event, id: string) =>
    toResult(() => core.recheck(id))
  );

  ipcMain.handle(
    TORRENT_IPC_CHANNELS.rename,
    async (_event, request: RenameTorrentRequest) =>
      toResult(() => core.rename(request))
  );

  ipcMain.handle(
    TORRENT_IPC_CHANNELS.moveData,
    async (_event, request: MoveTorrentDataRequest) =>
      toResult(async () => {
        let destinationPath = request.destinationPath;

        if (!destinationPath) {
          const selection = await dialog.showOpenDialog({
            properties: ["openDirectory", "createDirectory"]
          });

          if (selection.canceled || selection.filePaths.length === 0) {
            throw createCodedError("cancelled", "Data move cancelled.");
          }

          destinationPath = selection.filePaths[0];
        }

        return core.moveData({ ...request, destinationPath });
      })
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.reannounce, async (_event, id: string) =>
    toResult(() => core.reannounce(id))
  );

  ipcMain.handle(
    TORRENT_IPC_CHANNELS.exportTorrentFile,
    async (_event, request: ExportTorrentFileRequest) =>
      toResult(async () => {
        let targetPath = request.targetPath;

        if (!targetPath) {
          const torrent =
            core.getSnapshot().torrents.find((item) => item.id === request.id) ??
            null;
          const selection = await dialog.showSaveDialog({
            defaultPath: `${sanitizeDialogFileName(torrent?.name ?? "torrent")}.torrent`,
            filters: [{ name: ".torrent", extensions: ["torrent"] }]
          });

          if (selection.canceled || !selection.filePath) {
            throw createCodedError("cancelled", "Torrent export cancelled.");
          }

          targetPath = selection.filePath;
        }

        return core.exportTorrentFile({ ...request, targetPath });
      })
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.copyMagnet, async (_event, id: string) =>
    toResult(() => {
      const magnetUri = core.getMagnetUri(id);
      clipboard.writeText(magnetUri);
      return magnetUri;
    })
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.openTorrentFolder, async (_event, id: string) =>
    toResult(async () => {
      const error = await shell.openPath(core.getTorrentFolderPath(id));

      if (error) {
        throw new Error(error);
      }

      return true;
    })
  );

  ipcMain.handle(
    TORRENT_IPC_CHANNELS.openTorrentFile,
    async (_event, request: OpenTorrentFileRequest) =>
      toResult(async () => {
        const error = await shell.openPath(core.getTorrentFilePath(request));

        if (error) {
          throw new Error(error);
        }

        return true;
      })
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

  ipcMain.handle(
    TORRENT_IPC_CHANNELS.setFilePriorities,
    async (_event, request: SetTorrentFilePrioritiesRequest) =>
      toResult(() => core.setFilePriorities(request))
  );

  ipcMain.handle(
    TORRENT_IPC_CHANNELS.commitPreparedAdd,
    async (_event, request: CommitPreparedTorrentAddRequest) =>
      toResult(() => core.commitPreparedAdd(request))
  );

  ipcMain.handle(
    TORRENT_IPC_CHANNELS.updateQueuePosition,
    async (_event, request: UpdateTorrentQueuePositionRequest) =>
      toResult(() => core.updateQueuePosition(request))
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.getSnapshot, async () =>
    toResult(() => core.getSnapshot())
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.getStatistics, async () =>
    toResult(() => core.getStatistics())
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.getEventLogs, async () =>
    toResult(() => core.getEventLogs())
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.exportEventLogs, async () =>
    toResult(() => core.exportEventLogs())
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

  ipcMain.handle(TORRENT_IPC_CHANNELS.runSpeedDoctor, async (_event, request: string | RunSpeedDoctorRequest) =>
    toResult(() => {
      const normalized = normalizeRunSpeedDoctorRequest(request);
      return core.runSpeedDoctor(normalized.id, normalized.mode);
    })
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.getSpeedDoctorHistory, async () =>
    toResult(() => core.getSpeedDoctorHistory())
  );

  ipcMain.handle(
    TORRENT_IPC_CHANNELS.exportSpeedDoctorReport,
    async (_event, id: string) => toResult(() => core.exportSpeedDoctorReport(id))
  );

  ipcMain.handle(TORRENT_IPC_CHANNELS.mapIncomingPort, async () =>
    toResult(() => core.mapIncomingPort())
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

  ipcMain.handle(ASSISTANT_IPC_CHANNELS.getState, async () =>
    toResult(() => core.getAssistantState())
  );

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.profileApply,
    async (_event, request: AssistantProfileApplyRequest) =>
      toResult(() => core.applyAssistantProfile(request))
  );

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.warningDismiss,
    async (_event, request: AssistantWarningDismissRequest) =>
      toResult(() => core.dismissAssistantWarning(request))
  );

  ipcMain.handle(
    ASSISTANT_IPC_CHANNELS.scheduleRequest,
    async (_event, torrentId: string) =>
      toResult(() => core.getAssistantScheduleSuggestion(torrentId))
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

function sanitizeDialogFileName(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 64) || "torrent";
}

function normalizeRunSpeedDoctorRequest(
  request: string | RunSpeedDoctorRequest
): Required<RunSpeedDoctorRequest> {
  if (typeof request === "string") {
    return { id: request, mode: "full" };
  }

  return {
    id: request.id,
    mode: normalizeScanMode(request.mode)
  };
}

function normalizeScanMode(mode: SpeedDoctorScanMode | undefined): SpeedDoctorScanMode {
  return mode === "quick" ? "quick" : "full";
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
