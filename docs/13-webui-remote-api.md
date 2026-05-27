# sTorent: WebUI and remote API

Stage 6 adds an optional local WebUI and JSON API for controlling `sTorent`
from another browser on the same trusted network.

## Security defaults

- WebUI is disabled by default.
- Enabling WebUI requires a password of at least 8 characters.
- The password is stored as a salted scrypt hash in the app user data folder.
- Access is restricted by client IP allowlist before any static file or API route
  is served.
- The default allowlist is `127.0.0.1` and `::1`.
- LAN access requires binding to `0.0.0.0` and adding explicit LAN IPs or CIDR
  ranges such as `192.168.1.0/24`.
- HTTPS is intentionally left for a later stage; use this only on trusted local
  networks.

## Desktop settings

Open `Settings -> WebUI and remote API`.

Fields:

- `Enable local WebUI and API` starts or stops the HTTP server.
- `Bind address` selects local-only `127.0.0.1` or LAN `0.0.0.0`.
- `Port` defaults to `43171`.
- `Allowed IPs or CIDR ranges` accepts exact IPs and IPv4 CIDR ranges.
- `Password` sets or rotates the remote access password. Leaving it blank keeps
  the current password.

## Authentication

All `/api/*` routes require:

```http
Authorization: Bearer <remote-access-password>
```

`Basic` auth is also accepted; the password part is used.

Every API response uses the existing core result shape:

```json
{ "ok": true, "value": {} }
```

or:

```json
{ "ok": false, "error": { "code": "unauthorized", "message": "..." } }
```

## Endpoints

```http
GET /api/snapshot
POST /api/torrents/magnet
POST /api/torrents/{id}/pause
POST /api/torrents/{id}/resume
POST /api/torrents/{id}/recheck
DELETE /api/torrents/{id}
PATCH /api/torrents/{id}/labels
PATCH /api/torrents/{id}/files/{fileIndex}
GET /api/network-settings
PUT /api/network-settings
PATCH /api/network-settings/speed-limits
GET /api/automation-settings
PUT /api/automation-settings
POST /api/watch-folders/scan
GET /api/docs
```

### Add magnet

```http
POST /api/torrents/magnet
Content-Type: application/json
Authorization: Bearer <password>
```

```json
{
  "magnetUri": "magnet:?xt=urn:btih:...",
  "profileId": "manual",
  "category": "Linux ISO",
  "tags": ["linux"]
}
```

### Change speed limits

```http
PATCH /api/network-settings/speed-limits
Content-Type: application/json
Authorization: Bearer <password>
```

```json
{
  "downloadBytesPerSecond": 1048576,
  "uploadBytesPerSecond": 262144
}
```

Use `null` to remove a limit.

## WebUI behavior

The WebUI serves the same responsive React application used by the desktop shell.
In browser mode it stores the entered remote password in `sessionStorage` and
sends it as a Bearer token to the local API. Browser mode supports magnet
downloads, status polling, pause/resume, labels, file priorities, network
settings, automation settings, and watch-folder scans. Selecting local `.torrent`
files remains a desktop-only action because the browser cannot pass a trusted
filesystem path to the Electron core.
