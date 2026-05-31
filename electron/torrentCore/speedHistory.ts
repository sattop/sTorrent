import { promises as fs } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  SpeedDoctorAnomaly,
  SpeedDoctorChartPoint,
  SpeedDoctorHistorySummary,
  SpeedDoctorReasonSeverity,
  SpeedDoctorSpeedMetric,
  SpeedDoctorThrottlingAnalysis
} from "./contracts.js";

const HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;
const FIVE_MINUTES_MS = 5 * 60 * 1_000;
const EMPTY_THROTTLING: SpeedDoctorThrottlingAnalysis = {
  suspected: false,
  confidence: 0,
  slowHours: [],
  fastHours: [],
  speedDropPercent: 0,
  sampleHours: 0
};

interface PersistedSpeedHistory {
  version: 1;
  metrics: SpeedDoctorSpeedMetric[];
}

interface SpeedHistoryRow {
  recorded_at: number;
  download_speed_kb: number;
  upload_speed_kb: number;
  active_torrents: number;
  active_peers: number;
  connected_seeds: number;
  tracker_errors: number;
  disk_write_speed_kb: number;
  disk_queue_depth: number;
  dht_nodes: number;
}

export class SpeedHistoryStore {
  private db: DatabaseSync | null = null;
  private dbPath: string | null = null;

  async restore(filePath: string) {
    this.dbPath = filePath;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    this.db?.close();
    this.db = new DatabaseSync(filePath);
    this.initializeSchema();
    await this.migrateLegacyJsonIfNeeded(filePath);
    this.prune(new Date());
  }

  async persist(filePath: string) {
    if (!this.db) {
      await this.restore(filePath);
      return;
    }

    this.prune(new Date());
    this.db.exec("PRAGMA optimize");
  }

  record(metric: SpeedDoctorSpeedMetric) {
    const normalized = normalizeMetric(metric);

    if (!normalized || !this.db) {
      return;
    }

    const recordedAt = Date.parse(normalized.timestamp);
    this.db
      .prepare(
        `INSERT INTO speed_history (
          recorded_at,
          hour_of_day,
          download_speed_kb,
          upload_speed_kb,
          active_torrents,
          active_peers,
          connected_seeds,
          tracker_errors,
          disk_write_speed_kb,
          disk_queue_depth,
          dht_nodes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        recordedAt,
        new Date(recordedAt).getHours(),
        normalized.downloadSpeedKb,
        normalized.uploadSpeedKb,
        normalized.activeTorrents,
        normalized.activePeers,
        normalized.connectedSeeds,
        normalized.trackerErrors,
        normalized.diskWriteSpeedKb,
        normalized.diskQueueDepth,
        normalized.dhtNodes
      );
    this.prune(new Date(recordedAt));
  }

  getSummary(now: Date = new Date()) {
    return createSpeedHistorySummary(this.getMetrics(), now);
  }

  getMetrics() {
    if (!this.db) {
      return [];
    }

    const minTime = Date.now() - HISTORY_WINDOW_MS;
    return (
      this.db
        .prepare(
          `SELECT
            recorded_at,
            download_speed_kb,
            upload_speed_kb,
            active_torrents,
            active_peers,
            connected_seeds,
            tracker_errors,
            disk_write_speed_kb,
            disk_queue_depth,
            dht_nodes
          FROM speed_history
          WHERE recorded_at >= ?
          ORDER BY recorded_at ASC`
        )
        .all(minTime) as unknown as SpeedHistoryRow[]
    ).map(rowToMetric);
  }

  close() {
    this.db?.close();
    this.db = null;
    this.dbPath = null;
  }

  private initializeSchema() {
    this.db?.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS speed_history (
        id INTEGER PRIMARY KEY,
        recorded_at INTEGER NOT NULL,
        hour_of_day INTEGER NOT NULL,
        download_speed_kb REAL NOT NULL,
        upload_speed_kb REAL NOT NULL,
        active_torrents INTEGER NOT NULL,
        active_peers INTEGER NOT NULL,
        connected_seeds INTEGER NOT NULL,
        tracker_errors INTEGER NOT NULL,
        disk_write_speed_kb REAL NOT NULL,
        disk_queue_depth INTEGER NOT NULL,
        dht_nodes INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_speed_history_recorded_at
        ON speed_history(recorded_at);
      CREATE INDEX IF NOT EXISTS idx_speed_history_hour
        ON speed_history(hour_of_day);
    `);
  }

  private async migrateLegacyJsonIfNeeded(filePath: string) {
    if (!this.db || this.hasRows()) {
      return;
    }

    const legacyPath = path.join(path.dirname(filePath), "speed-history.json");
    let persisted: PersistedSpeedHistory;

    try {
      persisted = JSON.parse(await fs.readFile(legacyPath, "utf8")) as PersistedSpeedHistory;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }

      throw error;
    }

    if (persisted.version !== 1 || !Array.isArray(persisted.metrics)) {
      return;
    }

    for (const metric of persisted.metrics) {
      this.record(metric);
    }
  }

  private hasRows() {
    const row = this.db
      ?.prepare("SELECT COUNT(*) AS count FROM speed_history")
      .get() as { count?: number } | undefined;
    return Number(row?.count ?? 0) > 0;
  }

  private prune(now: Date) {
    if (!this.db) {
      return;
    }

    this.db
      .prepare("DELETE FROM speed_history WHERE recorded_at < ?")
      .run(now.getTime() - HISTORY_WINDOW_MS);
  }
}

export function createSpeedHistorySummary(
  metrics: SpeedDoctorSpeedMetric[],
  now: Date = new Date()
): SpeedDoctorHistorySummary {
  const normalized = metrics
    .map(normalizeMetric)
    .filter((metric): metric is SpeedDoctorSpeedMetric => Boolean(metric))
    .filter((metric) => {
      const time = Date.parse(metric.timestamp);
      return Number.isFinite(time) && now.getTime() - time <= HISTORY_WINDOW_MS;
    })
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const current = normalized[normalized.length - 1] ?? null;
  const throttling = detectISPThrottling(normalized);
  const anomalies = current ? detectSpeedAnomalies(normalized, current, throttling, now) : [];
  const averageByHourKb = createAverageByHour(normalized);

  return {
    generatedAt: now.toISOString(),
    points24h: createBucketedPoints(normalized, now, 24, HOUR_MS),
    points7d: createBucketedPoints(normalized, now, 7 * 24, HOUR_MS),
    averageByHourKb,
    bestHours: getBestHours(averageByHourKb),
    peakSpeedLast24hKb: getPeakSpeedLast24h(normalized, now),
    sampleCount: normalized.length,
    anomalies,
    ispThrottling: throttling
  };
}

export function detectSpeedAnomalies(
  history: SpeedDoctorSpeedMetric[],
  current: SpeedDoctorSpeedMetric,
  throttling: SpeedDoctorThrottlingAnalysis = detectISPThrottling(history),
  now: Date = new Date()
): SpeedDoctorAnomaly[] {
  const anomalies: SpeedDoctorAnomaly[] = [];
  const currentSpeed = current.downloadSpeedKb;
  const currentTime = Date.parse(current.timestamp);
  const recent = history.filter((metric) => {
    const time = Date.parse(metric.timestamp);
    return Number.isFinite(time) && currentTime - time <= FIVE_MINUTES_MS;
  });
  const previous = recent.slice(0, -1);
  const previousAverage = average(previous.map((metric) => metric.downloadSpeedKb));
  const hourlyAverage = getHourlyAverage(history, new Date(current.timestamp).getHours());

  if (previous.length >= 3 && previousAverage >= 512 && currentSpeed < previousAverage * 0.3) {
    anomalies.push(
      createAnomaly("speed_drop_sudden", "high", now, {
        previousAverageKb: round(previousAverage),
        currentSpeedKb: round(currentSpeed)
      })
    );
  }

  if (hourlyAverage >= 512 && currentSpeed < hourlyAverage * 0.4) {
    anomalies.push(
      createAnomaly("speed_below_baseline", "medium", now, {
        baselineKb: round(hourlyAverage),
        currentSpeedKb: round(currentSpeed)
      })
    );
  }

  if (current.activePeers > 0 && current.connectedSeeds === 0 && currentSpeed < 1) {
    anomalies.push(
      createAnomaly("all_peers_choked", "medium", now, {
        activePeers: current.activePeers
      })
    );
  }

  if (current.diskQueueDepth > 0 || current.diskWriteSpeedKb < currentSpeed * 0.2) {
    anomalies.push(
      createAnomaly("disk_bottleneck", "medium", now, {
        diskWriteSpeedKb: round(current.diskWriteSpeedKb),
        currentSpeedKb: round(currentSpeed),
        diskQueueDepth: current.diskQueueDepth
      })
    );
  }

  if (current.trackerErrors > 0) {
    anomalies.push(
      createAnomaly("tracker_errors", "medium", now, {
        trackerErrors: current.trackerErrors
      })
    );
  }

  if (current.dhtNodes === 0 && current.activePeers === 0 && current.trackerErrors > 0) {
    anomalies.push(
      createAnomaly("dht_degraded", "medium", now, {
        dhtNodes: current.dhtNodes,
        trackerErrors: current.trackerErrors
      })
    );
  }

  if (throttling.suspected) {
    anomalies.push(
      createAnomaly("isp_throttling_suspect", "medium", now, {
        confidence: throttling.confidence,
        speedDropPercent: throttling.speedDropPercent,
        slowHours: throttling.slowHours.join(",")
      })
    );
  }

  return anomalies;
}

export function detectISPThrottling(
  history: SpeedDoctorSpeedMetric[]
): SpeedDoctorThrottlingAnalysis {
  const averageByHour = createAverageByHour(history);
  const hourSamples = createHourSamples(history);
  const populatedHours = hourSamples.filter((samples) => samples.length > 0).length;

  if (populatedHours < 8) {
    return { ...EMPTY_THROTTLING, sampleHours: populatedHours };
  }

  const fastCandidateHours = [0, 1, 2, 3, 4, 5, 6];
  const slowCandidateHours = [18, 19, 20, 21, 22, 23];
  const fastAverage = average(
    fastCandidateHours
      .map((hour) => averageByHour[hour])
      .filter((value) => value > 0)
  );
  const slowAverage = average(
    slowCandidateHours
      .map((hour) => averageByHour[hour])
      .filter((value) => value > 0)
  );

  if (fastAverage < 256 || slowAverage <= 0) {
    return { ...EMPTY_THROTTLING, sampleHours: populatedHours };
  }

  const speedDropPercent = Math.max(
    0,
    Math.round(((fastAverage - slowAverage) / fastAverage) * 100)
  );
  const slowHours = slowCandidateHours.filter(
    (hour) => averageByHour[hour] > 0 && averageByHour[hour] < fastAverage * 0.55
  );
  const fastHours = fastCandidateHours.filter(
    (hour) => averageByHour[hour] >= fastAverage * 0.8
  );
  const suspected = speedDropPercent >= 45 && slowHours.length >= 2;
  const sampleConfidence = Math.min(1, populatedHours / 72);
  const confidence = suspected
    ? round(Math.min(0.95, 0.35 + sampleConfidence * 0.35 + speedDropPercent / 300), 2)
    : 0;

  return {
    suspected,
    confidence,
    slowHours,
    fastHours,
    speedDropPercent,
    sampleHours: populatedHours
  };
}

function createBucketedPoints(
  metrics: SpeedDoctorSpeedMetric[],
  now: Date,
  bucketCount: number,
  bucketMs: number
): SpeedDoctorChartPoint[] {
  const end = floorToBucket(now.getTime(), bucketMs) + bucketMs;
  const start = end - bucketCount * bucketMs;
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const time = start + index * bucketMs;
    return {
      timestamp: time,
      download: [] as number[],
      upload: [] as number[],
      peers: [] as number[]
    };
  });

  for (const metric of metrics) {
    const time = Date.parse(metric.timestamp);

    if (!Number.isFinite(time) || time < start || time >= end) {
      continue;
    }

    const index = Math.floor((time - start) / bucketMs);
    const bucket = buckets[index];
    bucket.download.push(metric.downloadSpeedKb);
    bucket.upload.push(metric.uploadSpeedKb);
    bucket.peers.push(metric.activePeers);
  }

  return buckets.map((bucket) => ({
    hour: new Date(bucket.timestamp).toISOString(),
    downloadKb: round(average(bucket.download)),
    uploadKb: round(average(bucket.upload)),
    peers: Math.round(average(bucket.peers))
  }));
}

function createAverageByHour(metrics: SpeedDoctorSpeedMetric[]) {
  const samples = createHourSamples(metrics);
  return samples.map((values) => round(average(values)));
}

function createHourSamples(metrics: SpeedDoctorSpeedMetric[]) {
  const samples = Array.from({ length: 24 }, () => [] as number[]);

  for (const metric of metrics) {
    const time = Date.parse(metric.timestamp);

    if (!Number.isFinite(time)) {
      continue;
    }

    samples[new Date(time).getHours()].push(metric.downloadSpeedKb);
  }

  return samples;
}

function getBestHours(averageByHourKb: number[]) {
  return averageByHourKb
    .map((value, hour) => ({ hour, value }))
    .filter((item) => item.value > 0)
    .sort((left, right) => right.value - left.value)
    .slice(0, 3)
    .map((item) => item.hour);
}

function getPeakSpeedLast24h(metrics: SpeedDoctorSpeedMetric[], now: Date) {
  const minTime = now.getTime() - 24 * HOUR_MS;
  return round(
    Math.max(
      0,
      ...metrics
        .filter((metric) => Date.parse(metric.timestamp) >= minTime)
        .map((metric) => metric.downloadSpeedKb)
    )
  );
}

function getHourlyAverage(history: SpeedDoctorSpeedMetric[], hour: number) {
  return average(
    history
      .filter((metric) => new Date(metric.timestamp).getHours() === hour)
      .map((metric) => metric.downloadSpeedKb)
  );
}

function createAnomaly(
  type: SpeedDoctorAnomaly["type"],
  severity: SpeedDoctorReasonSeverity,
  now: Date,
  context: SpeedDoctorAnomaly["context"]
): SpeedDoctorAnomaly {
  return {
    type,
    severity,
    detectedAt: now.toISOString(),
    context
  };
}

function normalizeMetric(
  metric: Partial<SpeedDoctorSpeedMetric>
): SpeedDoctorSpeedMetric | null {
  const time = Date.parse(String(metric.timestamp ?? ""));

  if (!Number.isFinite(time)) {
    return null;
  }

  return {
    timestamp: new Date(time).toISOString(),
    downloadSpeedKb: toNumber(metric.downloadSpeedKb),
    uploadSpeedKb: toNumber(metric.uploadSpeedKb),
    activeTorrents: toInteger(metric.activeTorrents),
    activePeers: toInteger(metric.activePeers),
    connectedSeeds: toInteger(metric.connectedSeeds),
    trackerErrors: toInteger(metric.trackerErrors),
    diskWriteSpeedKb: toNumber(metric.diskWriteSpeedKb),
    diskQueueDepth: toInteger(metric.diskQueueDepth),
    dhtNodes: toInteger(metric.dhtNodes)
  };
}

function rowToMetric(row: SpeedHistoryRow): SpeedDoctorSpeedMetric {
  return {
    timestamp: new Date(row.recorded_at).toISOString(),
    downloadSpeedKb: row.download_speed_kb,
    uploadSpeedKb: row.upload_speed_kb,
    activeTorrents: row.active_torrents,
    activePeers: row.active_peers,
    connectedSeeds: row.connected_seeds,
    trackerErrors: row.tracker_errors,
    diskWriteSpeedKb: row.disk_write_speed_kb,
    diskQueueDepth: row.disk_queue_depth,
    dhtNodes: row.dht_nodes
  };
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function floorToBucket(value: number, bucketMs: number) {
  return Math.floor(value / bucketMs) * bucketMs;
}

function round(value: number, precision = 1) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function toInteger(value: unknown) {
  return Math.round(toNumber(value));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
