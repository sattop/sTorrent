import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DOWNLOAD_PROFILE_IDS,
  type AssistantProfileUsageRecord,
  type AssistantState,
  type AssistantWarningDismissal,
  type AssistantWarningDismissRequest,
  type DownloadProfileId
} from "./contracts.js";

interface PersistedProfileUsage {
  version: 1;
  records: AssistantProfileUsageRecord[];
}

interface PersistedWarningDismissals {
  version: 1;
  records: AssistantWarningDismissal[];
}

export interface AssistantStateStoreOptions {
  profileUsageFilePath: string;
  warningDismissedFilePath: string;
}

const MAX_PROFILE_USAGE_RECORDS = 500;
const MAX_WARNING_DISMISSALS = 1_000;

export class AssistantStateStore {
  private profileUsage: AssistantProfileUsageRecord[] = [];
  private dismissedWarnings: AssistantWarningDismissal[] = [];

  constructor(private readonly options: AssistantStateStoreOptions) {}

  async restore() {
    const [profileUsage, dismissedWarnings] = await Promise.all([
      readJson<PersistedProfileUsage>(this.options.profileUsageFilePath),
      readJson<PersistedWarningDismissals>(this.options.warningDismissedFilePath)
    ]);

    this.profileUsage =
      profileUsage?.version === 1 && Array.isArray(profileUsage.records)
        ? profileUsage.records.filter(isProfileUsageRecord)
        : [];
    this.dismissedWarnings =
      dismissedWarnings?.version === 1 && Array.isArray(dismissedWarnings.records)
        ? dismissedWarnings.records.filter(isWarningDismissal)
        : [];
  }

  getState(): AssistantState {
    const usageCounts = Object.fromEntries(
      DOWNLOAD_PROFILE_IDS.map((profileId) => [profileId, 0])
    ) as Record<DownloadProfileId, number>;

    for (const record of this.profileUsage) {
      usageCounts[record.profileId] += 1;
    }

    return {
      profileUsage: [...this.profileUsage],
      dismissedWarnings: [...this.dismissedWarnings],
      lastProfileId: this.profileUsage.at(-1)?.profileId ?? null,
      usageCounts
    };
  }

  async recordProfileUse(record: Omit<AssistantProfileUsageRecord, "usedAt">) {
    const nextRecord: AssistantProfileUsageRecord = {
      ...record,
      torrentId: record.torrentId ?? null,
      source: record.source,
      usedAt: new Date().toISOString()
    };
    this.profileUsage = [...this.profileUsage, nextRecord].slice(
      -MAX_PROFILE_USAGE_RECORDS
    );
    await this.persistProfileUsage();
    return this.getState();
  }

  async dismissWarning(request: AssistantWarningDismissRequest) {
    const warningId = request.warningId.trim();

    if (!warningId) {
      return this.getState();
    }

    const nextRecord: AssistantWarningDismissal = {
      warningId,
      torrentId: request.torrentId ?? null,
      dismissedAt: new Date().toISOString()
    };
    const dedupeKey = createWarningKey(nextRecord.warningId, nextRecord.torrentId);
    this.dismissedWarnings = [
      ...this.dismissedWarnings.filter(
        (record) => createWarningKey(record.warningId, record.torrentId) !== dedupeKey
      ),
      nextRecord
    ].slice(-MAX_WARNING_DISMISSALS);
    await this.persistWarningDismissals();
    return this.getState();
  }

  private async persistProfileUsage() {
    await writeJson(this.options.profileUsageFilePath, {
      version: 1,
      records: this.profileUsage
    } satisfies PersistedProfileUsage);
  }

  private async persistWarningDismissals() {
    await writeJson(this.options.warningDismissedFilePath, {
      version: 1,
      records: this.dismissedWarnings
    } satisfies PersistedWarningDismissals);
  }
}

function createWarningKey(warningId: string, torrentId: string | null) {
  return `${torrentId ?? "global"}:${warningId}`;
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isProfileUsageRecord(value: unknown): value is AssistantProfileUsageRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<AssistantProfileUsageRecord>;
  return (
    isDownloadProfileId(record.profileId) &&
    (typeof record.torrentId === "string" || record.torrentId === null) &&
    ["add_dialog", "existing_torrent", "speed_doctor", "api"].includes(
      String(record.source)
    ) &&
    typeof record.usedAt === "string"
  );
}

function isWarningDismissal(value: unknown): value is AssistantWarningDismissal {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<AssistantWarningDismissal>;
  return (
    typeof record.warningId === "string" &&
    (typeof record.torrentId === "string" || record.torrentId === null) &&
    typeof record.dismissedAt === "string"
  );
}

function isDownloadProfileId(value: unknown): value is DownloadProfileId {
  return (
    typeof value === "string" &&
    DOWNLOAD_PROFILE_IDS.includes(value as DownloadProfileId)
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
