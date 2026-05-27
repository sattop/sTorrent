import { ipcMain } from "electron";
import {
  REMOTE_ACCESS_IPC_CHANNELS,
  type RemoteAccessSettings,
  type TorrentCoreResult
} from "./contracts.js";
import type { RemoteAccessServer } from "./remoteAccess.js";

export function registerRemoteAccessIpc(remoteAccess: RemoteAccessServer) {
  ipcMain.handle(REMOTE_ACCESS_IPC_CHANNELS.getSettings, async () =>
    toResult(() => remoteAccess.getSettingsState())
  );

  ipcMain.handle(
    REMOTE_ACCESS_IPC_CHANNELS.updateSettings,
    async (_event, request: RemoteAccessSettings) =>
      toResult(() => remoteAccess.updateSettings(request))
  );
}

async function toResult<T>(
  action: () => T | Promise<T>
): Promise<TorrentCoreResult<T>> {
  try {
    return {
      ok: true,
      value: await action()
    };
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

function getErrorCode(error: unknown) {
  if (error instanceof Error && "code" in error) {
    return String((error as Error & { code: string }).code);
  }

  return "remote_access_error";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
