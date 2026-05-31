# sTorent: Smart Download Assistant — детальная спецификация

## Назначение

Smart Download Assistant (SDA) — интеллектуальный помощник, который анализирует торрент перед и во время загрузки и принимает решения вместо пользователя там, где это безопасно, и предупреждает там, где нужен контроль человека.

Цель — не просто показать кнопки, а реально снизить число ситуаций, когда пользователь смотрит на зависший торрент и не понимает, что делать.

---

## Два режима работы

### Режим 1: детерминированный (без LLM)

Работает всегда, даже без API-ключа. Основан на правилах и числовых порогах. Быстрый, предсказуемый, не требует сети.

### Режим 2: LLM-усиленный (с API-ключом)

Пользователь вводит свой Anthropic API ключ в настройках. SDA отправляет контекст в Claude и получает человекочитаемое объяснение + рекомендацию. Ключ хранится только локально, не передаётся на серверы sTorent.

---

## Модуль 1: анализ торрента при добавлении

### Что анализируется

При добавлении `.torrent` или magnet-ссылки SDA немедленно собирает сигналы:

```
TorrentHealthContext {
  seeders: number           // количество сидеров по данным трекера
  leechers: number          // количество личеров
  trackerCount: number      // количество трекеров в торренте
  isPrivate: boolean        // флаг private в торренте
  hasWebSeeds: boolean      // наличие web-сидов (http-источников)
  totalSizeBytes: number    // суммарный размер
  fileCount: number         // количество файлов
  fileTypes: string[]       // расширения файлов (без путей, только типы)
  magnetOnly: boolean       // добавлен как magnet без .torrent
  metadataReceived: boolean // получены ли метаданные
  freeDiskBytes: number     // свободное место на целевом диске
  creationDate: number | null  // дата создания торрента (unix timestamp)
}
```

### Health Score

SDA вычисляет числовой score от 0 до 100 по формуле:

```typescript
function computeHealthScore(ctx: TorrentHealthContext): number {
  let score = 50; // базовый нейтральный балл

  // Сидеры — главный фактор
  if (ctx.seeders === 0)         score -= 40;
  else if (ctx.seeders < 3)      score -= 20;
  else if (ctx.seeders < 10)     score -= 5;
  else if (ctx.seeders >= 50)    score += 20;
  else if (ctx.seeders >= 10)    score += 10;

  // Соотношение сидеры/личеры
  const ratio = ctx.leechers > 0 ? ctx.seeders / ctx.leechers : ctx.seeders;
  if (ratio < 0.1)   score -= 15;
  else if (ratio > 2) score += 10;

  // Трекеры
  if (ctx.trackerCount === 0 && !ctx.hasWebSeeds) score -= 10;
  if (ctx.trackerCount >= 3)  score += 5;

  // Web-сиды — страховка
  if (ctx.hasWebSeeds) score += 10;

  // Свежесть
  if (ctx.creationDate) {
    const ageMonths = (Date.now() / 1000 - ctx.creationDate) / (30 * 86400);
    if (ageMonths > 24 && ctx.seeders < 5) score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}
```

### Интерпретация score

| Score    | Статус      | Цвет  | Сообщение пользователю |
|----------|-------------|-------|------------------------|
| 75–100   | Хороший     | Зелёный | «Активная раздача, загрузка пройдёт быстро» |
| 50–74   | Нормальный  | Жёлтый | «Раздача живая, скорость может быть умеренной» |
| 25–49   | Слабый      | Оранжевый | «Мало сидеров — загрузка может занять много времени» |
| 0–24    | Критический | Красный | «Загрузка под угрозой — возможно торрент мёртвый» |

Score отображается как иконка + текст в диалоге добавления. Он не блокирует загрузку — только информирует.

---

## Модуль 2: умная приоритизация файлов

### Автоматическое определение «главного» файла

SDA анализирует список файлов в торренте и определяет, что нужно пользователю в первую очередь:

```typescript
type FileCategory = 'video' | 'audio' | 'archive' | 'image' | 'document' | 'other';

const FILE_EXTENSIONS: Record<FileCategory, string[]> = {
  video: ['mkv', 'mp4', 'avi', 'mov', 'wmv', 'ts', 'm2ts'],
  audio: ['flac', 'mp3', 'wav', 'aac', 'ogg', 'm4a'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'iso'],
  image: ['jpg', 'jpeg', 'png', 'raw', 'cr2', 'nef'],
  document: ['pdf', 'epub', 'djvu', 'doc', 'docx'],
  other: [],
};
```

**Правила автоприоритета:**

- Если в торренте несколько видеофайлов с похожими именами (сезон/эпизод паттерн) — первый файл получает приоритет `high`, остальные `normal`.
- Если торрент содержит `.nfo`, `.txt`, `sample.*` — эти файлы получают приоритет `low` автоматически.
- Если торрент — один большой архив (`.iso`, `.rar`+`.r00`) — все части получают `high`, без них файл не соберётся.
- Пользователь видит предложенные приоритеты и может изменить любой до начала загрузки.

### Паттерн сезон/эпизод

```typescript
const EPISODE_PATTERN = /[Ss]\d{1,2}[Ee]\d{1,2}|[Ss]eason\s*\d+/i;

function detectSeriesOrder(files: TorrentFile[]): TorrentFile[] {
  const videoFiles = files.filter(f => isVideoFile(f.name));
  if (videoFiles.length < 2) return files;

  const hasSeries = videoFiles.some(f => EPISODE_PATTERN.test(f.name));
  if (!hasSeries) return files;

  // Сортируем по имени и выставляем первому high приоритет
  const sorted = [...videoFiles].sort((a, b) => a.name.localeCompare(b.name));
  sorted[0].suggestedPriority = 'high';
  return files;
}
```

---

## Модуль 3: предупреждения перед загрузкой

SDA проверяет набор условий и формирует список предупреждений. Каждое предупреждение имеет уровень (`warn` или `error`) и опциональное быстрое действие.

### Список проверок

```typescript
interface AssistantWarning {
  id: string;
  level: 'warn' | 'error';
  message: string;
  quickAction?: {
    label: string;
    action: () => void;
  };
}

function collectWarnings(ctx: TorrentHealthContext, settings: AppSettings): AssistantWarning[] {
  const warnings: AssistantWarning[] = [];

  // Нет места на диске
  if (ctx.totalSizeBytes > ctx.freeDiskBytes * 0.95) {
    warnings.push({
      id: 'disk_full',
      level: 'error',
      message: `Недостаточно места: нужно ${formatBytes(ctx.totalSizeBytes)}, доступно ${formatBytes(ctx.freeDiskBytes)}`,
      quickAction: { label: 'Выбрать другую папку', action: () => openFolderPicker() },
    });
  }

  // Мертвая раздача
  if (ctx.seeders === 0 && !ctx.hasWebSeeds) {
    warnings.push({
      id: 'no_seeders',
      level: 'warn',
      message: 'Нет активных сидеров. Загрузка начнётся, но может не завершиться.',
    });
  }

  // Устаревший торрент без сидеров
  if (ctx.creationDate) {
    const ageYears = (Date.now() / 1000 - ctx.creationDate) / (365 * 86400);
    if (ageYears > 2 && ctx.seeders < 3) {
      warnings.push({
        id: 'old_torrent',
        level: 'warn',
        message: `Торрент создан более ${Math.floor(ageYears)} лет назад и почти не раздаётся.`,
      });
    }
  }

  // Приватный торрент без трекера
  if (ctx.isPrivate && ctx.trackerCount === 0) {
    warnings.push({
      id: 'private_no_tracker',
      level: 'error',
      message: 'Приватный торрент без трекера — загрузка невозможна.',
    });
  }

  // Конфликт имён файлов (два файла с одинаковым именем в разных папках)
  // Реализуется отдельной проверкой по списку файлов метаданных

  return warnings;
}
```

---

## Модуль 4: умные профили загрузки

### Профили

Профиль — набор настроек, который применяется к одному торренту при добавлении. Пользователь может выбрать профиль вручную или SDA предложит подходящий.

```typescript
interface DownloadProfile {
  id: string;
  name: string;            // отображаемое имя
  description: string;     // одна строка для пользователя
  downloadLimitKb: number; // 0 = без лимита
  uploadLimitKb: number;
  maxConnections: number;
  seedRatioLimit: number;  // 0 = не сидировать после
  encryption: 'prefer' | 'force' | 'disable';
  sequentialDownload: boolean;
}

const BUILT_IN_PROFILES: DownloadProfile[] = [
  {
    id: 'fast',
    name: 'Максимальная скорость',
    description: 'Без лимитов, максимум соединений',
    downloadLimitKb: 0,
    uploadLimitKb: 0,
    maxConnections: 200,
    seedRatioLimit: 1.0,
    encryption: 'prefer',
    sequentialDownload: false,
  },
  {
    id: 'background',
    name: 'Фоновая загрузка',
    description: 'Медленно, не мешает другим приложениям',
    downloadLimitKb: 1024,  // 1 MB/s
    uploadLimitKb: 256,
    maxConnections: 50,
    seedRatioLimit: 2.0,
    encryption: 'prefer',
    sequentialDownload: false,
  },
  {
    id: 'streaming',
    name: 'Стриминг',
    description: 'Последовательная загрузка — для просмотра во время скачивания',
    downloadLimitKb: 0,
    uploadLimitKb: 512,
    maxConnections: 100,
    seedRatioLimit: 0.5,
    encryption: 'prefer',
    sequentialDownload: true,  // последовательная загрузка
  },
  {
    id: 'private',
    name: 'Приватный режим',
    description: 'Принудительное шифрование, отключены DHT и PEX',
    downloadLimitKb: 0,
    uploadLimitKb: 0,
    maxConnections: 100,
    seedRatioLimit: 1.0,
    encryption: 'force',
    sequentialDownload: false,
  },
];
```

### Автовыбор профиля

```typescript
function suggestProfile(ctx: TorrentHealthContext): string {
  // Видео-файлы — стриминг
  const isVideoTorrent = ctx.fileTypes.some(ext =>
    ['mkv', 'mp4', 'avi', 'mov'].includes(ext)
  );
  if (isVideoTorrent && ctx.fileCount <= 5) return 'streaming';

  // Приватный торрент — приватный профиль
  if (ctx.isPrivate) return 'private';

  // Большой архив ночью (определяется через расписание)
  const hour = new Date().getHours();
  const isNight = hour >= 23 || hour < 7;
  if (ctx.totalSizeBytes > 10 * 1024 * 1024 * 1024 && isNight) return 'fast';

  // По умолчанию фоновая
  return 'background';
}
```

---

## Модуль 5: умное расписание

### Анализ скорости по времени суток

SDA собирает статистику реальных скоростей по часам. Данные хранятся локально в SQLite:

```sql
CREATE TABLE speed_history (
  id INTEGER PRIMARY KEY,
  recorded_at INTEGER NOT NULL,  -- unix timestamp
  hour_of_day INTEGER NOT NULL,  -- 0-23
  download_speed_kb INTEGER,
  upload_speed_kb INTEGER,
  peer_count INTEGER
);
```

После накопления ~7 дней данных SDA может предсказывать лучшее время для загрузки:

```typescript
async function getBestDownloadHours(): Promise<number[]> {
  const rows = await db.all(`
    SELECT hour_of_day, AVG(download_speed_kb) as avg_speed
    FROM speed_history
    WHERE recorded_at > strftime('%s', 'now') - 7 * 86400
    GROUP BY hour_of_day
    ORDER BY avg_speed DESC
    LIMIT 4
  `);
  return rows.map(r => r.hour_of_day);
}
```

Пример подсказки: «Обычно у вас быстрее всего в 2:00–6:00. Поставить загрузку по расписанию?»

---

## Модуль 6: AI-советник (опциональный)

### Когда активируется

Только если пользователь настроил AI-провайдера в настройках → секция «AI-советник». Провайдер может быть любым — облачным или локальным. Подробная спецификация в `12-ai-providers.md`.

### Как вызывается из SDA

SDA использует `AIAdvisor` из универсального AI-слоя:

```typescript
// Контекст для AI — только числа и категории, без имён файлов и путей
const context: AIRequestContext = {
  healthScore,
  seeders: ctx.seeders,
  leechers: ctx.leechers,
  totalSizeGb: ctx.totalSizeBytes / (1024 ** 3),
  fileCategory,
  freeDiskGb: ctx.freeDiskBytes / (1024 ** 3),
  currentSpeedKb: metrics.downloadSpeedKb,
  avgSpeedKb: baseline.getWeeklyAverage(),
  hourOfDay: new Date().getHours(),
  anomalies: detectedAnomalies.map(a => a.type),
  suggestedProfile,
};

const advisor = new AIAdvisor(aiSettings.activeConfig);
const advice = await advisor.advise(context);
```

Если AI не настроен или вернул ошибку — `AIAdvisor` автоматически возвращает детерминированный совет на основе правил. SDA никогда не остаётся без ответа.

### Отображение в UI

Ответ AI показывается как «облачко совета» под health score в диалоге добавления торрента. Рядом — кнопка «Применить рекомендованный профиль».

Если AI не настроен — блок советника скрыт. Все остальные модули работают без него.

---

## Хранение данных SDA

```
storage/
  assistant/
    speed_history.db      -- статистика скоростей по часам
    profile_usage.json    -- какие профили пользователь применял
    warning_dismissed.json -- какие предупреждения пользователь отклонял
```

Файлы исключены из репозитория через `.gitignore`. Не содержат персональных данных или путей к файлам.

---

## Что SDA никогда не делает

- Не отправляет имена файлов, пути, трекеры или IP куда-либо.
- Не принимает решения за пользователя без подтверждения.
- Не блокирует загрузку — только предупреждает.
- Не хранит историю загрузок в облаке.
- Не использует LLM без явного ввода API-ключа пользователем.

---

## IPC-события SDA

```typescript
// Main → Renderer
'assistant.health.computed'     // { torrentId, score, warnings, suggestedProfile }
'assistant.llm.response'        // { torrentId, advice }
'assistant.schedule.suggestion' // { torrentId, bestHours }

// Renderer → Main
'assistant.profile.apply'       // { torrentId, profileId }
'assistant.warning.dismiss'     // { warningId }
'assistant.llm.request'         // { torrentId } — пользователь нажал "Спросить AI"
```

---

## Связанные документы

- `04-architecture.md` — Smart Assistant Engine в общей архитектуре
- `11-speed-doctor.md` — диагностика сети
- `12-ai-providers.md` — универсальный AI-слой, все провайдеры и адаптеры
- `02-functional-requirements.md` — функциональные требования к SDA
- `06-roadmap.md` — этапы внедрения SDA
