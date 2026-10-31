# Firearm chat render repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Restore native dice expansion and stable per-shot cancellation.

**Architecture:** Correct the existing CombatAttackService document update boundaries. Preserve native dnd5e roll metadata only on typed roll cards and use native == forced replacement without deleting and setting the same key.

**Tech Stack:** Plain ESM, Foundry 13.351, dnd5e 5.2.5, MIDI 13.0.61, Node tests.

**Spec:** `docs/superpowers/specs/2026-10-31-firearm-chat-render-design.md`

## Global Constraints

- Existing 1/3/6 spending, ordered ammunition, authored formulas and bonus once remain.
- Current-session cancellation only; no workflow recovery or custom sockets.
- Only lich_branch; version bump and explicit task-file staging.

## Review Focus

- Typed native card retains ammunitionData and bonus once.
- MIDI special ammunition card has no fabricated dnd5e roll metadata.
- Replacing an almost-identical snapshot retains address and removes stale optional keys.
- Cancellation and preCheck writes preserve full snapshot and unrelated flags.
- Existing damaged card repairs do not modify rolls, HP or inventory.

### Task 1: Repair document writes and verify native rendering

**Files:** `scripts/combat/attack-service.js`, `tests/combat-attack-service.test.mjs`, `module.json`, `scripts/main.js`, new `scripts/main-1.5.40.js`, relevant cache assertions, `docs/function-passport.md`, `README.md`.

**Interfaces:** Existing `applyDnd5ePostAttackRoll`, `applyMidiFirearmMisfire`, `cancelFirearmMisfire`; no API additions.

- [x] Add regression with real ammo snapshot and MIDI-shaped flags; assert no dnd5e.roll is created and module ammo/damage remain. Retain typed native coverage.
- [x] Strengthen snapshot boundary regression: full unchanged address/outcome plus changed midiOriginal must survive; assert native `==firearmMisfire` at sync, preCheck and cancel boundaries. Run focused RED.
- [x] Guard native ammunitionData writes on existing roll.type; use native == snapshot replacement updates. Bump to 1.5.40, synchronize cache paths and forwarder. Run focused GREEN.
- [x] Repair only verified damaged message metadata from saved attack Roll. Save before/after evidence. Live actual ammo success/jam, repeated updates and dice clicks; cancellation remains jam→miss until clicked, damage/spending preserved. Remove disposable fixtures.
- [x] Update passport and README, run full Node suite, all tracked JS/MJS syntax and JSON parse, diff checks. Record counts.
- [x] Fresh-context whole-change review; fix material findings once with RED→GREEN. Explicit stage, commit and push origin lich_branch. Verify clean status.

Self-review: all spec requirements map to Task 1. Single task, no shared interfaces. This is a correction of the approved feature, implemented inline under the existing authorization; no new product decisions require confirmation.

## Verification and review

- Regression RED: 8 failures, all on the two confirmed boundaries. Final focused suite: 218 passed, 0 failed.
- Full: node --test --test-reporter=tap tests/*.test.mjs — 5399 passed, 0 failed, 1 skipped (5400 total). JS/MJS syntax: 1141 files, 0 errors; JSON parse: 65 files, 0 errors; diff check clean.
- Live Foundry 13.351 / dnd5e 5.2.5 / MIDI 13.0.61: actual special-ammo attack17 hit, damage19 piercing +6 fire, HP200→175; attack and damage dice expand. Final version jam attack10: hits0, damage0, HP200. Native cancel button survives repeated display updates; clicking it restores same10, hit1, damage14+3fire, HP183; ammo0, inventory2, threshold20 unchanged. Both dice expand after cancellation; no duplicate cancel button.
- Existing card UnkHfH8AG78TwIXd: removed only malformed native roll metadata, restored full saved snapshot. Rolls/content unchanged. After F5 old attack die expands; old cancel control is disabled as agreed for expired workflows.
- Native replacement probes verified == retains unchanged address and removes old optional fields; sibling flag remains. No root delete-and-set. No new browser exceptions after repair/reload.
- Fresh read-only reviewer firearm_chat_render_review found no Critical/Important issues, focused206/206; README release-history typo corrected. Live/transport/data-repair boundaries left to root were exercised above. Source actor snapshot unchanged; only disposable QA fixtures modified/removed.
- Existing author/GM permissions and current-session-only contract preserved. No player identity was impersonated; focused permission tests retain coverage.
