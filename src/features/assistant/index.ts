import {
  DOWNLOAD_PROFILE_IDS,
  type DownloadProfileId,
  type SmartAssistantBaseline,
  type SmartAssistantFileInput,
  type SmartAssistantInput,
  type SmartAssistantReasonCode,
  type SmartAssistantRecommendation,
  type SmartAssistantSuggestion,
  type SmartAssistantWarningCode
} from "./types";

const LARGE_TORRENT_BYTES = 4 * 1024 * 1024 * 1024;
const DISK_HEADROOM_BYTES = 512 * 1024 * 1024;

export function createAssistantBaseline(): SmartAssistantBaseline {
  return {
    status: "rules_v1",
    supportedProfiles: [...DOWNLOAD_PROFILE_IDS],
    appliesAutomatically: false
  };
}

export function createSmartAssistantRecommendation(
  input: SmartAssistantInput
): SmartAssistantRecommendation {
  const selectedProfileId = input.selectedProfileId ?? "manual";
  const reasons: SmartAssistantReasonCode[] = [];
  const warnings: SmartAssistantWarningCode[] = [];
  const suggestions: SmartAssistantSuggestion[] = [];
  const tags = input.tags ?? [];
  const files = input.files ?? [];
  const sizeBytes = input.sizeBytes ?? sumFileSizes(files);
  const searchableText = normalizeSearchableText([
    input.category ?? "",
    ...tags,
    ...files.flatMap((file) => [file.name, file.path])
  ]);
  const explicitProfileSelected = selectedProfileId !== "manual";
  const privateIntent =
    Boolean(input.privateMode) ||
    Boolean(input.privateTorrent) ||
    hasAnyToken(searchableText, ["private", "privat", "tracker", "ratio"]);
  const mediaFiles = files.filter(isMediaFile);
  const mediaIntent = mediaFiles.length > 0 || hasMediaToken(searchableText);
  const trafficSaverIntent =
    input.networkProfileId === "traffic_saver" ||
    hasAnyToken(searchableText, ["mobile", "metered", "limited", "traffic"]);
  const hasHealthySwarm = (input.seeds ?? 0) >= 3 || (input.peers ?? 0) >= 8;
  const hasLowPeerAvailability =
    Boolean(input.metadataReady) &&
    (input.seeds ?? 0) <= 1 &&
    (input.peers ?? 0) <= 2;
  const hasEnoughDisk =
    input.disk && sizeBytes > 0
      ? input.disk.availableBytes >= sizeBytes + DISK_HEADROOM_BYTES
      : null;
  const conflictingFiles = findConflictingFiles(
    files,
    input.existingFileNames ?? []
  );
  const folderTemplate = findFolderTemplate(input, files, mediaIntent);
  const categorySuggestion = inferCategory(input.category, files, mediaIntent);
  const tagSuggestions = inferTags(tags, files, {
    privateIntent,
    mediaIntent,
    trafficSaverIntent
  });

  let profileId: DownloadProfileId = "max_speed";
  let confidence = 0.68;

  if (explicitProfileSelected) {
    profileId = selectedProfileId;
    confidence = 0.92;
    reasons.push("manual_profile_selected");
  } else if (privateIntent) {
    profileId = "private_tracker";
    confidence = 0.88;
    reasons.push(getPrivateReason(input));
  } else if (trafficSaverIntent) {
    profileId = "traffic_saver";
    confidence = 0.84;
    reasons.push("traffic_saver_network");
  } else if (mediaIntent) {
    profileId = "stream_while_downloading";
    confidence = 0.78;
    reasons.push("media_content_detected");
    warnings.push("streaming_efficiency");
  } else if (input.activeSpeedSchedule) {
    profileId = "night_mode";
    confidence = 0.74;
    reasons.push("active_speed_schedule");
  } else if ((input.activeDownloadCount ?? 0) >= 3) {
    profileId = "night_mode";
    confidence = 0.7;
    reasons.push("many_active_downloads");
  } else if (input.lastSelectedProfileId && input.lastSelectedProfileId !== "manual") {
    profileId = input.lastSelectedProfileId;
    confidence = 0.72;
    reasons.push("last_profile_reused");
  } else {
    reasons.push("default_fast_public");
  }

  if (sizeBytes >= LARGE_TORRENT_BYTES) {
    reasons.push("large_torrent_detected");
  }

  if (hasEnoughDisk === true) {
    reasons.push("disk_space_available");
  } else if (hasEnoughDisk === false) {
    reasons.push("disk_space_low");
    warnings.push("disk_space_low");
  }

  if (conflictingFiles.length > 0) {
    reasons.push("file_conflict_detected");
    warnings.push("file_conflict");
  }

  if (hasHealthySwarm) {
    reasons.push("healthy_swarm_detected");
  } else if (hasLowPeerAvailability) {
    reasons.push("low_peer_availability");
    warnings.push("low_peer_availability");
  }

  if (input.favoriteFolderSelected) {
    reasons.push("favorite_folder_selected");
  } else if (folderTemplate) {
    reasons.push("folder_template_matched");
    suggestions.push({
      type: "folder",
      value: folderTemplate.id,
      label: folderTemplate.name,
      requiresConfirmation: false
    });
  }

  if (privateIntent && profileId !== "private_tracker") {
    warnings.push("private_mode_safety");
  }

  if (input.metadataReady === false) {
    warnings.push("metadata_pending");
  }

  if (categorySuggestion) {
    suggestions.push({
      type: "category",
      value: categorySuggestion,
      requiresConfirmation: false
    });
  }

  if (tagSuggestions.length > 0) {
    suggestions.push({
      type: "tags",
      value: tagSuggestions.join(", "),
      values: tagSuggestions,
      requiresConfirmation: false
    });
  }

  if (profileId === "stream_while_downloading" && mediaFiles[0]) {
    suggestions.push({
      type: "file_priority",
      value: "high",
      filePath: mediaFiles[0].path || mediaFiles[0].name,
      requiresConfirmation: true
    });
  }

  if (hasEnoughDisk === false || conflictingFiles.length > 0) {
    suggestions.push({
      type: "start_paused",
      value: "true",
      requiresConfirmation: true
    });
  }

  if (sizeBytes >= LARGE_TORRENT_BYTES) {
    suggestions.push({
      type: "recheck_after_complete",
      value: "true",
      requiresConfirmation: true
    });
  }

  suggestions.push({
    type: "profile_template",
    value: profileId,
    requiresConfirmation: false
  });

  return {
    profileId,
    confidence,
    reasons: Array.from(new Set(reasons)),
    warnings: Array.from(new Set(warnings)),
    suggestions: dedupeSuggestions(suggestions),
    appliesAutomatically: false as const
  };
}

export { DOWNLOAD_PROFILE_IDS };
export type {
  DownloadProfileId,
  SmartAssistantBaseline,
  SmartAssistantFileInput,
  SmartAssistantInput,
  SmartAssistantRecommendation,
  SmartAssistantReasonCode,
  SmartAssistantSuggestion,
  SmartAssistantWarningCode
} from "./types";

function normalizeSearchableText(parts: string[]) {
  return parts.join(" ").trim().toLowerCase();
}

function hasAnyToken(value: string, tokens: string[]) {
  return tokens.some((token) => value.includes(token));
}

function hasMediaToken(value: string) {
  return hasAnyToken(value, [
    "movie",
    "movies",
    "film",
    "video",
    "audio",
    "music",
    "series",
    "tv",
    "видео",
    "фильм",
    "музыка",
    "сериал"
  ]);
}

function getPrivateReason(
  input: SmartAssistantInput
): SmartAssistantReasonCode {
  if (input.privateTorrent) {
    return "private_metadata";
  }

  return input.privateMode ? "private_mode_enabled" : "private_tag_detected";
}

function sumFileSizes(files: SmartAssistantFileInput[]) {
  return files.reduce((total, file) => total + Math.max(0, file.lengthBytes), 0);
}

function isMediaFile(file: SmartAssistantFileInput) {
  return [
    ".avi",
    ".flac",
    ".m4a",
    ".m4v",
    ".mkv",
    ".mov",
    ".mp3",
    ".mp4",
    ".ogg",
    ".wav",
    ".webm"
  ].some((extension) =>
    `${file.path} ${file.name}`.toLowerCase().includes(extension)
  );
}

function findConflictingFiles(
  files: SmartAssistantFileInput[],
  existingFileNames: string[]
): SmartAssistantFileInput[] {
  const existing = new Set(existingFileNames.map((name) => name.toLowerCase()));
  return files.filter((file) => {
    const name = (file.path || file.name).toLowerCase();
    return existing.has(name) || existing.has(file.name.toLowerCase());
  });
}

function findFolderTemplate(
  input: SmartAssistantInput,
  files: SmartAssistantFileInput[],
  mediaIntent: boolean
) {
  const templates = input.favoriteFolders ?? [];

  if (templates.length === 0) {
    return null;
  }

  const searchable = normalizeSearchableText([
    input.category ?? "",
    ...(input.tags ?? []),
    ...files.flatMap((file) => [file.name, file.path])
  ]);

  return (
    templates.find((folder) =>
      [folder.name, folder.category ?? "", ...folder.tags]
        .filter(Boolean)
        .some((token) => searchable.includes(token.toLowerCase()))
    ) ??
    (mediaIntent
      ? templates.find((folder) =>
          [folder.name, folder.category ?? "", ...folder.tags]
            .join(" ")
            .toLowerCase()
            .match(/movie|film|video|media|music|audio|фильм|видео|музык/)
        )
      : null) ??
    null
  );
}

function inferCategory(
  currentCategory: string | null | undefined,
  files: SmartAssistantFileInput[],
  mediaIntent: boolean
) {
  if (currentCategory?.trim()) {
    return null;
  }

  if (mediaIntent) {
    return "Media";
  }

  if (files.some((file) => hasExtension(file, [".iso", ".exe", ".msi", ".dmg"]))) {
    return "Software";
  }

  if (files.some((file) => hasExtension(file, [".pdf", ".epub", ".docx"]))) {
    return "Documents";
  }

  return null;
}

function inferTags(
  currentTags: string[],
  files: SmartAssistantFileInput[],
  flags: {
    privateIntent: boolean;
    mediaIntent: boolean;
    trafficSaverIntent: boolean;
  }
) {
  const existing = new Set(currentTags.map((tag) => tag.toLowerCase()));
  const suggestions = [
    flags.privateIntent ? "private" : null,
    flags.mediaIntent ? "media" : null,
    flags.trafficSaverIntent ? "metered" : null,
    files.some((file) => hasExtension(file, [".iso"])) ? "iso" : null,
    files.length > 20 ? "multi-file" : null
  ].filter((tag): tag is string => Boolean(tag));

  return suggestions.filter((tag) => !existing.has(tag.toLowerCase()));
}

function hasExtension(file: SmartAssistantFileInput, extensions: string[]) {
  const value = `${file.path} ${file.name}`.toLowerCase();
  return extensions.some((extension) => value.endsWith(extension));
}

function dedupeSuggestions(suggestions: SmartAssistantSuggestion[]) {
  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    const key = `${suggestion.type}:${suggestion.value}:${suggestion.filePath ?? ""}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
