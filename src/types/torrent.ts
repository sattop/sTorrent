export type TorrentStatus =
  | "adding"
  | "checking"
  | "queued"
  | "downloading"
  | "paused"
  | "seeding"
  | "completed"
  | "error";

export type TorrentFilePriority = "skip" | "normal" | "high";

export interface TorrentFileInfo {
  index: number;
  name: string;
  path: string;
  lengthBytes: number;
  downloadedBytes: number;
  progress: number;
  priority: TorrentFilePriority;
  selected: boolean;
}

export interface TorrentSummary {
  id: string;
  name: string;
  status: TorrentStatus;
  progress: number;
  sizeBytes: number;
  downloadedBytes: number;
  downloadSpeedBytes: number;
  uploadSpeedBytes: number;
  seeds: number;
  peers: number;
  etaSeconds: number | null;
  category: string | null;
  tags: string[];
  files: TorrentFileInfo[];
}
