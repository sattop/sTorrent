export const TORRENT_COLUMN_IDS = [
  "status",
  "progress",
  "size",
  "down",
  "up",
  "peers",
  "eta",
  "category",
  "tags",
  "tracker",
  "addedAt"
] as const;

export type TorrentColumnId = (typeof TORRENT_COLUMN_IDS)[number];

export const DEFAULT_TORRENT_COLUMNS: TorrentColumnId[] = [
  "status",
  "progress",
  "size",
  "down",
  "up",
  "peers",
  "eta",
  "category",
  "tags",
  "tracker"
];

export const TORRENT_COLUMNS_STORAGE_KEY = "storent.downloads.columns";

export function normalizeTorrentColumns(value: unknown): TorrentColumnId[] {
  const values = Array.isArray(value) ? value : DEFAULT_TORRENT_COLUMNS;
  const normalized = values.filter((item): item is TorrentColumnId =>
    TORRENT_COLUMN_IDS.includes(item as TorrentColumnId)
  );

  return normalized.length > 0
    ? Array.from(new Set(normalized))
    : DEFAULT_TORRENT_COLUMNS;
}
