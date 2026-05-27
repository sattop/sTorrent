import { mkdtemp } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_EVENTS } from "../src/app/events";
import { DOWNLOAD_PROFILE_IDS as UI_PROFILE_IDS } from "../src/features/assistant";
import {
  type AutomationSettings,
  DOWNLOAD_PROFILE_IDS as CORE_PROFILE_IDS,
  TORRENT_CORE_EVENT_NAMES
} from "../electron/torrentCore/contracts";
import {
  evaluateRssRuleCandidates,
  normalizeAutomationSettings,
  resolveActiveSpeedSchedule
} from "../electron/torrentCore/automation";
import {
  DOWNLOAD_PROFILE_DEFINITIONS,
  buildWebTorrentAddOptions
} from "../electron/torrentCore/profiles";
import { createNetworkDiagnosticsReport } from "../electron/torrentCore/networkDiagnostics";
import {
  DEFAULT_NETWORK_SETTINGS,
  NETWORK_CAPABILITIES,
  applyNetworkProfile,
  buildWebTorrentClientOptions,
  normalizeNetworkSettings
} from "../electron/torrentCore/networkSettings";
import {
  DEFAULT_REMOTE_ACCESS_SETTINGS,
  RemoteAccessServer,
  type RemoteAccessCore,
  hashRemoteAccessPassword,
  isRemoteAddressAllowed,
  normalizeRemoteAccessSettings,
  verifyRemoteAccessPassword
} from "../electron/torrentCore/remoteAccess";
import {
  normalizeFilePriority,
  normalizeTorrentCategory,
  normalizeTorrentTags
} from "../electron/torrentCore/labels";
import { toTorrentFileInfo } from "../electron/torrentCore/webtorrentCore";

describe("torrent-core contracts", () => {
  it("keeps core profile ids aligned with the assistant profile ids", () => {
    expect(CORE_PROFILE_IDS).toEqual(UI_PROFILE_IDS);
  });

  it("emits only event names that are part of the application event model", () => {
    expect(CORE_EVENTS).toEqual(
      expect.arrayContaining([...TORRENT_CORE_EVENT_NAMES])
    );
  });

  it("applies the private tracker profile without traffic impersonation", () => {
    const profile = DOWNLOAD_PROFILE_DEFINITIONS.private_tracker;

    expect(profile.torrentOptions).toMatchObject({
      private: true,
      strategy: "rarest"
    });
    expect(profile.appliedOptions).not.toContain("impersonate_steam");
    expect(profile.appliedOptions).not.toContain("impersonate_discord");
    expect(profile.appliedOptions).not.toContain("bypass_network_rules");
  });

  it("never destroys downloaded data when building add options", () => {
    const { webTorrentOptions } = buildWebTorrentAddOptions({
      downloadPath: "D:/Downloads",
      profileId: "manual",
      startPaused: true
    });

    expect(webTorrentOptions).toMatchObject({
      addUID: true,
      destroyStoreOnDestroy: false,
      path: "D:/Downloads",
      paused: true
    });
  });

  it("normalizes categories, tags, and file priorities at the core boundary", () => {
    expect(normalizeTorrentCategory("  Linux   ISO  ")).toBe("Linux ISO");
    expect(normalizeTorrentCategory("   ")).toBeNull();
    expect(normalizeTorrentTags(["Movies", "movies", "  archive  "])).toEqual([
      "Movies",
      "archive"
    ]);
    expect(normalizeTorrentTags("alpha, beta;alpha")).toEqual([
      "alpha",
      "beta"
    ]);
    expect(normalizeFilePriority("high")).toBe("high");
    expect(normalizeFilePriority("unknown")).toBe("normal");
  });

  it("normalizes incomplete WebTorrent file stats before exposing summaries", () => {
    const file = toTorrentFileInfo(
      {
        name: "storent-render-repro",
        path: "storent-render-repro",
        length: 35,
        downloaded: undefined,
        progress: undefined
      },
      0,
      {},
      "sample.torrent"
    );

    expect(file).toMatchObject({
      lengthBytes: 35,
      downloadedBytes: 0,
      progress: 0,
      priority: "normal",
      selected: true
    });
  });

  it("normalizes stage 4 network settings and applies global speed limits", () => {
    const settings = normalizeNetworkSettings({
      incomingPort: 70000,
      speedLimits: {
        downloadBytesPerSecond: 512.4,
        uploadBytesPerSecond: -1
      },
      proxy: {
        type: "socks5",
        host: " 127.0.0.1 ",
        port: 9050,
        username: " user ",
        passwordConfigured: true,
        applyToTrackers: true,
        applyToPeers: false
      }
    });

    expect(settings.incomingPort).toBeNull();
    expect(settings.speedLimits.downloadBytesPerSecond).toBe(512);
    expect(settings.speedLimits.uploadBytesPerSecond).toBeNull();
    expect(settings.proxy).toMatchObject({
      type: "socks5",
      host: "127.0.0.1",
      port: 9050,
      username: "user",
      passwordConfigured: true
    });

    expect(buildWebTorrentClientOptions(settings)).toMatchObject({
      downloadLimit: 512,
      uploadLimit: -1
    });
  });

  it("maps the private tracker network profile to safe discovery settings", () => {
    const settings = applyNetworkProfile(
      DEFAULT_NETWORK_SETTINGS,
      "private_tracker"
    );

    expect(settings).toMatchObject({
      dht: false,
      pex: false,
      lsd: false,
      privateMode: true
    });
    expect(buildWebTorrentClientOptions(settings)).toMatchObject({
      dht: false,
      utPex: false,
      lsd: false
    });
  });

  it("reports unsupported network features without traffic impersonation", () => {
    const settings = normalizeNetworkSettings({
      ...DEFAULT_NETWORK_SETTINGS,
      encryptionMode: "required",
      proxy: {
        ...DEFAULT_NETWORK_SETTINGS.proxy,
        type: "socks5",
        host: "127.0.0.1",
        port: 9050
      },
      networkInterface: {
        name: "VPN",
        bindOnly: true,
        killSwitch: true
      }
    });
    const report = createNetworkDiagnosticsReport({
      settings,
      activeSettings: settings,
      capabilities: NETWORK_CAPABILITIES,
      availableInterfaces: [],
      torrents: []
    });

    expect(report.redacted).toBe(true);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "proxy_unsupported" }),
        expect.objectContaining({ code: "interface_binding_unsupported" }),
        expect.objectContaining({ code: "encryption_unsupported" })
      ])
    );
    expect(JSON.stringify(report)).not.toContain("impersonate");
  });

  it("normalizes stage 5 automation settings without unsafe data removal", () => {
    const settings = normalizeAutomationSettings({
      watchFolders: [
        {
          id: " Main Watch ",
          path: " D:/Incoming ",
          enabled: true,
          profileId: "traffic_saver",
          startPaused: true,
          category: " Linux ISO ",
          tags: ["linux", "linux", "iso"]
        }
      ],
      seedingRules: [
        {
          id: " seed ",
          name: " Pause after ratio ",
          enabled: true,
          ratioLimit: 2.5,
          minutesAfterComplete: 60,
          action: "pause",
          requireConfirmationBeforeDataRemoval: true
        }
      ],
      hooksEnabled: true
    } as unknown as Partial<AutomationSettings>);

    expect(settings.watchFolders[0]).toMatchObject({
      id: "main-watch",
      path: "D:/Incoming",
      profileId: "traffic_saver",
      startPaused: true,
      category: "Linux ISO",
      tags: ["linux", "iso"]
    });
    expect(settings.seedingRules[0]).toMatchObject({
      action: "pause",
      requireConfirmationBeforeDataRemoval: true
    });
    expect(settings.hooksEnabled).toBe(false);
  });

  it("deduplicates RSS autoload candidates before accepting downloads", () => {
    const [rule] = normalizeAutomationSettings({
      rssRules: [
        {
          id: "ubuntu",
          name: "Ubuntu",
          enabled: true,
          feedUrl: "https://example.test/feed.xml",
          match: "ubuntu",
          exclude: "beta",
          profileId: "manual",
          category: "Linux",
          tags: ["iso"],
          seenItemIds: []
        }
      ]
    } as Partial<AutomationSettings>).rssRules;

    const firstPass = evaluateRssRuleCandidates(rule, [
      { id: "1", title: "Ubuntu 26.04 ISO", magnetUri: "magnet:?xt=1" },
      { id: "1", title: "Ubuntu 26.04 ISO duplicate", magnetUri: "magnet:?xt=1" },
      { id: "2", title: "Ubuntu beta ISO", magnetUri: "magnet:?xt=2" }
    ]);
    const secondPass = evaluateRssRuleCandidates(firstPass.rule, [
      { id: "1", title: "Ubuntu 26.04 ISO", magnetUri: "magnet:?xt=1" }
    ]);

    expect(firstPass.accepted).toHaveLength(1);
    expect(firstPass.rule.seenItemIds).toEqual(["1"]);
    expect(secondPass.accepted).toHaveLength(0);
  });

  it("resolves overnight speed limit schedules", () => {
    const settings = normalizeAutomationSettings({
      speedSchedules: [
        {
          id: "night",
          name: "Night",
          enabled: true,
          daysOfWeek: [1],
          startMinuteOfDay: 23 * 60,
          endMinuteOfDay: 2 * 60,
          downloadBytesPerSecond: 512 * 1024,
          uploadBytesPerSecond: 128 * 1024
        }
      ]
    } as Partial<AutomationSettings>);

    expect(
      resolveActiveSpeedSchedule(settings, new Date(2026, 4, 25, 23, 30))?.id
    ).toBe("night");
    expect(
      resolveActiveSpeedSchedule(settings, new Date(2026, 4, 26, 1, 30))?.id
    ).toBe("night");
    expect(resolveActiveSpeedSchedule(settings, new Date(2026, 4, 26, 3, 0))).toBe(
      null
    );
  });

  it("keeps stage 6 remote access disabled and loopback-only by default", () => {
    const settings = normalizeRemoteAccessSettings(undefined);

    expect(settings).toMatchObject({
      enabled: false,
      host: "127.0.0.1",
      port: 43171,
      allowedIps: ["127.0.0.1", "::1"],
      passwordHash: null,
      passwordSalt: null
    });
  });

  it("normalizes remote access IP allowlists and ports", () => {
    const settings = normalizeRemoteAccessSettings({
      enabled: true,
      host: "0.0.0.0",
      port: 8080,
      allowedIps: [
        "192.168.1.0/24",
        "192.168.1.20",
        "invalid",
        "192.168.1.0/40"
      ]
    });

    expect(settings).toMatchObject({
      enabled: true,
      host: "0.0.0.0",
      port: 8080,
      allowedIps: ["192.168.1.0/24", "192.168.1.20"]
    });

    expect(
      normalizeRemoteAccessSettings({ port: 80 }, DEFAULT_REMOTE_ACCESS_SETTINGS)
        .port
    ).toBe(43171);
  });

  it("enforces remote API client IP restrictions", () => {
    expect(isRemoteAddressAllowed("::ffff:192.168.1.42", ["192.168.1.0/24"]))
      .toBe(true);
    expect(isRemoteAddressAllowed("192.168.2.42", ["192.168.1.0/24"])).toBe(
      false
    );
    expect(isRemoteAddressAllowed("::1", ["::1"])).toBe(true);
  });

  it("verifies remote access passwords without storing plaintext", () => {
    const password = hashRemoteAccessPassword("correct horse");

    expect(password.hash).not.toContain("correct horse");
    expect(
      verifyRemoteAccessPassword("correct horse", {
        passwordHash: password.hash,
        passwordSalt: password.salt
      })
    ).toBe(true);
    expect(
      verifyRemoteAccessPassword("wrong horse", {
        passwordHash: password.hash,
        passwordSalt: password.salt
      })
    ).toBe(false);
  });

  it("protects the remote API with password auth and routes torrent actions", async () => {
    const port = await getFreePort();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "storent-remote-"));
    const calls: string[] = [];
    const torrent = createTestTorrentSummary();
    const core: RemoteAccessCore = {
      addMagnet: async () => torrent,
      pause: (id) => {
        calls.push(`pause:${id}`);
        return { ...torrent, id, status: "paused" };
      },
      resume: (id) => {
        calls.push(`resume:${id}`);
        return { ...torrent, id, status: "downloading" };
      },
      remove: async () => ({
        torrents: [],
        downloadSpeedBytes: 0,
        uploadSpeedBytes: 0
      }),
      recheck: async () => ({ ...torrent, status: "checking" }),
      updateLabels: () => torrent,
      setFilePriority: () => torrent,
      getSnapshot: () => ({
        torrents: [torrent],
        downloadSpeedBytes: 0,
        uploadSpeedBytes: 0
      }),
      getNetworkSettingsState: () => ({
        settings: DEFAULT_NETWORK_SETTINGS,
        activeSettings: DEFAULT_NETWORK_SETTINGS,
        restartRequired: false,
        capabilities: NETWORK_CAPABILITIES,
        availableInterfaces: []
      }),
      updateNetworkSettings: async (settings) => ({
        settings,
        activeSettings: settings,
        restartRequired: false,
        capabilities: NETWORK_CAPABILITIES,
        availableInterfaces: []
      }),
      getAutomationSettingsState: () => ({
        settings: {
          watchFolders: [],
          favoriteFolders: [],
          seedingRules: [],
          rssRules: [],
          speedSchedules: [],
          hooksEnabled: false
        },
        capabilities: {
          watchFolders: true,
          favoriteFolders: true,
          seedingRules: true,
          rssDuplicatePrevention: true,
          speedLimitSchedules: true,
          hooks: false,
          safeDataRemovalOnly: true
        },
        activeSpeedScheduleId: null
      }),
      updateAutomationSettings: async (settings) => ({
        settings,
        capabilities: {
          watchFolders: true,
          favoriteFolders: true,
          seedingRules: true,
          rssDuplicatePrevention: true,
          speedLimitSchedules: true,
          hooks: false,
          safeDataRemovalOnly: true
        },
        activeSpeedScheduleId: null
      }),
      runWatchFolderScan: async () => ({
        scannedFolders: 0,
        addedTorrents: 0,
        skippedTorrents: 0,
        errors: []
      })
    };
    const server = new RemoteAccessServer({
      core,
      settingsFilePath: path.join(tempDir, "remote-access.json"),
      staticRoot: tempDir
    });

    try {
      const state = await server.updateSettings({
        enabled: true,
        host: "127.0.0.1",
        port,
        allowedIps: ["127.0.0.1"],
        password: "correct horse"
      });

      expect(state.runtime.running).toBe(true);
      expect(state.settings.passwordConfigured).toBe(true);

      const unauthorized = await fetch(`${state.runtime.origin}/api/snapshot`);
      expect(unauthorized.status).toBe(401);

      const authorized = await fetch(`${state.runtime.origin}/api/snapshot`, {
        headers: { Authorization: "Bearer correct horse" }
      });
      const snapshot = await authorized.json();

      expect(authorized.status).toBe(200);
      expect(snapshot).toMatchObject({
        ok: true,
        value: {
          torrents: [expect.objectContaining({ id: torrent.id })]
        }
      });

      const pause = await fetch(
        `${state.runtime.origin}/api/torrents/${torrent.id}/pause`,
        {
          method: "POST",
          headers: { Authorization: "Bearer correct horse" }
        }
      );
      const pauseResult = await pause.json();

      expect(pauseResult).toMatchObject({
        ok: true,
        value: { id: torrent.id, status: "paused" }
      });
      expect(calls).toContain(`pause:${torrent.id}`);
    } finally {
      await server.shutdown();
    }
  });
});

async function getFreePort() {
  const server = net.createServer();

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });

  if (!address || typeof address === "string") {
    throw new Error("Failed to allocate a test port.");
  }

  return address.port;
}

function createTestTorrentSummary() {
  return {
    id: "abc123",
    infoHash: "abc123",
    name: "Test torrent",
    status: "downloading" as const,
    progress: 0.5,
    sizeBytes: 1024,
    downloadedBytes: 512,
    downloadSpeedBytes: 0,
    uploadSpeedBytes: 0,
    seeds: 0,
    peers: 0,
    etaSeconds: null,
    savePath: "D:/Downloads",
    metadataReady: true,
    private: false,
    sourceType: "magnet" as const,
    selectedProfileId: "manual" as const,
    recheckAvailable: true,
    category: null,
    tags: [],
    files: []
  };
}
