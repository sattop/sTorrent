# sTorent: security audit decisions

## Torrent engine audit blocker

Decision date: 2026-05-26.

`npm audit` reports `GHSA-2p57-rm9w-gvfp` through this chain:

```text
webtorrent -> torrent-discovery -> bittorrent-tracker -> ip
```

Current upstream state checked on 2026-05-26:

- `webtorrent@3.0.6` is the latest npm release.
- `bittorrent-tracker@11.2.3` is the latest npm release.
- `ip@2.0.1` is the latest npm release and is still in the advisory range.
- `npm audit fix` proposes `webtorrent@0.7.3`, which is a major downgrade and not a real fix for the desktop MVP.

The project accepts this risk for the MVP instead of waiting for upstream or replacing
the torrent engine in this stage. The affected package is pulled in by
`bittorrent-tracker` server-side UDP parsing, while sTorent embeds WebTorrent as a
client and does not expose a tracker server.

This acceptance is intentionally narrow:

- The accepted advisory is listed in `security/audit-allowlist.json`.
- `npm run audit:security` fails on any vulnerability outside that allowlist.
- The decision must be reviewed by 2026-06-30 or earlier if WebTorrent publishes a fixed release.

Replacing WebTorrent with a native/libtorrent-backed process remains the preferred
long-term route if the upstream dependency chain stays vulnerable.
