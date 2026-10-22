# Grouped Combat Regression Fix Plan

> **For agentic workers:** Use superpowers:executing-plans. Это исправление уже утверждённых native-roll/grouped-transition contracts; новые игровые правила не добавляются.

**Goal:** Восстановить группировку настоящих dnd5e NPC rolls и убрать повторные navigation requests во время одного ожидающего перехода.

**Architecture:** Сохранить владельцев provider profile и native runtime ingress; добавить только недостающие известные native options и одну process-local запись ожидающего запроса на Combat. Service security/revision/receipts остаются прежними.

**Tech Stack:** Foundry 13.351, dnd5e 5.2.5, native ESM/Node test runner.

**Spec:** [Диагностика и acceptance](../specs/2026-10-22-grouped-combat-regressions.md); [утверждённый основной контракт](../specs/2026-10-20-grouped-combat-start-design.md).

## Task 1: Native initiative

- [x] Загрузить установленный D20Roll class в VM с минимальным Roll/Die harness, не заменяя native configureModifiers. Regression: обычный native D20Roll может группироваться; advantageMode/criticalSuccess/criticalFailure/target входят в semantic signature; unknown option всё ещё исключает sharing.
- [x] Service regression: три новых NPC с такими native normalized options вызывают один roll. Увидеть RED, добавить недостающие известные options, получить GREEN.

## Task 2: Awaited navigation

- [x] Regression: задержать первый transition, повторить next и positional update с того же клиента, убедиться в одном отправленном запросе/одном переходе. После завершения следующая навигация снова доступна; failures также освобождают ingress. Увидеть RED.
- [x] В runtime registration добавить per-combat pending request reuse для navigate/update; не менять service stale checks и не повторять effects. Получить GREEN.

## Task 3: Review и release

- [x] Версия 1.4.398, тонкий forwarder/esmodules, необходимые cache URLs и только затронутые test expectations. Обновить README/паспорт.
- [x] Проверить focused suites, independent review при доступности Gemini, затем полный `node --test tests/*.test.mjs`, tracked JS/MJS syntax, tracked JSON parse и diff checks.
- [x] Только task files в commit, обычный push `origin lich_branch`; указать фактические evidence, ограничения live проверки и способ повторной проверки свежего боя.

## Evidence

До edits: clean lich_branch, HEAD=origin/lich_branch, 83 ahead/0 behind origin/main. Read-only probe воспроизвёл отказ grouping из-за native advantageMode. Первичная Gemini delegation достигла print timeout; неподтверждённый partial output не используется как вывод. Продолжение локально разрешено AGENTS.md.

RED: настоящий установленный D20Roll дал `canShare:false`; service вызвал roll:a/b/c/pc вместо roll:a/pc. Native navigation отправила 3 одновременных запроса вместо одного. После минимальных fixes — 33/33 provider/service/runtime tests, затем 119/119 focused tests с manifest/composition/storage/implant/gadget regressions. Проверки unknown initiative options, разных profiles и service stale revision сохранены.

Финальные проверки после последних runtime edits:

- `node --test tests/*.test.mjs`: **4898 passed, 0 failed, 1 прежний skipped** (4899 total); skip — Foundry Handlebars dependency для rendered ghost, не combat regression.
- `git ls-files '*.js' '*.mjs'` → `node --check`: **1042 passed, 0 failed**.
- `git ls-files '*.json'` → `ConvertFrom-Json -ErrorAction Stop`: **58 passed, 0 failed**.
- `git diff --check`, staged diff check: PASS. Release/forwarder: **1.4.398**. Изменённые provider/profile/runtime importers используют согласованные cache URLs; остальные released owners не переверсионированы.
- Повторный fetch: HEAD=origin/lich_branch, 83 ahead/0 behind origin/main; чужих изменений нет. Существующие Combat/Actor/initiative values в живом мире не менялись. Для проверки общего броска нужен свежий бой без ранее установленных разных initiatives.

## Independent review rulings

Вторая Gemini 3.8 Flash High попытка получила supplied diff и завершилась SUCCESS; она подтвердила promise release, ordinary fallback, сохранение server revision/auth и остальных полей public update.

- **Принято:** success cleanup test не должен переустанавливать runtime до следующей навигации. Убран dispose/re-register между первым и вторым ходом; focused runtime после изменения — **6 passed, 0 failed**.
- **Отклонено:** утверждение, что установленный dnd5e entrypoint не содержит D20Roll. Реальный bundled `D:/FoundryVTT/Data/systems/dnd5e/dnd5e.mjs:75242` содержит class; regression исполнил его constructor/configureModifiers и полный suite прошёл. Regex рассчитан на этот закреплённый installed source format; другой bundle без такого declaration должен явно отказать, а не незаметно использовать stub.
- **Отклонено для этой правки:** нормализация legacy critical/fumble aliases и пропущенных booleans как доказанно эквивалентных native rules. Native getInitiativeRollConfig всегда задаёт advantage/disadvantage, native configureModifiers — advantageMode; одинаковые clone profiles получают одну форму. Critical/criticalSuccess не доказаны alias в этом native pipeline. Сохраняется консервативная signature, чтобы не объединить существа с различными авторскими rules. Стоимость — явно различающиеся custom representations могут остаться отдельными группами.

Последнее изменение после полного прогона затронуло только усиление runtime test (без product edits); выполнены повторный `node --test tests/grouped-combat-runtime.test.mjs` и `node --check tests/grouped-combat-runtime.test.mjs`.
