# Hero Doll Native Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Fix false stale-slot failures caused by Foundry mutating the update argument.

**Architecture:** Keep HeroDollService and its existing per-Actor queue, native writes and recovery. Give Foundry a disposable flat Item patch; retain expected values for verification.

**Tech Stack:** Foundry 13, dnd5e, JavaScript ESM, Node test runner; no dependencies.

**Spec:** `docs/superpowers/specs/2026-10-25-hero-doll-native-update-design.md`, a repair of the already approved player-sync behavior. The user's continuous implementation/release authorization persists.

## Global Constraints

Preserve permissions, IDs, quantities, hands, presets, native confirmation, GM fallbacks and actual-conflict checks. No extra retries, cooldown, queue or timer. Use existing clean `lich_branch`; version 1.5.4 and one final validated runtime commit. Keep published entrypoints.

## Review Focus

- Foundry replaces dotted keys in-place, including before a rejected update.
- Both true and false equipped targets survive normalization.
- Placement failure still restores the correct previous equipped value.
- Visible document changes may precede native Promise settlement; subsequent actions must retain order without false errors.
- Genuine hook cancellation or changed source/slot must still reject, not be hidden by the repair.

## Task 1: Repair expected-state ownership and release

**Files:** `scripts/data/hero-doll-service.js`, `tests/hero-doll-owner-route.test.mjs`, `docs/item-instance-passport.md`, `docs/function-passport.md`, `module.json`, `scripts/main.js`, new `scripts/main-1.5.4.js`, release assertions in `tests/module-manifest.test.mjs` and `tests/main-composition-root.test.mjs`, `README.md`.

**Interface:** Preserve `#writeOwnerAssignment(actor,item,slotId,mode) -> Promise<Item>` and public assignment/clear contracts. Only ownership of the object passed to `item.update` changes.

- [x] Add failing native argument-normalization tests for assign/clear, placement failure recovery, and a subsequent queued action while native acknowledgement is pending. Run `node --test tests/hero-doll-owner-route.test.mjs`; reproduce the reported `stale-slot`.
- [x] Pass a shallow copy of the flat Item patch to `item.update`. Run owner, instances, presets and service tests; all must pass with existing conflict/cancellation assertions intact.
- [x] Update passports and release to 1.5.4. Only hero-doll-service cache URL advances; other player-sync owner cache keys stay 1.5.3. Run composition/manifest tests.
- [x] Independently review the small fix against the verified Foundry implementation and new regressions; resolve findings without weakening conflict checks.
- [x] Run full `node --test tests/*.test.mjs`, tracked JS/MJS `node --check`, tracked JSON parsing and `git diff --check`; record counts and limitations.
- [x] Check remote/branch, stage only task files, commit and push `lich_branch`; verify clean synchronized state.

## Plan review

All five Review Focus cases map to new native-input regressions or retained owner conflict/cancellation tests. Source evidence determines the one-line repair; no new product decision or approval gate is introduced. Timing assertions use controlled promises rather than wall-clock sleeps. Existing published forwarders remain available.

## Verification record

- Regression RED: 5 new tests failed, existing 19 owner tests passed. Failures reproduced the reported stale-slot after Foundry-style in-place input expansion, and incorrect recovery predicates.
- GREEN after the one-line runtime repair: 86/86 owner, instances, presets and service tests. Manifest/composition: 52/52. Genuine-conflict and native-hook-cancellation assertions are retained.
- Fresh independent Gemini 3.8 Flash High review, status SUCCESS: fix and true/false, recovery and queued-follow-up coverage approved; no actionable issue. The shallow copy relies on the verified flat primitive boolean patch contract; the passport records this boundary.
- Live GM/player test remains unavailable: Playwright profile already in use and connected browser inventory contains no Foundry tab. The exact 5–10 second live delay has not been timed; no claim of measured client latency improvement. Controlled Promise tests verify follow-up ordering and removal of the false rejection.
- Pre-release fetch: `HEAD...origin/lich_branch = 0/0`, `HEAD...origin/main = 92/0`; current branch `lich_branch`, no unrelated changes. Published 1.5.3 forwarder retained; only hero service cache URL advances to 1.5.4.
- Full `node --test tests/*.test.mjs`: 5024 total, 5023 passed, 0 failed, 1 existing skipped rendered-ghost test (Foundry Handlebars unavailable to Node). `node --check` on tracked JS/MJS plus new forwarder: 1060 checked, 0 errors. Tracked JSON via `ConvertFrom-Json`: 58 checked, 0 errors. `git diff --check`: clean.
- Release integration: explicit-path staging; commit message `fix: preserve hero equipment expectations across native updates`; push to `origin/lich_branch`. Exact commit hash is reported in delivery. Scratch ledger/review/logs are removed after successful push; their findings and validation counts are retained here.
