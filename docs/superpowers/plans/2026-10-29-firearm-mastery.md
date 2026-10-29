# Firearm Mastery Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans; verify each task with a failing regression before implementation.

**Goal:** Diagnose Harleyf's misfire and implement the firearm master feat and prone fire.

**Architecture:** Extend the existing combat attack, weapon-mod validation, feat and enchantment owners. Preserve typed GM authorization, item links, authored formulas and existing attack sources.

**Tech Stack:** Foundry VTT 13, dnd5e 5.2.5, JavaScript, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-29-firearm-mastery-design.md`

## Global Constraints

- Preserve current settings, public API, flags, quantities, budgets and existing combat behavior.
- All client-facing changes require a new module version and matching versioned entrypoint.
- Update the function passport for changed methods and test the real Foundry integration when accessible.

## Review Focus

- Missing versus explicitly disabled misfire state; retain current-property semantics.
- Confirmed versus cancelled attacks; exactly one ammo spend, check and timer start.
- Two independently chosen mounts, occupied slots, unauthorised requests and persistent links.
- Other disadvantage sources and advantage survive ignoring prone.
- Buff expiration across reload, transfer, reapplication and world-time advance.

### Task 1: Diagnose and correct misfire

**Files:** `scripts/combat/attack-service.js`, `scripts/combat/hooks.js`, `tests/combat-attack-service.test.mjs` as diagnosis warrants.

- [ ] Trace the actual Harleyf item flags and native/MIDI roll path; identify the first broken boundary without modifying world data.
- [ ] Write a regression reproducing the confirmed cause, observe the failure, make the minimal correction and rerun focused tests.
- [ ] Preserve disabled properties, ammo, jam recovery and abort behavior.

### Task 2: Feat and attachments

**Files:** `scripts/data/weapon-mod-rules.js`, `scripts/data/item-upgrade-service.js`, `scripts/integrations/weapon-mod-panel.js`, associated typed command and owner tests.

- [ ] Test a feat owner choosing arbitrary free mounts, including two explicit mounts, and an ordinary owner retaining original slot rules.
- [ ] Pass selected mounts through the existing validated command and revalidate under the actor lock; preserve full occupied-slot, compatibility, quantity and authority checks.
- [ ] Test rereading saved links, rebuild, transfer, and occupied/invalid mounts; run focused owner and UI tests.

### Task 3: Temporary +1 tuning

**Files:** Existing feat/automation and enchantment owners identified during trace; combat attack owner and focused tests.

- [ ] Test feat activation, 10-minute action, eligible firearm, one non-stacking +1 to attack, cancelled roll, first confirmed shot, world-time boundary, reload and transfer.
- [ ] Integrate with existing enchantment/activity and authenticated mutation routes; store durable timing on the selected weapon and apply bonus without editing authored formulas.
- [ ] Run focused feat, effect and attack tests.

### Task 4: Prone fire

**Files:** Combat attack and MIDI integration owners; focused attack tests.

- [ ] Test native and MIDI attack paths with prone only, another disadvantage, advantage, no property and property from attachment.
- [ ] Remove only the prone source from the roll decision; run focused tests.

### Task 5: Finish

- [ ] Update `docs/function-passport.md` and its profile sections, README if public contract changes, and manifest/versioned forwarder.
- [ ] Run `node --test tests/*.test.mjs`, syntax checks for tracked JS/MJS, JSON parse checks, `git diff --check`, and inspect the complete task diff.
- [ ] Exercise live Foundry scenarios if an authenticated browser is available, document limits, then commit only task files and push `lich_branch`.
