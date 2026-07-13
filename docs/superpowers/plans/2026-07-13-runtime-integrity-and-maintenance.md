# Runtime Integrity and Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make persistent automations recoverable, centralize managed-compendium synchronization, remove verified legacy duplication, and document the module as an authoritative maintenance contract.

**Architecture:** Typed active-GM commands own cross-user mutations. Domain workflows use idempotent phase journals and compensation. Managed compendia share a diff-based lifecycle while keeping feature normalization local. Cleanup follows call-site migration and focused tests, and README documents every automation boundary.

**Tech Stack:** Foundry VTT v13, dnd5e, browser ES modules, Node.js `node:test`, Handlebars ApplicationV2.

## Global Constraints

- Work only on `lich_branch`; fetch and inspect `origin/main` before every new edit cycle.
- Do not force push.
- Preserve game rules and automation behavior except for specified reliability fixes.
- Write and run a failing regression test before every production behavior change.
- Migrate shared infrastructure one domain at a time; run focused tests after each migration.
- Keep `scripts/main.js` canonical and `scripts/main-1.4.93.js` as the sole versioned forwarder.

---

## File structure

- `scripts/infrastructure/foundry/socket-command-bus.js`: authenticated transport/envelope binding.
- `scripts/combat/performer-automation-service.js`: Performer request preparation and active-GM commit.
- `scripts/integrations/effectmacro-compat.js`: single-active-GM EffectMacro execution.
- `scripts/application/durable-mutation-journal.js`: small domain-neutral idempotent phase primitive.
- `scripts/data/crafting-service.js`: recoverable craft queue/cancel/complete workflows.
- `scripts/data/inventory-service.js`: recoverable take/sell/import workflows.
- `scripts/application/loot-claim-service.js`: durable row/coin claim orchestration.
- `scripts/data/managed-compendium-sync.js`: shared diff-based managed pack lifecycle.
- `scripts/shared/foundry-values.js`: identical collection/clone/escape helpers only.
- Feature compendium services: retain normalization and document builders, delegate lifecycle.
- `README.md`: authoritative architecture, API, persistence, and automation catalog.

### Task 1: Bind socket commands to authenticated transport senders

**Files:**
- Modify: `scripts/infrastructure/foundry/socket-command-bus.js`
- Modify: `scripts/main.js`
- Test: `tests/world-mutation-infrastructure.test.mjs`

**Interfaces:**
- Consumes: Foundry callback `(message, transportSenderId)`.
- Produces: `SocketCommandBus.handleMessage(message, { transportSenderId })`.

- [ ] **Step 1: Write the failing mismatch test**

```js
test("SocketCommandBus rejects an envelope sender that differs from the transport sender", async () => {
  bus.handleMessage(request("group.calendar.patch", "gm-a", payload), {
    transportSenderId: "player-a"
  });
  await flushPromises();
  assert.equal(result.error.code, "sender-mismatch");
  assert.equal(executeCalls, 0);
});
```

- [ ] **Step 2: Run `node --test tests/world-mutation-infrastructure.test.mjs` and verify the test fails because `handleMessage` ignores the transport sender.**
- [ ] **Step 3: Pass `senderId` from `RebreyaMainModule.handleSocketMessage` into the bus and compare it before authorization.**

```js
handleMessage(message, { transportSenderId = "" } = {}) {
  // Result handling remains correlated separately.
  this.#handleRequest(message, String(transportSenderId ?? "")).catch(() => undefined);
}

if (transportSenderId && transportSenderId !== message.senderId) {
  this.#emitOutcome(correlation, errorOutcome("sender-mismatch", "Socket sender mismatch"), game);
  return;
}
```

- [ ] **Step 4: Run the focused test and `tests/group-command-dispatch.test.mjs` plus `tests/trader-command-dispatch.test.mjs`.**
- [ ] **Step 5: Commit `fix: bind socket commands to transport senders`.**

### Task 2: Route Performer Active Performance through the active GM

**Files:**
- Modify: `scripts/combat/performer-automation-service.js`
- Modify: `scripts/main.js`
- Test: `tests/performer-automation-service.test.mjs`
- Test: `tests/group-command-dispatch.test.mjs`

**Interfaces:**
- Produces: `PERFORMER_APPLY_RESULT_COMMAND = "performer.activePerformance.apply"`.
- Produces: `commitActivePerformance({ sourceActorId, sourceItemId, targetActorId, targetTokenUuid, total })`.

- [ ] **Step 1: Add a failing test where the player owns the source Actor but not the target and assert that no local `createEmbeddedDocuments` call occurs and one typed command is requested.**
- [ ] **Step 2: Add a failing active-GM command test that rejects a sender who does not own the source Actor.**
- [ ] **Step 3: Run both focused files and confirm failures are caused by missing command routing.**
- [ ] **Step 4: Export the command name, register strict validation/authorization in `main.js`, and make the GM derive formula and disposition rather than trusting client formula/mode.**

```js
this.socketCommandBus.register(PERFORMER_APPLY_RESULT_COMMAND, {
  validate: isValidPerformerResultPayload,
  authorize: (payload, { sender }) => actorIsOwnedByUser(resolveActor(payload.sourceActorId), sender),
  execute: (payload) => this.performerAutomationService.commitActivePerformance(payload)
});
```

- [ ] **Step 5: In `commitActivePerformance`, create/replace the target effect first; update `system.uses.spent` only after creation succeeds. Repeated delivery with the same request ID must return the first result.**
- [ ] **Step 6: Add migration coverage for an old managed `Исполнитель` Item whose identifier is blank but whose feat flag/name is canonical.**
- [ ] **Step 7: Run Performer, command-dispatch, attack-roll-boost, and full tests.**
- [ ] **Step 8: Commit `fix: route performer effects through active gm`.**

### Task 3: Execute EffectMacro combat compatibility once

**Files:**
- Modify: `scripts/integrations/effectmacro-compat.js`
- Test: `tests/effectmacro-compat.test.mjs`

**Interfaces:**
- Consumes: authenticated socket callback sender ID.
- Produces: request envelopes with stable `requestId` and exactly-once active-GM execution.

- [ ] **Step 1: Add a failing two-GM test: deliver the same request to two fixtures and assert the original hook runs once on the elected active GM.**
- [ ] **Step 2: Add a sender-mismatch test and verify both fail.**
- [ ] **Step 3: Import `isActiveGmClient`, include `requestId`, compare transport/envelope sender, and coalesce requests with a module-local `WorldMutationCoordinator`.**
- [ ] **Step 4: Run `node --test tests/effectmacro-compat.test.mjs tests/world-mutation-infrastructure.test.mjs`.**
- [ ] **Step 5: Commit `fix: serialize effectmacro combat relay`.**

### Task 4: Add a bounded durable mutation journal primitive

**Files:**
- Create: `scripts/application/durable-mutation-journal.js`
- Create: `tests/durable-mutation-journal.test.mjs`

**Interfaces:**
- Produces: `DurableMutationJournal({ readState, writeState, normalizeState, limit })`.
- Produces: `find(id)`, `start(record)`, `checkpoint(id, expectedPhase, nextPhase, patch)`, and `finish(id, result)`.

- [ ] **Step 1: Write failing tests for duplicate `start`, phase conflict, write failure with durable reread, and bounded retention.**
- [ ] **Step 2: Verify RED with `node --test tests/durable-mutation-journal.test.mjs`.**
- [ ] **Step 3: Implement serialization through `WorldMutationCoordinator`, clone all returned values, and retain every nonterminal row plus the latest 64 terminal rows.**
- [ ] **Step 4: Verify focused tests and commit `feat: add durable mutation journal`.**

### Task 5: Make crafting recoverable

**Files:**
- Modify: `scripts/data/crafting-service.js`
- Modify: `scripts/settings.js`
- Modify: `scripts/constants.js`
- Test: `tests/crafting-service.test.mjs`

**Interfaces:**
- Adds hidden world setting `craftMutationJournal`.
- Uses phases `prepared`, `materials-debited`, `task-persisted`, `output-created`, `committed`, `compensated`, `reconciliation-required`.

- [ ] **Step 1: Add failing injected-failure tests for queue state-write failure, cancel material-refund failure, and output-create failure.**
- [ ] **Step 2: Verify each test fails with the current lost-material/task behavior.**
- [ ] **Step 3: Wrap `queueTask`, `cancelTask`, and `processOneDay` in journaled workflows. Preserve a completed task until output creation is acknowledged; compensate material debit when task persistence fails.**
- [ ] **Step 4: Add retry tests proving the same mutation ID does not debit, refund, or create twice.**
- [ ] **Step 5: Run crafting, settings, inventory, and full tests.**
- [ ] **Step 6: Commit `fix: make crafting mutations recoverable`.**

### Task 6: Make inventory transfers and sales recoverable

**Files:**
- Modify: `scripts/data/inventory-service.js`
- Modify: `scripts/main.js`
- Modify: `scripts/settings.js`
- Modify: `scripts/constants.js`
- Test: `tests/inventory-app-context.test.mjs`
- Test: `tests/inventory-sync-hooks.test.mjs`
- Test: `tests/group-command-dispatch.test.mjs`
- Create: `tests/inventory-mutation-recovery.test.mjs`

**Interfaces:**
- Adds typed commands for take, sale, and import instead of new legacy request paths.
- Adds hidden world setting `inventoryMutationJournal`.

- [ ] **Step 1: Write failing tests for target-created/source-debit-failed, currency-credited/item-debit-failed, and imported-item-created/source-delete-failed.**
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Record before/after quantities and currency in durable descriptors, apply mutations in phases, and implement inverse compensation guarded by observed receipts.**
- [ ] **Step 4: Route player operations through strict typed commands authorized from the authenticated sender and source ownership/group membership.**
- [ ] **Step 5: Add retry and reconciliation-required tests, then run all inventory/group tests and the full suite.**
- [ ] **Step 6: Commit `fix: recover inventory mutations`.**

### Task 7: Make loot claims idempotent

**Files:**
- Create: `scripts/application/loot-claim-service.js`
- Modify: `scripts/main.js`
- Test: `tests/lootgen-chat.test.mjs`
- Create: `tests/loot-claim-service.test.mjs`

**Interfaces:**
- Produces: `claimRow({ messageId, lootId, rowId, claimId })` and `claimCoins({ messageId, lootId, claimId })`.
- Stores claim phase/result in the ChatMessage flag before granting value.

- [ ] **Step 1: Add failing tests for a ChatMessage update failure after inventory grant and repeated delivery of the same claim ID.**
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Persist `prepared`, grant the item/coins, persist `granted`, then finalize `committed`; on retry inspect both message state and target receipts before granting.**
- [ ] **Step 4: Keep existing public API methods as delegating compatibility methods.**
- [ ] **Step 5: Run lootgen, inventory, socket, and full tests; commit `fix: make loot claims idempotent`.**

### Task 8: Build the shared diff-based compendium lifecycle

**Files:**
- Create: `scripts/data/managed-compendium-sync.js`
- Modify: `scripts/data/compendium-utils.js`
- Create: `tests/managed-compendium-sync.test.mjs`

**Interfaces:**
- Produces `syncManagedDocuments({ pack, entries, documents, sourceIdOfEntry, sourceIdOfDocument, signatureOfEntry, signatureOfDocument, createData, updateData, prepareFolders })`.
- Returns `{ unchanged, created, updated, deleted }`.

- [ ] **Step 1: Add failing tests proving unchanged documents are untouched, changed documents update in place, new documents are created before obsolete managed documents are deleted, and unmanaged documents survive.**
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement deterministic maps and operation ordering `create -> update -> delete`; do not import feature datasets.**
- [ ] **Step 4: Add active-GM guard helper and duplicate-GM test.**
- [ ] **Step 5: Run focused tests and commit `feat: add managed compendium synchronizer`.**

### Task 9: Migrate managed compendium services incrementally

**Files:**
- Modify: `scripts/data/materials-compendium.js`
- Modify: `scripts/data/magic-items-compendium.js`
- Modify: `scripts/data/feats-compendium.js`
- Modify: `scripts/data/backgrounds-compendium.js`
- Modify: `scripts/data/states-compendium.js`
- Modify: `scripts/data/gear-compendium.js`
- Modify: `scripts/data/races-compendium.js`
- Modify: `scripts/data/classes-compendium.js`
- Modify: `scripts/data/actions-compendium.js`
- Modify: `scripts/data/downtime-compendium.js`
- Create: `tests/materials-compendium.test.mjs`
- Test: `tests/magic-items-compendium.test.mjs`
- Test: `tests/feats-compendium.test.mjs`
- Test: `tests/backgrounds-compendium.test.mjs`
- Test: `tests/states-compendium.test.mjs`
- Test: `tests/gear-compendium.test.mjs`
- Test: `tests/races-compendium.test.mjs`
- Test: `tests/classes-compendium.test.mjs`
- Create: `tests/actions-compendium.test.mjs`
- Test: `tests/downtime-compendium.test.mjs`

- [ ] **Step 1: For each service, add a focused assertion that a signature-only change uses update without pack-wide delete.**
- [ ] **Step 2: Migrate materials, magic items, feats, backgrounds, and states one at a time; run their focused tests after each file.**
- [ ] **Step 3: Migrate gear, races, classes/subclasses/features, actions, and downtime while preserving deterministic IDs/folders and public service methods.**
- [ ] **Step 4: Remove duplicated lifecycle helpers only after all consumers use the shared module.**
- [ ] **Step 5: Run all compendium tests and full suite; commit `refactor: centralize compendium synchronization`.**

### Task 10: Archive obsolete versioned entrypoints

**Files:**
- External archive: `D:\FoundryVTT\Backups\rebreya-main-entrypoints-2026-07-13`
- Delete: obsolete `scripts/main-1.4.*.js`
- Keep: `scripts/main.js`, `scripts/main-1.4.93.js`
- Test: `tests/module-manifest.test.mjs`

- [ ] **Step 1: Copy every obsolete versioned file with PowerShell `Copy-Item -LiteralPath`; never move before verification.**
- [ ] **Step 2: Generate `SHA256SUMS.txt` using `Get-FileHash -Algorithm SHA256`, compare source/archive hashes, and require zero mismatches.**
- [ ] **Step 3: Delete verified obsolete repository copies with `apply_patch`, preserving the active forwarder.**
- [ ] **Step 4: Run manifest, syntax, and missing-import scans; commit `chore: archive obsolete module entrypoints`.**

### Task 11: Remove the legacy trader application

**Files:**
- Modify: `scripts/main.js`
- Modify: `scripts/ui/city-app.js`
- Delete: `scripts/ui/trader-app.js`
- Delete: `templates/trader-app.hbs`
- Modify: `tests/trader-ui-transaction-lifecycle.test.mjs`
- Modify: `tests/trader-service.test.mjs`

- [ ] **Step 1: Add/adjust tests asserting `openTrader` and `openTraderSheet` instantiate Trader V2.**
- [ ] **Step 2: Verify RED while legacy routing remains.**
- [ ] **Step 3: Make `openTrader` delegate to the V2 implementation, remove the legacy app map/import/template references, then delete the legacy files.**
- [ ] **Step 4: Run trader UI/service/transaction tests and import scan; commit `refactor: remove legacy trader app`.**

### Task 12: Consolidate identical helpers without semantic drift

**Files:**
- Create: `scripts/shared/foundry-values.js`
- Modify: Performer, compendium, inventory, downtime, and trader files only where helper behavior exactly matches.
- Test: `tests/foundry-values.test.mjs` plus every touched domain test.

**Interfaces:**
- Produces `collectionValues(value)`, `cloneFoundryValue(value)`, `escapeFoundryHtml(value)`, `cleanText(value, fallback)`, and `finiteNumber(value, fallback)`.

- [ ] **Step 1: Write tests importing the not-yet-created module for arrays, Foundry collections, Sets, plain objects, clone fallback, HTML escaping, blank fallback, and non-finite numbers.**
- [ ] **Step 2: Run `node --test tests/foundry-values.test.mjs` and verify RED because `scripts/shared/foundry-values.js` does not exist.**
- [ ] **Step 3: Implement the five exported helpers with the characterized semantics, rerun the focused test, then migrate one domain at a time and delete only byte/behavior-equivalent local helpers.**
- [ ] **Step 4: Run focused tests after every domain migration and revert any migration whose fallback semantics differ.**
- [ ] **Step 5: Run full suite and commit `refactor: centralize stable foundry helpers`.**

### Task 13: Remove verified dead functions

**Files:**
- Modify: `scripts/combat/race-automation-service.js`
- Modify: `scripts/combat/status-service.js`
- Modify: `scripts/data/classes-compendium.js`
- Modify: `scripts/data/quest-log-service.js`
- Modify: `scripts/engine/trader-engine.js`
- Modify: `scripts/ui/inventory-app.js`

- [ ] **Step 1: Re-run repository call-site searches for each candidate and require declaration-only results.**
- [ ] **Step 2: Delete `normalizeText`, `normalizeLookupText`, `getExplicitEffectStatuses`, old `buildMetamagicChoiceAdvancements`, `getQuestFromEntry`, `getMagicBasePriceGold`, and `getTargetOptionForSourceType` only when still unused.**
- [ ] **Step 3: Run owning focused tests, full suite, syntax and import scans; commit `refactor: remove dead runtime helpers`.**

### Task 14: Rewrite README as the authoritative module contract

**Files:**
- Modify: `README.md`
- Test: `tests/module-manifest.test.mjs`

- [ ] **Step 1: Rebuild README sections for entrypoint, initialization, architecture, dependency direction, persistence/settings, typed sockets, active-GM rules, compendium sync, public API, data files, and verification commands.**
- [ ] **Step 2: Add the automation catalog with source service, hook/activity, identifiers/flags, permissions/routing, mutations/effects, cleanup/rest behavior, and focused tests for every registered automation in `scripts/combat/hooks.js`, `scripts/hooks.js`, and `scripts/integrations`.**
- [ ] **Step 3: Add anti-duplication rules and a contributor checklist requiring README/catalog updates with automation changes.**
- [ ] **Step 4: Cross-check documented API methods against `RebreyaMainModule`, settings against `registerSettings`, entrypoint against `module.json`, and automation hooks with `rg`.**
- [ ] **Step 5: Run manifest/full tests and commit `docs: refresh module architecture and automation catalog`.**

### Task 15: Final verification and delivery

**Files:** All changed files.

- [ ] **Step 1: Run `node --test tests/*.test.mjs` and require zero failures.**
- [ ] **Step 2: Run `node --check` for every tracked JS/MJS file, parse every tracked JSON file, scan relative imports, and run `git diff --check`.**
- [ ] **Step 3: Inspect `git status`, `git diff origin/lich_branch...HEAD`, and commit history for accidental/unrelated changes.**
- [ ] **Step 4: Run `git fetch origin --prune`; stop if `origin/main` advanced with conflicts or `origin/lich_branch` contains foreign commits.**
- [ ] **Step 5: Create any final integration commit, push `lich_branch` with ordinary `git push origin lich_branch`, and never force push.**
