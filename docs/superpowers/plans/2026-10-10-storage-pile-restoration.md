# Storage Pile Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Restore weapon/armor pile art and transfer ground currency without creating container Items or losing balances.

**Architecture:** Keep presentation in the existing pile resolver and currency mutations in StorageService / StorageCommandService. Extend the internal deposit-source result for coin-only ground tokens while preserving typed wire commands. Repair provably synthetic coin wrappers through existing storage repair/open owners.

**Tech Stack:** Foundry VTT 13, dnd5e, JavaScript ESM, Node test runner, PowerShell.

**Spec:** `docs/superpowers/specs/2026-10-10-storage-pile-restoration-design.md` (approved 2026-10-10).

## Global Constraints

- Work only in `lich_branch`; stop on unrelated edits or remote divergence. No force push.
- Preserve settings, flag schemas, public API/typed payload signatures, authorization, quantity limits, authored formulas, loot budget spending, stacking and durable transfer receipts.
- Pure coin pile remains `0.5 × 0.5`; preserve centers, ownership, footprints and rotations.
- Single ordinary Item remains single art. Quantity 2+ weapon/armor becomes its category; ammo/material stack art remains unchanged.
- One denomination uses exact sprites 1–50 and pile at 51+; multiple denominations use «Куча монет» / `assets/storage/piles/coins.png`.
- Runtime changes require module version bump and synchronized forwarder/cache URLs. Update function passports in the same runtime commit.
- Commit each runtime deliverable only with its version bump and required complete runtime checks; batch tasks into one release commit to avoid redundant full-suite runs.

## Review Focus

- Synthetic currency wrapper versus real/custom purse: require positive pile provenance; missing metadata or a coin-like name alone never authorizes flattening (Task 3).
- Partial balance plus claimed balances: 50 of pp100 leaves pp50; claimed generated/manual balances never return (Tasks 1–3).
- Crash/retry after wallet credit: preserve existing idempotent grant IDs and reservations; restored source must never enable duplicate credit (Task 2).
- Null internal Item row: inspect/UI, deposit and token-to-character paths handle a currency source without materializing an Item (Tasks 1–2).
- Unknown mixed Item categories: one recognized weapon plus unknown equipment yields generic mixed art; classification must not discard unknown rows (Task 4).

### Task 1: Resolve ground-token currency as balances

**Files:** Modify `scripts/data/storage-deposit-source.js`, `scripts/main.js` (only deposit-source inspection); test `tests/storage-deposit-source.test.mjs`, `tests/storage-module-api.test.mjs`.

**Interfaces:** Keep `resolveStorageDepositSource(sourceRef, dependencies)` and wire `kind:"storage-token"`. For an opened, marked coin-only pile, return internal `{kind:"storage-token",mode:"move",row:null,coins,denomination,available,name,img,storageToken,sourceKey,canUserMove,consume,restore}`. Single denomination: `available` is its balance, `denomination` its key. Mixed: `available:1`, `denomination:null`, quantity 1 means the entire map. No ordinary or Journal rows; no physical container host. Empty/claimed currency is unavailable. Ordinary Item/container/Journal source contracts remain unchanged.

- [x] Add failing tests `pure coin token resolves currency rather than a container` and `mixed coin token resolves a whole currency map`: assert `row===null`, pp100 available100, mixed pp100/gp1000 available1, exact maps and presentation names/images.
- [x] Add tests `currency source consumes and restores partial balance` (consume50 leaves pp50; restore returns pp100) and `currency source preserves claimed and pending transfer guards`; real chest holding pp100 must still resolve a container. Test empty pile rejection and source permission preservation.
- [x] Run `node --test tests/storage-deposit-source.test.mjs tests/storage-module-api.test.mjs`; confirm new assertions fail for the current container result.
- [x] Extend private `resolveStorageTokenSource(sourceRef,{resolveToken,storageService,createRowId})` with the currency result before `buildStorageContainerRow()`. Use `StorageService.claim()` and existing source receipts; partial currency leaves token intact, complete currency clears its live balance, and rollback restores exact prior state. Keep canonical `assertStorageCoinTransferAvailable()` guard. In `inspectStorageDepositSource()` use source-level `name/img` for currency without changing returned shape.
- [x] Run the same tests and existing token-drop/transfer-drop tests; require zero failures before Task 2.

### Task 2: Transfer currency through existing authoritative commands

**Files:** Modify `scripts/data/storage-service.js`, `scripts/data/storage-command-service.js`; test `tests/storage-service.test.mjs`, `tests/storage-socket.test.mjs`, `tests/storage-transfer-drop.test.mjs`.

**Interfaces:** Consume Task 1 source. Add internal service method `StorageService.depositCoins(token,coins,{path=[],presentation="gameplay"}={}) -> {changed,coins,state}`: all denomination values safe nonnegative integers, checked additions, existing gameplay/administrative opening rules, claimed balances discarded before new credit, no Item rows. No new socket command or client-supplied currency map.

- [x] Add failing tests `coin token deposit adds balances without an Item row`, `partial coin token deposit preserves remainder`, `mixed coin token deposit preserves denominations`, and `coin token character transfer credits wallet without materializing a container`. Assert target pp100/gp1000, no new Item, no source duplication and correct center/art refresh.
- [x] Pin failure cases: target write rejection; source debit rejection after target write; repeated stable mutation ID; concurrent different-ID claims against the same source; permission/distance denial; safe-integer overflow; deposit into unopened target in both presentation modes. Compare complete before/after currency maps, not just result flags.
- [x] Run affected tests and verify new currency paths fail before implementation.
- [x] Implement `depositCoins()` through existing scoped service write owner. In `StorageCommandService.deposit(payload,{sender})`, branch on authoritative `source.coins` before row requirement, preserving source/target queues, target-first rollback and source refresh. Re-resolve live source inside queued operation and reject overdraw; currency maps never come from client input.
- [x] In `moveStorageTokenToCharacter(payload,{sender})`, currency source uses `inventoryService.addCurrencyToCharacterOnce(coins,actor,grantId)`, existing coin reservation / credit-before-debit recovery pattern and source refresh. Never pass it to `materializeToActorOnce()` or `addLootgenRowToCharacterOnce()`. Party/scene denomination row transfers retain existing `claimRow()` grant/debit paths; mixed whole maps use existing authoritative owners without adding a client payload.
- [x] Run focused service/socket/deposit-source/transfer-drop tests and confirm all rollback, retry and concurrent balance assertions.

### Task 3: Repair existing synthetic coin wrappers safely

**Files:** Modify `scripts/data/storage-service.js`, `scripts/data/storage-ground-pile-service.js`; test `tests/storage-service.test.mjs`, `tests/storage-ground-pile-service.test.mjs`, `tests/storage-container-snapshot.test.mjs`.

**Interfaces:** Export pure `migrateSyntheticCoinPileRowsInState(state) -> null|{state,convertedRows}` beside existing coin migration. Eligible unclaimed wrapper has `sourceType:"container"`, snapshot `storageKind:"pile"`, opened state, no physical `presentation.itemIdentity/itemData/itemSystem`, no composition, no nested ordinary/Journal/container rows, and captured `presentation.tokenData.texture.src` matching a module-owned coin sprite/pile asset. Reject custom/unrecognized provenance. Preserve state fields and pass changed state through existing authoritative write/refresh owners.

- [x] Add failing fixture `synthetic pp100 wrapper with root gp1000 unwraps exactly once`: assert pp100/gp1000, removed wrapper, second migration null. Claimed wrapper never credits currency; nested `coinsClaimed:true` never credits stale balances. Repair must retain root claimed-balance semantics.
- [x] Add preservation tests for genuine purse/chest, a pile with physical host metadata, custom coin-looking texture/name, unopened wrapper, ordinary or Journal children, active triggers/reservations/composition. These stay untouched. Overflow must reject without writing any part of the state. Pending mutation or meaningful trigger state makes a wrapper ineligible.
- [x] Run tests and confirm the synthetic fixture fails before implementation.
- [x] Implement pure migration using existing checked denomination addition. Remove only eligible wrappers; never compute currency from wrapper quantity or price. Incorporate migration into `StorageService.#openOnce()` and `StorageGroundPileService.repairLegacyCoinRows()` alongside existing coin migration; keep repair idempotent and per-scene serialization. Refresh art after authoritative state write.
- [x] Run migration/source/ground-pile tests; verify existing physical-container lifecycle tests remain green. If real stored wrapper lacks required provenance, report it as unmodified; do not loosen the proof to names or absent metadata alone.

### Task 4: Restore category art, align currency UI, release

**Files:** Modify `scripts/data/storage-pile-presentation.js`, `scripts/ui/storage-app.js`, necessary cache-query importers, `README.md`, `docs/function-passport.md` and linked domain passport if touched, `module.json`; create next `scripts/main-<version>.js` forwarder. Test `tests/storage-pile-presentation.test.mjs`, `tests/storage-app.test.mjs`, `tests/storage-ground-pile-service.test.mjs`, `tests/module-manifest.test.mjs`, registration/composition tests affected by version assertions.

**Interfaces:** Preserve `deriveGroundPilePresentation(rows,{coins,preserveEmptyCoinPile,readJournalRowIds})`. Add pure `deriveStorageCoinImage(coins={}) -> string` in this same owner for quantity-aware UI/pile art. Internal category helper resolves row label / canonical managed `equipmentType`, then native weapon or confirmed armor subtype; does not infer arbitrary equipment as armor. Category selection requires every ordinary row to resolve consistently.

- [x] Add failing tests: one sword remains single; sword quantity2 and armor quantity2 become category; two native/managed weapons or armors select category; mixed/unknown row selects generic. Pin single ammo20/material stack, container footprint, Journal priority, broken durability name and one armor texture scale.
- [x] Add failing currency/UI tests: pp100 uses pp-pile; pp50 exact sprite; pp51 pile; pp100/gp1000 uses generic coin pile; removing last gp changes back to pp pile. Existing UI row IDs, counts, click/claim behavior stay unchanged.
- [x] Run focused presentation/app/ground-pile tests and observe failures before code changes.
- [x] Implement helpers and quantity checks only for weapon/armor category stacks. Have UI denomination rows use the shared coin image helper rather than forced gear art. Reuse existing startup repair to refresh stale module-owned weapon/armor presentation as well as currency; compare derived presentation to module-owned old textures, preserve custom textures, avoid no-op writes and extra asset scans.
- [x] Update README/paspоrts with changed source result, service method, repair eligibility, data flow and focused tests. Increment the current manifest version (read it again at execution time), create forwarder importing only `./main.js`, synchronize `esmodules`, canonical import cache URLs and manifest tests.
- [x] Run full required validation once before the runtime commit: `node --test tests/*.test.mjs`; `git diff --check`; `node --check` for every tracked JS/MJS plus new forwarder; parse every tracked JSON with `ConvertFrom-Json`. Report passed/failed counts and actual failures only.
- [ ] When bridge is reachable, test authenticated GM/player: drop100pp, partial transfer50, combine with gp1000, claim/remove gp, move currency to character/group/storage, reject unauthorized source, reload and verify no double credit. Capture relevant UI and inspect console; record exact Foundry/dnd5e versions. If unavailable, explicitly record live verification as unperformed.
- [x] Perform final independent review, confirm spec coverage and required test assertions, inspect meaningful diff/stat/check, stage only task files, commit `fix: preserve currency piles and restore category presentation`, then `git push -u origin lich_branch`. Report commit, version, verification and spec/plan paths.

## Self-review and execution handoff

Each spec requirement maps to Tasks 1–4; all five review-focus conditions have explicit tests. No public wire/source command change is planned. Migration requires positive provenance, leaves genuine containers intact, and preserves gp1000 alongside pp100. Execution recommended here with `executing-plans`: the tasks share source/receipt interfaces, so one implementer can keep those contracts consistent; use Gemini for bounded test/diff reviews and verify important claims locally. Alternative: subagent-driven task implementation with independent per-task reviews, at greater context cost. Implementation starts only after user plan review and execution-method selection.


## Execution result — 2026-10-10

Implemented release 1.4.370 on lich_branch. All Tasks 1–4 are complete; live QA remains unavailable because the installed bridge reports Foundry VTT module not connected. No live world mutation or visual confirmation is claimed.

Regression evidence: failing tests were observed before each implementation; review added source-only crash recovery, interrupted gp wallet debit and combined manual/generated overflow coverage. Final focused recovery/service tests: 193 passed; cache/manifest/composition tests: 60 passed. Final full command `node --test tests/*.test.mjs`: 4488 tests, 4487 passed, 0 failed, 1 skipped. Full syntax validation: 940 JS/MJS files passed; after review fixes, all 26 affected JS/MJS files passed again. All 55 tracked JSON files parsed with ConvertFrom-Json. `git diff --check` passed.

Independent final review found no remaining Critical/Important/Minor issues after fixes and independently verified the three new regressions. Gemini supplied bounded analysis of currency-source consumers and migration provenance; Codex verified and applied the implementation. Currency-source-only reservation recovery and pending denomination priority reuse existing receipts and queues; no wire schema, formula, quantity budget or loot spending rule was removed. Current checkout was reused as required by the explicit lich_branch workflow; no worktree was created.
