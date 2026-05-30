# Changelog

All notable changes to sTorent are documented in this file.

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
