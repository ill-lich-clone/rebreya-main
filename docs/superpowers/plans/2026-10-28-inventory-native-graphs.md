# Native Inventory Graphs Implementation Plan

> Execute inline with superpowers:executing-plans; one independent review at the end.

**Goal:** Move complete owned inventory trees without custom GM sockets, world journals or queues.
**Architecture:** Extend existing graph helpers and InventoryService native take/import; keep legacy recovery and public interfaces.
**Tech Stack:** Foundry13/dnd5e JavaScript ESM, Node tests.
**Spec:** docs/superpowers/specs/2026-10-28-inventory-native-graphs-design.md

## Global constraints

Only lich_branch; preserve native-concurrency decision, formulas/budgets/quantities/ingress rules, schema and external adapters. No new dependency, world setting, distributed lock or durable native journal. Target version1.5.18.

## Review focus

- Complete nested links and currency survive both directions; installed children cannot be detached independently.
- Target creation cancellation or partial creation leaves source intact and no stray target children.
- Source delete cancellation cleans only unchanged newly created target; partial delete preserves complete target and reports failure.
- Imported graphs retain trusted-source validation, skip/folder/history and dismantle rejection.
- Exact Actors/capabilities and identical local intent are honored; privileged old recovery still works.

### Task 1 — Native graph helper and service integration

Files: scripts/application/inventory-graph-transfer.js, scripts/data/runtime-item-graph.js, scripts/data/inventory-service.js; tests/inventory-native-owner.test.mjs, existing runtime graph tests.
Interfaces: reuse existing graph capture/build/materializer; native graph take in existing application helper; native source batch deletion and own target rollback in runtime graph helper. InventoryService public signatures/results unchanged.

- [x] Add failing production-service tests for native tree take/import and invariants above; run and observe RED (socket/journal rejection).
- [x] Extend existing helper with native creation/deletion/observed-write handling; select owned route before legacy lookups.
- [x] Include trusted imported graph rows in native ingress; preserve planner/receipts/history, implement graph-aware local compensation and batch debit.
- [x] Run native and legacy graph/ingress suites to GREEN; record material rulings.

### Task 2 — Release and verify

- [x] Update function passports, README and canonical changed-owner import URLs; bump manifest/forwarder to1.5.18, preserving old URLs; adjust cache regressions.
- [x] Independent read-only final review; fix Critical/Important findings with regression tests.
- [x] Run node --test tests/*.test.mjs, tracked node --check, JSON ConvertFrom-Json, git diff --check. Report counts and any live limitation.
- [x] Review diff/stat, re-fetch/check shared branch, stage only task files, commit and push origin lich_branch; verify clean/synchronized.

Authorization: user asked “Тогда сделаешь?” immediately after the exact native-tree approach was explained; continue the established inline delivery without repeated permission requests.

## Execution results

Native inventory graph take/import implemented inline. Existing planner/history/folder, linked documents and privileged recovery are retained. Canceled folder placement regression found in independent review and fixed before debit; review closed with no Critical/Important findings. Final `node --test tests/*.test.mjs`:5219 tests,5218 passed,0 failed,1 skipped. `node --check`:1100 JS/MJS passed;2 affected files rechecked after review fix. JSON `ConvertFrom-Json`:65 passed. `git diff --check`:passed. Live limitation: browser has no authenticated Foundry test-world session (about:blank). Version1.5.18; commit/push identity recorded in final task report.
