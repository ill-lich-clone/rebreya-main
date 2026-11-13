# Creature Harvesting Implementation Plan

> Use superpowers:executing-plans and test-driven-development for each task.

**Goal** — Ship a player-facing harvesting dialog and import the authored monster loot catalog.

**Architecture** — Extend the equipment importer and the existing corpse storage command path. Keep roll outcomes and catalog matching in pure rules. Persist authoritative attempts in the existing world settings repository and append loot with a receipt through StorageService.

**Tech stack** — Foundry VTT, dnd5e, JavaScript ES modules, Handlebars, Node test runner.

**Spec** — `docs/superpowers/specs/2026-11-13-creature-harvesting-design.md`.

## Constraints and review focus

Use the current `lich_branch` checkout. Keep current equipment catalogs and ordinary corpse gear intact. Validate all player requests on the active GM and share the corpse storage scheduling key. Verify ambiguous monster names, legacy snapshots, marked storage, linked tokens, competing claims, uncertain roll results and ranked materials.

## 1. Monster catalog

- [x] Add focused tests in `tests/equipment-import-monsters.test.mjs` for exact sheet columns, repeated names, stable IDs, blank loot, rank 10 and destructive guards. Run `node --test tests/equipment-import-monsters.test.mjs` and observe failure.
- [x] Add `adaptMonstersCatalog(snapshot)` in `tools/equipment-import/adapters/monsters.mjs`. Extend the sheet registry, snapshot, pipeline, serialization, diff and CLI to produce `data/monsters.json`. Preserve legacy snapshots by keeping the already generated catalog when the old snapshot lacks the sheet. Generate the catalog from the authorized workbook and compare imported rows with the source.
- [x] Run `node --test tests/equipment-import-*.test.mjs`.

## 2. Harvest rules and corpse persistence

- [x] Add `tests/creature-harvesting.test.mjs` covering exact name resolution and substitute selection, humanoid denial, rank 0–10, the inclusive hour, all four result ranges, blood, item lookup and the unique placeholder. Add storage tests for attempts and atomic append. Run focused tests to observe failure.
- [x] Add pure rules in `scripts/data/creature-harvesting.js` for identity, availability, rules table and rewards. Use the token death transition as the clock origin. Store the time, configuration and result in a GM-owned world record and save the rows and receipt together through `StorageService`.
- [x] Run focused tests including `tests/storage-service.test.mjs` and `tests/corpse-storage-materializer.test.mjs`.

## 3. Authoritative roll and player dialog

- [x] Add failing integration tests in `tests/creature-harvesting-command.test.mjs` and `tests/storage-app.test.mjs` for validated read, begin and GM actions, permission and freshness checks, result recovery and shared storage. Verify the player can retry after choosing an analogue without consuming an attempt.
- [x] Extend `scripts/data/storage-command-service.js`, `scripts/main.js`, `scripts/ui/storage-app.js` and `templates/storage-app.hbs`. Use existing storage access and scheduling, dnd5e rolls and the material catalog. Add GM configuration and resolution controls to the same dialog.
- [x] Run focused command, socket, storage and UI tests.

## 4. Release and verification

- [x] Update `README.md`, `docs/function-passport.md`, `module.json` and the versioned forwarder. Exercise tests from each prior step, run the full suite and check tracked and added JS/JSON files and the diff.
- [ ] Get a fresh review against the approved spec and address important findings. Commit only task files and push `lich_branch`.
