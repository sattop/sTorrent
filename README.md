# sTorent

`sTorent` is a desktop BitTorrent client focused on a clean interface, transparent network settings, and the core product feature: Smart Download Assistant + Speed Doctor.

## Current Stack

The current foundation uses:

- Electron for the desktop shell.
- React + TypeScript + Vite for the UI.
- A separate application/core boundary so the torrent engine can later move to a native backend if needed.
- Electron Builder for Windows installer output named `sTorent Setup.exe`.

This choice follows `docs/04-architecture.md`: Tauri is preferred when Rust is available, but this workspace currently has Node/NPM and no Rust/Cargo toolchain, so Electron lets the base project build and run now.

## Commands

```bash
npm install
npm run dev
npm run build
npm test -- --run
npm run build:windows
```

`npm run build:windows` is configured to produce a Windows NSIS installer with the artifact name `sTorent Setup.exe`.

## Project Structure

```text
docs/                     Product and engineering requirements
electron/                 Electron main and preload processes
src/app/                  Application contracts and settings shape
src/features/assistant/   Smart Download Assistant foundation
src/features/speedDoctor/ Speed Doctor foundation
src/i18n/locales/         UI dictionaries: ru, en, es, zh
src/types/                Shared TypeScript domain types
tests/                    Foundation checks
.github/workflows/        GitHub Actions build and release workflows
```

## Safety Rules

- UI strings must go through i18n dictionaries.
- Do not commit secrets, tokens, logs, user `.torrent` files, or downloaded data.
- Do not implement traffic impersonation for Steam, Discord, browsers, messengers, or any other third-party service.
- Speed Doctor may recommend safe BitTorrent settings, proxy checks, VPN-interface binding, limits, and diagnostics, but must not recommend bypassing network rules through traffic impersonation.

## Current Status

Stage 7 configures the Windows installer path. The desktop app now has an Electron Builder NSIS target, Windows app metadata, a project icon, and a reproducible `sTorent Setup.exe` build command.
