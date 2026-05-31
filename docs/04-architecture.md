# sTorent: архитектура

## Рекомендуемый стек

Возможные варианты:

### Вариант A: Tauri

- UI: React + TypeScript.
- Desktop shell: Tauri.
- Backend/core: Rust.
- Torrent engine: Rust-библиотека BitTorrent или отдельный процесс на базе проверенной библиотеки.

Плюсы:

- небольшой размер приложения;
- хорошая производительность;
- нативный доступ к файловой системе;
- современный UI.

Минусы:

- выше сложность разработки core-части;
- нужно внимательно выбирать torrent-библиотеку.

### Вариант B: Electron

- UI: React + TypeScript.
- Desktop shell: Electron.
- Torrent engine: WebTorrent или отдельный native/backend-процесс.

Плюсы:

- быстрый старт разработки;
- большой выбор UI-инструментов;
- удобно делать MVP.

Минусы:

- больший размер приложения;
- выше потребление памяти;
- WebTorrent не всегда закрывает все классические desktop-сценарии BitTorrent.

## Рекомендация для MVP

Для MVP выбрать `Tauri + React + TypeScript`, если команда готова работать с Rust. Если цель - как можно быстрее получить прототип интерфейса, начать с `Electron + React + TypeScript`, а torrent-core держать отдельным модулем, чтобы позже заменить реализацию.

## Сборка и публикация

Для Windows приложение должно собираться в `.exe`.

Минимальная release-схема:

- локальная команда сборки создает `sTorent-Setup.exe`;
- GitHub Actions запускает сборку на `windows-latest`;
- при создании тега `v*` workflow публикует `.exe` в GitHub Release;
- checksum-файл публикуется рядом с установщиком;
- пользовательские данные и секреты не попадают в артефакты сборки.

## Основные модули

### UI

Отвечает за:

- список торрентов;
- экраны добавления;
- настройки;
- статистику;
- уведомления;
- системный трей.

### Localization

Отвечает за:

- словари переводов `ru`, `en`, `es`, `zh`;
- выбор языка интерфейса;
- fallback на English, если перевод отсутствует;
- форматирование чисел, дат и времени;
- plural rules для разных языков.

### Application Layer

Отвечает за:

- команды пользователя;
- состояние приложения;
- сохранение настроек;
- координацию UI и torrent-core;
- обработку ошибок.

### Smart Assistant Engine

Отвечает за:

- выбор профиля загрузки;
- анализ metadata, размера, типов файлов и private flag;
- предложения папки, категории и тегов;
- предупреждения о нехватке места и конфликтах имен;
- объяснение рекомендаций;
- применение выбранного профиля после подтверждения пользователя.

### Speed Doctor Engine

Отвечает за:

- сбор диагностических сигналов;
- анализ причин низкой скорости;
- сортировку причин по важности;
- генерацию понятного объяснения;
- подготовку быстрых действий;
- экспорт диагностического отчета без секретов.

### Torrent Core

Отвечает за:

- загрузку metadata из magnet-ссылок;
- работу с `.torrent`;
- peer-соединения;
- трекеры;
- DHT/PEX/LSD;
- проверку хешей;
- запись файлов;
- лимиты скорости;
- очередь.

### Storage

Отвечает за:

- локальную базу торрентов;
- настройки пользователя;
- историю ошибок;
- состояние очереди;
- статистику.

Подходящие варианты:

- SQLite для состояния приложения.
- JSON/TOML для простых настроек.

## Событийная модель

Torrent Core должен отправлять события:

- `torrent.added`
- `torrent.metadata.received`
- `torrent.progress.updated`
- `torrent.status.changed`
- `torrent.completed`
- `torrent.error`
- `network.port.checked`
- `assistant.profile.suggested`
- `assistant.profile.applied`
- `diagnostics.speed.checked`
- `settings.changed`

UI должен отправлять команды:

- `torrent.add`
- `torrent.pause`
- `torrent.resume`
- `torrent.remove`
- `torrent.recheck`
- `torrent.setPriority`
- `settings.update`

## Хранение настроек

Пример структуры:

```json
{
  "downloads": {
    "defaultPath": "D:/Downloads",
    "maxActiveDownloads": 3,
    "maxActiveSeeds": 5,
    "seedRatioLimit": 2.0
  },
  "network": {
    "port": 51413,
    "randomizePortOnStart": false,
    "enableDht": true,
    "enablePex": true,
    "enableLsd": true,
    "downloadLimitKb": 0,
    "uploadLimitKb": 0,
    "networkInterface": "auto"
  },
  "privacy": {
    "telemetry": false,
    "proxyEnabled": false,
    "proxyType": "socks5"
  },
  "ui": {
    "theme": "system",
    "language": "ru"
  }
}
```

## Логи

Логи должны быть разделены по уровням:

- `debug`
- `info`
- `warn`
- `error`

В логах нельзя хранить приватные ключи, пароли прокси или лишние персональные данные.
