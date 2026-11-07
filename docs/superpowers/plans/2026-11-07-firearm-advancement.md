# Firearm Advancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сохранить свойства, магазин, осечку и клин уже имеющегося огнестрела при завершении повышения.

**Architecture:** `registerCombatHooks(moduleApi)` применяет условия отдельно до и после обновления. Существующие расчёты `CombatAttackService` и способ передачи полного пакета из dnd5e сохраняются.

**Tech Stack:** JavaScript ESM, Node test runner, Foundry VTT 14.369, dnd5e 6.0.6.

**Spec:** `docs/superpowers/specs/2026-11-07-firearm-advancement-design.md`

## Global Constraints

- `preUpdateItem` пропускает нормализацию порядка свойств при явном `recursive: false`.
- `updateItem` пропускает только синхронизацию состояния огнестрела, когда одновременно установлены `isAdvancement: true` и `recursive: false`.
- Прочие полные обновления продолжают запускать синхронизацию. Проверка активности «Вихря» сохраняет свой путь.

## Review Focus

- Оба хука проверяются через реальные регистрации и `CombatAttackService`, чтобы тест обнаруживал и потерю списка, и сброс флагов.
- Контрольный вызов `updateItem` с `recursive: false` вне повышения по-прежнему синхронизирует фактическое удаление свойства перезарядки. Редактирование владения и обычная синхронизация проверяются существующими тестами.
- Клиент должен загрузить новый `combat/hooks.js` при обновлении страницы. Живая проверка сверяет фактически сохранённый уровень и флаги оружия.

### Task 1: Preserve firearm state in advancement batches

**Files:** `scripts/combat/hooks.js`, `scripts/main.js`, `scripts/main-1.5.64.js`, `module.json`, `README.md`, `docs/function-passport.md`, `tests/combat-attack-service.test.mjs`, `tests/main-composition-root.test.mjs`, `tests/module-manifest.test.mjs`, `tests/storage-main-registration.test.mjs`.

**Interface:** Foundry вызывает `preUpdateItem(item, changed, options)` и `updateItem(item, changed, options)` с общими параметрами операции. Действующие сигнатуры методов сервиса сохраняются.

- [ ] Добавить в `tests/combat-attack-service.test.mjs` регрессию через `registerCombatHooks` с двумя независимыми проверками. В первой полный пакет `recursive: false` сохраняет исходные `system.properties`. Во второй полный пакет с `isAdvancement: true` сохраняет имя, магазин `1/1`, базовую осечку `2`, текущую `5`, флаг клина и не вызывает запись. Проверить, что обе падают на старом коде.
- [ ] В `scripts/combat/hooks.js` добавить условия из спецификации. Обновить паспорт и повторить профильные тесты, включая существующие проверки синхронизации и «Вихря».
- [ ] Повысить версию до `1.5.64`, обновить manifest, README, импорт `combat/hooks.js` и проверки соответствия версии. Добавить форвардер с единственным `import "./main.js";`.
- [ ] Прогнать штатный мастер под CODEX на копии персонажа с мушкетом. Выставить на копии заряженный магазин, повышенную осечку и клин перед повышением. Сравнить данные предмета и уровень после сохранения, проверить консоль.
- [ ] Проверить обнаруженный в живом мире сброс от второго GM-клиента. Закрепить регрессией `preUpdateItem` установку прежнего `firearmPropertySync` для всей операции повышения с сохранением других ключей, подтвердить флаг в полученном `updateItem` и повторить сценарий при подключённом втором GM.
- [ ] Выполнить полную проверку Node, JS/MJS и JSON. Сверить содержательный diff, сделать коммит и отправить в `origin/lich_branch`.
