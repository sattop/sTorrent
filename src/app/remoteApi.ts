import type {
  AddMagnetRequest,
  AddTorrentFileRequest,
  AutomationSettings,
  AutomationSettingsState,
  NetworkDiagnosticsReport,
  NetworkSettings,
  NetworkSettingsState,
  SetTorrentFilePriorityRequest,
  TorrentCoreEvent,
  TorrentCoreResult,
  TorrentCoreSnapshot,
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
    remove: (id: string) =>
      apiRequest<TorrentCoreSnapshot>(
        `/api/torrents/${encodeURIComponent(id)}`,
        getPassword,
        { method: "DELETE" }
      ),
    recheck: (id: string) =>
      apiRequest<TorrentSummary>(
        `/api/torrents/${encodeURIComponent(id)}/recheck`,
        getPassword,
        { method: "POST" }
      ),
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
    onEvent: (_listener: (event: TorrentCoreEvent) => void) => () => {}
  };
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
