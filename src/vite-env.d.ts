/// <reference types="vite/client" />

import type {
  AddMagnetRequest,
  AddTorrentFileRequest,
  AutomationSettings,
  AutomationSettingsState,
  NetworkDiagnosticsReport,
  NetworkSettings,
  NetworkSettingsState,
  RemoteAccessSettings,
  RemoteAccessSettingsState,
  SetTorrentFilePriorityRequest,
  TorrentCoreEvent,
  TorrentCoreResult,
  TorrentCoreSnapshot,
  TorrentSummary,
  UpdateTorrentLabelsRequest,
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
    };
  }
}

export {};
