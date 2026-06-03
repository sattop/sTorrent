import type {
  AutomationSettingsState,
  NetworkSettingsState,
  SpeedDoctorAnomaly,
  SpeedDoctorActionId,
  SpeedDoctorDiagnosis,
  SpeedDoctorDiskDetails,
  SpeedDoctorHistorySummary,
  SpeedDoctorPortCheckResult,
  SpeedDoctorProbeStatus,
  SpeedDoctorScanMode,
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
  metadata_pending: 250,
  external_port_closed: 260,
  speed_drop_sudden: 270,
  speed_below_baseline: 280,
  all_peers_choked: 290,
  dht_degraded: 300,
  isp_throttling_suspect: 310
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
  speedHistory?: SpeedDoctorHistorySummary;
  portCheck?: SpeedDoctorPortCheckResult;
  scanMode?: SpeedDoctorScanMode;
  durationMs?: number;
}

export function createTorrentSpeedDoctorReport(
  input: TorrentSpeedDoctorInput,
  now: Date = new Date()
): TorrentSpeedDoctorReport {
  const { torrent, network, automation } = input;
  const settings = network.activeSettings;
  const runtime = normalizeRuntime(input.runtime);
  const speedHistory = input.speedHistory ?? createEmptySpeedHistory(now);
  const portCheck = input.portCheck ?? createDefaultPortCheck(settings, runtime);
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

  if (portCheck.externallyReachable === false) {
    reasons.push({
      code: "external_port_closed",
      severity: "high",
      evidence: portCheck.port,
      actionId: settings.upnp || settings.natPmp ? "check_port" : "enable_upnp_nat_pmp"
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

  for (const anomaly of speedHistory.anomalies) {
    const reason = createReasonFromAnomaly(anomaly);

    if (reason) {
      reasons.push(reason);
    }
  }

  const rankedReasons = rankReasons(dedupeReasons(reasons));
  const diagnoses = createDiagnoses({
    reasons: rankedReasons,
    portCheck,
    speedHistory
  });

  const report: TorrentSpeedDoctorReport = {
    generatedAt: now.toISOString(),
    torrentId: torrent.id,
    scanMode: input.scanMode ?? "quick",
    durationMs: input.durationMs ?? 0,
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
        maxConnections: settings.connectionLimits.maxConnections,
        uploadSlots: settings.connectionLimits.uploadSlots,
        proxyType: network.settings.proxy.type,
        interfaceSelected: Boolean(network.settings.networkInterface.name),
        activeSpeedScheduleId: automation.activeSpeedScheduleId
      },
      runtime,
      disk,
      portCheck,
      speedHistory,
      anomalies: speedHistory.anomalies,
      diagnoses,
      exportText: ""
    },
    redacted: true
  };

  report.technicalDetails.exportText = createSpeedDoctorReportText(report);
  return report;
}

export function createSpeedDoctorReportText(report: TorrentSpeedDoctorReport) {
  const details = report.technicalDetails;
  const reasons =
    report.reasons.length > 0
      ? report.reasons
          .map((reason, index) => {
            const evidence =
              reason.evidence === undefined || reason.evidence === null
                ? ""
                : ` evidence=${String(reason.evidence)}`;
            return `${index + 1}. ${reason.code} (${reason.severity})${evidence}`;
          })
          .join("\n")
      : "No limiting reasons detected.";
  const anomalies =
    details.anomalies.length > 0
      ? details.anomalies
          .map(
            (anomaly, index) =>
              `${index + 1}. ${anomaly.type} (${anomaly.severity}) ${JSON.stringify(
                anomaly.context
              )}`
          )
          .join("\n")
      : "No speed anomalies detected.";
  const diagnoses =
    details.diagnoses.length > 0
      ? details.diagnoses
          .map(
            (diagnosis, index) =>
              `${index + 1}. ${diagnosis.title}: ${diagnosis.explanation}`
          )
          .join("\n")
      : "No diagnoses were generated.";

  return [
    "sTorent Speed Doctor Report",
    `Generated: ${report.generatedAt}`,
    `Torrent ID: ${report.torrentId}`,
    `Scan mode: ${report.scanMode}`,
    `Duration: ${report.durationMs} ms`,
    `Status: ${report.status}`,
    `Primary reason: ${report.primaryReason ?? "none"}`,
    "",
    "Current torrent metrics",
    `Download: ${Math.round(details.torrent.downloadSpeedBytes / 1024)} KB/s`,
    `Upload: ${Math.round(details.torrent.uploadSpeedBytes / 1024)} KB/s`,
    `Seeds: ${details.torrent.seeds}`,
    `Peers: ${details.torrent.peers}`,
    `Selected files: ${details.torrent.selectedFileCount}/${details.torrent.fileCount}`,
    "",
    "Port and NAT",
    `Port: ${details.portCheck.port ?? "auto"}`,
    `Local probe: ${details.portCheck.localBinding}`,
    `External reachability: ${
      details.portCheck.externallyReachable === null
        ? "unknown"
        : details.portCheck.externallyReachable
          ? "open"
          : "closed"
    }`,
    `UPnP: ${details.portCheck.upnpStatus}`,
    `NAT-PMP: ${details.portCheck.natPmpStatus}`,
    "",
    "Speed history",
    `Samples: ${details.speedHistory.sampleCount}`,
    `Peak last 24h: ${details.speedHistory.peakSpeedLast24hKb} KB/s`,
    `Best hours: ${details.speedHistory.bestHours.join(", ") || "unknown"}`,
    `ISP throttling suspected: ${
      details.speedHistory.ispThrottling.suspected ? "yes" : "no"
    }`,
    "",
    "Reasons",
    reasons,
    "",
    "Anomalies",
    anomalies,
    "",
    "Diagnoses",
    diagnoses,
    "",
    "This report is redacted: torrent names, save paths, tracker URLs, passkeys and hashes are omitted."
  ].join("\n");
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

function createEmptySpeedHistory(now: Date): SpeedDoctorHistorySummary {
  return {
    generatedAt: now.toISOString(),
    points24h: [],
    points7d: [],
    averageByHourKb: Array.from({ length: 24 }, () => 0),
    bestHours: [],
    peakSpeedLast24hKb: 0,
    sampleCount: 0,
    anomalies: [],
    ispThrottling: {
      suspected: false,
      confidence: 0,
      slowHours: [],
      fastHours: [],
      speedDropPercent: 0,
      sampleHours: 0
    }
  };
}

function createDefaultPortCheck(
  settings: NetworkSettingsState["activeSettings"],
  runtime: SpeedDoctorRuntimeInput
): SpeedDoctorPortCheckResult {
  return {
    port: settings.incomingPort,
    protocol: "tcp",
    localBinding: runtime.incomingPortProbe,
    externallyReachable: null,
    firewallBlocked: runtime.incomingPortProbe === "failed" ? true : null,
    upnpStatus: settings.upnp ? "enabled" : "disabled",
    natPmpStatus: settings.natPmp ? "enabled" : "disabled",
    notes: []
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

function createReasonFromAnomaly(
  anomaly: SpeedDoctorAnomaly
): SpeedDoctorReason | null {
  if (anomaly.type === "speed_drop_sudden") {
    return {
      code: "speed_drop_sudden",
      severity: anomaly.severity,
      evidence: getNumericContext(anomaly, "currentSpeedKb"),
      actionId: "copy_report"
    };
  }

  if (anomaly.type === "speed_below_baseline") {
    return {
      code: "speed_below_baseline",
      severity: anomaly.severity,
      evidence: getNumericContext(anomaly, "baselineKb"),
      actionId: "switch_download_profile"
    };
  }

  if (anomaly.type === "all_peers_choked") {
    return {
      code: "all_peers_choked",
      severity: anomaly.severity,
      evidence: getNumericContext(anomaly, "activePeers"),
      actionId: "show_trackers"
    };
  }

  if (anomaly.type === "dht_degraded") {
    return {
      code: "dht_degraded",
      severity: anomaly.severity,
      actionId: "toggle_dht_for_public_torrent"
    };
  }

  if (anomaly.type === "disk_bottleneck") {
    return {
      code: "disk_stalled",
      severity: anomaly.severity,
      evidence: getNumericContext(anomaly, "diskQueueDepth"),
      actionId: "open_folder"
    };
  }

  if (anomaly.type === "tracker_errors") {
    return {
      code: "tracker_error",
      severity: anomaly.severity,
      evidence: getNumericContext(anomaly, "trackerErrors"),
      actionId: "show_trackers"
    };
  }

  if (anomaly.type === "isp_throttling_suspect") {
    return {
      code: "isp_throttling_suspect",
      severity: anomaly.severity,
      evidence: getNumericContext(anomaly, "speedDropPercent"),
      actionId: "prefer_encryption"
    };
  }

  return null;
}

function getNumericContext(anomaly: SpeedDoctorAnomaly, key: string) {
  const value = anomaly.context[key];
  return typeof value === "number" ? value : undefined;
}

function createDiagnoses({
  reasons,
  portCheck,
  speedHistory
}: {
  reasons: SpeedDoctorReason[];
  portCheck: SpeedDoctorPortCheckResult;
  speedHistory: SpeedDoctorHistorySummary;
}): SpeedDoctorDiagnosis[] {
  const reasonCodes = new Set(reasons.map((reason) => reason.code));
  const anomalyTypes = new Set(speedHistory.anomalies.map((anomaly) => anomaly.type));
  const diagnoses: SpeedDoctorDiagnosis[] = [];

  if (
    portCheck.externallyReachable === false ||
    reasonCodes.has("incoming_port_closed") ||
    reasonCodes.has("incoming_port_unverified") ||
    reasonCodes.has("external_port_closed")
  ) {
    diagnoses.push({
      id: "port_closed",
      severity: "high",
      title: "Incoming connections are blocked",
      explanation:
        "The configured incoming port is not confirmed as reachable, which can reduce peer count and download speed.",
      actions: [
        {
          id: "enable_upnp_nat_pmp",
          label: "Enable UPnP/NAT-PMP",
          type: "safe",
          instruction:
            "sTorent can enable NAT traversal settings. Router support is still required."
        },
        {
          id: "check_port",
          label: "Run port diagnostics",
          type: "navigation"
        },
        {
          id: "check_port",
          label: "Manual router instructions",
          type: "manual",
          instruction:
            "If automatic mapping fails, open the configured TCP/UDP port on your router and allow sTorent through the firewall.",
          url: "https://portforward.com"
        }
      ]
    });
  }

  if (
    reasonCodes.has("global_download_limit") ||
    reasonCodes.has("active_speed_schedule") ||
    reasonCodes.has("traffic_saver_profile")
  ) {
    diagnoses.push({
      id: "speed_limit",
      severity: "medium",
      title: "A local rule is limiting speed",
      explanation:
        "A profile, global limit, or active schedule is applying a lower download ceiling.",
      actions: [
        {
          id: "remove_temporary_limit",
          label: "Remove download limit",
          type: "safe"
        },
        {
          id: "open_speed_schedule",
          label: "Open schedules",
          type: "navigation"
        }
      ]
    });
  }

  if (
    reasonCodes.has("no_connected_peers") ||
    reasonCodes.has("low_seed_count") ||
    reasonCodes.has("dead_torrent") ||
    reasonCodes.has("all_peers_choked")
  ) {
    diagnoses.push({
      id: "weak_swarm",
      severity: "medium",
      title: "The swarm is weak",
      explanation:
        "The torrent has too few reachable peers or seeds. Local settings may help, but the source itself may be slow.",
      actions: [
        {
          id: "show_trackers",
          label: "Show tracker status",
          type: "navigation"
        }
      ]
    });
  }

  if (reasonCodes.has("all_peers_choked")) {
    diagnoses.push({
      id: "all_peers_choked",
      severity: "medium",
      title: "Peers are connected but choked",
      explanation:
        "Connected peers are not currently sending pieces. This can be temporary, but upload limits or weak trackers can make it worse.",
      actions: [
        {
          id: "remove_temporary_limit",
          label: "Remove temporary limits",
          type: "safe"
        },
        {
          id: "show_trackers",
          label: "Show tracker status",
          type: "navigation"
        }
      ]
    });
  }

  if (
    reasonCodes.has("disk_space_low") ||
    reasonCodes.has("disk_stalled") ||
    reasonCodes.has("file_locked") ||
    anomalyTypes.has("disk_bottleneck")
  ) {
    diagnoses.push({
      id: "disk_bottleneck",
      severity: "high",
      title: "Disk writes need attention",
      explanation:
        "Low free space, a locked file, or a write stall can make a healthy swarm appear slow.",
      actions: [
        {
          id: "open_folder",
          label: "Open files",
          type: "navigation"
        },
        {
          id: "recheck_data",
          label: "Recheck data",
          type: "safe"
        }
      ]
    });
  }

  if (reasonCodes.has("tracker_error") || anomalyTypes.has("tracker_errors")) {
    diagnoses.push({
      id: "tracker_errors",
      severity: "medium",
      title: "Trackers need attention",
      explanation:
        "Tracker failures can reduce peer discovery. The report keeps tracker hosts and passkeys redacted.",
      actions: [
        {
          id: "show_trackers",
          label: "Show tracker status",
          type: "navigation"
        }
      ]
    });
  }

  if (
    reasonCodes.has("proxy_unsupported") ||
    reasonCodes.has("proxy_connection_failed")
  ) {
    diagnoses.push({
      id: "proxy_issue",
      severity: "medium",
      title: "Proxy settings are not healthy",
      explanation:
        "The configured proxy is unsupported by the engine or did not answer the connectivity probe.",
      actions: [
        {
          id: "check_proxy",
          label: "Open proxy settings",
          type: "navigation"
        }
      ]
    });
  }

  if (reasonCodes.has("dht_degraded") || anomalyTypes.has("dht_degraded")) {
    diagnoses.push({
      id: "dht_degraded",
      severity: "medium",
      title: "Peer discovery is degraded",
      explanation:
        "DHT/peer discovery looks unhealthy while tracker errors are present.",
      actions: [
        {
          id: "toggle_dht_for_public_torrent",
          label: "Enable DHT for public torrents",
          type: "safe"
        }
      ]
    });
  }

  if (speedHistory.ispThrottling.suspected) {
    diagnoses.push({
      id: "isp_throttling",
      severity: "medium",
      title: "ISP throttling is suspected",
      explanation:
        "Historical speed is much lower during peak hours than during faster off-peak hours.",
      actions: [
        {
          id: "prefer_encryption",
          label: "Prefer protocol encryption",
          type: "safe"
        },
        {
          id: "open_speed_schedule",
          label: "Schedule heavy downloads off-peak",
          type: "navigation"
        }
      ]
    });
  }

  return diagnoses;
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

function dedupeReasons(reasons: SpeedDoctorReason[]) {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = reason.code;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
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
        .concat(["copy_report", "save_report"])
    )
  );
}
