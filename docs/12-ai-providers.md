# sTorent: универсальный AI-слой — детальная спецификация

## Назначение

sTorent поддерживает подключение любого LLM-провайдера через единый интерфейс. Пользователь выбирает провайдера в настройках, вводит свой ключ (или локальный адрес), и весь AI-функционал — Smart Download Assistant и Speed Doctor — работает через него.

Ни один провайдер не является встроенным или обязательным. Если AI не настроен — приложение работает полностью без него.

---

## Поддерживаемые провайдеры

### Облачные (требуют API-ключ)

| Провайдер | ID | Базовый URL | Совместимость |
|-----------|-----|-------------|---------------|
| Anthropic Claude | `anthropic` | `https://api.anthropic.com/v1` | Нативный API |
| OpenAI | `openai` | `https://api.openai.com/v1` | OpenAI API |
| Google Gemini | `gemini` | `https://generativelanguage.googleapis.com/v1beta` | Нативный API |
| Mistral | `mistral` | `https://api.mistral.ai/v1` | OpenAI-совместимый |
| Groq | `groq` | `https://api.groq.com/openai/v1` | OpenAI-совместимый |
| Together AI | `together` | `https://api.together.xyz/v1` | OpenAI-совместимый |
| OpenRouter | `openrouter` | `https://openrouter.ai/api/v1` | OpenAI-совместимый |

### Локальные (API-ключ не нужен)

| Провайдер | ID | Базовый URL по умолчанию | Примечание |
|-----------|-----|--------------------------|------------|
| LM Studio | `lmstudio` | `http://localhost:1234/v1` | OpenAI-совместимый |
| Ollama | `ollama` | `http://localhost:11434/v1` | OpenAI-совместимый |
| Jan | `jan` | `http://localhost:1337/v1` | OpenAI-совместимый |
| llama.cpp server | `llamacpp` | `http://localhost:8080/v1` | OpenAI-совместимый |
| Text Generation WebUI | `textgenwebui` | `http://localhost:5000/v1` | OpenAI-совместимый |
| Kobold.cpp | `koboldcpp` | `http://localhost:5001/api/v1` | Нативный API |
| AnythingLLM | `anythingllm` | `http://localhost:3001/api` | Нативный API |
| Пользовательский | `custom` | задаётся вручную | OpenAI-совместимый |

---

## Архитектура AI-слоя

```
┌─────────────────────────────────┐
│         AI-клиент sTorent       │
│  (AIAdvisor — единая точка)     │
└───────────────┬─────────────────┘
                │ вызывает
┌───────────────▼─────────────────┐
│      AIProviderAdapter          │
│  (выбирает нужный адаптер)      │
└──┬────────┬────────┬────────┬───┘
   │        │        │        │
   ▼        ▼        ▼        ▼
OpenAI  Anthropic  Gemini  Kobold
Adapter  Adapter  Adapter  Adapter
   │        │        │        │
   └────────┴────────┴────────┘
                │
        реальный HTTP-запрос
        к провайдеру
```

### Ключевой принцип

Большинство локальных серверов (LM Studio, Ollama, Jan, llama.cpp) реализуют OpenAI-совместимый API — один адаптер закрывает все эти случаи. Нативные адаптеры нужны только для Anthropic, Gemini и нескольких специфичных серверов.

---

## Типы и интерфейсы

```typescript
// Конфигурация провайдера (хранится в настройках)
interface AIProviderConfig {
  providerId: string;           // 'anthropic' | 'openai' | 'lmstudio' | 'ollama' | ...
  baseUrl: string;              // URL эндпоинта
  apiKey: string;               // пустая строка для локальных провайдеров
  model: string;                // конкретная модель
  timeoutMs: number;            // таймаут запроса, default: 15000
  enabled: boolean;
}

// Запрос к AI (единый для всех провайдеров)
interface AIRequest {
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  temperature: number;
}

// Ответ от AI (единый для всех провайдеров)
interface AIResponse {
  text: string;
  providerUsed: string;
  modelUsed: string;
  latencyMs: number;
  tokensUsed?: number;
}

// Результат проверки подключения
interface ProviderTestResult {
  success: boolean;
  latencyMs: number;
  modelsList?: string[];   // модели, доступные на этом провайдере
  error?: string;
}

// Абстрактный адаптер
interface AIAdapter {
  providerId: string;
  test(config: AIProviderConfig): Promise<ProviderTestResult>;
  complete(config: AIProviderConfig, request: AIRequest): Promise<AIResponse>;
  listModels(config: AIProviderConfig): Promise<string[]>;
}
```

---

## Реализация адаптеров

### OpenAI-совместимый адаптер

Один адаптер покрывает: OpenAI, Mistral, Groq, Together, OpenRouter, LM Studio, Ollama, Jan, llama.cpp server, Text Generation WebUI, пользовательский эндпоинт.

```typescript
class OpenAICompatibleAdapter implements AIAdapter {
  providerId = 'openai_compatible';

  async complete(config: AIProviderConfig, request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Для локальных провайдеров ключ не нужен, но некоторые требуют любую строку
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    // OpenRouter требует дополнительный заголовок
    if (config.providerId === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/sattop/sTorrent';
      headers['X-Title'] = 'sTorent';
    }

    const body = {
      model: config.model,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userMessage },
      ],
    };

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new AIProviderError(config.providerId, response.status, errorText);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content ?? '';

    return {
      text,
      providerUsed: config.providerId,
      modelUsed: config.model,
      latencyMs: Date.now() - startTime,
      tokensUsed: data.usage?.total_tokens,
    };
  }

  async listModels(config: AIProviderConfig): Promise<string[]> {
    const headers: Record<string, string> = {};
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    try {
      const response = await fetch(`${config.baseUrl}/models`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      const data = await response.json();
      return (data.data ?? []).map((m: any) => m.id as string);
    } catch {
      return [];
    }
  }

  async test(config: AIProviderConfig): Promise<ProviderTestResult> {
    const start = Date.now();
    try {
      const models = await this.listModels(config);
      return {
        success: true,
        latencyMs: Date.now() - start,
        modelsList: models,
      };
    } catch (err: any) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        error: err.message,
      };
    }
  }
}
```

### Anthropic-адаптер

```typescript
class AnthropicAdapter implements AIAdapter {
  providerId = 'anthropic';

  async complete(config: AIProviderConfig, request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();

    const response = await fetch(`${config.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: request.maxTokens,
        system: request.systemPrompt,
        messages: [{ role: 'user', content: request.userMessage }],
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new AIProviderError('anthropic', response.status, errorData.error?.message ?? '');
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? '';

    return {
      text,
      providerUsed: 'anthropic',
      modelUsed: config.model,
      latencyMs: Date.now() - startTime,
      tokensUsed: data.usage?.input_tokens + data.usage?.output_tokens,
    };
  }

  async listModels(_config: AIProviderConfig): Promise<string[]> {
    // Anthropic не имеет публичного /models эндпоинта — возвращаем известные
    return [
      'claude-opus-4-5',
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
    ];
  }

  async test(config: AIProviderConfig): Promise<ProviderTestResult> {
    const start = Date.now();
    try {
      // Минимальный тестовый запрос
      await this.complete(config, {
        systemPrompt: 'Respond with only: ok',
        userMessage: 'ping',
        maxTokens: 5,
        temperature: 0,
      });
      return { success: true, latencyMs: Date.now() - start };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, error: err.message };
    }
  }
}
```

### Gemini-адаптер

```typescript
class GeminiAdapter implements AIAdapter {
  providerId = 'gemini';

  async complete(config: AIProviderConfig, request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();

    const url = `${config.baseUrl}/models/${config.model}:generateContent?key=${config.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: request.userMessage }] }],
        generationConfig: {
          maxOutputTokens: request.maxTokens,
          temperature: request.temperature,
        },
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    return {
      text,
      providerUsed: 'gemini',
      modelUsed: config.model,
      latencyMs: Date.now() - startTime,
    };
  }

  async listModels(config: AIProviderConfig): Promise<string[]> {
    const url = `${config.baseUrl}/models?key=${config.apiKey}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await resp.json();
    return (data.models ?? [])
      .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: any) => m.name.replace('models/', ''));
  }

  async test(config: AIProviderConfig): Promise<ProviderTestResult> {
    const start = Date.now();
    try {
      const models = await this.listModels(config);
      return { success: true, latencyMs: Date.now() - start, modelsList: models };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, error: err.message };
    }
  }
}
```

### Kobold.cpp адаптер

```typescript
class KoboldAdapter implements AIAdapter {
  providerId = 'koboldcpp';

  async complete(config: AIProviderConfig, request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();

    // Kobold использует /api/v1/generate с другим форматом
    const prompt = `${request.systemPrompt}\n\n${request.userMessage}`;

    const response = await fetch(`${config.baseUrl}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        max_length: request.maxTokens,
        temperature: request.temperature,
        stop_sequence: ['\n\n'],
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });

    const data = await response.json();
    const text = data.results?.[0]?.text ?? '';

    return {
      text: text.trim(),
      providerUsed: 'koboldcpp',
      modelUsed: 'local',
      latencyMs: Date.now() - startTime,
    };
  }

  async listModels(config: AIProviderConfig): Promise<string[]> {
    try {
      const resp = await fetch(`${config.baseUrl}/model`, { signal: AbortSignal.timeout(3000) });
      const data = await resp.json();
      return data.result ? [data.result] : ['local'];
    } catch {
      return ['local'];
    }
  }

  async test(config: AIProviderConfig): Promise<ProviderTestResult> {
    const start = Date.now();
    try {
      const models = await this.listModels(config);
      return { success: true, latencyMs: Date.now() - start, modelsList: models };
    } catch (err: any) {
      return { success: false, latencyMs: Date.now() - start, error: err.message };
    }
  }
}
```

---

## AIAdvisor — единая точка для SDA и Speed Doctor

```typescript
class AIAdvisor {
  private adapter: AIAdapter;
  private config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
    this.adapter = AIAdvisor.createAdapter(config.providerId);
  }

  static createAdapter(providerId: string): AIAdapter {
    switch (providerId) {
      case 'anthropic':    return new AnthropicAdapter();
      case 'gemini':       return new GeminiAdapter();
      case 'koboldcpp':    return new KoboldAdapter();
      default:             return new OpenAICompatibleAdapter();
      // Все остальные (openai, mistral, groq, together, openrouter,
      // lmstudio, ollama, jan, llamacpp, textgenwebui, custom)
      // используют OpenAI-совместимый адаптер
    }
  }

  // Системный промпт — одинаковый для всех провайдеров
  private readonly SYSTEM_PROMPT = `Ты — встроенный помощник торрент-клиента sTorent.
Отвечай строго по-русски.
Давай конкретный практичный совет: 2–3 предложения максимум.
Не используй markdown, списки или заголовки.
Не объясняй что такое BitTorrent.
Не упоминай название модели или провайдера.
Если данных недостаточно — скажи это честно одним предложением.`;

  async advise(context: AIRequestContext): Promise<string> {
    const request: AIRequest = {
      systemPrompt: this.SYSTEM_PROMPT,
      userMessage: this.buildMessage(context),
      maxTokens: 200,
      temperature: 0.3,
    };

    try {
      const response = await this.adapter.complete(this.config, request);
      return response.text;
    } catch (err: any) {
      // Возвращаем детерминированный fallback если AI недоступен
      return this.deterministicAdvice(context);
    }
  }

  private buildMessage(ctx: AIRequestContext): string {
    return [
      `Health score: ${ctx.healthScore}/100`,
      `Сидеров: ${ctx.seeders}, личеров: ${ctx.leechers}`,
      `Размер: ${ctx.totalSizeGb.toFixed(1)} ГБ`,
      `Тип файлов: ${ctx.fileCategory}`,
      `Свободно на диске: ${ctx.freeDiskGb.toFixed(1)} ГБ`,
      `Текущая скорость: ${ctx.currentSpeedKb} КБ/с`,
      `Средняя за неделю: ${ctx.avgSpeedKb} КБ/с`,
      `Час суток: ${ctx.hourOfDay}:00`,
      ctx.anomalies.length > 0
        ? `Аномалии: ${ctx.anomalies.join(', ')}`
        : 'Аномалии: нет',
      `Предложенный профиль: ${ctx.suggestedProfile}`,
      `\nЧто посоветуешь?`,
    ].join('\n');
  }

  // Детерминированный совет без AI — всегда работает
  private deterministicAdvice(ctx: AIRequestContext): string {
    if (ctx.seeders === 0) return 'Нет активных сидеров — загрузка может не завершиться. Попробуйте добавить публичные трекеры.';
    if (ctx.healthScore < 30) return 'Раздача очень слабая. Рекомендую добавить публичные трекеры или поставить загрузку на ночь.';
    if (ctx.anomalies.includes('isp_throttling_suspect')) return 'Похоже, провайдер режет трафик. Попробуйте включить шифрование или запланировать загрузку на ночь.';
    if (ctx.anomalies.includes('disk_bottleneck')) return 'Диск не успевает за загрузкой. Уменьшите количество одновременных соединений.';
    if (ctx.currentSpeedKb < ctx.avgSpeedKb * 0.3) return 'Скорость значительно ниже обычной. Запустите диагностику Speed Doctor.';
    return 'Загрузка идёт в штатном режиме. Выбранный профиль оптимален.';
  }

  async test(): Promise<ProviderTestResult> {
    return this.adapter.test(this.config);
  }

  async listModels(): Promise<string[]> {
    return this.adapter.listModels(this.config);
  }
}
```

---

## Обработка ошибок

```typescript
class AIProviderError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly statusCode: number,
    public readonly detail: string,
  ) {
    super(`[${providerId}] HTTP ${statusCode}: ${detail}`);
  }
}

// Типичные ошибки и что показывать пользователю
const ERROR_MESSAGES: Record<number, string> = {
  401: 'Неверный API-ключ. Проверьте настройки.',
  403: 'Доступ запрещён. Проверьте права ключа.',
  429: 'Превышен лимит запросов. Попробуйте позже.',
  500: 'Ошибка на стороне провайдера. Попробуйте позже.',
  0:   'Не удалось подключиться. Проверьте адрес и доступность сервера.',
};
```

---

## Настройки в UI

### Экран настроек → секция «AI-советник»

```
╔══════════════════════════════════════════════╗
║  AI-советник                                 ║
╠══════════════════════════════════════════════╣
║                                              ║
║  Провайдер: [LM Studio          ▼]           ║
║                                              ║
║  Адрес:     [http://localhost:1234/v1      ] ║
║  API-ключ:  [не требуется                  ] ║
║  Модель:    [mistral-7b-instruct  ▼]         ║
║             [Загрузить список моделей]        ║
║                                              ║
║  [Проверить подключение]                     ║
║  ✓ Подключено · 234 мс · 12 моделей          ║
║                                              ║
╠══════════════════════════════════════════════╣
║  Провайдер: [Anthropic Claude    ▼]           ║
║  API-ключ:  [sk-ant-••••••••••••••••••••   ] ║
║  Модель:    [claude-haiku-4-5     ▼]         ║
║                                              ║
║  [Проверить подключение]                     ║
║  ✗ Неверный API-ключ                         ║
╚══════════════════════════════════════════════╝
```

**Поведение списка провайдеров:**

При выборе провайдера из выпадающего списка:
- Поле «Адрес» заполняется дефолтным URL автоматически
- Если провайдер локальный — поле «API-ключ» скрывается
- Нажатие «Загрузить список моделей» делает запрос к `/models` и заполняет дропдаун

**Провайдер «Пользовательский»:**
- Открывает поля «Адрес» и «API-ключ» для ручного ввода
- Используется OpenAI-совместимый адаптер
- Подходит для любого сервера с OpenAI API

---

## Рекомендации по моделям

Для задач SDA и Speed Doctor (короткие аналитические ответы, ~200 токенов) хорошо работают:

| Провайдер | Рекомендуемая модель | Примечание |
|-----------|---------------------|------------|
| Anthropic | `claude-haiku-4-5` | Быстрый, дешёвый |
| OpenAI | `gpt-4o-mini` | Хороший баланс |
| Groq | `llama-3.1-8b-instant` | Очень быстрый |
| LM Studio | `mistral-7b-instruct` | Хорошо работает локально |
| Ollama | `llama3.2:3b` | Быстрый на большинстве машин |
| llama.cpp | любая Q4_K_M модель | Зависит от железа пользователя |
| OpenRouter | `meta-llama/llama-3.1-8b-instruct:free` | Бесплатный вариант |

---

## Хранение конфигурации

```typescript
// Хранится в настройках приложения (settings.json или SQLite)
interface AISettings {
  enabled: boolean;
  activeProviderId: string;
  providers: AIProviderConfig[];
}

// Дефолтные значения (AI выключен по умолчанию)
const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  activeProviderId: '',
  providers: [],
};
```

**Безопасность хранения ключей:**

API-ключи хранятся в системном Keychain через `electron-keytar` или аналог:

```typescript
import keytar from 'electron-keytar';

const SERVICE = 'sTorent-ai-keys';

async function saveApiKey(providerId: string, key: string): Promise<void> {
  await keytar.setPassword(SERVICE, providerId, key);
}

async function loadApiKey(providerId: string): Promise<string> {
  return await keytar.getPassword(SERVICE, providerId) ?? '';
}
```

Ключи **не попадают** в:
- `settings.json` — только ID провайдера и URL
- логи приложения
- диагностические отчёты
- репозиторий (`.gitignore`)

---

## IPC-события AI-слоя

```typescript
// Main → Renderer
'ai.provider.tested'     // { providerId, result: ProviderTestResult }
'ai.models.loaded'       // { providerId, models: string[] }
'ai.advice.ready'        // { contextType: 'sda' | 'speedDoctor', text: string }
'ai.advice.error'        // { contextType, fallbackText: string }

// Renderer → Main
'ai.provider.test'       // { config: AIProviderConfig }
'ai.models.load'         // { config: AIProviderConfig }
'ai.advice.request'      // { contextType, context: AIRequestContext }
'ai.settings.save'       // { settings: AISettings }
```

---

## Связанные документы

- `10-smart-download-assistant.md` — использует AIAdvisor в Модуле 6
- `11-speed-doctor.md` — использует AIAdvisor для объяснения диагнозов
- `04-architecture.md` — AI-слой как отдельный модуль архитектуры
- `05-networking-privacy.md` — что передаётся провайдерам, что остаётся локально
