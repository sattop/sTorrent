export const APP_UPDATE_EVENT_CHANNEL = "appUpdate:event";

export const APP_UPDATE_IPC_CHANNELS = {
  getState: "appUpdate:getState",
  checkForUpdates: "appUpdate:checkForUpdates",
  downloadUpdate: "appUpdate:downloadUpdate",
  installUpdate: "appUpdate:installUpdate"
} as const;

export type AppUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "not_available"
  | "downloading"
  | "downloaded"
  | "error";

export interface AppUpdateReleaseInfo {
  version: string;
  releaseName: string | null;
  releaseDate: string | null;
  releaseNotes: string | null;
}

export interface AppUpdateProgress {
  percent: number;
  transferredBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
}

export interface AppUpdateState {
  status: AppUpdateStatus;
  currentVersion: string;
  canCheckForUpdates: boolean;
  checkedAt: string | null;
  update: AppUpdateReleaseInfo | null;
  progress: AppUpdateProgress | null;
  errorMessage: string | null;
}

export interface AppUpdateEvent {
  state: AppUpdateState;
}
