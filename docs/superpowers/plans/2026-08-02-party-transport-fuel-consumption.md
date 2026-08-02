# Party Transport Fuel Consumption Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an editable amount-and-unit fuel consumption control to the selected Item card in the party inventory Transport tab, with the same effective rate driving displayed range and travel consumption.

**Architecture:** A pure fuel-consumption module normalizes `{ amount, unit }` overrides and resolves them against the imported vehicle fallback. The transport instance service persists the override beside `fuelSelector` without changing base `transport.consumption`; inventory snapshot and travel consumption share the pure resolver. InventoryApp renders and submits a compact card-level editor through a dedicated socket command.

**Tech Stack:** Foundry VTT 13, dnd5e 5.2.5, JavaScript ES modules, Handlebars, CSS, Node.js built-in test runner.

## Global Constraints

- Work only on `lich_branch`; fetch `origin` before edits and never force-push.
- Fuel quantity remains exclusively in party inventory Item `system.quantity` values.
- Persist only `amount > 0` and `unit` equal to `lb` or `gal`; cadence is always one mile.
- Never modify `flags.rebreya-main.transport.consumption` when saving the card editor.
- Never add fuel controls back to the vehicle Actor Sheet.
- The override must drive both displayed range and actual travel consumption.
- Preserve imported base consumption as the fallback until an override is saved.
- Preserve the override when a different Item is selected as fuel.
- Preserve unrelated user changes and stage only files named by this plan.

---

### Task 1: Pure effective-consumption model

**Files:**
- Create: `scripts/data/transport-fuel-consumption.js`
- Create: `tests/transport-fuel-consumption.test.mjs`

**Interfaces:**
- Consumes: an optional instance override `{ amount, unit }` and imported fallback `{ kind, amount, unit, cadence }`.
- Produces: `normalizeTransportFuelConsumption(value, { optional })` and `resolveTransportFuelConsumption(override, fallback)`.
- `resolveTransportFuelConsumption` returns `{ amount, unit, source }`, where `source` is `override`, `transport`, or `none`.

- [ ] **Step 1: Write failing normalization and fallback tests**

```js
test("fuel consumption accepts only positive lb or gal rates", () => {
  assert.deepEqual(normalizeTransportFuelConsumption({ amount: "0,125", unit: "gal" }), {
    amount: 0.125,
    unit: "gal"
  });
  assert.throws(() => normalizeTransportFuelConsumption({ amount: 0, unit: "lb" }), /больше нуля/u);
  assert.throws(() => normalizeTransportFuelConsumption({ amount: 1, unit: "kg" }), /фунты или галлоны/u);
});

test("effective consumption prefers the instance override and otherwise uses imported per-mile fuel", () => {
  assert.deepEqual(resolveTransportFuelConsumption(
    { amount: 120, unit: "lb" },
    { kind: "fuel", amount: 0.125, unit: "gal", cadence: "mile" }
  ), { amount: 120, unit: "lb", source: "override" });
  assert.deepEqual(resolveTransportFuelConsumption(null, {
    kind: "fuel", amount: 0.125, unit: "gal", cadence: "mile"
  }), { amount: 0.125, unit: "gal", source: "transport" });
  assert.deepEqual(resolveTransportFuelConsumption(null, {
    kind: "feed", amount: 4, unit: "lb", cadence: "day"
  }), { amount: 0, unit: "", source: "none" });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/transport-fuel-consumption.test.mjs`

Expected: FAIL because `scripts/data/transport-fuel-consumption.js` does not exist.

- [ ] **Step 3: Implement the pure normalizer and resolver**

```js
const UNITS = new Set(["lb", "gal"]);

export function normalizeTransportFuelConsumption(value, { optional = false } = {}) {
  if (optional && value == null) return null;
  const amount = Number(typeof value?.amount === "string" ? value.amount.replace(",", ".") : value?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Расход топлива должен быть больше нуля.");
  }
  const unit = String(value?.unit ?? "").trim();
  if (!UNITS.has(unit)) {
    throw new Error("Единица расхода топлива должна быть: фунты или галлоны.");
  }
  return { amount, unit };
}

export function resolveTransportFuelConsumption(override, fallback = {}) {
  const normalizedOverride = normalizeTransportFuelConsumption(override, { optional: true });
  if (normalizedOverride) return { ...normalizedOverride, source: "override" };
  if (fallback?.kind === "fuel" && fallback?.cadence === "mile") {
    try {
      return { ...normalizeTransportFuelConsumption(fallback), source: "transport" };
    }
    catch (_error) {}
  }
  return { amount: 0, unit: "", source: "none" };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test tests/transport-fuel-consumption.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the pure model**

```powershell
git add -- scripts/data/transport-fuel-consumption.js tests/transport-fuel-consumption.test.mjs
git commit -m "feat: model transport fuel consumption override"
```

---

### Task 2: Authorized persistence command

**Files:**
- Modify: `scripts/data/transport-instance-service.js`
- Modify: `scripts/main.js`
- Modify: `tests/transport-instance-service.test.mjs`
- Modify: `tests/transport-instance-socket.test.mjs`

**Interfaces:**
- Consumes: `{ groupActorId, actorId, consumption: { amount, unit } }`.
- Produces: `TRANSPORT_UPDATE_FUEL_CONSUMPTION_COMMAND`, `validateTransportFuelConsumptionUpdatePayload(payload)`, `TransportInstanceService.updateFuelConsumption(payload, { sender })`, and `RebreyaMainModule.updateTransportFuelConsumption(payload)`.
- Persists only `flags.rebreya-main.transport.instanceState.fuelConsumption` while retaining condition and `fuelSelector`.

- [ ] **Step 1: Write failing validator and persistence tests**

```js
const validFuelConsumptionUpdate = {
  groupActorId: "group-a",
  actorId: "vehicle-a",
  consumption: { amount: 120, unit: "lb" }
};

test("fuel consumption update accepts an exact positive lb or gal payload", () => {
  assert.equal(validateTransportFuelConsumptionUpdatePayload(validFuelConsumptionUpdate), true);
  assert.equal(validateTransportFuelConsumptionUpdatePayload({
    ...validFuelConsumptionUpdate,
    consumption: { amount: 0, unit: "lb" }
  }), false);
  assert.equal(validateTransportFuelConsumptionUpdatePayload({
    ...validFuelConsumptionUpdate,
    consumption: { amount: 1, unit: "kg" }
  }), false);
  assert.equal(validateTransportFuelConsumptionUpdatePayload({ ...validFuelConsumptionUpdate, forged: true }), false);
});

test("fuel consumption update changes only instance calculation state", async () => {
  const harness = createTransportInstanceHarness({ existingTransport: true });
  const service = new TransportInstanceService(harness.moduleApi, harness.options);

  const result = await service.updateFuelConsumption(validFuelConsumptionUpdate, { sender: harness.gm });

  assert.deepEqual(harness.actorUpdates.at(-1), {
    "flags.rebreya-main.transport.instanceState": {
      condition: "operational",
      fuelConsumption: { amount: 120, unit: "lb" }
    }
  });
  assert.deepEqual(result.fuelConsumption, { amount: 120, unit: "lb" });
});
```

- [ ] **Step 2: Run service tests and verify RED**

Run: `node --test tests/transport-instance-service.test.mjs`

Expected: FAIL because the validator and `updateFuelConsumption` do not exist.

- [ ] **Step 3: Implement normalization and service persistence**

```js
const FUEL_CONSUMPTION_UPDATE_KEYS = Object.freeze(["actorId", "consumption", "groupActorId"]);
const FUEL_CONSUMPTION_KEYS = Object.freeze(["amount", "unit"]);

export function validateTransportFuelConsumptionUpdatePayload(payload) {
  try {
    return hasExactKeys(payload, FUEL_CONSUMPTION_UPDATE_KEYS)
      && isSafeId(payload.groupActorId)
      && isSafeId(payload.actorId)
      && hasExactKeys(payload.consumption, FUEL_CONSUMPTION_KEYS)
      && Boolean(normalizeTransportFuelConsumption(payload.consumption));
  }
  catch (_error) {
    return false;
  }
}

async updateFuelConsumption(payload, { sender } = {}) {
  if (!validateTransportFuelConsumptionUpdatePayload(payload)) {
    throw new Error("Некорректный запрос изменения расхода топлива транспорта.");
  }
  const groupContext = this.#resolveAuthorizedGroup(payload.groupActorId, sender);
  const actor = (groupContext.members ?? []).find((member) => member?.id === payload.actorId);
  if (!actor || !this.#isInstanceForGroup(actor, groupContext.groupId)) {
    throw new Error("Транспорт не найден в выбранной группе.");
  }
  const transport = actor.getFlag?.(MODULE_ID, "transport") ?? actor.flags?.[MODULE_ID]?.transport ?? {};
  const instanceState = normalizeTransportInstanceState({
    ...(transport.instanceState ?? {}),
    fuelConsumption: payload.consumption
  });
  await actor.update({ [`flags.${MODULE_ID}.transport.instanceState`]: instanceState });
  return { groupActorId: groupContext.groupId, actorId: actor.id, fuelConsumption: instanceState.fuelConsumption };
}
```

- [ ] **Step 4: Run service tests and verify GREEN**

Run: `node --test tests/transport-instance-service.test.mjs`

Expected: PASS.

- [ ] **Step 5: Write failing command-registration and module-routing tests**

```js
test("fuel consumption command validates, authorizes, and executes", async () => {
  const definition = harness.registrations.get(TRANSPORT_UPDATE_FUEL_CONSUMPTION_COMMAND);
  const sender = { id: "player-a", isGM: false };
  assert.equal(definition.validate(validFuelConsumptionUpdate), true);
  assert.equal(await definition.authorize(validFuelConsumptionUpdate, { sender }), true);
  assert.deepEqual(await definition.execute(validFuelConsumptionUpdate, { sender }), {
    actorId: "vehicle-a",
    groupActorId: "group-a"
  });
});
```

Add exact source-routing assertions:

```js
assert.match(source, /async updateTransportFuelConsumption\(payload\)/u);
assert.match(source, /this\.socketCommandBus\.request\(TRANSPORT_UPDATE_FUEL_CONSUMPTION_COMMAND,\s*payload\)/u);
assert.match(source, /this\.transportInstanceService\.updateFuelConsumption\(payload,\s*\{\s*sender:/u);
```

- [ ] **Step 6: Run socket tests and verify RED**

Run: `node --test tests/transport-instance-socket.test.mjs`

Expected: FAIL because the command is not registered or routed.

- [ ] **Step 7: Register and route the dedicated command**

```js
async updateTransportFuelConsumption(payload) {
  const result = isActiveGmClient(globalThis.game)
    ? await this.transportInstanceService.updateFuelConsumption(payload, { sender: globalThis.game?.user })
    : await this.socketCommandBus.request(TRANSPORT_UPDATE_FUEL_CONSUMPTION_COMMAND, payload);
  await this.refreshOpenApps();
  return result;
}
```

- [ ] **Step 8: Run service and socket tests and verify GREEN**

Run: `node --test tests/transport-instance-service.test.mjs tests/transport-instance-socket.test.mjs`

Expected: PASS.

- [ ] **Step 9: Commit persistence and routing**

```powershell
git add -- scripts/data/transport-instance-service.js scripts/main.js tests/transport-instance-service.test.mjs tests/transport-instance-socket.test.mjs
git commit -m "feat: persist inventory fuel consumption override"
```

---

### Task 3: Shared snapshot and travel consumption rate

**Files:**
- Modify: `scripts/data/inventory-service.js`
- Modify: `scripts/data/transport-fuel-service.js`
- Modify: `tests/group-inventory-migration.test.mjs`
- Modify: `tests/transport-fuel-service.test.mjs`

**Interfaces:**
- Consumes: `activeVehicle.fuelConsumption` populated from `transport.instanceState.fuelConsumption` and imported `activeVehicle.consumption`.
- Produces: fuel snapshot fields `consumptionPerMile`, `unit`, and `consumptionSource` from `resolveTransportFuelConsumption`.
- Travel consumption uses the same helper against `transport.instanceState.fuelConsumption` and `transport.consumption`.

- [ ] **Step 1: Write failing snapshot override/fallback test**

Add `fuelConsumption: { amount: 2, unit: "lb" }` to the live vehicle `instanceState` fixture and assert:

```js
assert.equal(transportSnapshot.fuel.consumptionPerMile, 2);
assert.equal(transportSnapshot.fuel.unit, "lb");
assert.equal(transportSnapshot.fuel.consumptionSource, "override");
assert.equal(transportSnapshot.fuel.miles, 2);
```

Keep a second fixture without the override asserting the existing `0.125 gal` fallback.

- [ ] **Step 2: Run the snapshot test and verify RED**

Run: `node --test --test-name-pattern="vehicle member reads|fuel consumption override" tests/group-inventory-migration.test.mjs`

Expected: FAIL because the profile and snapshot ignore `instanceState.fuelConsumption`.

- [ ] **Step 3: Pass the override through the transport profile and resolve it in the snapshot**

```js
const effectiveConsumption = resolveTransportFuelConsumption(
  activeVehicle.fuelConsumption,
  activeVehicle.consumption
);
const consumptionPerMile = effectiveConsumption.amount;
return {
  ...inventoryFuel,
  consumptionPerMile,
  unit: effectiveConsumption.unit,
  consumptionSource: effectiveConsumption.source,
  miles
};
```

Add normalized `fuelConsumption` to `buildTransportProfile` and pass `instanceState.fuelConsumption` from `buildTransportProfileFromActor` so the active vehicle snapshot reaches this resolver.

- [ ] **Step 4: Run the snapshot test and verify GREEN**

Run: `node --test --test-name-pattern="vehicle member reads|fuel consumption override" tests/group-inventory-migration.test.mjs`

Expected: PASS.

- [ ] **Step 5: Write failing travel-consumption override test**

Add an `override = null` harness option and store it exactly as:

```js
instanceState: configured
  ? {
      fuelSelector: buildTransportFuelSelector(selectedFuel),
      ...(override ? { fuelConsumption: structuredClone(override) } : {})
    }
  : {}
```

Then assert:

```js
test("travel consumes the same instance fuel rate shown by inventory", async () => {
  const harness = createFuelHarness({ quantities: [300], rate: 0.125, override: { amount: 120, unit: "lb" } });
  const result = await harness.service.consumeForTravel({ groupActorId: "group-a", appliedMiles: 2 });
  assert.equal(result.required, 240);
  assert.equal(result.consumed, 240);
  assert.equal(harness.items[0].system.quantity, 60);
});
```

- [ ] **Step 6: Run the travel fuel test and verify RED**

Run: `node --test tests/transport-fuel-service.test.mjs`

Expected: FAIL with `required` still derived from `0.125`.

- [ ] **Step 7: Resolve effective consumption in travel service**

```js
const effectiveConsumption = resolveTransportFuelConsumption(
  transport.instanceState?.fuelConsumption,
  transport.consumption
);
const fuelPerMile = effectiveConsumption.amount;
```

The service must not mutate or convert `effectiveConsumption.unit`.

- [ ] **Step 8: Run snapshot and travel tests and verify GREEN**

Run: `node --test tests/group-inventory-migration.test.mjs tests/transport-fuel-service.test.mjs`

Expected: PASS.

- [ ] **Step 9: Commit shared calculations**

```powershell
git add -- scripts/data/inventory-service.js scripts/data/transport-fuel-service.js tests/group-inventory-migration.test.mjs tests/transport-fuel-service.test.mjs
git commit -m "feat: apply inventory fuel rate to travel"
```

---

### Task 4: Card-level editor and horizontal layout

**Files:**
- Modify: `scripts/ui/inventory-app.js`
- Modify: `templates/inventory-app.hbs`
- Modify: `styles/main.css`
- Modify: `tests/inventory-app-context.test.mjs`

**Interfaces:**
- Consumes: snapshot fuel fields plus `transport.canManage` and `transport.activeVehicle.actorId`.
- Produces: `fuel.consumptionForm` with `{ canEdit, amount, unitOptions }` and submits `{ groupActorId, actorId, consumption: { amount, unit } }` through `moduleApi.updateTransportFuelConsumption`.

- [ ] **Step 1: Write failing context and template behavior tests**

```js
assert.deepEqual(context.transport.fuel.consumptionForm, {
  canEdit: true,
  amount: "120",
  unitOptions: [
    { value: "lb", label: "фунты", selected: true },
    { value: "gal", label: "галлоны", selected: false }
  ]
});
```

Render assertions must require `data-transport-fuel-consumption-form`, `name="fuelConsumptionAmount"`, `name="fuelConsumptionUnit"`, and `data-action="transport-fuel-consumption-save"`. A non-manager context must expose `canEdit: false` and render the formatted static rate instead of enabled controls.

- [ ] **Step 2: Run context/template tests and verify RED**

Run: `node --test --test-name-pattern="transport.*fuel|fuel.*card|fuel.*consumption" tests/inventory-app-context.test.mjs`

Expected: FAIL because `consumptionForm` and controls do not exist.

- [ ] **Step 3: Prepare UI context and render the editor in the card**

In `prepareTransportContext`, add:

```js
consumptionForm: {
  canEdit: Boolean(source.canManage && activeVehicle?.isConcreteInstance),
  amount: String(Math.max(0, toNumber(sourceFuel.consumptionPerMile, 0))),
  unitOptions: [
    { value: "lb", label: "фунты", selected: cleanText(sourceFuel.unit) === "lb" },
    { value: "gal", label: "галлоны", selected: cleanText(sourceFuel.unit) === "gal" }
  ]
}
```

Replace the managed-user static rate metric in Handlebars with:

```hbs
<form class="rm-transport-fuel-consumption-form" data-transport-fuel-consumption-form data-actor-id="{{transport.activeVehicle.actorId}}">
  <input name="fuelConsumptionAmount" type="number" min="0.000001" step="any" value="{{transport.fuel.consumptionForm.amount}}" aria-label="Расход топлива">
  <select name="fuelConsumptionUnit" aria-label="Единица расхода топлива">
    {{#each transport.fuel.consumptionForm.unitOptions}}
      <option value="{{value}}" {{#if selected}}selected{{/if}}>{{label}}</option>
    {{/each}}
  </select>
  <span>/ милю</span>
  <button type="button" class="rm-button rm-button--small" data-action="transport-fuel-consumption-save" aria-label="Сохранить расход топлива">
    <i class="fa-solid fa-floppy-disk"></i>
  </button>
</form>
```

Render the existing formatted `<strong>` rate when `consumptionForm.canEdit` is false.

- [ ] **Step 4: Add focused horizontal styles**

```css
.rm-transport-fuel-consumption-form {
  display: grid;
  grid-template-columns: minmax(64px, 88px) minmax(82px, 104px) auto 30px;
  gap: 4px;
  align-items: center;
  white-space: nowrap;
}

.rm-transport-fuel-consumption-form input,
.rm-transport-fuel-consumption-form select {
  min-width: 0;
}
```

At the existing responsive breakpoint, set the form to `grid-template-columns: minmax(60px, 1fr) minmax(80px, 1fr) auto 30px` so it remains horizontal without overflowing.

- [ ] **Step 5: Run context/template tests and verify GREEN for rendering**

Run: `node --test --test-name-pattern="transport.*fuel|fuel.*card|fuel.*consumption" tests/inventory-app-context.test.mjs`

Expected: rendering tests PASS while the interaction test added next still does not exist.

- [ ] **Step 6: Write failing save interaction test**

Create fake form controls with amount `"120"`, unit `"lb"`, actor id `"vehicle-a"`, dispatch the save click, and assert the real InventoryApp handler records:

```js
[
  "updateTransportFuelConsumption",
  {
    groupActorId: "group-a",
    actorId: "vehicle-a",
    consumption: { amount: 120, unit: "lb" }
  }
]
```

Also assert `render({ force: true, preserveScroll: true })` is requested after success.

- [ ] **Step 7: Run the interaction test and verify RED**

Run: `node --test --test-name-pattern="fuel consumption save" tests/inventory-app-context.test.mjs`

Expected: FAIL because no save listener calls the module API.

- [ ] **Step 8: Bind save with validation feedback and preserved scroll**

```js
element.querySelector("[data-action='transport-fuel-consumption-save']")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const form = button.closest?.("[data-transport-fuel-consumption-form]");
  if (!form) return;
  const amountText = cleanText(form.querySelector?.("[name='fuelConsumptionAmount']")?.value).replace(",", ".");
  const unit = cleanText(form.querySelector?.("[name='fuelConsumptionUnit']")?.value);
  button.disabled = true;
  try {
    await this.moduleApi.updateTransportFuelConsumption?.({
      groupActorId: cleanText(this.groupActor?.id),
      actorId: cleanText(form.dataset?.actorId),
      consumption: { amount: Number(amountText), unit }
    });
    this.#setActionFeedback("success", "Расход топлива сохранён.");
    await this.render?.({ force: true, preserveScroll: true });
  }
  catch (error) {
    button.disabled = false;
    const message = error?.message || "Не удалось сохранить расход топлива.";
    this.#setActionFeedback("error", message);
    globalThis.ui?.notifications?.error?.(message);
  }
}, listenerOptions);
```

- [ ] **Step 9: Run InventoryApp tests and verify GREEN**

Run: `node --test tests/inventory-app-context.test.mjs`

Expected: PASS.

- [ ] **Step 10: Commit the card editor**

```powershell
git add -- scripts/ui/inventory-app.js templates/inventory-app.hbs styles/main.css tests/inventory-app-context.test.mjs
git commit -m "feat: edit fuel consumption on inventory card"
```

---

### Task 5: Final integration verification and publication

**Files:**
- Verify all files changed by Tasks 1–4 and the design/plan documents.

**Interfaces:**
- Consumes: the complete feature branch.
- Produces: a clean, tested, normally pushed `lich_branch` synchronized with `origin/lich_branch`.

- [ ] **Step 1: Run focused integration tests**

Run: `node --test tests/transport-fuel-consumption.test.mjs tests/transport-instance-service.test.mjs tests/transport-instance-socket.test.mjs tests/transport-fuel-service.test.mjs tests/group-inventory-migration.test.mjs tests/inventory-app-context.test.mjs tests/transport-vehicle-sheet.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 2: Run the complete repository suite**

Run: `node --test tests/*.test.mjs`

Expected: PASS with zero failures.

- [ ] **Step 3: Inspect final diff and repository state**

Run: `git diff --check`, `git status --short --branch`, and `git log --oneline origin/lich_branch..HEAD`.

Expected: no whitespace errors, only intended commits/files, and no unstaged changes.

- [ ] **Step 4: Fetch and confirm no remote divergence**

Run: `git fetch origin` followed by `git rev-list --left-right --count origin/lich_branch...lich_branch`.

Expected: remote side count `0`; local side contains only this feature's commits.

- [ ] **Step 5: Push without force**

Run: `git push origin lich_branch`.

Expected: normal fast-forward push succeeds.

- [ ] **Step 6: Confirm clean synchronized branch**

Run: `git status --short --branch` and `git rev-list --left-right --count origin/lich_branch...lich_branch`.

Expected: clean `lich_branch...origin/lich_branch` and `0 0` divergence.
