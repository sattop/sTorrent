import {
  TORRENT_FILE_PRIORITIES,
  type TorrentFilePriority
} from "./contracts.js";

const TAG_SPLIT_PATTERN = /[,;\n]/;
const MAX_CATEGORY_LENGTH = 80;
const MAX_TAG_LENGTH = 40;
const MAX_TAGS = 12;

export function normalizeTorrentCategory(category: string | null | undefined) {
  const normalized = normalizeWhitespace(category ?? "");

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, MAX_CATEGORY_LENGTH);
}

export function normalizeTorrentTags(tags: string[] | string | null | undefined) {
  const values = Array.isArray(tags)
    ? tags
    : typeof tags === "string"
      ? tags.split(TAG_SPLIT_PATTERN)
      : [];
  const seen = new Set<string>();
  const normalizedTags: string[] = [];

  for (const value of values) {
    const tag = normalizeWhitespace(value).slice(0, MAX_TAG_LENGTH);
    const key = tag.toLocaleLowerCase();

    if (!tag || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalizedTags.push(tag);

    if (normalizedTags.length >= MAX_TAGS) {
      break;
    }
  }

  return normalizedTags;
}

export function normalizeFilePriority(
  priority: TorrentFilePriority | string | null | undefined
): TorrentFilePriority {
  return TORRENT_FILE_PRIORITIES.includes(priority as TorrentFilePriority)
    ? (priority as TorrentFilePriority)
    : "normal";
}

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}
