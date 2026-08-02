# Minimal Transport Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the duplicated transport dashboard with one active-first list whose rows show a one-third vehicle block, a two-thirds fuel block, drag-and-drop fuel assignment, and a single right-click settings dialog.

**Architecture:** Keep the existing transport instance, fuel selector, consumption override, and group `activeTransportId` storage unchanged. Enrich every vehicle in `InventoryService.getTransportSnapshot()` with its own fuel view, map that snapshot into row-oriented UI context, then render and bind a single reusable row pattern. The settings dialog stages edits in its own form and invokes the existing state, consumption, and active-transport APIs only from its explicit Save button.

**Tech Stack:** Foundry VTT ApplicationV2 with legacy `Dialog`, Handlebars, vanilla JavaScript ES modules, CSS Grid, Node.js built-in test runner.

## Global Constraints

- Work only on `lich_branch`; fetch `origin` and stop on foreign uncommitted changes or merge conflicts with `origin/main`.
- Do not add new transport, fuel-quantity, or travel persistence fields.
- Fuel quantity remains exclusively in matching inventory Items' `system.quantity`.
- A vehicle keeps one active Item selector and one `{ amount, unit }` consumption override.
- Fuel assignment remains standard Foundry Item drag-and-drop and must work for active and inactive vehicles.
- The main row contains no separate action buttons; vehicle and fuel cards open by left click.
- Right click opens one vehicle dialog; editable dialogs contain exactly one action button labelled `Сохранить`.
- Enter inside the dialog must not save, close, submit another Foundry form, or reload the client.
- The main transport/fuel blocks use a one-third/two-thirds horizontal split and stack only at the existing narrow breakpoint.
- Do not duplicate range in the transport row; the active range remains in the logistics header.
- Do not use force push.

## File Structure

- Modify `scripts/data/inventory-service.js`: attach an independent fuel snapshot to every concrete transport and order the active transport first while retaining top-level active summary compatibility.
- Modify `scripts/ui/inventory-app.js`: prepare row-level fuel/state context, retain the prepared transport context for event lookup, build the settings dialog, and replace one-off transport handlers with per-row handlers.
- Modify `templates/inventory-app.hbs`: replace all current transport overview/instance/list markup with one repeated two-block row.
- Modify `styles/main.css`: replace legacy transport dashboard rules with row, fuel drop-zone, and dialog styles.
- Modify `tests/group-inventory-migration.test.mjs`: cover independent fuel snapshots and active-first ordering at the data boundary.
- Modify `tests/inventory-app-context.test.mjs`: cover prepared rows, minimal markup, multi-row interactions, right-click dialog saving, Enter suppression, and removal of legacy controls.

---

### Task 1: Produce one fuel view per transport

**Files:**
- Modify: `scripts/data/inventory-service.js:1191-1291`
- Modify: `scripts/data/inventory-service.js:3942-4042`
- Test: `tests/group-inventory-migration.test.mjs:435-613`

**Interfaces:**
- Consumes: existing `buildTransportFuelSnapshot(vehicle, groupActor)` and normalized vehicle fields `fuelSelector`, `fuelConsumption`, and `consumption`.
- Produces: `snapshot.vehicles: Array<TransportProfile & { active: boolean, fuel: TransportFuelSnapshot }>` ordered active-first; `snapshot.fuel` remains the active row's `fuel` object for the logistics header.

- [ ] **Step 1: Extend the transport fixture with a second vehicle and distinct fuel**

Add a second Item and Actor to the existing native-fields test so each vehicle selects a different inventory Item and uses a different consumption unit:

```js
const cokeItem = createItem({
  id: "fuel-coke",
  name: "Кокс",
  quantity: 12,
  flags: {
    [MODULE_ID]: { sourceType: "good", sourceId: "coke" }
  },
  extra: { uuid: "Actor.group-a.Item.fuel-coke" }
});
const secondActor = createActor({
  id: "vehicle-b",
  name: "Броневик",
  type: "vehicle",
  isOwner: true,
  flags: {
    [MODULE_ID]: {
      sourceId: "transport-armored-car",
      transport: {
        instance: true,
        sourceActorUuid: "Compendium.world.rebreya-transport.Actor.armoredcar",
        groupActorId: "group-a",
        consumption: { kind: "fuel", amount: 0.5, unit: "lb", cadence: "mile", raw: "Кокс" },
        instanceState: {
          condition: "operational",
          fuelSelector: {
            uuid: "Compendium.world.goods.Item.coke",
            sourceType: "good",
            sourceId: "coke",
            type: "loot",
            normalizedName: "кокс",
            name: "Кокс",
            img: "icons/coke.webp"
          }
        }
      }
    }
  }
});
secondActor.system.attributes = {
  hp: { value: 40, max: 40 },
  ac: { flat: 15 },
  capacity: { cargo: { value: 1200, units: "lb" } },
  travel: { speeds: { land: 8 } }
};
```

Include `secondActor` in group members/context and `cokeItem` in group items. Set `groupState.transportState.activeTransportId` to `member:vehicle-b`.
Replace the existing positional member lookup with an identity lookup so alphabetical ordering cannot invalidate the original assertions:

```js
const member = snapshot.members.find((entry) => entry.actorId === "vehicle-a");
assert.ok(member);
```

- [ ] **Step 2: Assert active-first ordering and independent fuel snapshots**

Add exact assertions after `getTransportSnapshot()`:

```js
assert.deepEqual(transportSnapshot.vehicles.map((vehicle) => vehicle.id), [
  "member:vehicle-b",
  "member:vehicle-a"
]);
assert.equal(transportSnapshot.vehicles[0].active, true);
assert.equal(transportSnapshot.vehicles[0].fuel.card.name, "Кокс");
assert.equal(transportSnapshot.vehicles[0].fuel.quantity, 12);
assert.equal(transportSnapshot.vehicles[0].fuel.consumptionPerMile, 0.5);
assert.equal(transportSnapshot.vehicles[0].fuel.unit, "lb");
assert.equal(transportSnapshot.vehicles[1].active, false);
assert.equal(transportSnapshot.vehicles[1].fuel.card.name, "Жидкий уголь");
assert.equal(transportSnapshot.vehicles[1].fuel.quantity, 5);
assert.equal(transportSnapshot.vehicles[1].fuel.consumptionPerMile, 2);
assert.equal(transportSnapshot.fuel, transportSnapshot.vehicles[0].fuel);
```

- [ ] **Step 3: Run the focused data test and verify the new assertions fail**

Run:

```powershell
node --test tests/group-inventory-migration.test.mjs
```

Expected: FAIL because `vehicles[0]` is not guaranteed to be active and vehicle rows do not contain `fuel`.

- [ ] **Step 4: Enrich and order vehicles in `getTransportSnapshot()`**

Replace the active-state-only mapping with an active-first row mapping:

```js
const vehicleRows = vehicles
  .map((vehicle) => ({
    ...vehicle,
    active: Boolean(activeVehicle && vehicle.id === activeVehicle.id),
    fuel: buildTransportFuelSnapshot(vehicle, groupContext?.groupActor)
  }))
  .sort((left, right) => Number(right.active) - Number(left.active));
const activeVehicleRow = vehicleRows.find((vehicle) => vehicle.active) ?? null;
const fuel = activeVehicleRow?.fuel ?? buildTransportFuelSnapshot(null, groupContext?.groupActor);
```

Return `vehicles: vehicleRows`, derive `hasVehicles` from `vehicleRows.length`, and return `activeVehicle: activeVehicleRow`. Do not change speed, cargo, travel, or top-level `fuel` calculations.

- [ ] **Step 5: Run the focused data test and the transport service tests**

Run:

```powershell
node --test tests/group-inventory-migration.test.mjs tests/transport-fuel-service.test.mjs tests/travel-service.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 6: Commit the data boundary**

```powershell
git add scripts/data/inventory-service.js tests/group-inventory-migration.test.mjs
git commit -m "refactor: expose fuel per transport row"
```

---

### Task 2: Prepare row-oriented transport UI context

**Files:**
- Modify: `scripts/ui/inventory-app.js:1480-1586`
- Modify: `scripts/ui/inventory-app.js:3796-3802`
- Test: `tests/inventory-app-context.test.mjs:1820-1950`

**Interfaces:**
- Consumes: Task 1 `snapshot.vehicles[*].fuel` and the existing transport profile fields.
- Produces: each prepared row contains `fuel`, `stateForm`, `canOpen`, and dialog-ready display labels; `this.transportContext` points to the prepared object used by right-click handlers.

- [ ] **Step 1: Rewrite the context test around two complete rows**

Use a snapshot with active `member:vehicle-b`, one configured fuel, and one unconfigured fuel, then assert row-level context:

```js
assert.deepEqual(context.transport.vehicles.map((vehicle) => vehicle.id), [
  "member:vehicle-b",
  "member:vehicle-a"
]);
const active = context.transport.vehicles[0];
const inactive = context.transport.vehicles[1];
assert.equal(active.active, true);
assert.equal(active.fuel.card.name, "Кокс");
assert.equal(active.fuel.consumptionForm.amount, "0.5");
assert.equal(active.fuel.consumptionForm.unitOptions.find((entry) => entry.value === "lb").selected, true);
assert.equal(active.stateForm.hpCurrent, "40");
assert.equal(active.stateForm.conditionOptions.find((entry) => entry.value === "operational").selected, true);
assert.equal(inactive.active, false);
assert.equal(inactive.fuel.configured, false);
assert.equal(inactive.fuel.emptyLabel, "Добавьте топливо");
assert.equal(inactive.stateForm.canEdit, true);
assert.equal(app.transportContext, context.transport);
```

- [ ] **Step 2: Run the focused UI context test and verify it fails**

Run:

```powershell
node --test --test-name-pattern="transport tab" tests/inventory-app-context.test.mjs
```

Expected: FAIL because fuel/state preparation still targets only `activeVehicle` and `transportContext` is not retained.

- [ ] **Step 3: Extract row preparation helpers**

Implement the following stable helper boundary above `prepareTransportContext`:

```js
function prepareTransportFuelContext(sourceFuel = {}, { canManage = false, vehicle = null } = {}) {
  const configured = sourceFuel?.configured === true;
  const unit = cleanText(sourceFuel?.unit);
  return {
    ...sourceFuel,
    configured,
    selector: sourceFuel?.selector && typeof sourceFuel.selector === "object" ? sourceFuel.selector : {},
    card: sourceFuel?.card && typeof sourceFuel.card === "object" ? sourceFuel.card : null,
    quantity: Math.max(0, toNumber(sourceFuel?.quantity, 0)),
    consumptionPerMile: Math.max(0, toNumber(sourceFuel?.consumptionPerMile, 0)),
    isEmpty: configured && sourceFuel?.isEmpty === true,
    emptyLabel: "Добавьте топливо",
    consumptionForm: {
      canEdit: Boolean(canManage && vehicle?.isConcreteInstance && configured),
      amount: String(Math.max(0, toNumber(sourceFuel?.consumptionPerMile, 0))),
      unitOptions: [
        { value: "lb", label: "фунты", selected: unit === "lb" },
        { value: "gal", label: "галлоны", selected: unit === "gal" }
      ]
    }
  };
}

function prepareTransportVehicleContext(vehicle = {}, { canManage = false } = {}) {
  const condition = cleanText(vehicle.condition) || "operational";
  return {
    ...vehicle,
    canOpen: Boolean(vehicle.actorId || vehicle.actorUuid),
    fuel: prepareTransportFuelContext(vehicle.fuel, { canManage, vehicle }),
    stateForm: {
      canEdit: Boolean(canManage && vehicle.isActorBacked && vehicle.canEditState !== false),
      hpCurrent: String(Number.isFinite(Number(vehicle.hpValue)) ? Number(vehicle.hpValue) : 0),
      conditionOptions: TRANSPORT_CONDITION_OPTIONS.map((option) => ({
        ...option,
        selected: option.value === condition
      }))
    }
  };
}
```

Make `prepareTransportContext()` map all `source.vehicles`, derive `activeVehicle` from the prepared rows, and retain the separately supplied top-level active fuel only for the logistics header.

- [ ] **Step 4: Retain the prepared context on the application instance**

Immediately after preparing transport context in `_prepareContext()`:

```js
const transport = prepareTransportContext(
  transportSnapshot ?? buildEmptyTransportContext({ warning: transportWarning })
);
this.transportContext = transport;
```

Do not store raw Foundry Documents in this property.

- [ ] **Step 5: Run focused context and header tests**

Run:

```powershell
node --test --test-name-pattern="transport|logistics header" tests/inventory-app-context.test.mjs
```

Expected: all matching tests PASS; the logistics header still reads the active top-level range.

- [ ] **Step 6: Commit the prepared view model**

```powershell
git add scripts/ui/inventory-app.js tests/inventory-app-context.test.mjs
git commit -m "refactor: prepare compact transport rows"
```

---

### Task 3: Replace the dashboard with the two-block list

**Files:**
- Modify: `templates/inventory-app.hbs:657-885`
- Modify: `styles/main.css:5924-6303`
- Modify: `styles/main.css:9680-9710`
- Test: `tests/inventory-app-context.test.mjs:1900-1950`
- Test: `tests/inventory-app-context.test.mjs:2495-2520`

**Interfaces:**
- Consumes: Task 2 `transport.vehicles[*]` with nested `fuel`, `active`, `actorId`, and `canOpen`.
- Produces: DOM hooks `[data-transport-row]`, `[data-action='open-transport-document']`, `[data-action='transport-fuel-dropzone']`, and `[data-action='open-transport-fuel-item']` for Task 4.

- [ ] **Step 1: Replace static template/style expectations with the minimal contract**

Assert the new structure and forbidden legacy elements:

```js
assert.match(transportPanel, /data-transport-row/u);
assert.match(transportPanel, /data-action="open-transport-document"/u);
assert.match(transportPanel, /data-action="transport-fuel-dropzone"/u);
assert.match(transportPanel, /Добавьте топливо/u);
assert.match(transportPanel, /data-action="open-transport-fuel-item"/u);
assert.match(transportPanel, /fuel\.consumptionPerMile/u);
assert.doesNotMatch(transportPanel, /rm-transport-overview/u);
assert.doesNotMatch(transportPanel, /rm-transport-instance/u);
assert.doesNotMatch(transportPanel, /transport-state-save/u);
assert.doesNotMatch(transportPanel, /transport-fuel-consumption-save/u);
assert.doesNotMatch(transportPanel, /transport-select/u);
assert.doesNotMatch(transportPanel, /Открыть лист/u);
assert.doesNotMatch(transportPanel, /Запас хода/u);
assert.match(css, /\.rm-transport-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*2fr\)/su);
```

- [ ] **Step 2: Run the focused markup test and verify it fails**

Run:

```powershell
node --test --test-name-pattern="transport tab renders|template exposes the transport" tests/inventory-app-context.test.mjs
```

Expected: FAIL because the old overview, state form, fuel card editor, and selection buttons still exist.

- [ ] **Step 3: Replace the Handlebars transport body with one row loop**

Use one semantic row per vehicle:

```hbs
{{#if transport.hasVehicles}}
  <div class="rm-transport-list">
    {{#each transport.vehicles}}
      <article
        class="rm-transport-row {{#if active}}is-active{{/if}}"
        data-transport-row
        data-transport-id="{{id}}"
        data-actor-id="{{actorId}}"
        title="ПКМ — подробности и настройка"
      >
        <section class="rm-transport-row__vehicle">
          <img class="rm-transport-row__image" src="{{img}}" alt="">
          <button
            type="button"
            class="rm-link-button rm-transport-row__name"
            data-action="open-transport-document"
            data-actor-id="{{actorId}}"
            title="ЛКМ — открыть карточку транспорта"
            {{#unless canOpen}}disabled{{/unless}}
          >{{name}}</button>
          {{#if active}}<span class="rm-transport-row__active">Активен</span>{{/if}}
        </section>

        <section
          class="rm-transport-row__fuel {{#if fuel.isEmpty}}is-empty{{/if}} {{#unless fuel.configured}}is-unconfigured{{/unless}}"
          {{#if ../transport.canManage}}data-action="transport-fuel-dropzone"{{/if}}
          data-actor-id="{{actorId}}"
        >
          {{#if fuel.configured}}
            <button type="button" class="rm-transport-row__fuel-item" data-action="open-transport-fuel-item" data-item-uuid="{{fuel.card.openUuid}}" {{#unless fuel.card.canOpen}}disabled{{/unless}}>
              <img src="{{fuel.card.img}}" alt="">
              <strong>{{fuel.card.name}}</strong>
            </button>
            <span class="rm-transport-row__fuel-value {{#if fuel.isEmpty}}rm-negative{{/if}}">{{rmNum fuel.quantity}} {{fuel.unit}}</span>
            <span class="rm-transport-row__fuel-consumption">{{rmNum fuel.consumptionPerMile}} {{fuel.unit}}/миля</span>
          {{else}}
            <span class="rm-transport-row__fuel-empty"><i class="fa-solid fa-gas-pump"></i> Добавьте топливо</span>
          {{/if}}
        </section>
      </article>
    {{/each}}
  </div>
{{else}}
  <p class="rm-empty">В группе пока нет транспорта.</p>
{{/if}}
```

Keep the existing warning branch, but remove the panel speed badge and every legacy transport subsection.

- [ ] **Step 4: Replace legacy transport CSS with the compact grid**

Implement the stable layout rules:

```css
.rm-transport-list {
  display: grid;
  gap: 8px;
}

.rm-transport-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(13, 16, 22, 0.76);
}

.rm-transport-row.is-active {
  border-color: rgba(213, 166, 70, 0.65);
  background: rgba(46, 42, 32, 0.72);
}

.rm-transport-row__vehicle,
.rm-transport-row__fuel {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}

.rm-transport-row__fuel {
  border-left: 1px solid rgba(255, 255, 255, 0.1);
}

.rm-transport-row__name,
.rm-transport-row__fuel-item strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rm-transport-row__fuel.is-dragover {
  border-color: var(--rm-accent);
  box-shadow: inset 0 0 0 1px var(--rm-accent);
}

@media (max-width: 1200px) {
  .rm-transport-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .rm-transport-row__fuel {
    border-left: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }
}
```

Add the concrete sizing/alignment rules below so both metrics stay visible and long names truncate:

```css
.rm-transport-row__image,
.rm-transport-row__fuel-item img {
  flex: 0 0 38px;
  width: 38px;
  height: 38px;
  object-fit: cover;
  border-radius: 4px;
}

.rm-transport-row__fuel-item {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.rm-transport-row__fuel-value {
  margin-left: auto;
  white-space: nowrap;
}

.rm-transport-row__fuel-consumption {
  flex: 0 0 auto;
  min-width: 112px;
  text-align: right;
  white-space: nowrap;
}
```

- [ ] **Step 5: Run the focused template/style tests**

Run:

```powershell
node --test --test-name-pattern="transport tab renders|template exposes the transport" tests/inventory-app-context.test.mjs
```

Expected: matching tests PASS.

- [ ] **Step 6: Commit the minimal list**

```powershell
git add templates/inventory-app.hbs styles/main.css tests/inventory-app-context.test.mjs
git commit -m "feat: render minimal transport rows"
```

---

### Task 4: Bind row actions and the single-save settings dialog

**Files:**
- Modify: `scripts/ui/inventory-app.js:2600-2860`
- Modify: `scripts/ui/inventory-app.js:5634-5802`
- Modify: `styles/main.css:5924-6303`
- Test: `tests/inventory-app-context.test.mjs:1950-2240`

**Interfaces:**
- Consumes: Task 2 `this.transportContext.vehicles`, Task 3 DOM hooks, and existing module API methods `updateTransportInstanceState(payload)`, `updateTransportFuelConsumption(payload)`, `setActiveTransport(id)`, and `selectTransportFuel(payload)`.
- Produces: `buildTransportDialogContent(vehicle, { canManage })`, private `InventoryApp.#openTransportDialog(transportId)`, and private `InventoryApp.#saveTransportDialog(vehicle, root, dialog, button)`; no new public module API.

- [ ] **Step 1: Add failing tests for all per-row actions**

Construct two fake rows/drop-zones/open controls and assert:

```js
assert.equal(firstRow.listeners.contextmenu.length, 1);
assert.equal(secondRow.listeners.contextmenu.length, 1);
await secondDropzone.listeners.drop[0]({
  dragData: { type: "Item", uuid: "Compendium.world.goods.Item.coke" },
  preventDefault() {}
});
assert.deepEqual(calls.filter((call) => call[0] === "selectTransportFuel").at(-1), [
  "selectTransportFuel",
  {
    groupActorId: "group-a",
    actorId: "vehicle-b",
    itemUuid: "Compendium.world.goods.Item.coke"
  }
]);
```

Assert that left-clicking each vehicle control opens its own Actor sheet and each fuel control resolves its own Item UUID.

- [ ] **Step 2: Add a fake Dialog test for the right-click form**

Install a `globalThis.Dialog` stub that records `data`, invokes `render(root)`, and exposes `close()`. Build controls for `active`, `hpCurrent`, `condition`, `fuelConsumptionAmount`, `fuelConsumptionUnit`, and `transport-dialog-save`. Verify:

```js
row.listeners.contextmenu[0]({ currentTarget: row, preventDefault() {}, stopPropagation() {} });
assert.equal(dialogData.buttons && Object.keys(dialogData.buttons).length, 0);
assert.match(dialogData.content, />Сохранить</u);
assert.doesNotMatch(dialogData.content, />Отмена</u);

const enterEvent = { key: "Enter", preventDefaultCalled: false, stopPropagationCalled: false,
  preventDefault() { this.preventDefaultCalled = true; },
  stopPropagation() { this.stopPropagationCalled = true; } };
form.listeners.keydown[0](enterEvent);
assert.equal(enterEvent.preventDefaultCalled, true);
assert.equal(calls.filter((call) => call[0].startsWith("updateTransport")).length, 0);

await dispatchClick(saveButton);
assert.deepEqual(calls.filter((call) => call[0] === "updateTransportInstanceState").at(-1)[1], {
  groupActorId: "group-a",
  actorId: "vehicle-b",
  patch: { hpCurrent: 35, condition: "damaged" }
});
assert.deepEqual(calls.filter((call) => call[0] === "updateTransportFuelConsumption").at(-1)[1], {
  groupActorId: "group-a",
  actorId: "vehicle-b",
  consumption: { amount: 0.75, unit: "lb" }
});
assert.deepEqual(calls.filter((call) => call[0] === "setActiveTransport").at(-1), [
  "setActiveTransport",
  "member:vehicle-b"
]);
```

Add an error variant where the consumption update rejects; assert the dialog does not close, the button is re-enabled, and input values remain unchanged.

- [ ] **Step 3: Run the focused interaction tests and verify they fail**

Run:

```powershell
node --test --test-name-pattern="transport fuel drop|transport dialog|transport document" tests/inventory-app-context.test.mjs
```

Expected: FAIL because only one drop-zone/open button is bound and no row context-menu dialog exists.

- [ ] **Step 4: Build escaped dialog content with one custom Save button**

Add a pure HTML builder near the existing prompt helpers. Escape every vehicle-derived string and render disabled controls when `canManage` is false:

```js
function buildTransportDialogContent(vehicle = {}, { canManage = false } = {}) {
  const disabled = canManage ? "" : " disabled";
  const fuelName = cleanText(vehicle.fuel?.card?.name) || "Топливо не назначено";
  const hpMax = Math.max(0, Number(vehicle.hpMax) || 0);
  const hpMaxAttribute = hpMax > 0 ? ` max="${hpMax}"` : "";
  return `
    <form class="rm-transport-dialog" data-transport-dialog-form>
      <label class="rm-transport-dialog__active">
        <input type="checkbox" name="active" ${vehicle.active ? "checked" : ""}${disabled}>
        <span>Активный транспорт</span>
      </label>
      <div class="rm-transport-dialog__fields">
        <label><span>Хиты</span><input type="number" name="hpCurrent" min="0"${hpMaxAttribute} value="${Number(vehicle.hpValue) || 0}"${disabled}></label>
        <label><span>Состояние</span><select name="condition"${disabled}>${TRANSPORT_CONDITION_OPTIONS.map((option) => `<option value="${option.value}" ${option.value === vehicle.condition ? "selected" : ""}>${option.label}</option>`).join("")}</select></label>
        <label><span>Расход</span><input type="number" name="fuelConsumptionAmount" min="0.000001" step="any" value="${Number(vehicle.fuel?.consumptionPerMile) || 0}"${disabled}></label>
        <label><span>Единица</span><select name="fuelConsumptionUnit"${disabled}><option value="lb" ${vehicle.fuel?.unit === "lb" ? "selected" : ""}>фунты</option><option value="gal" ${vehicle.fuel?.unit === "gal" ? "selected" : ""}>галлоны</option></select></label>
      </div>
      <p class="rm-transport-dialog__fuel"><span>Топливо</span><strong>${escapeHtml(fuelName)}</strong></p>
      <div class="rm-transport-dialog__specs">${buildTransportDialogSpecs(vehicle)}</div>
      ${canManage ? '<footer><button type="button" class="rm-button rm-button--primary" data-action="transport-dialog-save">Сохранить</button></footer>' : ""}
    </form>`;
}
```

Implement `buildTransportDialogSpecs(vehicle)` with escaped display-only cells:

```js
function buildTransportDialogSpecs(vehicle = {}) {
  const specs = [
    ["Скорость", vehicle.speedLabel || "—"],
    ["Грузоподъёмность", vehicle.cargoLabel || "—"],
    ["КД", vehicle.acLabel || "—"],
    ["Экипаж", vehicle.crewLabel || "—"],
    ["Пассажиры", vehicle.passengersLabel || "—"],
    ["Разгон", vehicle.accelerationFt ? `${vehicle.accelerationFt} фт.` : "—"],
    ["Поломка, к20", vehicle.breakdownThreshold || "—"]
  ];
  return specs.map(([label, value]) => `
    <p><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></p>
  `).join("");
}
```

- [ ] **Step 5: Implement controlled dialog saving**

Create `#openTransportDialog(transportId)` that looks up the prepared row, creates `new Dialog({ buttons: {} })`, prevents `submit` and Enter, and binds only the custom Save button. Validate all values before the first write:

```js
#openTransportDialog(transportId) {
  const vehicle = (this.transportContext?.vehicles ?? [])
    .find((entry) => entry.id === cleanText(transportId));
  const DialogClass = globalThis.Dialog;
  if (!vehicle || typeof DialogClass !== "function") return;

  const dialog = new DialogClass({
    title: vehicle.name,
    content: buildTransportDialogContent(vehicle, {
      canManage: Boolean(this.transportContext?.canManage)
    }),
    buttons: {},
    render: (html) => {
      const root = getDialogRoot(html);
      const form = root?.querySelector?.("[data-transport-dialog-form]");
      form?.addEventListener("submit", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      form?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
      });
      root?.querySelector?.("[data-action='transport-dialog-save']")
        ?.addEventListener("click", async (event) => {
          await this.#saveTransportDialog(vehicle, root, dialog, event.currentTarget);
        });
    }
  }, {
    classes: ["rebreya-main", "rebreya-trader-dialog", "rm-transport-dialog-window"],
    width: 720
  });
  renderDialogOnTop(dialog);
}
```

Implement `#saveTransportDialog(vehicle, root, dialog, button)` around the following validated write sequence:

```js
async #saveTransportDialog(vehicle, root, dialog, button) {
  const field = (name) => root.querySelector?.(`[name='${name}']`);
  button.disabled = true;
  try {
    const hpCurrent = Number(field("hpCurrent")?.value);
    const amount = Number(cleanText(field("fuelConsumptionAmount")?.value).replace(",", "."));
    const unit = cleanText(field("fuelConsumptionUnit")?.value);
    if (!Number.isFinite(hpCurrent) || hpCurrent < 0 || (vehicle.hpMax > 0 && hpCurrent > vehicle.hpMax)) {
      throw new Error("Проверьте текущие хиты транспорта.");
    }
    if (vehicle.fuel.configured && (!Number.isFinite(amount) || amount <= 0 || !["lb", "gal"].includes(unit))) {
      throw new Error("Проверьте расход и единицу топлива.");
    }
    await this.moduleApi.updateTransportInstanceState({
      groupActorId: cleanText(this.groupActor?.id),
      actorId: cleanText(vehicle.actorId),
      patch: { hpCurrent, condition: cleanText(field("condition")?.value) }
    });
    if (vehicle.fuel.configured) {
      await this.moduleApi.updateTransportFuelConsumption({
        groupActorId: cleanText(this.groupActor?.id),
        actorId: cleanText(vehicle.actorId),
        consumption: { amount, unit }
      });
    }
    const active = Boolean(field("active")?.checked);
    if (active !== Boolean(vehicle.active)) {
      await this.moduleApi.setActiveTransport(active ? vehicle.id : "");
    }
    dialog.close();
    await this.render({ force: true, preserveScroll: true });
  }
  catch (error) {
    button.disabled = false;
    const message = error?.message || "Не удалось сохранить транспорт.";
    this.#setActionFeedback("error", message);
    globalThis.ui?.notifications?.error?.(message);
  }
}
```

- [ ] **Step 6: Bind every row, drop-zone, vehicle link, and fuel link**

Replace singular bindings with per-row loops. The transport row and drop-zone boundaries must follow this shape:

```js
element.querySelectorAll("[data-transport-row]").forEach((row) => {
  row.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    this.#openTransportDialog(cleanText(row.dataset.transportId));
  }, listenerOptions);
});

element.querySelectorAll("[data-action='transport-fuel-dropzone']").forEach((dropzone) => {
  dropzone.addEventListener("dragover", onTransportFuelDragOver, listenerOptions);
  dropzone.addEventListener("dragleave", onTransportFuelDragLeave, listenerOptions);
  dropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropzone.classList?.remove?.("is-dragover");
    const dragData = globalThis.TextEditor?.getDragEventData?.(event);
    const itemUuid = cleanText(dragData?.uuid);
    if (dragData?.type !== "Item" || !itemUuid) {
      globalThis.ui?.notifications?.warn?.("Перетащите сюда предмет топлива.");
      return;
    }
    await this.moduleApi.selectTransportFuel({
      groupActorId: cleanText(this.groupActor?.id),
      actorId: cleanText(dropzone.dataset.actorId),
      itemUuid
    });
  }, listenerOptions);
});
```

Define the drag helpers once inside `_onRender` so the loops do not duplicate validation:

```js
const onTransportFuelDragOver = (event) => {
  let dragData = null;
  try {
    dragData = globalThis.TextEditor?.getDragEventData?.(event);
  }
  catch (_error) {
    return;
  }
  if (dragData?.type !== "Item" || !cleanText(dragData.uuid)) return;
  event.preventDefault();
  event.currentTarget.classList?.add?.("is-dragover");
};
const onTransportFuelDragLeave = (event) => {
  const dropzone = event.currentTarget;
  if (event.relatedTarget && dropzone.contains?.(event.relatedTarget)) return;
  dropzone.classList?.remove?.("is-dragover");
};
```

Replace `open-transport-actor-sheet` with the following per-control binding:

```js
element.querySelectorAll("[data-action='open-transport-document']").forEach((control) => {
  control.addEventListener("click", (event) => {
    event.stopPropagation();
    const actorId = cleanText(event.currentTarget.dataset.actorId);
    const actor = globalThis.game?.actors?.get?.(actorId)
      ?? globalThis.game?.actors?.contents?.find?.((entry) => entry?.id === actorId);
    if (!actor?.sheet) {
      globalThis.ui?.notifications?.warn?.("Карточка транспорта недоступна.");
      return;
    }
    actor.sheet.render?.(true);
    bringAppToFront(actor.sheet);
  }, listenerOptions);
});
```

Call `event.stopPropagation()` from left-click open handlers so opening a card never triggers row configuration.

- [ ] **Step 7: Style the dialog without introducing extra action buttons**

Add the dialog layout below. The only dialog action selector is `[data-action='transport-dialog-save']`:

```css
.rm-transport-dialog-window .window-content {
  padding: 14px;
}

.rm-transport-dialog {
  display: grid;
  gap: 12px;
}

.rm-transport-dialog__fields,
.rm-transport-dialog__specs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.rm-transport-dialog__fields label,
.rm-transport-dialog__specs p,
.rm-transport-dialog__fuel {
  min-width: 0;
  margin: 0;
  padding: 8px;
  border: 1px solid var(--rm-border-subtle);
  background: var(--rm-surface-subtle);
}

.rm-transport-dialog footer {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 760px) {
  .rm-transport-dialog__fields,
  .rm-transport-dialog__specs {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

- [ ] **Step 8: Run focused interaction tests**

Run:

```powershell
node --test --test-name-pattern="transport fuel drop|transport dialog|transport document" tests/inventory-app-context.test.mjs
```

Expected: all matching tests PASS.

- [ ] **Step 9: Commit the interaction layer**

```powershell
git add scripts/ui/inventory-app.js styles/main.css tests/inventory-app-context.test.mjs
git commit -m "feat: configure transport rows by context menu"
```

---

### Task 5: Remove obsolete transport code and prove the complete flow

**Files:**
- Modify: `scripts/ui/inventory-app.js:1480-1586`
- Modify: `scripts/ui/inventory-app.js:5634-5802`
- Modify: `styles/main.css:5924-6303`
- Modify: `styles/main.css:9680-9710`
- Modify: `tests/inventory-app-context.test.mjs:1820-2240`
- Modify: `tests/inventory-app-context.test.mjs:2495-2520`

**Interfaces:**
- Consumes: completed row snapshot, context, markup, and dialog contracts from Tasks 1-4.
- Produces: no legacy transport forms, buttons, handlers, or selectors; full automated and live Foundry verification evidence.

- [ ] **Step 1: Add explicit absence assertions for obsolete behavior**

Keep these assertions in the template test:

```js
for (const obsolete of [
  "transport-select",
  "transport-state-save",
  "transport-fuel-consumption-save",
  "data-transport-state-form",
  "data-transport-fuel-consumption-form",
  "open-transport-actor-sheet",
  "rm-transport-overview",
  "rm-transport-instance",
  "rm-transport-summary",
  "rm-transport-specs"
]) {
  assert.doesNotMatch(transportPanel, new RegExp(obsolete, "u"));
}
```

Read `scripts/ui/inventory-app.js` and `styles/main.css` in the same test and assert the removed action names and legacy transport selectors are absent there as well.

- [ ] **Step 2: Run the absence test and remove every reported legacy reference**

Run:

```powershell
node --test --test-name-pattern="template exposes the transport" tests/inventory-app-context.test.mjs
```

Expected before cleanup: FAIL for each leftover old handler or CSS selector. Remove only transport-specific dead code; retain top-level active `transport.fuel`, speed, cargo, and durability data used by the inventory logistics header and travel calculations.

- [ ] **Step 3: Run all transport-focused tests**

Run:

```powershell
node --test --test-name-pattern="transport|fuel|logistics header" tests/*.test.mjs
```

Expected: all matching tests PASS.

- [ ] **Step 4: Run the complete automated suite**

Run:

```powershell
node --test tests/*.test.mjs
```

Expected: zero failed tests.

- [ ] **Step 5: Inspect the final diff and repository state**

Run:

```powershell
git diff --check
git diff --stat origin/lich_branch...HEAD
git status --short --branch
```

Expected: no whitespace errors, only the planned files changed, and no foreign uncommitted files.

- [ ] **Step 6: Verify the live Foundry workflow**

Using the configured CODEX Foundry profile, verify in order:

1. The active machine is first and highlighted.
2. Every row remains a one-third/two-thirds horizontal pair at normal width.
3. Long vehicle and fuel names remain inside their blocks.
4. A row without fuel reads `Добавьте топливо`.
5. Dragging an Item from a compendium onto an inactive row assigns fuel only to that machine.
6. Left click opens the vehicle or fuel card without extra buttons.
7. Right click opens the matching machine's dialog.
8. Enter in each editable field does nothing.
9. The single `Сохранить` button persists hits, condition, consumption, and active state.
10. Switching active state in the dialog updates the group token and moves the row to the top.
11. Zero fuel quantity is red.
12. The logistics header still reports the active machine's fuel range.
13. No removed overview, expense, state, spec, open-sheet, or selection block remains.
14. The browser console has no new module errors.

- [ ] **Step 7: Commit final cleanup if Step 2 changed files**

```powershell
git add scripts/ui/inventory-app.js templates/inventory-app.hbs styles/main.css tests/inventory-app-context.test.mjs
git commit -m "test: verify minimal transport workflow"
```

If the cleanup produced no new diff, do not create an empty commit.

- [ ] **Step 8: Push without rewriting history**

```powershell
git push origin lich_branch
```

Expected: a normal fast-forward update of `origin/lich_branch`; never use `--force`.
