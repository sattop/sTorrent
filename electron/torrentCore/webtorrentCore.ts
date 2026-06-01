import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { promises as fs, watch, type FSWatcher } from "node:fs";
import net from "node:net";
import path from "node:path";
import os from "node:os";
import WebTorrent, {
  type WebTorrentFile,
  type WebTorrentTorrent
} from "webtorrent";
import {
  type AddMagnetRequest,
  type AddTorrentFileRequest,
  type AddTorrentUrlRequest,
  type AssistantProfileApplyRequest,
  type AssistantScheduleSuggestion,
  type AssistantState,
  type AssistantWarningDismissRequest,
  type AutomationSettings,
  type AutomationSettingsState,
  type DownloadProfileId,
  type NetworkDiagnosticsReport,
  type NetworkInterfaceInfo,
  type NetworkSettings,
  type NetworkSettingsState,
  normalizeRemoveTorrentRequest,
  type OpenTorrentFileRequest,
  type RemoveTorrentRequest,
  type SetTorrentFilePriorityRequest,
  type SpeedDoctorScanMode,
  type SpeedDoctorPortCheckResult,
  type WatchFolderScanResult,
  type WatchFolderSettings,
  type TorrentFilePriority,
  type TorrentFileInfo,
  type TorrentCoreEvent,
  type TorrentEventLogEntry,
  type TorrentEventLogExport,
  type TorrentCoreEventPayloadMap,
  type TorrentCoreSnapshot,
  type TorrentStatistics,
  type TorrentStatisticsCounters,
  type TorrentSourceType,
  type TorrentStatus,
  type TorrentSummary,
  type SpeedDoctorProbeStatus,
  type SpeedDoctorRuntimeInput,
  type UpdateTorrentLabelsRequest,
  type UpdateTorrentProfileRequest
} from "./contracts.js";
import {
  createTorrentEventLogEntry,
  normalizeTorrentEventLogEntries,
  trimTorrentEventLogEntries
} from "./eventLog.js";
import { AssistantStateStore } from "./assistantState.js";
import {
  AUTOMATION_CAPABILITIES,
  DEFAULT_AUTOMATION_SETTINGS,
  normalizeAutomationSettings,
  resolveActiveSpeedSchedule
} from "./automation.js";
import {
  normalizeFilePriority,
  normalizeTorrentCategory,
  normalizeTorrentTags
} from "./labels.js";
import { createNetworkDiagnosticsReport } from "./networkDiagnostics.js";
import {
  DEFAULT_NETWORK_SETTINGS,
  NETWORK_CAPABILITIES,
  buildWebTorrentClientOptions,
  normalizeNetworkSettings,
  startupNetworkSettingsChanged,
  toWebTorrentLimit
} from "./networkSettings.js";
import { buildWebTorrentAddOptions } from "./profiles.js";
import { tryMapIncomingPort } from "./portMapping.js";
import {
  createTorrentSpeedDoctorReport,
  type SpeedDoctorDiskInput
} from "./speedDoctor.js";
import { SpeedHistoryStore } from "./speedHistory.js";
import {
  TORRENT_STATISTICS_VERSION,
  accumulateTorrentTrafficSample,
  createTorrentStatisticsCounters,
  normalizePersistedTorrentStatistics,
  type PersistedTorrentStatistics
} from "./statistics.js";

const FULL_SCAN_EXTERNAL_PORT_TIMEOUT_MS = 10_000;
export const MAX_TORRENT_URL_BYTES = 10 * 1024 * 1024;

type PersistedTorrentSource =
  | {
      type: "torrent_file";
      filePath: string;
    }
  | {
      type: "magnet";
      magnetUri: string;
    }
  | {
      type: "torrent_url";
      url: string;
      cachedFilePath: string;
    };

interface PersistedTorrentRecord {
  source: PersistedTorrentSource;
  downloadPath: string;
  profileId: DownloadProfileId;
  paused: boolean;
  category?: string | null;
  tags?: string[];
  filePriorities?: Record<string, TorrentFilePriority>;
  addedAt?: string;
  metadataReceivedAt?: string | null;
}

interface PersistedTorrentState {
  version: 1 | 2 | 3 | 4;
  torrents: PersistedTorrentRecord[];
}

interface TorrentRecord {
  id: string;
  source: PersistedTorrentSource;
  torrent: WebTorrentTorrent;
  downloadPath: string;
  profileId: DownloadProfileId;
  manualPaused: boolean;
  category: string | null;
  tags: string[];
  filePriorities: Record<string, TorrentFilePriority>;
  addedAt: string;
  metadataReceivedAt: string | null;
  lastActivityAt: string | null;
  lastDownloadedBytes: number;
  stalledSince: string | null;
  recentErrors: string[];
  trackerErrorCount: number;
  lastTrackerError: string | null;
  noPeersSources: string[];
  statusOverride?: TorrentStatus;
}

export interface WebTorrentCoreOptions {
  defaultDownloadPath: string;
  stateFilePath: string;
  networkSettingsFilePath: string;
  automationSettingsFilePath: string;
  speedHistoryFilePath: string;
  statisticsFilePath: string;
  eventLogFilePath: string;
  eventLogExportDirectoryPath: string;
  torrentCacheDirectoryPath: string;
  assistantProfileUsageFilePath: string;
  assistantWarningDismissedFilePath: string;
  speedDoctorReportDirectoryPath: string;
}

export class WebTorrentCore extends EventEmitter {
  private client: WebTorrent;
  private readonly records = new Map<string, TorrentRecord>();
  private readonly progressTimer: NodeJS.Timeout;
  private readonly automationTimer: NodeJS.Timeout;
  private readonly watchFolderWatchers = new Map<string, FSWatcher>();
  private readonly watchFolderDebounceTimers = new Map<string, NodeJS.Timeout>();
  private networkSettings = DEFAULT_NETWORK_SETTINGS;
  private activeNetworkSettings = DEFAULT_NETWORK_SETTINGS;
  private automationSettings = DEFAULT_AUTOMATION_SETTINGS;
  private activeSpeedScheduleId: string | null = null;
  private readonly speedHistory = new SpeedHistoryStore();
  private readonly assistantState: AssistantStateStore;
  private readonly sessionStats: TorrentStatisticsCounters;
  private allTimeStats: TorrentStatisticsCounters;
  private eventLogEntries: TorrentEventLogEntry[] = [];
  private lastSpeedHistorySampleAt = 0;
  private lastStatsSampleAt = Date.now();
  private lastStatsPersistAt = 0;
  private speedHistoryDirty = false;
  private statisticsDirty = false;
  private eventLogDirty = false;

  constructor(private readonly options: WebTorrentCoreOptions) {
    super();

    const startedAt = new Date().toISOString();
    this.sessionStats = createTorrentStatisticsCounters(startedAt);
    this.allTimeStats = createTorrentStatisticsCounters(startedAt);
    this.assistantState = new AssistantStateStore({
      profileUsageFilePath: options.assistantProfileUsageFilePath,
      warningDismissedFilePath: options.assistantWarningDismissedFilePath
    });
    this.client = this.createClient(this.activeNetworkSettings);

    this.progressTimer = setInterval(() => {
      for (const record of this.records.values()) {
        this.updateRuntimeStats(record);
        this.emitCore("torrent.progress.updated", this.toSummary(record));
      }
      this.recordStatisticsSample();
      this.recordSpeedHistorySample(false);
    }, 1_000);
    this.progressTimer.unref();

    this.automationTimer = setInterval(() => {
      this.applyAutomationRuntimeSettings(true);
    }, 60_000);
    this.automationTimer.unref();
  }

  async restoreNetworkSettings() {
    let persistedSettings: Partial<NetworkSettings>;

    try {
      persistedSettings = JSON.parse(
        await fs.readFile(this.options.networkSettingsFilePath, "utf8")
      ) as Partial<NetworkSettings>;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        this.applyRuntimeNetworkSettings();
        return;
      }

      this.emitCore("torrent.error", {
        id: null,
        message: getErrorMessage(error)
      });
      return;
    }

    this.networkSettings = normalizeNetworkSettings(persistedSettings);
    this.replaceIdleClientIfNeeded();
    this.applyRuntimeNetworkSettings();
  }

  async restoreAutomationSettings() {
    let persistedSettings: Partial<AutomationSettings>;

    try {
      persistedSettings = JSON.parse(
        await fs.readFile(this.options.automationSettingsFilePath, "utf8")
      ) as Partial<AutomationSettings>;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        this.configureWatchFolders();
        this.applyAutomationRuntimeSettings(false);
        return;
      }

      this.emitCore("torrent.error", {
        id: null,
        message: getErrorMessage(error)
      });
      return;
    }

    this.automationSettings = normalizeAutomationSettings(persistedSettings);
    this.configureWatchFolders();
    this.applyAutomationRuntimeSettings(false);
  }

  async restoreSpeedHistory() {
    try {
      await this.speedHistory.restore(this.options.speedHistoryFilePath);
    } catch (error) {
      this.emitCore("torrent.error", {
        id: null,
        message: getErrorMessage(error)
      });
    }
  }

  async restoreStatistics() {
    try {
      const persisted = JSON.parse(
        await fs.readFile(this.options.statisticsFilePath, "utf8")
      ) as Partial<PersistedTorrentStatistics>;
      this.allTimeStats = normalizePersistedTorrentStatistics(persisted).allTime;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        this.emitCore("torrent.error", {
          id: null,
          message: getErrorMessage(error)
        });
      }
    }
  }

  async restoreEventLog() {
    try {
      const persisted = JSON.parse(
        await fs.readFile(this.options.eventLogFilePath, "utf8")
      ) as { entries?: unknown };
      this.eventLogEntries = normalizeTorrentEventLogEntries(persisted.entries);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        this.emitCore("torrent.error", {
          id: null,
          message: getErrorMessage(error)
        });
      }
    }
  }

  async restoreAssistantState() {
    try {
      await this.assistantState.restore();
    } catch (error) {
      this.emitCore("torrent.error", {
        id: null,
        message: getErrorMessage(error)
      });
    }
  }

  async restore() {
    let persistedState: PersistedTorrentState;

    try {
      persistedState = JSON.parse(
        await fs.readFile(this.options.stateFilePath, "utf8")
      ) as PersistedTorrentState;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }

      this.emitCore("torrent.error", {
        id: null,
        message: getErrorMessage(error)
      });
      return;
    }

    if (
      ![1, 2, 3, 4].includes(persistedState.version) ||
      !Array.isArray(persistedState.torrents)
    ) {
      return;
    }

    for (const record of persistedState.torrents) {
      const restoredOptions = {
        downloadPath: record.downloadPath,
        profileId: record.profileId,
        startPaused: record.paused,
        category: record.category,
        tags: record.tags,
        filePriorities: record.filePriorities
      };

      try {
        if (record.source.type === "magnet") {
          await this.addMagnet({
            magnetUri: record.source.magnetUri,
            ...restoredOptions
          });
        } else if (record.source.type === "torrent_url") {
          await this.restoreTorrentUrl(record.source, restoredOptions);
        } else {
          await this.addTorrentFile({
            filePath: record.source.filePath,
            ...restoredOptions
          });
        }
      } catch (error) {
        this.emitCore("torrent.error", {
          id: null,
          message: getErrorMessage(error)
        });
      }
    }
  }

  async updateNetworkSettings(settings: NetworkSettings) {
    this.networkSettings = normalizeNetworkSettings(settings, this.networkSettings);
    this.replaceIdleClientIfNeeded();
    this.applyRuntimeNetworkSettings();
    await this.persistNetworkSettings();

    const network = this.getNetworkSettingsState();
    this.emitCore("settings.changed", { network });
    return network;
  }

  async updateAutomationSettings(settings: AutomationSettings) {
    this.automationSettings = normalizeAutomationSettings(
      settings,
      this.automationSettings
    );
    this.configureWatchFolders();
    this.applyAutomationRuntimeSettings(true);
    await this.persistAutomationSettings();

    const automation = this.getAutomationSettingsState();
    this.emitCore("automation.settings.changed", { automation });
    return automation;
  }

  getNetworkSettingsState(): NetworkSettingsState {
    return {
      settings: this.networkSettings,
      activeSettings: this.activeNetworkSettings,
      restartRequired: startupNetworkSettingsChanged(
        this.networkSettings,
        this.activeNetworkSettings
      ),
      capabilities: NETWORK_CAPABILITIES,
      availableInterfaces: getNetworkInterfaces()
    };
  }

  getAutomationSettingsState(): AutomationSettingsState {
    return {
      settings: this.automationSettings,
      capabilities: AUTOMATION_CAPABILITIES,
      activeSpeedScheduleId: this.activeSpeedScheduleId
    };
  }

  runNetworkDiagnostics(): NetworkDiagnosticsReport {
    const report = createNetworkDiagnosticsReport({
      settings: this.networkSettings,
      activeSettings: this.activeNetworkSettings,
      capabilities: NETWORK_CAPABILITIES,
      availableInterfaces: getNetworkInterfaces(),
      torrents: this.getSnapshot().torrents
    });

    this.emitCore("diagnostics.speed.checked", { report });
    return report;
  }

  async runSpeedDoctor(id: string, mode: SpeedDoctorScanMode = "full") {
    const start = Date.now();
    const record = this.getRecord(id);
    this.updateRuntimeStats(record);
    this.recordSpeedHistorySample(true);
    const torrent = this.toSummary(record);
    const disk = await getDiskSpace(torrent.savePath || record.downloadPath);
    const runtime = await this.createSpeedDoctorRuntime(record, mode);
    const portCheck = await this.createPortCheckResult(runtime, mode);
    const report = createTorrentSpeedDoctorReport({
      torrent,
      network: this.getNetworkSettingsState(),
      automation: this.getAutomationSettingsState(),
      disk,
      runtime,
      speedHistory: this.speedHistory.getSummary(),
      portCheck,
      scanMode: mode,
      durationMs: Date.now() - start
    });

    this.emitCore("diagnostics.torrent_speed.checked", { report });
    this.emitCore("speedDoctor.status.updated", {
      torrentId: report.torrentId,
      portOpen: portCheck.externallyReachable,
      dhtNodes: getDhtNodeCount(this.client),
      trackerCount: runtime.trackerHosts.length,
      currentSpeedKb: Math.round(torrent.downloadSpeedBytes / 1024)
    });
    for (const anomaly of report.technicalDetails.anomalies) {
      this.emitCore("speedDoctor.anomaly.detected", {
        torrentId: report.torrentId,
        anomaly
      });
    }
    this.emitCore("speedDoctor.diagnosis.ready", {
      torrentId: report.torrentId,
      diagnoses: report.technicalDetails.diagnoses
    });
    this.emitAssistantScheduleSuggestion(report.torrentId);
    return report;
  }

  getSpeedDoctorHistory() {
    return this.speedHistory.getSummary();
  }

  getAssistantState(): AssistantState {
    return this.assistantState.getState();
  }

  async dismissAssistantWarning(request: AssistantWarningDismissRequest) {
    return this.assistantState.dismissWarning(request);
  }

  async applyAssistantProfile(request: AssistantProfileApplyRequest) {
    return this.updateProfile({
      id: request.torrentId,
      profileId: request.profileId,
      source: request.source ?? "api"
    });
  }

  getAssistantScheduleSuggestion(id: string) {
    const suggestion = this.createAssistantScheduleSuggestion(id);

    if (suggestion) {
      this.emitCore("assistant.schedule.suggestion", { suggestion });
    }

    return suggestion;
  }

  async mapIncomingPort() {
    const currentSettings = this.networkSettings;
    const port = currentSettings.incomingPort ?? 51413;

    if (
      currentSettings.incomingPort !== port ||
      !currentSettings.upnp ||
      !currentSettings.natPmp
    ) {
      await this.updateNetworkSettings({
        ...currentSettings,
        incomingPort: port,
        upnp: true,
        natPmp: true
      });
    }

    const mapping = await tryMapIncomingPort(port);
    const runtime = await this.createAggregateRuntime();
    const portCheck = await this.createPortCheckResult(
      {
        ...runtime,
        incomingPortProbe: await probeIncomingPort(port)
      },
      "full",
      mapping
    );

    this.emitCore("speedDoctor.status.updated", {
      torrentId: "",
      portOpen: portCheck.externallyReachable,
      dhtNodes: getDhtNodeCount(this.client),
      trackerCount: runtime.trackerHosts.length,
      currentSpeedKb: Math.round(toNonNegativeNumber(this.client.downloadSpeed) / 1024)
    });

    return portCheck;
  }

  async exportSpeedDoctorReport(id: string) {
    const report = await this.runSpeedDoctor(id);
    const stamp = new Date(report.generatedAt)
      .toISOString()
      .replace(/[:.]/g, "-");
    const reportPath = path.join(
      this.options.speedDoctorReportDirectoryPath,
      `report-${stamp}-${sanitizeFileName(report.torrentId)}.txt`
    );

    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${report.technicalDetails.exportText}\n`, "utf8");
    this.emitCore("speedDoctor.report.ready", {
      torrentId: report.torrentId,
      reportPath
    });

    return {
      reportPath,
      report
    };
  }

  async runWatchFolderScan(): Promise<WatchFolderScanResult> {
    const result = createEmptyWatchFolderScanResult();

    for (const folder of this.automationSettings.watchFolders) {
      await this.scanWatchFolder(folder, result);
    }

    this.emitCore("automation.watch.scan.completed", { result });
    return result;
  }

  async addTorrentFile(request: AddTorrentFileRequest) {
    if (!request.filePath) {
      throw new Error("A .torrent file path is required.");
    }

    const torrentFile = await fs.readFile(request.filePath);
    return this.addTorrentInput(torrentFile, {
      type: "torrent_file",
      filePath: request.filePath
    }, request);
  }

  async addTorrentUrl(request: AddTorrentUrlRequest) {
    const url = normalizeTorrentUrl(request.url);
    const torrentFile = await fetchTorrentFile(url);
    const cachedFilePath = await this.cacheTorrentUrlFile(url, torrentFile);

    return this.addTorrentInput(torrentFile, {
      type: "torrent_url",
      url,
      cachedFilePath
    }, request);
  }

  async addMagnet(request: AddMagnetRequest) {
    if (!request.magnetUri.startsWith("magnet:?")) {
      throw new Error("A valid magnet URI is required.");
    }

    return this.addTorrentInput(request.magnetUri, {
      type: "magnet",
      magnetUri: request.magnetUri
    }, request);
  }

  pause(id: string) {
    const record = this.getRecord(id);
    record.manualPaused = true;
    record.torrent.pause();
    record.statusOverride = "paused";
    this.emitStatus(record);
    void this.persistState();
    return this.toSummary(record);
  }

  resume(id: string) {
    const record = this.getRecord(id);
    record.manualPaused = false;
    record.statusOverride = undefined;
    record.torrent.resume();
    this.emitStatus(record);
    void this.persistState();
    return this.toSummary(record);
  }

  async remove(request: string | RemoveTorrentRequest) {
    const normalized = normalizeRemoveTorrentRequest(request);
    const record = this.getRecord(normalized.id);
    const summary = this.toSummary(record);

    await new Promise<void>((resolve, reject) => {
      void this.client.remove(
        record.torrent,
        { destroyStore: normalized.deleteData },
        (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        }
      );
    });

    this.records.delete(record.id);
    this.recordTorrentRemoved(normalized.deleteData);
    this.emitCore("torrent.removed", {
      id: summary.id,
      name: summary.name,
      deleteData: normalized.deleteData
    });
    void this.persistState();
    return this.getSnapshot();
  }

  async recheck(id: string) {
    const record = this.getRecord(id);

    if (typeof record.torrent.rescanFiles !== "function") {
      throw new Error("The selected torrent engine does not support recheck.");
    }

    record.statusOverride = "checking";
    this.emitStatus(record);

    await new Promise<void>((resolve, reject) => {
      record.torrent.rescanFiles?.((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    record.statusOverride = undefined;
    this.emitStatus(record);
    this.emitCore("torrent.progress.updated", this.toSummary(record));
    return this.toSummary(record);
  }

  updateLabels(request: UpdateTorrentLabelsRequest) {
    const record = this.getRecord(request.id);

    if ("category" in request) {
      record.category = normalizeTorrentCategory(request.category);
    }

    if ("tags" in request) {
      record.tags = normalizeTorrentTags(request.tags);
    }

    const summary = this.toSummary(record);
    this.emitCore("torrent.labels.updated", summary);
    void this.persistState();
    return summary;
  }

  updateProfile(request: UpdateTorrentProfileRequest) {
    const record = this.getRecord(request.id);
    record.profileId = request.profileId;
    applyProfileHintsToRecord(record);

    const summary = this.toSummary(record);
    this.emitCore("assistant.profile.applied", {
      id: summary.id,
      profileId: record.profileId,
      appliedOptions: [`profile:${record.profileId}`, "existing_torrent:metadata"]
    });
    void this.assistantState.recordProfileUse({
      profileId: record.profileId,
      torrentId: summary.id,
      source: request.source ?? "existing_torrent"
    });
    this.emitCore("torrent.files.updated", summary);
    void this.persistState();
    return summary;
  }

  setFilePriority(request: SetTorrentFilePriorityRequest) {
    const record = this.getRecord(request.id);
    const file = record.torrent.files[request.fileIndex];

    if (!file) {
      throw new Error(`Torrent file not found: ${request.fileIndex}`);
    }

    const priority = normalizeFilePriority(request.priority);
    record.filePriorities[file.path] = priority;
    applyFilePriority(file, priority);

    const summary = this.toSummary(record);
    this.emitCore("torrent.files.updated", summary);
    void this.persistState();
    return summary;
  }

  getMagnetUri(id: string) {
    const record = this.getRecord(id);
    const magnetUri = record.torrent.magnetURI || createMagnetUri(record);

    if (!magnetUri) {
      throw new Error("Magnet link is not available yet.");
    }

    return magnetUri;
  }

  getTorrentFolderPath(id: string) {
    const record = this.getRecord(id);
    return record.torrent.path || record.downloadPath;
  }

  getTorrentFilePath(request: OpenTorrentFileRequest) {
    const record = this.getRecord(request.id);
    const file = record.torrent.files[request.fileIndex];

    if (!file) {
      throw new Error(`Torrent file not found: ${request.fileIndex}`);
    }

    const basePath = path.resolve(record.torrent.path || record.downloadPath);
    const filePath = path.resolve(basePath, file.path || file.name);

    if (!isPathInside(basePath, filePath)) {
      throw new Error("Torrent file path is outside the download folder.");
    }

    return filePath;
  }

  getSnapshot(): TorrentCoreSnapshot {
    return {
      torrents: [...this.records.values()].map((record) =>
        this.toSummary(record)
      ),
      downloadSpeedBytes: this.client.downloadSpeed,
      uploadSpeedBytes: this.client.uploadSpeed
    };
  }

  getStatistics(): TorrentStatistics {
    const snapshot = this.getSnapshot();

    return {
      session: { ...this.sessionStats },
      allTime: { ...this.allTimeStats },
      current: {
        torrentCount: snapshot.torrents.length,
        activeTorrentCount: snapshot.torrents.filter(
          (torrent) =>
            torrent.status === "downloading" || torrent.status === "seeding"
        ).length,
        downloadSpeedBytes: snapshot.downloadSpeedBytes,
        uploadSpeedBytes: snapshot.uploadSpeedBytes
      }
    };
  }

  getEventLogs() {
    return [...this.eventLogEntries].reverse();
  }

  async exportEventLogs(): Promise<TorrentEventLogExport> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logPath = path.join(
      this.options.eventLogExportDirectoryPath,
      `event-log-${stamp}.json`
    );
    const entries = this.getEventLogs();

    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(
      logPath,
      `${JSON.stringify({ exportedAt: new Date().toISOString(), entries }, null, 2)}\n`,
      "utf8"
    );

    return {
      logPath,
      entries
    };
  }

  shutdown() {
    clearInterval(this.progressTimer);
    clearInterval(this.automationTimer);
    for (const timer of this.watchFolderDebounceTimers.values()) {
      clearTimeout(timer);
    }
    for (const watcher of this.watchFolderWatchers.values()) {
      watcher.close();
    }
    if (this.speedHistoryDirty) {
      void this.persistSpeedHistory();
    }
    if (this.statisticsDirty) {
      void this.persistStatistics();
    }
    if (this.eventLogDirty) {
      void this.persistEventLog();
    }
    this.speedHistory.close();
    this.client.destroy();
  }

  private async restoreTorrentUrl(
    source: Extract<PersistedTorrentSource, { type: "torrent_url" }>,
    request: AddTorrentFileRequest | AddMagnetRequest | AddTorrentUrlRequest
  ) {
    try {
      const torrentFile = await fs.readFile(source.cachedFilePath);
      return this.addTorrentInput(torrentFile, source, request);
    } catch {
      return this.addTorrentUrl({
        ...request,
        url: source.url
      });
    }
  }

  private async cacheTorrentUrlFile(url: string, torrentFile: Buffer) {
    const parsedUrl = new URL(url);
    const name = sanitizeFileName(
      path.basename(parsedUrl.pathname) || parsedUrl.host || "torrent"
    );
    const cachedFilePath = path.join(
      this.options.torrentCacheDirectoryPath,
      `${Date.now().toString(36)}-${name}.torrent`
    );

    await fs.mkdir(path.dirname(cachedFilePath), { recursive: true });
    await fs.writeFile(cachedFilePath, torrentFile);
    return cachedFilePath;
  }

  private async addTorrentInput(
    input: string | Buffer,
    source: PersistedTorrentSource,
    request: AddTorrentFileRequest | AddMagnetRequest
  ) {
    const downloadPath = request.downloadPath || this.options.defaultDownloadPath;
    const filePriorities = normalizeFilePriorities(request.filePriorities);
    const { profile, webTorrentOptions } = buildWebTorrentAddOptions({
      downloadPath,
      profileId: request.profileId,
      startPaused: request.startPaused,
      forcePrivate: this.networkSettings.privateMode
    });

    return new Promise<TorrentSummary>((resolve, reject) => {
      let resolved = false;
      const temporaryId = randomUUID();
      const torrent = this.client.add(input, webTorrentOptions);
      const now = new Date().toISOString();
      const record: TorrentRecord = {
        id: temporaryId,
        source,
        torrent,
        downloadPath,
        profileId: profile.id,
        manualPaused: Boolean(request.startPaused),
        category: normalizeTorrentCategory(request.category),
        tags: normalizeTorrentTags(request.tags),
        filePriorities,
        addedAt: now,
        metadataReceivedAt: null,
        lastActivityAt: null,
        lastDownloadedBytes: 0,
        stalledSince: null,
        recentErrors: [],
        trackerErrorCount: 0,
        lastTrackerError: null,
        noPeersSources: [],
        statusOverride: request.startPaused ? "paused" : undefined
      };

      this.records.set(temporaryId, record);
      this.attachTorrentEvents(record);
      this.applyFilePriorities(record);

      const rejectBeforeAdded = (error: Error) => {
        if (resolved) {
          return;
        }

        this.records.delete(record.id);
        reject(error);
      };

      const resolveAdded = () => {
        if (resolved) {
          return;
        }

        resolved = true;
        torrent.removeListener("error", rejectBeforeAdded);
        this.promoteRecordId(record);
        const summary = this.toSummary(record);
        this.emitCore("torrent.added", summary);
        this.emitCore("assistant.profile.applied", {
          id: summary.id,
          profileId: profile.id,
          appliedOptions: this.networkSettings.privateMode
            ? [...profile.appliedOptions, "network:private_mode"]
            : profile.appliedOptions
        });
        void this.assistantState.recordProfileUse({
          profileId: profile.id,
          torrentId: summary.id,
          source: "add_dialog"
        });
        this.recordTorrentAdded();
        this.emitAssistantHealth(summary);
        this.emitAssistantScheduleSuggestion(summary.id);
        void this.persistState();
        resolve(summary);
      };

      torrent.once("error", rejectBeforeAdded);

      if (torrent.infoHash) {
        resolveAdded();
      } else {
        torrent.once("infoHash", resolveAdded);
      }
    });
  }

  private attachTorrentEvents(record: TorrentRecord) {
    const { torrent } = record;

    torrent.on("metadata", () => {
      record.metadataReceivedAt = new Date().toISOString();
      record.lastActivityAt = record.metadataReceivedAt;
      this.promoteRecordId(record);
      this.applyFilePriorities(record);
      const summary = this.toSummary(record);
      this.emitCore("torrent.metadata.received", summary);
      this.emitAssistantHealth(summary);
      this.emitAssistantScheduleSuggestion(summary.id);
      this.emitStatus(record);
      void this.persistState();
    });

    torrent.on("ready", () => {
      this.promoteRecordId(record);
      this.applyFilePriorities(record);
      record.lastActivityAt = new Date().toISOString();
      this.emitStatus(record);
    });

    torrent.on("done", () => {
      record.statusOverride = "completed";
      record.lastActivityAt = new Date().toISOString();
      this.recordTorrentCompleted();
      this.emitCore("torrent.completed", this.toSummary(record));
      this.emitStatus(record);
      void this.persistState();
    });

    torrent.on("error", (error: Error) => {
      record.statusOverride = "error";
      this.recordRuntimeError(record, error.message);
      this.emitCore("torrent.error", {
        id: record.id,
        message: error.message
      });
      this.emitStatus(record);
    });

    torrent.on("warning", (error: Error) => {
      this.recordRuntimeError(record, error.message);
      if (isTrackerRelatedMessage(error.message)) {
        record.trackerErrorCount += 1;
        record.lastTrackerError = redactDiagnosticText(error.message);
      }
    });

    torrent.on("trackerAnnounce", () => {
      record.lastActivityAt = new Date().toISOString();
    });

    torrent.on("noPeers", (source: string) => {
      record.noPeersSources = Array.from(
        new Set([...record.noPeersSources, source].filter(Boolean))
      ).slice(-4);
    });

    torrent.on("peer", () => {
      record.lastActivityAt = new Date().toISOString();
    });

    torrent.on("wire", () => {
      record.lastActivityAt = new Date().toISOString();
    });
  }

  private promoteRecordId(record: TorrentRecord) {
    if (!record.torrent.infoHash || record.id === record.torrent.infoHash) {
      return;
    }

    this.records.delete(record.id);
    record.id = record.torrent.infoHash;
    this.records.set(record.id, record);
  }

  private toSummary(record: TorrentRecord): TorrentSummary {
    const { torrent } = record;
    const metadataReady = Boolean(torrent.metadata || torrent.ready);
    const timeRemaining = Number(torrent.timeRemaining);
    const connectedSeeds = countConnectedSeeds(torrent);

    return {
      id: record.id,
      infoHash: torrent.infoHash ?? null,
      name: torrent.name || getSourceDisplayName(record.source),
      status: this.getStatus(record),
      progress: clamp(torrent.progress ?? 0),
      sizeBytes: toNonNegativeNumber(torrent.length),
      downloadedBytes: toNonNegativeNumber(torrent.downloaded),
      downloadSpeedBytes: toNonNegativeNumber(torrent.downloadSpeed),
      uploadSpeedBytes: toNonNegativeNumber(torrent.uploadSpeed),
      seeds: connectedSeeds,
      peers: torrent.numPeers ?? torrent.wires?.length ?? 0,
      etaSeconds: Number.isFinite(timeRemaining)
        ? Math.max(0, Math.ceil(timeRemaining / 1_000))
        : null,
      savePath: torrent.path || record.downloadPath,
      metadataReady,
      private: Boolean(torrent.private),
      sourceType: record.source.type as TorrentSourceType,
      selectedProfileId: record.profileId,
      recheckAvailable: typeof torrent.rescanFiles === "function",
      category: record.category,
      tags: [...record.tags],
      files: torrent.files.map((file, index) =>
        toTorrentFileInfo(
          file,
          index,
          record.filePriorities,
          getSourceDisplayName(record.source)
        )
      ),
      addedAt: record.addedAt,
      metadataReceivedAt: record.metadataReceivedAt,
      lastActivityAt: record.lastActivityAt,
      lastError: record.recentErrors[record.recentErrors.length - 1] ?? null,
      trackerHosts: getTrackerHosts(torrent),
      connectedSeeds
    };
  }

  private getStatus(record: TorrentRecord): TorrentStatus {
    if (record.statusOverride) {
      return record.statusOverride;
    }

    if (record.manualPaused || record.torrent.paused) {
      return "paused";
    }

    if (!record.torrent.metadata && !record.torrent.ready) {
      return "adding";
    }

    if (record.torrent.done) {
      return toNonNegativeNumber(record.torrent.uploadSpeed) > 0
        ? "seeding"
        : "completed";
    }

    return "downloading";
  }

  private emitStatus(record: TorrentRecord) {
    const summary = this.toSummary(record);
    this.emitCore("torrent.status.changed", {
      id: record.id,
      status: summary.status,
      torrent: summary
    });
  }

  private applyFilePriorities(record: TorrentRecord) {
    for (const file of record.torrent.files) {
      applyFilePriority(file, record.filePriorities[file.path] ?? "normal");
    }
  }

  private updateRuntimeStats(record: TorrentRecord) {
    const downloadedBytes = toNonNegativeNumber(record.torrent.downloaded);
    const downloadSpeedBytes = toNonNegativeNumber(record.torrent.downloadSpeed);
    const peerCount = record.torrent.numPeers ?? record.torrent.wires?.length ?? 0;
    const now = new Date().toISOString();

    if (
      downloadedBytes > record.lastDownloadedBytes ||
      downloadSpeedBytes > 0 ||
      peerCount > 0
    ) {
      record.lastActivityAt = now;
    }

    if (downloadedBytes > record.lastDownloadedBytes || downloadSpeedBytes > 0) {
      record.lastDownloadedBytes = downloadedBytes;
      record.stalledSince = null;
      return;
    }

    if (
      this.getStatus(record) === "downloading" &&
      Boolean(record.torrent.metadata || record.torrent.ready) &&
      peerCount > 0 &&
      downloadSpeedBytes === 0
    ) {
      record.stalledSince ??= now;
      return;
    }

    record.stalledSince = null;
  }

  private recordRuntimeError(record: TorrentRecord, message: string) {
    const redacted = redactDiagnosticText(message);
    record.recentErrors = [...record.recentErrors, redacted].slice(-8);
  }

  private async createSpeedDoctorRuntime(
    record: TorrentRecord,
    mode: SpeedDoctorScanMode
  ): Promise<SpeedDoctorRuntimeInput> {
    const snapshot = this.getSnapshot();
    const activeSettings = this.getNetworkSettingsState().activeSettings;
    const configuredProxy = this.networkSettings.proxy;
    const isFullScan = mode === "full";

    return {
      activeTorrentCount: snapshot.torrents.filter(
        (item) => item.status === "downloading" || item.status === "seeding"
      ).length,
      activeDownloadCount: snapshot.torrents.filter(
        (item) => item.status === "downloading"
      ).length,
      connectedSeeds: countConnectedSeeds(record.torrent),
      queuedPeerCount: record.torrent._queue?.length ?? 0,
      trackerHosts: getTrackerHosts(record.torrent),
      trackerErrorCount: record.trackerErrorCount,
      lastTrackerError: record.lastTrackerError,
      noPeersSources: [...record.noPeersSources],
      recentErrors: [...record.recentErrors],
      stalledSeconds: getElapsedSeconds(record.stalledSince),
      lockedFileCount: isFullScan ? await getLockedFileCount(record) : 0,
      incomingPortProbe: await probeIncomingPort(activeSettings.incomingPort),
      proxyProbe: isFullScan ? await probeProxy(configuredProxy) : "unknown"
    };
  }

  private async createAggregateRuntime(): Promise<SpeedDoctorRuntimeInput> {
    const snapshot = this.getSnapshot();
    const activeSettings = this.getNetworkSettingsState().activeSettings;
    const configuredProxy = this.networkSettings.proxy;

    return {
      activeTorrentCount: snapshot.torrents.filter(
        (item) => item.status === "downloading" || item.status === "seeding"
      ).length,
      activeDownloadCount: snapshot.torrents.filter(
        (item) => item.status === "downloading"
      ).length,
      connectedSeeds: snapshot.torrents.reduce(
        (total, torrent) => total + torrent.connectedSeeds,
        0
      ),
      queuedPeerCount: 0,
      trackerHosts: Array.from(
        new Set(snapshot.torrents.flatMap((torrent) => torrent.trackerHosts))
      ),
      trackerErrorCount: [...this.records.values()].reduce(
        (total, record) => total + record.trackerErrorCount,
        0
      ),
      lastTrackerError:
        [...this.records.values()].find((record) => record.lastTrackerError)
          ?.lastTrackerError ?? null,
      noPeersSources: Array.from(
        new Set([...this.records.values()].flatMap((record) => record.noPeersSources))
      ),
      recentErrors: [...this.records.values()].flatMap((record) => record.recentErrors),
      stalledSeconds: null,
      lockedFileCount: 0,
      incomingPortProbe: await probeIncomingPort(activeSettings.incomingPort),
      proxyProbe: await probeProxy(configuredProxy)
    };
  }

  private async createPortCheckResult(
    runtime: SpeedDoctorRuntimeInput,
    mode: SpeedDoctorScanMode,
    mapping?: {
      upnpStatus: SpeedDoctorPortCheckResult["upnpStatus"];
      natPmpStatus: SpeedDoctorPortCheckResult["natPmpStatus"];
      notes: string[];
    }
  ): Promise<SpeedDoctorPortCheckResult> {
    const settings = this.getNetworkSettingsState().activeSettings;
    const notes: string[] = [];
    let externallyReachable: boolean | null = null;

    if (settings.incomingPort === null) {
      notes.push("Incoming port is automatic; external reachability cannot be checked.");
    } else if (mode === "full") {
      externallyReachable = await probeExternalPort(
        settings.incomingPort,
        FULL_SCAN_EXTERNAL_PORT_TIMEOUT_MS
      );

      if (externallyReachable === null) {
        notes.push("External port check service did not return a conclusive result.");
      }
    } else {
      notes.push("Quick scan skipped the external port check.");
    }

    if (settings.upnp || settings.natPmp) {
      notes.push("NAT traversal is enabled; router mapping support is router-dependent.");
    }

    notes.push(...(mapping?.notes ?? []));

    return {
      port: settings.incomingPort,
      protocol: "tcp",
      localBinding: runtime.incomingPortProbe,
      externallyReachable,
      firewallBlocked:
        externallyReachable === false || runtime.incomingPortProbe === "failed"
          ? true
          : externallyReachable === true
            ? false
            : null,
      upnpStatus: mapping?.upnpStatus ?? (settings.upnp ? "enabled" : "disabled"),
      natPmpStatus: mapping?.natPmpStatus ?? (settings.natPmp ? "enabled" : "disabled"),
      notes
    };
  }

  private recordSpeedHistorySample(force: boolean) {
    const now = Date.now();

    if (!force && now - this.lastSpeedHistorySampleAt < 60_000) {
      return;
    }

    this.lastSpeedHistorySampleAt = now;
    const snapshot = this.getSnapshot();
    const activeTorrents = snapshot.torrents.filter(
      (torrent) => torrent.status === "downloading" || torrent.status === "seeding"
    );
    const stalledCount = [...this.records.values()].filter(
      (record) => record.stalledSince !== null
    ).length;

    this.speedHistory.record({
      timestamp: new Date(now).toISOString(),
      downloadSpeedKb: Math.round(toNonNegativeNumber(this.client.downloadSpeed) / 102.4) / 10,
      uploadSpeedKb: Math.round(toNonNegativeNumber(this.client.uploadSpeed) / 102.4) / 10,
      activeTorrents: activeTorrents.length,
      activePeers: activeTorrents.reduce((total, torrent) => total + torrent.peers, 0),
      connectedSeeds: activeTorrents.reduce(
        (total, torrent) => total + torrent.connectedSeeds,
        0
      ),
      trackerErrors: [...this.records.values()].reduce(
        (total, record) => total + record.trackerErrorCount,
        0
      ),
      diskWriteSpeedKb: stalledCount > 0
        ? 0
        : Math.round(toNonNegativeNumber(this.client.downloadSpeed) / 102.4) / 10,
      diskQueueDepth: stalledCount,
      dhtNodes: getDhtNodeCount(this.client)
    });
    this.speedHistoryDirty = true;
    void this.persistSpeedHistory();
  }

  private async persistSpeedHistory() {
    try {
      await this.speedHistory.persist(this.options.speedHistoryFilePath);
      this.speedHistoryDirty = false;
    } catch (error) {
      this.emitCore("torrent.error", {
        id: null,
        message: getErrorMessage(error)
      });
    }
  }

  private recordStatisticsSample() {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastStatsSampleAt) / 1_000;

    if (elapsedSeconds <= 0) {
      return;
    }

    this.lastStatsSampleAt = now;
    const sample = {
      downloadSpeedBytes: toNonNegativeNumber(this.client.downloadSpeed),
      uploadSpeedBytes: toNonNegativeNumber(this.client.uploadSpeed),
      elapsedSeconds,
      sampledAt: new Date(now).toISOString()
    };
    const session = accumulateTorrentTrafficSample(this.sessionStats, sample);
    const allTime = accumulateTorrentTrafficSample(this.allTimeStats, sample);

    Object.assign(this.sessionStats, session);
    this.allTimeStats = allTime;
    this.statisticsDirty = true;

    if (now - this.lastStatsPersistAt >= 15_000) {
      void this.persistStatistics();
    }
  }

  private recordTorrentAdded() {
    this.sessionStats.torrentsAdded += 1;
    this.allTimeStats.torrentsAdded += 1;
    this.touchStatistics();
  }

  private recordTorrentCompleted() {
    this.sessionStats.torrentsCompleted += 1;
    this.allTimeStats.torrentsCompleted += 1;
    this.touchStatistics();
  }

  private recordTorrentRemoved(deleteData: boolean) {
    void deleteData;
    this.sessionStats.torrentsRemoved += 1;
    this.allTimeStats.torrentsRemoved += 1;
    this.touchStatistics();
  }

  private touchStatistics() {
    const updatedAt = new Date().toISOString();
    this.sessionStats.updatedAt = updatedAt;
    this.allTimeStats.updatedAt = updatedAt;
    this.statisticsDirty = true;
    void this.persistStatistics();
  }

  private async persistStatistics() {
    try {
      const state: PersistedTorrentStatistics = {
        version: TORRENT_STATISTICS_VERSION,
        allTime: this.allTimeStats
      };

      await fs.mkdir(path.dirname(this.options.statisticsFilePath), {
        recursive: true
      });
      await fs.writeFile(
        this.options.statisticsFilePath,
        `${JSON.stringify(state, null, 2)}\n`,
        "utf8"
      );
      this.lastStatsPersistAt = Date.now();
      this.statisticsDirty = false;
    } catch (error) {
      this.emitCore("torrent.error", {
        id: null,
        message: getErrorMessage(error)
      });
    }
  }

  private recordEventLog(event: TorrentCoreEvent) {
    const entry = createTorrentEventLogEntry(event, {
      id: randomUUID()
    });

    if (!entry) {
      return;
    }

    this.eventLogEntries = trimTorrentEventLogEntries([
      ...this.eventLogEntries,
      entry
    ]);
    this.eventLogDirty = true;
    void this.persistEventLog();
  }

  private async persistEventLog() {
    try {
      await fs.mkdir(path.dirname(this.options.eventLogFilePath), {
        recursive: true
      });
      await fs.writeFile(
        this.options.eventLogFilePath,
        `${JSON.stringify({ entries: this.eventLogEntries }, null, 2)}\n`,
        "utf8"
      );
      this.eventLogDirty = false;
    } catch {
      this.eventLogDirty = true;
    }
  }

  private createClient(settings: NetworkSettings) {
    const client = new WebTorrent(buildWebTorrentClientOptions(settings));

    client.on("error", (error: Error) => {
      this.emitCore("torrent.error", {
        id: null,
        message: error.message
      });
    });

    return client;
  }

  private replaceIdleClientIfNeeded() {
    if (
      this.records.size > 0 ||
      !startupNetworkSettingsChanged(
        this.networkSettings,
        this.activeNetworkSettings
      )
    ) {
      this.activeNetworkSettings = {
        ...this.activeNetworkSettings,
        profileId: this.networkSettings.profileId,
        privateMode: this.networkSettings.privateMode,
        encryptionMode: this.networkSettings.encryptionMode,
        speedLimits: { ...this.getEffectiveSpeedLimits() },
        networkInterface: { ...this.networkSettings.networkInterface },
        proxy: { ...this.networkSettings.proxy }
      };
      return;
    }

    const previousClient = this.client;
    this.activeNetworkSettings = this.networkSettings;
    this.client = this.createClient(this.activeNetworkSettings);
    previousClient.destroy();
  }

  private applyRuntimeNetworkSettings() {
    const speedLimits = this.getEffectiveSpeedLimits();

    this.client.throttleDownload(
      toWebTorrentLimit(speedLimits.downloadBytesPerSecond)
    );
    this.client.throttleUpload(
      toWebTorrentLimit(speedLimits.uploadBytesPerSecond)
    );

    this.activeNetworkSettings = {
      ...this.activeNetworkSettings,
      profileId: this.networkSettings.profileId,
      privateMode: this.networkSettings.privateMode,
      encryptionMode: this.networkSettings.encryptionMode,
      speedLimits: { ...speedLimits },
      networkInterface: { ...this.networkSettings.networkInterface },
      proxy: { ...this.networkSettings.proxy }
    };
  }

  private applyAutomationRuntimeSettings(emitChanges: boolean) {
    const previousScheduleId = this.activeSpeedScheduleId;
    this.activeSpeedScheduleId =
      resolveActiveSpeedSchedule(this.automationSettings)?.id ?? null;
    this.applyRuntimeNetworkSettings();

    if (emitChanges && previousScheduleId !== this.activeSpeedScheduleId) {
      this.emitCore("settings.changed", {
        network: this.getNetworkSettingsState()
      });
      this.emitCore("automation.settings.changed", {
        automation: this.getAutomationSettingsState()
      });
    }
  }

  private getEffectiveSpeedLimits() {
    const activeSchedule = resolveActiveSpeedSchedule(this.automationSettings);

    if (!activeSchedule) {
      return this.networkSettings.speedLimits;
    }

    return {
      downloadBytesPerSecond: activeSchedule.downloadBytesPerSecond,
      uploadBytesPerSecond: activeSchedule.uploadBytesPerSecond
    };
  }

  private configureWatchFolders() {
    for (const timer of this.watchFolderDebounceTimers.values()) {
      clearTimeout(timer);
    }
    for (const watcher of this.watchFolderWatchers.values()) {
      watcher.close();
    }

    this.watchFolderDebounceTimers.clear();
    this.watchFolderWatchers.clear();

    for (const folder of this.automationSettings.watchFolders) {
      if (!folder.enabled) {
        continue;
      }

      try {
        const watcher = watch(folder.path, { persistent: false }, (_event, file) => {
          if (file && path.extname(String(file)).toLowerCase() !== ".torrent") {
            return;
          }

          this.scheduleWatchFolderScan(folder.id);
        });

        watcher.unref();
        this.watchFolderWatchers.set(folder.id, watcher);
      } catch (error) {
        this.emitCore("torrent.error", {
          id: null,
          message: getErrorMessage(error)
        });
      }
    }
  }

  private scheduleWatchFolderScan(folderId: string) {
    const existingTimer = this.watchFolderDebounceTimers.get(folderId);

    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.watchFolderDebounceTimers.delete(folderId);
      void this.scanSingleWatchFolder(folderId);
    }, 500);
    timer.unref();
    this.watchFolderDebounceTimers.set(folderId, timer);
  }

  private async scanSingleWatchFolder(folderId: string) {
    const folder = this.automationSettings.watchFolders.find(
      (item) => item.id === folderId
    );

    if (!folder) {
      return;
    }

    const result = createEmptyWatchFolderScanResult();
    await this.scanWatchFolder(folder, result);
    this.emitCore("automation.watch.scan.completed", { result });
  }

  private async scanWatchFolder(
    folder: WatchFolderSettings,
    result: WatchFolderScanResult
  ) {
    if (!folder.enabled) {
      return;
    }

    result.scannedFolders += 1;

    let entries: Array<{ isFile(): boolean; name: string }>;

    try {
      entries = await fs.readdir(folder.path, { withFileTypes: true });
    } catch (error) {
      result.errors.push(getErrorMessage(error));
      return;
    }

    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".torrent") {
        continue;
      }

      const filePath = path.join(folder.path, entry.name);

      if (this.hasTorrentFileSource(filePath)) {
        result.skippedTorrents += 1;
        continue;
      }

      try {
        const torrent = await this.addTorrentFile({
          filePath,
          profileId: folder.profileId,
          startPaused: folder.startPaused,
          category: folder.category,
          tags: folder.tags
        });

        result.addedTorrents += 1;
        this.emitCore("automation.watch.added", {
          folderId: folder.id,
          filePath,
          torrent
        });
      } catch (error) {
        result.errors.push(getErrorMessage(error));
      }
    }
  }

  private hasTorrentFileSource(filePath: string) {
    const normalizedPath = path.resolve(filePath);

    for (const record of this.records.values()) {
      if (
        record.source.type === "torrent_file" &&
        path.resolve(record.source.filePath) === normalizedPath
      ) {
        return true;
      }
    }

    return false;
  }

  private emitAssistantHealth(torrent: TorrentSummary) {
    this.emitCore("assistant.health.computed", createAssistantHealthPayload(torrent));
  }

  private emitAssistantScheduleSuggestion(torrentId: string) {
    const suggestion = this.createAssistantScheduleSuggestion(torrentId);

    if (suggestion) {
      this.emitCore("assistant.schedule.suggestion", { suggestion });
    }
  }

  private createAssistantScheduleSuggestion(
    torrentId: string
  ): AssistantScheduleSuggestion | null {
    const history = this.speedHistory.getSummary();

    if (history.sampleCount < 8 || history.bestHours.length === 0) {
      return null;
    }

    const bestHours = history.bestHours.slice(0, 4);
    const primaryHour = bestHours[0];
    const recommendedEndHour = (primaryHour + 3) % 24;
    const currentHour = new Date().getHours();
    const currentAverage = history.averageByHourKb[currentHour] ?? 0;
    const bestAverage = history.averageByHourKb[primaryHour] ?? 0;
    const expectedSpeedupPercent =
      currentAverage > 0 && bestAverage > currentAverage
        ? Math.round(((bestAverage - currentAverage) / currentAverage) * 100)
        : 0;
    const nightFaster = bestHours.some(
      (hour) => hour >= 23 || (hour >= 0 && hour <= 6)
    );
    const confidence = Math.min(0.95, Math.max(0.25, history.sampleCount / 72));
    const hoursText = bestHours.map((hour) => `${hour}:00`).join(", ");
    const message = nightFaster
      ? `Usually downloads are faster at night around ${hoursText}. You can create an off-peak schedule for large torrents.`
      : `Usually downloads are fastest around ${hoursText}. You can schedule heavy downloads for those hours.`;

    return {
      torrentId,
      generatedAt: new Date().toISOString(),
      bestHours,
      recommendedStartHour: primaryHour,
      recommendedEndHour,
      expectedSpeedupPercent,
      nightFaster,
      confidence: Math.round(confidence * 100) / 100,
      sampleCount: history.sampleCount,
      message
    };
  }

  private emitCore<EventName extends keyof TorrentCoreEventPayloadMap>(
    type: EventName,
    payload: TorrentCoreEventPayloadMap[EventName]
  ) {
    const event: TorrentCoreEvent = { type, payload } as TorrentCoreEvent;
    this.recordEventLog(event);
    this.emit("core-event", event);
  }

  private getRecord(id: string) {
    const record = this.records.get(id);

    if (!record) {
      throw new Error(`Torrent not found: ${id}`);
    }

    return record;
  }

  private async persistState() {
    const state: PersistedTorrentState = {
      version: 4,
      torrents: [...this.records.values()].map((record) => ({
        source: record.source,
        downloadPath: record.downloadPath,
        profileId: record.profileId,
        paused: record.manualPaused || record.torrent.paused === true,
        category: record.category,
        tags: [...record.tags],
        filePriorities: { ...record.filePriorities },
        addedAt: record.addedAt,
        metadataReceivedAt: record.metadataReceivedAt
      }))
    };

    await fs.mkdir(path.dirname(this.options.stateFilePath), { recursive: true });
    await fs.writeFile(
      this.options.stateFilePath,
      `${JSON.stringify(state, null, 2)}\n`,
      "utf8"
    );
  }

  private async persistNetworkSettings() {
    await fs.mkdir(path.dirname(this.options.networkSettingsFilePath), {
      recursive: true
    });
    await fs.writeFile(
      this.options.networkSettingsFilePath,
      `${JSON.stringify(this.networkSettings, null, 2)}\n`,
      "utf8"
    );
  }

  private async persistAutomationSettings() {
    await fs.mkdir(path.dirname(this.options.automationSettingsFilePath), {
      recursive: true
    });
    await fs.writeFile(
      this.options.automationSettingsFilePath,
      `${JSON.stringify(this.automationSettings, null, 2)}\n`,
      "utf8"
    );
  }
}

function createEmptyWatchFolderScanResult(): WatchFolderScanResult {
  return {
    scannedFolders: 0,
    addedTorrents: 0,
    skippedTorrents: 0,
    errors: []
  };
}

function createAssistantHealthPayload(torrent: TorrentSummary) {
  const score = computeAssistantHealthScore(torrent);
  const warnings: string[] = [];

  if (torrent.metadataReady && torrent.seeds === 0) {
    warnings.push("no_seeders");
  }

  if (torrent.metadataReady && torrent.seeds <= 1 && torrent.peers <= 2) {
    warnings.push("low_peer_availability");
  }

  if (torrent.private && torrent.trackerHosts.length === 0) {
    warnings.push("private_no_tracker");
  }

  if (!torrent.metadataReady) {
    warnings.push("metadata_pending");
  }

  return {
    torrentId: torrent.id,
    score,
    status: getAssistantHealthStatus(score),
    warnings,
    suggestedProfile: suggestAssistantProfile(torrent),
    computedAt: new Date().toISOString()
  };
}

function computeAssistantHealthScore(torrent: TorrentSummary) {
  let score = 50;

  if (!torrent.metadataReady && torrent.sourceType === "magnet") {
    score -= 5;
  }

  if (torrent.seeds === 0) {
    score -= 40;
  } else if (torrent.seeds < 3) {
    score -= 20;
  } else if (torrent.seeds < 10) {
    score -= 5;
  } else if (torrent.seeds >= 50) {
    score += 20;
  } else if (torrent.seeds >= 10) {
    score += 10;
  }

  const ratio = torrent.peers > 0 ? torrent.seeds / torrent.peers : torrent.seeds;

  if (ratio < 0.1) {
    score -= 15;
  } else if (ratio > 2) {
    score += 10;
  }

  if (torrent.trackerHosts.length === 0) {
    score -= 10;
  }

  if (torrent.trackerHosts.length >= 3) {
    score += 5;
  }

  if (torrent.private && torrent.trackerHosts.length === 0) {
    score -= 20;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function getAssistantHealthStatus(score: number) {
  if (score >= 75) {
    return "good" as const;
  }

  if (score >= 50) {
    return "normal" as const;
  }

  if (score >= 25) {
    return "weak" as const;
  }

  return "critical" as const;
}

function suggestAssistantProfile(torrent: TorrentSummary): DownloadProfileId {
  if (torrent.selectedProfileId !== "manual") {
    return torrent.selectedProfileId;
  }

  if (torrent.private) {
    return "private_tracker";
  }

  if (torrent.files.some((file) => isMediaFile(file.path || file.name))) {
    return "stream_while_downloading";
  }

  return "max_speed";
}

function clamp(value: unknown) {
  const numeric = toNonNegativeNumber(value);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.min(1, Math.max(0, numeric));
}

function toNonNegativeNumber(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }

  return numeric;
}

export function toTorrentFileInfo(
  file: Partial<WebTorrentFile>,
  index: number,
  filePriorities: Record<string, TorrentFilePriority>,
  fallbackName: string
): TorrentFileInfo {
  const filePath = file.path || file.name || String(index);
  const priority = filePriorities[filePath] ?? "normal";

  return {
    index,
    name: file.name || filePath || fallbackName,
    path: filePath,
    lengthBytes: toNonNegativeNumber(file.length),
    downloadedBytes: toNonNegativeNumber(file.downloaded),
    progress: clamp(file.progress),
    priority,
    selected: priority !== "skip"
  };
}

function getSourceDisplayName(source: PersistedTorrentSource) {
  if (source.type === "torrent_file") {
    return path.basename(source.filePath);
  }

  if (source.type === "torrent_url") {
    try {
      const url = new URL(source.url);
      return path.basename(url.pathname) || url.host;
    } catch {
      return source.url.slice(0, 40);
    }
  }

  return source.magnetUri.slice(0, 40);
}

function createMagnetUri(record: TorrentRecord) {
  const infoHash = record.torrent.infoHash;

  if (!infoHash) {
    return null;
  }

  const params = new URLSearchParams({
    xt: `urn:btih:${infoHash}`
  });
  const name = record.torrent.name || getSourceDisplayName(record.source);

  if (name) {
    params.set("dn", name);
  }

  return `magnet:?${params.toString()}`;
}

function isPathInside(basePath: string, candidatePath: string) {
  const relative = path.relative(basePath, candidatePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function normalizeFilePriorities(
  filePriorities: Record<string, TorrentFilePriority> | undefined
) {
  const normalized: Record<string, TorrentFilePriority> = {};

  for (const [filePath, priority] of Object.entries(filePriorities ?? {})) {
    normalized[filePath] = normalizeFilePriority(priority);
  }

  return normalized;
}

function applyFilePriority(
  file: WebTorrentFile,
  priority: TorrentFilePriority
) {
  if (priority === "skip") {
    file.deselect();
    return;
  }

  file.select(priority === "high" ? 10 : undefined);
}

function applyProfileHintsToRecord(record: TorrentRecord) {
  if (record.profileId !== "stream_while_downloading") {
    return;
  }

  const mediaFile = record.torrent.files.find((file) =>
    isMediaFile(file.path || file.name)
  );

  if (!mediaFile) {
    return;
  }

  record.filePriorities[mediaFile.path] = "high";
  applyFilePriority(mediaFile, "high");
}

function countConnectedSeeds(torrent: WebTorrentTorrent) {
  return (torrent.wires ?? []).filter((wire) => wire.isSeeder).length;
}

function getTrackerHosts(torrent: WebTorrentTorrent) {
  return Array.from(
    new Set(
      (torrent.announce ?? [])
        .map((announce) => getUrlHost(announce))
        .filter((host): host is string => Boolean(host))
    )
  ).slice(0, 12);
}

function getUrlHost(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function isMediaFile(value: string) {
  return [
    ".avi",
    ".flac",
    ".m4a",
    ".m4v",
    ".mkv",
    ".mov",
    ".mp3",
    ".mp4",
    ".ogg",
    ".wav",
    ".webm"
  ].some((extension) => value.toLowerCase().endsWith(extension));
}

function getElapsedSeconds(value: string | null) {
  if (!value) {
    return null;
  }

  const elapsed = Date.now() - Date.parse(value);
  return Number.isFinite(elapsed) && elapsed > 0
    ? Math.floor(elapsed / 1_000)
    : null;
}

async function getLockedFileCount(record: TorrentRecord) {
  let lockedFileCount = 0;

  for (const file of record.torrent.files.slice(0, 8)) {
    const priority = record.filePriorities[file.path] ?? "normal";

    if (priority === "skip") {
      continue;
    }

    const filePath = path.join(record.torrent.path || record.downloadPath, file.path);

    try {
      const handle = await fs.open(filePath, "r+");
      await handle.close();
    } catch (error) {
      if (!isNodeError(error) || error.code === "ENOENT") {
        continue;
      }

      if (["EACCES", "EPERM", "EBUSY"].includes(error.code ?? "")) {
        lockedFileCount += 1;
      }
    }
  }

  return lockedFileCount;
}

async function probeIncomingPort(
  incomingPort: number | null
): Promise<SpeedDoctorProbeStatus> {
  if (incomingPort === null) {
    return "unknown";
  }

  return new Promise((resolve) => {
    const server = net.createServer();
    const done = (status: SpeedDoctorProbeStatus) => {
      server.removeAllListeners();
      if (server.listening) {
        server.close(() => resolve(status));
        return;
      }
      resolve(status);
    };

    server.once("error", (error: NodeJS.ErrnoException) => {
      done(error.code === "EADDRINUSE" ? "ok" : "failed");
    });
    server.once("listening", () => done("failed"));
    server.listen(incomingPort, "0.0.0.0");
  });
}

export function normalizeTorrentUrl(value: string) {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw createCodedError("invalid_torrent_url", "A valid .torrent URL is required.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw createCodedError(
      "invalid_torrent_url",
      "Only HTTP and HTTPS .torrent URLs are supported."
    );
  }

  if (!url.pathname.toLowerCase().endsWith(".torrent")) {
    throw createCodedError(
      "invalid_torrent_url",
      "The URL must point to a .torrent file."
    );
  }

  url.hash = "";
  return url.toString();
}

async function fetchTorrentFile(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/x-bittorrent, application/octet-stream, */*"
    }
  });

  if (!response.ok) {
    throw createCodedError(
      "torrent_url_fetch_failed",
      `Failed to download .torrent file: HTTP ${response.status}.`
    );
  }

  const contentLength = response.headers.get("content-length");
  const expectedBytes = contentLength === null ? null : Number(contentLength);

  if (
    expectedBytes !== null &&
    Number.isFinite(expectedBytes) &&
    expectedBytes > MAX_TORRENT_URL_BYTES
  ) {
    throw createCodedError(
      "torrent_url_too_large",
      "The .torrent file is larger than the supported limit."
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.byteLength > MAX_TORRENT_URL_BYTES) {
    throw createCodedError(
      "torrent_url_too_large",
      "The .torrent file is larger than the supported limit."
    );
  }

  return buffer;
}

async function probeExternalPort(
  port: number,
  timeoutMs = 2_500
): Promise<boolean | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`https://portchecker.co/check?port=${port}`, {
      signal: controller.signal,
      headers: {
        Accept: "text/plain, text/html, application/json"
      }
    });
    const text = (await response.text()).toLowerCase();

    if (!response.ok) {
      return null;
    }

    if (/\b(open|success|reachable)\b/.test(text) && !/\b(closed|blocked)\b/.test(text)) {
      return true;
    }

    if (/\b(closed|blocked|failed|unreachable|not open)\b/.test(text)) {
      return false;
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function probeProxy(
  proxy: NetworkSettings["proxy"]
): Promise<SpeedDoctorProbeStatus> {
  if (proxy.type === "none") {
    return "unknown";
  }

  if (!proxy.host || proxy.port === null) {
    return "failed";
  }

  return probeTcp(proxy.host, proxy.port, 2_000);
}

async function probeTcp(
  host: string,
  port: number,
  timeoutMs: number
): Promise<SpeedDoctorProbeStatus> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (status: SpeedDoctorProbeStatus) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(status);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish("ok"));
    socket.once("timeout", () => finish("failed"));
    socket.once("error", () => finish("failed"));
  });
}

async function getDiskSpace(
  pathValue: string
): Promise<SpeedDoctorDiskInput | null> {
  try {
    const existingPath = await findExistingPath(pathValue);
    const stats = await fs.statfs(existingPath);

    return {
      availableBytes: stats.bavail * stats.bsize,
      totalBytes: stats.blocks * stats.bsize
    };
  } catch {
    return null;
  }
}

async function findExistingPath(pathValue: string) {
  let currentPath = path.resolve(pathValue);
  const rootPath = path.parse(currentPath).root;

  while (true) {
    try {
      const stats = await fs.stat(currentPath);
      return stats.isDirectory() ? currentPath : path.dirname(currentPath);
    } catch (error) {
      if (
        isNodeError(error) &&
        error.code === "ENOENT" &&
        currentPath !== rootPath
      ) {
        currentPath = path.dirname(currentPath);
        continue;
      }

      throw error;
    }
  }
}

function getNetworkInterfaces(): NetworkInterfaceInfo[] {
  return Object.entries(os.networkInterfaces()).flatMap(([name, addresses]) =>
    (addresses ?? []).map((address) => ({
      name,
      address: address.address,
      family: address.family,
      internal: address.internal,
      mac: address.mac && address.mac !== "00:00:00:00:00:00" ? address.mac : null
    }))
  );
}

function getDhtNodeCount(client: WebTorrent) {
  const withDht = client as WebTorrent & {
    dht?: {
      nodes?: unknown[];
      table?: {
        nodes?: unknown[];
      };
    };
  };

  return withDht.dht?.nodes?.length ?? withDht.dht?.table?.nodes?.length ?? 0;
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 64) || "torrent";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function createCodedError(code: string, message: string) {
  const error = new Error(message);
  (error as Error & { code: string }).code = code;
  return error;
}

function isTrackerRelatedMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("tracker") ||
    normalized.includes("announce") ||
    normalized.includes("scrape")
  );
}

function redactDiagnosticText(value: string) {
  return value
    .replace(/https?:\/\/[^\s)]+/gi, (match) => {
      try {
        const url = new URL(match);
        return `${url.protocol}//${url.host}${url.pathname}`;
      } catch {
        return "[url]";
      }
    })
    .replace(/[A-Za-z]:\\[^\s)]+/g, "[path]")
    .replace(/passkey=[^&\s]+/gi, "passkey=[redacted]")
    .slice(0, 240);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
