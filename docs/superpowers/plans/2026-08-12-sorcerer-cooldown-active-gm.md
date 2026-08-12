# Sorcerer Virtual-Slot Cooldown Active-GM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reliably decrement virtual-slot cooldowns exactly once at the cooldown owner's turn start when combat is advanced by any client.

**Architecture:** A single post-update `combatTurnChange` hook validates a strictly forward transition and routes to the existing Sorcerer service only from the active GM client. The service owns cooldown persistence and best-effort chat-card refresh.

**Tech Stack:** Foundry VTT 13 hooks, ES modules, Node test runner.

## Global Constraints

- Use `isActiveGmClient` from the established Foundry infrastructure; do not create a socket route.
- Do not modify BG3 HUD or add a UI-specific hook.
- Preserve Actor flag persistence before non-fatal chat-card refresh.
- Update section 17 of `docs/function-passport.md` with method contract, data flow, constraints, and focused tests.
- Work only on `lich_branch`; stage explicit task files only.

---

### Task 1: Regression tests for the authoritative post-update route

**Files:**
- Modify: `tests/sorcerer-automation-service.test.mjs`

**Interfaces:**
- Consumes: `registerCombatHooks({ sorcererAutomationService })`, `SorcererAutomationService.handleCombatTurnChange(combat, current, { direction: 1 })`.
- Produces: executable regression coverage for lifecycle authority and transition direction.

- [x] Add focused tests that simulate a non-owner player invoking End Turn and an active GM receiving the same post-update turn-change event; assert only the GM persists the Actor cooldown.
- [x] Add a first-in-initiative new-round test and assert one decrement when current state becomes `{ round: 2, turn: 0 }`.
- [x] Add a no-double-tick test that proves the Sorcerer service is no longer registered under `combatTurn` or `combatRound`.
- [x] Add rewind and no-active-GM tests; assert neither mutates the Actor flag.
- [x] Run: `node --test tests/sorcerer-automation-service.test.mjs`; confirmed RED at 97/100 because no Sorcerer `combatTurnChange` route existed.

### Task 2: Replace the pre-update route with active-GM post-update handling

**Files:**
- Modify: `scripts/combat/hooks.js`

**Interfaces:**
- Consumes: Foundry `combatTurnChange(combat, prior, current)`, `isActiveGmClient(game)`, and the existing `handleCombatTurnChange(combat, updateData, updateOptions)` service API.
- Produces: one active-GM-only call to `handleCombatTurnChange(combat, current, { direction: 1 })` for a forward transition.

- [x] Implement the smallest hook change: remove the two pre-update cooldown registrations and add one active-GM-gated `combatTurnChange` registration.
- [x] Use the hook's prior/current records to reject equal and backward transitions before calling the existing service; preserve cooldown arithmetic and card-update isolation.
- [x] Run: `node --test tests/sorcerer-automation-service.test.mjs`; 101/101 passed.

### Task 3: Document and verify

**Files:**
- Modify: `docs/function-passport.md`

**Interfaces:**
- Documents: Sorcerer cooldown lifecycle method and active-GM post-update data flow.

- [x] Update section 17 with the existing signature, owner, post-update active-GM flow, no-double-tick/rewind constraints, and focused test file.
- [x] Run focused tests, then: `node --test tests/*.test.mjs`, `git diff --check`, JavaScript syntax checks, and JSON parsing checks from `AGENTS.md`.
- [ ] Inspect `git diff --stat`, `git diff`, stage only these five files, commit, and push `lich_branch`.
