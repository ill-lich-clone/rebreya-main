# Grouped Combat Jump Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject dangerous forward jumps before phase allocation or world mutation, and measure a large simulated encounter.

**Architecture:** The grouped-combat domain calculates a bounded forward distance and conservative phase-member budget without iterating across skipped turns; the service rejects excessive transitions before planning, with a clear UI error. Relative traversal in the planner avoids loss of integer precision at large valid round numbers. Existing phase execution, recovery and provider workflows remain intact.

**Tech Stack:** Foundry VTT 13/14 module, JavaScript ESM, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-14-grouped-combat-jump-safety-design.md`

## Global Constraints

- At most 1000 crossed groups and 1,000,000 conservatively estimated phase member references per forward transition.
- Also limit estimated participant-wide turn passes to 400 member-visits, or one pass through all participants if there are more than 400; old oversized pending operations remain intact and are not replayed automatically.
- Preserve normal forward/backward/pending transitions, phase ordering, GM and player permissions, recovery, initiative, authored effects and world settings.
- Reject a new oversized transition before phase construction or any combat persistence or effect execution. Estimate cost in O(groups + participants), independent of requested round distance. An old oversized pending transition is blocked with a small status/receipt patch.
- No desktop or live Foundry interaction without explicit current-task permission. Tests with simulated providers cannot establish real-world FPS or timings.
- Increment `module.json` version and matching runtime forwarder, update the function passport and any relevant user documentation.

## Review Focus

- Enormous but valid safe-integer round: reject promptly without world writes or effects.
- Large absolute round with a nearby destination: preserve exact sequence and terminate.
- Budget boundary and large grouped encounter: accept within limits, reject beyond, with no partial effects.
- Deleted current group and pending/recovery states: preserve existing fallback and handling.
- Normal next turn, next round, backward navigation and skip-defeated phases: preserve behavior.

### Task 1: Safe bounded transition

**Files:** Modify `scripts/combat/turn-group-rules.js`, `scripts/application/grouped-combat-service.js`, `scripts/integrations/grouped-combat-runtime.js`; test `tests/grouped-combat-rules.test.mjs`, `tests/grouped-combat-service.test.mjs`, `tests/grouped-combat-runtime.test.mjs`.

**Interfaces:** Introduce one domain-level estimate/check consumed by `GroupedCombatService.transition`; report a distinct actionable rejection code through existing runtime notification mapping. Keep `planGroupTransition(state,target,groups,skippedGroupIds)` and phase shape unchanged.

- [ ] Write focused failing tests for the five review cases, including an isolated process with timeout for huge inputs, no world writes on rejection, exact boundary, large absolute round and ordinary effect order.
- [ ] Run the focused tests and confirm expected failures before implementation.
- [ ] Implement bounded relative-distance validation and precision-safe phase enumeration; do not change pending or backward semantics. Guard before allocating phases.
- [ ] Run the focused tests, verify exact output and no failures.

Review ruling: cap expected participant-wide turn processing as well as plan allocation, and guard recovery of older oversized plans. This may reject a previously accepted jump; executing the same transitions in smaller steps preserves each effect, while a previously persisted oversized pending operation requires manual developer-assisted recovery.

User-approved adjustment: GM Next Round advances automatically one live group at a time, retaining the last confirmed position if interrupted. Player permissions remain unchanged. Preserve joined in-flight navigation, stop on external position/revision changes, and allow skipped defeated groups without counting nonexistent each-turn phases. Validate saved plans against their original phase member counts when members have since disappeared.

### Task 2: Large encounter and release verification

**Files:** Add a focused simulation test or benchmark under `tests/` or `tools/` as appropriate; update `docs/grouped-combat-function-passport.md`, relevant README section, `module.json` and matching `scripts/main-<version>.js`.

- [ ] Exercise actual service start and transitions with a large reproducible synthetic encounter, including grouped and ungrouped creatures and simulated effect steps; record participant/group/step counts, elapsed times, and what is mocked. Test the refusal separately without timing assertions as the sole proof.
- [ ] Update documentation with limits, rejection behavior and verification scope; bump version and replace the forwarder without changing its import-only contract.
- [ ] Run affected focused tests, `node --test tests/*.test.mjs`, `git diff --check`, syntax checks for tracked JS/MJS and JSON parsing per project instructions. Report exact pass/fail counts.
- [ ] Review `git diff --stat` and full substantive diff, confirm branch and remote status, stage only task files, commit and push `lich_branch` without force.
