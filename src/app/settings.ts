import type { Locale } from "../i18n";

export interface AppSettings {
  downloads: {
    defaultPath: string;
    maxActiveDownloads: number;
    maxActiveSeeds: number;
    seedRatioLimit: number;
  };
  network: {
    port: number;
    randomizePortOnStart: boolean;
    enableDht: boolean;
    enablePex: boolean;
    enableLsd: boolean;
    downloadLimitKb: number;
    uploadLimitKb: number;
    networkInterface: "auto" | string;
  };
  privacy: {
    telemetry: false;
    proxyEnabled: boolean;
    proxyType: "socks5" | "http";
  };
  ui: {
    theme: "system" | "light" | "dark";
    language: Locale;
  };
}

export const defaultSettings: AppSettings = {
  downloads: {
    defaultPath: "",
    maxActiveDownloads: 3,
    maxActiveSeeds: 5,
    seedRatioLimit: 2
  },
  network: {
    port: 51413,
    randomizePortOnStart: false,
    enableDht: true,
    enablePex: true,
    enableLsd: true,
    downloadLimitKb: 0,
    uploadLimitKb: 0,
    networkInterface: "auto"
  },
  privacy: {
    telemetry: false,
    proxyEnabled: false,
    proxyType: "socks5"
  },
  ui: {
    theme: "system",
    language: "ru"
  }
};
