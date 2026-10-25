# BG3 HUD Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Restore player HUD after reconnect/teleport while preserving layout, settings and no-HUD-for-GM behavior.

**Architecture:** Patch existing BG3 owners in an isolated copy, then apply hash-verified reversible changes to the installed sibling module. Keep rebreya-main limited to its existing compatibility import boundary and the patch/test/documentation record. Serialize HUD generation and invalidate obsolete lifecycle work; do not introduce another HUD or dependencies.

**Tech Stack:** Foundry 13.351, dnd5e 5.2.5, BG3 3.4.5→3.4.6, Midi-QOL 13.0.61, DAE 13.0.27; Node test runner/VM and PowerShell.

**Spec:** `docs/superpowers/specs/2026-10-25-bg3-hud-recovery-design.md` (approved; autonomous planning/execution authorized).

## Global Constraints

- GM never constructs or renders HUD; uiEnabled=false is respected.
- Preserve setting metadata, flags schema, layout/UUIDs, resource spending, advantage/disadvantage/advOnce, manual deselect lock and character no-autopopulation.
- Recovery writes no actor flags/world settings/resources; retain explicit existing link→unlink reset.
- Use scene+token identity and existing events/transport; no polling or additional dependencies.
- BG3 uses canonical `?v=3.4.6`; rebreya-main 1.5.4→1.5.5 and canonical BG3 compatibility imports.
- All repository changes on `lich_branch`; do not reset concurrent work. Installed-module backups and before-hash check precede application.

## Review Focus

- A→B→C while old async work completes: newest valid context wins (Task 1 tests).
- Equal token IDs in different scenes and unlinked actors: no destination flag deletion (Task 1).
- Empty/hidden/unowned tokens and manual deselect lock: safe close, no permission bypass (Task 1).
- Missing MIDI API/counters and setting disabled: preserved fallback/manual state (Task 2).
- Versioned imports and GM absent-panel callbacks: old patches remain effective, one ESM owner (Task 3).

## Task 1: Token identity and lifecycle recovery

**Files:** installed-copy `scripts/bg3-hotbar.js`, `scripts/managers/HotbarManager.js`; create `tools/local-module-patches/2026-10-25-bg3-hud-recovery/hud-recovery.test.mjs`.

**Interfaces:** retain `generate(token)`, `currentTokenId`, manager getters and default `_loadTokenData()` behavior. Add transient `currentSceneId`; `_getRecoveryToken(preferred = null)` resolves an eligible current-scene Token; `_scheduleRecovery()` batches lifecycle recovery; `_onCanvasTearDown()` invalidates obsolete work. `_loadTokenData({readOnly = false} = {})` preserves old caller behavior and allows recovery to skip legacy Item section writes. Existing `_onDeleteToken(tokenDocument, options = {})` uses source identity/replacement metadata without flag cleanup.

- [x] Write actual-source VM regressions: player ready/reconnect 0/1/multiple tokens, GM lifecycle, disabled HUD, hidden/unowned rejection, manual deselect lock, canvas hook registration, same-ID late source delete, new-ID replacement, DAE create-before-delete, rapid transitions and stale async load/render, no Document writes/layout changes, bounded component references.
- [x] Run `node --test tools/local-module-patches/2026-10-25-bg3-hud-recovery/hud-recovery.test.mjs`; observe behavioral failures against installed 3.4.5.
- [x] Implement scene identity/recovery in existing owners. Keep string-only temporary manager callers working; skip migration writes only in recovery. Serialize close/load/render, discard obsolete queued work and reset replaced component references.
- [x] Rerun focused tests against isolated copy via `THIRD_PARTY_MODULES_ROOT`; expected all Task 1 assertions pass. Record RED/GREEN results in ledger.

## Task 2: Effects and MIDI state

**Files:** installed-copy `scripts/components/containers/ActiveContainer.js`, `FilterContainer.js`, BG3 `_onUpdateActive`; same focused test file.

**Interfaces:** `activesList` always returns an array; `_checkBonusReactionUsed()` keeps existing toggling setter but only changes state when desired status differs. Use `MidiQOL.hasUsedReaction`/`hasUsedBonusAction` when available, actor counters otherwise, old effect-ID fallback when counters/API absent. No writes to MIDI resources.

- [x] Add failing tests for absent/in-transit actor effect render, valid effect update/error reporting, 0/1/2 of 2 reaction and bonus limits/reset, absent MIDI/API/counters, disabled synchronization and preserved manual state.
- [x] Run focused tests and inspect expected failures before production edits.
- [x] Implement null-safe effect rendering and current-context update checks; report real active render failures rather than swallowing them. Implement count-aware MIDI indicators.
- [x] Run all focused tests plus `node --test tools/local-module-patches/2026-10-02-console-errors/console-errors.test.mjs`; preserve all 34 prior assertions.

## Task 3: Canonical imports, release and existing runtime-policy tests

**Files:** BG3 `tests/runtime-policy.test.mjs`, manifest/forwarder/import queries; rebreya `scripts/hooks.js`, `tests/bg3-hotbar-compat.test.mjs`, `tests/module-manifest.test.mjs`, manifest, `scripts/main-1.5.5.js`, README.

**Interfaces:** existing compatibility methods dynamically append installed BG3 manifest version to their import URLs; public signatures/behavior remain. Runtime-policy mock lookup strips URL query only for matching dependency names, retaining actual ESM evaluation/assertions.

- [x] Pin canonical compatibility URL for both classes and rebreya 1.5.5 entrypoint in tests; run focused tests to see failures. Preserve GM settings/registration assertions.
- [x] Repair BG3 mock resolution; update BG3 to 3.4.6 and all relative runtime JS query strings with one canonical key. Update rebreya imports and release metadata to 1.5.5.
- [x] Run BG3 `node --experimental-vm-modules --test tests/runtime-policy.test.mjs` (3/3), rebreya focused tests and previous local-patch suite (34/34). Compare setting metadata and original layout fixtures; check every relative import target/query.

## Task 4: Package, review, verify, apply and commit

**Files:** new patch folder README/manifest/patch/tests, `docs/function-passport.md`, this plan/spec; external exact backup outside Git.

**Interfaces:** patch applies only to exact before-hashes and can be reversed to exact originals. Installed source and isolated verified source must have identical after-hashes.

- [x] Generate reversible patch and before/after SHA-256 manifest from exact backup and isolated copy. Test forward/reverse application to disposable exact copies; record results and backup location.
- [x] Obtain independent Gemini review of behavioral diff/tests/spec; verify findings against source, fix important issues with failing test first, and rerun affected checks.
- [x] Verify installed BG3 still matches before-hashes; apply verified files. Never replace unknown concurrent changes.
- [x] Run full `node --test tests/*.test.mjs`, `git diff --check`, tracked JS/MJS syntax and tracked JSON parser once. Run affected BG3/compat suites against installed source. Attempt existing live bridge read-only; perform live GM/player reconnect/region/effects only if an authorized test session is available; otherwise report live limitation.
- [x] Update passport with signatures/ownership/data flow/tests, record RED/GREEN and checks in README/ledger. Review complete meaningful diff/stat and stage only task files. Commit and `git push -u origin lich_branch`; report commit, installed versions, spec/plan, tests and remaining live limitation.

## Execution rulings

- Reuse `lich_branch` as required by AGENTS and approved spec. BG3 is outside Git; an isolated copy under ignored `tmp/bg3-hud-recovery/` plus before-hashes supplies source isolation; another worktree would not isolate the installed sibling module.
- Keep native PowerShell ledger at `tmp/bg3-hud-recovery/progress.md` rather than invoking Bash-only SDD helper scripts. No task is complete without recorded test evidence.
- Rebreya baseline is now 1.5.4 at `e6fb0525`; release becomes 1.5.5. No behavioral scope change.
