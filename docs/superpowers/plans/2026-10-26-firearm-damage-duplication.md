# Firearm Damage Duplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop firearm activity saves from duplicating base damage and repair the three identified world items without removing authored damage.

**Architecture:** Preserve original activity source when the combat service rewrites activity collections. Correct already damaged documents once through Foundry's GM document API using exact identities and preconditions, without a blanket migration.

**Tech Stack:** Foundry VTT 13, dnd5e 5.2.5, JavaScript, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-26-firearm-damage-duplication-design.md`.

## Global Constraints

- Keep authored damage parts, settings, hooks, APIs, ammunition state and unrelated world items unchanged.
- Use only `lich_branch`; increment module version and update its forwarder and function passport.
- Do not edit a live Foundry database directly; use active GM document APIs and re-read after updates.

## Review Focus

- A prepared base part is not source damage and must never be persisted as an extra part.
- An authored extra part equal to base damage must survive synchronization and repair.
- Repeated property saves must not grow the damage array.
- Repair must preserve other activities and all additional fields and skip changed or ambiguous documents.
- A proficiency-only update must retain its existing behavior; test combined sheet submissions as well.
- A property reorder during a proficiency save must preserve the magazine, current misfire, and jam; real property changes must still synchronize.

## Task 1: Reproduce and prevent serialization of prepared damage

- [x] Add focused tests in `tests/combat-attack-service.test.mjs` with activity `toObject(source)` representations, covering synchronization and firearm activity repair, authored extra damage, repeated saves, and proficiency/property form data.
- [x] Run the focused tests and confirm they fail because the current code requests prepared data.
- [x] Change `sourceData` in `scripts/combat/attack-service.js` to prefer source data while retaining the fallback for plain objects and serializer errors.
- [x] Test and implement the pre-update removal of a reordered but otherwise unchanged valid firearm-property set. Cover real additions/removals, unsupported values, missing source, and batched hooks without shared state.
- [x] Rerun the focused tests and existing combat attack tests; inspect the result.
- [x] Update the relevant function passport entry and synchronize `module.json` and the versioned forwarder.

## Task 2: Correct the observed world items

- [x] Inspect current world snapshots and the active GM connection. If the bridge is unavailable, prepare and test a temporary ready hook guarded by world ID, active GM, exact item IDs and exact source damage.
- [x] Have the GM reload to run the hook, or use the connected document API. Update each item only when its current source has the identified single duplicate; skip and report any ambiguity.
- [x] Re-read each item and verify one base part remains and unrelated item data is unchanged apart from system cleanup of empty rider flags.
- [x] Remove the temporary hook after verification; retain an inert stub at its previously served URL to avoid breaking cached imports.
- [ ] Exercise the proficiency control in a live Foundry sheet: not performed because the user prohibited Computer Use; cover the identified input path with focused tests and report this limit.

## Task 3: Final checks and Git

- [x] Run `node --test tests/*.test.mjs`, `git diff --check`, JavaScript syntax checks and JSON parsing checks required by `AGENTS.md`. The full run reported 5,132 passed, one skipped, and one timing-sensitive inventory refresh failure; a separate run of `tests/ui-refresh-coordinator.test.mjs` passed 28/28 after the concurrent load ended.
- [ ] Review the diff and changed contracts; verify branch and remote status remain safe.
- [ ] Commit only this task's files and push `lich_branch` without force. Report the spec and plan paths, checks, world repair results and any live-test limitations.
