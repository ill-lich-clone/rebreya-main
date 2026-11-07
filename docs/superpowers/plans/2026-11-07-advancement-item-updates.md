# Advancement Item Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сохранить класс и результаты мастера повышения при `recursive: false`.

**Architecture:** Граница совместимости находится в существующем `EquipmentSizeService.preUpdateItem`. Foundry получает вложенные данные полной замены, а обычные правки проходят через прежний расчёт размера.

**Tech Stack:** ES modules, Node test runner, Foundry VTT 14.369, dnd5e 6.0.6.

**Spec:** `docs/superpowers/specs/2026-11-07-advancement-item-updates-design.md`

## Global Constraints

- При явном `recursive: false` обработчик пропускает данные в Foundry в полученном виде.
- Для обычных рекурсивных обновлений остаются действующие правила размеров, исходные формулы урона, масштабирование веса и цены, настройки, флаги и публичные вызовы.
- Создание и удаление предметов мастером остаются в ведении dnd5e. Правка не исправляет последствия уже частично сохранённых повышений.

## Review Focus

- Предмет класса и снаряжение с числовым `ownership` должны сохранить все вложенные корни, включая изменённые `system.levels` и поля веса.
- Обычный `preUpdateItem` продолжает синхронно вычислять нормализованный patch. Это покрывают существующие тесты в том же файле.
- Загрузчик новой версии сохраняет прежние опубликованные форвардеры и загружает исправленный сервис с новым ключом кэша.

### Task 1: Preserve non-recursive Item updates

**Files:** `scripts/application/equipment-size-service.js`, `scripts/main.js`, `module.json`, `scripts/main-1.5.63.js`, `README.md`, `docs/equipment-size-function-passport.md`, `tests/equipment-size-service.test.mjs`, `tests/module-manifest.test.mjs`, `tests/main-composition-root.test.mjs`.

**Interface:** `EquipmentSizeService.preUpdateItem(item, changes, options = {}) -> true` вызывается зарегистрированным Foundry hook. Для `options.recursive === false` передаёт `changes` без изменений.

- [ ] Добавить тест `preUpdateItem preserves nested replacements in non-recursive updates`. Через зарегистрированный хук передать класс с `system.levels = 2` и оружие с новым `system.weight.value = 4`, а также вложенные `ownership: { default: 0, A1b2C3d4E5f6G7h8: 3 }` и флаги. Для каждого убедиться, что хук возвращает `true` и `changes` глубоко равен исходному пакету. Запустить `node --test tests/equipment-size-service.test.mjs` и увидеть сбой этого теста на разложенных ключах.
- [ ] В `preUpdateItem` пропустить полные замены до вызова `buildItemUpdate`. Повторить тест, ожидать отсутствие сбоев. В паспорте описать обработку двух режимов.
- [ ] Выпустить `1.5.63`. Добавить `scripts/main-1.5.63.js` с импортом `./main.js`, обновить `module.json`, README, ожидаемую версию в двух тестах и cache key импорта сервиса. Сохранить старые форвардеры.
- [ ] Запустить `node --test tests/*.test.mjs`, `git diff --check`, `node --check` для JS/MJS и проверку разбора JSON. Проверить содержательный diff и связность версии.
- [ ] Подтвердить в Foundry на тестовой копии, что после завершения мастера сохраняются уровень и выданное умение. Если работающий сервер ещё публикует старый manifest, проверить реальный файл сервиса отдельно и указать состояние загрузки версии.
- [ ] Добавить только файлы задачи, закоммитить, выполнить `git push -u origin lich_branch` и сверить удалённый HEAD.
