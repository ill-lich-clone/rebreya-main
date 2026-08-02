# Party Transport Fuel Item Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vehicle-sheet warehouse selector with an Item drop target and full openable fuel card in the party inventory Transport tab while keeping all fuel quantity exclusively in party inventory Item stacks.

**Architecture:** A new pure `transport-fuel-item.js` module owns selector creation, inventory matching, and aggregate snapshots. The transport instance service stores only a per-vehicle Item identity selector, while the existing fuel service consumes matching party inventory stacks and the inventory app renders and opens the resolved Item card.

**Tech Stack:** Foundry VTT 13, dnd5e 5.2.5, JavaScript ES modules, Handlebars, CSS, Node.js built-in test runner.

## Global Constraints

- Work only on `lich_branch`; fetch `origin` before edits and never force-push.
- A fuel selection must never create, copy, move, delete, or change the quantity of the dropped Item.
- Fuel quantity exists only in party inventory Item `system.quantity` values.
- Each concrete Rebreya transport has exactly one active fuel selector.
- The Transport tab must render a full Item-style card that can open a real warehouse Item or the selected source Item.
- Fuel consumption remains soft/nonblocking when stock is insufficient.
- The obsolete fuel form on the vehicle Actor sheet must be removed completely.
- Preserve unrelated user changes and stage only files listed by this plan.

---

### Task 1: Pure fuel selector and inventory matching

**Files:**
- Create: `scripts/data/transport-fuel-item.js`
- Create: `tests/transport-fuel-item.test.mjs`

**Interfaces:**
- Consumes: Foundry Item-like documents or plain Item data with `id`, `uuid`, `name`, `type`, `img`, `flags`, and `system.quantity`.
- Produces: `buildTransportFuelSelector(item)`, `normalizeTransportFuelSelector(value)`, `matchesTransportFuelSelector(item, selector)`, and `buildTransportFuelInventorySnapshot(items, selector)`.
- `buildTransportFuelInventorySnapshot` returns `{ configured, selector, stacks, quantity, primaryItemId, primaryItemUuid, openUuid, name, img, type, isEmpty }`.

- [ ] **Step 1: Write failing selector normalization tests**

```js
test("fuel selector stores identity and presentation but never quantity", () => {
  const selector = buildTransportFuelSelector({
    uuid: "Compendium.world.goods.Item.coal",
    name: "Жидкий уголь",
    type: "loot",
    img: "icons/coal.webp",
    system: { quantity: 40 },
    flags: { "rebreya-main": { sourceType: "good", sourceId: "liquid-coal" } }
  });

  assert.deepEqual(selector, {
    uuid: "Compendium.world.goods.Item.coal",
    sourceUuid: "",
    sourceType: "good",
    sourceId: "liquid-coal",
    type: "loot",
    normalizedName: "жидкий уголь",
    name: "Жидкий уголь",
    img: "icons/coal.webp"
  });
  assert.equal("quantity" in selector, false);
});
```

- [ ] **Step 2: Write failing inventory matching tests**

```js
test("fuel inventory snapshot aggregates every matching warehouse stack", () => {
  const selector = buildTransportFuelSelector(compendiumCoal);
  const snapshot = buildTransportFuelInventorySnapshot([
    warehouseCoal("coal-b", 3),
    warehouseCoal("coal-a", 2),
    warehouseWood("wood-a", 9)
  ], selector);

  assert.equal(snapshot.quantity, 5);
  assert.deepEqual(snapshot.stacks.map((stack) => stack.itemId), ["coal-a", "coal-b"]);
  assert.equal(snapshot.primaryItemId, "coal-a");
  assert.equal(snapshot.openUuid, "Actor.group-a.Item.coal-a");
  assert.equal(snapshot.isEmpty, false);
});

test("selected compendium fuel remains openable when warehouse stock is absent", () => {
  const selector = buildTransportFuelSelector(compendiumCoal);
  const snapshot = buildTransportFuelInventorySnapshot([], selector);

  assert.equal(snapshot.configured, true);
  assert.equal(snapshot.quantity, 0);
  assert.equal(snapshot.openUuid, compendiumCoal.uuid);
  assert.equal(snapshot.isEmpty, true);
});
```

- [ ] **Step 3: Run the new test file and confirm RED**

Run: `node --test tests/transport-fuel-item.test.mjs`

Expected: FAIL because `scripts/data/transport-fuel-item.js` does not exist.

- [ ] **Step 4: Implement identity normalization and deterministic matching**

```js
export function buildTransportFuelSelector(item) {
  const source = item?.toObject?.() ?? item ?? {};
  const moduleFlags = source.flags?.[MODULE_ID] ?? {};
  return normalizeTransportFuelSelector({
    uuid: cleanText(item?.uuid ?? source.uuid),
    sourceUuid: cleanText(source.flags?.core?.sourceId ?? moduleFlags.sourceUuid),
    sourceType: cleanText(moduleFlags.sourceType),
    sourceId: cleanText(moduleFlags.sourceId),
    type: cleanText(item?.type ?? source.type),
    normalizedName: normalizeName(item?.name ?? source.name),
    name: cleanText(item?.name ?? source.name),
    img: cleanText(item?.img ?? source.img)
  });
}

export function matchesTransportFuelSelector(item, selector) {
  const candidate = buildTransportFuelSelector(item);
  if (selector.uuid && candidate.uuid === selector.uuid) return true;
  if (selector.sourceType && selector.sourceId) {
    return candidate.sourceType === selector.sourceType && candidate.sourceId === selector.sourceId;
  }
  if (
    (selector.uuid && candidate.sourceUuid === selector.uuid)
    || (selector.sourceUuid && candidate.uuid === selector.sourceUuid)
    || (selector.sourceUuid && candidate.sourceUuid === selector.sourceUuid)
  ) return true;
  return candidate.type === selector.type && candidate.normalizedName === selector.normalizedName;
}
```

Implement aggregate quantity using `Math.max(0, finiteNumber(system.quantity, 0))`. Sort matching stacks by `itemId` before selecting the primary stack and before returning consumption order. Never copy `system.quantity` into the selector.

- [ ] **Step 5: Run selector tests and confirm GREEN**

Run: `node --test tests/transport-fuel-item.test.mjs`

Expected: all tests pass.

- [ ] **Step 6: Commit the pure model**

```powershell
git add -- scripts/data/transport-fuel-item.js tests/transport-fuel-item.test.mjs
git commit -m "feat: model transport fuel item selection"
```

---

### Task 2: Persist dropped Item identity per concrete transport

**Files:**
- Modify: `scripts/data/transport-instance-service.js`
- Modify: `scripts/main.js`
- Modify: `tests/transport-instance-service.test.mjs`
- Modify: `tests/transport-instance-socket.test.mjs`

**Interfaces:**
- Consumes: `buildTransportFuelSelector(item)` from Task 1 and strict payload `{ groupActorId, actorId, itemUuid }`.
- Produces: `TRANSPORT_SELECT_FUEL_COMMAND`, `validateTransportFuelSelectionPayload(payload)`, `TransportInstanceService.selectFuel(payload, { sender })`, and `RebreyaMainModule.selectTransportFuel(payload)`.
- Stores selector only at `flags.rebreya-main.transport.instanceState.fuelSelector`.

- [ ] **Step 1: Replace legacy fuel-config validation tests with RED selection tests**

```js
test("fuel selection payload accepts only exact safe ids and an Item UUID", () => {
  const valid = {
    groupActorId: "group-a",
    actorId: "vehicle-a",
    itemUuid: "Compendium.world.goods.Item.coal"
  };
  assert.equal(validateTransportFuelSelectionPayload(valid), true);
  assert.equal(validateTransportFuelSelectionPayload({ ...valid, forged: true }), false);
  assert.equal(validateTransportFuelSelectionPayload({ ...valid, itemUuid: "" }), false);
});

test("selectFuel resolves Item identity without mutating the Item", async () => {
  const result = await service.selectFuel({
    groupActorId: "group-a",
    actorId: "vehicle-a",
    itemUuid: droppedItem.uuid
  }, { sender: gm });

  assert.deepEqual(result.fuelSelector, buildTransportFuelSelector(droppedItem));
  assert.equal(droppedItem.updateCalls.length, 0);
  assert.equal(droppedItem.deleteCalls.length, 0);
  assert.equal(actorUpdate["flags.rebreya-main.transport.instanceState"].fuelItemId, undefined);
  assert.equal(actorUpdate["flags.rebreya-main.transport.instanceState"].fuelPerMile, undefined);
});
```

- [ ] **Step 2: Run focused service tests and confirm RED**

Run: `node --test --test-name-pattern="fuel selection|selectFuel" tests/transport-instance-service.test.mjs tests/transport-instance-socket.test.mjs`

Expected: FAIL because the selection API and command do not exist.

- [ ] **Step 3: Implement strict selection persistence**

Replace `TRANSPORT_UPDATE_FUEL_CONFIG_COMMAND` with `TRANSPORT_SELECT_FUEL_COMMAND`. Resolve `itemUuid` through an injected `fromUuidProvider` defaulting to `globalThis.fromUuid`, require `documentName === "Item"` or `instanceof Item`, and build the selector with Task 1.

```js
async selectFuel(payload, { sender } = {}) {
  assertSelectionPayload(payload);
  const context = this.#resolveAuthorizedGroup(payload.groupActorId, sender);
  const actor = findConcreteTransport(context, payload.actorId);
  const item = await this.options.fromUuidProvider(payload.itemUuid);
  if (!isItemDocument(item)) throw new Error("Перетащите предмет топлива.");

  const previous = normalizeTransportInstanceState(readTransport(actor).instanceState);
  const { fuelItemId, fuelItemName, fuelPerMile, ...retained } = previous;
  const fuelSelector = buildTransportFuelSelector(item);
  const instanceState = { ...retained, fuelSelector };
  await actor.update({ [`flags.${MODULE_ID}.transport.instanceState`]: instanceState });
  return { groupActorId: context.groupId, actorId: actor.id, fuelSelector };
}
```

- [ ] **Step 4: Wire the local-or-socket module API**

Expose `selectTransportFuel(payload)` in `scripts/main.js`, use the active GM locally, otherwise request `TRANSPORT_SELECT_FUEL_COMMAND`, and refresh open apps after success. Remove `updateTransportFuelConfig` and registrations for the legacy command.

- [ ] **Step 5: Run service and socket tests and confirm GREEN**

Run: `node --test tests/transport-instance-service.test.mjs tests/transport-instance-socket.test.mjs`

Expected: all tests pass.

- [ ] **Step 6: Commit persistence and command changes**

```powershell
git add -- scripts/data/transport-instance-service.js scripts/main.js tests/transport-instance-service.test.mjs tests/transport-instance-socket.test.mjs
git commit -m "feat: persist selected transport fuel item"
```

---

### Task 3: Build fuel card/range context and consume matching warehouse stacks

**Files:**
- Modify: `scripts/data/inventory-service.js`
- Modify: `scripts/data/transport-fuel-service.js`
- Modify: `tests/group-inventory-migration.test.mjs`
- Modify: `tests/transport-fuel-service.test.mjs`
- Modify: `tests/transport-actor-builder.test.mjs`

**Interfaces:**
- Consumes: `buildTransportFuelInventorySnapshot(groupActor.items, fuelSelector)` from Task 1 and catalog `transport.consumption.amount/unit/cadence`.
- Produces: `transport.fuel` context with `{ configured, selector, card, quantity, consumptionPerMile, unit, miles, isEmpty, stacks }`.
- `TransportFuelService.consumeForTravel` continues to consume `{ groupActorId, appliedMiles }` and returns `{ configured, required, consumed, shortage, itemName, warning }`.

- [ ] **Step 1: Lock the existing fractional catalog parser with a focused test**

```js
test("transport consumption exposes a machine-readable fractional per-mile rate", () => {
  const entry = normalizeTransportEntry({
    ...validTransportRow,
    consumption: "Жидкий уголь 1/8 галлона"
  });
  assert.deepEqual(entry.feedOrFuel, {
    kind: "fuel",
    resource: "Жидкий уголь",
    amount: 0.125,
    unit: "gal",
    cadence: "mile",
    raw: "Жидкий уголь 1/8 галлона"
  });
});
```

- [ ] **Step 2: Write RED snapshot tests for full fuel context**

```js
assert.equal(snapshot.fuel.quantity, 5);
assert.equal(snapshot.fuel.consumptionPerMile, 0.125);
assert.equal(snapshot.fuel.miles, 40);
assert.equal(snapshot.fuel.card.name, "Жидкий уголь");
assert.equal(snapshot.fuel.card.openUuid, "Actor.group-a.Item.coal-a");
assert.equal(snapshot.fuel.card.quantity, 5);
assert.equal(snapshot.fuel.card.canOpen, true);
```

Also cover configured-without-stock as `quantity: 0`, `miles: 0`, `isEmpty: true`, preserving the selector source UUID for opening.

- [ ] **Step 3: Write RED multi-stack consumption tests**

```js
test("travel consumes matching warehouse stacks in stable item-id order", async () => {
  const result = await service.consumeForTravel({ groupActorId: "group-a", appliedMiles: 32 });
  assert.equal(result.required, 4);
  assert.equal(result.consumed, 4);
  assert.deepEqual(groupActor.updateEmbeddedDocumentsCalls, [["Item", [
    { _id: "coal-a", "system.quantity": 0 },
    { _id: "coal-b", "system.quantity": 1 }
  ]]]);
});
```

- [ ] **Step 4: Run focused tests and confirm RED**

Run: `node --test --test-name-pattern="fractional per-mile|full fuel context|matching warehouse stacks" tests/transport-actor-builder.test.mjs tests/group-inventory-migration.test.mjs tests/transport-fuel-service.test.mjs`

Expected: snapshot and consumption tests fail against the legacy exact-item implementation.

- [ ] **Step 5: Replace legacy range lookup in InventoryService**

Read `activeVehicle.fuelSelector` from normalized instance state. Use Task 1 to resolve all matching group Items. Derive the rate only from `activeVehicle.consumption.amount` when `kind === "fuel"` and `cadence === "mile"`.

```js
const miles = rate > 0 ? Math.floor(inventoryFuel.quantity / rate) : 0;
const card = {
  ...inventoryFuel.selector,
  itemId: inventoryFuel.primaryItemId,
  openUuid: inventoryFuel.openUuid,
  quantity: inventoryFuel.quantity,
  canOpen: Boolean(inventoryFuel.openUuid)
};
```

Remove range reads of legacy `fuelItemId`, `fuelItemName`, and manually stored `fuelPerMile`.

- [ ] **Step 6: Refactor TransportFuelService to consume selector matches**

Resolve the active vehicle and its `fuelSelector`, call Task 1 for matching stacks, calculate `required = roundQuantity(appliedMiles * consumption.amount)`, and build one batched Item update. Preserve zero-quantity Items rather than deleting them.

If batch mutation fails, return the existing warning result with `consumed: 0` and `shortage: required`. If available stock is insufficient, consume all available matching quantity and keep travel nonblocking.

- [ ] **Step 7: Run data-layer tests and confirm GREEN**

Run: `node --test tests/transport-fuel-item.test.mjs tests/transport-actor-builder.test.mjs tests/group-inventory-migration.test.mjs tests/transport-fuel-service.test.mjs`

Expected: all tests pass.

- [ ] **Step 8: Commit data-layer integration**

```powershell
git add -- scripts/data/inventory-service.js scripts/data/transport-fuel-service.js tests/group-inventory-migration.test.mjs tests/transport-fuel-service.test.mjs tests/transport-actor-builder.test.mjs
git commit -m "feat: consume selected fuel from party inventory"
```

---

### Task 4: Add Transport-tab drop target and full openable Item card

**Files:**
- Modify: `scripts/ui/inventory-app.js`
- Modify: `templates/inventory-app.hbs`
- Modify: `styles/main.css`
- Modify: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Consumes: `transport.fuel` from Task 3 and `moduleApi.selectTransportFuel({ groupActorId, actorId, itemUuid })` from Task 2.
- Produces: DOM actions `transport-fuel-dropzone` and `open-transport-fuel-item`.

- [ ] **Step 1: Write RED template and context tests for the full card**

```js
assert.match(transportPanel, /data-action="transport-fuel-dropzone"/u);
assert.match(transportPanel, /class="rm-inventory-row rm-transport-fuel-card/u);
assert.match(transportPanel, /transport\.fuel\.card\.img/u);
assert.match(transportPanel, /transport\.fuel\.card\.name/u);
assert.match(transportPanel, /transport\.fuel\.card\.quantity/u);
assert.match(transportPanel, /data-action="open-transport-fuel-item"/u);
assert.match(transportPanel, /transport\.fuel\.miles/u);
assert.doesNotMatch(transportPanel, /name="fuelPerMile"/u);
```

The prepared context test must assert that the header and Transport tab use the same `transport.fuel.miles`, and that `quantity === 0` produces `isEmpty: true` without removing `card`.

- [ ] **Step 2: Write RED interaction tests for Item drop and opening**

```js
await dropzone.listeners.drop[0](itemDropEvent({
  type: "Item",
  uuid: "Compendium.world.goods.Item.coal"
}));
assert.deepEqual(calls, [["selectTransportFuel", {
  groupActorId: "group-a",
  actorId: "vehicle-a",
  itemUuid: "Compendium.world.goods.Item.coal"
}]]);

await openButton.listeners.click[0]({ currentTarget: openButton });
assert.deepEqual(fromUuidCalls, ["Actor.group-a.Item.coal-a"]);
assert.deepEqual(itemSheetRenders, [true]);
```

Also assert that a non-Item payload warns and does not call the API.

- [ ] **Step 3: Run focused UI tests and confirm RED**

Run: `node --test --test-name-pattern="transport fuel card|transport fuel drop|open transport fuel" tests/inventory-app-context.test.mjs`

Expected: FAIL because the drop zone and actions are absent.

- [ ] **Step 4: Render the full Item-style card in the Transport tab**

Place the block inside the active transport instance section. Reuse existing `rm-inventory-row` structure and inventory typography so the fuel Item has the same visual weight as a normal inventory Item.

```hbs
<section
  class="rm-transport-fuel-slot {{#if transport.fuel.isEmpty}}is-empty{{/if}}"
  data-action="transport-fuel-dropzone"
  data-actor-id="{{transport.activeVehicle.actorId}}"
>
  {{#if transport.fuel.configured}}
    <article class="rm-inventory-row rm-transport-fuel-card">
      <button type="button" data-action="open-transport-fuel-item" data-item-uuid="{{transport.fuel.card.openUuid}}">
        <img src="{{transport.fuel.card.img}}" alt="">
        <span>{{transport.fuel.card.name}}</span>
      </button>
      <span class="{{#if transport.fuel.isEmpty}}rm-negative{{/if}}">{{transport.fuel.quantity}}</span>
      <span>{{transport.fuel.consumptionPerMile}} {{transport.fuel.unit}}/миля</span>
      <strong class="{{#if transport.fuel.isEmpty}}rm-negative{{/if}}">{{transport.fuel.miles}} миль</strong>
    </article>
  {{else}}
    <p>Перетащите сюда Item топлива</p>
  {{/if}}
</section>
```

Keep the existing shared header fuel cell, but change it from `transport.fuelRange` to the new `transport.fuel` context.

- [ ] **Step 5: Bind drop and open actions**

Use `TextEditor.getDragEventData(event)`. Require `dragData.type === "Item"` and a nonempty UUID. Call `selectTransportFuel` with the current group and active transport IDs. Do not call `importInventoryDrop` and do not mutate the dropped document.

For opening, resolve `data-item-uuid` with `fromUuid`, require an Item document and call `item.sheet.render(true)`. Show a warning if the stored source is no longer resolvable.

- [ ] **Step 6: Add scoped drop/card styles**

Add `.rm-transport-fuel-slot`, `.rm-transport-fuel-slot.is-dragover`, and `.rm-transport-fuel-card` styles. Preserve the existing Transport tab width and responsive flow; use red text only for zero quantity/miles and never a red panel background.

- [ ] **Step 7: Run UI tests and confirm GREEN**

Run: `node --test tests/inventory-app-context.test.mjs`

Expected: all tests pass.

- [ ] **Step 8: Commit the Transport-tab UI**

```powershell
git add -- scripts/ui/inventory-app.js templates/inventory-app.hbs styles/main.css tests/inventory-app-context.test.mjs
git commit -m "feat: add transport fuel item drop card"
```

---

### Task 5: Remove vehicle-sheet fuel configuration completely

**Files:**
- Modify: `scripts/integrations/transport-vehicle-sheet.js`
- Modify: `styles/main.css`
- Modify: `tests/transport-vehicle-sheet.test.mjs`

**Interfaces:**
- Consumes: none from the new UI; the vehicle sheet retains only read-only Rebreya specifications.
- Produces: no fuel controls, fuel persistence calls, or `.rm-rebreya-transport-fuel` markup on Actor sheets.

- [ ] **Step 1: Replace the legacy configuration test with a RED absence test**

```js
test("vehicle sheet exposes specifications without transport fuel controls", () => {
  const dom = createSheetDom();
  assert.equal(injectTransportSpecifications({ actor }, dom.html, moduleApi), true);
  assert.equal(dom.root.querySelector('[name="fuelItemId"]'), null);
  assert.equal(dom.root.querySelector('[name="fuelPerMile"]'), null);
  assert.equal(dom.root.querySelector('[data-action="save-transport-fuel"]'), null);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test --test-name-pattern="without transport fuel controls" tests/transport-vehicle-sheet.test.mjs`

Expected: FAIL because the old form is still injected.

- [ ] **Step 3: Delete the fuel form and dead integration code**

Remove `collectionValues`, `resolveFuelContext`, `appendFuelControl`, `buildFuelForm`, and its injection from `transport-vehicle-sheet.js`. Keep `buildTransportSpecifications`, render hook registration, and read-only consumption specification.

Remove `.rm-rebreya-transport-fuel` CSS rules. Confirm no source references remain for `save-transport-fuel` or `updateTransportFuelConfig`.

- [ ] **Step 4: Run vehicle-sheet tests and confirm GREEN**

Run: `node --test tests/transport-vehicle-sheet.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: Commit legacy removal**

```powershell
git add -- scripts/integrations/transport-vehicle-sheet.js styles/main.css tests/transport-vehicle-sheet.test.mjs
git commit -m "refactor: remove vehicle sheet fuel setup"
```

---

### Task 6: Full verification and branch publication

**Files:**
- Verify only; change files only to fix failures directly caused by Tasks 1–5.

**Interfaces:**
- Consumes: all completed task interfaces.
- Produces: a clean, tested `lich_branch` pushed normally to `origin`.

- [ ] **Step 1: Verify legacy references are gone**

Run:

```powershell
rg -n "updateTransportFuelConfig|save-transport-fuel|name=\"fuelItemId\"|name=\"fuelPerMile\"" scripts templates styles tests
```

Expected: no production references; test references only when explicitly asserting absence.

- [ ] **Step 2: Run whitespace and staged-scope checks**

Run:

```powershell
git diff --check
git status --short --branch
git diff --stat
```

Expected: no whitespace errors; only task files are modified.

- [ ] **Step 3: Run the complete test suite**

Run: `node --test tests/*.test.mjs`

Expected: zero failures.

- [ ] **Step 4: Perform local Foundry UI validation when authentication is available**

Validate this exact flow: open Party Inventory → Transport → select a concrete vehicle → drop an Item from a compendium → confirm full card and open it → add matching stock to party inventory → confirm quantity and miles update → advance travel → confirm warehouse quantity decreases.

If Foundry remains at the authenticated join screen, record live UI validation as blocked and rely on the focused template/interaction tests without attempting credentials.

- [ ] **Step 5: Review the complete task diff**

Run:

```powershell
git diff origin/lich_branch...HEAD -- scripts/data/transport-fuel-item.js scripts/data/transport-instance-service.js scripts/data/transport-fuel-service.js scripts/data/inventory-service.js scripts/integrations/transport-vehicle-sheet.js scripts/ui/inventory-app.js templates/inventory-app.hbs styles/main.css tests/transport-fuel-item.test.mjs tests/transport-instance-service.test.mjs tests/transport-instance-socket.test.mjs tests/transport-fuel-service.test.mjs tests/transport-actor-builder.test.mjs tests/group-inventory-migration.test.mjs tests/transport-vehicle-sheet.test.mjs tests/inventory-app-context.test.mjs
```

Expected: every change maps to the approved design and no quantity is stored in a fuel selector.

- [ ] **Step 6: Commit any verification fixes, fetch, and push without force**

```powershell
git fetch origin
git status --short --branch
git push origin lich_branch
```

Expected: ordinary push succeeds and local `HEAD` equals `origin/lich_branch`.
