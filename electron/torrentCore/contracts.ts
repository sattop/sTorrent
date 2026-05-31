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
  "assistant.health.computed",
  "assistant.schedule.suggestion",
  "assistant.profile.applied",
  "automation.settings.changed",
  "automation.watch.added",
  "automation.watch.scan.completed",
  "settings.changed",
  "diagnostics.speed.checked",
  "diagnostics.torrent_speed.checked",
  "speedDoctor.status.updated",
  "speedDoctor.anomaly.detected",
  "speedDoctor.diagnosis.ready",
  "speedDoctor.report.ready"
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
  updateProfile: "torrent:updateProfile",
  setFilePriority: "torrent:setFilePriority",
  getSnapshot: "torrent:getSnapshot",
  getNetworkSettings: "torrent:getNetworkSettings",
  updateNetworkSettings: "torrent:updateNetworkSettings",
  runNetworkDiagnostics: "torrent:runNetworkDiagnostics",
  runSpeedDoctor: "torrent:runSpeedDoctor",
  getSpeedDoctorHistory: "torrent:getSpeedDoctorHistory",
  exportSpeedDoctorReport: "torrent:exportSpeedDoctorReport",
  mapIncomingPort: "torrent:mapIncomingPort",
  getAutomationSettings: "torrent:getAutomationSettings",
  updateAutomationSettings: "torrent:updateAutomationSettings",
  runWatchFolderScan: "torrent:runWatchFolderScan"
} as const;

export const ASSISTANT_IPC_CHANNELS = {
  getState: "assistant:getState",
  profileApply: "assistant.profile.apply",
  warningDismiss: "assistant.warning.dismiss",
  scheduleRequest: "assistant.schedule.request"
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

export const SPEED_DOCTOR_ACTION_IDS = [
  "resume_torrent",
  "remove_temporary_limit",
  "switch_download_profile",
  "toggle_dht_for_public_torrent",
  "check_port",
  "enable_upnp_nat_pmp",
  "choose_network_interface",
  "check_proxy",
  "move_up_queue",
  "raise_file_priority",
  "open_folder",
  "recheck_data",
  "show_trackers",
  "copy_report",
  "save_report",
  "prefer_encryption",
  "open_speed_schedule"
] as const;

export type SpeedDoctorActionId = (typeof SPEED_DOCTOR_ACTION_IDS)[number];

export const SPEED_DOCTOR_REASON_CODES = [
  "torrent_paused",
  "torrent_queued",
  "global_download_limit",
  "active_speed_schedule",
  "traffic_saver_profile",
  "low_seed_count",
  "no_connected_peers",
  "tracker_error",
  "incoming_port_closed",
  "incoming_port_auto",
  "incoming_port_unverified",
  "public_discovery_disabled",
  "private_discovery_enabled",
  "proxy_unsupported",
  "proxy_connection_failed",
  "interface_unavailable",
  "disk_space_low",
  "disk_stalled",
  "file_locked",
  "queue_busy",
  "low_file_priority",
  "dead_torrent",
  "recent_errors",
  "all_files_skipped",
  "metadata_pending",
  "speed_drop_sudden",
  "speed_below_baseline",
  "all_peers_choked",
  "dht_degraded",
  "isp_throttling_suspect",
  "external_port_closed"
] as const;

export type SpeedDoctorReasonCode =
  (typeof SPEED_DOCTOR_REASON_CODES)[number];

export type SpeedDoctorReportStatus = "ok" | "warning" | "critical";
export type SpeedDoctorReasonSeverity = "low" | "medium" | "high";
export type SpeedDoctorScanMode = "quick" | "full";

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
  addedAt: string;
  metadataReceivedAt: string | null;
  lastActivityAt: string | null;
  lastError: string | null;
  trackerHosts: string[];
  connectedSeeds: number;
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

export interface UpdateTorrentProfileRequest {
  id: string;
  profileId: DownloadProfileId;
  source?: AssistantProfileUsageRecord["source"];
}

export interface RunSpeedDoctorRequest {
  id: string;
  mode?: SpeedDoctorScanMode;
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

export interface SpeedDoctorReason {
  code: SpeedDoctorReasonCode;
  severity: SpeedDoctorReasonSeverity;
  evidence?: string | number | boolean | null;
  actionId?: SpeedDoctorActionId;
}

export interface SpeedDoctorDiskDetails {
  availableBytes: number;
  totalBytes: number;
  remainingBytes: number;
  stalledSeconds: number | null;
  lockedFileCount: number;
}

export type SpeedDoctorProbeStatus =
  | "ok"
  | "warning"
  | "failed"
  | "unknown"
  | "unsupported";

export type SpeedDoctorPortMappingStatus =
  | "enabled"
  | "disabled"
  | "unavailable"
  | "error";

export type SpeedDoctorAnomalyType =
  | "speed_drop_sudden"
  | "speed_below_baseline"
  | "all_peers_choked"
  | "disk_bottleneck"
  | "tracker_errors"
  | "dht_degraded"
  | "isp_throttling_suspect";

export interface SpeedDoctorSpeedMetric {
  timestamp: string;
  downloadSpeedKb: number;
  uploadSpeedKb: number;
  activeTorrents: number;
  activePeers: number;
  connectedSeeds: number;
  trackerErrors: number;
  diskWriteSpeedKb: number;
  diskQueueDepth: number;
  dhtNodes: number;
}

export interface SpeedDoctorChartPoint {
  hour: string;
  downloadKb: number;
  uploadKb: number;
  peers: number;
}

export interface SpeedDoctorThrottlingAnalysis {
  suspected: boolean;
  confidence: number;
  slowHours: number[];
  fastHours: number[];
  speedDropPercent: number;
  sampleHours: number;
}

export interface SpeedDoctorAnomaly {
  type: SpeedDoctorAnomalyType;
  severity: SpeedDoctorReasonSeverity;
  detectedAt: string;
  context: Record<string, number | string | boolean | null>;
}

export interface SpeedDoctorHistorySummary {
  generatedAt: string;
  points24h: SpeedDoctorChartPoint[];
  points7d: SpeedDoctorChartPoint[];
  averageByHourKb: number[];
  bestHours: number[];
  peakSpeedLast24hKb: number;
  sampleCount: number;
  anomalies: SpeedDoctorAnomaly[];
  ispThrottling: SpeedDoctorThrottlingAnalysis;
}

export interface SpeedDoctorPortCheckResult {
  port: number | null;
  protocol: "tcp";
  localBinding: SpeedDoctorProbeStatus;
  externallyReachable: boolean | null;
  firewallBlocked: boolean | null;
  upnpStatus: SpeedDoctorPortMappingStatus;
  natPmpStatus: SpeedDoctorPortMappingStatus;
  notes: string[];
}

export interface SpeedDoctorDiagnosisAction {
  id: SpeedDoctorActionId;
  label: string;
  type: "safe" | "manual" | "navigation";
  instruction?: string;
  url?: string;
}

export interface SpeedDoctorDiagnosis {
  id: string;
  severity: SpeedDoctorReasonSeverity;
  title: string;
  explanation: string;
  actions: SpeedDoctorDiagnosisAction[];
}

export interface SpeedDoctorRuntimeInput {
  activeTorrentCount: number;
  activeDownloadCount: number;
  connectedSeeds: number;
  queuedPeerCount: number;
  trackerHosts: string[];
  trackerErrorCount: number;
  lastTrackerError: string | null;
  noPeersSources: string[];
  recentErrors: string[];
  stalledSeconds: number | null;
  lockedFileCount: number;
  incomingPortProbe: SpeedDoctorProbeStatus;
  proxyProbe: SpeedDoctorProbeStatus;
}

export interface SpeedDoctorTechnicalDetails {
  torrent: {
    id: string;
    status: TorrentStatus;
    progress: number;
    downloadSpeedBytes: number;
    uploadSpeedBytes: number;
    seeds: number;
    peers: number;
    selectedProfileId: DownloadProfileId;
    private: boolean;
    sourceType: TorrentSourceType;
    metadataReady: boolean;
    fileCount: number;
    selectedFileCount: number;
    lowPrioritySelectedFileCount: number;
  };
  network: {
    profileId: NetworkProfileId;
    dht: boolean;
    pex: boolean;
    lsd: boolean;
    incomingPortConfigured: boolean;
    upnp: boolean;
    natPmp: boolean;
    downloadLimitBytesPerSecond: number | null;
    uploadLimitBytesPerSecond: number | null;
    proxyType: ProxyType;
    interfaceSelected: boolean;
    activeSpeedScheduleId: string | null;
  };
  runtime: SpeedDoctorRuntimeInput;
  disk: SpeedDoctorDiskDetails | null;
  portCheck: SpeedDoctorPortCheckResult;
  speedHistory: SpeedDoctorHistorySummary;
  anomalies: SpeedDoctorAnomaly[];
  diagnoses: SpeedDoctorDiagnosis[];
  exportText: string;
}

export interface TorrentSpeedDoctorReport {
  generatedAt: string;
  torrentId: string;
  scanMode: SpeedDoctorScanMode;
  durationMs: number;
  status: SpeedDoctorReportStatus;
  primaryReason: SpeedDoctorReasonCode | null;
  reasons: SpeedDoctorReason[];
  actions: SpeedDoctorActionId[];
  technicalDetails: SpeedDoctorTechnicalDetails;
  redacted: true;
}

export interface SpeedDoctorReportExport {
  reportPath: string;
  report: TorrentSpeedDoctorReport;
}

export interface AssistantProfileUsageRecord {
  profileId: DownloadProfileId;
  torrentId: string | null;
  source: "add_dialog" | "existing_torrent" | "speed_doctor" | "api";
  usedAt: string;
}

export interface AssistantWarningDismissal {
  warningId: string;
  torrentId: string | null;
  dismissedAt: string;
}

export interface AssistantState {
  profileUsage: AssistantProfileUsageRecord[];
  dismissedWarnings: AssistantWarningDismissal[];
  lastProfileId: DownloadProfileId | null;
  usageCounts: Record<DownloadProfileId, number>;
}

export interface AssistantProfileApplyRequest {
  torrentId: string;
  profileId: DownloadProfileId;
  source?: AssistantProfileUsageRecord["source"];
}

export interface AssistantWarningDismissRequest {
  warningId: string;
  torrentId?: string | null;
}

export interface AssistantHealthComputedPayload {
  torrentId: string;
  score: number;
  status: "good" | "normal" | "weak" | "critical";
  warnings: string[];
  suggestedProfile: DownloadProfileId;
  computedAt: string;
}

export interface AssistantScheduleSuggestion {
  torrentId: string;
  generatedAt: string;
  bestHours: number[];
  recommendedStartHour: number;
  recommendedEndHour: number;
  expectedSpeedupPercent: number;
  nightFaster: boolean;
  confidence: number;
  sampleCount: number;
  message: string;
}

export interface AssistantScheduleSuggestionPayload {
  suggestion: AssistantScheduleSuggestion;
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

export interface DiagnosticsTorrentSpeedCheckedPayload {
  report: TorrentSpeedDoctorReport;
}

export interface SpeedDoctorStatusUpdatedPayload {
  torrentId: string;
  portOpen: boolean | null;
  dhtNodes: number;
  trackerCount: number;
  currentSpeedKb: number;
}

export interface SpeedDoctorAnomalyDetectedPayload {
  torrentId: string;
  anomaly: SpeedDoctorAnomaly;
}

export interface SpeedDoctorDiagnosisReadyPayload {
  torrentId: string;
  diagnoses: SpeedDoctorDiagnosis[];
}

export interface SpeedDoctorReportReadyPayload {
  torrentId: string;
  reportPath: string;
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
  "assistant.health.computed": AssistantHealthComputedPayload;
  "assistant.schedule.suggestion": AssistantScheduleSuggestionPayload;
  "assistant.profile.applied": AssistantProfileAppliedPayload;
  "automation.settings.changed": AutomationSettingsChangedPayload;
  "automation.watch.added": AutomationWatchAddedPayload;
  "automation.watch.scan.completed": AutomationWatchScanCompletedPayload;
  "settings.changed": SettingsChangedPayload;
  "diagnostics.speed.checked": DiagnosticsSpeedCheckedPayload;
  "diagnostics.torrent_speed.checked": DiagnosticsTorrentSpeedCheckedPayload;
  "speedDoctor.status.updated": SpeedDoctorStatusUpdatedPayload;
  "speedDoctor.anomaly.detected": SpeedDoctorAnomalyDetectedPayload;
  "speedDoctor.diagnosis.ready": SpeedDoctorDiagnosisReadyPayload;
  "speedDoctor.report.ready": SpeedDoctorReportReadyPayload;
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
