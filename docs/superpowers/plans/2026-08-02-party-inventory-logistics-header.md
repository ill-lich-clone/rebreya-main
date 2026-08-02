# Party Inventory Logistics Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared party-inventory header actions and Energy metric with full-width Cargo and Route rows plus equal Food, Water, and fuel-range cards.

**Architecture:** Extend `InventoryService.getTransportSnapshot` with a read-only fuel-range projection calculated from the active concrete transport and its selected group Item. Keep travel-route and zero-state presentation in the existing `InventoryApp` context, then render the approved three-row logistics grid in the existing Handlebars template and bind Food/Water context menus to the existing supply prompt.

**Tech Stack:** Foundry VTT 13 ApplicationV2, D&D5e Actor and embedded Item documents, JavaScript ES modules, Handlebars, scoped CSS, Node.js `node:test`.

## Global Constraints

- Work only on `lich_branch`; never commit or push directly to `main` or `master`.
- Do not introduce settings, flags, socket commands, dependencies, or persistent fields.
- Preserve the current two-block identity/logistics header composition and window dimensions.
- Remove Energy and the warehouse-sheet action only from the shared header; Party-tab energy data remains unchanged.
- Fuel range is informational: `floor(availableQuantity / fuelPerMile)` and never blocks travel.
- Red color applies only to overloaded Cargo values and zero Food, Water, or configured fuel-range values.
- Food and Water mutation remains permission-gated and uses the existing supply prompt on right-click.
- Preserve the detailed Travel progress bar and all Travel-tab controls.

---

## File Map

- `scripts/data/inventory-service.js`: expose fuel configuration on transport profiles and derive the active transport's read-only fuel range.
- `scripts/ui/inventory-app.js`: prepare route and zero-state header data; bind Food/Water context menus.
- `templates/inventory-app.hbs`: render `data-tab` and the approved Cargo, Route, Food, Water, Fuel layout.
- `styles/main.css`: preserve two-block alignment, add route-row layout and value-only danger styling hooks.
- `tests/group-inventory-migration.test.mjs`: protect service-level fuel-range behavior using real `InventoryService` snapshots.
- `tests/inventory-app-context.test.mjs`: protect rendered context, template structure, supply interaction, and CSS layout contracts.

### Task 1: Active Transport Fuel Range Projection

**Files:**
- Modify: `tests/group-inventory-migration.test.mjs`
- Modify: `scripts/data/inventory-service.js:828-916`
- Modify: `scripts/data/inventory-service.js:3860-3960`

**Interfaces:**
- Consumes: concrete transport `instanceState.{fuelItemId,fuelItemName,fuelPerMile}` and the active group Actor's embedded Items.
- Produces: `transportSnapshot.fuelRange` with `{ configured, itemName, miles, isEmpty, reason }`.

- [ ] **Step 1: Write failing service tests for range and fallback states**

Add tests beside the existing `getTransportSnapshot` coverage. Build a managed group with one concrete vehicle member, select it through `transportState.activeTransportId`, and place the selected fuel Item on the group Actor.

```js
test("getTransportSnapshot floors configured party fuel into safe whole miles", async () => {
  const fuel = createItem({ id: "liquid-coal", name: "Жидкий уголь", quantity: 3.87 });
  const vehicle = createActor({
    id: "vehicle-a",
    name: "Фургон",
    type: "vehicle",
    flags: {
      [MODULE_ID]: {
        sourceId: "transport-heavy-wagon",
        transport: {
          instance: true,
          sourceActorUuid: "Compendium.world.transport.Actor.wagon",
          groupActorId: "group-a",
          instanceState: {
            fuelItemId: "liquid-coal",
            fuelItemName: "Жидкий уголь",
            fuelPerMile: 0.125
          }
        }
      }
    }
  });
  const groupActor = createActor({
    id: "group-a",
    type: "group",
    isOwner: true,
    items: [fuel],
    members: [{ actor: vehicle }]
  });
  const snapshot = await createTransportSnapshotFixture({ groupActor, vehicle }).service
    .getTransportSnapshot();

  assert.deepEqual(snapshot.fuelRange, {
    configured: true,
    itemName: "Жидкий уголь",
    miles: 30,
    isEmpty: false,
    reason: ""
  });
});
```

Add literal cases that catch the wrong branch:

```js
assert.deepEqual(emptyFuelSnapshot.fuelRange, {
  configured: true,
  itemName: "Жидкий уголь",
  miles: 0,
  isEmpty: true,
  reason: ""
});
assert.equal(unconfiguredSnapshot.fuelRange.configured, false);
assert.equal(unconfiguredSnapshot.fuelRange.reason, "unconfigured");
assert.equal(noTransportSnapshot.fuelRange.reason, "noTransport");
```

The tests must call the real `InventoryService.getTransportSnapshot`; only Foundry document globals remain fixture doubles.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="fuel|TransportSnapshot" tests/group-inventory-migration.test.mjs
```

Expected: FAIL because `fuelRange` and transport-profile fuel configuration fields are absent.

- [ ] **Step 3: Implement the minimal projection**

Extend `buildTransportProfile` inputs and result with normalized `fuelItemId`, `fuelItemName`, and `fuelPerMile`. Pass the three values from `buildTransportProfileFromActor`'s `instanceState`.

Add one pure helper near the transport formatting helpers:

```js
function buildTransportFuelRange(activeVehicle, groupActor) {
  if (!activeVehicle?.isConcreteInstance) {
    return { configured: false, itemName: "", miles: null, isEmpty: false, reason: "noTransport" };
  }

  const fuelItemId = cleanId(activeVehicle.fuelItemId);
  const fuelPerMile = Math.max(0, toNumber(activeVehicle.fuelPerMile, 0));
  const savedName = cleanId(activeVehicle.fuelItemName);
  if (!fuelItemId || fuelPerMile <= 0) {
    return { configured: false, itemName: savedName, miles: null, isEmpty: false, reason: "unconfigured" };
  }

  const item = groupActor?.items?.get?.(fuelItemId)
    ?? groupActor?.items?.contents?.find?.((entry) => entry?.id === fuelItemId)
    ?? null;
  const available = item ? getRawQuantity(item.toObject?.() ?? item) : 0;
  const miles = Math.max(0, Math.floor(available / fuelPerMile));
  return {
    configured: true,
    itemName: cleanId(item?.name) || savedName,
    miles,
    isEmpty: miles === 0,
    reason: ""
  };
}
```

Return `fuelRange: buildTransportFuelRange(activeVehicle, groupContext?.groupActor)` from both the populated snapshot and the empty snapshot contract.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="fuel|TransportSnapshot" tests/group-inventory-migration.test.mjs tests/transport-fuel-service.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 5: Commit the fuel projection**

```powershell
git add -- scripts/data/inventory-service.js tests/group-inventory-migration.test.mjs
git commit -m "feat: expose party transport fuel range"
```

### Task 2: Header Context for Cargo, Route, and Resource States

**Files:**
- Modify: `tests/inventory-app-context.test.mjs`
- Modify: `scripts/ui/inventory-app.js:1420-1458`
- Modify: `scripts/ui/inventory-app.js:3535-3600`

**Interfaces:**
- Consumes: `travel.plan`, `travel.progress.remainingTravelDays`, inventory summary quantities, `partySnapshot.freeCapacityLb`, and Task 1's `transport.fuelRange`.
- Produces: `travel.headerRoute`, `party.dashboard.weight.isOverloaded`, `party.dashboard.food.isEmpty`, and `party.dashboard.water.isEmpty`.

- [ ] **Step 1: Write failing context tests**

Extend the existing Travel context test with hand-derived header values:

```js
assert.deepEqual(context.travel.headerRoute, {
  available: true,
  routeLabel: "Лиара’Кен → Странбу",
  remainingDaysLabel: "20 дн."
});
```

Add a no-route fixture and assert:

```js
assert.deepEqual(context.travel.headerRoute, {
  available: false,
  routeLabel: "Маршрут не выбран",
  remainingDaysLabel: "—"
});
```

Add one inventory context fixture with `foodLb: 0`, `waterGal: 0`, and negative `freeCapacityLb`, then assert all three literal booleans are true. Add a positive fixture to prove the booleans are not severity aliases.

```js
assert.equal(context.party.dashboard.weight.isOverloaded, true);
assert.equal(context.party.dashboard.food.isEmpty, true);
assert.equal(context.party.dashboard.water.isEmpty, true);
```

- [ ] **Step 2: Run the context tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="header route|compact header|allows travel" tests/inventory-app-context.test.mjs
```

Expected: FAIL because the new header-route and zero-state fields do not exist.

- [ ] **Step 3: Add the minimal prepared context**

Inside `prepareTravelContext`, add:

```js
const headerRoute = plan?.available
  ? {
      available: true,
      routeLabel: `${cleanText(plan.originName)} → ${cleanText(plan.destinationName)}`,
      remainingDaysLabel: `${formatTravelDayNumber(progress.remainingTravelDays)} дн.`
    }
  : {
      available: false,
      routeLabel: "Маршрут не выбран",
      remainingDaysLabel: "—"
    };
```

Return `headerRoute` with the prepared Travel context. Add the three explicit booleans to the existing dashboard entries:

```js
weight: { isOverloaded: freeCapacityLb < 0, ... },
food: { isEmpty: toNumber(inventorySnapshot.summary.foodLb, 0) <= 0, ... },
water: { isEmpty: toNumber(inventorySnapshot.summary.waterGal, 0) <= 0, ... }
```

- [ ] **Step 4: Run focused context tests and verify GREEN**

Run:

```powershell
node --test --test-name-pattern="header route|compact header|allows travel" tests/inventory-app-context.test.mjs
```

Expected: PASS with zero failures.

- [ ] **Step 5: Commit prepared header data**

```powershell
git add -- scripts/ui/inventory-app.js tests/inventory-app-context.test.mjs
git commit -m "feat: prepare inventory logistics header state"
```

### Task 3: Render and Bind the Logistics Header

**Files:**
- Modify: `tests/inventory-app-context.test.mjs`
- Modify: `templates/inventory-app.hbs:6-175`
- Modify: `scripts/ui/inventory-app.js:5802-5860`
- Modify: `styles/main.css:4784-5000`

**Interfaces:**
- Consumes: Task 1's `transport.fuelRange`, Task 2's route and zero-state fields, existing `#promptSupply(resourceKey)`, and `canManage`.
- Produces: one shared logistics header with permission-gated `data-action="edit-supply"` context-menu targets.

- [ ] **Step 1: Write failing template and CSS behavior tests**

Replace the obsolete action-button assertions in the compact-header test. Assert order using literal indices and protect the absence of removed controls:

```js
assert.match(template, /data-tab="\{\{activeTab\}\}"/u);
assert.doesNotMatch(template, /data-action="add-food"|data-action="add-water"/u);
assert.doesNotMatch(template, /<span>Энергия<\/span>/u);
assert.doesNotMatch(template, /data-action="open-actor-sheet"[^>]*title="Открыть лист склада"/u);

const cargoIndex = template.indexOf('class="rm-inventory-book__cargo');
const routeIndex = template.indexOf('class="rm-inventory-book__route');
const resourcesIndex = template.indexOf('class="rm-inventory-book__supply-row"');
assert.ok(cargoIndex >= 0 && cargoIndex < routeIndex && routeIndex < resourcesIndex);
assert.match(template, /travel\.headerRoute\.routeLabel/u);
assert.match(template, /travel\.headerRoute\.remainingDaysLabel/u);
assert.match(template, /transport\.fuelRange\.miles/u);
```

Assert the danger class is attached to each `strong` value rather than an article. Assert CSS keeps Cargo and Route full width and the resource row at three equal tracks.

- [ ] **Step 2: Write the failing right-click interaction test**

Adapt the existing supply-dialog harness to return Food and Water cards from `querySelectorAll("[data-action='edit-supply']")`. Dispatch `contextmenu` with spies for `preventDefault` and `stopPropagation`, then submit each existing dialog and assert the real module API receives the same supply mutations as before.

```js
await foodCard.listeners.contextmenu[0]({
  currentTarget: foodCard,
  preventDefault() { prevented += 1; },
  stopPropagation() {}
});
assert.equal(prevented, 1);
assert.equal(dialogs.at(-1).config.title, "Изменить запас еды");
```

Add a read-only root without `data-action="edit-supply"` cards and assert no supply handler can be dispatched.

- [ ] **Step 3: Run UI tests and verify RED**

Run:

```powershell
node --test --test-name-pattern="compact header|supply prompt|right-click" tests/inventory-app-context.test.mjs
```

Expected: FAIL on the old action row, missing route/fuel markup, and missing context-menu listeners.

- [ ] **Step 4: Replace the template header controls**

Add `data-tab="{{activeTab}}"` to the scrollable book page. Remove `.rm-inventory-book__actions` from the header. Keep Cargo first, insert a route panel, and render the three resources:

```hbs
<article class="rm-inventory-book__route rm-inventory-book__panel">
  <span class="rm-inventory-book__route-label">{{travel.headerRoute.routeLabel}}</span>
  <strong>{{travel.headerRoute.remainingDaysLabel}}</strong>
</article>

<article class="rm-inventory-book__supply rm-inventory-book__panel"
  {{#if canManage}}data-action="edit-supply" data-resource-key="food" title="ПКМ: изменить запас еды"{{/if}}>
  <span>Еда</span>
  <strong class="{{#if party.dashboard.food.isEmpty}}rm-negative{{/if}}">{{rmNum summary.foodLb}} фнт.</strong>
  <small>{{party.dashboard.food.daysLabel}}</small>
</article>
```

Mirror the Water card with `data-resource-key="water"`. Render Fuel from `transport.fuelRange`: configured values show `<miles> миль`; unavailable values show an em dash and the reason label from the approved design. Apply `rm-negative` only when `transport.fuelRange.isEmpty` is true. Apply the same value-only class to Cargo when `party.dashboard.weight.isOverloaded` is true.

- [ ] **Step 5: Replace click bindings with permission-gated context menus**

Delete the two `add-food` and `add-water` click bindings. Bind the shared action:

```js
element.querySelectorAll("[data-action='edit-supply']").forEach((card) => {
  card.addEventListener("contextmenu", async (event) => {
    if (!this.canManage) return;
    event.preventDefault();
    event.stopPropagation();
    await this.#promptSupply(event.currentTarget.dataset.resourceKey === "water" ? "water" : "food");
  }, listenerOptions);
});
```

Keep the existing prompt parsing, signed-delta behavior, refresh, notifications, and z-index handling unchanged.

- [ ] **Step 6: Add the scoped layout styles**

Remove action-row-only sizing that has no remaining template consumer. Keep `.rm-inventory-book__controls` at the current width and make the summary the three-row grid. Add:

```css
.rebreya-inventory-app .rm-inventory-book__route {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 10px;
  padding: 7px 9px;
}

.rebreya-inventory-app .rm-inventory-book__route-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rebreya-inventory-app [data-action="edit-supply"] {
  cursor: context-menu;
}
```

Preserve `grid-template-columns: repeat(3, minmax(0, 1fr))` for the resource row. Reuse the existing `.rm-negative` value color; do not add danger backgrounds.

- [ ] **Step 7: Run focused UI tests and verify GREEN**

Run:

```powershell
node --test tests/inventory-app-context.test.mjs tests/group-inventory-migration.test.mjs tests/transport-fuel-service.test.mjs tests/travel-service.test.mjs
node --check scripts/ui/inventory-app.js
node --check scripts/data/inventory-service.js
```

Expected: all tests and syntax checks pass.

- [ ] **Step 8: Commit the rendered header**

```powershell
git add -- templates/inventory-app.hbs scripts/ui/inventory-app.js styles/main.css tests/inventory-app-context.test.mjs
git commit -m "feat: streamline party inventory logistics header"
```

### Task 4: Rendered QA and Publication

**Files:**
- Verify only; do not commit screenshots or temporary scripts.

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: verified branch state and pushed `lich_branch`.

- [ ] **Step 1: Run the complete automated suite**

```powershell
node --test tests/*.test.mjs
git diff --check origin/main...HEAD
```

Expected: zero failing tests and no whitespace errors.

- [ ] **Step 2: Validate the rendered Foundry flow**

The flow under test is: open party inventory → inspect shared header on Inventory and Travel tabs → right-click Food and Water → verify the existing quantity dialog and refreshed values.

Use the available in-app Browser skill first. Verify:

- the intended Foundry page and party inventory window are visible;
- the page has `data-tab` matching the selected book tab;
- Cargo and Route occupy full rows and Food/Water/Fuel occupy three equal columns;
- active-route city names and remaining days render without overlap;
- positive fuel stock displays floored whole miles;
- zero Food, Water, Fuel and overloaded Cargo values are red without red panels;
- no relevant console warnings or errors occur;
- the layout remains aligned at the normal desktop viewport and one narrower practical viewport.

- [ ] **Step 3: Inspect the final diff and repository state**

```powershell
git status --short --branch
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
```

Confirm no screenshots, temporary scripts, unrelated user files, or unstaged implementation changes remain.

- [ ] **Step 4: Push without force**

```powershell
git push origin lich_branch
```

Expected: a normal fast-forward push succeeds. Never use `--force` or `--force-with-lease` without separate permission.
