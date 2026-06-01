import type {
  TorrentCoreEvent,
  TorrentEventLogEntry,
  TorrentEventLogLevel
} from "./contracts.js";

export const MAX_TORRENT_EVENT_LOG_ENTRIES = 500;

export function createTorrentEventLogEntry(
  event: TorrentCoreEvent,
  options: {
    id: string;
    timestamp?: string;
  }
): TorrentEventLogEntry | null {
  if (event.type === "torrent.progress.updated") {
    return null;
  }

  const timestamp = options.timestamp ?? new Date().toISOString();

  return {
    id: options.id,
    timestamp,
    level: getEventLogLevel(event),
    type: event.type,
    torrentId: getEventTorrentId(event),
    message: sanitizeEventLogText(getEventLogMessage(event))
  };
}

export function normalizeTorrentEventLogEntries(
  value: unknown
): TorrentEventLogEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return trimTorrentEventLogEntries(
    value
      .map((entry) => normalizeTorrentEventLogEntry(entry))
      .filter((entry): entry is TorrentEventLogEntry => Boolean(entry))
  );
}

export function trimTorrentEventLogEntries(
  entries: TorrentEventLogEntry[],
  maxEntries = MAX_TORRENT_EVENT_LOG_ENTRIES
) {
  return entries.slice(Math.max(0, entries.length - maxEntries));
}

export function sanitizeEventLogText(value: string) {
  return value
    .replace(/https?:\/\/[^\s)]+/gi, (match) => {
      try {
        const url = new URL(match);
        const redactedUrl = `${url.protocol}//${url.host}${url.pathname}`;
        return redactedUrl.replace(/\/passkey\/[^/?#]+/gi, "/passkey/[redacted]");
      } catch {
        return "[url]";
      }
    })
    .replace(/magnet:\?[^\s)]+/gi, "[magnet]")
    .replace(/passkey=[^&\s)]+/gi, "passkey=[redacted]")
    .replace(/[A-Za-z]:\\[^\s)]+/g, "[path]")
    .slice(0, 240);
}

function normalizeTorrentEventLogEntry(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Partial<TorrentEventLogEntry>;

  if (
    typeof entry.id !== "string" ||
    typeof entry.timestamp !== "string" ||
    typeof entry.type !== "string" ||
    typeof entry.message !== "string"
  ) {
    return null;
  }

  return {
    id: entry.id,
    timestamp: entry.timestamp,
    level: normalizeEventLogLevel(entry.level),
    type: entry.type as TorrentEventLogEntry["type"],
    torrentId: typeof entry.torrentId === "string" ? entry.torrentId : null,
    message: sanitizeEventLogText(entry.message)
  };
}

function normalizeEventLogLevel(
  value: TorrentEventLogLevel | undefined
): TorrentEventLogLevel {
  return value === "warning" || value === "error" ? value : "info";
}

function getEventLogLevel(event: TorrentCoreEvent): TorrentEventLogLevel {
  if (event.type === "torrent.error") {
    return "error";
  }

  if (
    event.type === "diagnostics.torrent_speed.checked" &&
    event.payload.report.status !== "ok"
  ) {
    return "warning";
  }

  return "info";
}

function getEventTorrentId(event: TorrentCoreEvent) {
  if ("id" in event.payload && typeof event.payload.id === "string") {
    return event.payload.id;
  }

  if ("torrentId" in event.payload && typeof event.payload.torrentId === "string") {
    return event.payload.torrentId;
  }

  if ("report" in event.payload && "torrentId" in event.payload.report) {
    return event.payload.report.torrentId;
  }

  if ("suggestion" in event.payload) {
    return event.payload.suggestion.torrentId;
  }

  return null;
}

function getEventLogMessage(event: TorrentCoreEvent) {
  if ("name" in event.payload && typeof event.payload.name === "string") {
    return `${event.type}: ${event.payload.name}`;
  }

  if ("message" in event.payload && typeof event.payload.message === "string") {
    return `${event.type}: ${event.payload.message}`;
  }

  if ("torrent" in event.payload && "name" in event.payload.torrent) {
    return `${event.type}: ${event.payload.torrent.name}`;
  }

  if ("report" in event.payload && "status" in event.payload.report) {
    return `${event.type}: ${event.payload.report.status}`;
  }

  return event.type;
}
