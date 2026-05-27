# sTorent: сборка .exe и публикация на GitHub

## Цель

`sTorent` должен собираться в Windows-приложение и автоматически публиковаться на GitHub. Для пользователя основной формат распространения - `.exe` файл.

## Форматы Windows-сборки

Для Windows нужно поддержать два варианта:

- `sTorent Setup.exe` - обычный установщик для Windows 10/11.
- `sTorent Portable.exe` - portable-версия без установки, если выбранный стек это позволяет.

Приоритет для MVP: `sTorent Setup.exe`.

## Требования к .exe

- файл должен запускаться двойным кликом;
- приложение должно иметь иконку `sTorent`;
- в свойствах файла должны быть имя продукта, версия и издатель;
- установщик должен создавать ярлык в меню Пуск;
- установщик должен предлагать запуск после установки;
- удаление приложения должно работать через стандартный список приложений Windows;
- пользовательские данные, настройки и активные торренты не должны удаляться без отдельного подтверждения.

## Версионирование

Использовать SemVer:

- `0.1.0` - первый MVP;
- `0.2.0` - новые функции;
- `0.2.1` - исправления;
- `1.0.0` - первый стабильный релиз.

Каждый релиз в GitHub должен быть связан с git-тегом:

```text
v0.1.0
v0.2.0
v1.0.0
```

## GitHub-репозиторий

Рекомендуемая структура репозитория:

```text
sTorrent/
  docs/
  src/
  assets/
  tests/
  .github/
    workflows/
      build-windows.yml
      release.yml
  README.md
  LICENSE
```

## Автоматическая загрузка на GitHub

Нужно настроить GitHub Actions:

- при push в `main` запускать проверку сборки;
- при создании git-тега `v*` собирать Windows `.exe`;
- прикреплять `.exe` к GitHub Release;
- сохранять checksum-файл `SHA256SUMS.txt`;
- публиковать changelog релиза;
- не загружать пользовательские данные, настройки, историю загрузок, `.torrent` файлы пользователя или секреты.

## Пример workflow для релиза

Название файла:

```text
.github/workflows/release.yml
```

Пример логики:

```yaml
name: Release

on:
  push:
    tags:
      - "v*"

jobs:
  windows:
    runs-on: windows-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install dependencies
        run: npm ci

      - name: Build Windows app
        run: npm run build:windows

      - name: Create checksums
        shell: powershell
        run: |
          Get-ChildItem -Path dist -Filter *.exe | ForEach-Object {
            $hash = Get-FileHash $_.FullName -Algorithm SHA256
            "$($hash.Hash)  $($_.Name)" | Out-File -FilePath dist/SHA256SUMS.txt -Append -Encoding utf8
          }

      - name: Publish GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: |
            dist/*.exe
            dist/SHA256SUMS.txt
```

Команда `npm run build:windows` должна быть адаптирована под выбранный стек:

- Tauri: команда сборки Tauri для Windows;
- Electron: команда сборки Electron Builder;
- другой стек: собственная команда сборки `.exe`.

## Секреты и безопасность

В репозиторий нельзя добавлять:

- токены GitHub;
- пароли;
- приватные ключи;
- настройки прокси пользователя;
- логи с персональными данными;
- скачанные пользователем файлы;
- `.torrent` файлы пользователя.

Если нужна подпись Windows-приложения, сертификат подписи хранить только в GitHub Secrets или в другом безопасном хранилище CI.

## Автообновление

После MVP можно добавить автообновление:

- приложение проверяет последнюю версию в GitHub Releases;
- показывает пользователю changelog;
- скачивает новый установщик только после подтверждения;
- проверяет checksum перед запуском обновления.

Автообновление не должно запускать неизвестный файл без проверки источника и целостности.
