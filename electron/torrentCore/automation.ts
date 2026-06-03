import {
  DOWNLOAD_PROFILE_IDS,
  type AutomationCapabilities,
  type AutomationSettings,
  type FavoriteFolderSettings,
  type QueueSettings,
  type RssAutoLoadRuleSettings,
  type SeedingRuleSettings,
  type SpeedLimitScheduleSettings,
  type WatchFolderSettings
} from "./contracts.js";
import { normalizeTorrentCategory, normalizeTorrentTags } from "./labels.js";

const MAX_AUTOMATION_ITEMS = 50;
const MAX_SEEN_RSS_ITEMS = 500;
const MAX_LIMIT_BYTES_PER_SECOND = 10 * 1024 * 1024 * 1024;
const MINUTE_MAX = 24 * 60 - 1;
const MAX_ACTIVE_QUEUE_ITEMS = 1_000;
const MAX_UPLOAD_SLOTS = 100;

export const DEFAULT_QUEUE_SETTINGS: QueueSettings = {
  enabled: true,
  maxActiveDownloads: 3,
  maxActiveSeeds: 5
};

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  watchFolders: [],
  favoriteFolders: [],
  seedingRules: [],
  rssRules: [],
  speedSchedules: [],
  queue: DEFAULT_QUEUE_SETTINGS,
  hooksEnabled: false
};

export const AUTOMATION_CAPABILITIES: AutomationCapabilities = {
  watchFolders: true,
  favoriteFolders: true,
  seedingRules: true,
  queue: true,
  rssDuplicatePrevention: true,
  speedLimitSchedules: true,
  hooks: false,
  safeDataRemovalOnly: true
};

export interface RssItemCandidate {
  id?: string;
  title: string;
  magnetUri?: string;
  torrentUrl?: string;
}

export function normalizeAutomationSettings(
  input: Partial<AutomationSettings> | undefined,
  fallback: AutomationSettings = DEFAULT_AUTOMATION_SETTINGS
): AutomationSettings {
  return {
    watchFolders: normalizeList(
      input?.watchFolders,
      fallback.watchFolders,
      normalizeWatchFolder
    ),
    favoriteFolders: normalizeList(
      input?.favoriteFolders,
      fallback.favoriteFolders,
      normalizeFavoriteFolder
    ),
    seedingRules: normalizeList(
      input?.seedingRules,
      fallback.seedingRules,
      normalizeSeedingRule
    ),
    rssRules: normalizeList(input?.rssRules, fallback.rssRules, normalizeRssRule),
    speedSchedules: normalizeList(
      input?.speedSchedules,
      fallback.speedSchedules,
      normalizeSpeedSchedule
    ),
    queue: normalizeQueueSettings(input?.queue, fallback.queue),
    hooksEnabled: false
  };
}

export function normalizeQueueSettings(
  input: Partial<QueueSettings> | undefined,
  fallback: QueueSettings = DEFAULT_QUEUE_SETTINGS
): QueueSettings {
  return {
    enabled: toBoolean(input?.enabled, fallback.enabled),
    maxActiveDownloads: normalizeQueueLimit(
      input?.maxActiveDownloads ?? fallback.maxActiveDownloads
    ),
    maxActiveSeeds: normalizeQueueLimit(
      input?.maxActiveSeeds ?? fallback.maxActiveSeeds
    )
  };
}

export function resolveActiveSpeedSchedule(
  settings: AutomationSettings,
  date = new Date()
) {
  return settings.speedSchedules.find((schedule) =>
    isSpeedScheduleActive(schedule, date)
  ) ?? null;
}

export function evaluateRssRuleCandidates(
  rule: RssAutoLoadRuleSettings,
  candidates: RssItemCandidate[]
) {
  const seen = new Set(rule.seenItemIds);
  const accepted: RssItemCandidate[] = [];

  for (const candidate of candidates) {
    const key = getRssCandidateKey(candidate);

    if (!key || seen.has(key) || !matchesRssRule(rule, candidate)) {
      continue;
    }

    seen.add(key);
    accepted.push(candidate);
  }

  return {
    accepted,
    rule: {
      ...rule,
      seenItemIds: [...seen].slice(-MAX_SEEN_RSS_ITEMS)
    }
  };
}

function normalizeList<T>(
  input: T[] | undefined,
  fallback: T[],
  normalize: (item: T, index: number) => T | null
) {
  const source = Array.isArray(input) ? input : fallback;
  return source
    .slice(0, MAX_AUTOMATION_ITEMS)
    .map((item, index) => normalize(item, index))
    .filter((item): item is T => item !== null);
}

function normalizeWatchFolder(
  folder: WatchFolderSettings,
  index: number
): WatchFolderSettings | null {
  const folderPath = normalizeString(folder.path);

  if (!folderPath) {
    return null;
  }

  return {
    id: normalizeId(folder.id, "watch", index),
    path: folderPath,
    enabled: toBoolean(folder.enabled, true),
    profileId: normalizeDownloadProfile(folder.profileId),
    startPaused: toBoolean(folder.startPaused, false),
    category: normalizeTorrentCategory(folder.category),
    tags: normalizeTorrentTags(folder.tags)
  };
}

function normalizeFavoriteFolder(
  folder: FavoriteFolderSettings,
  index: number
): FavoriteFolderSettings | null {
  const folderPath = normalizeString(folder.path);

  if (!folderPath) {
    return null;
  }

  return {
    id: normalizeId(folder.id, "favorite", index),
    name: normalizeString(folder.name) || folderPath,
    path: folderPath,
    category: normalizeTorrentCategory(folder.category),
    tags: normalizeTorrentTags(folder.tags)
  };
}

function normalizeSeedingRule(
  rule: SeedingRuleSettings,
  index: number
): SeedingRuleSettings | null {
  const ratioLimit = normalizeRatio(rule.ratioLimit);
  const minutesAfterComplete = normalizePositiveInteger(
    rule.minutesAfterComplete
  );

  if (ratioLimit === null && minutesAfterComplete === null) {
    return null;
  }

  return {
    id: normalizeId(rule.id, "seed", index),
    name: normalizeString(rule.name) || `Seed rule ${index + 1}`,
    enabled: toBoolean(rule.enabled, true),
    ratioLimit,
    minutesAfterComplete,
    action: normalizeSeedingRuleAction(rule.action),
    uploadSlotLimit: normalizeUploadSlotLimit(rule.uploadSlotLimit),
    requireConfirmationBeforeDataRemoval: true
  };
}

function normalizeRssRule(
  rule: RssAutoLoadRuleSettings,
  index: number
): RssAutoLoadRuleSettings | null {
  const feedUrl = normalizeString(rule.feedUrl);

  if (!isSafeFeedUrl(feedUrl)) {
    return null;
  }

  return {
    id: normalizeId(rule.id, "rss", index),
    name: normalizeString(rule.name) || feedUrl,
    enabled: toBoolean(rule.enabled, true),
    feedUrl,
    match: normalizeString(rule.match),
    exclude: normalizeString(rule.exclude),
    profileId: normalizeDownloadProfile(rule.profileId),
    category: normalizeTorrentCategory(rule.category),
    tags: normalizeTorrentTags(rule.tags),
    seenItemIds: normalizeSeenItemIds(rule.seenItemIds)
  };
}

function normalizeSpeedSchedule(
  schedule: SpeedLimitScheduleSettings,
  index: number
): SpeedLimitScheduleSettings | null {
  const daysOfWeek = normalizeDaysOfWeek(schedule.daysOfWeek);

  if (daysOfWeek.length === 0) {
    return null;
  }

  return {
    id: normalizeId(schedule.id, "speed", index),
    name: normalizeString(schedule.name) || `Speed schedule ${index + 1}`,
    enabled: toBoolean(schedule.enabled, true),
    daysOfWeek,
    startMinuteOfDay: normalizeMinute(schedule.startMinuteOfDay, 0),
    endMinuteOfDay: normalizeMinute(schedule.endMinuteOfDay, MINUTE_MAX),
    downloadBytesPerSecond: normalizeLimit(schedule.downloadBytesPerSecond),
    uploadBytesPerSecond: normalizeLimit(schedule.uploadBytesPerSecond)
  };
}

function isSpeedScheduleActive(
  schedule: SpeedLimitScheduleSettings,
  date: Date
) {
  if (!schedule.enabled) {
    return false;
  }

  const day = date.getDay();
  const previousDay = (day + 6) % 7;
  const minute = date.getHours() * 60 + date.getMinutes();

  if (schedule.startMinuteOfDay <= schedule.endMinuteOfDay) {
    return (
      schedule.daysOfWeek.includes(day) &&
      minute >= schedule.startMinuteOfDay &&
      minute < schedule.endMinuteOfDay
    );
  }

  return (
    (schedule.daysOfWeek.includes(day) && minute >= schedule.startMinuteOfDay) ||
    (schedule.daysOfWeek.includes(previousDay) &&
      minute < schedule.endMinuteOfDay)
  );
}

function matchesRssRule(
  rule: RssAutoLoadRuleSettings,
  candidate: RssItemCandidate
) {
  if (!rule.enabled) {
    return false;
  }

  const title = candidate.title.toLocaleLowerCase();
  const match = rule.match.toLocaleLowerCase();
  const exclude = rule.exclude.toLocaleLowerCase();

  return (
    (match.length === 0 || title.includes(match)) &&
    (exclude.length === 0 || !title.includes(exclude))
  );
}

function getRssCandidateKey(candidate: RssItemCandidate) {
  return normalizeString(
    candidate.id || candidate.magnetUri || candidate.torrentUrl || candidate.title
  );
}

function normalizeDownloadProfile(value: unknown) {
  return DOWNLOAD_PROFILE_IDS.includes(value as (typeof DOWNLOAD_PROFILE_IDS)[number])
    ? (value as (typeof DOWNLOAD_PROFILE_IDS)[number])
    : "manual";
}

function normalizeDaysOfWeek(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6)
    )
  ).sort((left, right) => left - right);
}

function normalizeSeenItemIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeString(item))
    .filter(Boolean)
    .slice(-MAX_SEEN_RSS_ITEMS);
}

function normalizeId(value: unknown, prefix: string, index: number) {
  const normalized = normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || `${prefix}-${index + 1}`;
}

function normalizeMinute(value: unknown, fallback: number) {
  const numeric = Number(value);

  if (!Number.isInteger(numeric) || numeric < 0 || numeric > MINUTE_MAX) {
    return fallback;
  }

  return numeric;
}

function normalizePositiveInteger(value: unknown) {
  const numeric = Number(value);

  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }

  return Math.min(numeric, 1_000_000);
}

function normalizeQueueLimit(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);

  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }

  return Math.min(numeric, MAX_ACTIVE_QUEUE_ITEMS);
}

function normalizeUploadSlotLimit(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);

  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }

  return Math.min(numeric, MAX_UPLOAD_SLOTS);
}

function normalizeSeedingRuleAction(value: unknown): SeedingRuleSettings["action"] {
  if (value === "remove" || value === "limit") {
    return value;
  }

  return "pause";
}

function normalizeRatio(value: unknown) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return Math.min(Math.round(numeric * 100) / 100, 1_000);
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

function isSafeFeedUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
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
