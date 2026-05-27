import { describe, expect, it } from "vitest";
import { createAssistantBaseline } from "../src/features/assistant";
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
