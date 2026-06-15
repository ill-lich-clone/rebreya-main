# Groups Card Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cramped shared inventory rows in the groups window with responsive state-aware group cards.

**Architecture:** Keep `GroupsApp` actions and module APIs unchanged. Add a small display contract to each mapped group, render dedicated card markup in `groups-app.hbs`, and isolate the layout under `.rebreya-groups-app` CSS selectors.

**Tech Stack:** Foundry VTT ApplicationV2, Handlebars, CSS, Node test runner.

---

### Task 1: Lock The Card Contract With Tests

**Files:**
- Create: `tests/groups-app.test.mjs`
- Test: `templates/groups-app.hbs`
- Test: `scripts/ui/groups-app.js`

- [ ] **Step 1: Write the failing tests**

Add tests that assert the template contains `.rm-groups-grid`, `.rm-group-card`, conditional `register-group` and `set-active-group` actions, a `Текущая группа` indicator, and a legacy action inside `.rm-group-card__menu`. Import `GroupsApp` with Foundry stubs and verify `_prepareContext()` maps active, registered inactive, and unregistered actors correctly.

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/groups-app.test.mjs`

Expected: FAIL because the dedicated card markup and display fields do not exist.

### Task 2: Implement State-Aware Cards

**Files:**
- Modify: `scripts/ui/groups-app.js`
- Modify: `templates/groups-app.hbs`

- [ ] **Step 1: Add display fields to `mapGroupActor`**

Return state values without changing action permissions:

```js
state: active ? "active" : groupState ? "registered" : "unregistered",
stateClass: active ? "is-active" : groupState ? "is-registered" : "is-unregistered",
showCurrentGroup: active,
showSetActive: Boolean(groupState) && !active,
showRegister: !groupState
```

- [ ] **Step 2: Replace shared inventory-row markup**

Render `.rm-groups-grid` and `.rm-group-card` elements. Keep `open-sheet` visible, render exactly one state-specific primary control, and place `merge-legacy-inventory` inside a `<details>` ellipsis menu.

- [ ] **Step 3: Run the focused test**

Run: `node --test tests/groups-app.test.mjs`

Expected: PASS.

### Task 3: Add Isolated Responsive Styling

**Files:**
- Modify: `styles/main.css`
- Modify: `tests/groups-app.test.mjs`

- [ ] **Step 1: Extend the failing test with CSS assertions**

Assert that `.rebreya-groups-app .rm-groups-grid` uses two responsive columns, `.rm-group-card` has dedicated layout, and the narrow media query collapses the grid to one column.

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/groups-app.test.mjs`

Expected: FAIL because the dedicated CSS is absent.

- [ ] **Step 3: Add the scoped CSS**

Use the approved graphite/brass tokens, stable card dimensions, status badges, a two-column facts grid, aligned footer actions, and a one-column breakpoint. Do not modify `.rm-compact-item`.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test tests/groups-app.test.mjs`

Run: `node --test tests/*.test.mjs`

Expected: all tests pass.

### Task 4: Release And Verify

**Files:**
- Modify: `module.json`
- Modify: `scripts/main.js`
- Create: next versioned `scripts/main-<version>.js`

- [ ] **Step 1: Bump the module patch version and cache-busting imports**

Update the manifest entrypoint and copy `scripts/main.js` to the matching versioned entrypoint.

- [ ] **Step 2: Verify repository output**

Run: `git diff --check`

Run: `node --test tests/*.test.mjs`

Inspect: `git diff` and `git status --short`.

- [ ] **Step 3: Commit and push**

Stage only implementation, tests, plan, manifest, and versioned entrypoint. Commit with `Redesign groups window as card grid` and push `lich_branch` without force.
