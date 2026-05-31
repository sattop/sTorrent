import { BrowserWindow, ipcMain } from "electron";
import {
  ASSISTANT_EVENT_CHANNEL,
  type AssistantEvent,
  isAssistantEvent
} from "./assistantEvents.js";
import {
  AI_EVENT_CHANNEL,
  AI_IPC_CHANNELS,
  type AIAdviceRequest,
  type AIEvent,
  type AIProviderConfig,
  type AIResult,
  type AISettings
} from "./aiContracts.js";
import type { AIService } from "./aiService.js";

export function registerAIIpc(aiService: AIService) {
  aiService.on(AI_EVENT_CHANNEL, (event: AIEvent) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(AI_EVENT_CHANNEL, event);

      if (isAssistantEvent(event)) {
        window.webContents.send(ASSISTANT_EVENT_CHANNEL, event as AssistantEvent);
      }
    }
  });

  ipcMain.handle(AI_IPC_CHANNELS.getSettings, async () =>
    toAIResult(() => aiService.getSettingsState())
  );

  ipcMain.handle(
    AI_IPC_CHANNELS.updateSettings,
    async (_event, settings: AISettings) =>
      toAIResult(() => aiService.updateSettings(settings))
  );

  ipcMain.handle(
    AI_IPC_CHANNELS.testProvider,
    async (_event, config: AIProviderConfig) =>
      toAIResult(() => aiService.testProvider(config))
  );

  ipcMain.handle(
    AI_IPC_CHANNELS.listModels,
    async (_event, config: AIProviderConfig) =>
      toAIResult(() => aiService.listModels(config))
  );

  ipcMain.handle(
    AI_IPC_CHANNELS.requestAdvice,
    async (_event, request: AIAdviceRequest) =>
      toAIResult(() => aiService.requestAdvice(request))
  );
}

async function toAIResult<T>(
  action: () => T | Promise<T>
): Promise<AIResult<T>> {
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

  return "ai_error";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
