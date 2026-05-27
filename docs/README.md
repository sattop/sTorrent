# sTorent: пакет документов для разработки

Этот каталог содержит базовое техническое задание для торрент-клиента `sTorent`.
Документы можно передавать ChatGPT, другому AI-агенту или разработчику как контекст для проектирования и реализации.

## Документы

- [01-product-brief.md](01-product-brief.md) - краткое описание продукта, аудитория и позиционирование.
- [02-functional-requirements.md](02-functional-requirements.md) - функциональные и нефункциональные требования.
- [03-ui-ux-spec.md](03-ui-ux-spec.md) - современный минималистичный интерфейс и сценарии пользователя.
- [04-architecture.md](04-architecture.md) - архитектура приложения, модули и технологии.
- [05-networking-privacy.md](05-networking-privacy.md) - сетевые настройки, приватность и допустимые способы устойчивой работы сети.
- [06-roadmap.md](06-roadmap.md) - этапы разработки MVP и следующих версий.
- [07-build-release-github.md](07-build-release-github.md) - сборка Windows `.exe` и автоматическая публикация на GitHub.
- [08-feature-research.md](08-feature-research.md) - анализ форумов, GitHub Issues/Discussions и полезных функций для `sTorent`.
- [09-ai-step-by-step-workflow.md](09-ai-step-by-step-workflow.md) - инструкция, чтобы AI-агент разрабатывал проект строго по этапам.
- [10-localization-i18n.md](10-localization-i18n.md) - смена языка интерфейса: Русский, English, Español, 中文.
- [11-smart-assistant-speed-doctor.md](11-smart-assistant-speed-doctor.md) - killer feature: умные профили загрузки и диагностика низкой скорости.
- [13-webui-remote-api.md](13-webui-remote-api.md) - локальный WebUI, remote API, пароль и ограничения доступа по IP.

## Важное ограничение

В проект не закладывается подмена трафика под Steam, Discord или другие чужие сервисы. Вместо этого используются легальные и технически корректные функции: штатное шифрование BitTorrent, прокси/VPN-настройки, выбор сетевого интерфейса, лимиты скорости, расписания, поддержка частных трекеров и прозрачные настройки приватности.
