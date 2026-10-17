# Inventory Template Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task after user review.

**Goal:** Restore the existing inventory window by supplying a valid Foundry template filesystem path.

**Architecture:** Retain InventoryApp and its existing Handlebars PARTS. Remove the template query string and refresh the JavaScript class through one canonical import URL; no new service or data migration.

**Tech Stack:** JavaScript ESM, Foundry v13 ApplicationV2, Node test runner, PowerShell.

**Spec:** `docs/superpowers/specs/2026-10-17-inventory-template-loading-design.md`

## Global Constraints

- Preserve all inventory APIs, settings, flags, formulas, quantities, currency, budgets, transactions, recovery, permissions, and loot claims.
- Module release: `1.4.394`; retain all historical entrypoint forwarders.
- All three `inventory-app.js` imports must use `?v=1.4.394`; other runtime owners retain their current cache keys.
- Work only on `lich_branch`; stage only task files; no force push.

## Review Focus

- Query/hash suffixes must not reach the server's filesystem extension check: assert the actual PARTS path and extension.
- The accepted template path must identify a real file: stat the corresponding module-relative file.
- Main window, folder popout, and refresh path must share one InventoryApp class: preserve canonical-URL tests.
- A running server may retain an older manifest: preserve all released forwarders and test their canonical imports.
- Existing inventory/folder behavior must remain stable: run the existing context suite and full regression suite.

### Task 1: Restore template loading and publish the cache-safe patch

**Files:**
- Modify: `scripts/ui/inventory-app.js`, `scripts/main.js`, `module.json`.
- Create: `scripts/main-1.4.394.js`.
- Test: `tests/inventory-app-context.test.mjs`, `tests/module-manifest.test.mjs`, `tests/main-composition-root.test.mjs` (additional existing release pins found during execution).
- Document: inventory UI section in `docs/function-passport.md`, approved spec and this plan.

**Interfaces:** Consume and preserve `InventoryApp.PARTS.main.template` and existing `openInventoryApp(options = {})` / `openInventoryFolderPopout(groupActorId, folderId)`; introduce no public interfaces.

- [x] Add `InventoryApp template path passes Foundry server extension validation` to the existing context test, using its Foundry stub and actual class import. Assert exact path `modules/rebreya-main/templates/inventory-app.hbs`, `extname(path) === ".hbs"`, no query/hash, and a real template file via `stat()`.
- [x] Run `node --test --test-reporter=tap --test-name-pattern="InventoryApp template path" tests/inventory-app-context.test.mjs`; confirm failure on the current queried path before editing runtime code.
- [x] Set the existing PARTS template to the exact plain path above. Update all three composition imports to `inventory-app.js?v=1.4.394`.
- [x] Set manifest version/entrypoint to `1.4.394` / `scripts/main-1.4.394.js`; add the forwarder with exactly `import "./main.js";` plus a newline; preserve old files.
- [x] Update release assertions in `tests/module-manifest.test.mjs`. In the canonical-owner assertion, pin `inventory-app.js` to `1.4.394`, retain `inventory-service.js` / `inventory-sync.js` at `1.4.393`, and retain remaining owners at `1.4.377`.
- [x] Run `node --test --test-reporter=tap tests/inventory-app-context.test.mjs tests/module-manifest.test.mjs`; require zero failures, including canonical URLs and historical forwarders.
- [x] Document the template-path restriction, class ownership, and focused test in the existing inventory section of the function passport.
- [x] Run `node --test --test-reporter=tap tests/*.test.mjs`; report actual passed/failed counts and failures. Run `node --check` on every tracked JS/MJS file plus the new forwarder; parse every tracked JSON file; require zero errors and `git diff --check` success.
- [x] If an authenticated Foundry session becomes available, open, close, and reopen the inventory with the existing public API and inspect template errors. Otherwise report live validation as unavailable; do not claim a live pass.
- [x] Obtain a compact independent Gemini review of the relevant diff using supplied snippets when CLI command permission is unavailable; verify any findings against source and rerun affected checks after corrections.
- [x] Review task-file diff and staged scope, commit with `fix(inventory): restore Foundry template loading`, and run `git push -u origin lich_branch`. Record commit, validation, spec, and plan paths in the final report.

## Baseline and review status

Before implementation, context and manifest suites passed **166/166**, zero failures. The server restriction was verified in installed Foundry **13.351** source; installed dnd5e is **5.2.5**. Browser tools currently expose no authenticated Foundry tab.

Spec and plan approved by the user on 2026-10-17; Native execution selected.

## Execution results

- Spec and Native plan approved by the user and implemented on 2026-10-17.
- RED: the new template-path regression failed on `.377` versus `.hbs` before runtime edits.
- GREEN: `node --test --test-reporter=tap tests/inventory-app-context.test.mjs tests/module-manifest.test.mjs tests/main-composition-root.test.mjs` — 178 passed, 0 failed.
- `node --test --test-reporter=tap tests/*.test.mjs` — 4831 passed, 0 failed, 1 skipped (4832 tests including nested cases). Skipped: `rendered ghost is removable and mechanically empty; authored names are escaped and readonly controls disabled`, because the Foundry Handlebars dependency is unavailable through NODE_PATH.
- `node --check` over all tracked JS/MJS plus the new forwarder — 1020 files checked, 0 failures.
- `Get-Content -Raw -Encoding UTF8 <file> | ConvertFrom-Json` over every tracked JSON — 58 files checked, 0 failures.
- `git diff --check` — passed.
- Gemini 3.8 Flash High reviewed the complete scoped diff and new forwarder: APPROVE, no Critical/Important findings.
- Ruling: also update the existing release/import pins in `tests/main-composition-root.test.mjs`; all assertions retained. No additional runtime behavior or risk.
- Deferred minor: Gemini noted a pre-existing unused `moduleVersion` fallback in `openInventoryFolderPopout`; unrelated cleanup was left outside this fix.
- Live window open/close/reopen was unavailable: no authenticated Foundry tab is exposed by the current tools. Installed versions confirmed from files: Foundry 13.351, dnd5e 5.2.5; these are not live-test claims.
- Existing successful verification results were reused without an extra full-suite rerun, following AGENTS.md.
