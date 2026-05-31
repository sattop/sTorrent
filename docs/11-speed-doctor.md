# sTorent: Speed Doctor — детальная спецификация

## Назначение

Speed Doctor — модуль диагностики и автоисправления проблем со скоростью и сетевым подключением. Он не просто показывает цифры — он находит причины, объясняет их простым языком и предлагает конкретные действия.

Главный принцип: пользователь видит проблему → понимает причину → получает кнопку для исправления. Без технических терминов там, где они не нужны.

---

## Два уровня диагностики

### Уровень 1: быстрая проверка (запускается автоматически)

Занимает < 3 секунд. Запускается при каждом старте приложения и при добавлении торрента. Проверяет только локальные условия без внешних запросов.

### Уровень 2: полная диагностика (по кнопке пользователя)

Занимает 10–30 секунд. Включает внешние тесты: проверку порта снаружи, анализ трекеров, тест скорости. Запускается только когда пользователь явно нажимает «Запустить диагностику».

---

## Модуль 1: проверка порта

### Что проверяется

```typescript
interface PortCheckResult {
  port: number;
  protocol: 'tcp' | 'udp';
  localBinding: 'ok' | 'error' | 'in_use';
  upnpStatus: 'enabled' | 'disabled' | 'unavailable' | 'error';
  natPmpStatus: 'enabled' | 'disabled' | 'unavailable';
  externallyReachable: boolean | null;  // null если внешняя проверка не запускалась
  firewallBlocked: boolean | null;
}
```

### Локальная проверка (Уровень 1)

```typescript
async function checkLocalPort(port: number): Promise<Partial<PortCheckResult>> {
  // Пробуем bind на порт
  try {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
      server.listen(port, () => { server.close(); resolve(); });
      server.on('error', reject);
    });
    return { localBinding: 'ok' };
  } catch (err: any) {
    if (err.code === 'EADDRINUSE') return { localBinding: 'in_use' };
    return { localBinding: 'error' };
  }
}
```

### Внешняя проверка (Уровень 2)

Используем публичные сервисы для проверки доступности порта снаружи. Запрос отправляется только к нашему открытому эндпоинту или к публичным port-check сервисам. Никаких данных о загрузках не передаётся.

```typescript
async function checkExternalPort(port: number): Promise<boolean> {
  // Пробуем несколько независимых источников
  const checkers = [
    `https://portchecker.co/check?port=${port}`,
    // fallback — собственный lightweight endpoint если появится
  ];

  for (const url of checkers) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await response.json();
      if (typeof data.open === 'boolean') return data.open;
    } catch {
      continue;
    }
  }
  return false; // не смогли проверить — считаем закрытым
}
```

### UPnP-автоисправление

Если порт закрыт, но UPnP доступен:

```typescript
async function tryUPnPMapping(port: number): Promise<boolean> {
  // Используем node-upnp-client или аналог
  try {
    const gateway = await upnp.getGateway();
    await gateway.createMapping({
      public: port,
      private: port,
      ttl: 3600,
      description: 'sTorent BitTorrent',
      protocol: 'TCP',
    });
    await gateway.createMapping({ ...same, protocol: 'UDP' });
    return true;
  } catch {
    return false;
  }
}
```

---

## Модуль 2: диагностика скорости

### Сбор метрик в реальном времени

Speed Doctor непрерывно собирает метрики пока идут загрузки:

```typescript
interface SpeedMetrics {
  timestamp: number;
  downloadSpeedKb: number;
  uploadSpeedKb: number;
  activeTorrents: number;
  activePeers: number;
  chokedPeers: number;       // пиры, которые нас заблокировали
  unchokedPeers: number;
  dhtNodes: number;
  trackerErrors: number;     // ошибки трекеров за последнюю минуту
  diskWriteSpeedKb: number;  // скорость записи на диск
  diskQueueDepth: number;    // глубина очереди записи
}
```

### Детектирование аномалий

```typescript
interface SpeedAnomaly {
  type: AnomalyType;
  severity: 'low' | 'medium' | 'high';
  detectedAt: number;
  context: Record<string, number>;
}

type AnomalyType =
  | 'speed_drop_sudden'      // резкое падение скорости
  | 'speed_below_baseline'   // скорость ниже обычной для этого часа
  | 'all_peers_choked'       // все пиры нас заблокировали
  | 'disk_bottleneck'        // диск не успевает за загрузкой
  | 'tracker_errors'         // трекеры отвечают ошибками
  | 'dht_degraded'           // DHT работает плохо
  | 'isp_throttling_suspect' // подозрение на резку трафика провайдером

function detectAnomalies(
  current: SpeedMetrics,
  history: SpeedMetrics[],
  baseline: HourlyBaseline
): SpeedAnomaly[] {
  const anomalies: SpeedAnomaly[] = [];
  const prev5min = history.slice(-5);
  const avgPrev = avg(prev5min.map(m => m.downloadSpeedKb));

  // Резкое падение скорости
  if (avgPrev > 500 && current.downloadSpeedKb < avgPrev * 0.3) {
    anomalies.push({
      type: 'speed_drop_sudden',
      severity: 'high',
      detectedAt: current.timestamp,
      context: { from: avgPrev, to: current.downloadSpeedKb },
    });
  }

  // Скорость ниже исторической нормы для этого часа
  const hour = new Date(current.timestamp).getHours();
  const expectedSpeed = baseline.getExpectedSpeed(hour);
  if (expectedSpeed > 1000 && current.downloadSpeedKb < expectedSpeed * 0.4) {
    anomalies.push({
      type: 'speed_below_baseline',
      severity: 'medium',
      detectedAt: current.timestamp,
      context: { expected: expectedSpeed, actual: current.downloadSpeedKb },
    });
  }

  // Диск — узкое место
  if (current.diskQueueDepth > 50 && current.diskWriteSpeedKb < current.downloadSpeedKb * 0.7) {
    anomalies.push({
      type: 'disk_bottleneck',
      severity: 'medium',
      detectedAt: current.timestamp,
      context: { queue: current.diskQueueDepth },
    });
  }

  // Подозрение на ISP throttling
  // Признак: скорость падает именно после 18:00 и восстанавливается после 23:00
  // Требует минимум 3 дней истории
  const throttlingDetected = detectISPThrottling(history, baseline);
  if (throttlingDetected.suspected) {
    anomalies.push({
      type: 'isp_throttling_suspect',
      severity: 'medium',
      detectedAt: current.timestamp,
      context: { peakHours: throttlingDetected.slowHours },
    });
  }

  return anomalies;
}
```

### Детектор ISP throttling

```typescript
interface ThrottlingAnalysis {
  suspected: boolean;
  confidence: number;     // 0.0–1.0
  slowHours: number[];    // часы с аномально низкой скоростью
  fastHours: number[];
  speedDropPercent: number;
}

function detectISPThrottling(
  history: SpeedMetrics[],
  baseline: HourlyBaseline
): ThrottlingAnalysis {
  if (history.length < 3 * 24 * 60) {
    // Нужно минимум 3 дня данных (по 1 записи в минуту)
    return { suspected: false, confidence: 0, slowHours: [], fastHours: [], speedDropPercent: 0 };
  }

  // Вычисляем среднюю скорость по каждому часу суток
  const hourlyAvg: number[] = Array(24).fill(0);
  const hourlyCount: number[] = Array(24).fill(0);

  for (const m of history) {
    const h = new Date(m.timestamp * 1000).getHours();
    hourlyAvg[h] += m.downloadSpeedKb;
    hourlyCount[h]++;
  }

  const normalizedAvg = hourlyAvg.map((sum, h) =>
    hourlyCount[h] > 0 ? sum / hourlyCount[h] : 0
  );

  const maxSpeed = Math.max(...normalizedAvg);
  const minSpeed = Math.min(...normalizedAvg.filter(s => s > 0));

  if (maxSpeed === 0) return { suspected: false, confidence: 0, slowHours: [], fastHours: [], speedDropPercent: 0 };

  const dropPercent = ((maxSpeed - minSpeed) / maxSpeed) * 100;

  // Throttling подозревается если:
  // 1. Разброс > 60%
  // 2. Медленные часы кластеризованы (обычно вечер 18:00–22:00)
  const slowHours = normalizedAvg
    .map((speed, h) => ({ speed, h }))
    .filter(({ speed }) => speed < maxSpeed * 0.4)
    .map(({ h }) => h);

  const isEveningCluster = slowHours.some(h => h >= 17 && h <= 22);

  return {
    suspected: dropPercent > 60 && isEveningCluster,
    confidence: dropPercent > 60 && isEveningCluster ? Math.min(0.9, dropPercent / 100) : 0,
    slowHours,
    fastHours: normalizedAvg
      .map((speed, h) => ({ speed, h }))
      .filter(({ speed }) => speed > maxSpeed * 0.8)
      .map(({ h }) => h),
    speedDropPercent: dropPercent,
  };
}
```

---

## Модуль 3: диагностический отчёт

### Структура

```typescript
interface DiagnosticReport {
  generatedAt: number;
  appVersion: string;
  // Сетевые проверки
  portCheck: PortCheckResult;
  upnpAvailable: boolean;
  dhtNodeCount: number;
  trackerResponsiveness: TrackerStatus[];
  // Скорость
  currentSpeedKb: number;
  peakSpeedLast24hKb: number;
  averageSpeedByHour: number[];   // 24 значения
  // Аномалии
  detectedAnomalies: SpeedAnomaly[];
  ispThrottling: ThrottlingAnalysis;
  // Диск
  diskWriteSpeedKb: number;
  diskType: 'ssd' | 'hdd' | 'unknown';
  // Итоговые диагнозы
  diagnoses: Diagnosis[];
}

interface Diagnosis {
  id: string;
  severity: 'info' | 'warn' | 'error';
  title: string;           // короткое название проблемы
  explanation: string;     // объяснение для пользователя без техножаргона
  actions: DiagnosticAction[];
}

interface DiagnosticAction {
  id: string;
  label: string;
  type: 'auto' | 'manual' | 'settings' | 'external';
  // 'auto'     — выполняем сами при нажатии
  // 'manual'   — показываем инструкцию
  // 'settings' — открываем нужный экран настроек
  // 'external' — ссылка на внешний ресурс (инструкция по роутеру)
  handler?: () => Promise<void>;
  instruction?: string;
  url?: string;
}
```

### Библиотека диагнозов

```typescript
const DIAGNOSES_LIBRARY: Record<string, (report: DiagnosticReport) => Diagnosis | null> = {

  port_closed: (r) => {
    if (r.portCheck.externallyReachable === false) return {
      id: 'port_closed',
      severity: 'warn',
      title: 'Входящий порт закрыт',
      explanation: 'Другие пользователи не могут напрямую подключиться к вам. Это снижает скорость и количество пиров.',
      actions: [
        r.upnpAvailable ? {
          id: 'upnp_fix',
          label: 'Открыть порт автоматически (UPnP)',
          type: 'auto',
          handler: () => tryUPnPMapping(r.portCheck.port),
        } : null,
        {
          id: 'manual_port',
          label: 'Как открыть порт на роутере',
          type: 'external',
          url: 'https://portforward.com',
        },
        {
          id: 'change_port',
          label: 'Попробовать другой порт',
          type: 'settings',
        },
      ].filter(Boolean) as DiagnosticAction[],
    };
    return null;
  },

  all_peers_choked: (r) => {
    const lastMetrics = r.detectedAnomalies.find(a => a.type === 'all_peers_choked');
    if (!lastMetrics) return null;
    return {
      id: 'all_peers_choked',
      severity: 'warn',
      title: 'Пиры не отдают данные',
      explanation: 'Все подключённые пиры заблокировали входящую загрузку. Обычно это временно — они ждут, пока вы начнёте раздавать.',
      actions: [
        {
          id: 'increase_upload',
          label: 'Убрать лимит на отдачу',
          type: 'settings',
        },
        {
          id: 'add_trackers',
          label: 'Добавить публичные трекеры',
          type: 'auto',
          handler: () => addPublicTrackers(),
        },
      ],
    };
  },

  disk_bottleneck: (r) => {
    if (!r.detectedAnomalies.find(a => a.type === 'disk_bottleneck')) return null;
    return {
      id: 'disk_bottleneck',
      severity: 'warn',
      title: 'Диск не успевает за загрузкой',
      explanation: r.diskType === 'hdd'
        ? 'Жёсткий диск (HDD) пишет медленнее, чем поступают данные. Из-за этого загрузка тормозит.'
        : 'Скорость записи на диск стала узким местом. Возможно диск занят другими процессами.',
      actions: [
        {
          id: 'reduce_connections',
          label: 'Уменьшить количество соединений',
          type: 'settings',
        },
        {
          id: 'enable_cache',
          label: 'Увеличить кэш записи',
          type: 'settings',
        },
      ],
    };
  },

  isp_throttling: (r) => {
    if (!r.ispThrottling.suspected) return null;
    const slowHoursStr = r.ispThrottling.slowHours
      .map(h => `${h}:00`)
      .join(', ');
    return {
      id: 'isp_throttling',
      severity: 'warn',
      title: 'Провайдер замедляет P2P трафик',
      explanation: `Скорость падает в ${slowHoursStr} и восстанавливается ночью. Это типичный признак того, что провайдер ограничивает BitTorrent трафик в часы пик.`,
      actions: [
        {
          id: 'enable_encryption',
          label: 'Включить шифрование трафика',
          type: 'settings',
          instruction: 'Шифрование может помочь обойти автоматическое определение P2P трафика провайдером.',
        },
        {
          id: 'schedule_night',
          label: 'Запланировать загрузку на ночь',
          type: 'auto',
          handler: () => scheduleForBestHours(r.ispThrottling.fastHours),
        },
        {
          id: 'change_port_80',
          label: 'Попробовать порт 80 или 443',
          type: 'settings',
          instruction: 'Порты 80 (HTTP) и 443 (HTTPS) реже фильтруются провайдерами.',
        },
      ],
    };
  },

  no_dht: (r) => {
    if (r.dhtNodeCount > 50) return null;
    return {
      id: 'no_dht',
      severity: 'info',
      title: 'DHT работает плохо',
      explanation: 'DHT (распределённая таблица пиров) почти не подключена. Вы находите меньше пиров для загрузки.',
      actions: [
        {
          id: 'restart_dht',
          label: 'Перезапустить DHT',
          type: 'auto',
          handler: () => restartDHT(),
        },
        {
          id: 'check_firewall',
          label: 'Проверить настройки брандмауэра',
          type: 'manual',
          instruction: 'DHT использует UDP. Убедитесь, что Windows Firewall или антивирус не блокирует UDP-трафик для sTorent.',
        },
      ],
    };
  },

};
```

---

## Модуль 4: UI диагностики

### Быстрый статус (всегда виден)

В нижней части главного экрана — статусная строка Speed Doctor:

```
[●] Сеть: OK  |  Скорость: 4.2 МБ/с  |  Пиров: 47  |  [!] 1 предупреждение
```

Клик на строку открывает панель Speed Doctor.

### Полная панель диагностики

```
╔═══════════════════════════════════════╗
║  Speed Doctor                         ║
╠═══════════════════════════════════════╣
║                                       ║
║  ● Входящий порт 51413     [Открыт]   ║
║  ● UPnP                    [Активен]  ║
║  ● DHT                 [847 узлов]   ║
║  ● Трекеры         [3/4 отвечают]    ║
║                                       ║
║  ─────────────────────────────────   ║
║  ⚠ Провайдер замедляет трафик         ║
║    18:00–22:00 скорость падает на 70% ║
║    [Включить шифрование] [На ночь]    ║
║                                       ║
║  ─────────────────────────────────   ║
║  График скорости: последние 24 часа   ║
║  [▁▂▃▅▆▇▆▅▃▂▁▁▁▁▁▁▁▁▃▅▇▇▆▅]         ║
║                                       ║
║  [Запустить полную диагностику]       ║
║  [Сохранить отчёт]                    ║
╚═══════════════════════════════════════╝
```

### Состояния строки проверки

Каждая проверка в панели показывает:

- `[Проверяется...]` — анимация во время теста
- `[OK]` зелёный — всё хорошо
- `[!]` жёлтый — есть предупреждение, но работает
- `[✗]` красный — проблема, нужно действие

---

## Модуль 5: история и экспорт

### График скорости

Хранится в той же таблице `speed_history` что и у SDA. Speed Doctor рисует его как SVG или Canvas в UI.

```typescript
interface SpeedChartPoint {
  hour: string;        // "14:00"
  downloadKb: number;
  uploadKb: number;
  peers: number;
}

function prepareChartData(history: SpeedMetrics[], range: '24h' | '7d'): SpeedChartPoint[] {
  const cutoff = Date.now() - (range === '24h' ? 86400 : 7 * 86400) * 1000;
  return history
    .filter(m => m.timestamp * 1000 > cutoff)
    .map(m => ({
      hour: new Date(m.timestamp * 1000).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }),
      downloadKb: m.downloadSpeedKb,
      uploadKb: m.uploadSpeedKb,
      peers: m.activePeers,
    }));
}
```

### Экспорт отчёта

По кнопке «Сохранить отчёт» генерируется текстовый файл:

```
sTorent Speed Doctor Report
Дата: 2026-05-30 15:42
Версия приложения: 0.1.1

═══ СЕТЕВЫЕ ПРОВЕРКИ ═══
Порт 51413 TCP: ОТКРЫТ
Порт 51413 UDP: ОТКРЫТ
UPnP: АКТИВЕН
DHT: 847 узлов
Трекеры: 3/4 отвечают (1 timeout)

═══ СКОРОСТЬ ═══
Текущая: 4.2 МБ/с ↓ / 1.1 МБ/с ↑
Пик за 24 часа: 8.7 МБ/с
Среднее за неделю: 3.1 МБ/с

═══ ДИАГНОЗЫ ═══
[ПРЕДУПРЕЖДЕНИЕ] Провайдер замедляет P2P трафик
  Медленные часы: 18:00, 19:00, 20:00, 21:00
  Падение скорости: ~70%
  Рекомендация: шифрование трафика или загрузка в ночное время

═══ СИСТЕМНАЯ ИНФОРМАЦИЯ ═══
ОС: Windows 11 (без версии ядра и build — приватность)
Диск: SSD
Кэш записи: 64 МБ
```

Отчёт **не содержит**: IP-адресов, имён файлов, трекеров, путей на диске, идентификаторов торрентов.

---

## Автоматические действия Speed Doctor

Список действий, которые Speed Doctor выполняет сам (без подтверждения) и которые требуют подтверждения:

### Выполняется автоматически (фоново)
- Сбор метрик скорости каждую минуту
- Обновление таблицы DHT-узлов
- Мониторинг ответов трекеров

### Требует подтверждения пользователя
- Проброс порта через UPnP
- Смена порта
- Добавление трекеров к торренту
- Включение/выключение шифрования
- Создание расписания загрузок

### Никогда не делает автоматически
- Изменение системных настроек Windows Firewall
- Изменение реестра
- Установка сторонних программ
- Любые действия с файлами пользователя

---

## IPC-события Speed Doctor

```typescript
// Main → Renderer
'speedDoctor.status.updated'     // { portOpen, dhtNodes, trackerCount, currentSpeedKb }
'speedDoctor.anomaly.detected'   // { anomaly: SpeedAnomaly }
'speedDoctor.diagnosis.ready'    // { diagnoses: Diagnosis[] }
'speedDoctor.action.result'      // { actionId, success, message }
'speedDoctor.report.ready'       // { reportPath } — путь к сохранённому файлу

// Renderer → Main
'speedDoctor.fullScan.start'     // запустить полную диагностику
'speedDoctor.action.execute'     // { actionId, params }
'speedDoctor.report.export'      // { outputPath }
'speedDoctor.chart.request'      // { range: '24h' | '7d' }
```

---

## Хранение данных Speed Doctor

```
storage/
  speed-doctor/
    speed_history.db       -- метрики скорости (shared с SDA)
    diagnostic_reports/
      report-2026-05-30.txt
      report-2026-05-29.txt
    anomaly_log.json       -- обнаруженные аномалии с timestamp
```

Отчёты старше 30 дней удаляются автоматически. Данные не покидают устройство пользователя.

---

## Связанные документы

- `04-architecture.md` — Speed Doctor Engine в общей архитектуре
- `10-smart-download-assistant.md` — SDA использует те же данные speed_history
- `12-ai-providers.md` — универсальный AI-слой для объяснения диагнозов
- `05-networking-privacy.md` — какие данные передаются при внешних проверках
- `06-roadmap.md` — этапы внедрения Speed Doctor
