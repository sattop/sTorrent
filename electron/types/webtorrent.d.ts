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
    torrentFile?: Uint8Array | Buffer | null;
    metadata?: Uint8Array | Buffer | null;
    announce?: string[];
    urlList?: string[];
    discovery?: {
      tracker?: {
        start?(opts?: Record<string, unknown>): void;
        update?(opts?: Record<string, unknown>): void;
      } | null;
      _dhtAnnounce?(): void;
    } | null;
    wires?: Array<{
      isSeeder?: boolean;
      peerId?: string | Uint8Array | Buffer;
      type?: string;
      remoteAddress?: string;
      remotePort?: number;
      destroyed?: boolean;
      peerChoking?: boolean;
      peerInterested?: boolean;
      amChoking?: boolean;
      amInterested?: boolean;
      peerPieces?: {
        get?(index: number): boolean;
        buffer?: Uint8Array | Buffer;
      };
      downloadSpeed?: () => number;
      uploadSpeed?: () => number;
    }>;
    _queue?: unknown[];
    _peers?: Map<string, unknown>;
    _rechokeNumSlots?: number;
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
    maxConns: number;
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
