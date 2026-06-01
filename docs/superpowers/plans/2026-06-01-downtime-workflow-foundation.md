# Downtime Workflow Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first playable downtime workflow on top of Rebreya group context: GM grants downtime weeks, players reserve weeks by submitting requests, and the GM reviews, assigns checks, rejects, or completes those requests.

**Architecture:** Add a focused `DowntimeService` that reads and writes only `groupState.groupsById[groupId].downtimeState` through `GroupContextService`. The native dnd5e group actor remains the source of members; downtime balances are keyed by member actor id. The inventory app gains a compact `Простой` tab, while the hero doll tab only shows a summary and opens that tab.

**Tech Stack:** Foundry VTT v13, dnd5e group actors, ApplicationV2/HandlebarsApplicationMixin, JavaScript ES modules, Node `node:test`.

---

## Scope Boundary

This plan intentionally implements the workflow shell, not the full chapter-9 automation tables.

Included:
- downtime balances per native group member;
- GM grant of weeks to all current members or a selected member;
- player request creation with week reservation;
- GM approve, reject, return, complete, and check assignment;
- check result recording as stored data;
- inventory-app UI and hero-doll entry point;
- regression tests for state isolation, permissions, reservations, and UI context.

Deferred:
- automatic roll buttons for assigned checks from the character sheet;
- full chapter-9 outcome automation;
- group-specific migration of calendar/trader/global-event state.

## Data Model

`groupState.groupsById[groupId].downtimeState` is normalized as:

```js
{
  balancesByActorId: {
    [actorId]: {
      availableWeeks: 0,
      reservedWeeks: 0,
      spentWeeks: 0,
      totalGrantedWeeks: 0
    }
  },
  requests: [{
    id: "downtime-1",
    actorId: "actor-id",
    actorName: "Hero",
    actionId: "unique",
    actionLabel: "Уникальная заявка",
    title: "Найти наставника",
    description: "Что игрок хочет сделать",
    weeks: 1,
    status: "pending",
    checks: [],
    result: "",
    createdAt: 0,
    updatedAt: 0,
    submittedByUserId: "user-id",
    reviewedByUserId: ""
  }],
  checks: [],
  history: [],
  counter: 0
}
```

Statuses:
- `pending`: request submitted, weeks are reserved;
- `approved`: GM accepted the plan, weeks are still reserved;
- `returned`: GM returned the request and released reserved weeks;
- `rejected`: GM rejected the request and released reserved weeks;
- `completed`: GM spent reserved weeks into `spentWeeks`.

## File Structure

- Create `scripts/data/downtime-service.js`: state normalization, permission checks, balance updates, request lifecycle, action catalog.
- Modify `scripts/main.js`: instantiate service and expose API methods that refresh open apps.
- Modify `scripts/ui/inventory-app.js`: add `downtime` tab state, prepare downtime context, bind downtime forms/actions.
- Modify `templates/inventory-app.hbs`: add `Простой` tab, GM grant controls, request form, request list.
- Modify `scripts/data/hero-doll-service.js`: include downtime summary in hero doll snapshot.
- Modify `templates/hero-doll-tab.hbs`: show downtime weeks and open the inventory downtime tab.
- Modify `scripts/integrations/dnd5e-sheet-extensions.js`: add click action for `open-downtime`.
- Add `tests/downtime-service.test.mjs`: service lifecycle and permissions.
- Update `tests/inventory-app-context.test.mjs`: context includes downtime tab data.
- Add or update a hero-doll/sheet-extension test only if the existing test harness makes it practical.
- Update `README.md`: document first downtime workflow and API.

## Task 1: Downtime Service And State Lifecycle

**Files:**
- Create: `scripts/data/downtime-service.js`
- Test: `tests/downtime-service.test.mjs`

- [ ] **Step 1: Write failing tests**

Cover:
- snapshot uses current `groupActor.system.members` and ignores stale balance keys for membership display;
- GM grants weeks to all native members;
- player can create a request only for an owned actor in their resolved group;
- request creation reserves weeks;
- reject/return release weeks;
- complete spends reserved weeks;
- GM can assign checks; actor owner or GM can record check result.

- [ ] **Step 2: Implement service**

Public methods:

```js
getActionCatalog()
getSnapshot({ actorId = "" } = {})
grantWeeks({ actorIds = [], weeks = 0, reason = "" } = {})
createRequest({ actorId = "", actionId = "unique", title = "", description = "", weeks = 1 } = {})
setRequestStatus(requestId, status, { result = "" } = {})
setRequestChecks(requestId, checks = [])
recordCheckResult(requestId, checkId, result = {})
```

- [ ] **Step 3: Run tests and commit**

Run:

```powershell
node --test tests/downtime-service.test.mjs
git add scripts/data/downtime-service.js tests/downtime-service.test.mjs
git commit -m "feat: add downtime service"
```

## Task 2: Module API Wiring

**Files:**
- Modify: `scripts/main.js`
- Test: `tests/downtime-service.test.mjs`

- [ ] **Step 1: Instantiate `DowntimeService`**

Import and create `this.downtimeService = new DowntimeService(this);` after group context setup.

- [ ] **Step 2: Expose API methods**

Add:

```js
getDowntimeSnapshot(options = {})
grantDowntimeWeeks(payload = {})
createDowntimeRequest(payload = {})
setDowntimeRequestStatus(requestId, status, options = {})
setDowntimeRequestChecks(requestId, checks = [])
recordDowntimeCheckResult(requestId, checkId, result = {})
getDowntimeActionCatalog()
```

Mutating methods call `refreshOpenApps()`.

- [ ] **Step 3: Run focused tests and commit**

```powershell
node --test tests/downtime-service.test.mjs
git add scripts/main.js tests/downtime-service.test.mjs
git commit -m "feat: expose downtime api"
```

## Task 3: Inventory App Downtime Tab

**Files:**
- Modify: `scripts/ui/inventory-app.js`
- Modify: `templates/inventory-app.hbs`
- Test: `tests/inventory-app-context.test.mjs`

- [ ] **Step 1: Extend app state**

Allow tab `downtime`. Store small form fields on the app instance:

```js
this.downtimeGrantWeeks = 1;
this.downtimeGrantActorId = "all";
this.downtimeRequestActorId = "";
this.downtimeRequestActionId = "unique";
this.downtimeRequestWeeks = 1;
this.downtimeRequestTitle = "";
this.downtimeRequestDescription = "";
```

- [ ] **Step 2: Prepare downtime context**

Call `moduleApi.getDowntimeSnapshot()` in `_prepareContext()`. Provide:
- `downtime.members`;
- `downtime.requests`;
- `downtime.actionOptions`;
- `downtime.canManage`;
- `downtime.canSubmit`;
- selected form values.

- [ ] **Step 3: Render UI**

Add a fifth tab button `Простой`. The tab contains:
- summary cards per member with available/reserved/spent weeks;
- GM grant form: actor select (`Всем участникам` plus members), weeks input, grant button;
- request form: actor select, action select, weeks, title, description, submit button;
- request list with status, checks, result, and GM buttons: approve, return, reject, complete, set checks.

- [ ] **Step 4: Bind actions**

Use existing prompt helpers where possible:
- grant button calls `grantDowntimeWeeks`;
- request button calls `createDowntimeRequest`;
- status buttons call `setDowntimeRequestStatus`;
- checks button accepts simple line format like `Проверка|DC 15|Навык` and calls `setDowntimeRequestChecks`.

- [ ] **Step 5: Run tests and commit**

```powershell
node --test tests/inventory-app-context.test.mjs tests/downtime-service.test.mjs
git add scripts/ui/inventory-app.js templates/inventory-app.hbs tests/inventory-app-context.test.mjs
git commit -m "feat: add downtime inventory tab"
```

## Task 4: Hero Doll Downtime Entry Point

**Files:**
- Modify: `scripts/data/hero-doll-service.js`
- Modify: `templates/hero-doll-tab.hbs`
- Modify: `scripts/integrations/dnd5e-sheet-extensions.js`

- [ ] **Step 1: Add summary to hero doll snapshot**

For character actors, call `moduleApi.getDowntimeSnapshot({ actorId: actor.id })` if available and return:

```js
downtime: {
  actorId,
  availableWeeks,
  reservedWeeks,
  spentWeeks,
  pendingCount,
  hasGroup: true
}
```

If no group context exists, return `hasGroup: false`.

- [ ] **Step 2: Add template block**

In the hero doll header, add a compact button/card showing available and reserved weeks and `data-action="open-downtime"`.

- [ ] **Step 3: Bind click**

In both hero-doll click handlers, add `open-downtime` to call:

```js
await moduleApi.openInventoryApp({ tab: "downtime" });
```

- [ ] **Step 4: Run related tests and commit**

```powershell
node --test tests/*.test.mjs
git add scripts/data/hero-doll-service.js templates/hero-doll-tab.hbs scripts/integrations/dnd5e-sheet-extensions.js
git commit -m "feat: surface downtime on hero doll"
```

## Task 5: Docs, Review, And Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document downtime workflow**

Add:
- group-state storage path;
- GM grant flow;
- player request flow;
- API method list;
- current limitation: assigned checks are stored but not yet launched as character-sheet roll buttons.

- [ ] **Step 2: Run full verification**

```powershell
git fetch origin
git status --short --branch
git merge-base --is-ancestor origin/main HEAD
git diff --check
node --test tests/*.test.mjs
```

- [ ] **Step 3: Commit and push**

```powershell
git add README.md
git commit -m "docs: document downtime workflow"
git push origin lich_branch
```

## Self-Review

- The plan implements the first downtime workflow from the approved design.
- It keeps membership source-of-truth in `groupActor.system.members`.
- It does not automate chapter-9 tables yet; that is an explicit future layer.
- It keeps calendar/trader/global-event grouping out of scope for this increment.
