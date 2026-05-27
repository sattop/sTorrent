export const DOWNLOAD_PROFILE_IDS = [
  "max_speed",
  "stream_while_downloading",
  "night_mode",
  "private_tracker",
  "vpn_interface",
  "traffic_saver",
  "manual"
] as const;

export type DownloadProfileId = (typeof DOWNLOAD_PROFILE_IDS)[number];

export const NETWORK_PROFILE_IDS = [
  "standard",
  "private_tracker",
  "encryption",
  "proxy",
  "vpn_interface",
  "traffic_saver"
] as const;

export type NetworkProfileId = (typeof NETWORK_PROFILE_IDS)[number];

export const BITTORRENT_ENCRYPTION_MODES = [
  "disabled",
  "allowed",
  "preferred",
  "required"
] as const;

export type BitTorrentEncryptionMode =
  (typeof BITTORRENT_ENCRYPTION_MODES)[number];

export const PROXY_TYPES = ["none", "socks5", "http"] as const;

export type ProxyType = (typeof PROXY_TYPES)[number];

export const TORRENT_CORE_EVENT_NAMES = [
  "torrent.added",
  "torrent.metadata.received",
  "torrent.progress.updated",
  "torrent.status.changed",
  "torrent.completed",
  "torrent.labels.updated",
  "torrent.files.updated",
  "torrent.error",
  "assistant.profile.applied",
  "automation.settings.changed",
  "automation.watch.added",
  "automation.watch.scan.completed",
  "settings.changed",
  "diagnostics.speed.checked"
] as const;

export const TORRENT_CORE_EVENT_CHANNEL = "torrent:event";

export const TORRENT_IPC_CHANNELS = {
  addTorrentFile: "torrent:addTorrentFile",
  addMagnet: "torrent:addMagnet",
  pause: "torrent:pause",
  resume: "torrent:resume",
  remove: "torrent:remove",
  recheck: "torrent:recheck",
  updateLabels: "torrent:updateLabels",
  setFilePriority: "torrent:setFilePriority",
  getSnapshot: "torrent:getSnapshot",
  getNetworkSettings: "torrent:getNetworkSettings",
  updateNetworkSettings: "torrent:updateNetworkSettings",
  runNetworkDiagnostics: "torrent:runNetworkDiagnostics",
  getAutomationSettings: "torrent:getAutomationSettings",
  updateAutomationSettings: "torrent:updateAutomationSettings",
  runWatchFolderScan: "torrent:runWatchFolderScan"
} as const;

export const REMOTE_ACCESS_HOSTS = ["127.0.0.1", "0.0.0.0"] as const;

export type RemoteAccessHost = (typeof REMOTE_ACCESS_HOSTS)[number];

export const REMOTE_ACCESS_IPC_CHANNELS = {
  getSettings: "remoteAccess:getSettings",
  updateSettings: "remoteAccess:updateSettings"
} as const;

export type TorrentCoreEventName = (typeof TORRENT_CORE_EVENT_NAMES)[number];

export type TorrentStatus =
  | "adding"
  | "checking"
  | "queued"
  | "downloading"
  | "paused"
  | "seeding"
  | "completed"
  | "error";

export type TorrentSourceType = "torrent_file" | "magnet";

export const TORRENT_FILE_PRIORITIES = ["skip", "normal", "high"] as const;

export type TorrentFilePriority = (typeof TORRENT_FILE_PRIORITIES)[number];

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
  infoHash: string | null;
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
  savePath: string;
  metadataReady: boolean;
  private: boolean;
  sourceType: TorrentSourceType;
  selectedProfileId: DownloadProfileId;
  recheckAvailable: boolean;
  category: string | null;
  tags: string[];
  files: TorrentFileInfo[];
}

export interface TorrentAddOptions {
  downloadPath?: string;
  profileId?: DownloadProfileId;
  startPaused?: boolean;
  category?: string | null;
  tags?: string[];
  filePriorities?: Record<string, TorrentFilePriority>;
}

export interface AddTorrentFileRequest extends TorrentAddOptions {
  filePath?: string;
}

export interface AddMagnetRequest extends TorrentAddOptions {
  magnetUri: string;
}

export interface UpdateTorrentLabelsRequest {
  id: string;
  category?: string | null;
  tags?: string[];
}

export interface SetTorrentFilePriorityRequest {
  id: string;
  fileIndex: number;
  priority: TorrentFilePriority;
}

export interface TorrentCoreSnapshot {
  torrents: TorrentSummary[];
  downloadSpeedBytes: number;
  uploadSpeedBytes: number;
}

export interface SpeedLimitSettings {
  downloadBytesPerSecond: number | null;
  uploadBytesPerSecond: number | null;
}

export interface NetworkInterfaceBindingSettings {
  name: string | null;
  bindOnly: boolean;
  killSwitch: boolean;
}

export interface ProxySettings {
  type: ProxyType;
  host: string;
  port: number | null;
  username: string;
  passwordConfigured: boolean;
  applyToTrackers: boolean;
  applyToPeers: boolean;
}

export interface NetworkSettings {
  profileId: NetworkProfileId;
  dht: boolean;
  pex: boolean;
  lsd: boolean;
  privateMode: boolean;
  incomingPort: number | null;
  upnp: boolean;
  natPmp: boolean;
  encryptionMode: BitTorrentEncryptionMode;
  speedLimits: SpeedLimitSettings;
  networkInterface: NetworkInterfaceBindingSettings;
  proxy: ProxySettings;
}

export interface NetworkCapabilities {
  globalSpeedLimits: boolean;
  dhtPexLsdAtStartup: boolean;
  incomingPortAtStartup: boolean;
  upnpNatPmpAtStartup: boolean;
  proxy: boolean;
  protocolEncryption: boolean;
  interfaceBinding: boolean;
  safeTrafficOnly: true;
}

export interface NetworkInterfaceInfo {
  name: string;
  address: string;
  family: string;
  internal: boolean;
  mac: string | null;
}

export interface NetworkSettingsState {
  settings: NetworkSettings;
  activeSettings: NetworkSettings;
  restartRequired: boolean;
  capabilities: NetworkCapabilities;
  availableInterfaces: NetworkInterfaceInfo[];
}

export interface WatchFolderSettings {
  id: string;
  path: string;
  enabled: boolean;
  profileId: DownloadProfileId;
  startPaused: boolean;
  category: string | null;
  tags: string[];
}

export interface FavoriteFolderSettings {
  id: string;
  name: string;
  path: string;
  category: string | null;
  tags: string[];
}

export interface SeedingRuleSettings {
  id: string;
  name: string;
  enabled: boolean;
  ratioLimit: number | null;
  minutesAfterComplete: number | null;
  action: "pause";
  requireConfirmationBeforeDataRemoval: true;
}

export interface RssAutoLoadRuleSettings {
  id: string;
  name: string;
  enabled: boolean;
  feedUrl: string;
  match: string;
  exclude: string;
  profileId: DownloadProfileId;
  category: string | null;
  tags: string[];
  seenItemIds: string[];
}

export interface SpeedLimitScheduleSettings {
  id: string;
  name: string;
  enabled: boolean;
  daysOfWeek: number[];
  startMinuteOfDay: number;
  endMinuteOfDay: number;
  downloadBytesPerSecond: number | null;
  uploadBytesPerSecond: number | null;
}

export interface AutomationSettings {
  watchFolders: WatchFolderSettings[];
  favoriteFolders: FavoriteFolderSettings[];
  seedingRules: SeedingRuleSettings[];
  rssRules: RssAutoLoadRuleSettings[];
  speedSchedules: SpeedLimitScheduleSettings[];
  hooksEnabled: false;
}

export interface AutomationCapabilities {
  watchFolders: boolean;
  favoriteFolders: boolean;
  seedingRules: boolean;
  rssDuplicatePrevention: boolean;
  speedLimitSchedules: boolean;
  hooks: false;
  safeDataRemovalOnly: true;
}

export interface AutomationSettingsState {
  settings: AutomationSettings;
  capabilities: AutomationCapabilities;
  activeSpeedScheduleId: string | null;
}

export interface WatchFolderScanResult {
  scannedFolders: number;
  addedTorrents: number;
  skippedTorrents: number;
  errors: string[];
}

export interface RemoteAccessSettings {
  enabled: boolean;
  host: RemoteAccessHost;
  port: number;
  allowedIps: string[];
  password?: string;
}

export interface RemoteAccessPublicSettings {
  enabled: boolean;
  host: RemoteAccessHost;
  port: number;
  allowedIps: string[];
  passwordConfigured: boolean;
}

export interface RemoteAccessRuntimeState {
  running: boolean;
  origin: string | null;
  lastError: string | null;
}

export interface RemoteAccessCapabilities {
  localWebUi: true;
  passwordRequired: true;
  ipAllowlist: true;
  apiDocs: true;
}

export interface RemoteAccessSettingsState {
  settings: RemoteAccessPublicSettings;
  runtime: RemoteAccessRuntimeState;
  capabilities: RemoteAccessCapabilities;
}

export type NetworkDiagnosticStatus =
  | "ok"
  | "info"
  | "warning"
  | "unsupported";

export type NetworkDiagnosticCode =
  | "safe_traffic_policy"
  | "restart_required"
  | "global_download_limit"
  | "global_upload_limit"
  | "incoming_port"
  | "peer_discovery"
  | "private_torrent_policy"
  | "proxy_unsupported"
  | "interface_binding_unsupported"
  | "encryption_unsupported";

export interface NetworkDiagnosticCheck {
  code: NetworkDiagnosticCode;
  status: NetworkDiagnosticStatus;
  value?: string | number | boolean | null;
}

export interface NetworkDiagnosticsReport {
  generatedAt: string;
  summary: NetworkDiagnosticStatus;
  checks: NetworkDiagnosticCheck[];
  redacted: true;
}

export interface TorrentCoreErrorPayload {
  id: string | null;
  message: string;
}

export interface TorrentStatusChangedPayload {
  id: string;
  status: TorrentStatus;
  torrent: TorrentSummary;
}

export interface AssistantProfileAppliedPayload {
  id: string;
  profileId: DownloadProfileId;
  appliedOptions: string[];
}

export interface SettingsChangedPayload {
  network: NetworkSettingsState;
}

export interface AutomationSettingsChangedPayload {
  automation: AutomationSettingsState;
}

export interface AutomationWatchAddedPayload {
  folderId: string;
  filePath: string;
  torrent: TorrentSummary;
}

export interface AutomationWatchScanCompletedPayload {
  result: WatchFolderScanResult;
}

export interface DiagnosticsSpeedCheckedPayload {
  report: NetworkDiagnosticsReport;
}

export interface TorrentCoreEventPayloadMap {
  "torrent.added": TorrentSummary;
  "torrent.metadata.received": TorrentSummary;
  "torrent.progress.updated": TorrentSummary;
  "torrent.status.changed": TorrentStatusChangedPayload;
  "torrent.completed": TorrentSummary;
  "torrent.labels.updated": TorrentSummary;
  "torrent.files.updated": TorrentSummary;
  "torrent.error": TorrentCoreErrorPayload;
  "assistant.profile.applied": AssistantProfileAppliedPayload;
  "automation.settings.changed": AutomationSettingsChangedPayload;
  "automation.watch.added": AutomationWatchAddedPayload;
  "automation.watch.scan.completed": AutomationWatchScanCompletedPayload;
  "settings.changed": SettingsChangedPayload;
  "diagnostics.speed.checked": DiagnosticsSpeedCheckedPayload;
}

export type TorrentCoreEvent = {
  [EventName in keyof TorrentCoreEventPayloadMap]: {
    type: EventName;
    payload: TorrentCoreEventPayloadMap[EventName];
  };
}[keyof TorrentCoreEventPayloadMap];

export type TorrentCoreResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };
