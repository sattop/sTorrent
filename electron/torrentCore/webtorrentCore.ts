import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { promises as fs, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import os from "node:os";
import WebTorrent, {
  type WebTorrentFile,
  type WebTorrentTorrent
} from "webtorrent";
import {
  type AddMagnetRequest,
  type AddTorrentFileRequest,
  type AutomationSettings,
  type AutomationSettingsState,
  type DownloadProfileId,
  type NetworkDiagnosticsReport,
  type NetworkInterfaceInfo,
  type NetworkSettings,
  type NetworkSettingsState,
  type SetTorrentFilePriorityRequest,
  type WatchFolderScanResult,
  type WatchFolderSettings,
  type TorrentFilePriority,
  type TorrentFileInfo,
  type TorrentCoreEvent,
  type TorrentCoreEventPayloadMap,
  type TorrentCoreSnapshot,
  type TorrentSourceType,
  type TorrentStatus,
  type TorrentSummary,
  type UpdateTorrentLabelsRequest
} from "./contracts.js";
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

type PersistedTorrentSource =
  | {
      type: "torrent_file";
      filePath: string;
    }
  | {
      type: "magnet";
      magnetUri: string;
    };

interface PersistedTorrentRecord {
  source: PersistedTorrentSource;
  downloadPath: string;
  profileId: DownloadProfileId;
  paused: boolean;
  category?: string | null;
  tags?: string[];
  filePriorities?: Record<string, TorrentFilePriority>;
}

interface PersistedTorrentState {
  version: 1 | 2;
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
  statusOverride?: TorrentStatus;
}

export interface WebTorrentCoreOptions {
  defaultDownloadPath: string;
  stateFilePath: string;
  networkSettingsFilePath: string;
  automationSettingsFilePath: string;
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

  constructor(private readonly options: WebTorrentCoreOptions) {
    super();

    this.client = this.createClient(this.activeNetworkSettings);

    this.progressTimer = setInterval(() => {
      for (const record of this.records.values()) {
        this.emitCore("torrent.progress.updated", this.toSummary(record));
      }
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
      ![1, 2].includes(persistedState.version) ||
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

  async remove(id: string) {
    const record = this.getRecord(id);

    await new Promise<void>((resolve, reject) => {
      void this.client.remove(record.torrent, { destroyStore: false }, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    this.records.delete(record.id);
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

  getSnapshot(): TorrentCoreSnapshot {
    return {
      torrents: [...this.records.values()].map((record) =>
        this.toSummary(record)
      ),
      downloadSpeedBytes: this.client.downloadSpeed,
      uploadSpeedBytes: this.client.uploadSpeed
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
    this.client.destroy();
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
      this.promoteRecordId(record);
      this.applyFilePriorities(record);
      this.emitCore("torrent.metadata.received", this.toSummary(record));
      this.emitStatus(record);
      void this.persistState();
    });

    torrent.on("ready", () => {
      this.promoteRecordId(record);
      this.applyFilePriorities(record);
      this.emitStatus(record);
    });

    torrent.on("done", () => {
      record.statusOverride = "completed";
      this.emitCore("torrent.completed", this.toSummary(record));
      this.emitStatus(record);
      void this.persistState();
    });

    torrent.on("error", (error: Error) => {
      record.statusOverride = "error";
      this.emitCore("torrent.error", {
        id: record.id,
        message: error.message
      });
      this.emitStatus(record);
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
      seeds: 0,
      peers: torrent.numPeers ?? 0,
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
      )
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
      return "completed";
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

  private emitCore<EventName extends keyof TorrentCoreEventPayloadMap>(
    type: EventName,
    payload: TorrentCoreEventPayloadMap[EventName]
  ) {
    const event: TorrentCoreEvent = { type, payload } as TorrentCoreEvent;
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
      version: 2,
      torrents: [...this.records.values()].map((record) => ({
        source: record.source,
        downloadPath: record.downloadPath,
        profileId: record.profileId,
        paused: record.manualPaused || record.torrent.paused === true,
        category: record.category,
        tags: [...record.tags],
        filePriorities: { ...record.filePriorities }
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

  return source.magnetUri.slice(0, 40);
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
