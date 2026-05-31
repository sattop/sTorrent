import { contextBridge, ipcRenderer } from "electron";
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
  ASSISTANT_IPC_CHANNELS,
  TORRENT_CORE_EVENT_CHANNEL,
  REMOTE_ACCESS_IPC_CHANNELS,
  TORRENT_IPC_CHANNELS,
  type AddMagnetRequest,
  type AddTorrentFileRequest,
  type AssistantProfileApplyRequest,
  type AssistantScheduleSuggestion,
  type AssistantState,
  type AssistantWarningDismissRequest,
  type AutomationSettings,
  type AutomationSettingsState,
  type NetworkDiagnosticsReport,
  type NetworkSettings,
  type NetworkSettingsState,
  type RemoteAccessSettings,
  type RemoteAccessSettingsState,
  type RunSpeedDoctorRequest,
  type SetTorrentFilePriorityRequest,
  type SpeedDoctorPortCheckResult,
  type SpeedDoctorHistorySummary,
  type SpeedDoctorReportExport,
  type TorrentCoreEvent,
  type TorrentCoreResult,
  type TorrentCoreSnapshot,
  type TorrentSpeedDoctorReport,
  type TorrentSummary,
  type UpdateTorrentLabelsRequest,
  type UpdateTorrentProfileRequest,
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
    remove: (id: string) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.remove, id) as Promise<
        TorrentCoreResult<TorrentCoreSnapshot>
      >,
    recheck: (id: string) =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.recheck, id) as Promise<
        TorrentCoreResult<TorrentSummary>
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
    getSnapshot: () =>
      ipcRenderer.invoke(TORRENT_IPC_CHANNELS.getSnapshot) as Promise<
        TorrentCoreResult<TorrentCoreSnapshot>
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
  }
});
