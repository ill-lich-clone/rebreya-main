# Magic Item Stale Automation Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and superpowers:verification-before-completion. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After every compendium and owned-item sync, the managed magic-item automation exactly matches the fresh projection while unmanaged data and runtime use counters survive.

**Architecture:** Keep projection ownership in `magic-items-compendium.js`, generic update lifecycle in `managed-compendium-sync.js`, and pure embedded reconciliation in `magic-item-embedded-sync.js`. Detect same-signature embedded drift explicitly, delete only stale managed ActiveEffects through the Foundry embedded-document API, and express stale activity removal with dnd5e's `system.activities.-=<id>` update keys.

**Tech Stack:** Foundry VTT 13, dnd5e 5.2.5 document APIs, ESM JavaScript, Node test runner.

**Spec:** User request in the current task; function passport lines 365-372.

## Global Constraints

- Work only on `lich_branch`; commit and push without force.
- Never delete/recreate every embedded document.
- Preserve unmanaged effects and activities, item/activity `uses.spent`, and optional CPR behavior.
- Bump `module.json` and synchronize the versioned forwarder.
- Update `docs/function-passport.md` for every changed method.

---

### Task 1: Prove generic same-signature drift is repairable

**Files:**
- Modify: `tests/managed-compendium-sync.test.mjs`
- Modify: `scripts/data/managed-compendium-sync.js`

**Interfaces:**
- Consumes: existing `syncManagedDocuments(options)` lifecycle.
- Produces: optional `documentMatchesEntry(document, entry)` and `applyUpdate(document, data, entry)` hooks with unchanged defaults.

- [ ] Add a test whose stored signature matches but whose embedded projection is reported stale.
- [ ] Run the test and verify it fails because the document is counted unchanged.
- [ ] Add the two optional hooks and preserve existing create/update/delete ordering.
- [ ] Run the focused test and verify it passes.

### Task 2: Reconcile pack automation without touching unmanaged data

**Files:**
- Modify: `tests/magic-items-compendium.test.mjs`
- Modify: `scripts/data/magic-items-compendium.js`

**Interfaces:**
- Consumes: fresh `createMagicItemData()` output and pure embedded cleanup metadata.
- Produces: `MagicItemsCompendiumService.sync()` that detects stale managed IDs even when signatures match and deletes only those IDs.

- [ ] Add a pack-sync regression with stale and unmanaged effects/activities.
- [ ] Run the test and verify stale IDs survive under the current update path.
- [ ] Wire the generic hooks to the magic-item projection and delete stale managed ActiveEffects plus activity keys.
- [ ] Remove the overlapping explicit entries for `обруч-заклинателя-2` and `пояс-атлета-1`; keep the generated skill-family definitions canonical.
- [ ] Run the focused test and verify exact managed projection plus unmanaged preservation.

### Task 3: Clean already-distributed owned duplicates

**Files:**
- Modify: `tests/magic-item-equipped-sync.test.mjs`
- Modify: `scripts/data/magic-item-embedded-sync.js`
- Modify: `scripts/data/magic-items-compendium.js`

**Interfaces:**
- Consumes: `buildEmbeddedMagicItemPatch(item, projection, resolution)`.
- Produces: stale effect/activity IDs alongside the existing update; owned orchestration applies each cleanup and Item update in isolation.

- [ ] Add a regression containing stale managed and unmanaged embedded documents plus non-zero item/activity spent uses.
- [ ] Run the test and verify stale IDs are not explicitly removed.
- [ ] Compute removal IDs from existing-vs-merged projections and add dnd5e activity deletion keys.
- [ ] Delete only returned ActiveEffect IDs before each isolated owned Item update.
- [ ] Run all three focused test files and verify they pass.

### Task 4: Release metadata, documentation, and verification

**Files:**
- Modify: `docs/function-passport.md`
- Modify: `module.json`
- Rename: `scripts/main-1.4.290.js` to `scripts/main-1.4.291.js`

**Interfaces:**
- Produces: documented current contracts and cache-busting runtime entrypoint.

- [ ] Update only passport lines 365-372 for the changed methods and data flow.
- [ ] Increment the module patch version and synchronize `esmodules` plus the forwarder filename.
- [ ] Run the three focused tests, then the full Node suite, JS syntax checks, JSON parsing, and `git diff --check`.
- [ ] Review `git diff --stat` and the substantive diff.
- [ ] Commit only task files and push `lich_branch` to origin without force.
