export const AI_PROVIDER_IDS = [
  "anthropic",
  "openai",
  "gemini",
  "mistral",
  "groq",
  "together",
  "openrouter",
  "lmstudio",
  "ollama",
  "jan",
  "llamacpp",
  "textgenwebui",
  "koboldcpp",
  "anythingllm",
  "custom"
] as const;

export type AIProviderId = (typeof AI_PROVIDER_IDS)[number];

export const LOCAL_AI_PROVIDER_IDS: AIProviderId[] = [
  "lmstudio",
  "ollama",
  "jan",
  "llamacpp",
  "textgenwebui",
  "koboldcpp",
  "anythingllm",
  "custom"
];

export interface AIProviderDefinition {
  id: AIProviderId;
  name: string;
  defaultBaseUrl: string;
  recommendedModel: string;
  requiresApiKey: boolean;
  adapter: "openai_compatible" | "anthropic" | "gemini" | "koboldcpp" | "anythingllm";
}

export const AI_PROVIDER_DEFINITIONS: AIProviderDefinition[] = [
  {
    id: "anthropic",
    name: "Anthropic Claude",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    recommendedModel: "claude-haiku-4-5",
    requiresApiKey: true,
    adapter: "anthropic"
  },
  {
    id: "openai",
    name: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    recommendedModel: "gpt-4o-mini",
    requiresApiKey: true,
    adapter: "openai_compatible"
  },
  {
    id: "gemini",
    name: "Google Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    recommendedModel: "gemini-1.5-flash",
    requiresApiKey: true,
    adapter: "gemini"
  },
  {
    id: "mistral",
    name: "Mistral",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    recommendedModel: "mistral-small-latest",
    requiresApiKey: true,
    adapter: "openai_compatible"
  },
  {
    id: "groq",
    name: "Groq",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    recommendedModel: "llama-3.1-8b-instant",
    requiresApiKey: true,
    adapter: "openai_compatible"
  },
  {
    id: "together",
    name: "Together AI",
    defaultBaseUrl: "https://api.together.xyz/v1",
    recommendedModel: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
    requiresApiKey: true,
    adapter: "openai_compatible"
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    recommendedModel: "meta-llama/llama-3.1-8b-instruct:free",
    requiresApiKey: true,
    adapter: "openai_compatible"
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    defaultBaseUrl: "http://localhost:1234/v1",
    recommendedModel: "mistral-7b-instruct",
    requiresApiKey: false,
    adapter: "openai_compatible"
  },
  {
    id: "ollama",
    name: "Ollama",
    defaultBaseUrl: "http://localhost:11434/v1",
    recommendedModel: "llama3.2:3b",
    requiresApiKey: false,
    adapter: "openai_compatible"
  },
  {
    id: "jan",
    name: "Jan",
    defaultBaseUrl: "http://localhost:1337/v1",
    recommendedModel: "local",
    requiresApiKey: false,
    adapter: "openai_compatible"
  },
  {
    id: "llamacpp",
    name: "llama.cpp server",
    defaultBaseUrl: "http://localhost:8080/v1",
    recommendedModel: "local",
    requiresApiKey: false,
    adapter: "openai_compatible"
  },
  {
    id: "textgenwebui",
    name: "Text Generation WebUI",
    defaultBaseUrl: "http://localhost:5000/v1",
    recommendedModel: "local",
    requiresApiKey: false,
    adapter: "openai_compatible"
  },
  {
    id: "koboldcpp",
    name: "Kobold.cpp",
    defaultBaseUrl: "http://localhost:5001/api/v1",
    recommendedModel: "local",
    requiresApiKey: false,
    adapter: "koboldcpp"
  },
  {
    id: "anythingllm",
    name: "AnythingLLM",
    defaultBaseUrl: "http://localhost:3001/api",
    recommendedModel: "default",
    requiresApiKey: false,
    adapter: "anythingllm"
  },
  {
    id: "custom",
    name: "Custom OpenAI-compatible",
    defaultBaseUrl: "",
    recommendedModel: "",
    requiresApiKey: false,
    adapter: "openai_compatible"
  }
];

export interface AIProviderConfig {
  providerId: AIProviderId;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  enabled: boolean;
  apiKeyConfigured: boolean;
  apiKey?: string;
}

export interface AISettings {
  enabled: boolean;
  activeProviderId: AIProviderId;
  providers: AIProviderConfig[];
}

export interface AISettingsState {
  settings: AISettings;
  providerDefinitions: AIProviderDefinition[];
  activeProvider: AIProviderConfig;
}

export interface AIRequest {
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
}

export interface AIResponse {
  text: string;
  providerUsed: AIProviderId | "rules";
  modelUsed: string;
  latencyMs: number;
  tokensUsed?: number;
}

export interface ProviderTestResult {
  success: boolean;
  latencyMs: number;
  modelsList?: string[];
  error?: string;
}

export type AIAdviceContextType = "sda" | "speedDoctor";

export interface AIAdviceContext {
  healthScore: number;
  seeders: number;
  leechers: number;
  totalSizeGb: number;
  fileCategory: string;
  freeDiskGb: number | null;
  currentSpeedKb: number;
  avgSpeedKb: number;
  hourOfDay: number;
  anomalies: string[];
  suggestedProfile: string;
  reportStatus?: string;
  primaryReason?: string | null;
  activePeers?: number;
  privateTorrent?: boolean;
  metadataReady?: boolean;
}

export interface AIAdviceRequest {
  contextType: AIAdviceContextType;
  context: AIAdviceContext;
  torrentId?: string | null;
}

export interface AIAdviceResult {
  text: string;
  providerUsed: AIProviderId | "rules";
  modelUsed: string;
  latencyMs: number;
  fallback: boolean;
  generatedAt: string;
}

export const AI_EVENT_CHANNEL = "ai:event";

export const AI_IPC_CHANNELS = {
  getSettings: "ai:getSettings",
  updateSettings: "ai:updateSettings",
  testProvider: "ai:testProvider",
  listModels: "ai:listModels",
  requestAdvice: "ai:requestAdvice"
} as const;

export interface AIProviderTestedPayload {
  providerId: AIProviderId;
  result: ProviderTestResult;
}

export interface AIModelsLoadedPayload {
  providerId: AIProviderId;
  models: string[];
}

export interface AIAdviceReadyPayload {
  contextType: AIAdviceContextType;
  result: AIAdviceResult;
}

export interface AssistantLLMResponsePayload {
  torrentId: string | null;
  advice: AIAdviceResult;
}

export interface AIAdviceErrorPayload {
  contextType: AIAdviceContextType;
  fallbackText: string;
}

export interface AISettingsChangedPayload {
  state: AISettingsState;
}

export interface AIEventPayloadMap {
  "ai.provider.tested": AIProviderTestedPayload;
  "ai.models.loaded": AIModelsLoadedPayload;
  "ai.advice.ready": AIAdviceReadyPayload;
  "ai.advice.error": AIAdviceErrorPayload;
  "ai.settings.changed": AISettingsChangedPayload;
  "assistant.llm.response": AssistantLLMResponsePayload;
}

export type AIEvent = {
  [EventName in keyof AIEventPayloadMap]: {
    type: EventName;
    payload: AIEventPayloadMap[EventName];
  };
}[keyof AIEventPayloadMap];

export type AIResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

export function getAIProviderDefinition(providerId: AIProviderId) {
  return (
    AI_PROVIDER_DEFINITIONS.find((provider) => provider.id === providerId) ??
    AI_PROVIDER_DEFINITIONS[0]
  );
}

export function getAIProviderConfig(
  providers: AIProviderConfig[],
  providerId: AIProviderId
) {
  return (
    providers.find((provider) => provider.providerId === providerId) ??
    createDefaultAIProviderConfig(providerId)
  );
}

export function createDefaultAIProviderConfig(
  providerId: AIProviderId
): AIProviderConfig {
  const definition = getAIProviderDefinition(providerId);

  return {
    providerId,
    baseUrl: definition.defaultBaseUrl,
    model: definition.recommendedModel,
    timeoutMs: 15_000,
    enabled: true,
    apiKeyConfigured: false
  };
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  activeProviderId: "lmstudio",
  providers: AI_PROVIDER_DEFINITIONS.map((definition) =>
    createDefaultAIProviderConfig(definition.id)
  )
};

export function normalizeAIProviderBaseUrl(providerId: AIProviderId, value: string) {
  const normalized = trimTrailingSlash(value.trim());
  const definition = getAIProviderDefinition(providerId);

  if (!normalized || !definition.defaultBaseUrl) {
    return normalized;
  }

  try {
    const url = new URL(normalized);
    const defaultUrl = new URL(definition.defaultBaseUrl);
    const currentPath = trimTrailingSlash(url.pathname);
    const defaultPath = trimTrailingSlash(defaultUrl.pathname);

    if ((!currentPath || currentPath === "/") && defaultPath && defaultPath !== "/") {
      url.pathname = defaultPath;
      return trimTrailingSlash(url.toString());
    }
  } catch {
    return normalized;
  }

  return normalized;
}

export function isLocalAIProvider(providerId: AIProviderId) {
  return LOCAL_AI_PROVIDER_IDS.includes(providerId);
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
