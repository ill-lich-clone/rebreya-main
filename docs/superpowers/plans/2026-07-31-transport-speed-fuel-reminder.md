# Transport Speed Repair and Fuel Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore correct native and party-inventory transport speeds, allow a vehicle to select a group warehouse Item as fuel, and deduct available fuel after travel without blocking movement.

**Architecture:** Build every managed transport Actor once from its raw catalog row, then repair only recognizable legacy-broken speed fields on concrete instances during GM compendium sync. Keep fuel selection on the concrete vehicle Actor and expose it through the injected Rebreya vehicle-sheet panel. The active GM derives traveled miles from the serialized persisted state transition and runs `TransportFuelService` through the repository's post-persistence hook before releasing the mutation queue; no standalone client-controlled fuel command exists.

**Tech Stack:** Foundry VTT 13, D&D5e 5.2.5 Actor/Item documents, native ES modules, Handlebars-adjacent DOM injection, Node `node:test`.

## Global Constraints

- Work only on `lich_branch`; never commit or push directly to `main` or `master`.
- Fuel is a soft reminder: missing configuration, missing stock, insufficient stock, or a deduction failure never blocks or rewinds travel.
- `fuelItemId` must resolve to an embedded Item of the transport's owning managed group.
- Fractional Item quantities are supported using the inventory service's existing two-decimal precision.
- Rewinding travel never refunds fuel.
- Existing non-zero speed overrides and all live instance state must be preserved.

---

### Task 1: Build Correct Transport Speeds Exactly Once

**Files:**
- Modify: `scripts/data/transport-compendium.js`
- Modify: `scripts/data/transport-actor-builder.js`
- Test: `tests/transport-compendium.test.mjs`
- Test: `tests/transport-actor-builder.test.mjs`

**Interfaces:**
- Consumes: raw rows from `data/rebreya-transport-v01.json`.
- Produces: `buildTransportActorData(rawRow)` with native combat movement, native travel speeds, and a bumped managed signature.

- [ ] **Step 1: Write the failing compendium regression test**

Add an assertion after `TransportCompendiumService.sync(catalog)` that the created `Автомобиль «Кипятильник»` document has literal values:

```js
assert.equal(kettle.system.attributes.movement.walk, 100);
assert.equal(kettle.system.attributes.travel.speeds.land, 10);
assert.equal(kettle.flags[MODULE_ID].transport.combatSpeed.primaryFt, 100);
assert.equal(kettle.flags[MODULE_ID].transport.travelSpeed.value, 10);
```

This test catches passing a normalized row back into the raw-row builder.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/transport-compendium.test.mjs`

Expected: FAIL because the synchronized document currently has movement `0` and no travel speed.

- [ ] **Step 3: Remove the double-normalization boundary**

In `TransportCompendiumService.sync`, prepare each raw row as one record containing:

```js
{
  normalized: normalizeTransportEntry(raw, index),
  actorData: buildTransportActorData(raw)
}
```

Use `normalized` only for stable identity checks and `actorData` for signature and `buildData`. Do not call `buildTransportActorData` with `normalized`.

Increment the transport template version used by `buildTransportSignature` so existing malformed managed documents are updated on the next active-GM sync.

- [ ] **Step 4: Verify GREEN and mapping coverage**

Run: `node --test tests/transport-actor-builder.test.mjs tests/transport-compendium.test.mjs`

Expected: PASS, including exact Kettle values `100 ft` and `10 mph`.

- [ ] **Step 5: Commit the isolated importer repair**

```powershell
git add -- scripts/data/transport-compendium.js scripts/data/transport-actor-builder.js tests/transport-compendium.test.mjs tests/transport-actor-builder.test.mjs
git commit -m "fix: preserve imported transport speeds"
```

### Task 2: Repair Existing Concrete Instance Speeds

**Files:**
- Modify: `scripts/data/transport-compendium.js`
- Test: `tests/transport-compendium.test.mjs`

**Interfaces:**
- Produces: exported `repairTransportInstanceSpeeds(actors, actorDataBySourceId)` returning `{ inspected, updated }`.
- Uses: corrected actor data keyed by `flags.rebreya-main.sourceId`.

- [ ] **Step 1: Write failing repair tests**

Create a concrete instance fixture with `instance: true`, matching `sourceId`, zero native movement, empty native travel speeds, malformed null speed flags, and live HP/reserve/artwork. Assert repair calls `actor.update` with only:

```js
{
  "system.attributes.movement.walk": 100,
  "system.attributes.travel.speeds.land": 10,
  "flags.rebreya-main.transport.combatSpeed": { primaryFt: 100, secondaryFt: 200, raw: "100/200 футов" },
  "flags.rebreya-main.transport.travelSpeed": { value: 10, units: "mi", raw: "10 миль/час" }
}
```

Add a second fixture with non-zero world speed overrides and assert no update occurs. The test catches overwriting intentional live values.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/transport-compendium.test.mjs`

Expected: FAIL because `repairTransportInstanceSpeeds` does not exist.

- [ ] **Step 3: Implement conservative GM-side repair**

Implement the exported helper and call it after managed pack synchronization with `game.actors`. Patch a field only when the current imported field is absent, null, empty, `"[object Object]"`, or numeric zero while the corrected source value is positive. Do not include HP, ownership, image, prototype token, reserve, condition, capacity, or unrelated flags in the patch.

- [ ] **Step 4: Verify repair behavior**

Run: `node --test tests/transport-compendium.test.mjs tests/transport-instance-service.test.mjs tests/transport-actor-builder.test.mjs`

Expected: PASS; malformed instances update, deliberate overrides remain unchanged.

- [ ] **Step 5: Commit instance migration**

```powershell
git add -- scripts/data/transport-compendium.js tests/transport-compendium.test.mjs
git commit -m "fix: repair existing transport instance speeds"
```

### Task 3: Configure a Group Fuel Item on the Vehicle Sheet

**Files:**
- Modify: `scripts/data/transport-instance-service.js`
- Modify: `scripts/integrations/transport-vehicle-sheet.js`
- Modify: `scripts/main.js`
- Modify: `styles/main.css`
- Test: `tests/transport-instance-service.test.mjs`
- Test: `tests/transport-vehicle-sheet.test.mjs`
- Test: `tests/transport-instance-socket.test.mjs`

**Interfaces:**
- Produces: `TRANSPORT_UPDATE_FUEL_CONFIG_COMMAND = "group.transport.updateFuelConfig"`.
- Produces: `validateTransportFuelConfigPayload(payload)` for exact `{ groupActorId, actorId, fuelItemId, fuelPerMile }` payloads.
- Produces: `TransportInstanceService.updateFuelConfig(payload, { sender })`.
- Produces: `RebreyaMainModule.updateTransportFuelConfig(payload)`.

- [ ] **Step 1: Write failing service and payload tests**

Assert validation accepts a finite non-negative `fuelPerMile`, rejects extra keys, foreign IDs, negative values, and non-numbers. Build a managed group with two embedded Items and assert saving one writes:

```js
{
  ...previousInstanceState,
  fuelItemId: "liquid-coal",
  fuelItemName: "Жидкий уголь",
  fuelPerMile: 0.125
}
```

Assert an Item ID outside the group is rejected and previous HP/reserve/condition remain unchanged.

- [ ] **Step 2: Verify service tests RED**

Run: `node --test tests/transport-instance-service.test.mjs tests/transport-instance-socket.test.mjs`

Expected: FAIL because the command, validator, and method do not exist.

- [ ] **Step 3: Implement the typed configuration mutation**

Register the exact socket command with the existing group authorization callback. On execution, re-resolve the concrete vehicle through group members, resolve `fuelItemId` through `groupActor.items`, derive `fuelItemName` server-side, and update only `instanceState.fuelItemId`, `fuelItemName`, and `fuelPerMile` while preserving current state.

When a new instance is created, initialize `fuelPerMile` from source `consumption.amount` only when `consumption.cadence === "mile"`; initialize `fuelItemId` and `fuelItemName` as empty strings.

- [ ] **Step 4: Write the failing vehicle-sheet UI test**

Render a concrete vehicle fixture connected to a managed group and assert the injected panel contains:

```html
<select name="fuelItemId">...</select>
<input name="fuelPerMile" type="number" min="0" step="any">
<button data-action="save-transport-fuel">...</button>
```

Dispatch save and assert `moduleApi.updateTransportFuelConfig` receives the exact group ID, actor ID, selected Item ID, and numeric rate.

- [ ] **Step 5: Verify UI test RED**

Run: `node --test tests/transport-vehicle-sheet.test.mjs`

Expected: FAIL because the read-only panel has no fuel form.

- [ ] **Step 6: Implement the injected fuel controls**

Resolve the owning group from `transport.groupActorId`, build options from its embedded Items, mark the saved Item selected, show the saved missing-item name when necessary, and bind one idempotent click handler. Disable controls when the current user cannot manage the group. Add compact component-scoped CSS under `.rm-rebreya-transport-specs`.

- [ ] **Step 7: Verify the configuration slice GREEN**

Run: `node --test tests/transport-instance-service.test.mjs tests/transport-instance-socket.test.mjs tests/transport-vehicle-sheet.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit fuel configuration**

```powershell
git add -- scripts/data/transport-instance-service.js scripts/integrations/transport-vehicle-sheet.js scripts/main.js styles/main.css tests/transport-instance-service.test.mjs tests/transport-instance-socket.test.mjs tests/transport-vehicle-sheet.test.mjs
git commit -m "feat: configure vehicle fuel from party stock"
```

### Task 4: Consume Available Fuel After Travel Without Blocking

**Files:**
- Create: `scripts/data/transport-fuel-service.js`
- Modify: `scripts/main.js`
- Test: `tests/transport-fuel-service.test.mjs`
- Test: `tests/travel-map-integration.test.mjs`

**Interfaces:**
- Produces: `TransportFuelService.consumeForTravel({ context, appliedMiles })` returning `{ configured, required, consumed, shortage, itemName, warning }`.
- Consumes: `result.travelChange.appliedMiles` from `TravelService.advanceHours`.

- [ ] **Step 1: Write failing fuel-calculation and mutation tests**

Cover literal scenarios:

```js
// 10 miles * 0.125 = 1.25 units
assert.deepEqual(result, {
  configured: true,
  required: 1.25,
  consumed: 1.25,
  shortage: 0,
  itemName: "Жидкий уголь",
  warning: ""
});
```

Also assert:

- a two-unit stack asked for three becomes zero/deleted, returns shortage `1`, and does not throw;
- a missing selected Item returns a warning and does not throw;
- no selection or zero rate returns `configured: false` and does not mutate;
- negative `appliedMiles` (rewind) performs no mutation;
- `appliedMiles` clamped at route end determines consumption, not requested hours.

- [ ] **Step 2: Run the new test and verify RED**

Run: `node --test tests/transport-fuel-service.test.mjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the focused fuel service**

Resolve the active `member:<actorId>` from `context.groupState.transportState`, verify the concrete actor belongs to the context group, read its saved Item/rate, then resolve the embedded group Item. Round required, consumed, and shortage through a local two-decimal helper matching inventory precision. Update the Item quantity or delete a depleted Item. Catch mutation errors and return a warning result rather than throwing.

- [ ] **Step 4: Integrate with the authoritative travel commit**

Construct `TransportFuelService` in `RebreyaMainModule` and inject it into `TravelService`. On the active GM, calculate `appliedMiles` from the previous persisted travel state and the incoming state inside the serialized group mutation. Persist the travel state first, then consume fuel in an `afterCommit` callback while still holding the mutation queue. Return `fuelChange` with the travel command result and show warnings in `advanceTravelHours`. Do not expose a separate socket command accepting client-supplied miles.

- [ ] **Step 5: Verify travel integration GREEN**

Run: `node --test tests/transport-fuel-service.test.mjs tests/travel-service.test.mjs tests/travel-map-integration.test.mjs tests/inventory-app-context.test.mjs`

Expected: PASS; travel still succeeds for every fuel warning case.

- [ ] **Step 6: Run focused transport and syntax verification**

Run:

```powershell
node --check scripts/data/transport-fuel-service.js
node --check scripts/data/transport-compendium.js
node --check scripts/data/transport-instance-service.js
node --check scripts/integrations/transport-vehicle-sheet.js
node --test tests/transport-actor-builder.test.mjs tests/transport-compendium.test.mjs tests/transport-instance-service.test.mjs tests/transport-instance-socket.test.mjs tests/transport-vehicle-sheet.test.mjs tests/transport-fuel-service.test.mjs tests/travel-service.test.mjs tests/travel-map-integration.test.mjs tests/inventory-app-context.test.mjs
```

Expected: all checks and tests pass.

- [ ] **Step 7: Run full verification and review**

Run `node --test`, `python -m unittest tests/test_travel_landscape_renderer.py`, and `git diff --check`. Have a Terra 5.6 reviewer inspect the final diff for Foundry document schemas, authorization, soft-failure behavior, and regression risk.

- [ ] **Step 8: Commit and push the completed feature**

```powershell
git add -- scripts/data/transport-fuel-service.js scripts/main.js tests/transport-fuel-service.test.mjs tests/travel-map-integration.test.mjs
git commit -m "feat: consume party fuel during travel"
git push origin lich_branch
```
