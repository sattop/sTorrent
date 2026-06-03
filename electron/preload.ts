import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  AI_EVENT_CHANNEL,
  AI_IPC_CHANNELS,
  type AIAdviceRequest,
  type AIAdviceResult,
  type AIEvent,
  type AIProviderConfig,
  type AIResult,
  type AISettings,
  type AISettingsState,
  type ProviderTestResult
} from "./aiContracts.js";
import {
  ASSISTANT_EVENT_CHANNEL,
  type AssistantEvent
} from "./assistantEvents.js";
import {
  APP_UPDATE_EVENT_CHANNEL,
  APP_UPDATE_IPC_CHANNELS,
  type AppUpdateEvent,
  type AppUpdateState
} from "./appUpdateContracts.js";
import {
  APP_INTEGRATION_EVENT_CHANNEL,
  APP_INTEGRATION_IPC_CHANNELS,
  type AppIntegrationEvent,
  type AppIntegrationSettings,
  type AppIntegrationState
} from "./appIntegrationContracts.js";
import {
  ASSISTANT_IPC_CHANNELS,
  TORRENT_CORE_EVENT_CHANNEL,
  REMOTE_ACCESS_IPC_CHANNELS,
  TORRENT_IPC_CHANNELS,
  type AddMagnetRequest,
  type AddTorrentFileRequest,
  type AddTorrentUrlRequest,
  type AssistantProfileApplyRequest,
  type AssistantScheduleSuggestion,
  type AssistantState,
  type AssistantWarningDismissRequest,
  type AutomationSettings,
  type AutomationSettingsState,
  type CommitPreparedTorrentAddRequest,
  type ExportTorrentFileRequest,
  type ExportTorrentFileResult,
  type MoveTorrentDataRequest,
  type MoveTorrentDataResult,
  type NetworkDiagnosticsReport,
  type NetworkSettings,
  type NetworkSettingsState,
  type OpenTorrentFileRequest,
  type ReannounceTorrentResult,
  type RemoteAccessSettings,
  type RemoteAccessSettingsState,
  type RemoveTorrentRequest,
  type RenameTorrentRequest,
  type RunSpeedDoctorRequest,
  type SetTorrentFilePriorityRequest,
  type SetTorrentFilePrioritiesRequest,
  type SpeedDoctorPortCheckResult,
  type SpeedDoctorHistorySummary,
  type SpeedDoctorReportExport,
  type TorrentCoreEvent,
  type TorrentCoreResult,
  type TorrentEventLogEntry,
  type TorrentEventLogExport,
  type TorrentCoreSnapshot,
  type TorrentStatistics,
  type TorrentSpeedDoctorReport,
  type TorrentSummary,
  type UpdateTorrentLabelsRequest,
  type UpdateTorrentProfileRequest,
  type UpdateTorrentQueuePositionRequest,
  type WatchFolderScanResult
} from "./torrentCore/contracts.js";

contextBridge.exposeInMainWorld("storent", {
  platform: process.platform,
  appName: "sTorent",
  torrent: {
    addTorrentFile: (request: AddTorrentFileRequest = {}) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.addTorrentFile, request) as Promise<
        TorrentCoreResult<TorrentSummary>
      >,
    addTorrentUrl: (request: AddTorrentUrlRequest) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.addTorrentUrl, request) as Promise<
        TorrentCoreResult<TorrentSummary>
      >,
    addMagnet: (request: AddMagnetRequest) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.addMagnet, request) as Promise<
        TorrentCoreResult<TorrentSummary>
      >,
    pause: (id: string) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.pause, id) as Promise<
        TorrentCoreResult<TorrentSummary>
      >,
    resume: (id: string) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.resume, id) as Promise<
        TorrentCoreResult<TorrentSummary>
      >,
    forceStart: (id: string) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.forceStart, id) as Promise<
        TorrentCoreResult<TorrentSummary>
      >,
    remove: (request: string | RemoveTorrentRequest) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.remove, request) as Promise<
        TorrentCoreResult<TorrentCoreSnapshot>
      >,
    recheck: (id: string) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.recheck, id) as Promise<
        TorrentCoreResult<TorrentSummary>
      >,
    rename: (request: RenameTorrentRequest) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.rename, request) as Promise<
        TorrentCoreResult<TorrentSummary>
      >,
    moveData: (request: MoveTorrentDataRequest) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.moveData, request) as Promise<
        TorrentCoreResult<MoveTorrentDataResult>
      >,
    reannounce: (id: string) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.reannounce, id) as Promise<
        TorrentCoreResult<ReannounceTorrentResult>
      >,
    exportTorrentFile: (request: ExportTorrentFileRequest) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.exportTorrentFile, request) as Promise<
        TorrentCoreResult<ExportTorrentFileResult>
      >,
    copyMagnet: (id: string) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.copyMagnet, id) as Promise<
        TorrentCoreResult<string>
      >,
    openTorrentFolder: (id: string) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.openTorrentFolder, id) as Promise<
        TorrentCoreResult<true>
      >,
    openTorrentFile: (request: OpenTorrentFileRequest) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.openTorrentFile, request) as Promise<
        TorrentCoreResult<true>
      >,
    updateLabels: (request: UpdateTorrentLabelsRequest) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.updateLabels, request) as Promise<
        TorrentCoreResult<TorrentSummary>
      >,
    updateProfile: (request: UpdateTorrentProfileRequest) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.updateProfile, request) as Promise<
        TorrentCoreResult<TorrentSummary>
      >,
    setFilePriority: (request: SetTorrentFilePriorityRequest) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.setFilePriority, request) as Promise<
        TorrentCoreResult<TorrentSummary>
      >,
    setFilePriorities: (request: SetTorrentFilePrioritiesRequest) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.setFilePriorities, request) as Promise<
        TorrentCoreResult<TorrentSummary>
      >,
    commitPreparedAdd: (request: CommitPreparedTorrentAddRequest) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.commitPreparedAdd, request) as Promise<
        TorrentCoreResult<TorrentSummary>
      >,
    updateQueuePosition: (request: UpdateTorrentQueuePositionRequest) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.updateQueuePosition, request) as Promise<
        TorrentCoreResult<TorrentCoreSnapshot>
      >,
    getSnapshot: () =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.getSnapshot) as Promise<
        TorrentCoreResult<TorrentCoreSnapshot>
      >,
    getStatistics: () =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.getStatistics) as Promise<
        TorrentCoreResult<TorrentStatistics>
      >,
    getEventLogs: () =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.getEventLogs) as Promise<
        TorrentCoreResult<TorrentEventLogEntry[]>
      >,
    exportEventLogs: () =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.exportEventLogs) as Promise<
        TorrentCoreResult<TorrentEventLogExport>
      >,
    getNetworkSettings: () =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.getNetworkSettings) as Promise<
        TorrentCoreResult<NetworkSettingsState>
      >,
    updateNetworkSettings: (request: NetworkSettings) =>
      ipcRenderer.invoke(
        TORRENT_IPC_CHANNELS.updateNetworkSettings,
        request
      ) as Promise<TorrentCoreResult<NetworkSettingsState>>,
    runNetworkDiagnostics: () =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.runNetworkDiagnostics) as Promise<
        TorrentCoreResult<NetworkDiagnosticsReport>
      >,
    runSpeedDoctor: (id: string, options: Pick<RunSpeedDoctorRequest, "mode"> = {}) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.runSpeedDoctor, {
        id,
        ...options
      }) as Promise<
        TorrentCoreResult<TorrentSpeedDoctorReport>
      >,
    getSpeedDoctorHistory: () =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.getSpeedDoctorHistory) as Promise<
        TorrentCoreResult<SpeedDoctorHistorySummary>
      >,
    exportSpeedDoctorReport: (id: string) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.exportSpeedDoctorReport, id) as Promise<
        TorrentCoreResult<SpeedDoctorReportExport>
      >,
    mapIncomingPort: () =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.mapIncomingPort) as Promise<
        TorrentCoreResult<SpeedDoctorPortCheckResult>
      >,
    getAutomationSettings: () =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.getAutomationSettings) as Promise<
        TorrentCoreResult<AutomationSettingsState>
      >,
    updateAutomationSettings: (request: AutomationSettings) =>
      ipcRenderer.invoke(
        TORRENT_IPC_CHANNELS.updateAutomationSettings,
        request
      ) as Promise<TorrentCoreResult<AutomationSettingsState>>,
    runWatchFolderScan: () =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.runWatchFolderScan) as Promise<
        TorrentCoreResult<WatchFolderScanResult>
      >,
    getDroppedTorrentFilePaths: (files: File[]) =>
      files
        .map((file) => webUtils.getPathForFile(file))
        .filter((filePath) => filePath.toLowerCase().endsWith(".torrent")),
    onEvent: (listener: (event: TorrentCoreEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, event: TorrentCoreEvent) => {
        listener(event);
      };

      ipcRenderer.on(TORRENT_CORE_EVENT_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(TORRENT_CORE_EVENT_CHANNEL, handler);
      };
    }
  },
  remoteAccess: {
    getSettings: () =>
      ipcRenderer.invoke(REMOTE_ACCESS_IPC_CHANNELS.getSettings) as Promise<
        TorrentCoreResult<RemoteAccessSettingsState>
      >,
    updateSettings: (request: RemoteAccessSettings) =>
      ipcRenderer.invoke(
        REMOTE_ACCESS_IPC_CHANNELS.updateSettings,
        request
      ) as Promise<TorrentCoreResult<RemoteAccessSettingsState>>
  },
  assistant: {
    getState: () =>
      ipcRenderer.invoke(ASSISTANT_IPC_CHANNELS.getState) as Promise<
        TorrentCoreResult<AssistantState>
      >,
    applyProfile: (request: AssistantProfileApplyRequest) =>
      ipcRenderer.invoke(
        ASSISTANT_IPC_CHANNELS.profileApply,
        request
      ) as Promise<TorrentCoreResult<TorrentSummary>>,
    dismissWarning: (request: AssistantWarningDismissRequest) =>
      ipcRenderer.invoke(
        ASSISTANT_IPC_CHANNELS.warningDismiss,
        request
      ) as Promise<TorrentCoreResult<AssistantState>>,
    getScheduleSuggestion: (torrentId: string) =>
      ipcRenderer.invoke(
        ASSISTANT_IPC_CHANNELS.scheduleRequest,
        torrentId
      ) as Promise<TorrentCoreResult<AssistantScheduleSuggestion | null>>,
    onEvent: (listener: (event: AssistantEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, event: AssistantEvent) => {
        listener(event);
      };

      ipcRenderer.on(ASSISTANT_EVENT_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(ASSISTANT_EVENT_CHANNEL, handler);
      };
    }
  },
  ai: {
    getSettings: () =>
      ipcRenderer.invoke(AI_IPC_CHANNELS.getSettings) as Promise<
        AIResult<AISettingsState>
      >,
    updateSettings: (request: AISettings) =>
      ipcRenderer.invoke(AI_IPC_CHANNELS.updateSettings, request) as Promise<
        AIResult<AISettingsState>
      >,
    testProvider: (request: AIProviderConfig) =>
      ipcRenderer.invoke(AI_IPC_CHANNELS.testProvider, request) as Promise<
        AIResult<ProviderTestResult>
      >,
    listModels: (request: AIProviderConfig) =>
      ipcRenderer.invoke(AI_IPC_CHANNELS.listModels, request) as Promise<
        AIResult<string[]>
      >,
    requestAdvice: (request: AIAdviceRequest) =>
      ipcRenderer.invoke(AI_IPC_CHANNELS.requestAdvice, request) as Promise<
        AIResult<AIAdviceResult>
      >,
    onEvent: (listener: (event: AIEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, event: AIEvent) => {
        listener(event);
      };

      ipcRenderer.on(AI_EVENT_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(AI_EVENT_CHANNEL, handler);
      };
    }
  },
  updates: {
    getState: () =>
      ipcRenderer.invoke(APP_UPDATE_IPC_CHANNELS.getState) as Promise<AppUpdateState>,
    checkForUpdates: () =>
      ipcRenderer.invoke(
        APP_UPDATE_IPC_CHANNELS.checkForUpdates
      ) as Promise<AppUpdateState>,
    downloadUpdate: () =>
      ipcRenderer.invoke(
        APP_UPDATE_IPC_CHANNELS.downloadUpdate
      ) as Promise<AppUpdateState>,
    installUpdate: () =>
      ipcRenderer.invoke(
        APP_UPDATE_IPC_CHANNELS.installUpdate
      ) as Promise<AppUpdateState>,
    onEvent: (listener: (event: AppUpdateEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, event: AppUpdateEvent) => {
        listener(event);
      };

      ipcRenderer.on(APP_UPDATE_EVENT_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(APP_UPDATE_EVENT_CHANNEL, handler);
      };
    }
  },
  integration: {
    getState: () =>
      ipcRenderer.invoke(
        APP_INTEGRATION_IPC_CHANNELS.getState
      ) as Promise<AppIntegrationState>,
    updateSettings: (settings: AppIntegrationSettings) =>
      ipcRenderer.invoke(
        APP_INTEGRATION_IPC_CHANNELS.updateSettings,
        settings
      ) as Promise<AppIntegrationState>,
    registerDefaultHandlers: () =>
      ipcRenderer.invoke(
        APP_INTEGRATION_IPC_CHANNELS.registerDefaultHandlers
      ) as Promise<AppIntegrationState>,
    onEvent: (listener: (event: AppIntegrationEvent) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        event: AppIntegrationEvent
      ) => {
        listener(event);
      };

      ipcRenderer.on(APP_INTEGRATION_EVENT_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(APP_INTEGRATION_EVENT_CHANNEL, handler);
      };
    }
  }
});
