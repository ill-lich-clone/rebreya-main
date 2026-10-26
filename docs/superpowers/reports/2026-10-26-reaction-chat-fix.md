# Карточки реакций и успешное завершение — 1.5.7

## Результат и границы

Общая карточка реакции получила тёмное оформление Rebreya, золотой акцент выбора, декоративную иконку и подпись. Отказ оформлен приглушённо. Согласованные строки сохранены: «Имя выбирает реакцию» и «Имя не применил реакцию».

Исправлена причина ложного отказа после применения: `_executeAccepted()` принимал UUID-only кандидата из capability index, но разрешал Actor только через внедрённый `actorResolver`. Composition root такого resolver не передаёт. Финальный `consumeReaction(null)` не подтверждал расход, и успешное применение не доходило до удаления сообщения. Теперь используется runtime `fromUuid`, как в других методах очереди; сохраняются точный Actor, однократный расход и rollback при ошибке. Не подменяется успех одним нажатием кнопки и не пропускается ledger.

Существующий native MIDI adapter не менялся: установленный обработчик успешно завершает настоящие activity и возвращает UUID. Его тестовый диалог уточнён: кнопки сохраняют callback при подготовке и вызывают `button.callback`, как Midi-QOL. Проверка реального socket relay подтвердила второй аргумент с transport sender; авторизация не ослаблялась.

Версия manifest/forwarder — `1.5.7`; обновлены cache keys очереди и CSS. Неизменённые subsystem cache keys и старые forwarders сохранены. Обновлены README и паспорт функций. Настройки, formulas, budgets, quantity rules, free/multiple reactions, 10 секунд выбора и managed applying reservations сохранены.

## Спецификация и план

- Спецификация: `docs/superpowers/specs/2026-10-26-reaction-chat-fix.md`, продолжает согласованную `2026-10-23-global-reaction-chat-design.md`.
- План: `docs/superpowers/plans/2026-10-26-reaction-chat-fix.md`.
- Пользователь явно поручил продолжить исправление и commit. Работа выполнена inline в `lich_branch`; шесть чужих изменённых планов сохранены побайтно (SHA256 6/6) и исключены из staging.

## Проверки

- RED: обе UUID-only регрессии (Actor игрока и synthetic Actor UUID) воспроизвели `accepted: 0` вместо `1`. После исправления очередь передаёт правильный Actor в ledger и удаляет сообщение. Проверены также ready-Actor precedence и неуспешный расход с rollback.
- RED: проверка scoped карточки падала на прежней простой строке. После renderer/CSS проходят escaped текст и оба состояния без ослабления прежних lifecycle-проверок.
- `node --test tests/reaction-chat-lifecycle.test.mjs tests/reaction-queue-service.test.mjs tests/managed-reaction-session.test.mjs tests/midi-reaction-adapter.test.mjs`: **61 passed, 0 failed**.
- `node --test tests/module-manifest.test.mjs tests/main-composition-root.test.mjs`: **53 passed, 0 failed**.
- `node --test tests/*.test.mjs`: **5037 total, 5036 passed, 0 failed, 1 skipped**.
- `node --check` для всех tracked JS/MJS и нового forwarder: **1067 файлов, 0 ошибок**.
- `Get-Content -Raw -Encoding UTF8 … | ConvertFrom-Json`: **65 tracked JSON, 0 ошибок**. Предварительный Node JSON.parse отклонил существующий BOM `lang/ru.json`; файл не изменён, окончательная проверка выполнена штатной PowerShell-командой из AGENTS.md.
- `git diff --check`: passed. Независимое свежее Codex review: actionable замечаний нет.

## Живой Foundry

Матрица: **Foundry 13.351, dnd5e 5.2.5, Midi-QOL 13.0.61**, GM CODEX и отдельный временный пользователь роли Player с OWNER только на disposable Actor. Подтверждена загрузка исправленной очереди и `main.css?v=1.5.7` на обоих клиентах.

Чтобы не менять настоящего active GM другого участника, UUID-only regression использовала отдельные экземпляры того же сервиса с test coordinator view CODEX. Использованы настоящий Foundry socket relay с transport sender, настоящий DialogV2 игрока, GM-authored ChatMessage, Actor/Item updates и канонический CombatAttackService ledger. Fixture provider записывал наблюдаемое применение и расход Item; весь реальный spell/Rune Knight workflow в этом сценарии не имитировался как проверенный.

- Player success: `accepted: 1`, Item spent `1`, применение `1`, remaining reactions `0`, карточек этого trigger `0`.
- Player decline и реальный 10-секундный timeout: `accepted: 0`, Item spent `0`, применение `0`, remaining reactions `1`, одна карточка `declined`.
- UUID-only NPC на GM: `accepted: 1`, remaining reactions `0`, карточек `0`.
- Отдельно до исправления подтверждён исходный native MIDI activity путь GM и настоящего Player через фактического active GM: результат содержит activity UUID, сообщение удаляется. Native runtime не менялся. Каждый конкретный spell/Rune Knight эффект и настоящий unlinked NPC token после правки отдельно не проверялись; synthetic UUID покрыт regression-тестом.
- Визуально осмотрены выбор/отказ в раскрытом чате: ширина карточки 273 px, без горизонтального переполнения; основной текст `rgb(238,241,246)` на тёмном фоне, ожидание золотое, отказ серый. Длинное неразрывное имя и HTML-подобный текст безопасно переносятся, `<img>` не создаётся. Проверены theme-dark/theme-light CSS states. Скриншоты сохранены локально в `.playwright-mcp/reaction-choosing-1.5.7.png` и `reaction-declined-1.5.7.png`.
- Console errors на GM после проверки: **0**. Окружение имеет прежние deprecation warnings сторонних модулей. Отдельные ошибки исследовательского QA-вызова Sidebar без tab group и попытки screenshot при свёрнутом sidebar исправлены только в QA; runtime модуля не затронут.
- Удалены все disposable fixtures: **2 Actor, 1 Scene, 1 Player и 8 их сообщений**; проверен нулевой остаток. Временные socket listeners сняты.
- Рекурсивное удаление собственной временной `.superpowers/sdd/2026-10-26-reaction-chat-fix/` отклонено автоматической политикой инструмента. Папка оставлена в git-ignore; обход блокировки не предпринимался, в commit она не включается.

Для применения на уже открытых клиентах необходимо обычное обновление страниц игроков и активного GM. Другие пользовательские сессии принудительно не перезагружались.
