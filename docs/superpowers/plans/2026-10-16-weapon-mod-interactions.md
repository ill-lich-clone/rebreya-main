# Weapon Mod Interaction Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Исправить настоящий tooltip, ПКМ, UUID ссылки и снятие/ошибку игрока.
**Architecture:** Расширить существующие presentation helpers и canonical instance adapter. UI не пишет Documents напрямую.
**Tech Stack:** Foundry13.351/dnd5e5.2.5, ESM, native Item schema, Node tests.
**Spec:** `docs/superpowers/specs/2026-10-16-weapon-mod-interactions-design.md`.

## Global Constraints

- lich_branch, сохранить quantity/authored formulas/500gp/ordinary upgrades/typed ownership/CAS/recovery.
- Native tooltip общий с куклой; ПКМ без select; catalog в anchored portal; UUID без HTTP href.
- 18.7% squares, existing gold link/lock; caption above and transparent.
- Release392 и один URL на изменённого owner, старые forwarders сохранены.

## Review Focus

- Nullable required container нельзя удалять: native-like dropped update + успешное снятие, invalid ack по-прежнему откатывает.
- Legacy ordinary reverse link принадлежит этому host: route removeItemUpgrade; чужой link не снимается.
- Portal actions не теряются вне panel DOM; клики источника не устанавливают и не навигируют.
- Rebind/close/outside/Escape освобождает tooltip/catalog/contextmenu listeners.
- Player выполняет прежнюю active-GM typed command, не получает обход прав/ack.

### Task 1: Canonical снятие

**Files:** item-instance-documents.js, weapon-mod-mutations test/fixture, instance adapter tests.
**Interfaces:** #update(fields) сохраняет nullable system.container:null вместо -=; остальные flags/replace semantics прежние.

- [x] RED schema-aware removal drops entire invalid delete patch; preserve source/qty/compensation, successful clear expects null.
- [x] Минимальный fix; focused instance/mutations/transport/rebuild GREEN; native Item clone + real adapter placement/verify без сохранения мира.

### Task 2: Tooltip, ПКМ и выпуск

**Files:** weapon-mod-panel.js, item-upgrade-sheet.js, dnd5e-sheet-extensions.js, anchored-overlay.js, styles, focused UI/overlay tests; docs/release.
**Interfaces:** Inject existing openHeldItemContextMenu through bindItemUpgradeSheet options. Shared tooltip accepts optional className/preferredPlacement, defaults unchanged. Catalog uses existing AnchoredOverlay, source anchors have data-link/UUID and no href. Context action helper preserves proper removal owner.

- [x] RED tooltip portal/options, no inline catalog/href, context action routing/legacy guard, placement defaults and cleanup.
- [x] Минимальная реализация, GREEN owner tests; native hover/PKM/catalog/document link/no newtab, readonly native removal clone; снимки.
- [x] Паспорт/README/report, независимый review и один fix pass Important; release392, full tests/syntax/JSON/diff.
- [x] Scoped commit/push lich_branch, clean0 0; отчёт с spec/plan/evidence/ограничениями.
