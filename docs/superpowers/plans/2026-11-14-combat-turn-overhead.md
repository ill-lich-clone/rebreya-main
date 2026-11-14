# Combat Turn Overhead Implementation Plan

> Use superpowers:executing-plans and TDD. Spec: [combat turn overhead](../specs/2026-11-14-combat-turn-overhead-design.md).

1. Add failing tests in the existing weapon upgrade and grouped combat suites. Drive a five-member ordinary turn with 100 items and 1000 lights, dispatch the Actor update listener, and count full syncs, copies and light inspections. Exercise five participants and 18 marked packets with server metadata through the native update methods. Cover genuine actor updates and mixed Combat updates.
2. In `CombatAttackService.handleWeaponModTurnChange`, keep turn movement initialization, clear expired aim with the existing sync-suppression option, and remove only the aim movement effects of affected hosts under the existing upgrade queue. Pass update data into `ItemUpgradeAutomationService.handleChanged` to ignore Actor updates consisting solely of turn movement and reaction flags. Preserve item and effect invalidation.
3. In `isGroupedCombatProgressUpdate`, allow top-level Foundry stats metadata, retaining existing conditions on flags, position, and caller options. Verify before/after and the old ordinary paths.
4. Update the function passports and runtime cache keys, release 1.5.79, run focused and full checks, review, commit and push `lich_branch`.
