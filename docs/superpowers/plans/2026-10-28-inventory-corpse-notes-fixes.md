# Corpse, Material Stacks and Notes Implementation Plan

> Execute inline with superpowers:executing-plans and TDD; one independent final review.

**Goal:** Fix reports3/4/9 while preserving existing inventory/corpse/note contracts.
**Architecture:** Extend existing corpse classification/durability hooks, InventoryService merge/receipts and storage journal-record API. Reuse current viewer and authorization boundaries.
**Tech Stack:** Foundry13/dnd5e JavaScript ESM, Node tests.
**Spec:** docs/superpowers/specs/2026-10-28-inventory-corpse-notes-fixes-design.md

## Global constraints

Only lich_branch, no foreign dirty files/force push. No new dependencies/settings/journals; preserve formulas, budgets, material precision and native concurrency. Release1.5.19, retain old forwarders.

## Review focus

- Dead unmarked NPC with token storage state must never be projected to18HP chest; real storage Actors still work.
- Startup repair and live storage update repair preserve loot and creature HP/bar fields outside the erroneous projection.
- Global materials keep existing folder and correct logical quantities, equivalent currency prices and acquisition histories; different economic units stay distinct.
- Group note target and source read permission are checked for actual sender, not elected GM executing the command.
- Notes remain usable via real inventory open action and storage record/direct drop, without leaking protected Journal content.

### Task1 — Corpse classification/reconciliation

Files: storage-corpse-target.js, storage-object-kind.js, durability-hooks.js; focused storage-object-kind/native-durability-hooks/corpse suites.
- [x] Write RED regressions for unmaterialized dead-NPC storage state, legacy18HP projection and immediate corpse interaction.
- [x] Fix canonical classification and narrow startup/live restoration; run affected tests GREEN.

### Task2 — Global material compatibility

Files: inventory-service.js; inventory-native-owner and recovery suites.
- [x] Write RED tests for dismantles merging across folders and equivalent gp/sp/cp prices; preserve distinct unit weight/price.
- [x] Fix shared candidate/receipt rules and old/native dismantle paths without moving existing stacks; run GREEN.

### Task3 — Group note add/read

Files: main.js, storage-command-service.js and existing UI only if needed; storage-socket/module-api and inventory-app tests.
- [x] Write RED end-to-end group record/drop/read tests plus forbidden source/target regressions.
- [x] Resolve current group for players, authorize exact sender/target/source, preserve record Items/viewer/legacy fallback; run GREEN.

### Task4 — Delivery

- [x] Update passports/README, version1.5.19, forwarder and canonical changed-owner imports/cache tests.
- [x] Independent review; fix real Critical/Important findings with tests.
- [x] Full node tests, tracked node --check, JSON ConvertFrom-Json, git diff --check; document live limit and counts.
- [x] Inspect diff/stat, re-fetch/check branch, explicitly stage task files, commit/push lich_branch and confirm clean/synchronized.

## Execution results

Reports3/4/9 implemented in existing owners, with explicit global-material policy chosen by user. Corpse repair requires independent death or complete-corpse evidence; ambiguous positive-HP legacy tokens remain unchanged to preserve genuine token-only chests. Independent review found and verified removal of objectDurability-only death heuristic; no remaining Critical/Important findings. Full `node --test tests/*.test.mjs`:5228tests,5227passed,0failed,1skipped. `node --check`:1101JS/MJS passed,3affectedfiles rechecked after review fix. JSON `ConvertFrom-Json`:65passed. `git diff --check`:passed. Version1.5.19/forwarder/cache closure23modules; old forwarders retained. Browser onlyabout:blank and read-only MCP smoke reports bridge module disconnected, so no live Foundry claim. Final commit/push identity is recorded in task report.
