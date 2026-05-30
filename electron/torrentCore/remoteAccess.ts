import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import {
  REMOTE_ACCESS_HOSTS,
  type AddMagnetRequest,
  type AutomationSettings,
  type AutomationSettingsState,
  type NetworkSettings,
  type NetworkSettingsState,
  type RemoteAccessCapabilities,
  type RemoteAccessHost,
  type RemoteAccessPublicSettings,
  type RemoteAccessRuntimeState,
  type RemoteAccessSettings,
  type RemoteAccessSettingsState,
  type SetTorrentFilePriorityRequest,
  type SpeedLimitSettings,
  type TorrentCoreSnapshot,
  type TorrentCoreResult,
  type TorrentSpeedDoctorReport,
  type TorrentSummary,
  type UpdateTorrentLabelsRequest,
  type UpdateTorrentProfileRequest,
  type WatchFolderScanResult
} from "./contracts.js";

const DEFAULT_PORT = 43171;
const MIN_PORT = 1024;
const MAX_PORT = 65_535;
const MAX_ALLOWED_IPS = 64;
const MIN_PASSWORD_LENGTH = 8;
const MAX_BODY_BYTES = 1024 * 1024;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_SALT_BYTES = 16;

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp"
};

export interface PersistedRemoteAccessSettings {
  version: 1;
  enabled: boolean;
  host: RemoteAccessHost;
  port: number;
  allowedIps: string[];
  passwordHash: string | null;
  passwordSalt: string | null;
}

export interface RemoteAccessServerOptions {
  settingsFilePath: string;
  staticRoot: string;
  core: RemoteAccessCore;
}

export interface RemoteAccessCore {
  addMagnet(request: AddMagnetRequest): Promise<TorrentSummary>;
  pause(id: string): TorrentSummary;
  resume(id: string): TorrentSummary;
  remove(id: string): Promise<TorrentCoreSnapshot>;
  recheck(id: string): Promise<TorrentSummary>;
  updateLabels(request: UpdateTorrentLabelsRequest): TorrentSummary;
  updateProfile(request: UpdateTorrentProfileRequest): TorrentSummary;
  setFilePriority(request: SetTorrentFilePriorityRequest): TorrentSummary;
  runSpeedDoctor(id: string): Promise<TorrentSpeedDoctorReport>;
  getSnapshot(): TorrentCoreSnapshot;
  getNetworkSettingsState(): NetworkSettingsState;
  updateNetworkSettings(settings: NetworkSettings): Promise<NetworkSettingsState>;
  getAutomationSettingsState(): AutomationSettingsState;
  updateAutomationSettings(
    settings: AutomationSettings
  ): Promise<AutomationSettingsState>;
  runWatchFolderScan(): Promise<WatchFolderScanResult>;
}

export const DEFAULT_REMOTE_ACCESS_SETTINGS: PersistedRemoteAccessSettings = {
  version: 1,
  enabled: false,
  host: "127.0.0.1",
  port: DEFAULT_PORT,
  allowedIps: ["127.0.0.1", "::1"],
  passwordHash: null,
  passwordSalt: null
};

export const REMOTE_ACCESS_CAPABILITIES: RemoteAccessCapabilities = {
  localWebUi: true,
  passwordRequired: true,
  ipAllowlist: true,
  apiDocs: true
};

export class RemoteAccessServer {
  private server: ReturnType<typeof createServer> | null = null;
  private settings = DEFAULT_REMOTE_ACCESS_SETTINGS;
  private runtime: RemoteAccessRuntimeState = {
    running: false,
    origin: null,
    lastError: null
  };

  constructor(private readonly options: RemoteAccessServerOptions) {}

  async restore() {
    let persistedSettings: Partial<PersistedRemoteAccessSettings>;

    try {
      persistedSettings = JSON.parse(
        await fs.readFile(this.options.settingsFilePath, "utf8")
      ) as Partial<PersistedRemoteAccessSettings>;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        this.runtime = {
          running: false,
          origin: null,
          lastError: getErrorMessage(error)
        };
      }

      await this.applyRuntimeSettings();
      return;
    }

    this.settings = normalizeRemoteAccessSettings(
      persistedSettings,
      DEFAULT_REMOTE_ACCESS_SETTINGS
    );
    await this.applyRuntimeSettings();
  }

  getSettingsState(): RemoteAccessSettingsState {
    return {
      settings: toPublicSettings(this.settings),
      runtime: { ...this.runtime },
      capabilities: REMOTE_ACCESS_CAPABILITIES
    };
  }

  async updateSettings(request: RemoteAccessSettings) {
    const previous = this.settings;
    const normalized = normalizeRemoteAccessSettings(
      {
        ...previous,
        ...request,
        passwordHash: previous.passwordHash,
        passwordSalt: previous.passwordSalt
      },
      previous
    );
    const password = request.password?.trim();

    if (password) {
      if (password.length < MIN_PASSWORD_LENGTH) {
        throw createCodedError(
          "remote_password_too_short",
          "Remote access password must contain at least 8 characters."
        );
      }

      const passwordHash = hashRemoteAccessPassword(password);
      normalized.passwordHash = passwordHash.hash;
      normalized.passwordSalt = passwordHash.salt;
    }

    if (normalized.enabled && !normalized.passwordHash) {
      throw createCodedError(
        "remote_password_required",
        "Remote access cannot be enabled without a password."
      );
    }

    this.settings = normalized;
    await this.persistSettings();
    await this.applyRuntimeSettings();
    return this.getSettingsState();
  }

  shutdown() {
    return this.stopServer();
  }

  private async applyRuntimeSettings() {
    await this.stopServer();

    if (!this.settings.enabled) {
      this.runtime = {
        running: false,
        origin: null,
        lastError: null
      };
      return;
    }

    const server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(this.settings.port, this.settings.host, () => {
          server.off("error", reject);
          resolve();
        });
      });

      this.server = server;
      const address = server.address() as AddressInfo;
      this.runtime = {
        running: true,
        origin: buildOrigin(this.settings.host, address.port),
        lastError: null
      };
    } catch (error) {
      server.close();
      this.runtime = {
        running: false,
        origin: null,
        lastError: getErrorMessage(error)
      };
    }
  }

  private async stopServer() {
    const server = this.server;

    if (!server) {
      return;
    }

    this.server = null;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse
  ) {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const clientIp = normalizeRemoteAddress(request.socket.remoteAddress);

    if (!isRemoteAddressAllowed(clientIp, this.settings.allowedIps)) {
      sendJson(response, 403, {
        ok: false,
        error: {
          code: "ip_not_allowed",
          message: "This client IP is not allowed."
        }
      });
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      if (!this.authenticateRequest(request)) {
        sendJson(response, 401, {
          ok: false,
          error: {
            code: "unauthorized",
            message: "Remote access password is required."
          }
        });
        return;
      }

      await this.handleApiRequest(request, response, requestUrl);
      return;
    }

    await this.serveStaticFile(request, response, requestUrl);
  }

  private async handleApiRequest(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL
  ) {
    try {
      const route = requestUrl.pathname.replace(/^\/api\/?/, "");

      if (request.method === "GET" && route === "docs") {
        sendJson(response, 200, toOkResult(createApiDocs(this.runtime.origin)));
        return;
      }

      if (request.method === "GET" && route === "snapshot") {
        sendJson(response, 200, toOkResult(this.options.core.getSnapshot()));
        return;
      }

      if (request.method === "POST" && route === "torrents/magnet") {
        const body = await readJsonBody<AddMagnetRequest>(request);
        sendJson(
          response,
          200,
          await toResult(() => this.options.core.addMagnet(body))
        );
        return;
      }

      const torrentActionMatch = route.match(
        /^torrents\/([^/]+)\/(pause|resume|recheck|speed-doctor)$/
      );

      if (
        (request.method === "POST" || request.method === "GET") &&
        torrentActionMatch
      ) {
        const id = decodeURIComponent(torrentActionMatch[1]);
        const action = torrentActionMatch[2];

        if (action === "speed-doctor") {
          if (request.method !== "GET") {
            sendJson(response, 405, {
              ok: false,
              error: {
                code: "method_not_allowed",
                message: "Speed Doctor reports use GET."
              }
            });
            return;
          }

          sendJson(
            response,
            200,
            await toResult(() => this.options.core.runSpeedDoctor(id))
          );
          return;
        }

        if (request.method !== "POST") {
          sendJson(response, 405, {
            ok: false,
            error: {
              code: "method_not_allowed",
              message: "Torrent actions use POST."
            }
          });
          return;
        }

        if (action === "pause") {
          sendJson(response, 200, await toResult(() => this.options.core.pause(id)));
          return;
        }

        if (action === "resume") {
          sendJson(
            response,
            200,
            await toResult(() => this.options.core.resume(id))
          );
          return;
        }

        sendJson(
          response,
          200,
          await toResult(() => this.options.core.recheck(id))
        );
        return;
      }

      const torrentRemoveMatch = route.match(/^torrents\/([^/]+)$/);

      if (request.method === "DELETE" && torrentRemoveMatch) {
        const id = decodeURIComponent(torrentRemoveMatch[1]);
        sendJson(response, 200, await toResult(() => this.options.core.remove(id)));
        return;
      }

      const torrentLabelsMatch = route.match(/^torrents\/([^/]+)\/labels$/);

      if (request.method === "PATCH" && torrentLabelsMatch) {
        const body = await readJsonBody<Omit<UpdateTorrentLabelsRequest, "id">>(
          request
        );
        const id = decodeURIComponent(torrentLabelsMatch[1]);
        sendJson(
          response,
          200,
          await toResult(() =>
            this.options.core.updateLabels({
              id,
              ...body
            })
          )
        );
        return;
      }

      const torrentProfileMatch = route.match(/^torrents\/([^/]+)\/profile$/);

      if (request.method === "PATCH" && torrentProfileMatch) {
        const body = await readJsonBody<Omit<UpdateTorrentProfileRequest, "id">>(
          request
        );
        const id = decodeURIComponent(torrentProfileMatch[1]);
        sendJson(
          response,
          200,
          await toResult(() =>
            this.options.core.updateProfile({
              id,
              ...body
            })
          )
        );
        return;
      }

      const torrentFileMatch = route.match(/^torrents\/([^/]+)\/files\/(\d+)$/);

      if (request.method === "PATCH" && torrentFileMatch) {
        const body = await readJsonBody<
          Omit<SetTorrentFilePriorityRequest, "id" | "fileIndex">
        >(request);
        const id = decodeURIComponent(torrentFileMatch[1]);
        const fileIndex = Number(torrentFileMatch[2]);
        sendJson(
          response,
          200,
          await toResult(() =>
            this.options.core.setFilePriority({
              id,
              fileIndex,
              ...body
            })
          )
        );
        return;
      }

      if (request.method === "GET" && route === "network-settings") {
        sendJson(
          response,
          200,
          toOkResult(this.options.core.getNetworkSettingsState())
        );
        return;
      }

      if (request.method === "PUT" && route === "network-settings") {
        const body = await readJsonBody<NetworkSettings>(request);
        sendJson(
          response,
          200,
          await toResult(() => this.options.core.updateNetworkSettings(body))
        );
        return;
      }

      if (request.method === "PATCH" && route === "network-settings/speed-limits") {
        const body = await readJsonBody<Partial<SpeedLimitSettings>>(request);
        const currentSettings = this.options.core.getNetworkSettingsState().settings;
        sendJson(
          response,
          200,
          await toResult(() =>
            this.options.core.updateNetworkSettings({
              ...currentSettings,
              speedLimits: {
                ...currentSettings.speedLimits,
                ...body
              }
            })
          )
        );
        return;
      }

      if (request.method === "GET" && route === "automation-settings") {
        sendJson(
          response,
          200,
          toOkResult(this.options.core.getAutomationSettingsState())
        );
        return;
      }

      if (request.method === "PUT" && route === "automation-settings") {
        const body = await readJsonBody<AutomationSettings>(request);
        sendJson(
          response,
          200,
          await toResult(() => this.options.core.updateAutomationSettings(body))
        );
        return;
      }

      if (request.method === "POST" && route === "watch-folders/scan") {
        sendJson(
          response,
          200,
          await toResult(() => this.options.core.runWatchFolderScan())
        );
        return;
      }

      sendJson(response, 404, {
        ok: false,
        error: {
          code: "not_found",
          message: "Remote API route not found."
        }
      });
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: {
          code: getErrorCode(error),
          message: getErrorMessage(error)
        }
      });
    }
  }

  private async serveStaticFile(
    request: IncomingMessage,
    response: ServerResponse,
    requestUrl: URL
  ) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendText(response, 405, "Method not allowed");
      return;
    }

    const staticRoot = path.resolve(this.options.staticRoot);
    const pathname =
      requestUrl.pathname === "/" ? "/index.html" : decodeURIComponent(requestUrl.pathname);
    const requestedFile = path.resolve(
      staticRoot,
      pathname.replace(/^\/+/, "")
    );
    const indexFile = path.resolve(staticRoot, "index.html");
    const relativePath = path.relative(staticRoot, requestedFile);
    const filePath =
      relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
        ? requestedFile
        : indexFile;

    try {
      const file = await fs.readFile(filePath);
      sendBytes(response, 200, file, MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT" && filePath !== indexFile) {
        try {
          const index = await fs.readFile(indexFile);
          sendBytes(response, 200, index, MIME_TYPES[".html"]);
          return;
        } catch {
          sendText(response, 404, "WebUI files are not available.");
          return;
        }
      }

      sendText(response, 404, "WebUI files are not available.");
    }
  }

  private authenticateRequest(request: IncomingMessage) {
    const password = getAuthorizationPassword(request.headers.authorization);

    if (!password) {
      return false;
    }

    return verifyRemoteAccessPassword(password, this.settings);
  }

  private async persistSettings() {
    await fs.mkdir(path.dirname(this.options.settingsFilePath), { recursive: true });
    await fs.writeFile(
      this.options.settingsFilePath,
      `${JSON.stringify(this.settings, null, 2)}\n`,
      "utf8"
    );
  }
}

export function normalizeRemoteAccessSettings(
  input: Partial<PersistedRemoteAccessSettings> | undefined,
  fallback: PersistedRemoteAccessSettings = DEFAULT_REMOTE_ACCESS_SETTINGS
): PersistedRemoteAccessSettings {
  const host = REMOTE_ACCESS_HOSTS.includes(input?.host as RemoteAccessHost)
    ? (input?.host as RemoteAccessHost)
    : fallback.host;

  return {
    version: 1,
    enabled: toBoolean(input?.enabled, fallback.enabled),
    host,
    port: normalizePort(input?.port ?? fallback.port),
    allowedIps: normalizeAllowedIps(input?.allowedIps ?? fallback.allowedIps),
    passwordHash: normalizeHash(input?.passwordHash ?? fallback.passwordHash),
    passwordSalt: normalizeHash(input?.passwordSalt ?? fallback.passwordSalt)
  };
}

export function hashRemoteAccessPassword(password: string) {
  const salt = randomBytes(PASSWORD_SALT_BYTES).toString("base64");
  return {
    hash: scryptSync(password, salt, PASSWORD_KEY_LENGTH).toString("base64"),
    salt
  };
}

export function verifyRemoteAccessPassword(
  password: string,
  settings: Pick<PersistedRemoteAccessSettings, "passwordHash" | "passwordSalt">
) {
  if (!settings.passwordHash || !settings.passwordSalt) {
    return false;
  }

  const expected = Buffer.from(settings.passwordHash, "base64");
  const actual = scryptSync(password, settings.passwordSalt, PASSWORD_KEY_LENGTH);

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}

export function isRemoteAddressAllowed(
  remoteAddress: string | undefined,
  allowedIps: string[]
) {
  const normalizedAddress = normalizeRemoteAddress(remoteAddress);

  if (!normalizedAddress) {
    return false;
  }

  return allowedIps.some((entry) => {
    if (entry.includes("/")) {
      return isIpv4CidrMatch(normalizedAddress, entry);
    }

    return normalizeRemoteAddress(entry) === normalizedAddress;
  });
}

export function normalizeRemoteAddress(address: string | undefined) {
  if (!address) {
    return "";
  }

  if (address.startsWith("::ffff:")) {
    return address.slice("::ffff:".length);
  }

  return address;
}

function toPublicSettings(
  settings: PersistedRemoteAccessSettings
): RemoteAccessPublicSettings {
  return {
    enabled: settings.enabled,
    host: settings.host,
    port: settings.port,
    allowedIps: [...settings.allowedIps],
    passwordConfigured: Boolean(settings.passwordHash)
  };
}

function getAuthorizationPassword(header: string | undefined) {
  if (!header) {
    return null;
  }

  if (header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }

  if (header.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString(
        "utf8"
      );
      const separatorIndex = decoded.indexOf(":");
      return separatorIndex === -1 ? decoded : decoded.slice(separatorIndex + 1);
    } catch {
      return null;
    }
  }

  return null;
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;

    if (totalBytes > MAX_BODY_BYTES) {
      throw createCodedError("body_too_large", "Request body is too large.");
    }

    chunks.push(buffer);
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  return (text ? JSON.parse(text) : {}) as T;
}

async function toResult<T>(
  action: () => T | Promise<T>
): Promise<TorrentCoreResult<T>> {
  try {
    return toOkResult(await action());
  } catch (error) {
    return {
      ok: false,
      error: {
        code: getErrorCode(error),
        message: getErrorMessage(error)
      }
    };
  }
}

function toOkResult<T>(value: T): TorrentCoreResult<T> {
  return {
    ok: true,
    value
  };
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  const payload = `${JSON.stringify(body, null, 2)}\n`;
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(payload);
}

function sendText(response: ServerResponse, statusCode: number, body: string) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
}

function sendBytes(
  response: ServerResponse,
  statusCode: number,
  body: Buffer,
  contentType: string
) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff"
  });
  response.end(body);
}

function normalizePort(value: unknown) {
  const numeric = Number(value);

  if (!Number.isInteger(numeric) || numeric < MIN_PORT || numeric > MAX_PORT) {
    return DEFAULT_PORT;
  }

  return numeric;
}

function normalizeAllowedIps(value: unknown) {
  if (!Array.isArray(value)) {
    return [...DEFAULT_REMOTE_ACCESS_SETTINGS.allowedIps];
  }

  const normalized = Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0)
        .filter(isAllowedIpEntry)
    )
  ).slice(0, MAX_ALLOWED_IPS);

  return normalized.length > 0
    ? normalized
    : [...DEFAULT_REMOTE_ACCESS_SETTINGS.allowedIps];
}

function isAllowedIpEntry(value: string) {
  if (value.includes("/")) {
    return isValidIpv4Cidr(value);
  }

  return net.isIP(normalizeRemoteAddress(value)) !== 0;
}

function isValidIpv4Cidr(value: string) {
  const [address, prefixValue] = value.split("/");
  const prefix = Number(prefixValue);
  return (
    net.isIPv4(address) &&
    Number.isInteger(prefix) &&
    prefix >= 0 &&
    prefix <= 32
  );
}

function isIpv4CidrMatch(address: string, cidr: string) {
  if (!net.isIPv4(address) || !isValidIpv4Cidr(cidr)) {
    return false;
  }

  const [baseAddress, prefixValue] = cidr.split("/");
  const prefix = Number(prefixValue);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

  return (ipv4ToNumber(address) & mask) === (ipv4ToNumber(baseAddress) & mask);
}

function ipv4ToNumber(address: string) {
  return address
    .split(".")
    .map((part) => Number(part))
    .reduce((total, part) => ((total << 8) + part) >>> 0, 0);
}

function normalizeHash(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function toBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function buildOrigin(host: RemoteAccessHost, port: number) {
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  return `http://${displayHost}:${port}`;
}

function createApiDocs(origin: string | null) {
  return {
    name: "sTorent Remote API",
    origin,
    authentication: "Authorization: Bearer <remote-access-password>",
    endpoints: [
      "GET /api/snapshot",
      "POST /api/torrents/magnet",
      "POST /api/torrents/{id}/pause",
      "POST /api/torrents/{id}/resume",
      "POST /api/torrents/{id}/recheck",
      "GET /api/torrents/{id}/speed-doctor",
      "DELETE /api/torrents/{id}",
      "PATCH /api/torrents/{id}/labels",
      "PATCH /api/torrents/{id}/profile",
      "PATCH /api/torrents/{id}/files/{fileIndex}",
      "GET /api/network-settings",
      "PUT /api/network-settings",
      "PATCH /api/network-settings/speed-limits",
      "GET /api/automation-settings",
      "PUT /api/automation-settings",
      "POST /api/watch-folders/scan"
    ],
    resultShape: "{ ok: true, value } | { ok: false, error: { code, message } }"
  };
}

function createCodedError(code: string, message: string) {
  const error = new Error(message);
  (error as Error & { code: string }).code = code;
  return error;
}

function getErrorCode(error: unknown) {
  if (error instanceof Error && "code" in error) {
    return String((error as Error & { code: string }).code);
  }

  return "remote_access_error";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
