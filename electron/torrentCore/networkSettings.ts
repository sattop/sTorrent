import type {
  NetworkCapabilities,
  NetworkSettings,
  ProxyType
} from "./contracts.js";

const MIN_PORT = 1;
const MAX_PORT = 65_535;
const MAX_LIMIT_BYTES_PER_SECOND = 10 * 1024 * 1024 * 1024;

export const DEFAULT_NETWORK_SETTINGS: NetworkSettings = {
  profileId: "standard",
  dht: true,
  pex: true,
  lsd: true,
  privateMode: false,
  incomingPort: null,
  upnp: true,
  natPmp: false,
  encryptionMode: "allowed",
  speedLimits: {
    downloadBytesPerSecond: null,
    uploadBytesPerSecond: null
  },
  connectionLimits: {
    maxConnections: 55,
    uploadSlots: 10
  },
  networkInterface: {
    name: null,
    bindOnly: false,
    killSwitch: false
  },
  proxy: {
    type: "none",
    host: "",
    port: null,
    username: "",
    passwordConfigured: false,
    applyToTrackers: true,
    applyToPeers: true
  }
};

export const NETWORK_CAPABILITIES: NetworkCapabilities = {
  globalSpeedLimits: true,
  connectionLimits: true,
  uploadSlots: true,
  dhtPexLsdAtStartup: true,
  incomingPortAtStartup: true,
  upnpNatPmpAtStartup: true,
  proxy: false,
  protocolEncryption: false,
  interfaceBinding: false,
  safeTrafficOnly: true
};

export interface WebTorrentClientNetworkOptions {
  dht: boolean;
  lsd: boolean;
  utPex: boolean;
  natPmp: boolean;
  natUpnp: boolean;
  maxConns: number;
  torrentPort: number;
  downloadLimit: number;
  uploadLimit: number;
}

export function normalizeNetworkSettings(
  input: Partial<NetworkSettings> | undefined,
  fallback: NetworkSettings = DEFAULT_NETWORK_SETTINGS
): NetworkSettings {
  const proxyType = normalizeProxyType(input?.proxy?.type ?? fallback.proxy.type);

  return {
    profileId: normalizeNetworkProfileId(input?.profileId ?? fallback.profileId),
    dht: toBoolean(input?.dht, fallback.dht),
    pex: toBoolean(input?.pex, fallback.pex),
    lsd: toBoolean(input?.lsd, fallback.lsd),
    privateMode: toBoolean(input?.privateMode, fallback.privateMode),
    incomingPort: normalizePort(input?.incomingPort ?? fallback.incomingPort),
    upnp: toBoolean(input?.upnp, fallback.upnp),
    natPmp: toBoolean(input?.natPmp, fallback.natPmp),
    encryptionMode: normalizeEncryptionMode(
      input?.encryptionMode ?? fallback.encryptionMode
    ),
    speedLimits: {
      downloadBytesPerSecond: normalizeLimit(
        input?.speedLimits?.downloadBytesPerSecond ??
          fallback.speedLimits.downloadBytesPerSecond
      ),
      uploadBytesPerSecond: normalizeLimit(
        input?.speedLimits?.uploadBytesPerSecond ??
          fallback.speedLimits.uploadBytesPerSecond
      )
    },
    connectionLimits: {
      maxConnections: normalizeConnectionLimit(
        input?.connectionLimits?.maxConnections ??
          fallback.connectionLimits.maxConnections
      ),
      uploadSlots: normalizeUploadSlots(
        input?.connectionLimits?.uploadSlots ?? fallback.connectionLimits.uploadSlots
      )
    },
    networkInterface: {
      name: normalizeOptionalString(
        input?.networkInterface?.name ?? fallback.networkInterface.name
      ),
      bindOnly: toBoolean(
        input?.networkInterface?.bindOnly,
        fallback.networkInterface.bindOnly
      ),
      killSwitch: toBoolean(
        input?.networkInterface?.killSwitch,
        fallback.networkInterface.killSwitch
      )
    },
    proxy: {
      type: proxyType,
      host: proxyType === "none"
        ? ""
        : normalizeString(input?.proxy?.host ?? fallback.proxy.host),
      port: proxyType === "none"
        ? null
        : normalizePort(input?.proxy?.port ?? fallback.proxy.port),
      username: proxyType === "none"
        ? ""
        : normalizeString(input?.proxy?.username ?? fallback.proxy.username),
      passwordConfigured:
        proxyType !== "none" &&
        toBoolean(
          input?.proxy?.passwordConfigured,
          fallback.proxy.passwordConfigured
        ),
      applyToTrackers: toBoolean(
        input?.proxy?.applyToTrackers,
        fallback.proxy.applyToTrackers
      ),
      applyToPeers: toBoolean(
        input?.proxy?.applyToPeers,
        fallback.proxy.applyToPeers
      )
    }
  };
}

export function buildWebTorrentClientOptions(
  settings: NetworkSettings
): WebTorrentClientNetworkOptions {
  return {
    dht: settings.dht,
    lsd: settings.lsd,
    utPex: settings.pex,
    natPmp: settings.natPmp,
    natUpnp: settings.upnp,
    maxConns: settings.connectionLimits.maxConnections ?? 55,
    torrentPort: settings.incomingPort ?? 0,
    downloadLimit: toWebTorrentLimit(settings.speedLimits.downloadBytesPerSecond),
    uploadLimit: toWebTorrentLimit(settings.speedLimits.uploadBytesPerSecond)
  };
}

export function startupNetworkSettingsChanged(
  current: NetworkSettings,
  active: NetworkSettings
) {
  return (
    current.dht !== active.dht ||
    current.pex !== active.pex ||
    current.lsd !== active.lsd ||
    current.incomingPort !== active.incomingPort ||
    current.upnp !== active.upnp ||
    current.natPmp !== active.natPmp
  );
}

export function applyNetworkProfile(
  settings: NetworkSettings,
  profileId: NetworkSettings["profileId"]
): NetworkSettings {
  const base = normalizeNetworkSettings({ ...settings, profileId }, settings);

  if (profileId === "standard") {
    return normalizeNetworkSettings({
      ...base,
      dht: true,
      pex: true,
      lsd: true,
      privateMode: false,
      encryptionMode: "allowed",
      speedLimits: {
        downloadBytesPerSecond: null,
        uploadBytesPerSecond: null
      },
      connectionLimits: {
        maxConnections: 55,
        uploadSlots: 10
      },
      proxy: {
        ...base.proxy,
        type: "none"
      }
    });
  }

  if (profileId === "private_tracker") {
    return normalizeNetworkSettings({
      ...base,
      dht: false,
      pex: false,
      lsd: false,
      privateMode: true
    });
  }

  if (profileId === "encryption") {
    return normalizeNetworkSettings({
      ...base,
      encryptionMode: "preferred"
    });
  }

  if (profileId === "proxy") {
    return normalizeNetworkSettings({
      ...base,
      proxy: {
        ...base.proxy,
        type: base.proxy.type === "none" ? "socks5" : base.proxy.type
      }
    });
  }

  if (profileId === "vpn_interface") {
    return normalizeNetworkSettings({
      ...base,
      networkInterface: {
        ...base.networkInterface,
        bindOnly: true,
        killSwitch: true
      }
    });
  }

  if (profileId === "traffic_saver") {
    return normalizeNetworkSettings({
      ...base,
      speedLimits: {
        downloadBytesPerSecond: 512 * 1024,
        uploadBytesPerSecond: 128 * 1024
      },
      connectionLimits: {
        maxConnections: 24,
        uploadSlots: 4
      }
    });
  }

  return base;
}

export function toWebTorrentLimit(value: number | null) {
  return value === null ? -1 : Math.round(value);
}

function normalizeNetworkProfileId(value: unknown): NetworkSettings["profileId"] {
  if (
    value === "standard" ||
    value === "private_tracker" ||
    value === "encryption" ||
    value === "proxy" ||
    value === "vpn_interface" ||
    value === "traffic_saver"
  ) {
    return value;
  }

  return DEFAULT_NETWORK_SETTINGS.profileId;
}

function normalizeEncryptionMode(value: unknown) {
  if (
    value === "disabled" ||
    value === "allowed" ||
    value === "preferred" ||
    value === "required"
  ) {
    return value;
  }

  return DEFAULT_NETWORK_SETTINGS.encryptionMode;
}

function normalizeProxyType(value: unknown): ProxyType {
  if (value === "socks5" || value === "http" || value === "none") {
    return value;
  }

  return DEFAULT_NETWORK_SETTINGS.proxy.type;
}

function normalizePort(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);

  if (!Number.isInteger(numeric) || numeric < MIN_PORT || numeric > MAX_PORT) {
    return null;
  }

  return numeric;
}

function normalizeLimit(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return Math.min(Math.round(numeric), MAX_LIMIT_BYTES_PER_SECOND);
}

function normalizeConnectionLimit(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);

  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }

  return Math.min(numeric, 10_000);
}

function normalizeUploadSlots(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);

  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }

  return Math.min(numeric, 100);
}

function normalizeOptionalString(value: unknown) {
  const normalized = normalizeString(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") {
    return value;
  }

  return fallback;
}
