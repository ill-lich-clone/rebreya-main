# Rebreya Main: роадмап развития

Дата: 2026-09-07. База: ccc9f59e, module 1.4.245.
Спецификация: [программа и общие инварианты](../specs/2026-09-07-module-development-design.md).

Это последовательность самостоятельных этапов, а не разрешение реализовать все подсистемы одним заходом. Каждый этап — отдельная задача, focused tests, live QA по характеру изменения, паспорт, version bump клиентских файлов, commit/push в lich_branch.

## Выбранный подход

Рекомендуется сначала устранить ежедневные ошибки UI и определить индивидуальную идентичность предметов, затем подключать боевые и экономические расширения. Альтернатива «сначала обезоруживание» быстрее даёт новый macro, но перенос выбитого предмета всё равно зависит от сохранности экземпляров. Единый большой релиз всех пунктов затруднит диагностику потерь world-state и проверку стоимости, поэтому программа разбита на результаты.

Приоритет — предложенный, не оценка календарных сроков. S/M/L обозначают относительную сложность; L делится на несколько партий по owner, а не растягивает один чат. Внешние игровые вопросы отмечены Q в основной спецификации.

## Этапы

| Этап | Результат | Зависимости | Размер / рекомендуемая модель | Готовность |
|---|---|---|---|---|
| R0 | Отмена не создаёт cancel; drop на Item наследует его папку | Нет | S / Terra medium | Диалог и root/folder/popout drag regression + live |
| R1 | Popover высокого хранилища и кукла: fixed cells, scoped styles, tooltip | Нет; helper сначала | M / Terra medium, два узких commits | Viewport QA и identity-free UI regression |
| R2 | Цвет папки сохраняется у всех участников | R0 | S / Terra medium | Совместимые старые flags, права, concurrency |
| R3 | Частичный перенос и отдельный экземпляр для куклы | R0; UI R1 можно независимо | L / Sol high для транзакционного контракта, Terra high для реализации | Quantity conservation, host links, failure/retry |
| R4 | Coverage manifest 91 upgrades, compatibility и единый value | Нет; ключи экземпляров согласовать с R3 | M / Sol high, механический manifest Luna medium | 91 классифицированная строка, price composition tests |
| R5 | Два счётчика под местом Механуса | Уточнение UI в reputation.md | M / Terra medium | GM-only edits, revision/replay, layout QA |
| R6 | Macro «Обезоруживание» рядом с захватом | R3, Q2 | L / Sol high | Roll/save ownership, один ground transfer, GM/player QA |
| R7 | Только бонусы и простые эффекты непроклятых upgrades | R4; сложные исключены пользователем | M / Terra medium по provider | Матрица simple/недоступно, curse regressions |
| R8 | Лутген выдаёт улучшенные hosts с полной ценой | R4, R3; existing curses/готовое простое подмножество R7 | L / Sol high | Budget, trusted claims, materialized upgrade links |
| R9 | Лутген выдаёт контейнеры с лутом внутри общего бюджета | R8 | L / Sol high | Nested budget, capacity, parent/child claim recovery |
| R10 | GM открывает окно на 10 минут со списком действий | R1 helper при использовании | M / Sol high для state/socket, Terra medium UI | Выборы, reconnect, one session/group; без resource/time writes |
| R11 — отложен | Восстановления КО и кости хитов | Только после нового запроса и отдельной спецификации | Модель определить тогда | Не входит в текущую реализацию |

Рекомендуемая очередь: R0 → R1 → R2 → R3 → R4 → R5 → R6 → R7 → R8 → R9 → R10. R11 отложен по ответу пользователя.
R4/R5/R10 можно переставить раньше по приоритету игры; R8/R9 не требуют завершения всей автоматизации R7. Параллельная правка общего main.js или inventory-service.js не рекомендуется.

## Узкие циклы внутри этапов

Для каждого цикла: прочитать только соответствующую спецификацию и раздел паспорта → найти declaration/callers → focused failing regression → минимальная реализация → focused green → live QA → паспорт/README/version → полная проверка → review diff → commit/push.

- R0a: структурированный результат folder dialog. R0b: единый resolver membership для hover/drop. Оба входят в первую задачу.

- R1a: anchored overlay и storage popover. R1b: fixed hero cells и styled tooltip, без изменения Item identity.

- R3a: quantity operation с fresh validation/recovery. R3b: HeroDollService использует выделение экземпляра, distinct Item IDs сохраняются.

- R4a: уточнить owner/test mappings по готовой [91-row матрице](../specs/2026-09-07-module-development/upgrade-scope.md): 11 existing curses, 42 простых кандидата, 38 исключений. R4b: общие compatibility/value функции и tests.

- R6a: pure rules + формула/size/save contract. R6b: validated operation/roll card. R6c: recoverable ground transfer + managed macro; этап готов только после R6c.

- R7: отдельные партии пассивных бонусов и простых damage/modifier effects. Новые activities/ресурсы/ауры не реализовывать; сложные явно помечать как недоступные.

- R8a: descriptor/value/aggregation. R8b: trusted serialization и claim/materialization. R9 добавляет рекурсивное содержимое и UI preview только поверх этой границы.

- R10a: authority/session/выборы. R10b: участники/overlay/закрытие без продвижения календаря. R11 не начинать.

## Условия выпуска

- По каждому исходному подпункту есть наблюдаемая проверка из спецификации.

- Проверены rights/no-active-GM/retry/частичные сбои там, где меняются ресурсы.

- Ни один Item/upgrade/container не потерян и не продублирован.

- Клиентские changes имеют новую version и актуальный forwarder.

- Старые API/flags/ChatMessage/template schemas читаются либо имеют tested migration.

- Новые методы записаны в паспорт; public contract — в README.

- Полная проверка: node --test tests/*.test.mjs; git diff --check; node --check tracked JS/MJS; ConvertFrom-Json tracked JSON. Отчёт содержит passed/failed и реальные ошибки.

- Новая задача начинается после зафиксированного результата текущей, не через бесконечное «продолжай».

## Handoff первой реализации

Рекомендуемая модель: **Terra medium** — два известных UI-контракта с одним основным владельцем и focused-тестами. Следующий самостоятельный этап выполнять в новой задаче.

```text
Реализуй только R0: отмена создания/переименования папки не создаёт имя cancel; drop на строку Item отправляет переносимое в настоящую папку этого Item, в корень — только если target Item в корне. Фон folder popout означает его rootFolderId.

Репозиторий: D:/FoundryVTT/Data/modules/rebreya-main.
Перед реализацией прочитай:
1. AGENTS.md.
2. docs/superpowers/specs/2026-09-07-module-development-design.md — общие инварианты.
3. docs/superpowers/specs/2026-09-07-module-development/inventory-storage-ui.md — только R0.
4. docs/function-passport.md — разделы 7 и 19, находи через rg; не загружай весь проект.

Владелец: scripts/ui/inventory-app.js, promptInventoryFolderName(), #createInventoryFolder(), #renameInventoryFolder(), #resolveInventoryDropTarget(). Folder state остаётся у InventoryService и inventory-folder-tree.js.
Подтверждённая причина cancel: установленный Foundry 13.351 DialogV2 использует callbackResult ?? button.action. Callback null даёт строку cancel. Используй структурированный confirmed/name результат; имя cancel, введённое вручную и подтверждённое, допустимо.
Current drop contract: любой Item даёт folderId:null. Меняется именно он; подсветка и drop должны использовать одинаковую цель из свежего snapshot.

Не реализуй partial quantity, folder colors, куклу, усовершенствования или остальные этапы. Не меняй данные мира из UI, роли/ACL, ingress rules и protected membership без необходимости. Cancel/Escape/close = ноль mutations. Сохрани self/descendant/cross-group ограничения. Исчезнувшая цель не должна тихо отправлять Item в корень.

Сначала focused regressions:
node --test tests/inventory-app-context.test.mjs tests/inventory-folder-tree.test.mjs tests/inventory-folder-socket.test.mjs
В тесте диалога воспроизведи nullish fallback Foundry. Покрой Confirm/cancel/Escape/close, буквальное имя cancel, root/folder/deep folder/filtered Item/popout background, long hover и stale target.
После реализации — эти focused tests, live GM/player проверка в отдельном тестовом мире и полная проверка из AGENTS.md. Не называй Node-тесты live QA.

Обнови docs/function-passport.md для изменённых/новых/удалённых методов и README, если меняется публичный контракт. Подними module.json version, синхронно создай scripts/main-<version>.js с импортом main.js и обнови esmodules; проверь runtime-ссылки.

Обязательный Git: git status --short --branch; git branch --show-current; git fetch origin; git rev-list --left-right --count HEAD...origin/main; git log --oneline HEAD..origin/main; сравни HEAD с origin/lich_branch. Если основной remote master — проверь аналогично. Работай только в lich_branch. Чужие незакоммиченные изменения, опережение remote lich_branch или конфликт основной ветки — остановись и сообщи. Перед commit проверь git diff --check, git diff --stat и содержательный diff. Stage только файлы R0, осмысленный commit, git push -u origin lich_branch. Никакого force push или commit/push в main/master.

База исследования: ccc9f59e, модуль 1.4.245, Foundry 13.351, dnd5e 5.2.5. На этой базе проверено 3618 passed/0 failed, 689 JS/MJS syntax и 45 JSON без ошибок. Реализация начинается с актуального fetch, не с предположения, что ветка осталась прежней.
```
