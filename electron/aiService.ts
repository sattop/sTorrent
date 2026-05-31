import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import {
  AI_EVENT_CHANNEL,
  AI_PROVIDER_DEFINITIONS,
  DEFAULT_AI_SETTINGS,
  type AIAdviceContext,
  type AIAdviceRequest,
  type AIAdviceResult,
  type AIEvent,
  type AIEventPayloadMap,
  type AIProviderConfig,
  type AIProviderId,
  type AIRequest,
  type AIResponse,
  type AISettings,
  type AISettingsState,
  type ProviderTestResult,
  createDefaultAIProviderConfig,
  getAIProviderDefinition
} from "./aiContracts.js";

interface AIAdapter {
  complete(config: ResolvedAIProviderConfig, request: AIRequest): Promise<AIResponse>;
  listModels(config: ResolvedAIProviderConfig): Promise<string[]>;
  test(config: ResolvedAIProviderConfig): Promise<ProviderTestResult>;
}

interface ResolvedAIProviderConfig extends AIProviderConfig {
  apiKey: string;
}

interface PersistedAISettings {
  version: 1;
  settings: AISettings;
}

interface PersistedAIKeys {
  version: 1;
  keys: Record<string, { encoding: "safeStorage"; value: string }>;
}

export interface AIServiceOptions {
  settingsFilePath: string;
  keysFilePath: string;
}

const SETTINGS_VERSION = 1;
const KEYS_VERSION = 1;
const MAX_ERROR_DETAIL_LENGTH = 300;
const OPENROUTER_REFERER = "https://github.com/sattop/sTorrent";

export class AIService extends EventEmitter {
  private settings = normalizeAISettings(DEFAULT_AI_SETTINGS);
  private readonly apiKeys = new Map<AIProviderId, string>();

  constructor(private readonly options: AIServiceOptions) {
    super();
  }

  async restore() {
    await this.restoreKeys();
    await this.restoreSettings();
  }

  getSettingsState(): AISettingsState {
    return this.sanitizeSettings(this.settings);
  }

  async updateSettings(settings: AISettings) {
    const normalized = normalizeAISettings(settings, this.settings);

    for (const provider of normalized.providers) {
      const apiKey = provider.apiKey?.trim();

      if (apiKey) {
        this.apiKeys.set(provider.providerId, apiKey);
      }
    }

    this.settings = this.sanitizeSettings(normalized).settings;
    await this.persistSettings();
    await this.persistKeys();

    const state = this.getSettingsState();
    this.emitAI("ai.settings.changed", { state });
    return state;
  }

  async testProvider(config: AIProviderConfig) {
    const resolved = this.resolveProviderConfig(config);
    const result = await createAdapter(resolved.providerId).test(resolved);

    this.emitAI("ai.provider.tested", {
      providerId: resolved.providerId,
      result
    });
    return result;
  }

  async listModels(config: AIProviderConfig) {
    const resolved = this.resolveProviderConfig(config);
    const models = await createAdapter(resolved.providerId).listModels(resolved);

    this.emitAI("ai.models.loaded", {
      providerId: resolved.providerId,
      models
    });
    return models;
  }

  async requestAdvice(request: AIAdviceRequest): Promise<AIAdviceResult> {
    const activeConfig = this.getActiveResolvedProvider();
    const start = Date.now();

    if (!activeConfig) {
      const fallback = this.createFallbackAdvice(request.context, Date.now() - start);
      this.emitAI("ai.advice.error", {
        contextType: request.contextType,
        fallbackText: fallback.text
      });
      this.emitAssistantLLMResponse(request, fallback);
      return fallback;
    }

    const aiRequest: AIRequest = {
      systemPrompt: createSystemPrompt(request.contextType),
      userMessage: buildAdviceMessage(request.context),
      maxTokens: 220,
      temperature: 0.3
    };

    try {
      const response = await createAdapter(activeConfig.providerId).complete(
        activeConfig,
        aiRequest
      );
      const result: AIAdviceResult = {
        text: normalizeAdviceText(response.text),
        providerUsed: response.providerUsed,
        modelUsed: response.modelUsed,
        latencyMs: response.latencyMs,
        fallback: false,
        generatedAt: new Date().toISOString()
      };
      this.emitAI("ai.advice.ready", {
        contextType: request.contextType,
        result
      });
      this.emitAssistantLLMResponse(request, result);
      return result;
    } catch {
      const fallback = this.createFallbackAdvice(request.context, Date.now() - start);
      this.emitAI("ai.advice.error", {
        contextType: request.contextType,
        fallbackText: fallback.text
      });
      this.emitAssistantLLMResponse(request, fallback);
      return fallback;
    }
  }

  private getActiveResolvedProvider() {
    if (!this.settings.enabled) {
      return null;
    }

    const provider =
      this.settings.providers.find(
        (item) => item.providerId === this.settings.activeProviderId
      ) ?? createDefaultAIProviderConfig(this.settings.activeProviderId);

    if (!provider.enabled) {
      return null;
    }

    const definition = getAIProviderDefinition(provider.providerId);
    const apiKey = this.apiKeys.get(provider.providerId) ?? "";

    if (definition.requiresApiKey && !apiKey) {
      return null;
    }

    return this.resolveProviderConfig(provider);
  }

  private resolveProviderConfig(config: AIProviderConfig): ResolvedAIProviderConfig {
    const [normalized] = normalizeAIProviders([config], this.settings.providers);
    const definition = getAIProviderDefinition(normalized.providerId);
    const apiKey =
      normalized.apiKey?.trim() || this.apiKeys.get(normalized.providerId) || "";

    return {
      ...normalized,
      baseUrl: trimTrailingSlash(normalized.baseUrl || definition.defaultBaseUrl),
      model: normalized.model || definition.recommendedModel || "local",
      apiKey,
      apiKeyConfigured: Boolean(apiKey)
    };
  }

  private sanitizeSettings(settings: AISettings): AISettingsState {
    const normalized = normalizeAISettings(settings, this.settings);
    const sanitizedSettings: AISettings = {
      ...normalized,
      providers: normalized.providers.map((provider) => {
        const { apiKey: _apiKey, ...safeProvider } = provider;
        return {
          ...safeProvider,
          apiKeyConfigured: this.apiKeys.has(provider.providerId)
        };
      })
    };
    const activeProvider =
      sanitizedSettings.providers.find(
        (provider) => provider.providerId === sanitizedSettings.activeProviderId
      ) ?? createDefaultAIProviderConfig(sanitizedSettings.activeProviderId);

    return {
      settings: sanitizedSettings,
      providerDefinitions: AI_PROVIDER_DEFINITIONS,
      activeProvider
    };
  }

  private createFallbackAdvice(
    context: AIAdviceContext,
    latencyMs: number
  ): AIAdviceResult {
    return {
      text: deterministicAdvice(context),
      providerUsed: "rules",
      modelUsed: "rules_v1",
      latencyMs,
      fallback: true,
      generatedAt: new Date().toISOString()
    };
  }

  private async restoreSettings() {
    let persisted: PersistedAISettings;

    try {
      persisted = JSON.parse(
        await fs.readFile(this.options.settingsFilePath, "utf8")
      ) as PersistedAISettings;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }

      return;
    }

    if (persisted.version !== SETTINGS_VERSION) {
      return;
    }

    this.settings = this.sanitizeSettings(persisted.settings).settings;
  }

  private async restoreKeys() {
    let persisted: PersistedAIKeys;

    try {
      persisted = JSON.parse(
        await fs.readFile(this.options.keysFilePath, "utf8")
      ) as PersistedAIKeys;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }

      return;
    }

    if (persisted.version !== KEYS_VERSION) {
      return;
    }

    for (const [providerId, encrypted] of Object.entries(persisted.keys)) {
      if (!isAIProviderId(providerId) || encrypted.encoding !== "safeStorage") {
        continue;
      }

      try {
        const key = safeStorage.decryptString(Buffer.from(encrypted.value, "base64"));
        if (key) {
          this.apiKeys.set(providerId, key);
        }
      } catch {
        // Corrupt or OS-bound keys are ignored; the user can paste the key again.
      }
    }
  }

  private async persistSettings() {
    const state = this.sanitizeSettings(this.settings).settings;
    const persisted: PersistedAISettings = {
      version: SETTINGS_VERSION,
      settings: state
    };

    await fs.mkdir(path.dirname(this.options.settingsFilePath), {
      recursive: true
    });
    await fs.writeFile(
      this.options.settingsFilePath,
      `${JSON.stringify(persisted, null, 2)}\n`,
      "utf8"
    );
  }

  private async persistKeys() {
    if (!safeStorage.isEncryptionAvailable()) {
      return;
    }

    const persisted: PersistedAIKeys = {
      version: KEYS_VERSION,
      keys: {}
    };

    for (const [providerId, key] of this.apiKeys) {
      persisted.keys[providerId] = {
        encoding: "safeStorage",
        value: safeStorage.encryptString(key).toString("base64")
      };
    }

    await fs.mkdir(path.dirname(this.options.keysFilePath), { recursive: true });
    await fs.writeFile(
      this.options.keysFilePath,
      `${JSON.stringify(persisted, null, 2)}\n`,
      "utf8"
    );
  }

  private emitAI<EventName extends keyof AIEventPayloadMap>(
    type: EventName,
    payload: AIEventPayloadMap[EventName]
  ) {
    const event: AIEvent = { type, payload } as AIEvent;
    this.emit(AI_EVENT_CHANNEL, event);
  }

  private emitAssistantLLMResponse(request: AIAdviceRequest, advice: AIAdviceResult) {
    if (request.contextType !== "sda") {
      return;
    }

    this.emitAI("assistant.llm.response", {
      torrentId: request.torrentId ?? null,
      advice
    });
  }
}

export function normalizeAISettings(
  input: Partial<AISettings> | undefined,
  fallback: AISettings = DEFAULT_AI_SETTINGS
): AISettings {
  const activeProviderId = normalizeProviderId(
    input?.activeProviderId ?? fallback.activeProviderId
  );
  const providers = normalizeAIProviders(input?.providers, fallback.providers);

  return {
    enabled: typeof input?.enabled === "boolean" ? input.enabled : fallback.enabled,
    activeProviderId,
    providers
  };
}

function normalizeAIProviders(
  input: AIProviderConfig[] | undefined,
  fallback: AIProviderConfig[]
) {
  const byProvider = new Map<AIProviderId, AIProviderConfig>();

  for (const provider of fallback) {
    byProvider.set(provider.providerId, provider);
  }

  for (const provider of input ?? []) {
    const providerId = normalizeProviderId(provider.providerId);
    const definition = getAIProviderDefinition(providerId);
    const fallbackProvider =
      byProvider.get(providerId) ?? createDefaultAIProviderConfig(providerId);
    const baseUrl = normalizeString(
      provider.baseUrl || fallbackProvider.baseUrl || definition.defaultBaseUrl
    );
    const model = normalizeString(
      provider.model || fallbackProvider.model || definition.recommendedModel
    );

    byProvider.set(providerId, {
      providerId,
      baseUrl,
      model,
      timeoutMs: normalizeTimeout(provider.timeoutMs, fallbackProvider.timeoutMs),
      enabled:
        typeof provider.enabled === "boolean"
          ? provider.enabled
          : fallbackProvider.enabled,
      apiKeyConfigured: Boolean(
        provider.apiKeyConfigured || fallbackProvider.apiKeyConfigured
      ),
      apiKey: provider.apiKey
    });
  }

  return AI_PROVIDER_DEFINITIONS.map((definition) => {
    const provider = byProvider.get(definition.id);
    return provider ?? createDefaultAIProviderConfig(definition.id);
  });
}

function createAdapter(providerId: AIProviderId): AIAdapter {
  const definition = getAIProviderDefinition(providerId);

  if (definition.adapter === "anthropic") {
    return new AnthropicAdapter();
  }

  if (definition.adapter === "gemini") {
    return new GeminiAdapter();
  }

  if (definition.adapter === "koboldcpp") {
    return new KoboldAdapter();
  }

  if (definition.adapter === "anythingllm") {
    return new AnythingLLMAdapter();
  }

  return new OpenAICompatibleAdapter();
}

class OpenAICompatibleAdapter implements AIAdapter {
  async complete(
    config: ResolvedAIProviderConfig,
    request: AIRequest
  ): Promise<AIResponse> {
    const startTime = Date.now();
    const response = await fetch(`${trimTrailingSlash(config.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: createOpenAIHeaders(config),
      body: JSON.stringify({
        model: config.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userMessage }
        ]
      }),
      signal: AbortSignal.timeout(config.timeoutMs)
    });

    if (!response.ok) {
      throw await createProviderError(config.providerId, response);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };

    return {
      text: data.choices?.[0]?.message?.content ?? "",
      providerUsed: config.providerId,
      modelUsed: config.model,
      latencyMs: Date.now() - startTime,
      tokensUsed: data.usage?.total_tokens
    };
  }

  async listModels(config: ResolvedAIProviderConfig) {
    const response = await fetch(`${trimTrailingSlash(config.baseUrl)}/models`, {
      headers: createOpenAIHeaders(config),
      signal: AbortSignal.timeout(Math.min(5_000, config.timeoutMs))
    });

    if (!response.ok) {
      throw await createProviderError(config.providerId, response);
    }

    const data = (await response.json()) as { data?: Array<{ id?: string }> };
    return (data.data ?? [])
      .map((model) => model.id)
      .filter((model): model is string => Boolean(model));
  }

  async test(config: ResolvedAIProviderConfig) {
    const start = Date.now();

    try {
      const models = await this.listModels(config);
      return {
        success: true,
        latencyMs: Date.now() - start,
        modelsList: models
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        error: getErrorMessage(error)
      };
    }
  }
}

class AnthropicAdapter implements AIAdapter {
  async complete(
    config: ResolvedAIProviderConfig,
    request: AIRequest
  ): Promise<AIResponse> {
    const startTime = Date.now();
    const response = await fetch(`${trimTrailingSlash(config.baseUrl)}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        system: request.systemPrompt,
        messages: [{ role: "user", content: request.userMessage }]
      }),
      signal: AbortSignal.timeout(config.timeoutMs)
    });

    if (!response.ok) {
      throw await createProviderError(config.providerId, response);
    }

    const data = (await response.json()) as {
      content?: Array<{ text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    return {
      text: data.content?.[0]?.text ?? "",
      providerUsed: config.providerId,
      modelUsed: config.model,
      latencyMs: Date.now() - startTime,
      tokensUsed:
        typeof data.usage?.input_tokens === "number" &&
        typeof data.usage?.output_tokens === "number"
          ? data.usage.input_tokens + data.usage.output_tokens
          : undefined
    };
  }

  async listModels() {
    return ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"];
  }

  async test(config: ResolvedAIProviderConfig) {
    const start = Date.now();

    try {
      await this.complete(config, {
        systemPrompt: "Respond with only: ok",
        userMessage: "ping",
        maxTokens: 5,
        temperature: 0
      });
      return {
        success: true,
        latencyMs: Date.now() - start,
        modelsList: await this.listModels()
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        error: getErrorMessage(error)
      };
    }
  }
}

class GeminiAdapter implements AIAdapter {
  async complete(
    config: ResolvedAIProviderConfig,
    request: AIRequest
  ): Promise<AIResponse> {
    const startTime = Date.now();
    const response = await fetch(
      `${trimTrailingSlash(config.baseUrl)}/models/${encodeURIComponent(
        config.model
      )}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: request.userMessage }] }],
          generationConfig: {
            maxOutputTokens: request.maxTokens,
            temperature: request.temperature
          }
        }),
        signal: AbortSignal.timeout(config.timeoutMs)
      }
    );

    if (!response.ok) {
      throw await createProviderError(config.providerId, response);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { totalTokenCount?: number };
    };

    return {
      text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
      providerUsed: config.providerId,
      modelUsed: config.model,
      latencyMs: Date.now() - startTime,
      tokensUsed: data.usageMetadata?.totalTokenCount
    };
  }

  async listModels(config: ResolvedAIProviderConfig) {
    const response = await fetch(
      `${trimTrailingSlash(config.baseUrl)}/models?key=${encodeURIComponent(
        config.apiKey
      )}`,
      { signal: AbortSignal.timeout(Math.min(5_000, config.timeoutMs)) }
    );

    if (!response.ok) {
      throw await createProviderError(config.providerId, response);
    }

    const data = (await response.json()) as {
      models?: Array<{
        name?: string;
        supportedGenerationMethods?: string[];
      }>;
    };
    return (data.models ?? [])
      .filter((model) =>
        model.supportedGenerationMethods?.includes("generateContent")
      )
      .map((model) => model.name?.replace(/^models\//, ""))
      .filter((model): model is string => Boolean(model));
  }

  async test(config: ResolvedAIProviderConfig) {
    const start = Date.now();

    try {
      const models = await this.listModels(config);
      return {
        success: true,
        latencyMs: Date.now() - start,
        modelsList: models
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        error: getErrorMessage(error)
      };
    }
  }
}

class KoboldAdapter implements AIAdapter {
  async complete(
    config: ResolvedAIProviderConfig,
    request: AIRequest
  ): Promise<AIResponse> {
    const startTime = Date.now();
    const response = await fetch(`${trimTrailingSlash(config.baseUrl)}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: `${request.systemPrompt}\n\n${request.userMessage}`,
        max_length: request.maxTokens,
        temperature: request.temperature,
        stop_sequence: ["\n\n"]
      }),
      signal: AbortSignal.timeout(config.timeoutMs)
    });

    if (!response.ok) {
      throw await createProviderError(config.providerId, response);
    }

    const data = (await response.json()) as {
      results?: Array<{ text?: string }>;
    };

    return {
      text: data.results?.[0]?.text?.trim() ?? "",
      providerUsed: config.providerId,
      modelUsed: config.model || "local",
      latencyMs: Date.now() - startTime
    };
  }

  async listModels(config: ResolvedAIProviderConfig) {
    try {
      const response = await fetch(`${trimTrailingSlash(config.baseUrl)}/model`, {
        signal: AbortSignal.timeout(Math.min(3_000, config.timeoutMs))
      });
      const data = (await response.json()) as { result?: string };
      return data.result ? [data.result] : ["local"];
    } catch {
      return ["local"];
    }
  }

  async test(config: ResolvedAIProviderConfig) {
    const start = Date.now();

    try {
      const models = await this.listModels(config);
      return {
        success: true,
        latencyMs: Date.now() - start,
        modelsList: models
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        error: getErrorMessage(error)
      };
    }
  }
}

class AnythingLLMAdapter implements AIAdapter {
  async complete(
    config: ResolvedAIProviderConfig,
    request: AIRequest
  ): Promise<AIResponse> {
    const startTime = Date.now();
    const workspaceSlug = encodeURIComponent(config.model || "default");
    const response = await fetch(
      `${trimTrailingSlash(config.baseUrl)}/v1/workspace/${workspaceSlug}/chat`,
      {
        method: "POST",
        headers: createAnythingLLMHeaders(config),
        body: JSON.stringify({
          message: `${request.systemPrompt}\n\n${request.userMessage}`,
          mode: "chat",
          sessionId: "storent-advisor"
        }),
        signal: AbortSignal.timeout(config.timeoutMs)
      }
    );

    if (!response.ok) {
      throw await createProviderError(config.providerId, response);
    }

    const data = (await response.json()) as {
      textResponse?: string;
      response?: string;
      message?: string;
    };

    return {
      text: data.textResponse ?? data.response ?? data.message ?? "",
      providerUsed: config.providerId,
      modelUsed: config.model || "default",
      latencyMs: Date.now() - startTime
    };
  }

  async listModels(config: ResolvedAIProviderConfig) {
    const response = await fetch(`${trimTrailingSlash(config.baseUrl)}/v1/workspaces`, {
      headers: createAnythingLLMHeaders(config),
      signal: AbortSignal.timeout(Math.min(5_000, config.timeoutMs))
    });

    if (!response.ok) {
      throw await createProviderError(config.providerId, response);
    }

    const data = (await response.json()) as {
      workspaces?: Array<{ slug?: string; name?: string }>;
    };
    const workspaces = (data.workspaces ?? [])
      .map((workspace) => workspace.slug ?? workspace.name)
      .filter((workspace): workspace is string => Boolean(workspace));

    return workspaces.length > 0 ? workspaces : ["default"];
  }

  async test(config: ResolvedAIProviderConfig) {
    const start = Date.now();

    try {
      const models = await this.listModels(config);
      return {
        success: true,
        latencyMs: Date.now() - start,
        modelsList: models
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        error: getErrorMessage(error)
      };
    }
  }
}

class AIProviderError extends Error {
  constructor(
    readonly providerId: AIProviderId,
    readonly statusCode: number,
    readonly detail: string
  ) {
    super(`[${providerId}] ${getProviderErrorMessage(statusCode, detail)}`);
  }
}

function createSystemPrompt(contextType: "sda" | "speedDoctor") {
  const focus =
    contextType === "sda"
      ? "Помоги выбрать профиль загрузки и предупреди о рисках до старта."
      : "Объясни, почему загрузка может идти медленно, и предложи безопасное действие.";

  return `Ты встроенный помощник торрент-клиента sTorent. ${focus}
Отвечай строго по-русски.
Давай конкретный практичный совет: 2-3 предложения максимум.
Не используй markdown, списки или заголовки.
Не объясняй, что такое BitTorrent.
Не упоминай название модели или провайдера.
Если данных недостаточно, скажи это честно одним предложением.`;
}

function buildAdviceMessage(ctx: AIAdviceContext) {
  return [
    `Health score: ${ctx.healthScore}/100`,
    `Сидеров: ${ctx.seeders}, личеров/пиров: ${ctx.leechers}`,
    `Размер: ${ctx.totalSizeGb.toFixed(1)} ГБ`,
    `Тип файлов: ${ctx.fileCategory}`,
    `Свободно на диске: ${
      ctx.freeDiskGb === null ? "неизвестно" : `${ctx.freeDiskGb.toFixed(1)} ГБ`
    }`,
    `Текущая скорость: ${Math.round(ctx.currentSpeedKb)} КБ/с`,
    `Средняя скорость: ${Math.round(ctx.avgSpeedKb)} КБ/с`,
    `Час суток: ${ctx.hourOfDay}:00`,
    `Статус отчета: ${ctx.reportStatus ?? "нет"}`,
    `Основная причина: ${ctx.primaryReason ?? "нет"}`,
    `Приватный torrent: ${ctx.privateTorrent ? "да" : "нет"}`,
    `Metadata готова: ${ctx.metadataReady === false ? "нет" : "да"}`,
    ctx.anomalies.length > 0
      ? `Аномалии: ${ctx.anomalies.join(", ")}`
      : "Аномалии: нет",
    `Предложенный профиль: ${ctx.suggestedProfile}`,
    "",
    "Что посоветуешь?"
  ].join("\n");
}

function deterministicAdvice(ctx: AIAdviceContext) {
  if (ctx.seeders === 0 && ctx.metadataReady !== false) {
    return "Нет активных сидеров - загрузка может не завершиться. Лучше запустить Speed Doctor и проверить трекеры перед ожиданием долгой загрузки.";
  }

  if (ctx.healthScore < 30) {
    return "Раздача выглядит слабой: мало источников или есть сетевые ограничения. Рекомендую оставить загрузку на ночь или выбрать другой torrent с большим числом сидеров.";
  }

  if (ctx.anomalies.includes("disk_stalled") || ctx.anomalies.includes("disk_space_low")) {
    return "Проблема похожа на ограничение диска. Проверьте свободное место и снизьте нагрузку на диск перед увеличением скорости.";
  }

  if (
    ctx.anomalies.includes("incoming_port_closed") ||
    ctx.anomalies.includes("incoming_port_unverified")
  ) {
    return "Входящий порт не подтвержден, поэтому часть пиров может не подключаться напрямую. Проверьте порт или включите UPnP/NAT-PMP в настройках.";
  }

  if (ctx.currentSpeedKb < ctx.avgSpeedKb * 0.3 && ctx.avgSpeedKb > 0) {
    return "Скорость заметно ниже обычной для этого состояния. Запустите полную диагностику и проверьте лимиты, трекеры и количество пиров.";
  }

  return "Критичных ограничений не видно. Выбранный профиль выглядит уместно, а дальнейшие изменения лучше применять только после явной диагностики.";
}

function normalizeAdviceText(value: string) {
  const text = value.trim().replace(/\s+/g, " ");
  return text || deterministicAdvice(createNeutralAdviceContext());
}

function createNeutralAdviceContext(): AIAdviceContext {
  return {
    healthScore: 50,
    seeders: 0,
    leechers: 0,
    totalSizeGb: 0,
    fileCategory: "unknown",
    freeDiskGb: null,
    currentSpeedKb: 0,
    avgSpeedKb: 0,
    hourOfDay: new Date().getHours(),
    anomalies: [],
    suggestedProfile: "manual"
  };
}

function createOpenAIHeaders(config: ResolvedAIProviderConfig) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  if (config.providerId === "openrouter") {
    headers["HTTP-Referer"] = OPENROUTER_REFERER;
    headers["X-Title"] = "sTorent";
  }

  return headers;
}

function createAnythingLLMHeaders(config: ResolvedAIProviderConfig) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  return headers;
}

async function createProviderError(providerId: AIProviderId, response: Response) {
  const detail = await response.text().catch(() => "");
  return new AIProviderError(
    providerId,
    response.status,
    detail.slice(0, MAX_ERROR_DETAIL_LENGTH)
  );
}

function getProviderErrorMessage(statusCode: number, detail: string) {
  if (statusCode === 401) {
    return "Invalid API key. Check AI settings.";
  }

  if (statusCode === 403) {
    return "Access denied. Check API key permissions.";
  }

  if (statusCode === 429) {
    return "Rate limit exceeded. Try again later.";
  }

  if (statusCode >= 500) {
    return "Provider error. Try again later.";
  }

  return detail || "Provider request failed.";
}

function normalizeProviderId(value: unknown): AIProviderId {
  return isAIProviderId(value) ? value : DEFAULT_AI_SETTINGS.activeProviderId;
}

function isAIProviderId(value: unknown): value is AIProviderId {
  return (
    typeof value === "string" &&
    AI_PROVIDER_DEFINITIONS.some((definition) => definition.id === value)
  );
}

function normalizeTimeout(value: unknown, fallback: number) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(120_000, Math.max(3_000, Math.round(numeric)));
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
