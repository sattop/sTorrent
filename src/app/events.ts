export const CORE_EVENTS = [
  "torrent.added",
  "torrent.metadata.received",
  "torrent.progress.updated",
  "torrent.status.changed",
  "torrent.completed",
  "torrent.labels.updated",
  "torrent.files.updated",
  "torrent.error",
  "network.port.checked",
  "assistant.profile.suggested",
  "assistant.profile.applied",
  "automation.settings.changed",
  "automation.watch.added",
  "automation.watch.scan.completed",
  "diagnostics.speed.checked",
  "settings.changed"
] as const;

export const UI_COMMANDS = [
  "torrent.add",
  "torrent.pause",
  "torrent.resume",
  "torrent.remove",
  "torrent.recheck",
  "torrent.setPriority",
  "torrent.setFilePriority",
  "torrent.updateLabels",
  "automation.update",
  "automation.scanWatchFolders",
  "settings.update",
  "remoteAccess.update"
] as const;

export type CoreEvent = (typeof CORE_EVENTS)[number];
export type UiCommand = (typeof UI_COMMANDS)[number];
