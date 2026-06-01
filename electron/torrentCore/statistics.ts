import type { TorrentStatisticsCounters } from "./contracts.js";

export const TORRENT_STATISTICS_VERSION = 1;

export interface PersistedTorrentStatistics {
  version: typeof TORRENT_STATISTICS_VERSION;
  allTime: TorrentStatisticsCounters;
}

export function createTorrentStatisticsCounters(
  startedAt = new Date().toISOString()
): TorrentStatisticsCounters {
  return {
    startedAt,
    updatedAt: startedAt,
    downloadedBytes: 0,
    uploadedBytes: 0,
    torrentsAdded: 0,
    torrentsCompleted: 0,
    torrentsRemoved: 0
  };
}

export function normalizeTorrentStatisticsCounters(
  value: Partial<TorrentStatisticsCounters> | null | undefined,
  fallback = createTorrentStatisticsCounters()
): TorrentStatisticsCounters {
  return {
    startedAt: normalizeIsoDate(value?.startedAt, fallback.startedAt),
    updatedAt: normalizeIsoDate(value?.updatedAt, fallback.updatedAt),
    downloadedBytes: toNonNegativeInteger(value?.downloadedBytes),
    uploadedBytes: toNonNegativeInteger(value?.uploadedBytes),
    torrentsAdded: toNonNegativeInteger(value?.torrentsAdded),
    torrentsCompleted: toNonNegativeInteger(value?.torrentsCompleted),
    torrentsRemoved: toNonNegativeInteger(value?.torrentsRemoved)
  };
}

export function accumulateTorrentTrafficSample(
  counters: TorrentStatisticsCounters,
  sample: {
    downloadSpeedBytes: number;
    uploadSpeedBytes: number;
    elapsedSeconds: number;
    sampledAt?: string;
  }
): TorrentStatisticsCounters {
  const elapsedSeconds = Math.max(0, sample.elapsedSeconds);
  const downloadedBytes = Math.round(
    toNonNegativeNumber(sample.downloadSpeedBytes) * elapsedSeconds
  );
  const uploadedBytes = Math.round(
    toNonNegativeNumber(sample.uploadSpeedBytes) * elapsedSeconds
  );

  return {
    ...counters,
    updatedAt: normalizeIsoDate(sample.sampledAt, new Date().toISOString()),
    downloadedBytes: counters.downloadedBytes + downloadedBytes,
    uploadedBytes: counters.uploadedBytes + uploadedBytes
  };
}

export function normalizePersistedTorrentStatistics(
  value: Partial<PersistedTorrentStatistics> | null | undefined
): PersistedTorrentStatistics {
  return {
    version: TORRENT_STATISTICS_VERSION,
    allTime: normalizeTorrentStatisticsCounters(value?.allTime)
  };
}

function normalizeIsoDate(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  return Number.isNaN(Date.parse(value)) ? fallback : value;
}

function toNonNegativeInteger(value: unknown) {
  return Math.max(0, Math.round(toNonNegativeNumber(value)));
}

function toNonNegativeNumber(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);

  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}
