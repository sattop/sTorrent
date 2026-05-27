import type {
  NetworkCapabilities,
  NetworkDiagnosticCheck,
  NetworkDiagnosticsReport,
  NetworkInterfaceInfo,
  NetworkSettings,
  TorrentSummary
} from "./contracts.js";
import { startupNetworkSettingsChanged } from "./networkSettings.js";

export interface NetworkDiagnosticsInput {
  settings: NetworkSettings;
  activeSettings: NetworkSettings;
  capabilities: NetworkCapabilities;
  availableInterfaces: NetworkInterfaceInfo[];
  torrents: TorrentSummary[];
}

export function createNetworkDiagnosticsReport(
  input: NetworkDiagnosticsInput,
  now: Date = new Date()
): NetworkDiagnosticsReport {
  const checks: NetworkDiagnosticCheck[] = [
    {
      code: "safe_traffic_policy",
      status: "ok",
      value: input.capabilities.safeTrafficOnly
    }
  ];

  if (startupNetworkSettingsChanged(input.settings, input.activeSettings)) {
    checks.push({
      code: "restart_required",
      status: "warning",
      value: true
    });
  }

  checks.push(
    createLimitCheck(
      "global_download_limit",
      input.settings.speedLimits.downloadBytesPerSecond
    ),
    createLimitCheck(
      "global_upload_limit",
      input.settings.speedLimits.uploadBytesPerSecond
    ),
    {
      code: "incoming_port",
      status: input.activeSettings.incomingPort === null ? "info" : "ok",
      value: input.activeSettings.incomingPort
    },
    {
      code: "peer_discovery",
      status:
        input.activeSettings.dht && input.activeSettings.pex && input.activeSettings.lsd
          ? "ok"
          : "info",
      value: getDiscoveryValue(input.activeSettings)
    }
  );

  const privateTorrents = input.torrents.filter((torrent) => torrent.private);
  if (privateTorrents.length > 0) {
    checks.push({
      code: "private_torrent_policy",
      status: input.activeSettings.lsd ? "warning" : "ok",
      value: privateTorrents.length
    });
  }

  if (input.settings.proxy.type !== "none" && !input.capabilities.proxy) {
    checks.push({
      code: "proxy_unsupported",
      status: "unsupported",
      value: input.settings.proxy.type
    });
  }

  if (
    (input.settings.networkInterface.name ||
      input.settings.networkInterface.bindOnly ||
      input.settings.networkInterface.killSwitch) &&
    !input.capabilities.interfaceBinding
  ) {
    checks.push({
      code: "interface_binding_unsupported",
      status: "unsupported",
      value: input.settings.networkInterface.name
    });
  } else if (input.settings.networkInterface.name) {
    const selectedInterface = input.availableInterfaces.some(
      (networkInterface) =>
        networkInterface.name === input.settings.networkInterface.name
    );
    checks.push({
      code: "interface_binding_unsupported",
      status: selectedInterface ? "ok" : "warning",
      value: input.settings.networkInterface.name
    });
  }

  if (
    input.settings.encryptionMode !== "allowed" &&
    !input.capabilities.protocolEncryption
  ) {
    checks.push({
      code: "encryption_unsupported",
      status: "unsupported",
      value: input.settings.encryptionMode
    });
  }

  return {
    generatedAt: now.toISOString(),
    summary: getSummaryStatus(checks),
    checks,
    redacted: true
  };
}

function createLimitCheck(
  code: "global_download_limit" | "global_upload_limit",
  value: number | null
): NetworkDiagnosticCheck {
  return {
    code,
    status: value === null ? "ok" : "warning",
    value
  };
}

function getDiscoveryValue(settings: NetworkSettings) {
  const enabled = [
    settings.dht ? "DHT" : null,
    settings.pex ? "PEX" : null,
    settings.lsd ? "LSD" : null
  ].filter(Boolean);

  return enabled.length > 0 ? enabled.join(", ") : "off";
}

function getSummaryStatus(checks: NetworkDiagnosticCheck[]) {
  if (checks.some((check) => check.status === "warning")) {
    return "warning";
  }

  if (checks.some((check) => check.status === "unsupported")) {
    return "unsupported";
  }

  if (checks.some((check) => check.status === "info")) {
    return "info";
  }

  return "ok";
}
