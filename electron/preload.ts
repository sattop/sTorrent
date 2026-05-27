import { contextBridge, ipcRenderer } from "electron";
import {
  TORRENT_CORE_EVENT_CHANNEL,
  REMOTE_ACCESS_IPC_CHANNELS,
  TORRENT_IPC_CHANNELS,
  type AddMagnetRequest,
  type AddTorrentFileRequest,
  type AutomationSettings,
  type AutomationSettingsState,
  type NetworkDiagnosticsReport,
  type NetworkSettings,
  type NetworkSettingsState,
  type RemoteAccessSettings,
  type RemoteAccessSettingsState,
  type SetTorrentFilePriorityRequest,
  type TorrentCoreEvent,
  type TorrentCoreResult,
  type TorrentCoreSnapshot,
  type TorrentSummary,
  type UpdateTorrentLabelsRequest,
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
  }
});
