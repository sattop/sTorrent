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
  AddMagnetRequest,
  AddTorrentFileRequest,
  AssistantProfileApplyRequest,
  AssistantScheduleSuggestion,
  AssistantState,
  AssistantWarningDismissRequest,
  AutomationSettings,
  AutomationSettingsState,
  NetworkDiagnosticsReport,
  NetworkSettings,
  NetworkSettingsState,
  RemoteAccessSettings,
  RemoteAccessSettingsState,
  SetTorrentFilePriorityRequest,
  SpeedDoctorHistorySummary,
  SpeedDoctorPortCheckResult,
  SpeedDoctorReportExport,
  SpeedDoctorScanMode,
  TorrentCoreEvent,
  TorrentCoreResult,
  TorrentCoreSnapshot,
  TorrentSpeedDoctorReport,
  TorrentSummary,
  UpdateTorrentLabelsRequest,
  UpdateTorrentProfileRequest,
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
        addMagnet(
          request: AddMagnetRequest
        ): Promise<TorrentCoreResult<TorrentSummary>>;
        pause(id: string): Promise<TorrentCoreResult<TorrentSummary>>;
        resume(id: string): Promise<TorrentCoreResult<TorrentSummary>>;
        remove(id: string): Promise<TorrentCoreResult<TorrentCoreSnapshot>>;
        recheck(id: string): Promise<TorrentCoreResult<TorrentSummary>>;
        updateLabels(
          request: UpdateTorrentLabelsRequest
        ): Promise<TorrentCoreResult<TorrentSummary>>;
        updateProfile(
          request: UpdateTorrentProfileRequest
        ): Promise<TorrentCoreResult<TorrentSummary>>;
        setFilePriority(
          request: SetTorrentFilePriorityRequest
        ): Promise<TorrentCoreResult<TorrentSummary>>;
        getSnapshot(): Promise<TorrentCoreResult<TorrentCoreSnapshot>>;
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
    };
  }
}

export {};
