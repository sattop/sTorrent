import {
  DOWNLOAD_PROFILE_IDS,
  type SmartAssistantBaseline
} from "./types";

export function createAssistantBaseline(): SmartAssistantBaseline {
  return {
    status: "ready_for_future_rules",
    supportedProfiles: [...DOWNLOAD_PROFILE_IDS],
    appliesAutomatically: false
  };
}

export { DOWNLOAD_PROFILE_IDS };
export type { DownloadProfileId, SmartAssistantBaseline } from "./types";
