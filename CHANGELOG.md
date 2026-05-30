# Changelog

All notable changes to sTorent are documented in this file.

## [0.1.0] - 2026-05-27

### Added

- MVP Electron desktop client for adding, pausing, resuming, removing, and rechecking torrents.
- File selection, categories, tags, download profiles, network settings, automation foundations, WebUI, and remote API controls.
- Windows NSIS installer output as `sTorent Setup.exe`.
- GitHub Actions build checks for branch pushes and pull requests.
- Tag-based GitHub Release publishing with the Windows installer, release notes, and `SHA256SUMS.txt`.

### Security

- Release automation excludes repository secrets, user `.torrent` files, logs, and downloaded data from published assets.
