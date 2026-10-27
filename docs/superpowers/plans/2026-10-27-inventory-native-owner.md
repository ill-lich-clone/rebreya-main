# Inventory native owner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Execute inline in the current chat, with one final independent review.

**Goal:** Give registered group participants warehouse ownership and make routine inventory actions native with zero custom GM requests, world-journal accesses and blocking queues.

**Architecture:** Extend GroupContextService and InventoryService; reuse current domain calculations, ingress planner, native Document helpers and ItemInstanceDocuments. Keep real privileged/external adapters and old recovery entry points.

**Tech Stack:** Foundry 13, dnd5e, JavaScript ESM, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-27-inventory-native-owner-design.md`

## Global Constraints

Only lich_branch; no force push; no new dependencies or world settings. Preserve authored formulas, quantities, currency/sale/ingress rules and budgets. Native concurrency is deliberate; do not introduce distributed locks or durable storage into the new route. Preserve existing public APIs and explicit privileged/recovery callers.

## Review Focus

- Ownership reconciliation must preserve manual owners and restore only module-issued grants.
- Zero-GM tests must execute actual production routes, not an alternate mock implementation or disabled guard.
- Direct actor-to-actor movement must still apply the requested quantity and ingress rules and preserve material units/history.
- Existing graph/complex-state restrictions and old pending privileged operations must remain available.
- Capabilities must be checked for the exact captured group and every mutated Actor; native failures must not report success.

### Task 1: Group warehouse OWNER synchronization

**Files:** GroupContextService, group-registry-lifecycle, main startup; focused group-context-service and group-registry-lifecycle tests.

**Interfaces:** `syncInventoryOwnership(groupActorId?,{guard?}={})` derives non-GM Users owning character members, updates Group Actor ownership plus a namespaced grant-provenance flag in one native Actor update, and returns compact changed group IDs. No-op does not write. Registration and active-GM startup call it; lifecycle schedules only membership/ownership/User changes, not every document update.

- [x] Write failing tests for grants/revocation/manual owners/no-op/active-GM lifecycle and run them.
- [x] Implement synchronization in existing owner and narrowly scoped lifecycle wiring.
- [x] Run focused group suites; expect zero failures, and update passport.

### Task 2: Native inventory operations

**Files:** InventoryService, main route selection, ItemInstanceWorkflow (direct native runner), existing native Document helpers only if necessary; new focused native inventory tests plus existing inventory suites.

**Interfaces:** `canUseNativeInventory(actor)` uses Actor.canUserModify for the current User. The native route is selected before socket/journal/queue work. `ItemInstanceWorkflow.runNative(intent,context)` reads/validates source, calls the existing Document driver directly and compensates only its touched changes, without its journal or coordinator. InventoryService's existing methods keep signatures/results.

- [x] Write production-service regressions with no active GM, owned Group/Character Documents, and throwing socket/journal/coordinator methods. Cover quantity/delete/currency/folders/rules and same-group splits first; verify RED.
- [x] Add native dispatch and native instance entry point; preserve old route when capabilities are absent. Run affected tests to GREEN.
- [x] Write failing owner take/import/sale/catalog ingress tests: whole/partial/fractional/material, actual currency quote, acquisition history, skip/folder/dismantle rules and failure propagation.
- [x] Implement direct operations using existing receipts/builders/planner, with only local Promise sharing for identical intent and bounded in-memory completion reuse. Preserve external/complex fallback and existing durable entry points. Run focused suites to GREEN.
- [x] Update passports and README with exact owner/fallback matrix and deliberate concurrency policy.

### Task 3: Verification and delivery

- [x] Bump manifest to 1.5.17, add minimal matching forwarder, update changed owner cache imports without removing old published URLs; update cache regression expectations.
- [x] Attempt authenticated live test-world checks if available; otherwise record the limitation.
- [x] Run `node --test tests/*.test.mjs`, tracked `node --check`, JSON `ConvertFrom-Json`, `git diff --check`; report actual counts/errors.
- [x] Independent final review of this task's diff; fix Important/Critical findings with RED→GREEN tests, rerun affected/full checks after fixes.
- [x] Review substantive diff/stat, stage only task files, commit and push `origin lich_branch`; verify clean/synchronized state and record spec/plan/commit/checks.

## Authorization and execution

The user chose this approach and explicitly directed delivery through tests/version/commit/push. Native inline execution is the existing selected method. Do not stop after this plan or ask again about already-authorized implementation. Record any material scope ruling and verification results below.

## Execution results

Implemented inline; independent review complete, no remaining Critical/Important findings. Manual dismantle/folder batch included in ordinary native scope, preserving existing routing and physical-weight results. Full `node --test tests/*.test.mjs`: 5197 tests, 5196 passed, 0 failed, 1 skipped. `node --check`: 1099 JS/MJS passed; four affected files rechecked after review fixes. JSON `ConvertFrom-Json`: 65 passed. `git diff --check`: passed. Live verification unavailable: no authenticated Foundry test-world browser session. Version 1.5.17; final commit/push recorded in the task report.
