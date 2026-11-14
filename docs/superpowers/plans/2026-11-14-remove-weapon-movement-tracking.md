# Remove Automatic Weapon Movement Tracking Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan in the current session.

**Goal:** Remove the repeated Actor writes from the weapon attachment distance tracker.

**Architecture:** CombatAttackService owns aim and reaction lifecycle. Keep aim invalidation and the existing explicit decision route. Drop the automatic counter and preserve the grouped coordinator.

**Tech stack:** Foundry VTT JavaScript modules, Node test runner.

**Spec:** [Remove automatic weapon movement tracking](../specs/2026-11-14-remove-weapon-movement-tracking-design.md)

## Global constraints

- Existing aim limits, bonuses, authorization, replay protection, reaction refresh and grouped phase order remain in force.
- Old counter flags can remain stored and are ignored. No changes to live world data are required for deployment.
- Follow the repository's versioned entrypoint, verification and lich_branch Git workflow.

## Review focus

- An existing actor flag for the current turn must not override a new explicit aim decision.
- A clean ordinary NEXT must retain reaction restoration with one Actor write.
- Grouped weapon cleanup must preserve the phase split with reaction restoration.
- Moving with active aim must clear the active aim and its effects without a movement counter write.
- Existing item updates, decision validation and recovery must retain their original contracts.

## Task 1: Remove persistent tracking

- [x] Update `tests/item-upgrade-automation-service.test.mjs` to count Actor writes on ordinary and grouped turns. Update `tests/weapon-mod-roll-modifiers.test.mjs` to verify legacy counter is ignored, explicit aim decision enforces the existing limit and replay, and movement/turn end still cancel aim without updating the Actor counter.
- [x] Run the focused tests and confirm the old code fails the new assertions.
- [x] Remove the movement counter from turn and token movement handlers in `scripts/combat/attack-service.js`. Reuse the existing hooks with the same signatures for aim cleanup, mount and lights.
- [x] Re-run the tests. Update the weapon mods and grouped combat passports and README. Bump to 1.5.85 and update runtime entry and changed module import URLs.
- [x] Run the full repository checks and review the diff. Full suite: 5904 passed, 2 skipped, 0 failed. Both released entrypoints and the new combat service were confirmed over HTTP.

Release this task as one commit on `lich_branch` and push the branch to origin.
