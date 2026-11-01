# NPC Sheet and CPR Compatibility Implementation Plan

> Use superpowers:executing-plans with regression tests before production changes.

**Goal:** Stop inappropriate NPC template prompts and unrelated actor sheet refreshes, and prevent the CPR legendary-action empty-list failure while preserving valid actions.
**Architecture:** Keep magic equipment in its current integration; scope combat status sheet refresh without altering other applications; use a guarded CPR hook compatibility integration only when the vulnerable handler can be identified safely.
**Tech Stack:** Foundry VTT 13, dnd5e, JavaScript, Node test runner.
**Specs:** docs/superpowers/specs/2026-11-01-npc-sheet-refresh-design.md; docs/superpowers/specs/2026-11-01-cpr-legendary-actions-design.md.

## Global constraints
Preserve creation prompts, character fallback, permission and socket contracts, resources and valid legendary actions; no CPR file edits; bump module version and forwarder; update passport; check complete suite and Git before push.

## Review focus
NPC and character ownership, new and existing items, status socket/local paths, several combatants including mixed empty/valid actions, module absence/version changes and setting toggle, hook registration order and duplicate registration.

### Task 1: NPC prompts
- [ ] Add failing regression for NPC sheet rendering while retaining createItem behavior and character fallback.
- [ ] Implement minimal actor-type guard; run focused test.

### Task 2: status refresh
- [ ] Add failing tests for other actors remaining untouched on local and GM socket status routes, preserving non-sheet views.
- [ ] Scope only the status paths and run focused tests.

### Task 3: CPR compatibility
- [ ] Identify the exact hook and safe removal/registration lifecycle, including dynamic setting changes.
- [ ] Add failing tests for empty, valid, mixed candidates, absence, incompatible module and registration lifecycle.
- [ ] Implement guarded integration and run focused tests; if safe identification cannot be established do not install a global patch.

### Task 4: Release and verify
- [ ] Update version, imports, forwarder and passport; run full tests, JS syntax and JSON validation, review diff and requirements.
- [ ] Commit and push lich_branch.
