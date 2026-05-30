import type {
  AutomationSettingsState,
  NetworkSettingsState,
  SpeedDoctorActionId,
  SpeedDoctorDiskDetails,
  SpeedDoctorProbeStatus,
  SpeedDoctorReason,
  SpeedDoctorReasonCode,
  SpeedDoctorReportStatus,
  SpeedDoctorRuntimeInput,
  TorrentSpeedDoctorReport,
  TorrentSummary
} from "./contracts.js";

const DISK_HEADROOM_BYTES = 512 * 1024 * 1024;

const REASON_PRIORITY: Record<SpeedDoctorReasonCode, number> = {
  torrent_paused: 10,
  torrent_queued: 20,
  global_download_limit: 30,
  active_speed_schedule: 40,
  traffic_saver_profile: 50,
  no_connected_peers: 60,
  low_seed_count: 70,
  tracker_error: 80,
  public_discovery_disabled: 90,
  private_discovery_enabled: 100,
  incoming_port_closed: 110,
  incoming_port_auto: 120,
  incoming_port_unverified: 130,
  proxy_unsupported: 140,
  proxy_connection_failed: 150,
  interface_unavailable: 160,
  disk_space_low: 170,
  disk_stalled: 180,
  file_locked: 190,
  queue_busy: 200,
  low_file_priority: 210,
  dead_torrent: 220,
  recent_errors: 230,
  all_files_skipped: 240,
  metadata_pending: 250
};

const EMPTY_RUNTIME: SpeedDoctorRuntimeInput = {
  activeTorrentCount: 0,
  activeDownloadCount: 0,
  connectedSeeds: 0,
  queuedPeerCount: 0,
  trackerHosts: [],
  trackerErrorCount: 0,
  lastTrackerError: null,
  noPeersSources: [],
  recentErrors: [],
  stalledSeconds: null,
  lockedFileCount: 0,
  incomingPortProbe: "unknown",
  proxyProbe: "unknown"
};

export interface SpeedDoctorDiskInput {
  availableBytes: number;
  totalBytes: number;
}

export interface TorrentSpeedDoctorInput {
  torrent: TorrentSummary;
  network: NetworkSettingsState;
  automation: AutomationSettingsState;
  disk: SpeedDoctorDiskInput | null;
  runtime?: SpeedDoctorRuntimeInput;
}

export function createTorrentSpeedDoctorReport(
  input: TorrentSpeedDoctorInput,
  now: Date = new Date()
): TorrentSpeedDoctorReport {
  const { torrent, network, automation } = input;
  const settings = network.activeSettings;
  const runtime = normalizeRuntime(input.runtime);
  const reasons: SpeedDoctorReason[] = [];
  const remainingBytes = Math.max(
    0,
    torrent.sizeBytes - torrent.downloadedBytes
  );
  const disk = createDiskDetails(input.disk, remainingBytes, runtime);
  const selectedFileCount = torrent.files.filter((file) => file.selected).length;
  const lowPrioritySelectedFileCount = torrent.files.filter(
    (file) => file.selected && file.priority === "normal"
  ).length;
  const connectedSeeds = Math.max(torrent.seeds, runtime.connectedSeeds);
  const hasLowConnectivity =
    torrent.status === "downloading" &&
    torrent.metadataReady &&
    torrent.peers === 0;

  if (torrent.status === "paused") {
    reasons.push({
      code: "torrent_paused",
      severity: "high",
      actionId: "resume_torrent"
    });
  }

  if (torrent.status === "queued") {
    reasons.push({
      code: "torrent_queued",
      severity: "high",
      actionId: "move_up_queue"
    });
  }

  if (
    torrent.status === "queued" ||
    (torrent.status === "downloading" &&
      runtime.activeDownloadCount >= 3 &&
      torrent.downloadSpeedBytes < 1024)
  ) {
    reasons.push({
      code: "queue_busy",
      severity: torrent.status === "queued" ? "high" : "medium",
      evidence: runtime.activeDownloadCount,
      actionId: "move_up_queue"
    });
  }

  if (settings.speedLimits.downloadBytesPerSecond !== null) {
    reasons.push({
      code: "global_download_limit",
      severity: "high",
      evidence: settings.speedLimits.downloadBytesPerSecond,
      actionId: "remove_temporary_limit"
    });
  }

  if (automation.activeSpeedScheduleId !== null) {
    reasons.push({
      code: "active_speed_schedule",
      severity: "medium",
      evidence: automation.activeSpeedScheduleId,
      actionId: "remove_temporary_limit"
    });
  }

  if (
    settings.profileId === "traffic_saver" ||
    torrent.selectedProfileId === "traffic_saver"
  ) {
    reasons.push({
      code: "traffic_saver_profile",
      severity: "medium",
      actionId: "switch_download_profile"
    });
  }

  if (
    torrent.status === "error" ||
    runtime.trackerErrorCount > 0 ||
    runtime.lastTrackerError
  ) {
    reasons.push({
      code: "tracker_error",
      severity: "high",
      evidence: runtime.lastTrackerError ?? runtime.trackerErrorCount,
      actionId: "show_trackers"
    });
  }

  if (!torrent.metadataReady) {
    reasons.push({
      code: "metadata_pending",
      severity: "low",
      actionId: "show_trackers"
    });
  } else if (torrent.peers === 0) {
    reasons.push({
      code: "no_connected_peers",
      severity: "high",
      actionId: "show_trackers"
    });
  } else if (connectedSeeds <= 1 && torrent.peers <= 2) {
    reasons.push({
      code: "low_seed_count",
      severity: "medium",
      evidence: connectedSeeds,
      actionId: "show_trackers"
    });
  }

  if (
    torrent.metadataReady &&
    torrent.status === "downloading" &&
    torrent.peers === 0 &&
    runtime.noPeersSources.length > 0
  ) {
    reasons.push({
      code: "dead_torrent",
      severity: "medium",
      evidence: runtime.noPeersSources.join(", "),
      actionId: "show_trackers"
    });
  }

  if (torrent.private) {
    if (settings.dht || settings.pex || settings.lsd) {
      reasons.push({
        code: "private_discovery_enabled",
        severity: "high"
      });
    }
  } else if (!settings.dht) {
    reasons.push({
      code: "public_discovery_disabled",
      severity: "medium",
      actionId: "toggle_dht_for_public_torrent"
    });
  }

  if (settings.incomingPort === null && !settings.upnp && !settings.natPmp) {
    reasons.push({
      code: "incoming_port_closed",
      severity: "high",
      actionId: "enable_upnp_nat_pmp"
    });
  } else if (runtime.incomingPortProbe === "failed") {
    reasons.push({
      code: "incoming_port_unverified",
      severity: "medium",
      actionId: "check_port"
    });
  } else if (hasLowConnectivity && settings.incomingPort === null) {
    reasons.push({
      code: "incoming_port_auto",
      severity: "medium",
      actionId: "check_port"
    });
  }

  if (network.settings.proxy.type !== "none" && !network.capabilities.proxy) {
    reasons.push({
      code: "proxy_unsupported",
      severity: "medium",
      evidence: network.settings.proxy.type,
      actionId: "check_proxy"
    });
  } else if (runtime.proxyProbe === "failed") {
    reasons.push({
      code: "proxy_connection_failed",
      severity: "high",
      evidence: network.settings.proxy.type,
      actionId: "check_proxy"
    });
  }

  if (
    network.settings.networkInterface.name &&
    !network.availableInterfaces.some(
      (item) => item.name === network.settings.networkInterface.name
    )
  ) {
    reasons.push({
      code: "interface_unavailable",
      severity: "high",
      evidence: network.settings.networkInterface.name,
      actionId: "choose_network_interface"
    });
  }

  if (
    disk &&
    remainingBytes > 0 &&
    disk.availableBytes < remainingBytes + DISK_HEADROOM_BYTES
  ) {
    reasons.push({
      code: "disk_space_low",
      severity: "high",
      evidence: disk.availableBytes,
      actionId: "open_folder"
    });
  }

  if (
    runtime.stalledSeconds !== null &&
    runtime.stalledSeconds >= 60 &&
    torrent.peers > 0 &&
    torrent.downloadSpeedBytes === 0
  ) {
    reasons.push({
      code: "disk_stalled",
      severity: "medium",
      evidence: runtime.stalledSeconds,
      actionId: "open_folder"
    });
  }

  if (runtime.lockedFileCount > 0) {
    reasons.push({
      code: "file_locked",
      severity: "high",
      evidence: runtime.lockedFileCount,
      actionId: "open_folder"
    });
  }

  if (torrent.files.length > 0 && selectedFileCount === 0) {
    reasons.push({
      code: "all_files_skipped",
      severity: "high",
      actionId: "raise_file_priority"
    });
  } else if (
    torrent.selectedProfileId === "stream_while_downloading" &&
    lowPrioritySelectedFileCount > 0 &&
    !torrent.files.some((file) => file.selected && file.priority === "high")
  ) {
    reasons.push({
      code: "low_file_priority",
      severity: "medium",
      evidence: lowPrioritySelectedFileCount,
      actionId: "raise_file_priority"
    });
  }

  if (runtime.recentErrors.length > 0) {
    reasons.push({
      code: "recent_errors",
      severity: "medium",
      evidence: runtime.recentErrors.length,
      actionId: "show_trackers"
    });
  }

  const rankedReasons = rankReasons(reasons);

  return {
    generatedAt: now.toISOString(),
    torrentId: torrent.id,
    status: getReportStatus(rankedReasons),
    primaryReason: rankedReasons[0]?.code ?? null,
    reasons: rankedReasons,
    actions: getActions(rankedReasons),
    technicalDetails: {
      torrent: {
        id: torrent.id,
        status: torrent.status,
        progress: torrent.progress,
        downloadSpeedBytes: torrent.downloadSpeedBytes,
        uploadSpeedBytes: torrent.uploadSpeedBytes,
        seeds: torrent.seeds,
        peers: torrent.peers,
        selectedProfileId: torrent.selectedProfileId,
        private: torrent.private,
        sourceType: torrent.sourceType,
        metadataReady: torrent.metadataReady,
        fileCount: torrent.files.length,
        selectedFileCount,
        lowPrioritySelectedFileCount
      },
      network: {
        profileId: settings.profileId,
        dht: settings.dht,
        pex: settings.pex,
        lsd: settings.lsd,
        incomingPortConfigured: settings.incomingPort !== null,
        upnp: settings.upnp,
        natPmp: settings.natPmp,
        downloadLimitBytesPerSecond: settings.speedLimits.downloadBytesPerSecond,
        uploadLimitBytesPerSecond: settings.speedLimits.uploadBytesPerSecond,
        proxyType: network.settings.proxy.type,
        interfaceSelected: Boolean(network.settings.networkInterface.name),
        activeSpeedScheduleId: automation.activeSpeedScheduleId
      },
      runtime,
      disk
    },
    redacted: true
  };
}

function createDiskDetails(
  disk: SpeedDoctorDiskInput | null,
  remainingBytes: number,
  runtime: SpeedDoctorRuntimeInput
): SpeedDoctorDiskDetails | null {
  if (!disk) {
    return null;
  }

  return {
    availableBytes: disk.availableBytes,
    totalBytes: disk.totalBytes,
    remainingBytes,
    stalledSeconds: runtime.stalledSeconds,
    lockedFileCount: runtime.lockedFileCount
  };
}

function normalizeRuntime(
  runtime: SpeedDoctorRuntimeInput | undefined
): SpeedDoctorRuntimeInput {
  if (!runtime) {
    return { ...EMPTY_RUNTIME };
  }

  return {
    ...EMPTY_RUNTIME,
    ...runtime,
    trackerHosts: [...runtime.trackerHosts].map(redactDiagnosticText),
    lastTrackerError: runtime.lastTrackerError
      ? redactDiagnosticText(runtime.lastTrackerError)
      : null,
    noPeersSources: [...runtime.noPeersSources].map(redactDiagnosticText),
    recentErrors: [...runtime.recentErrors].map(redactDiagnosticText),
    incomingPortProbe: normalizeProbe(runtime.incomingPortProbe),
    proxyProbe: normalizeProbe(runtime.proxyProbe)
  };
}

function normalizeProbe(value: SpeedDoctorProbeStatus): SpeedDoctorProbeStatus {
  return value;
}

function redactDiagnosticText(value: string) {
  return value
    .replace(/\b(?:https?|udp):\/\/\S+/gi, "[url]")
    .replace(/\b(passkey|token|secret)[=:/-]?[^\s&]*/gi, "$1=[redacted]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[hash]");
}

function rankReasons(reasons: SpeedDoctorReason[]) {
  return [...reasons].sort((left, right) => {
    const severityDifference =
      getSeverityRank(right.severity) - getSeverityRank(left.severity);

    if (severityDifference !== 0) {
      return severityDifference;
    }

    return REASON_PRIORITY[left.code] - REASON_PRIORITY[right.code];
  });
}

function getSeverityRank(severity: SpeedDoctorReason["severity"]) {
  if (severity === "high") {
    return 3;
  }

  if (severity === "medium") {
    return 2;
  }

  return 1;
}

function getReportStatus(
  reasons: SpeedDoctorReason[]
): SpeedDoctorReportStatus {
  if (reasons.some((reason) => reason.severity === "high")) {
    return "critical";
  }

  if (reasons.length > 0) {
    return "warning";
  }

  return "ok";
}

function getActions(reasons: SpeedDoctorReason[]): SpeedDoctorActionId[] {
  return Array.from(
    new Set(
      reasons
        .map((reason) => reason.actionId)
        .filter((actionId): actionId is SpeedDoctorActionId =>
          Boolean(actionId)
        )
        .concat("copy_report")
    )
  );
}
