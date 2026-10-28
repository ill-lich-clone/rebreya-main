# Inventory quantity event repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore quantity saving after DOM click dispatch ends.

**Architecture:** Capture primitive button data before the existing asynchronous dialog in InventoryApp. Keep InventoryService and native routing unchanged.

**Tech Stack:** JavaScript ESM, Foundry 13, Node test runner.

**Spec:** docs/superpowers/specs/2026-10-29-inventory-quantity-event-design.md

## Global Constraints

- Continue the already approved quantity repair inline on clean lich_branch.
- Preserve 2/12 precision, relative input, zero removal, cancel, group scope, permissions and native API.
- No new sockets, journals, locks or dependencies.

## Review Focus

DOM currentTarget resets before dialog completion; ordinary and tiny material precision differ; displayed group must remain captured; zero must reach deletion; cancellation must write nothing. The new regression and existing scope test cover these cases.

### Task 1: Repair the event lifetime and release

**Files:** scripts/ui/inventory-app.js; tests/inventory-app-context.test.mjs; scripts/main.js (cache URL); module.json; new scripts/main-1.5.20.js; README.md; docs/function-passport.md; cache assertions referencing InventoryApp.

**Interfaces:** Existing edit-item-quantity listener calls updateInventoryItemQuantity(itemId, quantity, {groupActorId, expectedSourceQuantity}); unchanged.

- [x] Add a regression using EventTarget/Event and a deferred dialog. Assert absolute 7, relative -2 from 10 gives 8, zero, material +1e-12 and cancel; API calls retain group/expected quantity.
- [x] Run focused regression and observe null.dataset failure before edits.
- [x] Capture sourceType before await and reuse it twice; rerun inventory-app-context and native-owner/folder-socket suites.
- [x] Update passport and release to 1.5.20, preserving previous forwarders and unrelated cache keys.
- [x] Run node --test tests/*.test.mjs, all tracked JS/MJS syntax and JSON parsing, git diff --check. Attempt live check only through existing authenticated tooling.
- [x] Obtain one independent final review, address important findings with RED/GREEN tests, inspect/stage task diff explicitly, commit and push origin lich_branch. Report verification and live limits.

## Plan review

One task; no shared interfaces or unresolved design choices. Scope is the approved quantity-edit repair, now supported by the user's exact production exception.

## Execution record

Native EventTarget regression reproduced the exact null.dataset production exception before the fix; focused 201/201 passed afterward. Independent final review found no Critical, Important or Minor issues. Full repeat: 5229 tests, 5228 passed, 0 failed, 1 skipped. The first full run had one timing-sensitive failure in `multi-document inventory hooks wait for the mutation boundary and render once`; its isolated 28-test suite and full repeat passed without code changes. Syntax: 1102 JS/MJS passed. JSON: 65 passed. git diff --check passed. Browser about:blank and existing Foundry bridge disconnected, so live persistence remains a manual acceptance check. Unrelated behavior was preserved. Delivery is the authorized commit/push to lich_branch.
