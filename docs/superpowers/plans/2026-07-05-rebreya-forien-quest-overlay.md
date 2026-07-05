# Rebreya Forien Quest Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Rebreya-owned overlay for Forien's Quest Log that scopes quests by active Rebreya group, imports quests as subquests, and adds group-specific quest requirements plus unlock rewards.

**Architecture:** Keep Forien's module untouched. Store Rebreya metadata on FQL JournalEntry flags and group-specific unlock state in `GroupContextService` registry data. Patch FQL only at runtime through Rebreya hooks and public/internal ESM imports.

**Tech Stack:** Foundry VTT v13 ESM modules, Forien's Quest Log v0.9.0, Node `node:test`.

---

### Task 1: Quest State And Service

**Files:**
- Modify: `scripts/data/group-context-service.js`
- Create: `scripts/data/quest-log-service.js`
- Test: `tests/quest-log-service.test.mjs`

- [ ] Write failing tests for normalized `questState`, group assignment metadata, requirements, and unlock rewards.
- [ ] Run `node --test tests/quest-log-service.test.mjs` and confirm the service import fails or behavior fails.
- [ ] Implement `RebreyaQuestLogService` with group assignment, requirement evaluation, import-as-subquest, and unlock application.
- [ ] Run `node --test tests/quest-log-service.test.mjs` and confirm pass.

### Task 2: FQL Runtime Integration

**Files:**
- Create: `scripts/integrations/forien-quest-log.js`
- Modify: `scripts/main.js`
- Modify: `scripts/main-1.4.91.js`

- [ ] Add tests for main API exposure if needed.
- [ ] Register the integration during Foundry ready.
- [ ] Runtime-patch FQL `QuestDB.sortCollect` so GM/player journal views are scoped to the current Rebreya group when a group context exists.
- [ ] Register hooks to auto-assign newly created FQL quests to the active/current group and block activation of quests whose requirements are locked.

### Task 3: Quest Preview Controls

**Files:**
- Create: `templates/forien-quest-overlay.hbs`
- Modify: `styles/main.css`
- Test: `tests/quest-log-service.test.mjs`

- [ ] Inject a Rebreya management panel into FQL QuestPreview.
- [ ] Add controls to assign/import quests, add quest requirements, add unlock rewards, and apply unlock rewards.
- [ ] Add restrained styles matching existing Rebreya panels.
- [ ] Run focused tests and a syntax import check.
