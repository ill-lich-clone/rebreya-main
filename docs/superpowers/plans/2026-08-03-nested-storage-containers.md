# Nested Storage Containers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkboxes for progress tracking.

**Goal:** Restore reliable module startup, remove the retired external pile integration, and let Rebreya containers move between scenes, other containers, and inventories while retaining fully usable nested contents.

**Architecture:** Keep scene storage state and portable container state in one normalized recursive snapshot. Scene tokens remain roots while portable dnd5e Items store the same snapshot under `flags.rebreya-main.storageContainer`; all mutations resolve a root plus a nested container path and commit atomically. UI renders one compact grid with a detached popover and breadcrumbs.

**Tech Stack:** Foundry VTT v13, dnd5e 5.2.5, native ES modules, ApplicationV2, Handlebars, node:test.

## Global Constraints

- Work only on `lich_branch`; never force-push.
- Preserve unrelated user changes and stop for foreign changes or a real `origin/main` conflict.
- Do not create custom dnd5e Item subtypes for portable containers.
- Maximum nesting depth is 8; reject self/ancestor cycles.
- Container rows have quantity 1 and never stack.
- A successful whole-token move deletes the source token; rollback the target if source deletion fails.
- Durable chests/bags remain when empty; ephemeral ground piles delete when empty.
- Use tests before production changes and run the full suite before push.

---

## Task 1: Restore a valid Foundry entrypoint

**Files:** `tests/module-manifest.test.mjs`, `module.json`, `scripts/main-1.4.118.js`, `scripts/main.js`

- [x] Change the manifest test to require version `1.4.118`, a query-free `scripts/main-1.4.118.js` entry, and an existing wrapper file.
- [x] Run the focused test and confirm it fails against the invalid query-string path.
- [x] Add the real versioned wrapper, update the manifest, and retain `state`/`gadget` declarations; the versioned wrapper cache-busts the canonical graph.
- [x] Run manifest and registration tests and commit `fix: restore valid Foundry module entrypoint`.

## Task 2: Remove retired pile integration residue

**Files:** `README.md`, `tests/**/*.test.mjs`, `docs/**/*.md`, generated architecture output if applicable

- [x] Add/adjust a repository guard proving production and manifest have no retired external integration lifecycle.
- [x] Remove obsolete flags, documentation, compatibility tests, and the historical implementation plan dedicated to that integration.
- [x] Regenerate architecture documentation after removing the retired plan from the source graph.
- [x] Run focused guards and verify a repository search has no runtime dependency/reference.
- [x] Commit `chore: remove retired pile integration residue`.

## Task 3: Add the recursive container snapshot domain

**Files:** `scripts/data/storage-container-snapshot.js`, `tests/storage-container-snapshot.test.mjs`

- [x] Test normalization of item/container rows, stable IDs, quantity-one semantics, depth limit, cycle rejection, path resolution, and immutable path updates.
- [x] Implement snapshot normalization and helpers with no required Foundry globals.
- [x] Test conversion to/from a standard dnd5e Item flag payload.
- [x] Commit `feat: add recursive storage container snapshots`.

## Task 4: Make storage mutations path-aware

**Files:** `scripts/data/storage-service.js`, `scripts/data/storage-command-service.js`, related storage tests

- [ ] Test reads, claims, edits, deposits, live refreshes, queue keys, and rollback at nested paths.
- [ ] Extend payload validation with exact nested paths and keep root payloads backward compatible.
- [ ] Resolve and mutate root scene-token or portable-Item snapshots atomically.
- [ ] Reject self/ancestor deposits and preserve the deepest valid open path after updates.
- [ ] Commit `feat: support nested storage mutations`.

## Task 5: Move whole containers and portable Items

**Files:** `scripts/data/storage-deposit-source.js`, `scripts/data/storage-command-service.js`, `scripts/data/inventory-service.js`, new focused integration/service files, tests

- [ ] Test token, nested-row, and flagged Item deposit sources with consume/restore receipts.
- [ ] Test taking a container creates a standard dnd5e container Item with its complete recursive snapshot.
- [ ] Test dropping that Item to a scene reconstructs the correct token and removes the embedded source Item only after success.
- [ ] Test whole source-token transfer deletes the source and rolls back the destination on deletion failure.
- [ ] Register Item-sheet open actions and scene-drop restoration without custom Item types.
- [ ] Commit `feat: make storage containers portable`.

## Task 6: Add one-second token/container drop affordance

**Files:** `scripts/integrations/storage-token-drop.js` or a focused token-transfer integration, `styles/main.css`, tests

- [ ] Test one-second hover feedback, cancellation, permission/distance checks, and a single committed drop.
- [ ] Support whole storage tokens, storage rows, and portable storage Items as sources.
- [ ] Show `Отпустите, чтобы добавить` above the target without changing grid layout.
- [ ] Commit `feat: allow dropping containers into storage`.

## Task 7: Detach the compact popover and add nested navigation

**Files:** `scripts/ui/storage-app.js`, `templates/storage-app.hbs`, `styles/main.css`, `tests/storage-app.test.mjs`

- [ ] Test that the active popover is a sibling of the grid and the grid has no expansion padding.
- [ ] Render a single active popover outside the grid, position it to the chosen icon, and clamp it inside the app.
- [ ] Render breadcrumbs and open nested containers in the same app; keep left/right-click and drag behavior working.
- [ ] Verify live updates preserve a valid nested path and close invalid paths.
- [ ] Commit `feat: add compact nested storage navigation`.

## Task 8: Wire, verify, and publish

**Files:** `scripts/main.js`, socket/API tests, release metadata

- [ ] Register new services/hooks/API methods and bump all changed cache keys.
- [ ] Run focused tests, syntax checks, then the complete test suite.
- [ ] Review `git diff`, scan for invalid manifest URLs and retired dependency references, and confirm `origin/main` ancestry again.
- [ ] Perform the available live Foundry smoke test: module initializes, chest opens, nested container moves to inventory and back to scene.
- [ ] Commit remaining wiring, push `lich_branch` without force, and report any live-only limitation precisely.
