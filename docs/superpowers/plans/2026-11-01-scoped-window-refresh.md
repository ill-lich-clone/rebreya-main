# Scoped Window Refresh Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans; changes are test-first and each task retains observable freshness and current transactions.

**Goal:** Keep every affected view current while eliminating unrelated sheet and application renders.
**Architecture:** Extend existing `RebreyaMainModule` refresh coordination with named data scopes and explicit Actor IDs; keep the public no-argument full refresh. Route each existing operation to its real data owners. Limit reagent-sheet rendering to changes in displayed state. Never create a competing hook, application or data owner.
**Tech Stack:** Foundry VTT 13, dnd5e, ES modules, Node test runner.
**Spec:** docs/superpowers/specs/2026-11-01-scoped-window-refresh-design.md

## Global Constraints
Preserve rules, authored formulas, settings, flags, permission, sockets, recovery and spending; preserve errors, focus, scrolling and UI coalescing; unknown dependency defaults to correct freshness. Module player files require version bump and cache keys. Maintain public full refresh entry point.

## Review Focus
- Mixed open character/NPC sheets, ordinary and synthetic tokens, no actor, UUID and multiple actors: target only affected sheets without cross-actor omissions.
- Player→GM command, local active GM, rejected/replayed/partial operations: same authoritative state, no extra mutation or misleading success.
- Inventory main/folder views, currently minimized/closed windows: preserve scope, invalidation, focus, scroll and re-open freshness.
- Trading/calendar/global events: every dependent economy, city, trader, group and inventory view remains fresh; unrelated views remain idle.
- World-time jumps both directions, reagent effect changes, expired/disabled effects: exact visible value and no stale count.

### Task 1: Canonical scoped refresh
**Files:** `scripts/main.js`, `tests/ui-refresh-coordinator.test.mjs`.
- [ ] Write failing tests with two actor sheets, inventory, city, trader and unrelated windows; assert data-specific scopes, target IDs, scoped inventory, minimized/closed behavior and no duplicate renders.
- [ ] Extend the existing coordinator with narrowly named refresh entry points and explicit Actor IDs; preserve `refreshOpenApps()` full semantics and errors.
- [ ] Run focused coordinator tests, comparing result to the spec.

### Task 2: Combat and weapon modifications
**Files:** `scripts/main.js`, `scripts/automation/item-upgrade-automation-service.js` only if needed, focused combat/weapon/socket tests.
- [ ] Write red tests for status socket/local, reaction, jam/maintenance, upgrade and launcher activity; assert affected actor/inventory views update while unrelated sheets and apps do not.
- [ ] Route each operation to the canonical scoped owner using actor identity from the document or command payload; preserve execution order, data and error results.
- [ ] Run focused tests plus existing combat, weapon modification and command tests.

### Task 3: Trading, transport and group
**Files:** `scripts/ui/trader-app-v2.js`, `scripts/main.js`, trader/transport/group and refresh tests.
- [ ] Test purchases, sales, partial basket results, transport and group changes against affected and unrelated actor/application windows; ensure GM and requester behavior.
- [ ] Replace broad refresh with specific trade, inventory and group/transport scopes using receipt IDs and established snapshots; preserve focus, notification, partial recovery and existing transaction routes.
- [ ] Run focused trader, transport, inventory and command tests.

### Task 4: Calendar, world and reagent effects
**Files:** `scripts/main.js`, `scripts/data/alchemy-reagent-service.js`, `scripts/combat/hooks.js` if necessary, associated tests.
- [ ] Test calendar day and time changes, multiple effect owners, expired/disabled effects, backward and forward jumps; assert displayed totals/time remain exact without unrelated renders.
- [ ] Scope calendar/economy/global event and world operations to their established dependent apps; preserve explicit full data reload. Replace unnecessary reagent full-sheet refresh only with a proven equivalent.
- [ ] Run focused calendar, global events, economy and reagent suites.

### Task 5: Release and verification
- [ ] Bump manifest, forwarder, every modified ESM cache key and related release tests; update passport and README.
- [ ] Run all focused suites and full `node --test tests/*.test.mjs`, `git diff --check`, `node --check` for JS/MJS, JSON parsing and meaningful diff review.
- [ ] Exercise actual Foundry where safe without changing live actors; record any unavailable GM/player validation. Review implementation against all five Review Focus cases.
- [ ] Commit only task files and push `lich_branch` after checking remote state.
