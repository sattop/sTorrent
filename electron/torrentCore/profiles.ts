import type { DownloadProfileId } from "./contracts.js";

export type PieceSelectionStrategy = "rarest" | "sequential";

export interface WebTorrentProfileOptions {
  strategy?: PieceSelectionStrategy;
  private?: boolean;
  uploads?: number | false;
  maxWebConns?: number;
}

export interface DownloadProfileDefinition {
  id: DownloadProfileId;
  torrentOptions: WebTorrentProfileOptions;
  appliedOptions: string[];
}

export const DOWNLOAD_PROFILE_DEFINITIONS: Record<
  DownloadProfileId,
  DownloadProfileDefinition
> = {
  max_speed: {
    id: "max_speed",
    torrentOptions: {
      strategy: "rarest",
      uploads: 10,
      maxWebConns: 8
    },
    appliedOptions: ["strategy:rarest", "uploads:10", "maxWebConns:8"]
  },
  stream_while_downloading: {
    id: "stream_while_downloading",
    torrentOptions: {
      strategy: "sequential"
    },
    appliedOptions: ["strategy:sequential"]
  },
  night_mode: {
    id: "night_mode",
    torrentOptions: {},
    appliedOptions: ["profile:recorded"]
  },
  private_tracker: {
    id: "private_tracker",
    torrentOptions: {
      private: true,
      strategy: "rarest"
    },
    appliedOptions: ["private:true", "strategy:rarest"]
  },
  vpn_interface: {
    id: "vpn_interface",
    torrentOptions: {},
    appliedOptions: ["profile:recorded"]
  },
  traffic_saver: {
    id: "traffic_saver",
    torrentOptions: {
      strategy: "rarest",
      uploads: 4,
      maxWebConns: 2
    },
    appliedOptions: ["strategy:rarest", "uploads:4", "maxWebConns:2"]
  },
  manual: {
    id: "manual",
    torrentOptions: {},
    appliedOptions: ["profile:manual"]
  }
};

export function resolveDownloadProfile(
  profileId: DownloadProfileId | undefined
) {
  return DOWNLOAD_PROFILE_DEFINITIONS[profileId ?? "manual"];
}

export interface BuildTorrentOptionsInput {
  downloadPath: string;
  profileId?: DownloadProfileId;
  startPaused?: boolean;
  deselect?: boolean;
  forcePrivate?: boolean;
  uploadSlots?: number | null;
}

export function buildWebTorrentAddOptions(input: BuildTorrentOptionsInput) {
  const profile = resolveDownloadProfile(input.profileId);
  const torrentOptions = {
    ...profile.torrentOptions,
    private: input.forcePrivate || profile.torrentOptions.private,
    uploads: input.uploadSlots ?? profile.torrentOptions.uploads
  };

  return {
    profile,
    webTorrentOptions: {
      ...torrentOptions,
      addUID: true,
      destroyStoreOnDestroy: false,
      path: input.downloadPath,
      paused: Boolean(input.startPaused),
      deselect: Boolean(input.deselect)
    }
  };
}
