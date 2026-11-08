# Runtime Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal** Reduce repeated collection traversals in reactions, grouped combat, portable containers, and economy rebuilds.

**Architecture** Keep each optimization in its existing owner. Use a scene-scoped reverse index for reactions and operation-scoped indexes for live documents. Reuse the base economy model for disabled events.

**Tech Stack** Foundry VTT v13 and v14, dnd5e, ESM JavaScript, Node test runner.

**Spec** `docs/superpowers/specs/2026-11-08-runtime-performance-design.md`

## Global Constraints

Work in `lich_branch`. Preserve current APIs, stored state, formulas, quantities, permissions, and recovery semantics. Exclude traders. Use deterministic operation counts. Use terminal verification for this task. Update the function passport and advance the module version and forwarder.

## Review Focus

- Reactions follow a reassigned token and keep provider results live after movement and scene replacement.
- Grouped combat honors defeated groups, player authorization, effect boundaries, and deletion between awaited steps.
- Hierarchy repair keeps the first matching cycle's candidate order and the first create event's preferred ID.
- Container transfers retain installed components, reject orphans, and delete descendants before the root.
- Economy retains active event modifiers and supports array-only datasets as well as indexed models.

## Task 1. Reaction index

Files are `scripts/combat/reaction-capability-index.js` and `tests/reaction-capability-index.test.mjs`.

- [ ] Test the number of actor buckets visited by a single token refresh on a populated scene. Verify position-dependent provider output, reassignment, actor deletion, and scene replacement.
- [ ] Run `node --test tests/reaction-capability-index.test.mjs`. Expect a failed traversal bound.
- [ ] Maintain a reverse token UUID index in rebuild, refresh, removal, and invalidation. Preserve all existing hook and provider calls.
- [ ] Run the same test and expect zero failures.

## Task 2. Grouped combat

Files are `scripts/combat/turn-group-rules.js`, `scripts/integrations/grouped-combat-runtime.js`, `scripts/application/grouped-combat-service.js`, `scripts/integrations/grouped-combat-effects.js`, and the focused `tests/grouped-combat-*.test.mjs` suites.

- [ ] Test that navigation of 200 singleton groups advances to the expected group with one collection snapshot. Exercise live keyed lookup and removal between awaited steps, and bound reads of native turn position during legacy effect planning.
- [ ] Run `node --test tests/grouped-combat-*.test.mjs`. Expect the navigation and effect-planning traversal bounds to fail.
- [ ] Use a live `combatantById(combat, id)` helper for awaited steps. Use local maps and sets in navigation, authorization, phase selection, and turn lookup. Compute the legacy phase position at most once per phase. Keep existing order and checkpoint writes.
- [ ] Run the same suites and expect zero failures.

## Task 3. Container hierarchy and transfer

Files are `scripts/integrations/storage-container-hierarchy.js`, `scripts/data/runtime-item-graph.js`, `scripts/data/storage-container-item-service.js`, and focused hierarchy, item-service, and transport tests.

- [ ] Bound parent reads for a 200-node acyclic chain and for a synchronous create batch. Assert which portable container a cycle detaches. Bound whole-inventory reads when removing a container with multiple children and exercise existing composition round-trip and orphan coverage.
- [ ] Run `node --test tests/storage-container-hierarchy.test.mjs tests/storage-container-item-service.test.mjs tests/weapon-mod-transport.test.mjs`. Expect repeated traversal bounds to fail.
- [ ] Visit each parent edge once per repair pass and coalesce consecutive synchronous creates for the same actor. Build an operation-local item lookup keyed by ID, native parent and installed host in the transfer owner and reuse it through graph capture, rollback, and removal.
- [ ] Run the same suites and expect zero failures.

## Task 4. Economy

Files are `scripts/data/repository.js`, `scripts/data/global-events-service.js`, and focused economy and global-events tests.

- [ ] Count model assembly work with disabled and active event modifiers. Assert event-adjusted values. Test indexed scope lookup without enumerating the city list and retain an array-only fixture.
- [ ] Run `node --test tests/economy-*.test.mjs tests/global-events-service.test.mjs`. Expect the extra assembly and list traversal assertions to fail.
- [ ] Reuse the baseline model for absent or disabled global events. Prefer `cityById` in scope resolution and retain list fallback. Keep common model revision and cache invalidation.
- [ ] Run the same suites and expect zero failures.

## Task 5. Verification and release

- [ ] Update `docs/function-passport.md`, `README.md`, `module.json`, `scripts/main-1.5.66.js`, and the release assertions in `tests/module-manifest.test.mjs`.
- [ ] Run all tests, `node --check` on tracked and new JS and MJS, JSON validation, and `git diff --check`.
- [ ] Review the complete change against the spec and resolve findings.
- [ ] Check the remote branch again, stage task files explicitly, commit and push `lich_branch`.
