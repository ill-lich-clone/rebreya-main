# Combat turn overhead follow-up Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans.

**Goal:** Reduce repeated work on combat transitions without changing mechanics.
**Architecture:** Preserve canonical services; invalidate world-effect lookup on relevant document lifecycle events, retain live combatant checks, and skip only demonstrably empty work. Keep Foundry 13 and 14 event behavior.
**Tech Stack:** Foundry VTT 13/14, dnd5e, JavaScript, Node test runner.
**Spec:** docs/superpowers/specs/2026-11-14-combat-turn-overhead-followup-design.md

## Global Constraints
- Preserve saved effects and actor identities across scene changes, actor/effect updates, reload, and failure retry.
- Preserve active-GM authority, previous turns, grouped combat, token visibility and all effect semantics.
- Bump module version and forwarder; update function passport.

## Review Focus
- Pre-existing and externally created/changed/deleted effects; source feature removed.
- Synthetic and linked combatants, composition changes, and world actor deletion.
- Failed effect deletion and repeated transitions.
- Existing aura from a prior state, scene changes, and disabled Sequencer.
- Foundry 13 vs 14, backward movement and grouped phases.

### Task 1: Evidence and behavior
- [ ] Add focused regression tests proving preserved outcomes and reduced unnecessary work; observe failures before fixes.
- [ ] Implement minimum safe changes at existing owners; rerun focused tests.

### Task 2: Release and verification
- [ ] Update passport and cache-busting module version.
- [ ] Run full runtime tests, syntax checks, JSON checks and review diff.
- [ ] Commit only task files and push lich_branch without force.
