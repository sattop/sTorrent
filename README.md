# sTorent

[![Build Windows](https://github.com/sattop/sTorrent/actions/workflows/build-windows.yml/badge.svg)](https://github.com/sattop/sTorrent/actions/workflows/build-windows.yml)
[![Release](https://github.com/sattop/sTorrent/actions/workflows/release.yml/badge.svg)](https://github.com/sattop/sTorrent/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

`sTorent` is a Windows desktop BitTorrent client with a clean interface, transparent network settings, Smart Download Assistant foundations, and Speed Doctor diagnostics.

The project is currently an MVP. Core torrent operations work, Windows builds are published automatically, and the next stages focus on release polish, stability, and smarter recommendations.

## Download

Latest release: [sTorent v0.1.0](https://github.com/sattop/sTorrent/releases/tag/v0.1.0)

Download the Windows installer:

[sTorent Setup.exe](https://github.com/sattop/sTorrent/releases/download/v0.1.0/sTorent.Setup.exe)

The release also includes `SHA256SUMS.txt` for checksum verification.

## Features

- Add `.torrent` files and magnet links.
- Pause, resume, remove, and recheck torrents.
- View download progress, speed, peers, ETA, files, and trackers.
- Assign categories and tags.
- Configure file priorities.
- Use download profiles for common scenarios.
- Configure DHT, PEX, LSD, private mode, ports, limits, proxy, and interface binding.
- Run network diagnostics through Speed Doctor.
- Configure automation foundations: watch folders, favorite folders, seeding rules, RSS rules, and speed schedules.
- Enable an optional local WebUI and remote JSON API with password protection.
- Switch UI language between Russian, English, Spanish, and Chinese.
- Build a signed-metadata Windows NSIS installer with app icon and shortcuts.

## Current Limits

- This is not a finished stable `1.0` release.
- Smart Download Assistant recommendations are still foundational.
- Speed Doctor provides safe diagnostics and settings guidance, not traffic bypassing.
- Portable builds and auto-update are planned after the MVP.
- Only Windows installer builds are published right now.

## Safety

Use `sTorent` only for content you have the right to download and share.

The project intentionally does not implement traffic impersonation, service spoofing, or bypass logic for Steam, Discord, browsers, messengers, or other third-party services.

User data, downloaded files, `.torrent` files, logs, secrets, certificates, and private keys are excluded from the repository by `.gitignore`.

## Development

Requirements:

- Node.js 24
- npm
- Windows for local installer verification

Install dependencies:

```bash
npm install
```

Run the desktop app in development:

```bash
npm run dev
```

Run checks:

```bash
npm run lint:types
npm test -- --run
npm run audit:security
```

Build the app:

```bash
npm run build
```

Build the Windows installer:

```bash
npm run build:windows
```

The installer is written to:

```text
release/sTorent Setup.exe
```

## Release Flow

GitHub Actions are configured for:

- build checks on pushes and pull requests to `main`;
- Windows installer builds on tags matching `v*`;
- GitHub Release publishing with `.exe` and `SHA256SUMS.txt`.

Create a release by pushing a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Project Structure

```text
.github/workflows/        GitHub Actions build and release workflows
assets/                   App icon sources and generated Windows icon
docs/                     Product, architecture, networking, release, and roadmap docs
electron/                 Electron main process, preload, IPC, and torrent core
scripts/                  Security audit, icon generation, and pack hooks
security/                 Explicit npm audit accepted-risk allowlist
src/                      React UI and app-level browser code
tests/                    Vitest coverage for contracts, i18n, torrent core, remote API
```

## Tech Stack

- Electron
- React
- TypeScript
- Vite
- WebTorrent
- Electron Builder
- Vitest

Electron is used for the current MVP because this workspace already targets Node/npm. The architecture keeps the UI and torrent core separated so a future native backend remains possible.

## Documentation

- [Product brief](docs/01-product-brief.md)
- [Functional requirements](docs/02-functional-requirements.md)
- [UI/UX spec](docs/03-ui-ux-spec.md)
- [Architecture](docs/04-architecture.md)
- [Networking and privacy](docs/05-networking-privacy.md)
- [Roadmap](docs/06-roadmap.md)
- [Build, release, GitHub](docs/07-build-release-github.md)
- [AI step-by-step workflow](docs/09-ai-step-by-step-workflow.md)
- [WebUI and remote API](docs/13-webui-remote-api.md)

## License

MIT. See [LICENSE](LICENSE).
