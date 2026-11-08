# Compact ammunition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Implement the approved compact magazine editor with local assets and all existing ammunition contracts.
**Architecture:** Extend the existing UI projection and draft event handlers; keep CombatAttackService transactions unchanged. Reuse physical layouts and source artwork.
**Tech Stack:** Foundry ApplicationV2, Handlebars, scoped CSS, Node tests, PNG/SVG.
**Spec:** docs/superpowers/specs/2026-11-08-compact-ammunition-design.md

## Global Constraints

- Work only on lich_branch; source workspace clean and remote synchronized at start.
- Preserve schema, authored effects, stock, legacy, 1/3/6 grouping, tail and transaction owner.
- No new settings, hooks, sockets or framework. Version 1.5.65 and versioned imports.

## Review Focus

- Partial/empty/large capacities: markers and counts stay reachable.
- Insufficient stock: replacement fails without losing draft; fill still works for partial groups.
- Saved/last patterns: local preview versus immediate last-pattern commit remains explicit.
- Long names/manual effects/legacy: information remains accessible without ordinary clutter.
- Keyboard/busy/close: no double dispatch or write on close, no mutation during commit.

### Task 1: Compact UI and assets

Files: scripts/ui/ammunition-magazine-app.js, templates/ammunition-magazine.hbs, styles/main.css, assets/ammunition/editor-texture.png, unload.svg, reload-last.svg; tests/ammunition-magazine-app.test.mjs.
Interfaces: buildMagazineView(value,selectedGroup=0,weapon={}) adds marker coordinates/count/icon; AmmunitionMagazineApp projects selected stock/group, preset editor and modified state. Existing draft methods retain signatures; renamePreset(index,name) adds local name validation.

- [x] Add failing tests for projected markers, selected details, direct placement staying selected, partial fill, local preset operations and last-pattern preview/commit separation.
- [x] Run focused tests and observe expected failures.
- [x] Save generated texture and authored SVG icons; implement compact template/style and local handlers.
- [x] Run focused UI + ammunition + combat tests; exercise real Foundry rendering/interactions with disposable state.

### Task 2: Release and review

Files: module.json, scripts/main-1.5.65.js, scripts/combat/attack-service.js import, README.md, docs/function-passport.md.
- [x] Update manifest/forwarder, cache key, passport and user instructions.
- [x] Run node --test tests/*.test.mjs, node --check tracked JS/MJS, parse tracked JSON and git diff --check.
- [x] Fresh final review, resolve important findings, record evidence below.
- [x] Review diff and prepare scoped release commit; push outcome reported in chat.

## Execution ledger

- Design approval: accumulated mockup approvals plus explicit instruction to implement. Execution inline in existing clean lich_branch, as project requires. No new worktree.
- Native UI permission: user explicitly granted in current task.

- Implementation: generated PNG saved locally; SVG actions created; existing body/cartridge art preserved. No domain transaction changes. Dense marker geometry zooms inside a scrollable stage to keep controls apart.
- RED/GREEN: five initial new behavior tests failed before implementation; UI suite now 19 passed / 0 failed / 0 skipped (NODE_PATH points at installed Foundry node_modules for actual Handlebars compilation). Dense-marker bounding-box regression also observed red then green.
- Focused domain/UI/combat run: 177 passed / 0 failed. Later UI/release/composition/storage run: 84 passed / 0 failed / 0 skipped.
- Full `node --test tests/*.test.mjs`: 5771 tests, 5768 passed, 3 failed, 0 skipped. All three failures in module-manifest were release checks: CRLF in new forwarder and two old attack-service cache expectations. Forwarder fixed to LF, cache expectations advanced with the actual import; affected suites rerun as the 84/84 result above. Successful unaffected results retained per AGENTS.md.
- Syntax: `node --check` on 1301 tracked/new JS/MJS: 0 failures; changed main/UI/forwarder rechecked after fixes. JSON: 65 tracked files parsed, 0 failures. `git diff --check` clean.
- Native UI: Foundry 14.369, dnd5e 6.0.6, GM CODEX in testovyj3. Native ApplicationV2 + actual template/CSS with detached synthetic draft and no-op commit callback; no Actor/Item writes. Verified click, keyboard Enter, drag/drop, reorder, copy/rename/delete presets, preview, clear/confirm label. Families: muzzle1, chambers2, tube6, rifle24/6, dense rifle36/1. No marker overlap after dense fix, no outer horizontal overflow at 620px or 440px. Assets return HTTP200. Existing global TextEditor/storage-drop compatibility warnings and video preloads remain; browser console has 0 errors. Foundry13/player live transaction execution not exercised; existing ownership/transaction unit tests retained.
- Fresh reviewer: compact_ui_review reported no actionable correctness/contract findings. Subsequent native checks fixed SVG inline baseline scrollbar and dense marker bounds; release fixes described above.
- Runtime manifest still reports pre-refresh 1.5.64 in the running server; disk manifest is 1.5.65. No Foundry server restart performed. Client reload is needed for deployed UI; server manifest refresh may require normal Foundry restart.
