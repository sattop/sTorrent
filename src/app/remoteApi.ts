import type {
  AddMagnetRequest,
  AddTorrentFileRequest,
  AddTorrentUrlRequest,
  AutomationSettings,
  AutomationSettingsState,
  NetworkDiagnosticsReport,
  NetworkSettings,
  NetworkSettingsState,
  OpenTorrentFileRequest,
  RemoveTorrentRequest,
  SetTorrentFilePriorityRequest,
  SpeedDoctorHistorySummary,
  SpeedDoctorPortCheckResult,
  SpeedDoctorReportExport,
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
  WatchFolderScanResult
} from "../../electron/torrentCore/contracts";

const REMOTE_PASSWORD_STORAGE_KEY = "storent.remoteAccess.password";

type TorrentApi = NonNullable<Window["storent"]>["torrent"];

export function getStoredRemotePassword() {
  return window.sessionStorage.getItem(REMOTE_PASSWORD_STORAGE_KEY) ?? "";
}

export function storeRemotePassword(password: string) {
  window.sessionStorage.setItem(REMOTE_PASSWORD_STORAGE_KEY, password);
}

export function clearStoredRemotePassword() {
  window.sessionStorage.removeItem(REMOTE_PASSWORD_STORAGE_KEY);
}

export function createRemoteTorrentApi(getPassword: () => string): TorrentApi {
  return {
    addTorrentFile: (_request: AddTorrentFileRequest = {}) =>
      Promise.resolve({
        ok: false,
        error: {
          code: "unsupported_remote_file_add",
          message: ".torrent file selection is available only in the desktop app."
        }
      }),
    addTorrentUrl: (request: AddTorrentUrlRequest) =>
      apiRequest<TorrentSummary>("/api/torrents/url", getPassword, {
        method: "POST",
        body: JSON.stringify(request)
      }),
    addMagnet: (request: AddMagnetRequest) =>
      apiRequest<TorrentSummary>("/api/torrents/magnet", getPassword, {
        method: "POST",
        body: JSON.stringify(request)
      }),
    pause: (id: string) =>
      apiRequest<TorrentSummary>(
        `/api/torrents/${encodeURIComponent(id)}/pause`,
        getPassword,
        { method: "POST" }
      ),
    resume: (id: string) =>
      apiRequest<TorrentSummary>(
        `/api/torrents/${encodeURIComponent(id)}/resume`,
        getPassword,
        { method: "POST" }
      ),
    remove: (request: string | RemoveTorrentRequest) => {
      const normalized =
        typeof request === "string" ? { id: request, deleteData: false } : request;

      if (normalized.deleteData) {
        return Promise.resolve({
          ok: false,
          error: {
            code: "unsupported_remote_delete_data",
            message: "Deleting downloaded data is available only in the desktop app."
          }
        }) as Promise<TorrentCoreResult<TorrentCoreSnapshot>>;
      }

      return apiRequest<TorrentCoreSnapshot>(
        `/api/torrents/${encodeURIComponent(normalized.id)}`,
        getPassword,
        { method: "DELETE" }
      );
    },
    recheck: (id: string) =>
      apiRequest<TorrentSummary>(
        `/api/torrents/${encodeURIComponent(id)}/recheck`,
        getPassword,
        { method: "POST" }
      ),
    copyMagnet: async (id: string) => {
      const result = await apiRequest<string>(
        `/api/torrents/${encodeURIComponent(id)}/magnet`,
        getPassword
      );

      if (!result.ok) {
        return result;
      }

      if (!navigator.clipboard?.writeText) {
        return {
          ok: false,
          error: {
            code: "clipboard_unavailable",
            message: "Clipboard access is unavailable in this browser context."
          }
        };
      }

      try {
        await navigator.clipboard.writeText(result.value);
        return result;
      } catch (error) {
        return {
          ok: false,
          error: {
            code: "clipboard_write_failed",
            message: getErrorMessage(error)
          }
        };
      }
    },
    openTorrentFolder: (_id: string) =>
      Promise.resolve({
        ok: false,
        error: {
          code: "unsupported_remote_os_open",
          message: "Opening folders is available only in the desktop app."
        }
      }) as Promise<TorrentCoreResult<true>>,
    openTorrentFile: (_request: OpenTorrentFileRequest) =>
      Promise.resolve({
        ok: false,
        error: {
          code: "unsupported_remote_os_open",
          message: "Opening files is available only in the desktop app."
        }
      }) as Promise<TorrentCoreResult<true>>,
    updateLabels: (request: UpdateTorrentLabelsRequest) => {
      const { id, ...body } = request;
      return apiRequest<TorrentSummary>(
        `/api/torrents/${encodeURIComponent(id)}/labels`,
        getPassword,
        {
          method: "PATCH",
          body: JSON.stringify(body)
        }
      );
    },
    updateProfile: (request: UpdateTorrentProfileRequest) => {
      const { id, ...body } = request;
      return apiRequest<TorrentSummary>(
        `/api/torrents/${encodeURIComponent(id)}/profile`,
        getPassword,
        {
          method: "PATCH",
          body: JSON.stringify(body)
        }
      );
    },
    setFilePriority: (request: SetTorrentFilePriorityRequest) => {
      const { id, fileIndex, ...body } = request;
      return apiRequest<TorrentSummary>(
        `/api/torrents/${encodeURIComponent(id)}/files/${fileIndex}`,
        getPassword,
        {
          method: "PATCH",
          body: JSON.stringify(body)
        }
      );
    },
    getSnapshot: () =>
      apiRequest<TorrentCoreSnapshot>("/api/snapshot", getPassword),
    getStatistics: () =>
      apiRequest<TorrentStatistics>("/api/statistics", getPassword),
    getEventLogs: () =>
      apiRequest<TorrentEventLogEntry[]>("/api/event-logs", getPassword),
    exportEventLogs: () =>
      apiRequest<TorrentEventLogExport>("/api/event-logs/export", getPassword, {
        method: "POST"
      }),
    getNetworkSettings: () =>
      apiRequest<NetworkSettingsState>("/api/network-settings", getPassword),
    updateNetworkSettings: (request: NetworkSettings) =>
      apiRequest<NetworkSettingsState>("/api/network-settings", getPassword, {
        method: "PUT",
        body: JSON.stringify(request)
      }),
    runNetworkDiagnostics: () =>
      Promise.resolve({
        ok: false,
        error: {
          code: "unsupported_remote_diagnostics",
          message: "Network diagnostics are available only in the desktop app."
        }
      }) as Promise<TorrentCoreResult<NetworkDiagnosticsReport>>,
    runSpeedDoctor: (id: string) =>
      apiRequest<TorrentSpeedDoctorReport>(
        `/api/torrents/${encodeURIComponent(id)}/speed-doctor`,
        getPassword
      ),
    getSpeedDoctorHistory: () =>
      apiRequest<SpeedDoctorHistorySummary>("/api/speed-doctor/history", getPassword),
    exportSpeedDoctorReport: (id: string) =>
      apiRequest<SpeedDoctorReportExport>(
        `/api/torrents/${encodeURIComponent(id)}/speed-doctor/export`,
        getPassword,
        { method: "POST" }
      ),
    mapIncomingPort: () =>
      Promise.resolve({
        ok: false,
        error: {
          code: "unsupported_remote_port_mapping",
          message: "Router port mapping is available only in the desktop app."
        }
      }) as Promise<TorrentCoreResult<SpeedDoctorPortCheckResult>>,
    getAutomationSettings: () =>
      apiRequest<AutomationSettingsState>("/api/automation-settings", getPassword),
    updateAutomationSettings: (request: AutomationSettings) =>
      apiRequest<AutomationSettingsState>(
        "/api/automation-settings",
        getPassword,
        {
          method: "PUT",
          body: JSON.stringify(request)
        }
      ),
    runWatchFolderScan: () =>
      apiRequest<WatchFolderScanResult>("/api/watch-folders/scan", getPassword, {
        method: "POST"
      }),
    getDroppedTorrentFilePaths: () => [],
    onEvent: (_listener: (event: TorrentCoreEvent) => void) => () => {}
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function apiRequest<T>(
  path: string,
  getPassword: () => string,
  init: RequestInit = {}
): Promise<TorrentCoreResult<T>> {
  try {
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getPassword()}`,
        ...init.headers
      }
    });
    const body = (await response.json()) as TorrentCoreResult<T>;

    if ("ok" in body) {
      return body;
    }

    return {
      ok: false,
      error: {
        code: "invalid_remote_response",
        message: "Remote API returned an invalid response."
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "remote_network_error",
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}
