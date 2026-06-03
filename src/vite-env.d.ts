/// <reference types="vite/client" />

import type {
  AIAdviceRequest,
  AIAdviceResult,
  AIEvent,
  AIProviderConfig,
  AIResult,
  AISettings,
  AISettingsState,
  ProviderTestResult
} from "../electron/aiContracts";
import type { AssistantEvent } from "../electron/assistantEvents";
import type { AppUpdateEvent, AppUpdateState } from "../electron/appUpdateContracts";
import type {
  AppIntegrationEvent,
  AppIntegrationSettings,
  AppIntegrationState
} from "../electron/appIntegrationContracts";
import type {
  AddMagnetRequest,
  AddTorrentFileRequest,
  AddTorrentUrlRequest,
  AssistantProfileApplyRequest,
  AssistantScheduleSuggestion,
  AssistantState,
  AssistantWarningDismissRequest,
  AutomationSettings,
  AutomationSettingsState,
  CommitPreparedTorrentAddRequest,
  ExportTorrentFileRequest,
  ExportTorrentFileResult,
  MoveTorrentDataRequest,
  MoveTorrentDataResult,
  NetworkDiagnosticsReport,
  NetworkSettings,
  NetworkSettingsState,
  OpenTorrentFileRequest,
  ReannounceTorrentResult,
  RemoteAccessSettings,
  RemoteAccessSettingsState,
  RemoveTorrentRequest,
  RenameTorrentRequest,
  SetTorrentFilePriorityRequest,
  SetTorrentFilePrioritiesRequest,
  SpeedDoctorHistorySummary,
  SpeedDoctorPortCheckResult,
  SpeedDoctorReportExport,
  SpeedDoctorScanMode,
  TorrentCoreEvent,
  TorrentCoreResult,
  TorrentEventLogEntry,
  TorrentEventLogExport,
  TorrentCoreSnapshot,
  TorrentStatistics,
  TorrentSpeedDoctorReport,
  TorrentSummary,
  UpdateTorrentLabelsRequest,
  UpdateTorrentProfileRequest,
  UpdateTorrentQueuePositionRequest,
  WatchFolderScanResult
} from "../electron/torrentCore/contracts";

declare global {
  interface Window {
    storent?: {
      platform: NodeJS.Platform;
      appName: string;
      torrent: {
        addTorrentFile(
          request?: AddTorrentFileRequest
        ): Promise<TorrentCoreResult<TorrentSummary>>;
        addTorrentUrl(
          request: AddTorrentUrlRequest
        ): Promise<TorrentCoreResult<TorrentSummary>>;
        addMagnet(
          request: AddMagnetRequest
        ): Promise<TorrentCoreResult<TorrentSummary>>;
        pause(id: string): Promise<TorrentCoreResult<TorrentSummary>>;
        resume(id: string): Promise<TorrentCoreResult<TorrentSummary>>;
        forceStart(id: string): Promise<TorrentCoreResult<TorrentSummary>>;
        remove(
          request: string | RemoveTorrentRequest
        ): Promise<TorrentCoreResult<TorrentCoreSnapshot>>;
        recheck(id: string): Promise<TorrentCoreResult<TorrentSummary>>;
        rename(
          request: RenameTorrentRequest
        ): Promise<TorrentCoreResult<TorrentSummary>>;
        moveData(
          request: MoveTorrentDataRequest
        ): Promise<TorrentCoreResult<MoveTorrentDataResult>>;
        reannounce(
          id: string
        ): Promise<TorrentCoreResult<ReannounceTorrentResult>>;
        exportTorrentFile(
          request: ExportTorrentFileRequest
        ): Promise<TorrentCoreResult<ExportTorrentFileResult>>;
        copyMagnet(id: string): Promise<TorrentCoreResult<string>>;
        openTorrentFolder(id: string): Promise<TorrentCoreResult<true>>;
        openTorrentFile(
          request: OpenTorrentFileRequest
        ): Promise<TorrentCoreResult<true>>;
        updateLabels(
          request: UpdateTorrentLabelsRequest
        ): Promise<TorrentCoreResult<TorrentSummary>>;
        updateProfile(
          request: UpdateTorrentProfileRequest
        ): Promise<TorrentCoreResult<TorrentSummary>>;
        setFilePriority(
          request: SetTorrentFilePriorityRequest
        ): Promise<TorrentCoreResult<TorrentSummary>>;
        setFilePriorities(
          request: SetTorrentFilePrioritiesRequest
        ): Promise<TorrentCoreResult<TorrentSummary>>;
        commitPreparedAdd(
          request: CommitPreparedTorrentAddRequest
        ): Promise<TorrentCoreResult<TorrentSummary>>;
        updateQueuePosition(
          request: UpdateTorrentQueuePositionRequest
        ): Promise<TorrentCoreResult<TorrentCoreSnapshot>>;
        getSnapshot(): Promise<TorrentCoreResult<TorrentCoreSnapshot>>;
        getStatistics(): Promise<TorrentCoreResult<TorrentStatistics>>;
        getEventLogs(): Promise<TorrentCoreResult<TorrentEventLogEntry[]>>;
        exportEventLogs(): Promise<TorrentCoreResult<TorrentEventLogExport>>;
        getNetworkSettings(): Promise<TorrentCoreResult<NetworkSettingsState>>;
        updateNetworkSettings(
          request: NetworkSettings
        ): Promise<TorrentCoreResult<NetworkSettingsState>>;
        runNetworkDiagnostics(): Promise<
          TorrentCoreResult<NetworkDiagnosticsReport>
        >;
        runSpeedDoctor(
          id: string,
          options?: { mode?: SpeedDoctorScanMode }
        ): Promise<TorrentCoreResult<TorrentSpeedDoctorReport>>;
        getSpeedDoctorHistory(): Promise<
          TorrentCoreResult<SpeedDoctorHistorySummary>
        >;
        exportSpeedDoctorReport(
          id: string
        ): Promise<TorrentCoreResult<SpeedDoctorReportExport>>;
        mapIncomingPort(): Promise<TorrentCoreResult<SpeedDoctorPortCheckResult>>;
        getAutomationSettings(): Promise<
          TorrentCoreResult<AutomationSettingsState>
        >;
        updateAutomationSettings(
          request: AutomationSettings
        ): Promise<TorrentCoreResult<AutomationSettingsState>>;
        runWatchFolderScan(): Promise<TorrentCoreResult<WatchFolderScanResult>>;
        getDroppedTorrentFilePaths(files: File[]): string[];
        onEvent(listener: (event: TorrentCoreEvent) => void): () => void;
      };
      remoteAccess: {
        getSettings(): Promise<TorrentCoreResult<RemoteAccessSettingsState>>;
        updateSettings(
          request: RemoteAccessSettings
        ): Promise<TorrentCoreResult<RemoteAccessSettingsState>>;
      };
      assistant: {
        getState(): Promise<TorrentCoreResult<AssistantState>>;
        applyProfile(
          request: AssistantProfileApplyRequest
        ): Promise<TorrentCoreResult<TorrentSummary>>;
        dismissWarning(
          request: AssistantWarningDismissRequest
        ): Promise<TorrentCoreResult<AssistantState>>;
        getScheduleSuggestion(
          torrentId: string
        ): Promise<TorrentCoreResult<AssistantScheduleSuggestion | null>>;
        onEvent(listener: (event: AssistantEvent) => void): () => void;
      };
      ai: {
        getSettings(): Promise<AIResult<AISettingsState>>;
        updateSettings(request: AISettings): Promise<AIResult<AISettingsState>>;
        testProvider(
          request: AIProviderConfig
        ): Promise<AIResult<ProviderTestResult>>;
        listModels(request: AIProviderConfig): Promise<AIResult<string[]>>;
        requestAdvice(
          request: AIAdviceRequest
        ): Promise<AIResult<AIAdviceResult>>;
        onEvent(listener: (event: AIEvent) => void): () => void;
      };
      updates: {
        getState(): Promise<AppUpdateState>;
        checkForUpdates(): Promise<AppUpdateState>;
        downloadUpdate(): Promise<AppUpdateState>;
        installUpdate(): Promise<AppUpdateState>;
        onEvent(listener: (event: AppUpdateEvent) => void): () => void;
      };
      integration: {
        getState(): Promise<AppIntegrationState>;
        updateSettings(
          settings: AppIntegrationSettings
        ): Promise<AppIntegrationState>;
        registerDefaultHandlers(): Promise<AppIntegrationState>;
        onEvent(listener: (event: AppIntegrationEvent) => void): () => void;
      };
    };
  }
}

export {};
