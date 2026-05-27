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

export type AssistantStatus = "ready_for_future_rules";

export interface SmartAssistantBaseline {
  status: AssistantStatus;
  supportedProfiles: DownloadProfileId[];
  appliesAutomatically: false;
}
