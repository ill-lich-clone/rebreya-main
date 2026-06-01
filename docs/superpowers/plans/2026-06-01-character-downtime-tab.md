# Character Downtime Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move player downtime work from the hero doll header into a dedicated dnd5e character-sheet tab.

**Architecture:** Keep the GM-facing group downtime workflow in the Rebreya inventory app. Add a small character-facing downtime context service and a new sheet template part registered next to the existing hero doll part. The character tab always acts on `this.actor.id` and never asks the player to open the group inventory.

**Tech Stack:** Foundry VTT v13, dnd5e CharacterActorSheet parts, Handlebars templates, JavaScript ES modules, Node `node:test`.

---

## File Structure

- Create `scripts/data/character-downtime-service.js`: maps `getDowntimeSnapshot({ actorId })` to a single-character view model and submits requests for that actor.
- Create `templates/character-downtime-tab.hbs`: player-facing downtime tab content.
- Modify `scripts/integrations/dnd5e-sheet-extensions.js`: register the `downtime` tab/part, prepare context, bind form submission, keep hero doll handlers focused on equipment.
- Modify `templates/hero-doll-tab.hbs`: remove the downtime button from the hero doll header.
- Modify `scripts/data/hero-doll-service.js`: remove downtime summary from hero doll snapshots.
- Modify `tests/hero-doll-service.test.mjs`: remove old hero-doll downtime tests.
- Add `tests/character-downtime-service.test.mjs`: focused mapper/request tests.
- Update `README.md`: document that players work from a character-sheet downtime tab.

## Task 1: Character Downtime Context Service

- [ ] **Step 1: Write failing tests**

Create `tests/character-downtime-service.test.mjs` covering:
- maps current actor balance, available/reserved/spent weeks, own requests and assigned checks;
- known no-group error returns a warning context instead of throwing;
- unexpected errors still throw;
- `createRequest(actor, payload)` calls `moduleApi.createDowntimeRequest` with `actorId: actor.id`.

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test tests\character-downtime-service.test.mjs
```

Expected: fails because the module does not exist.

- [ ] **Step 3: Implement service**

Add methods:

```js
getActorContext(actor, formState = {})
createRequest(actor, payload = {})
```

The context includes `hasGroup`, `warning`, `balance`, `requests`, `actionOptions`, `form`, `submitDisabled`, and `submitDisabledReason`.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```powershell
node --test tests\character-downtime-service.test.mjs
git add scripts/data/character-downtime-service.js tests/character-downtime-service.test.mjs
git commit -m "feat: add character downtime context"
```

## Task 2: Dedicated Character Sheet Tab

- [ ] **Step 1: Write failing integration tests where practical**

Extend `tests/character-downtime-service.test.mjs` if needed to cover the form payload shape used by the sheet tab. Keep DOM-heavy sheet registration verified by focused code review.

- [ ] **Step 2: Register the tab**

In `scripts/integrations/dnd5e-sheet-extensions.js`:
- add constants for `downtime` tab label/icon/template;
- extend the tab-definition helper to register both `heroDoll` and `downtime`;
- extend part-context patch so `partId === "downtime"` returns `characterDowntime`;
- instantiate/use `moduleApi.characterDowntimeService`.

- [ ] **Step 3: Add template and handlers**

Create `templates/character-downtime-tab.hbs` with:
- balance cards;
- request form for action/weeks/title/description;
- own request list with checks/results;
- no GM controls and no character selector.

Bind `[data-action="downtime-submit"]` in the sheet root to call `characterDowntimeService.createRequest(actor, payload)`, clear local form fields, rerender the sheet, and show a notification.

- [ ] **Step 4: Remove hero doll entry**

Remove downtime summary/button from `templates/hero-doll-tab.hbs`, remove downtime context from `HeroDollService`, and remove `open-downtime` click cases from hero doll handlers.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
node --test tests\hero-doll-service.test.mjs tests\character-downtime-service.test.mjs
git add scripts/integrations/dnd5e-sheet-extensions.js templates/character-downtime-tab.hbs templates/hero-doll-tab.hbs scripts/data/hero-doll-service.js tests/hero-doll-service.test.mjs
git commit -m "feat: add character downtime tab"
```

## Task 3: Docs And Final Verification

- [ ] **Step 1: Update README**

Document that:
- players submit downtime from the dnd5e character sheet `Простой` tab;
- GMs manage the whole group from `Инвентарь -> Простой`;
- hero doll no longer owns downtime UI.

- [ ] **Step 2: Full verification**

Run:

```powershell
git fetch origin
git status --short --branch
git merge-base --is-ancestor origin/main HEAD
git diff --check
node --test tests\*.test.mjs
```

- [ ] **Step 3: Commit docs and push**

```powershell
git add README.md
git commit -m "docs: document character downtime tab"
git push origin lich_branch
```

