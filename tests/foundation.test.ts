import { describe, expect, it } from "vitest";
import {
  createAssistantBaseline,
  createSmartAssistantRecommendation
} from "../src/features/assistant";
import { createSpeedDoctorBaseline } from "../src/features/speedDoctor";

describe("stage 0 feature contracts", () => {
  it("registers the required Smart Download Assistant profiles", () => {
    expect(createAssistantBaseline().supportedProfiles).toEqual([
      "max_speed",
      "stream_while_downloading",
      "night_mode",
      "private_tracker",
      "vpn_interface",
      "traffic_saver",
      "manual"
    ]);
  });

  it("keeps assistant changes user-confirmed at the foundation stage", () => {
    expect(createAssistantBaseline().appliesAutomatically).toBe(false);
  });

  it("recommends private tracker mode when private intent is visible", () => {
    const recommendation = createSmartAssistantRecommendation({
      tags: ["private", "ratio"]
    });

    expect(recommendation).toMatchObject({
      profileId: "private_tracker",
      appliesAutomatically: false
    });
    expect(recommendation.reasons).toContain("private_tag_detected");
  });

  it("uses metadata to suggest folders, labels, and guarded file actions", () => {
    const recommendation = createSmartAssistantRecommendation({
      metadataReady: true,
      files: [
        {
          name: "Example Movie.mkv",
          path: "Example Movie.mkv",
          lengthBytes: 5 * 1024 * 1024 * 1024
        }
      ],
      disk: {
        availableBytes: 1024 * 1024 * 1024
      },
      existingFileNames: ["Example Movie.mkv"],
      favoriteFolders: [
        {
          id: "movies",
          name: "Movies",
          path: "D:/Media/Movies",
          category: "Media",
          tags: ["movie"]
        }
      ],
      seeds: 0,
      peers: 0
    });

    expect(recommendation.profileId).toBe("stream_while_downloading");
    expect(recommendation.reasons).toEqual(
      expect.arrayContaining([
        "media_content_detected",
        "large_torrent_detected",
        "disk_space_low",
        "file_conflict_detected",
        "low_peer_availability",
        "folder_template_matched"
      ])
    );
    expect(recommendation.warnings).toEqual(
      expect.arrayContaining([
        "streaming_efficiency",
        "disk_space_low",
        "file_conflict",
        "low_peer_availability"
      ])
    );
    expect(recommendation.suggestions.map((suggestion) => suggestion.type)).toEqual(
      expect.arrayContaining([
        "folder",
        "category",
        "tags",
        "file_priority",
        "start_paused",
        "recheck_after_complete",
        "profile_template"
      ])
    );
  });

  it("keeps explicit profile choices user-controlled", () => {
    const recommendation = createSmartAssistantRecommendation({
      selectedProfileId: "traffic_saver",
      category: "Movies"
    });

    expect(recommendation.profileId).toBe("traffic_saver");
    expect(recommendation.reasons).toContain("manual_profile_selected");
  });

  it("does not include forbidden traffic impersonation actions", () => {
    const actions = createSpeedDoctorBaseline().supportedActions;

    expect(actions).not.toContain("impersonate_steam");
    expect(actions).not.toContain("impersonate_discord");
    expect(actions).not.toContain("bypass_network_rules");
  });

  it("requires confirmation for Speed Doctor actions that mutate settings", () => {
    expect(createSpeedDoctorBaseline().requiresConfirmationForMutations).toBe(
      true
    );
  });
});
