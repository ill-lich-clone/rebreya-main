# Travel Speed Modifier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted group travel speed multiplier with `0.25`, `0.5`, `1`, `2`, and `4` choices that all clients see and all travel calculations use.

**Architecture:** Extend the normalized group `travelState` with `speedMultiplier`, then derive an effective network speed before building plans or advancing progress. Expose one service/module mutation and bind five compact buttons in the existing InventoryApp travel panel; reuse the existing group-state replacement command and app refresh path for synchronization.

**Tech Stack:** Foundry VTT Application V2, JavaScript ES modules, Handlebars, CSS, Node.js test runner.

## Global Constraints

- Store `speedMultiplier` inside the active group's `travelState`.
- Accept only `0.25`, `0.5`, `1`, `2`, and `4`; legacy or malformed stored values normalize to `1`.
- Preserve the multiplier when changing route and reset it to `1` when clearing the route.
- Apply the effective speed to duration, progress, calendar applied hours, and the displayed speed; fuel remains based on actual miles.
- Show all five controls to every user and disable mutation for users without route-management rights.

---

### Task 1: Normalize and apply the group speed multiplier

**Files:**
- Modify: `scripts/data/travel-service.js:578-984`
- Test: `tests/travel-service.test.mjs`

**Interfaces:**
- Produces: `normalizeTravelState(value).speedMultiplier: number`.
- Produces: `buildTravelSnapshot(...).speedMultiplierOptions: Array<{value:number,label:string,selected:boolean}>`.
- Produces: plans whose `speedMph` is the effective speed.

- [ ] **Step 1: Write failing normalization and calculation tests**

Add assertions that `normalizeTravelState({}).speedMultiplier === 1`, valid values are retained, and `3` normalizes to `1`. Add a route snapshot with base speed `8` and multiplier `0.5`; assert `snapshot.speedMph === 4`, `plan.totalHours` doubles, and exactly the `0.5` option is selected.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test --test-name-pattern="speed multiplier" tests/travel-service.test.mjs`

Expected: FAIL because normalized state and snapshot do not expose or apply `speedMultiplier`.

- [ ] **Step 3: Implement the normalized state and effective network**

Add an immutable allowed-value list and a normalizer:

```js
const TRAVEL_SPEED_MULTIPLIERS = Object.freeze([0.25, 0.5, 1, 2, 4]);

function normalizeTravelSpeedMultiplier(value) {
  const numericValue = Number(value);
  return TRAVEL_SPEED_MULTIPLIERS.includes(numericValue) ? numericValue : 1;
}
```

Include the field in `normalizeTravelState`. Add a focused `applyTravelSpeedMultiplier(rawNetwork, rawState)` helper that returns a normalized network whose `speedMph` is multiplied exactly once. Use it inside `buildTravelSnapshot` and `TravelService.advanceHours`, so plan duration and committed progress share the same effective speed. Display the provider label unchanged at `1×`; otherwise display the effective numeric speed. Expose button options with labels `¼×`, `½×`, `1×`, `2×`, `4×`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test --test-name-pattern="speed multiplier" tests/travel-service.test.mjs`

Expected: PASS.

### Task 2: Persist multiplier changes through the existing group command

**Files:**
- Modify: `scripts/data/travel-service.js:1060-1225`
- Modify: `scripts/main.js:4233-4310`
- Test: `tests/travel-service.test.mjs`
- Test: `tests/travel-map-integration.test.mjs`

**Interfaces:**
- Produces: `TravelService.setSpeedMultiplier(speedMultiplier): Promise<TravelSnapshot>`.
- Produces: `RebreyaMainModule.setTravelSpeedMultiplier(speedMultiplier): Promise<TravelSnapshot>`.
- Consumes: the existing `GROUP_TRAVEL_REPLACE_STATE_COMMAND` and `refreshOpenApps()` synchronization.

- [ ] **Step 1: Write failing service and module API tests**

For the service, use a managed group fixture and assert `setSpeedMultiplier(2)` preserves route/progress, writes `speedMultiplier: 2`, returns effective speed, and rejects `3`. For the module wrapper, stub the travel service and assert it delegates once and refreshes open applications once.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test --test-name-pattern="travel speed multiplier" tests/travel-service.test.mjs tests/travel-map-integration.test.mjs`

Expected: FAIL because both methods are missing.

- [ ] **Step 3: Add minimal mutation methods**

Implement `TravelService.setSpeedMultiplier` by validating the requested value, copying the current normalized state, writing it with `#writeGroupTravelState`, resolving the effective network, and returning `buildTravelSnapshot`. Add `RebreyaMainModule.setTravelSpeedMultiplier` that delegates, calls `refreshOpenApps()`, and returns the snapshot.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test --test-name-pattern="travel speed multiplier" tests/travel-service.test.mjs tests/travel-map-integration.test.mjs`

Expected: PASS.

### Task 3: Render and bind the five-button speed row

**Files:**
- Modify: `templates/inventory-app.hbs:608-636`
- Modify: `scripts/ui/inventory-app.js:5746-5785`
- Modify: `styles/main.css:5856-5880`
- Test: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Consumes: `travel.speedMultiplierOptions` and `travel.canSelectRoute`.
- Consumes: `moduleApi.setTravelSpeedMultiplier(number)`.

- [ ] **Step 1: Write failing template and interaction tests**

Assert the template contains a separate `.rm-travel-speed-row` with five `data-action="travel-speed-multiplier"` buttons, binds numeric `data-multiplier` values, marks the selected button, and disables it without management rights. In the DOM fixture, click the `2` button and assert one `setTravelSpeedMultiplier(2)` call.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test --test-name-pattern="travel speed multiplier" tests/inventory-app-context.test.mjs`

Expected: FAIL because the controls and listener are absent.

- [ ] **Step 3: Add template, binding, and compact styles**

Render the row after `.rm-travel-actions`:

```hbs
<div class="rm-travel-speed-row" role="group" aria-label="Модификатор скорости">
  <span>Скорость</span>
  <div class="rm-travel-speed-options">
    {{#each travel.speedMultiplierOptions}}
      <button type="button" class="rm-button rm-button--small rm-travel-speed-option {{#if selected}}is-active{{/if}}"
        data-action="travel-speed-multiplier" data-multiplier="{{value}}"
        aria-pressed="{{#if selected}}true{{else}}false{{/if}}" {{#unless ../travel.canSelectRoute}}disabled{{/unless}}>{{label}}</button>
    {{/each}}
  </div>
</div>
```

Bind click events, convert `dataset.multiplier` to a number, call `setTravelSpeedMultiplier`, report errors through the existing feedback/notification pattern, and let the module-level refresh synchronize every open app. Style the row as one horizontal, wrapping control strip and use the gold active treatment already present in the module.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test --test-name-pattern="travel speed multiplier" tests/inventory-app-context.test.mjs`

Expected: PASS.

### Task 4: Regression verification and delivery

**Files:**
- Verify all modified files above.

**Interfaces:**
- Produces: one reviewed feature commit on `lich_branch`, pushed without force.

- [ ] **Step 1: Run focused suites**

Run: `node --test tests/travel-service.test.mjs tests/travel-map-integration.test.mjs tests/inventory-app-context.test.mjs`

Expected: all tests pass.

- [ ] **Step 2: Run the full project suite and diff checks**

Run: `node --test tests/*.test.mjs`

Run: `git diff --check`

Expected: all tests pass and diff check exits `0`.

- [ ] **Step 3: Review and commit only feature files**

```bash
git status --short
git diff
git add scripts/data/travel-service.js scripts/main.js scripts/ui/inventory-app.js templates/inventory-app.hbs styles/main.css tests/travel-service.test.mjs tests/travel-map-integration.test.mjs tests/inventory-app-context.test.mjs docs/superpowers/plans/2026-08-02-travel-speed-modifier.md
git commit -m "feat: add shared travel speed modifiers"
```

- [ ] **Step 4: Push without force and verify remote state**

```bash
git push origin lich_branch
git status --short
git rev-parse HEAD
git rev-parse origin/lich_branch
```

Expected: clean working tree and identical hashes.
