declare module "webtorrent" {
  import { EventEmitter } from "node:events";

  export interface WebTorrentFile {
    name: string;
    path: string;
    length: number;
    downloaded: number;
    progress: number;
    select(priority?: number): void;
    deselect(): void;
  }

  export interface WebTorrentTorrent extends EventEmitter {
    infoHash?: string;
    magnetURI?: string;
    name?: string;
    path: string;
    length?: number;
    downloaded?: number;
    downloadSpeed?: number;
    uploadSpeed?: number;
    progress?: number;
    numPeers?: number;
    timeRemaining?: number;
    ready?: boolean;
    done?: boolean;
    paused?: boolean;
    private?: boolean;
    metadata?: Uint8Array | Buffer | null;
    announce?: string[];
    wires?: Array<{
      isSeeder?: boolean;
      remoteAddress?: string;
      remotePort?: number;
      destroyed?: boolean;
      downloadSpeed?: () => number;
      uploadSpeed?: () => number;
    }>;
    _queue?: unknown[];
    _peers?: Map<string, unknown>;
    files: WebTorrentFile[];
    pause(): void;
    resume(): void;
    destroy(
      opts?: { destroyStore?: boolean },
      cb?: (error?: Error | null) => void
    ): void;
    rescanFiles?(cb?: (error?: Error | null) => void): void;
  }

  export interface WebTorrentClientOptions {
    dht?: boolean | Record<string, unknown>;
    lsd?: boolean;
    utPex?: boolean;
    natUpnp?: boolean | "permanent";
    natPmp?: boolean;
    maxConns?: number;
    torrentPort?: number;
    downloadLimit?: number;
    uploadLimit?: number;
  }

  export default class WebTorrent extends EventEmitter {
    constructor(opts?: WebTorrentClientOptions);
    torrents: WebTorrentTorrent[];
    downloadSpeed: number;
    uploadSpeed: number;
    add(
      torrentId: string | Buffer | Uint8Array,
      opts?: Record<string, unknown>,
      ontorrent?: (torrent: WebTorrentTorrent) => void
    ): WebTorrentTorrent;
    remove(
      torrentId: string | Buffer | Uint8Array | WebTorrentTorrent,
      opts?: { destroyStore?: boolean } | null,
      cb?: (error?: Error | null) => void
    ): Promise<void>;
    destroy(cb?: (error?: Error | null) => void): void;
    throttleDownload(rate: number): boolean | void;
    throttleUpload(rate: number): boolean | void;
  }
}
