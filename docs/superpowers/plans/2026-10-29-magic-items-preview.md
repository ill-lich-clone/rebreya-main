# Magic item sync and preview Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** Show attunement details and inventory tooltip rank, synchronize catalog and missing art.

**Architecture:** Extend existing magic compendium description builder and dnd5e tooltip integration; use the existing importer and named icon lookup. Preserve all persisted state and source validation.

**Tech Stack:** Foundry VTT 13, dnd5e, Node.js test runner, Google Sheets importer, WebP.

**Spec:** docs/superpowers/specs/2026-10-29-magic-items-preview-design.md

## Global Constraints

- Preserve stable IDs, formulas, quantities, budgets, user images, managed sync contracts and import safeguards.
- Raise module version and forwarder for player-facing changes; update function passport.

## Review Focus

- Empty and sentinel attunement do not produce misleading details; HTML is escaped.
- Explicit zero rank is displayed; missing or malformed rank is not invented.
- Tooltip integration preserves native data and works repeatedly without duplication.
- Changed sheet headers do not silently discard populated data; existing authored quantities survive.
- Sync avoids destructive removals and flags unexpected changes before writes.

### Task 1: Data and tooltip

**Files:** `scripts/data/magic-items-compendium.js`, `scripts/integrations/dnd5e-tooltip-compat.js`, `scripts/main.js`, focused tests.

- [ ] Add failing tests for escaped attunement, empty sentinel and tooltip rank, zero, missing and invalid inputs.
- [ ] Run focused tests and verify expected failures.
- [ ] Extend existing description and tooltip integration, retain synchronization signature correctness and native behavior.
- [ ] Run focused tests and record results.

### Task 2: Source and illustrations

**Files:** equipment importer, focused tests, `magicItem.js`, named WebP icons.

- [ ] Diagnose changed materials header against historical data and preserve column semantics with regression test.
- [ ] Run safe import dry-run, inspect all catalog diffs and existing guards, apply only validated bundle.
- [ ] Generate and visually inspect each missing named illustration; ensure paths resolve and do not overwrite existing assets.

### Task 3: Delivery

**Files:** `module.json`, versioned forwarder, passport, relevant documentation.

- [ ] Update manifest version and affected runtime cache keys, passport, source audit documentation and focused expectations.
- [ ] Run focused tests, full suite, syntax and JSON validation, diff review and live Foundry verification where available.
- [ ] Commit only task files and push `lich_branch` per project instructions.

## Исполнение: граница общего импорта

Проверенный общий bundle включал изменение 41 картины и статуэтки в тип «Сокровища», которое меняет классификацию и правила продажи, а также изменения материалов и снаряжения вне запроса. Поэтому после штатной транзакции сохранён только `magicItem.js`; остальные каталоги восстановлены из исходного состояния. Алиасы сохраняют существующие ID при будущей отдельно согласованной общей синхронизации. Это намеренное ограничение результата в пользу требования сохранять игровые контракты.

## Дополнение после проверки

Существующие owned-копии сохраняют авторское описание: синхронизация передаёт деталь в отдельный managed flag, а лист Item и rich tooltip показывают её вне редактора. Повторный sync идемпотентен, пустое значение очищает прежнюю деталь, значение `1` показывается как «Требуется». Неидентифицированный предмет не раскрывает деталь игроку.
