# Native Ammunition Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give ordinary ranged weapons strict dnd5e ammunition types, repair existing actor items, and automate ammunition-free Repeating Shot attacks.

**Architecture:** Keep catalog inference in a focused ammunition compatibility module shared by gear generation, migration, and combat validation. `CombatAttackService` owns attack-time validation and Repeating Shot suppression; a small active-GM repair entry point updates existing actor documents without replacing their full systems.

**Tech Stack:** Foundry VTT 13, dnd5e 5.2.5, JavaScript ES modules, Node test runner.

## Global Constraints

- Firearms retain the existing Rebreya magazine/reserve flow.
- Existing user customization must be preserved.
- Migration writes run only on the active GM and are idempotent.
- Work is committed and pushed only on `lich_branch` without force push.

---

### Task 1: Canonical Ammunition Compatibility

**Files:**
- Create: `scripts/data/ammunition-compatibility.js`
- Modify: `scripts/data/gear-compendium.js`
- Test: `tests/ammunition-compatibility.test.mjs`
- Test: `tests/gear-compendium.test.mjs`

**Interfaces:**
- Produces: `inferWeaponAmmunitionSubtype(item) -> string`
- Produces: `inferAmmunitionItemSubtype(item) -> string`
- Produces: `isCompatibleAmmunition(weapon, ammunition) -> boolean`

- [ ] Write tests mapping bow, crossbow, blowgun, and sling fixtures to literal dnd5e subtypes.
- [ ] Run the tests and verify missing subtype generation fails.
- [ ] Implement canonical inference from base item first and stable Rebreya gear identity second.
- [ ] Set `system.ammunition.type` when generating ordinary `amm` weapons.
- [ ] Run compatibility and gear compendium tests.

### Task 2: Existing Actor Item Repair

**Files:**
- Modify: `scripts/data/ammunition-compatibility.js`
- Modify: `scripts/main.js`
- Test: `tests/ammunition-compatibility.test.mjs`

**Interfaces:**
- Produces: `repairActorAmmunitionCompatibility(actor) -> Promise<{ updatedWeapons, updatedAmmunition }>`
- Produces: `repairWorldAmmunitionCompatibility(game) -> Promise<summary>`

- [ ] Write a failing test with a hand crossbow typed as empty, musket ammunition persisted in its activity and `flags.dnd5e.last`, and a matching bolt stack.
- [ ] Verify the test fails because the weapon and stale selections remain unchanged.
- [ ] Implement partial document patches that set canonical types and clear only incompatible persisted selections.
- [ ] Add active-GM initialization after managed gear synchronization, with per-actor error isolation.
- [ ] Run migration tests twice against the same fixture to prove idempotency.

### Task 3: Repeating Shot and Attack-Time Validation

**Files:**
- Modify: `scripts/combat/attack-service.js`
- Test: `tests/combat-attack-service.test.mjs`

**Interfaces:**
- Consumes: `isCompatibleAmmunition(weapon, ammunition)`
- Attack-time behavior: suppress native ammunition for active Repeating Shot; otherwise retain only compatible positive-quantity choices.

- [ ] Write a failing test where Repeating Shot is active and a valid ammunition ID is selected.
- [ ] Verify native ammunition remains enabled before implementation.
- [ ] Implement active enchantment detection by localized name and known compendium origin.
- [ ] Reuse the firearm-style roll suppression without changing firearm behavior.
- [ ] Write failing tests for zero-quantity and incompatible ordinary ammunition selections.
- [ ] Update validation to filter those selections while preserving valid matching ammunition.
- [ ] Run combat attack service tests.

### Task 4: Verification and Delivery

**Files:**
- Modify: `scripts/main.js` cache-bust import if required by the final dependency graph.
- Modify: `tests/module-manifest.test.mjs` only when the cache-bust expectation changes.

- [ ] Run focused ammunition, gear, combat, and manifest tests.
- [ ] Run the repository's available full Node test suite and record unrelated failures separately.
- [ ] Run `git diff --check`, inspect the complete diff, and verify only scoped files changed.
- [ ] Commit with a meaningful ammunition compatibility message.
- [ ] Push `lich_branch` to `origin` without force.
