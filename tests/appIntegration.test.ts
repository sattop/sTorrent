import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_INTEGRATION_SETTINGS,
  buildLoginItemArgs,
  normalizeAppIntegrationSettings,
  parseExternalOpenTargets,
  parseStartupFlags
} from "../electron/appIntegrationContracts";

describe("Windows/Electron integration contracts", () => {
  it("normalizes settings with safe defaults", () => {
    expect(normalizeAppIntegrationSettings(undefined)).toEqual(
      DEFAULT_APP_INTEGRATION_SETTINGS
    );
    expect(
      normalizeAppIntegrationSettings({
        registerDefaultHandlers: false,
        trayEnabled: "yes",
        closeToTray: false,
        launchAtLogin: true,
        launchMinimized: false,
        notificationsEnabled: false,
        notifyOnTorrentCompleted: false,
        notifyOnTorrentError: true,
        notifyOnWatchFolderAdded: false,
        notifyOnExternalAdd: true
      })
    ).toMatchObject({
      registerDefaultHandlers: false,
      trayEnabled: true,
      closeToTray: false,
      launchAtLogin: true,
      launchMinimized: false,
      notificationsEnabled: false,
      notifyOnTorrentCompleted: false,
      notifyOnTorrentError: true,
      notifyOnWatchFolderAdded: false,
      notifyOnExternalAdd: true
    });
  });

  it("parses torrent files and magnet links from startup args", () => {
    const torrentPath = path.resolve("fixtures", "Example.torrent");
    const fileUrl = pathToFileURL(torrentPath).toString();
    const magnetUri = "magnet:?xt=urn:btih:abc123";

    expect(
      parseExternalOpenTargets([
        "electron.exe",
        ".",
        "--minimized",
        `"${torrentPath}"`,
        fileUrl,
        magnetUri,
        "README.md"
      ])
    ).toEqual([
      {
        type: "torrent_file",
        filePath: torrentPath
      },
      {
        type: "magnet",
        magnetUri
      }
    ]);
  });

  it("deduplicates external open targets", () => {
    const torrentPath = path.resolve("fixtures", "Duplicate.torrent");

    expect(
      parseExternalOpenTargets([
        torrentPath,
        `"${torrentPath}"`,
        "magnet:?xt=urn:btih:abc123",
        "MAGNET:?xt=urn:btih:abc123"
      ])
    ).toEqual([
      {
        type: "torrent_file",
        filePath: torrentPath
      },
      {
        type: "magnet",
        magnetUri: "magnet:?xt=urn:btih:abc123"
      }
    ]);
  });

  it("parses startup flags without treating them as external targets", () => {
    expect(
      parseStartupFlags(["sTorent.exe", "--launch-at-login", "--minimized"])
    ).toEqual({
      launchAtLogin: true,
      minimized: true
    });
    expect(
      parseExternalOpenTargets(["sTorent.exe", "--launch-at-login", "--minimized"])
    ).toEqual([]);
  });

  it("builds login item args for minimized and normal autostart", () => {
    expect(buildLoginItemArgs(false)).toEqual(["--launch-at-login"]);
    expect(buildLoginItemArgs(true)).toEqual([
      "--launch-at-login",
      "--minimized"
    ]);
    expect(buildLoginItemArgs(true, "C:\\Apps\\sTorent")).toEqual([
      "C:\\Apps\\sTorent",
      "--launch-at-login",
      "--minimized"
    ]);
  });
});
