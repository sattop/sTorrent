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
  type CommitPreparedTorrentAddRequest,
  type DownloadProfileId,
  type ExportTorrentFileRequest,
  type ExportTorrentFileResult,
  type MoveTorrentDataRequest,
  type MoveTorrentDataResult,
  type NetworkDiagnosticsReport,
  type NetworkInterfaceInfo,
  type NetworkSettings,
  type NetworkSettingsState,
  normalizeRemoveTorrentRequest,
  type OpenTorrentFileRequest,
  type ReannounceTorrentResult,
  type RemoveTorrentRequest,
  type RenameTorrentRequest,
  type SeedingRuleSettings,
  type SetTorrentFilePriorityRequest,
  type SetTorrentFilePrioritiesRequest,
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
  type TorrentQueueRole,
  type TorrentQueueState,
  type TorrentStatistics,
  type TorrentStatisticsCounters,
  type TorrentSourceType,
  type TorrentStatus,
  type TorrentSummary,
  type SpeedDoctorProbeStatus,
  type SpeedDoctorRuntimeInput,
  type UpdateTorrentLabelsRequest,
  type UpdateTorrentProfileRequest,
  type UpdateTorrentQueuePositionRequest
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
  nameOverride?: string | null;
  forceStarted?: boolean;
  selectionPending?: boolean;
  queuePosition?: number;
  completedAt?: string | null;
  seedUploadSlotLimit?: number | null;
  addedAt?: string;
  metadataReceivedAt?: string | null;
}

interface PersistedTorrentState {
  version: 1 | 2 | 3 | 4 | 5 | 6;
  torrents: PersistedTorrentRecord[];
}

interface TorrentRecord {
  id: string;
  source: PersistedTorrentSource;
  torrent: WebTorrentTorrent;
  downloadPath: string;
  profileId: DownloadProfileId;
  manualPaused: boolean;
  queuePaused: boolean;
  forceStarted: boolean;
  selectionPending: boolean;
  nameOverride: string | null;
  queuePosition: number;
  completedAt: string | null;
  seedUploadSlotLimit: number | null;
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

type InternalAddTorrentRequest = (
  AddTorrentFileRequest | AddMagnetRequest | AddTorrentUrlRequest
) & {
  nameOverride?: string | null;
  forceStarted?: boolean;
  selectionPending?: boolean;
  queuePosition?: number;
  completedAt?: string | null;
  seedUploadSlotLimit?: number | null;
};

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
  private queuePositionCounter = 0;
  private seedingRulesApplying = false;

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
      this.applyQueueScheduling(false);
      this.recordStatisticsSample();
      this.recordSpeedHistorySample(false);
    }, 1_000);
    this.progressTimer.unref();

    this.automationTimer = setInterval(() => {
      this.applyAutomationRuntimeSettings(true);
      void this.applySeedingRules();
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
      ![1, 2, 3, 4, 5, 6].includes(persistedState.version) ||
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
        filePriorities: record.filePriorities,
        nameOverride: record.nameOverride,
        forceStarted: record.forceStarted,
        selectionPending: record.selectionPending,
        queuePosition: record.queuePosition,
        completedAt: record.completedAt,
        seedUploadSlotLimit: record.seedUploadSlotLimit
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

    this.applyQueueScheduling(true);
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
    this.applyQueueScheduling(true);
    void this.applySeedingRules();
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
    record.queuePaused = false;
    record.forceStarted = false;
    record.torrent.pause();
    record.statusOverride = "paused";
    this.emitStatus(record);
    this.applyQueueScheduling(true);
    void this.persistState();
    return this.toSummary(record);
  }

  resume(id: string) {
    const record = this.getRecord(id);
    this.commitSelectionIfNeeded(record);
    record.manualPaused = false;
    record.queuePaused = false;
    record.forceStarted = false;
    record.statusOverride = undefined;
    this.applyQueueScheduling(true);
    this.emitStatus(record);
    void this.persistState();
    return this.toSummary(record);
  }

  forceStart(id: string) {
    const record = this.getRecord(id);
    this.commitSelectionIfNeeded(record);
    record.manualPaused = false;
    record.queuePaused = false;
    record.forceStarted = true;
    record.statusOverride = undefined;
    record.torrent.resume();
    this.applyUploadSlotLimit(record);
    this.applyQueueScheduling(true);
    this.emitCore("torrent.details.updated", this.toSummary(record));
    void this.persistState();
    return this.toSummary(record);
  }

  async remove(request: string | RemoveTorrentRequest) {
    const normalized = normalizeRemoveTorrentRequest(request);
    const record = this.getRecord(normalized.id);
    const summary = this.toSummary(record);

    await this.removeTorrentFromClient(record, normalized.deleteData);

    this.records.delete(record.id);
    this.recordTorrentRemoved(normalized.deleteData);
    this.emitCore("torrent.removed", {
      id: summary.id,
      name: summary.name,
      deleteData: normalized.deleteData
    });
    this.applyQueueScheduling(true);
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
    this.applyQueueScheduling(true);
    this.emitStatus(record);
    this.emitCore("torrent.progress.updated", this.toSummary(record));
    return this.toSummary(record);
  }

  rename(request: RenameTorrentRequest) {
    const record = this.getRecord(request.id);
    const normalizedName = normalizeTorrentName(request.name);

    record.nameOverride = normalizedName;
    const summary = this.toSummary(record);
    this.emitCore("torrent.details.updated", summary);
    void this.persistState();
    return summary;
  }

  async moveData(request: MoveTorrentDataRequest): Promise<MoveTorrentDataResult> {
    const record = this.getRecord(request.id);
    const destinationPath = normalizeDestinationPath(request.destinationPath);
    const previousSavePath = this.getTorrentStorageRootPath(record);
    const storageFolderName = this.getTorrentStorageFolderName(record);
    const nextStorageRootPath = storageFolderName
      ? path.resolve(destinationPath, storageFolderName)
      : destinationPath;
    const wasPaused = record.manualPaused;
    const wasForceStarted = record.forceStarted;
    const replacementRequest: InternalAddTorrentRequest = {
      downloadPath: destinationPath,
      profileId: record.profileId,
      startPaused: wasPaused,
      category: record.category,
      tags: record.tags,
      filePriorities: record.filePriorities,
      nameOverride: record.nameOverride,
      forceStarted: wasForceStarted && !wasPaused,
      selectionPending: record.selectionPending,
      queuePosition: record.queuePosition,
      completedAt: record.completedAt,
      seedUploadSlotLimit: record.seedUploadSlotLimit
    };
    const source = record.source;
    const files = record.torrent.files.map((file) => ({
      path: file.path || file.name
    }));
    const id = record.id;

    record.manualPaused = true;
    record.queuePaused = false;
    record.forceStarted = false;
    record.torrent.pause();
    record.statusOverride = "paused";
    this.emitStatus(record);

    await this.removeTorrentFromClient(record);
    this.records.delete(id);

    let movedFiles = 0;
    let torrent: TorrentSummary;

    try {
      movedFiles = await moveTorrentFiles(
        previousSavePath,
        nextStorageRootPath,
        files
      );
      torrent = await this.addTorrentFromSource(source, replacementRequest, {
        countAsAdded: false
      });
    } catch (error) {
      try {
        await this.addTorrentFromSource(
          source,
          {
            ...replacementRequest,
            downloadPath: record.downloadPath,
            startPaused: true,
            forceStarted: false
          },
          { countAsAdded: false }
        );
      } catch (restoreError) {
        this.emitCore("torrent.error", {
          id,
          message: `Move failed and restore also failed: ${getErrorMessage(
            restoreError
          )}`
        });
      }

      throw error;
    }

    const result: MoveTorrentDataResult = {
      torrent,
      previousSavePath,
      newSavePath: torrent.savePath,
      movedFiles
    };
    this.emitCore("torrent.data.moved", {
      id: torrent.id,
      previousSavePath,
      newSavePath: torrent.savePath,
      movedFiles,
      torrent
    });
    void this.persistState();
    return result;
  }

  reannounce(id: string): ReannounceTorrentResult {
    const record = this.getRecord(id);
    const discovery = record.torrent.discovery;
    const tracker = discovery?.tracker;
    const trackerCount = record.torrent.announce?.length ?? 0;

    if (!tracker || trackerCount === 0) {
      throw createCodedError(
        "reannounce_unavailable",
        "Tracker announce is not available for this torrent."
      );
    }

    let method: ReannounceTorrentResult["method"] = "tracker.update";

    if (typeof tracker.update === "function") {
      tracker.update({ numwant: 80 });
    } else if (typeof tracker.start === "function") {
      method = "tracker.start";
      tracker.start({ numwant: 80 });
    } else {
      throw createCodedError(
        "reannounce_unavailable",
        "The selected torrent engine does not expose a tracker announce method."
      );
    }

    const announcedAt = new Date().toISOString();
    record.lastActivityAt = announcedAt;
    const torrent = this.toSummary(record);
    this.emitCore("torrent.announce.requested", {
      id: torrent.id,
      announcedAt,
      trackerCount,
      method,
      torrent
    });

    return {
      torrent,
      announcedAt,
      trackerCount,
      method
    };
  }

  async exportTorrentFile(
    request: ExportTorrentFileRequest
  ): Promise<ExportTorrentFileResult> {
    const record = this.getRecord(request.id);
    const targetPath = normalizeTorrentExportPath(
      request.targetPath,
      this.toSummary(record).name
    );
    const { source, torrentFile } = await this.getExportableTorrentFile(record);

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, torrentFile);

    return {
      torrent: this.toSummary(record),
      exportPath: targetPath,
      source
    };
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
    applyProfileHintsToRecord(record, !record.selectionPending);

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
    if (!record.selectionPending) {
      applyFilePriority(file, priority);
    }

    const summary = this.toSummary(record);
    this.emitCore("torrent.files.updated", summary);
    void this.persistState();
    return summary;
  }

  setFilePriorities(request: SetTorrentFilePrioritiesRequest) {
    const record = this.getRecord(request.id);

    for (const [fileIndex, priority] of Object.entries(request.priorities)) {
      const index = Number(fileIndex);
      const file = record.torrent.files[index];

      if (!file) {
        continue;
      }

      record.filePriorities[file.path] = normalizeFilePriority(priority);
      if (!record.selectionPending) {
        applyFilePriority(file, record.filePriorities[file.path]);
      }
    }

    const summary = this.toSummary(record);
    this.emitCore("torrent.files.updated", summary);
    void this.persistState();
    return summary;
  }

  commitPreparedAdd(request: CommitPreparedTorrentAddRequest) {
    const record = this.getRecord(request.id);

    if (request.filePriorities) {
      for (const [fileIndex, priority] of Object.entries(request.filePriorities)) {
        const index = Number(fileIndex);
        const file = record.torrent.files[index];

        if (file) {
          record.filePriorities[file.path] = normalizeFilePriority(priority);
        }
      }
    }

    record.selectionPending = false;
    this.applyFilePriorities(record);

    if (request.start === false) {
      record.manualPaused = true;
      record.queuePaused = false;
      record.forceStarted = false;
      record.statusOverride = "paused";
      record.torrent.pause();
    } else {
      record.manualPaused = false;
      record.queuePaused = false;
      record.forceStarted = Boolean(request.forceStart);
      record.statusOverride = undefined;
      this.applyQueueScheduling(true);
    }

    const summary = this.toSummary(record);
    this.emitCore("torrent.files.updated", summary);
    this.emitStatus(record);
    void this.persistState();
    return summary;
  }

  updateQueuePosition(request: UpdateTorrentQueuePositionRequest) {
    const record = this.getRecord(request.id);
    const role = getQueueRole(record);
    const records = this.getQueueRecords(role);
    const currentIndex = records.findIndex((item) => item.id === record.id);

    if (currentIndex === -1) {
      return this.getSnapshot();
    }

    const [item] = records.splice(currentIndex, 1);
    const nextIndex = getMovedQueueIndex(
      currentIndex,
      records.length,
      request.direction
    );
    records.splice(nextIndex, 0, item);
    records.forEach((queuedRecord, index) => {
      queuedRecord.queuePosition = index + 1;
    });

    this.applyQueueScheduling(true);
    void this.persistState();
    return this.getSnapshot();
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
    return this.getTorrentStorageRootPath(record);
  }

  getTorrentFilePath(request: OpenTorrentFileRequest) {
    const record = this.getRecord(request.id);
    const file = record.torrent.files[request.fileIndex];

    if (!file) {
      throw new Error(`Torrent file not found: ${request.fileIndex}`);
    }

    const basePath = this.getTorrentStorageRootPath(record);
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

  private async addTorrentFromSource(
    source: PersistedTorrentSource,
    request: InternalAddTorrentRequest,
    options: { countAsAdded?: boolean } = {}
  ) {
    if (source.type === "magnet") {
      return this.addTorrentInput(source.magnetUri, source, request, options);
    }

    if (source.type === "torrent_url") {
      try {
        const torrentFile = await fs.readFile(source.cachedFilePath);
        return this.addTorrentInput(torrentFile, source, request, options);
      } catch {
        const torrentFile = await fetchTorrentFile(source.url);
        const cachedFilePath = await this.cacheTorrentUrlFile(source.url, torrentFile);
        return this.addTorrentInput(
          torrentFile,
          { ...source, cachedFilePath },
          request,
          options
        );
      }
    }

    const torrentFile = await fs.readFile(source.filePath);
    return this.addTorrentInput(torrentFile, source, request, options);
  }

  private async removeTorrentFromClient(record: TorrentRecord, deleteData = false) {
    await new Promise<void>((resolve, reject) => {
      void this.client.remove(
        record.torrent,
        { destroyStore: deleteData },
        (error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        }
      );
    });
  }

  private getTorrentStorageRootPath(record: TorrentRecord) {
    const basePath = path.resolve(record.torrent.path || record.downloadPath);
    const storageFolderName = this.getTorrentStorageFolderName(record);

    return storageFolderName ? path.resolve(basePath, storageFolderName) : basePath;
  }

  private getTorrentStorageFolderName(record: TorrentRecord) {
    const infoHash = record.torrent.infoHash;
    const name = record.torrent.name || getSourceDisplayName(record.source);

    if (!infoHash || !name) {
      return null;
    }

    return `${name} - ${infoHash.slice(0, 8)}`;
  }

  private commitSelectionIfNeeded(record: TorrentRecord) {
    if (!record.selectionPending) {
      return;
    }

    record.selectionPending = false;
    this.applyFilePriorities(record);
  }

  private hasExportableTorrentFile(record: TorrentRecord) {
    return Boolean(
      record.torrent.torrentFile ||
        record.torrent.metadata ||
        record.source.type === "torrent_file" ||
        record.source.type === "torrent_url"
    );
  }

  private async getExportableTorrentFile(record: TorrentRecord): Promise<{
    source: ExportTorrentFileResult["source"];
    torrentFile: Buffer;
  }> {
    if (record.torrent.torrentFile) {
      return {
        source: "metadata",
        torrentFile: Buffer.from(record.torrent.torrentFile)
      };
    }

    if (record.torrent.metadata) {
      return {
        source: "metadata",
        torrentFile: Buffer.from(record.torrent.metadata)
      };
    }

    if (record.source.type === "torrent_file") {
      return {
        source: "source_file",
        torrentFile: await fs.readFile(record.source.filePath)
      };
    }

    if (record.source.type === "torrent_url") {
      return {
        source: "cached_url",
        torrentFile: await fs.readFile(record.source.cachedFilePath)
      };
    }

    throw createCodedError(
      "torrent_export_unavailable",
      "Torrent metadata is not available yet."
    );
  }

  private async restoreTorrentUrl(
    source: Extract<PersistedTorrentSource, { type: "torrent_url" }>,
    request: InternalAddTorrentRequest
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

  private allocateQueuePosition(value: unknown) {
    const numeric = Number(value);

    if (Number.isInteger(numeric) && numeric > 0) {
      this.queuePositionCounter = Math.max(this.queuePositionCounter, numeric);
      return numeric;
    }

    this.queuePositionCounter += 1;
    return this.queuePositionCounter;
  }

  private async addTorrentInput(
    input: string | Buffer,
    source: PersistedTorrentSource,
    request: InternalAddTorrentRequest,
    options: { countAsAdded?: boolean } = {}
  ) {
    const downloadPath = request.downloadPath || this.options.defaultDownloadPath;
    const filePriorities = normalizeFilePriorities(request.filePriorities);
    const selectionPending = Boolean(request.selectFilesBeforeStart ?? request.selectionPending);
    const { profile, webTorrentOptions } = buildWebTorrentAddOptions({
      downloadPath,
      profileId: request.profileId,
      startPaused: selectionPending ? false : request.startPaused,
      deselect: selectionPending,
      forcePrivate: this.networkSettings.privateMode,
      uploadSlots: this.networkSettings.connectionLimits.uploadSlots
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
        queuePaused: false,
        forceStarted: Boolean(request.forceStarted),
        selectionPending,
        nameOverride: normalizeTorrentName(request.nameOverride ?? null),
        queuePosition: this.allocateQueuePosition(request.queuePosition),
        completedAt: normalizePersistedDate(request.completedAt),
        seedUploadSlotLimit: normalizeSeedUploadSlotLimit(
          request.seedUploadSlotLimit
        ),
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
        statusOverride: request.startPaused || selectionPending ? "paused" : undefined
      };

      this.records.set(temporaryId, record);
      this.attachTorrentEvents(record);
      this.applyUploadSlotLimit(record);
      if (!record.selectionPending) {
        this.applyFilePriorities(record);
      }

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
        this.applyQueueScheduling(false);
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
        if (options.countAsAdded !== false) {
          this.recordTorrentAdded();
        }
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
      if (!record.selectionPending) {
        this.applyFilePriorities(record);
      }
      const summary = this.toSummary(record);
      this.emitCore("torrent.metadata.received", summary);
      this.emitAssistantHealth(summary);
      this.emitAssistantScheduleSuggestion(summary.id);
      this.applyQueueScheduling(true);
      this.emitStatus(record);
      void this.persistState();
    });

    torrent.on("ready", () => {
      this.promoteRecordId(record);
      if (!record.selectionPending) {
        this.applyFilePriorities(record);
      }
      record.lastActivityAt = new Date().toISOString();
      this.applyQueueScheduling(true);
      this.emitStatus(record);
    });

    torrent.on("done", () => {
      const now = new Date().toISOString();
      record.completedAt = record.completedAt ?? now;
      record.statusOverride = undefined;
      record.lastActivityAt = now;
      this.recordTorrentCompleted();
      this.applyQueueScheduling(true);
      void this.applySeedingRules();
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
    const queueRole = getQueueRole(record);
    const queueState = this.getQueueState(record);

    return {
      id: record.id,
      infoHash: torrent.infoHash ?? null,
      name: record.nameOverride || torrent.name || getSourceDisplayName(record.source),
      originalName: torrent.name ?? null,
      status: this.getStatus(record),
      progress: clamp(torrent.progress ?? 0),
      sizeBytes: toNonNegativeNumber(torrent.length),
      downloadedBytes: toNonNegativeNumber(torrent.downloaded),
      uploadedBytes: toNonNegativeNumber((torrent as WebTorrentTorrent & { uploaded?: number }).uploaded),
      downloadSpeedBytes: toNonNegativeNumber(torrent.downloadSpeed),
      uploadSpeedBytes: toNonNegativeNumber(torrent.uploadSpeed),
      seeds: connectedSeeds,
      peers: torrent.numPeers ?? torrent.wires?.length ?? 0,
      etaSeconds: Number.isFinite(timeRemaining)
        ? Math.max(0, Math.ceil(timeRemaining / 1_000))
        : null,
      savePath: this.getTorrentStorageRootPath(record),
      metadataReady,
      private: Boolean(torrent.private),
      sourceType: record.source.type as TorrentSourceType,
      selectedProfileId: record.profileId,
      recheckAvailable: typeof torrent.rescanFiles === "function",
      forceStarted: record.forceStarted,
      selectionPending: record.selectionPending,
      canMoveData: true,
      canReannounce: Boolean(torrent.discovery?.tracker && torrent.announce?.length),
      canExportTorrent: this.hasExportableTorrentFile(record),
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
      trackers: getTrackers(torrent),
      httpSources: getHttpSources(torrent),
      peerDetails: getPeerDetails(torrent),
      connectedSeeds,
      queueRole,
      queueState,
      queuePosition: this.getQueuePosition(record, queueRole),
      queuedReason: getQueuedReason(record),
      completedAt: record.completedAt
    };
  }

  private getStatus(record: TorrentRecord): TorrentStatus {
    if (record.statusOverride && record.statusOverride !== "completed") {
      return record.statusOverride;
    }

    if (record.selectionPending) {
      return "paused";
    }

    if (record.manualPaused) {
      return "paused";
    }

    if (record.queuePaused) {
      return "queued";
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

  private applyQueueScheduling(emitChanges: boolean) {
    const before = new Map(
      [...this.records.values()].map((record) => [
        record.id,
        `${record.queuePaused}:${record.torrent.paused}:${this.getStatus(record)}`
      ])
    );
    const queueSettings = this.automationSettings.queue;
    const activeIds = new Set<string>();

    if (queueSettings.enabled) {
      for (const role of ["download", "seed"] as const) {
        const candidates = this.getQueueCandidates(role);
        const forced = candidates.filter((record) => record.forceStarted);
        const regular = candidates.filter((record) => !record.forceStarted);
        const limit =
          role === "download"
            ? queueSettings.maxActiveDownloads
            : queueSettings.maxActiveSeeds;
        const regularSlots =
          limit === null ? regular.length : Math.max(0, limit - forced.length);

        for (const record of [...forced, ...regular.slice(0, regularSlots)]) {
          activeIds.add(record.id);
        }
      }
    } else {
      for (const record of this.records.values()) {
        if (this.isQueueCandidate(record)) {
          activeIds.add(record.id);
        }
      }
    }

    for (const record of this.records.values()) {
      if (!this.isQueueCandidate(record)) {
        record.queuePaused = false;
        if (record.manualPaused || record.selectionPending) {
          record.torrent.pause();
        }
        continue;
      }

      const active = activeIds.has(record.id);
      record.queuePaused = !active;

      if (active) {
        record.torrent.resume();
        this.applyUploadSlotLimit(record);
      } else {
        record.torrent.pause();
      }
    }

    const changedRecords = [...this.records.values()].filter((record) => {
      const previous = before.get(record.id);
      const current = `${record.queuePaused}:${record.torrent.paused}:${this.getStatus(record)}`;
      return previous !== current;
    });

    if (changedRecords.length > 0 && emitChanges) {
      for (const record of changedRecords) {
        this.emitStatus(record);
      }
      this.emitCore("torrent.queue.updated", {
        snapshot: this.getSnapshot()
      });
    }

    return changedRecords.length > 0;
  }

  private async applySeedingRules() {
    if (this.seedingRulesApplying) {
      return;
    }

    this.seedingRulesApplying = true;

    try {
      const rules = this.automationSettings.seedingRules.filter(
        (rule) => rule.enabled
      );

      if (rules.length === 0) {
        return;
      }

      for (const record of [...this.records.values()]) {
        if (!isCompletedRecord(record)) {
          continue;
        }

        if (!record.completedAt) {
          record.completedAt = new Date().toISOString();
        }

        const rule = rules.find((item) => seedingRuleMatches(item, record));

        if (!rule) {
          continue;
        }

        if (rule.action === "remove") {
          await this.remove({ id: record.id, deleteData: false });
          continue;
        }

        if (rule.action === "limit") {
          const nextLimit = rule.uploadSlotLimit ?? 1;
          if (record.seedUploadSlotLimit !== nextLimit) {
            record.seedUploadSlotLimit = nextLimit;
            this.applyUploadSlotLimit(record);
            this.emitCore("torrent.details.updated", this.toSummary(record));
            void this.persistState();
          }
          continue;
        }

        if (!record.manualPaused) {
          record.manualPaused = true;
          record.queuePaused = false;
          record.forceStarted = false;
          record.statusOverride = "paused";
          record.torrent.pause();
          this.emitStatus(record);
          this.applyQueueScheduling(true);
          void this.persistState();
        }
      }
    } finally {
      this.seedingRulesApplying = false;
    }
  }

  private getQueueCandidates(role: TorrentQueueRole) {
    return [...this.records.values()]
      .filter((record) => getQueueRole(record) === role && this.isQueueCandidate(record))
      .sort(compareQueueRecords);
  }

  private getQueueRecords(role: TorrentQueueRole) {
    return [...this.records.values()]
      .filter((record) => getQueueRole(record) === role)
      .sort(compareQueueRecords);
  }

  private isQueueCandidate(record: TorrentRecord) {
    if (
      record.manualPaused ||
      record.selectionPending ||
      record.statusOverride === "checking" ||
      record.statusOverride === "error"
    ) {
      return false;
    }

    return Boolean(record.torrent.metadata || record.torrent.ready || record.torrent.infoHash);
  }

  private getQueueState(record: TorrentRecord): TorrentQueueState {
    if (record.manualPaused || record.selectionPending) {
      return "paused";
    }

    if (
      record.statusOverride === "checking" ||
      record.statusOverride === "error" ||
      !this.isQueueCandidate(record)
    ) {
      return "unmanaged";
    }

    return record.queuePaused ? "queued" : "active";
  }

  private getQueuePosition(record: TorrentRecord, role: TorrentQueueRole) {
    const records = this.getQueueRecords(role);
    return Math.max(0, records.findIndex((item) => item.id === record.id)) + 1;
  }

  private applyUploadSlotLimit(record: TorrentRecord) {
    const uploadSlots =
      record.seedUploadSlotLimit ??
      this.networkSettings.connectionLimits.uploadSlots ??
      null;

    if (uploadSlots !== null && typeof record.torrent._rechokeNumSlots === "number") {
      record.torrent._rechokeNumSlots = uploadSlots;
    }
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
        connectionLimits: { ...this.networkSettings.connectionLimits },
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
    this.client.maxConns = this.networkSettings.connectionLimits.maxConnections ?? 55;
    for (const record of this.records.values()) {
      this.applyUploadSlotLimit(record);
    }

    this.activeNetworkSettings = {
      ...this.activeNetworkSettings,
      profileId: this.networkSettings.profileId,
      privateMode: this.networkSettings.privateMode,
      encryptionMode: this.networkSettings.encryptionMode,
      speedLimits: { ...speedLimits },
      connectionLimits: { ...this.networkSettings.connectionLimits },
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
      version: 6,
      torrents: [...this.records.values()].map((record) => ({
        source: record.source,
        downloadPath: record.downloadPath,
        profileId: record.profileId,
        paused: record.manualPaused,
        category: record.category,
        tags: [...record.tags],
        filePriorities: { ...record.filePriorities },
        nameOverride: record.nameOverride,
        forceStarted: record.forceStarted,
        selectionPending: record.selectionPending,
        queuePosition: record.queuePosition,
        completedAt: record.completedAt,
        seedUploadSlotLimit: record.seedUploadSlotLimit,
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

function isPathInsideOrSame(basePath: string, candidatePath: string) {
  const relative = path.relative(basePath, candidatePath);
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
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

function normalizeTorrentName(name: string | null | undefined) {
  const normalized = String(name ?? "").trim().replace(/\s+/g, " ");

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 160);
}

function normalizeDestinationPath(destinationPath: string | null | undefined) {
  const normalized = String(destinationPath ?? "").trim();

  if (!normalized) {
    throw createCodedError(
      "destination_required",
      "A destination folder is required."
    );
  }

  return path.resolve(normalized);
}

function normalizeTorrentExportPath(
  targetPath: string | null | undefined,
  torrentName: string
) {
  if (targetPath?.trim()) {
    return path.resolve(targetPath.trim());
  }

  return path.resolve(`${sanitizeFileName(torrentName || "torrent")}.torrent`);
}

async function moveTorrentFiles(
  previousRootPath: string,
  destinationRootPath: string,
  files: Array<{ path: string }>
) {
  let movedFiles = 0;
  const previousRoot = path.resolve(previousRootPath);
  const nextRoot = path.resolve(destinationRootPath);

  if (previousRoot === nextRoot) {
    return movedFiles;
  }

  for (const file of files) {
    const relativePath = file.path || "";
    const fromPath = path.resolve(previousRoot, relativePath);
    const toPath = path.resolve(nextRoot, relativePath);

    if (!isPathInsideOrSame(previousRoot, fromPath) || !isPathInsideOrSame(nextRoot, toPath)) {
      continue;
    }

    try {
      await fs.stat(fromPath);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        continue;
      }

      throw error;
    }

    await fs.mkdir(path.dirname(toPath), { recursive: true });
    await moveFile(fromPath, toPath);
    movedFiles += 1;
  }

  await pruneEmptyDirectories(previousRoot);
  return movedFiles;
}

async function moveFile(fromPath: string, toPath: string) {
  try {
    await fs.rename(fromPath, toPath);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EXDEV") {
      throw error;
    }

    await fs.copyFile(fromPath, toPath);
    await fs.rm(fromPath, { force: true });
  }
}

async function pruneEmptyDirectories(rootPath: string) {
  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => pruneEmptyDirectories(path.join(rootPath, entry.name)))
    );

    const remainingEntries = await fs.readdir(rootPath);
    if (remainingEntries.length === 0) {
      await fs.rmdir(rootPath);
    }
  } catch {
    // Best effort cleanup only.
  }
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

function applyProfileHintsToRecord(record: TorrentRecord, applySelection = true) {
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
  if (applySelection) {
    applyFilePriority(mediaFile, "high");
  }
}

function compareQueueRecords(left: TorrentRecord, right: TorrentRecord) {
  if (left.queuePosition !== right.queuePosition) {
    return left.queuePosition - right.queuePosition;
  }

  return Date.parse(left.addedAt) - Date.parse(right.addedAt);
}

function getQueueRole(record: TorrentRecord): TorrentQueueRole {
  return isCompletedRecord(record) ? "seed" : "download";
}

function getQueuedReason(record: TorrentRecord) {
  if (record.selectionPending) {
    return "selection_pending" as const;
  }

  if (record.manualPaused) {
    return "manual" as const;
  }

  if (!record.queuePaused) {
    return null;
  }

  return getQueueRole(record) === "download"
    ? ("download_limit" as const)
    : ("seed_limit" as const);
}

function isCompletedRecord(record: TorrentRecord) {
  return Boolean(
    record.completedAt ||
      record.torrent.done ||
      toNonNegativeNumber(record.torrent.progress) >= 1
  );
}

function seedingRuleMatches(
  rule: SeedingRuleSettings,
  record: TorrentRecord,
  now = Date.now()
) {
  const downloadedBytes = toNonNegativeNumber(record.torrent.downloaded);
  const uploadedBytes = toNonNegativeNumber(
    (record.torrent as WebTorrentTorrent & { uploaded?: number }).uploaded
  );
  const ratio =
    downloadedBytes > 0 && uploadedBytes > 0 ? uploadedBytes / downloadedBytes : 0;
  const ratioReached =
    rule.ratioLimit !== null && downloadedBytes > 0 && ratio >= rule.ratioLimit;
  const completedAt = record.completedAt ? Date.parse(record.completedAt) : NaN;
  const minutesAfterComplete =
    Number.isFinite(completedAt) && completedAt > 0
      ? Math.floor((now - completedAt) / 60_000)
      : 0;
  const timeReached =
    rule.minutesAfterComplete !== null &&
    minutesAfterComplete >= rule.minutesAfterComplete;

  return ratioReached || timeReached;
}

function normalizePersistedDate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  return Number.isFinite(Date.parse(value)) ? value : null;
}

function normalizeSeedUploadSlotLimit(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);

  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }

  return Math.min(numeric, 100);
}

function getMovedQueueIndex(
  currentIndex: number,
  remainingLength: number,
  direction: UpdateTorrentQueuePositionRequest["direction"]
) {
  if (direction === "top") {
    return 0;
  }

  if (direction === "bottom") {
    return remainingLength;
  }

  if (direction === "up") {
    return Math.max(0, currentIndex - 1);
  }

  return Math.min(remainingLength, currentIndex + 1);
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

function getTrackers(torrent: WebTorrentTorrent) {
  return (torrent.announce ?? []).map((url, index) => ({
    url,
    host: getUrlHost(url) ?? url,
    protocol: getUrlProtocol(url),
    tier: index
  }));
}

function getHttpSources(torrent: WebTorrentTorrent) {
  return (torrent.urlList ?? []).map((url) => ({
    url,
    host: getUrlHost(url) ?? url,
    protocol: getUrlProtocol(url)
  }));
}

function getPeerDetails(torrent: WebTorrentTorrent) {
  return (torrent.wires ?? [])
    .filter((wire) => !wire.destroyed)
    .map((wire, index) => {
      const peerId = normalizePeerId(wire.peerId);
      return {
        id: `${wire.remoteAddress ?? "peer"}:${wire.remotePort ?? index}:${peerId ?? index}`,
        address: wire.remoteAddress ?? null,
        port: typeof wire.remotePort === "number" ? wire.remotePort : null,
        clientName: decodePeerClient(peerId),
        peerId,
        type: wire.type ?? "peer",
        downloadSpeedBytes: toNonNegativeNumber(wire.downloadSpeed?.()),
        uploadSpeedBytes: toNonNegativeNumber(wire.uploadSpeed?.()),
        progress: getPeerProgress(wire),
        flags: getPeerFlags(wire)
      };
    })
    .slice(0, 200);
}

function normalizePeerId(peerId: string | Uint8Array | Buffer | undefined) {
  if (!peerId) {
    return null;
  }

  if (typeof peerId === "string") {
    return peerId;
  }

  return Buffer.from(peerId).toString("latin1");
}

function decodePeerClient(peerId: string | null) {
  if (!peerId) {
    return "Unknown";
  }

  const azStyle = peerId.match(/^-([A-Za-z0-9]{2})([0-9A-Za-z]{4})-/);
  if (azStyle) {
    const client = PEER_CLIENT_PREFIXES[azStyle[1]] ?? azStyle[1];
    const version = azStyle[2].split("").join(".");
    return `${client} ${version}`;
  }

  return "Unknown";
}

function getPeerProgress(
  wire: NonNullable<WebTorrentTorrent["wires"]>[number]
) {
  const pieces = wire.peerPieces?.buffer;

  if (!pieces || pieces.length === 0 || !wire.peerPieces?.get) {
    return wire.isSeeder ? 1 : null;
  }

  let availablePieces = 0;
  const totalPieces = pieces.length * 8;

  for (let index = 0; index < totalPieces; index += 1) {
    if (wire.peerPieces.get(index)) {
      availablePieces += 1;
    }
  }

  return totalPieces > 0 ? clamp(availablePieces / totalPieces) : null;
}

function getPeerFlags(wire: NonNullable<WebTorrentTorrent["wires"]>[number]) {
  const flags: string[] = [];

  if (wire.isSeeder) flags.push("seed");
  if (wire.peerChoking) flags.push("peer-choking");
  if (wire.peerInterested) flags.push("peer-interested");
  if (wire.amChoking) flags.push("am-choking");
  if (wire.amInterested) flags.push("am-interested");
  if (wire.type) flags.push(wire.type);

  return flags;
}

function getUrlHost(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function getUrlProtocol(value: string) {
  try {
    return new URL(value).protocol.replace(/:$/, "");
  } catch {
    return "unknown";
  }
}

const PEER_CLIENT_PREFIXES: Record<string, string> = {
  AZ: "Azureus",
  BT: "BitTorrent",
  DE: "Deluge",
  LT: "libtorrent",
  qB: "qBittorrent",
  TR: "Transmission",
  UT: "uTorrent",
  WD: "WebTorrent Desktop",
  WW: "WebTorrent"
};

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
