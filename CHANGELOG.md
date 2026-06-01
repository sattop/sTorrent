# Changelog

All notable changes to sTorent are documented in this file.

## [0.1.4] - 2026-06-01

### Added

- Windows desktop integration for `.torrent` file association, `magnet:` links, double-click/open-with flows, single-instance handoff, system tray, close-to-tray, minimized startup, Windows autostart, splash screen, and native notifications.
- Desktop integration settings for default handlers, tray behavior, Windows login startup, minimized startup, and notification event controls.
- Torrent event/statistics foundations, table column controls, and automated coverage for startup argument parsing, integration settings, login item arguments, and torrent statistics.

### Changed

- Routed external `.torrent` and `magnet:` opens through the existing torrent core and preload IPC contracts.
- Expanded remote/API/UI contracts, localization, and torrent core coverage for the updated desktop workflow.
- Updated the Vitest toolchain to remove a critical development dependency audit finding before release.

## [0.1.3] - 2026-05-31

### Added

- Smart Download Assistant persistence for profile usage, dismissed warnings, health events, AI advice events, and schedule suggestions.
- SQLite-backed Speed Doctor history with 24h/7d summaries, anomaly detection, ISP throttling hints, and report export coverage.
- Native AnythingLLM, local AI provider, update, signed-build, port mapping, and Windows release workflows.

### Changed

- Split Speed Doctor into quick automatic scans and full diagnostics with extended port, proxy, tracker, DHT, disk, and NAT traversal checks.
- Expanded assistant and Speed Doctor UI, IPC contracts, remote API routes, translations, documentation, and automated tests.
- Release workflow now publishes an unsigned Windows installer when no signing certificate is configured.

## [0.1.2] - 2026-05-31

### Added

- Smart Download Assistant persistence for profile usage, dismissed warnings, health events, AI advice events, and schedule suggestions.
- SQLite-backed Speed Doctor history with 24h/7d summaries, anomaly detection, ISP throttling hints, and report export coverage.
- Native AnythingLLM, local AI provider, update, signed-build, port mapping, and Windows release workflows.

### Changed

- Split Speed Doctor into quick automatic scans and full diagnostics with extended port, proxy, tracker, DHT, disk, and NAT traversal checks.
- Expanded assistant and Speed Doctor UI, IPC contracts, remote API routes, translations, documentation, and automated tests.

## [0.1.1] - 2026-05-30

### Added

- Password-protected WebUI and remote JSON API controls for managing torrents from a browser.
- Expanded Speed Doctor diagnostics with privacy-safe tracker and error redaction.
- Smarter assistant recommendation types and torrent health guidance.

### Changed

- Improved release automation with generated release notes, checksum verification, branch build checks, and test execution in CI.
- Updated torrent core contracts, IPC events, UI panels, localization, and automated coverage for the new remote access and diagnostic flows.

## [0.1.0] - 2026-05-27

### Added

- MVP Electron desktop client for adding, pausing, resuming, removing, and rechecking torrents.
- File selection, categories, tags, download profiles, network settings, automation foundations, WebUI, and remote API controls.
- Windows NSIS installer output as `sTorent Setup.exe`.
- GitHub Actions build checks for branch pushes and pull requests.
- Tag-based GitHub Release publishing with the Windows installer, release notes, and `SHA256SUMS.txt`.

### Security

- Release automation excludes repository secrets, user `.torrent` files, logs, and downloaded data from published assets.
