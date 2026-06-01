import { mkdtemp, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CORE_EVENTS } from "../src/app/events";
import {
  DOWNLOAD_PROFILE_IDS as UI_PROFILE_IDS,
  computeTorrentHealthScore,
  createSmartAssistantRecommendation
} from "../src/features/assistant";
import {
  AI_PROVIDER_DEFINITIONS,
  AI_PROVIDER_IDS,
  AI_EVENT_CHANNEL,
  DEFAULT_AI_SETTINGS,
  type AIProviderId,
  createDefaultAIProviderConfig,
  getAIProviderConfig,
  getAIProviderDefinition,
  normalizeAIProviderBaseUrl
} from "../electron/aiContracts";
import { AIService } from "../electron/aiService";
import { ASSISTANT_EVENT_NAMES } from "../electron/assistantEvents";
import {
  type AutomationSettings,
  DOWNLOAD_PROFILE_IDS as CORE_PROFILE_IDS,
  TORRENT_CORE_EVENT_NAMES,
  normalizeRemoveTorrentRequest
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
import { createTorrentSpeedDoctorReport } from "../electron/torrentCore/speedDoctor";
import { SpeedHistoryStore } from "../electron/torrentCore/speedHistory";
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
import {
  normalizeTorrentUrl,
  toTorrentFileInfo
} from "../electron/torrentCore/webtorrentCore";
import {
  createTorrentEventLogEntry,
  sanitizeEventLogText,
  trimTorrentEventLogEntries
} from "../electron/torrentCore/eventLog";
import {
  accumulateTorrentTrafficSample,
  createTorrentStatisticsCounters
} from "../electron/torrentCore/statistics";
import { normalizeTorrentColumns } from "../src/app/torrentColumns";

describe("torrent-core contracts", () => {
  it("keeps core profile ids aligned with the assistant profile ids", () => {
    expect(CORE_PROFILE_IDS).toEqual(UI_PROFILE_IDS);
  });

  it("defines AI providers without storing API keys in default settings", () => {
    expect(AI_PROVIDER_DEFINITIONS.map((provider) => provider.id)).toEqual(
      expect.arrayContaining(["anthropic", "openai", "lmstudio", "ollama", "custom"])
    );
    expect(getAIProviderDefinition("lmstudio")).toMatchObject({
      defaultBaseUrl: "http://localhost:1234/v1",
      requiresApiKey: false
    });
    expect(createDefaultAIProviderConfig("openrouter")).toMatchObject({
      providerId: "openrouter",
      apiKeyConfigured: false
    });
    expect(JSON.stringify(DEFAULT_AI_SETTINGS)).not.toContain('"apiKey":');
  });

  it("resolves the requested AI provider and expands bare provider origins", () => {
    const providers = DEFAULT_AI_SETTINGS.providers.map((provider) =>
      provider.providerId === "lmstudio"
        ? { ...provider, baseUrl: "http://127.0.0.1:1234" }
        : provider
    );

    expect(getAIProviderConfig(providers, "lmstudio")).toMatchObject({
      providerId: "lmstudio",
      baseUrl: "http://127.0.0.1:1234"
    });
    expect(normalizeAIProviderBaseUrl("lmstudio", "http://127.0.0.1:1234")).toBe(
      "http://127.0.0.1:1234/v1"
    );
    expect(normalizeAIProviderBaseUrl("openrouter", "https://openrouter.ai")).toBe(
      "https://openrouter.ai/api/v1"
    );
    expect(normalizeAIProviderBaseUrl("custom", "http://127.0.0.1:9000")).toBe(
      "http://127.0.0.1:9000"
    );
  });

  it("routes every AI provider connection test to its configured adapter", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "storent-ai-"));
    const service = createTestAIService(tempDir);
    const providerEvents: AIProviderId[] = [];
    const originalFetch = globalThis.fetch;
    const openAICompatibleProviders: AIProviderId[] = [
      "openai",
      "mistral",
      "groq",
      "together",
      "openrouter",
      "lmstudio",
      "ollama",
      "jan",
      "llamacpp",
      "textgenwebui",
      "custom"
    ];
    const cases = [
      ...openAICompatibleProviders.map((providerId) => {
        const baseUrl = createBareTestBaseUrl(providerId);
        return {
          providerId,
          apiKey: shouldUseTestApiKey(providerId) ? "test-key" : undefined,
          baseUrl,
          expectedUrl: `${normalizeAIProviderBaseUrl(providerId, baseUrl)}/models`,
          expectedMethod: "GET",
          responseBody: { data: [{ id: `${providerId}-model` }] },
          expectedModels: [`${providerId}-model`]
        };
      }),
      {
        providerId: "anthropic" as const,
        apiKey: "test-key",
        baseUrl: "https://api.anthropic.test",
        expectedUrl: "https://api.anthropic.test/v1/messages",
        expectedMethod: "POST",
        responseBody: { content: [{ text: "ok" }] },
        expectedModels: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"]
      },
      {
        providerId: "gemini" as const,
        apiKey: "test-key",
        baseUrl: "https://generativelanguage.googleapis.test",
        expectedUrl: "https://generativelanguage.googleapis.test/v1beta/models?key=test-key",
        expectedMethod: "GET",
        responseBody: {
          models: [
            {
              name: "models/gemini-test",
              supportedGenerationMethods: ["generateContent"]
            }
          ]
        },
        expectedModels: ["gemini-test"]
      },
      {
        providerId: "koboldcpp" as const,
        baseUrl: "http://kobold.test",
        expectedUrl: "http://kobold.test/api/v1/model",
        expectedMethod: "GET",
        responseBody: { result: "kobold-test" },
        expectedModels: ["kobold-test"]
      },
      {
        providerId: "anythingllm" as const,
        baseUrl: "http://anythingllm.test",
        expectedUrl: "http://anythingllm.test/api/v1/workspaces",
        expectedMethod: "GET",
        responseBody: { workspaces: [{ slug: "workspace-test" }] },
        expectedModels: ["workspace-test"]
      }
    ];

    service.on(AI_EVENT_CHANNEL, (event) => {
      if (event.type === "ai.provider.tested") {
        providerEvents.push(event.payload.providerId);
      }
    });

    try {
      for (const item of cases) {
        const requests: Array<{
          url: string;
          method: string;
          headers: Record<string, string>;
        }> = [];

        globalThis.fetch = async (input, init) => {
          requests.push({
            url: String(input),
            method: init?.method ?? "GET",
            headers: headersToObject(init?.headers)
          });

          return jsonResponse(item.responseBody);
        };

        const result = await service.testProvider({
          ...createDefaultAIProviderConfig(item.providerId),
          baseUrl: item.baseUrl,
          model: `${item.providerId}-model`,
          apiKey: item.apiKey
        });

        expect(result).toMatchObject({
          success: true,
          modelsList: item.expectedModels
        });
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
          url: item.expectedUrl,
          method: item.expectedMethod
        });
        expect(providerEvents.at(-1)).toBe(item.providerId);

        if (item.apiKey && item.providerId === "anthropic") {
          expect(requests[0].headers["x-api-key"]).toBe(item.apiKey);
          expect(requests[0].headers["anthropic-version"]).toBe("2023-06-01");
        } else if (item.apiKey && item.providerId !== "gemini") {
          expect(requests[0].headers.authorization).toBe(`Bearer ${item.apiKey}`);
        } else if (!item.apiKey) {
          expect(requests[0].headers.authorization).toBeUndefined();
        }

        if (item.providerId === "openrouter") {
          expect(requests[0].headers["http-referer"]).toBe(
            "https://github.com/sattop/sTorrent"
          );
          expect(requests[0].headers["x-title"]).toBe("sTorent");
        }
      }
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(providerEvents).toEqual(cases.map((item) => item.providerId));
  });

  it("routes AI advice requests through every provider completion endpoint", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "storent-ai-"));
    const service = createTestAIService(tempDir);
    const originalFetch = globalThis.fetch;
    const openAICompatibleProviders: AIProviderId[] = [
      "openai",
      "mistral",
      "groq",
      "together",
      "openrouter",
      "lmstudio",
      "ollama",
      "jan",
      "llamacpp",
      "textgenwebui",
      "custom"
    ];
    const cases = [
      ...openAICompatibleProviders.map((providerId) => {
        const baseUrl = createBareTestBaseUrl(providerId);
        return {
          providerId,
          apiKey: shouldUseTestApiKey(providerId) ? "test-key" : undefined,
          baseUrl,
          expectedUrl: `${normalizeAIProviderBaseUrl(
            providerId,
            baseUrl
          )}/chat/completions`,
          responseBody: { choices: [{ message: { content: "ok" } }] }
        };
      }),
      {
        providerId: "anthropic" as const,
        apiKey: "test-key",
        baseUrl: "https://api.anthropic.test",
        expectedUrl: "https://api.anthropic.test/v1/messages",
        responseBody: { content: [{ text: "ok" }] }
      },
      {
        providerId: "gemini" as const,
        apiKey: "test-key",
        baseUrl: "https://generativelanguage.googleapis.test",
        expectedUrl:
          "https://generativelanguage.googleapis.test/v1beta/models/gemini-model:generateContent?key=test-key",
        responseBody: {
          candidates: [{ content: { parts: [{ text: "ok" }] } }]
        },
        model: "gemini-model"
      },
      {
        providerId: "koboldcpp" as const,
        baseUrl: "http://kobold.test",
        expectedUrl: "http://kobold.test/api/v1/generate",
        responseBody: { results: [{ text: "ok" }] }
      },
      {
        providerId: "anythingllm" as const,
        baseUrl: "http://anythingllm.test",
        expectedUrl: "http://anythingllm.test/api/v1/workspace/workspace-test/chat",
        responseBody: { textResponse: "ok" },
        model: "workspace-test"
      }
    ];

    try {
      for (const item of cases) {
        const requests: Array<{
          url: string;
          method: string;
          headers: Record<string, string>;
        }> = [];
        const model =
          "model" in item && item.model ? item.model : `${item.providerId}-model`;

        globalThis.fetch = async (input, init) => {
          requests.push({
            url: String(input),
            method: init?.method ?? "GET",
            headers: headersToObject(init?.headers)
          });

          return jsonResponse(item.responseBody);
        };

        await service.updateSettings({
          enabled: true,
          activeProviderId: item.providerId,
          providers: DEFAULT_AI_SETTINGS.providers.map((provider) =>
            provider.providerId === item.providerId
              ? {
                  ...provider,
                  baseUrl: item.baseUrl,
                  model,
                  apiKey: item.apiKey
                }
              : provider
          )
        });

        const result = await service.requestAdvice({
          contextType: "sda",
          context: createTestAIAdviceContext()
        });

        expect(result).toMatchObject({
          text: "ok",
          providerUsed: item.providerId,
          modelUsed: model,
          fallback: false
        });
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
          url: item.expectedUrl,
          method: "POST"
        });

        if (item.apiKey && item.providerId === "anthropic") {
          expect(requests[0].headers["x-api-key"]).toBe(item.apiKey);
        } else if (item.apiKey && item.providerId !== "gemini") {
          expect(requests[0].headers.authorization).toBe(`Bearer ${item.apiKey}`);
        } else if (!item.apiKey) {
          expect(requests[0].headers.authorization).toBeUndefined();
        }
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps the AI provider matrix covered by adapter contract tests", () => {
    const coveredProviderIds = new Set<AIProviderId>([
      "anthropic",
      "openai",
      "gemini",
      "mistral",
      "groq",
      "together",
      "openrouter",
      "lmstudio",
      "ollama",
      "jan",
      "llamacpp",
      "textgenwebui",
      "koboldcpp",
      "anythingllm",
      "custom"
    ]);

    expect(AI_PROVIDER_IDS).toHaveLength(coveredProviderIds.size);
    expect(AI_PROVIDER_IDS.every((providerId) => coveredProviderIds.has(providerId)))
      .toBe(true);
  });

  it("computes assistant health score and exposes it in recommendations", () => {
    expect(
      computeTorrentHealthScore({
        seeders: 80,
        leechers: 10,
        trackerCount: 4,
        isPrivate: false,
        hasWebSeeds: false,
        totalSizeBytes: 1024,
        fileCount: 1,
        magnetOnly: false,
        metadataReceived: true,
        freeDiskBytes: 1024 * 1024,
        creationDateSeconds: null
      })
    ).toBeGreaterThanOrEqual(75);

    const recommendation = createSmartAssistantRecommendation({
      seeds: 0,
      peers: 0,
      trackerCount: 0,
      metadataReady: true,
      sourceType: "magnet"
    });

    expect(recommendation.healthStatus).toBe("critical");
    expect(recommendation.healthScore).toBeLessThan(25);
  });

  it("emits only event names that are part of the application event model", () => {
    expect(CORE_EVENTS).toEqual(
      expect.arrayContaining([...TORRENT_CORE_EVENT_NAMES])
    );
  });

  it("exposes the literal Smart Download Assistant event contract", () => {
    expect(ASSISTANT_EVENT_NAMES).toEqual([
      "assistant.health.computed",
      "assistant.llm.response",
      "assistant.schedule.suggestion",
      "assistant.profile.applied"
    ]);
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

  it("keeps destructive removal opt-in at the contract boundary", () => {
    expect(normalizeRemoveTorrentRequest("abc123")).toEqual({
      id: "abc123",
      deleteData: false
    });
    expect(
      normalizeRemoveTorrentRequest({ id: "abc123", deleteData: true })
    ).toEqual({
      id: "abc123",
      deleteData: true
    });
  });

  it("validates .torrent URLs before fetching", () => {
    expect(normalizeTorrentUrl("https://example.test/file.torrent#ignored")).toBe(
      "https://example.test/file.torrent"
    );
    expect(() => normalizeTorrentUrl("ftp://example.test/file.torrent")).toThrow(
      /HTTP/
    );
    expect(() => normalizeTorrentUrl("https://example.test/file.txt")).toThrow(
      /\.torrent/
    );
  });

  it("redacts and caps event logs", () => {
    const entry = createTorrentEventLogEntry(
      {
        type: "torrent.error",
        payload: {
          id: "abc123",
          message:
            "announce failed: https://tracker.example/passkey/secret?passkey=secret"
        }
      },
      { id: "log-1", timestamp: "2026-01-01T00:00:00.000Z" }
    );

    expect(entry).toMatchObject({
      level: "error",
      torrentId: "abc123"
    });
    expect(entry?.message).not.toContain("secret");
    expect(sanitizeEventLogText("magnet:?xt=urn:btih:abc")).toBe("[magnet]");
    expect(trimTorrentEventLogEntries([entry!, entry!], 1)).toHaveLength(1);
  });

  it("accumulates approximate traffic statistics from speed samples", () => {
    const counters = createTorrentStatisticsCounters("2026-01-01T00:00:00.000Z");
    const next = accumulateTorrentTrafficSample(counters, {
      downloadSpeedBytes: 1024,
      uploadSpeedBytes: 256,
      elapsedSeconds: 2,
      sampledAt: "2026-01-01T00:00:02.000Z"
    });

    expect(next).toMatchObject({
      downloadedBytes: 2048,
      uploadedBytes: 512,
      updatedAt: "2026-01-01T00:00:02.000Z"
    });
  });

  it("normalizes torrent column preferences", () => {
    expect(normalizeTorrentColumns(["status", "status", "bad", "eta"])).toEqual([
      "status",
      "eta"
    ]);
    expect(normalizeTorrentColumns([])).toContain("progress");
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

  it("diagnoses torrent-specific speed blockers with a redacted report", () => {
    const settings = normalizeNetworkSettings({
      ...DEFAULT_NETWORK_SETTINGS,
      speedLimits: {
        downloadBytesPerSecond: 256 * 1024,
        uploadBytesPerSecond: null
      }
    });
    const torrent = {
      ...createTestTorrentSummary(),
      status: "paused" as const,
      sizeBytes: 10 * 1024 * 1024,
      downloadedBytes: 1024,
      savePath: "D:/Downloads/private-folder"
    };
    const report = createTorrentSpeedDoctorReport({
      torrent,
      network: createTestNetworkState(settings),
      automation: createTestAutomationState("day-limit"),
      disk: {
        availableBytes: 512 * 1024,
        totalBytes: 20 * 1024 * 1024
      }
    });

    expect(report.status).toBe("critical");
    expect(report.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining([
        "torrent_paused",
        "global_download_limit",
        "active_speed_schedule",
        "disk_space_low"
      ])
    );
    expect(report.actions).toContain("copy_report");
    expect(report.redacted).toBe(true);
    expect(JSON.stringify(report)).not.toContain("private-folder");
  });

  it("keeps Speed Doctor quick and full scan modes explicit in reports", () => {
    const baseInput = {
      torrent: createTestTorrentSummary(),
      network: createTestNetworkState(),
      automation: createTestAutomationState(),
      disk: null
    };

    expect(
      createTorrentSpeedDoctorReport({
        ...baseInput,
        scanMode: "quick",
        durationMs: 250
      })
    ).toMatchObject({
      scanMode: "quick",
      durationMs: 250
    });
    expect(
      createTorrentSpeedDoctorReport({
        ...baseInput,
        scanMode: "full",
        durationMs: 12_000
      })
    ).toMatchObject({
      scanMode: "full",
      durationMs: 12_000
    });
  });

  it("does not suggest unsafe public discovery changes for private torrents", () => {
    const settings = applyNetworkProfile(
      DEFAULT_NETWORK_SETTINGS,
      "private_tracker"
    );
    const report = createTorrentSpeedDoctorReport({
      torrent: {
        ...createTestTorrentSummary(),
        private: true,
        selectedProfileId: "private_tracker"
      },
      network: createTestNetworkState(settings),
      automation: createTestAutomationState(),
      disk: null
    });

    expect(report.reasons.map((reason) => reason.code)).not.toContain(
      "public_discovery_disabled"
    );
    expect(JSON.stringify(report)).not.toContain("impersonate");
  });

  it("diagnoses live runtime blockers without leaking tracker secrets", () => {
    const settings = normalizeNetworkSettings({
      ...DEFAULT_NETWORK_SETTINGS,
      incomingPort: 51413,
      proxy: {
        ...DEFAULT_NETWORK_SETTINGS.proxy,
        type: "socks5",
        host: "127.0.0.1",
        port: 1080
      }
    });
    const report = createTorrentSpeedDoctorReport({
      torrent: {
        ...createTestTorrentSummary(),
        selectedProfileId: "stream_while_downloading",
        peers: 2,
        files: [
          {
            index: 0,
            name: "Movie.mkv",
            path: "Movie.mkv",
            lengthBytes: 1024,
            downloadedBytes: 0,
            progress: 0,
            priority: "normal",
            selected: true
          }
        ]
      },
      network: {
        settings,
        activeSettings: settings,
        restartRequired: false,
        capabilities: {
          ...NETWORK_CAPABILITIES,
          proxy: true
        },
        availableInterfaces: []
      },
      automation: createTestAutomationState(),
      disk: {
        availableBytes: 10 * 1024 * 1024 * 1024,
        totalBytes: 20 * 1024 * 1024 * 1024
      },
      runtime: {
        activeTorrentCount: 4,
        activeDownloadCount: 3,
        connectedSeeds: 0,
        queuedPeerCount: 0,
        trackerHosts: ["tracker.example"],
        trackerErrorCount: 1,
        lastTrackerError:
          "announce failed: https://tracker.example/passkey/secret-token",
        noPeersSources: [],
        recentErrors: ["tracker timeout for secret-token"],
        stalledSeconds: 90,
        lockedFileCount: 1,
        incomingPortProbe: "failed",
        proxyProbe: "failed"
      }
    });

    expect(report.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining([
        "incoming_port_unverified",
        "proxy_connection_failed",
        "disk_stalled",
        "file_locked",
        "queue_busy",
        "low_file_priority",
        "recent_errors",
        "tracker_error"
      ])
    );
    expect(report.technicalDetails.disk).toMatchObject({
      stalledSeconds: 90,
      lockedFileCount: 1
    });
    expect(JSON.stringify(report)).not.toContain("secret-token");
  });

  it("persists Speed Doctor history in a separate SQLite database", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "storent-history-"));
    const dbPath = path.join(tempDir, "speed_history.db");
    const store = new SpeedHistoryStore();
    const now = new Date();

    await store.restore(dbPath);
    store.record({
      timestamp: now.toISOString(),
      downloadSpeedKb: 2048,
      uploadSpeedKb: 128,
      activeTorrents: 1,
      activePeers: 8,
      connectedSeeds: 3,
      trackerErrors: 0,
      diskWriteSpeedKb: 2048,
      diskQueueDepth: 0,
      dhtNodes: 64
    });
    await store.persist(dbPath);
    store.close();

    expect((await stat(dbPath)).isFile()).toBe(true);

    const restored = new SpeedHistoryStore();
    await restored.restore(dbPath);
    const summary = restored.getSummary(now);

    expect(summary.sampleCount).toBe(1);
    expect(summary.peakSpeedLast24hKb).toBe(2048);
    restored.close();
  });

  it("migrates legacy JSON speed history into SQLite on first restore", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "storent-history-"));
    const dbPath = path.join(tempDir, "speed_history.db");
    const now = new Date();
    const legacyMetric = {
      timestamp: now.toISOString(),
      downloadSpeedKb: 512,
      uploadSpeedKb: 64,
      activeTorrents: 1,
      activePeers: 2,
      connectedSeeds: 1,
      trackerErrors: 0,
      diskWriteSpeedKb: 512,
      diskQueueDepth: 0,
      dhtNodes: 12
    };

    await writeFile(
      path.join(tempDir, "speed-history.json"),
      `${JSON.stringify({ version: 1, metrics: [legacyMetric] })}\n`,
      "utf8"
    );

    const store = new SpeedHistoryStore();
    await store.restore(dbPath);
    const summary = store.getSummary(now);

    expect(summary.sampleCount).toBe(1);
    expect(summary.peakSpeedLast24hKb).toBe(512);
    store.close();
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
    const createReport = (id: string) =>
      createTorrentSpeedDoctorReport({
        torrent: { ...torrent, id },
        network: {
          settings: DEFAULT_NETWORK_SETTINGS,
          activeSettings: DEFAULT_NETWORK_SETTINGS,
          restartRequired: false,
          capabilities: NETWORK_CAPABILITIES,
          availableInterfaces: []
        },
        automation: {
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
        },
        disk: null
      });
    const core: RemoteAccessCore = {
      addMagnet: async () => torrent,
      addTorrentUrl: async () => ({ ...torrent, sourceType: "torrent_url" }),
      getMagnetUri: (id) => `magnet:?xt=urn:btih:${id}`,
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
      updateProfile: (request) => {
        calls.push(`profile:${request.id}:${request.profileId}`);
        return {
          ...torrent,
          id: request.id,
          selectedProfileId: request.profileId
        };
      },
      setFilePriority: () => torrent,
      runSpeedDoctor: async (id) => createReport(id),
      getSpeedDoctorHistory: () => createReport(torrent.id).technicalDetails.speedHistory,
      exportSpeedDoctorReport: async (id) => ({
        reportPath: path.join(tempDir, "speed-doctor-report.txt"),
        report: createReport(id)
      }),
      getSnapshot: () => ({
        torrents: [torrent],
        downloadSpeedBytes: 0,
        uploadSpeedBytes: 0
      }),
      getStatistics: () => ({
        session: createTorrentStatisticsCounters("2026-01-01T00:00:00.000Z"),
        allTime: createTorrentStatisticsCounters("2026-01-01T00:00:00.000Z"),
        current: {
          torrentCount: 1,
          activeTorrentCount: 1,
          downloadSpeedBytes: 0,
          uploadSpeedBytes: 0
        }
      }),
      getEventLogs: () => [],
      exportEventLogs: async () => ({
        logPath: path.join(tempDir, "event-log.json"),
        entries: []
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

      const magnet = await fetch(
        `${state.runtime.origin}/api/torrents/${torrent.id}/magnet`,
        {
          headers: { Authorization: "Bearer correct horse" }
        }
      );
      const magnetResult = await magnet.json();

      expect(magnetResult).toMatchObject({
        ok: true,
        value: `magnet:?xt=urn:btih:${torrent.id}`
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

      const profile = await fetch(
        `${state.runtime.origin}/api/torrents/${torrent.id}/profile`,
        {
          method: "PATCH",
          headers: {
            Authorization: "Bearer correct horse",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ profileId: "max_speed" })
        }
      );
      const profileResult = await profile.json();

      expect(profileResult).toMatchObject({
        ok: true,
        value: { id: torrent.id, selectedProfileId: "max_speed" }
      });
      expect(calls).toContain(`profile:${torrent.id}:max_speed`);
    } finally {
      await server.shutdown();
    }
  });
});

function createTestAIService(tempDir: string) {
  return new AIService({
    settingsFilePath: path.join(tempDir, "ai-settings.json"),
    keysFilePath: path.join(tempDir, "ai-keys.json")
  });
}

function createBareTestBaseUrl(providerId: AIProviderId) {
  if (providerId === "custom") {
    return "https://custom.test/v1";
  }

  return new URL(getAIProviderDefinition(providerId).defaultBaseUrl).origin;
}

function shouldUseTestApiKey(providerId: AIProviderId) {
  return getAIProviderDefinition(providerId).requiresApiKey || providerId === "custom";
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function headersToObject(headers: HeadersInit | undefined) {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(
      Array.from(headers.entries()).map(([key, value]) => [
        key.toLowerCase(),
        value
      ])
    );
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(
      headers.map(([key, value]) => [key.toLowerCase(), String(value)])
    );
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key.toLowerCase(),
      String(value)
    ])
  );
}

function createTestAIAdviceContext() {
  return {
    healthScore: 80,
    seeders: 20,
    leechers: 3,
    totalSizeGb: 1.5,
    fileCategory: "video",
    freeDiskGb: 100,
    currentSpeedKb: 2048,
    avgSpeedKb: 1800,
    hourOfDay: 12,
    anomalies: [],
    suggestedProfile: "manual"
  };
}

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

function createTestNetworkState(settings = DEFAULT_NETWORK_SETTINGS) {
  return {
    settings,
    activeSettings: settings,
    restartRequired: false,
    capabilities: NETWORK_CAPABILITIES,
    availableInterfaces: []
  };
}

function createTestAutomationState(activeSpeedScheduleId: string | null = null) {
  return {
    settings: {
      watchFolders: [],
      favoriteFolders: [],
      seedingRules: [],
      rssRules: [],
      speedSchedules: [],
      hooksEnabled: false as const
    },
    capabilities: {
      watchFolders: true,
      favoriteFolders: true,
      seedingRules: true,
      rssDuplicatePrevention: true,
      speedLimitSchedules: true,
      hooks: false as const,
      safeDataRemovalOnly: true as const
    },
    activeSpeedScheduleId
  };
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
    connectedSeeds: 0,
    etaSeconds: null,
    savePath: "D:/Downloads",
    addedAt: "2026-01-01T00:00:00.000Z",
    metadataReceivedAt: "2026-01-01T00:00:01.000Z",
    lastActivityAt: "2026-01-01T00:00:02.000Z",
    lastError: null,
    trackerHosts: [],
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
