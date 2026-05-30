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

export type AssistantStatus = "rules_v1";

export type SmartAssistantReasonCode =
  | "manual_profile_selected"
  | "private_mode_enabled"
  | "private_tag_detected"
  | "private_metadata"
  | "media_content_detected"
  | "large_torrent_detected"
  | "disk_space_available"
  | "disk_space_low"
  | "file_conflict_detected"
  | "healthy_swarm_detected"
  | "low_peer_availability"
  | "folder_template_matched"
  | "last_profile_reused"
  | "traffic_saver_network"
  | "active_speed_schedule"
  | "many_active_downloads"
  | "favorite_folder_selected"
  | "default_fast_public";

export type SmartAssistantWarningCode =
  | "private_mode_safety"
  | "streaming_efficiency"
  | "disk_space_low"
  | "file_conflict"
  | "low_peer_availability"
  | "metadata_pending";

export type SmartAssistantSuggestionType =
  | "folder"
  | "category"
  | "tags"
  | "file_priority"
  | "start_paused"
  | "recheck_after_complete"
  | "profile_template";

export interface SmartAssistantFileInput {
  name: string;
  path: string;
  lengthBytes: number;
  selected?: boolean;
}

export interface SmartAssistantFolderTemplate {
  id: string;
  name: string;
  path: string;
  category: string | null;
  tags: string[];
}

export interface SmartAssistantDiskInput {
  availableBytes: number;
  totalBytes?: number;
}

export interface SmartAssistantSuggestion {
  type: SmartAssistantSuggestionType;
  value: string;
  values?: string[];
  label?: string;
  filePath?: string;
  requiresConfirmation: boolean;
}

export interface SmartAssistantInput {
  selectedProfileId?: DownloadProfileId;
  lastSelectedProfileId?: DownloadProfileId;
  category?: string | null;
  tags?: string[];
  favoriteFolderSelected?: boolean;
  favoriteFolders?: SmartAssistantFolderTemplate[];
  activeDownloadCount?: number;
  networkProfileId?: string | null;
  privateMode?: boolean;
  activeSpeedSchedule?: boolean;
  sizeBytes?: number;
  files?: SmartAssistantFileInput[];
  savePath?: string | null;
  disk?: SmartAssistantDiskInput | null;
  existingFileNames?: string[];
  metadataReady?: boolean;
  privateTorrent?: boolean;
  seeds?: number;
  peers?: number;
  sourceType?: "torrent_file" | "magnet";
}

export interface SmartAssistantRecommendation {
  profileId: DownloadProfileId;
  confidence: number;
  reasons: SmartAssistantReasonCode[];
  warnings: SmartAssistantWarningCode[];
  suggestions: SmartAssistantSuggestion[];
  appliesAutomatically: false;
}

export interface SmartAssistantBaseline {
  status: AssistantStatus;
  supportedProfiles: DownloadProfileId[];
  appliesAutomatically: false;
}
