# Inventory actions and windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Restore quantity editing, add a second full inventory, and select stack quantities consistently on drag/drop.

**Architecture:** Extend InventoryService and the existing typed-command composition, reuse InventoryApp and its view registry/refresh lifecycle. Reuse the quantity selection already available in storage-transfer-ui; folder choice remains a presentation wrapper. Handle managed party drops before native sheet creation when a quantity decision is necessary; keep native confirmation/recovery hooks for their existing inputs.

**Tech Stack:** Foundry VTT 13, JavaScript ESM, ApplicationV2/Handlebars, Node test runner, existing dnd5e adapter.

**Spec:** `docs/superpowers/specs/2026-10-26-inventory-actions-and-windows-design.md`

## Global Constraints

- Work only on `lich_branch`; no force push. The sale socket mismatch after User merging is explicitly deferred.
- Preserve settings, flags, formulas, budgets, material precision (12 decimals), ordinary quantity editing (2 decimals), relative input, and zero removal.
- Preserve authorization, authenticated sender binding, exact source/target identity, active-GM authority, idempotency, compensation, and legacy recovery.
- Existing stacks transfer with quantity selection; singleton moves immediately. Cancel/Escape/close has no mutation. External catalog issuance retains copy semantics.
- Reuse canonical owners and one ESM URL per stateful owner. No new dependencies, independent transfer executor, or replacement inventory.
- Bump manifest/forwarder/cache URLs together. Record all changed methods in function passports and public additions in README.

## Review Focus

- Group changes while a quantity dialog is open must never redirect a write to another group's item.
- Double handling of the same native sheet drop must never issue a second target or debit.
- Partial character-to-party import with a write-then-throw must not lose stock or roll back a target after a confirmed source debit.
- Tiny material quantities and composed singleton Items must preserve their existing accounting/graph contracts.
- A second full window must retain all controls, refresh with the main window, and close independently without folder-root lifecycle interference.

---

### Task 1: Authoritative quantity editing

**Files:** Modify `scripts/data/inventory-service.js`, `scripts/main.js`, `scripts/ui/inventory-app.js`; extend `tests/inventory-folder-socket.test.mjs`, `tests/group-inventory-migration.test.mjs`, `tests/inventory-app-context.test.mjs` and `tests/main-composition-root.test.mjs`.

**Interfaces:** `updateInventoryItemQuantity(itemId,nextQuantity,{groupActorId=""}={})` and `InventoryService.updateItemQuantity(itemId,nextQuantity,{groupActorId=""}={})` preserve two-argument calls. New `INVENTORY_ITEM_QUANTITY_COMMAND = "inventory.item.quantity.update"` accepts exactly `{groupActorId,itemId,nextQuantity,expectedSourceQuantity}`. The GM executor resolves the exact registered group and live Item inside its group queue, rejects stale quantities/invalid numbers, then uses existing material/ordinary quantity helpers. Authorization is the existing GM/group-manager policy; no new rights.

- [x] Write failing behavioral tests: authorized member with no Group Actor ownership routes one command; unrelated group/unknown sender/nonfinite or negative input rejected; owner/GM compatibility; relative and absolute edits, zero removal, material `0.000793650794 + 1e-12`, cancel, and group switch during dialog.
- [x] Run `node --test tests/inventory-folder-socket.test.mjs tests/group-inventory-migration.test.mjs tests/inventory-app-context.test.mjs tests/main-composition-root.test.mjs`; confirm failures specifically enforce the missing route and scope.
- [x] Register the validated keyed mutation, add the authoritative executor, and capture the displayed group/current quantity before opening the edit dialog. Keep parsing and rounding in their existing owners.
- [x] Run the same focused tests; expect zero failures. Update passport entries with command/API/data flow and profile tests.

### Task 2: Second full inventory window

**Files:** Modify `scripts/main.js`, `scripts/ui/inventory-app.js`, `templates/inventory-app.hbs`; extend `tests/inventory-app-context.test.mjs`, `tests/main-composition-root.test.mjs`, `tests/ui-refresh-coordinator.test.mjs`.

**Interfaces:** `openInventoryApp({tab?,newWindow?:boolean}={}) -> Promise<InventoryApp>`. Existing call opens the main singleton. `newWindow:true` reuses one secondary full InventoryApp registered under `full:secondary` in the existing view map, with `rootFolderId:null`; it follows the same active group as the main full window. Folder popouts keep their explicit group/root. Existing unregister and refresh methods handle the secondary by identity. Top button `data-action="open-second-inventory"` dispatches `openInventoryApp({newWindow:true})`.

- [x] Write failing tests: button dispatch, unique IDs, repeated open reuses secondary, independent local search/type/sort, main and secondary display full tree, close removes only secondary, root-folder deletion affects only folder windows, and one scoped refresh reaches both full views.
- [x] Run `node --test tests/inventory-app-context.test.mjs tests/main-composition-root.test.mjs tests/ui-refresh-coordinator.test.mjs`; expect missing secondary behavior to fail.
- [x] Extend existing launch/registry lifecycle and add an accessible top icon button using existing button styles. No separate app class, state store, or extra refresh hook.
- [x] Run the same tests; expect zero failures. Update README API documentation and function passport.

### Task 3: One quantity decision for existing-stack transfers

**Files:** Modify `scripts/ui/inventory-app.js`, `scripts/ui/storage-transfer-ui.js` if required, `scripts/integrations/inventory-sync.js`, `scripts/data/inventory-service.js`, `scripts/main.js`; extend `tests/inventory-app-context.test.mjs`, `tests/inventory-sync-hooks.test.mjs`, `tests/inventory-folder-quantity-transfer.test.mjs`, `tests/inventory-simple-transfer.test.mjs`, `tests/runtime-graph-inventory.test.mjs`, `tests/inventory-folder-socket.test.mjs`, and `tests/inventory-transfer-imports.test.mjs`.

**Interfaces:** Reuse `promptStorageTransferQuantity(maxQuantity,{material,...}={}) -> Promise<number|null>` for quantity-only decisions. `promptInventoryPartialTransfer(...)` keeps its public result and optional destination picker. Ordinary internal Item drops call the existing partial-transfer worker without Shift for stacks; same-folder drop remains a no-op, folder drags remain whole moves. Extend `takeInventoryItemToCharacter` options compatibly with `groupActorId` so intercepted managed native drops cannot use another active group.

Character-to-party import adds optional `{quantity,expectedSourceQuantity}` to `importInventoryDrop`, `importDroppedItem` and the existing import command. Existing payloads remain valid. Fresh source ItemData is projected with `withInventoryItemQuantity`; graph singleton behavior and legacy records retain their old path. The authoritative import validates selected quantity against fresh stock and the captured expectation; source debit subtracts the selected amount (deletes only at zero), verifies observed state after exceptions, and retains existing ingress planner/rules and compensation. Persisted operation fingerprints include quantity intent so retries cannot reinterpret the transfer.

- [x] Write failing tests for ordinary internal drop selecting part/all/cancel, singleton without dialog, same-folder no-op, menus using the same decision, root/folder/pinned/secondary destinations, stale quantity and missing target, and fractional materials.
- [x] Write failing tests that invoke the real registered sheet-drop hook: only managed party Item data is consumed; return `false` synchronously before native creation; asynchronously prompt once and call existing take API once with exact group/character/quantity. Unrelated native drops and existing confirmation hooks remain intact; duplicate intent does not execute twice.
- [x] Write failing import tests for partial character stack, full deletion, cancel, player authorization, source drift, changed destination, material unit accounting, source update/delete write-then-throw, safe compensation and preserved composed singleton graphs. Catalog copies remain unchanged.
- [x] Run `node --test tests/inventory-app-context.test.mjs tests/inventory-sync-hooks.test.mjs tests/inventory-folder-quantity-transfer.test.mjs tests/inventory-simple-transfer.test.mjs tests/runtime-graph-inventory.test.mjs tests/inventory-folder-socket.test.mjs tests/inventory-transfer-imports.test.mjs`; confirm the new cases fail for the intended reasons.
- [x] Implement the shared decisions and exact-scoped routes at the owners above, keeping one operation ID per confirmed intent, target-before-debit and ambiguous retry protection. Never remove source-confirmation hooks to reduce handler count.
- [x] Run the same focused command; expect zero failures. Update `docs/function-passport.md`, `docs/item-instance-passport.md`, and README with ordinary-drop quantity behavior and API additions.

### Delivery and verification

- [x] Set `module.json` to `1.5.10`, rename the forwarding entry to `scripts/main-1.5.10.js`, and update all importers of changed stateful owners to the same `?v=1.5.10`; retain unrelated cache keys. Update release/cache regression assertions without removing their behavioral coverage.
- [x] Attempt live checks only in an authenticated test world with disposable fixtures; record exact versions/roles. Current browser is `/join` and the MCP bridge is disconnected; do not claim live coverage if still unavailable.
- [x] Run `node --test tests/*.test.mjs` once after final changes, all tracked JS/MJS through `node --check`, all tracked JSON through `ConvertFrom-Json`, and `git diff --check`; expect zero failures.
- [x] Obtain the mandatory independent final code review, address important findings with failing regression tests first, rerun affected checks and full suite after fixes.
- [x] Review `git diff --stat` and substantive diff, stage only task files, commit the complete compatible release and `git push -u origin lich_branch`. Report spec/plan paths, commit, test counts, deferred sale error, and live-verification limits.

## Execution

Recommended: native execution in this chat with one independent final code review. The tasks share InventoryApp, InventoryService and their fixtures; per-task implementer delegation would repeat substantial shared context. Preserve this approved task scope and continue after plan approval without further routine confirmation.

## Execution record (2026-10-26)

User approved native execution in this chat. Implemented tasks 1–3 in the existing lich_branch checkout. Sale socket identity mismatch remains deferred per the user's explicit clarification.

The independent final review found two Important issues: depleted-stock validation preceding terminal import replay, and rejection of ordinary fractional stock. Both were reproduced with failing regressions and fixed in one pass. Additional coverage confirms interruption after legacy source debit, exact source-owner authorization after full depletion, continuation of old graph records, and identity drift across a journal await. Integer ordinary stock keeps step 1, existing fractional ordinary stock uses 0.01, materials retain 12 decimals; complex-instance restrictions and authored formulas remain.

Verification: node --test tests/*.test.mjs — 5084 tests: 5083 passed, 0 failed, 1 skipped. All tracked JS/MJS plus the new forwarder passed node --check (1075 files initially, then 18 affected files after final fixes). All tracked JSON parsed with ConvertFrom-Json (65 files). git diff --check passed. Focused and RED/GREEN logs were kept in this plan's ignored workspace during execution.

Retained main-1.5.9.js and added main-1.5.10.js instead of renaming the published URL, preserving README compatibility. Changed stateful inventory owners share v=1.5.10; updated stateless helpers have current imports in their changed callers.

Review boundaries: only this task's diff against ed50a851 was reviewed; unrelated branch work was excluded. Synthetic Actor sheet drops retain native behavior. No authenticated live test world or connected MCP bridge was available; the installed Foundry sources identify 13.351, but no live Foundry/dnd5e/GM/player or visual compatibility claim is made.