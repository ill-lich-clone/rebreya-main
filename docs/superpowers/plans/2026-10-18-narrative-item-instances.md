# Narrative Item Instances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for Native execution after user review. Follow TDD and verify each changed owner.

**Goal:** Show and preserve the same selected personalisation from map placement through inspection and pickup, restoring an empty title on opening.

**Architecture:** Extend the existing narrative catalogue and creation integration. A pure storage-row adapter reuses them; existing storage owners receive one shared preparation callback from main.js. UI opens detached saved ItemData or the actual owned instance; existing auth and transaction routes remain unchanged.

**Tech Stack:** JavaScript ESM, Foundry v13/dnd5e, Node test runner, PowerShell.

**Spec:** `docs/superpowers/specs/2026-10-18-narrative-item-instances-design.md`

## Global Constraints

- Selected variant and saved instance text are authoritative; reopening/pickup/retry never select another variant.
- Restore an empty name from the selected title. Preserve a non-empty manual rename; never modify compendium sources.
- Preserve quantities, fractional materials, mechanical fields, source identity, budgets/spending, permissions, queues, rollback and recovery.
- Split quantity-N personalisable rows into N non-stacking quantity-one rows with unique IDs. Claimed rows, coins and Journals remain unchanged.
- Release `1.4.395`, historical forwarders retained, one canonical URL per affected runtime owner.
- Work in the current installed checkout on `lich_branch`; stage only task files and push without force.

## Review Focus

- Raw canonical gear map drops bypass Item creation: verify a real StorageGroundPileService write stores selected title/description.
- Existing opened storage may contain generic legacy rows: opening repairs and persists once; unchanged reopening performs no write/random draw.
- Quantity >1 and identical random variants must not lose or merge physical copies; include nested container rows and unrelated fractional material.
- Inspection and both pickup destinations must use saved itemData and preserve exact selected identity, including after catalogue changes.
- Sheet renders can repeat or be read-only: restore only empty names, respect permissions, avoid loops/duplicate hooks and source writes.

### Task 1: Restore the existing instance pipeline and release it

**Runtime files:**
- Extend `scripts/data/lootgen-narrative-catalog.js`: chosen title becomes initial Item name, base name retained as metadata; export `buildNarrativeItemNamePatch(itemData, catalog) -> {name}|null` for blank-name repair without RNG.
- Create `scripts/data/storage-narrative-rows.js`: export `prepareStorageNarrativeRows(rows, catalog, {random, idFactory, claimedRowIds}={}) -> rows`, using the existing canonical variant selection and preserving recursive container state.
- Extend `scripts/data/storage-service.js`, `scripts/data/storage-ground-pile-service.js` and `scripts/data/storage-container-item-service.js` with optional `prepareRows` callbacks (identity by default). Prepare on storage writes/opening and authoritative ground/container writes, respecting duplicate mutation checks and skipping claimed IDs.
- Extend `scripts/integrations/narrative-item-creation.js`: include name in the creation patch and register guarded V1/V2 sheet name restoration through the existing hook owner.
- Extend `scripts/ui/storage-app.js`: export `openStorageRowItem(row, {ItemClass,catalog}={})`, use a detached read-only saved instance before source fallback.
- Extend `scripts/ui/inventory-app.js`: personalised inventory Items open their actual sheet before source resolution.
- Extend `scripts/data/storage-row-stacking.js`: reject narrative/nonStackable metadata even for equivalent variants.
- Wire the shared preparation provider in `scripts/main.js`; no new privileged API or socket command.

**Tests:** `tests/lootgen-narrative-catalog.test.mjs`, `tests/narrative-item-creation.test.mjs`, new `tests/storage-narrative-rows.test.mjs`, `tests/storage-ground-pile-service.test.mjs`, `tests/storage-service.test.mjs`, `tests/storage-app.test.mjs`, `tests/storage-socket.test.mjs`, `tests/inventory-app-context.test.mjs`, `tests/storage-row-stacking.test.mjs`, and affected release assertions.

- [x] Add failing owner regressions for each Review Focus condition before runtime edits. Use actual classes and persisted state; assert exact selected flags/title/description, quantity sums, immutable sources, zero unexpected RNG calls/writes, and read-only rendering. Verify expected RED failures, rather than import/setup errors.
- [x] Implement catalogue title policy, pure row adapter, shared storage callback and duplicate-safe integration. Test first/last RNG, saved ID with changed/missing catalogue entries, legacy metadata, N copies, nested containers and excluded row types.
- [x] Implement saved-instance inspection and inventory opening, then blank-name repair in the existing narrative hook owner. Test non-empty custom names, compendium exclusion, repeated render, owner update vs read-only local projection.
- [x] Verify both character and group claim routes preserve the saved selected instance through real StorageCommandService flows, with no random draws or rebuild from source. Preserve existing quantity, receipt, access and rollback tests.
- [x] Run affected focused suites; require no failures. Document any newly found unrelated baseline failures rather than hiding them.
- [x] Bump module/forwarder to `1.4.395`. Update the reverse importer closure of modified runtime owners to `?v=1.4.395`, preserving one URL per owner. Final closure contains 43 owners and 42 updated importers; most changes are import-only. Preserve unrelated cache keys and all release assertions, updating version pins only where the graph changes.
- [x] Update narrative/storage/view contracts in `docs/function-passport.md`, README behaviour, spec status and this execution record.
- [x] Run full `node --test --test-reporter=tap tests/*.test.mjs`, `node --check` on tracked and new JS/MJS, parse tracked JSON, and `git diff --check`. Report counts, failures and skips; reuse valid results unless affected code changes.
- [x] Reuse an authenticated Foundry test tab if available for map inspection and pickup; otherwise report live validation as unavailable. Do not claim an offline test is a live pass.
- [x] Obtain a compact independent Gemini review of the complete task diff/requirements. Verify findings against source, fix material issues with failing tests first, rerun affected checks.
- [x] Inspect complete/staged diff and task scope, commit `fix(narrative): preserve personalised item instances`, and `git push -u origin lich_branch`. Record spec/plan paths, commit and validations in the final task report.

## Baseline and status

Before runtime edits: narrative catalogue/integration and storage app/service/ground-pile/socket suites passed **308/308**, zero failures. Installed Foundry is 13.351 and dnd5e 5.2.5; no live acceptance has been performed. Gemini reviewed supplied catalogue/integration source; its speculative unflagged-name matching suggestion was excluded because the bug is confirmed in the module's serialized storage route.

Spec and plan approved by the user on 2026-10-18. Native execution selected.

## Review decisions and implementation notes

- Root container placement also receives the shared prepareRows callback through the existing StorageContainerItemService.restoreSnapshotToScene. This is required for the same approved all-personalisable-item scope; current snapshot presentation.itemData remains authoritative. Container IDs, types, capacities and physical contents are unchanged.
- The composition callback reuses LootgenSourceCatalog.getNarrativeCatalog rather than introducing a second loader owner. The offline corpse composition test injects the actual local catalogue through this existing dependency; all original assertions remain.
- Gemini review: fix asynchronous repair reopening a closed sheet (regraded Important), preview document ID collisions (Important), and exact saved-variant title lookup when inline title metadata is absent (Important). Each covering regression was observed failing before its fix, then 67 relevant tests passed. Temporary documents additionally require collection identity membership before any persistent update; otherwise repair is local.
- Ruling: no texture/geometry change is required after narrative selection. containerTopDownPresentation reads stable presentation.itemIdentity, which personalisation preserves; selected variants have title/description only. Token names and saved presentation data use the prepared snapshot. Risk if this assumption changes: adding variant-specific art would require recalculating visual presentation after selection.
- Ruling: container.state is guaranteed by existing snapshot normalizers at storage service boundaries. The internal adapter consumes normalized snapshots. baseName is the storage display label (including the existing empty suffix), not its archetype; storageKind/itemIdentity preserve the archetype. Invalid direct calls with malformed wrappers can still fail before any document write.
- Ruling: saved-instance inspection for ordinary Item rows is deliberate approved behaviour; source lookup is retained when no usable ItemData exists. It preserves the actual physical description/durability.
- Ruling: already selected rows do not cause repeated catalogue HTTP requests: the canonical loader caches its promise. They still need title repair/normalization, without RNG or unchanged-state writes, as covered by tests.
- Live browser discovery exposes only empty in-app/MCP surfaces and no authenticated Foundry tab. No live window or pickup test is claimed.
- An additional unchanged-open regression exposed metadata key reordering that triggered a redundant world write for an already selected ground row. The adapter now preserves existing flag key order and adds only missing fields. The actual StorageService regression failed before the fix; 124 affected tests then passed.

## Execution evidence

- Baseline: 308 passed, 0 failed. Behaviour regressions were observed RED before fixes, including real map/storage/inventory owner paths and both claim destinations. The initial broad full run exposed an offline corpse fixture using relative fetch; it now injects the real local catalogue through the existing dependency, retaining its original assertions.
- Focused owner coverage: 507 passed, 0 failed; additional container coverage: 160 passed, 0 failed. Subsequent review/idempotency changes passed their affected suites (67 and 124 tests respectively).
- Final `node --test --test-reporter=tap tests/*.test.mjs`: **4846 passed, 0 failed, 1 skipped** (4847 tests). The existing skipped test is `rendered ghost is removable and mechanically empty; authored names are escaped and readonly controls disabled`, because the Foundry Handlebars dependency is unavailable (`set NODE_PATH`). No test was newly disabled.
- `node --check`: 1023 tracked/new JS/MJS files passed; affected files rechecked after later changes. Tracked JSON parsing: 58 files passed. `git diff --check` passed.
- Release: module.json and minimal forwarder use 1.4.395; affected import closure uses canonical versioned URLs. Historical forwarders remain.
- Live acceptance remains unverified: no authenticated Foundry tab was available. Refresh GM/player clients before checking the installed release.

### Task 2: Complete real-catalog coverage and retain source HTML

Continuation of the same approved all-personalisable-item scope, requested
after release 1.4.395. Native execution remains selected. The user explicitly
confirmed keeping source names where authored titles are blank.

**Owners:** `scripts/data/lootgen-narrative-catalog.js`, existing repair paths
in `scripts/integrations/narrative-item-creation.js` and `scripts/ui/storage-app.js`.
Use the existing `canonicalCatalogId`; preserve raw import artifacts and
variant IDs. Add `buildNarrativeItemRepairPatch(itemData,catalog)` for name
repair plus exact legacy generated-description footer repair, using saved
material/tool/Value flags only. New narrative HTML precedes unchanged source
HTML; custom descriptions are never reconstructed. Existing storage callback
consumes this repair through `buildNarrativeItemCreationPatch`.

- [x] Add real-data regression coverage for all 160 narrative groups after
  `normalizeEconomyDataset` and `createDnd5eItemData`, first/last selection,
  stable variant IDs/ranks, blank-title names, complete source HTML and price
  preservation. Observe the 9 missing groups and description loss failing.
- [x] Add exact legacy footer repair and no-change/custom-description cases;
  verify owned sheet and detached preview preserve name, quantity and other
  system fields. Observe RED before changing their owners.
- [x] Normalize narrative gear IDs and creation lookup with canonical policy,
  prepend narrative to source HTML, and implement guarded repair in the three
  existing consumers. Run affected catalogue/creation/storage/claim suites.
- [x] Release 1.4.396 and update the affected reverse import closure, forwarder,
  version assertions, README and function passport. Run the full suite,
  tracked/new syntax checks, tracked JSON parsing and diff checks.
- [x] Obtain a compact independent Gemini review; verify claims, correct
  material findings with RED/GREEN evidence, inspect final scope, commit and
  push only task files on lich_branch.

Diagnosis evidence: real normalized gear matched 151/160 groups; all 9
failures have Cyrillic IDs in the narrative artifact and Latin canonical IDs
in runtime gear. Original Value HTML was absent after application. Gemini's
description-overwrite finding was verified; its proposed rank/name remapping,
rank-root limits and quantity-policy changes were rejected against actual
data and existing quantity-one/splitting contracts. The local bridge reports
Foundry disconnected, so live acceptance is currently unavailable.

Task 2 execution evidence:
- Baseline: 76 passed. Six new regressions failed for real-ID coverage, source HTML, ranked physical copies, legacy repair, owned repair and preview repair; then 351 affected tests passed. Blank-title empty-name restoration additionally failed RED and passed with 83 relevant tests.
- Final full `node --test --test-reporter=tap tests/*.test.mjs`: **4853 passed, 0 failed, 1 existing Handlebars dependency skip** (4854 tests). No new skip.
- `node --check`: **1025 tracked/new JS/MJS files passed**. Tracked JSON: **58 passed**, including PowerShell `ConvertFrom-Json`. `git diff --check` passed.
- Release 1.4.396: 43 affected runtime owners, 42 updated importers; 40 importer files contain only cache URL changes (line endings normalized for comparison). Stable variant IDs/raw source artifacts remain unchanged.
- Independent Gemini review returned PASS with no actionable findings; its release synchronization uncertainty is covered by 66 release/coverage checks.
- Blank-title source-name restoration is a necessary part of the already approved empty-name contract; it uses saved narrativeBaseName or exact-variant sourceName, without RNG.
- Foundry MCP diagnostic reports the module disconnected. No live compatibility or visual acceptance is claimed.
- Final task commit/push is reported in the chat; this execution record is part of that commit.
