# Craftsman Physical Gadget Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace temporary Craftsman gadget feats with native physical `rebreya-main.gadget` inventory Items that stack, split into an active copy on use, and are fully replaced on the next long rest.

**Architecture:** Register a custom dnd5e Item DataModel derived from the native consumable model and give it its own native inventory section. Keep compendium feats as verbatim library templates, transform them into physical gadget sources at rest, and let the existing gadget service own state transitions and effect cleanup. Store immutable activity sources in module flags so prepared, active, and spent Items expose only their valid native activities.

**Tech Stack:** Foundry VTT 13, dnd5e 5.2.5, JavaScript ES modules, `node:test`

## Global Constraints

- Work only on `lich_branch`; never commit or push to `main` or `master`.
- Fetch `origin` and stop if foreign uncommitted changes or divergence from the current primary branch is detected.
- Do not use force push.
- Gadget rules text from `data/craftsman-v01.json` remains verbatim; do not shorten or rewrite it.
- Only Items with `flags.rebreya-main.craftsmanGadget.managed === true` may be mutated or deleted by this automation.
- The supported sheet is the native dnd5e 5.2.5 Character Sheet; do not patch Handlebars templates or move DOM rows.
- The compendium remains a library of four base gadgets and two Mechanic gadgets.
- A world reload is required after adding `documentTypes.Item.gadget`.

---

## File Structure

- `scripts/integrations/craftsman-gadget-item-type.js`: register the custom physical Item DataModel and native inventory section.
- `scripts/data/craftsman-gadget-item-data.js`: transform library feat sources into physical gadget sources and switch their activity sets by state.
- `scripts/combat/craftsman-gadget-service.js`: group rest selections, split stacks transactionally, serialize activations, and clean all managed generations.
- `tests/craftsman-gadget-item-type.test.mjs`: verify registration and inventory metadata without a Foundry runtime.
- `tests/craftsman-gadget-item-data.test.mjs`: verify source conversion and prepared/active/spent activity projections.
- `tests/craftsman-gadget-service.test.mjs`: verify rest replacement, stack splitting, rollback, smoke identity, and existing automation.

---

### Task 1: Register the native physical gadget Item type

**Files:**
- Create: `scripts/integrations/craftsman-gadget-item-type.js`
- Modify: `scripts/constants.js`
- Modify: `scripts/integrations/dnd5e-sheet-extensions.js`
- Modify: `module.json`
- Modify: `lang/ru.json`
- Create: `tests/craftsman-gadget-item-type.test.mjs`
- Modify: `tests/module-manifest.test.mjs`

**Interfaces:**
- Consumes: `MODULE_ID` from `scripts/constants.js` and `CONFIG.Item.dataModels.consumable` supplied by dnd5e.
- Produces: `CRAFTSMAN_GADGET_ITEM_TYPE: "rebreya-main.gadget"`, `registerCraftsmanGadgetItemType(): boolean`, and `getCraftsmanGadgetItemDataModel(): Function | null`.

- [ ] **Step 1: Write failing registration and manifest tests**

```js
test("registers the Craftsman gadget as a native consumable-derived inventory section", () => {
  class ConsumableData {}
  globalThis.CONFIG = {
    Item: {
      dataModels: { consumable: ConsumableData },
      typeLabels: {},
      typeIcons: {}
    }
  };

  assert.equal(registerCraftsmanGadgetItemType(), true);
  const Model = getCraftsmanGadgetItemDataModel();
  assert.equal(Object.getPrototypeOf(Model), ConsumableData);
  assert.deepEqual(Model.inventorySection, {
    id: "craftsman-gadgets",
    order: 350,
    label: "TYPES.Item.rebreya-main.gadgetPl",
    groups: { type: "rebreya-main.gadget" },
    columns: ["price", "weight", "quantity", "charges", "controls"]
  });
  assert.equal(CONFIG.Item.dataModels["rebreya-main.gadget"], Model);
});

test("declares the gadget document type in the module manifest", () => {
  assert.ok(manifest.documentTypes.Item.gadget);
  assert.equal(manifest.documentTypes.Item.gadget.htmlFields[0], "description.value");
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/craftsman-gadget-item-type.test.mjs tests/module-manifest.test.mjs`

Expected: FAIL because the constant, registration module, and manifest entry do not exist.

- [ ] **Step 3: Implement the focused registration module**

```js
import { CRAFTSMAN_GADGET_ITEM_TYPE } from "../constants.js";

let CraftsmanGadgetItemDataModel = null;

export function getCraftsmanGadgetItemDataModel() {
  return CraftsmanGadgetItemDataModel;
}

export function registerCraftsmanGadgetItemType() {
  const ItemConfig = globalThis.CONFIG?.Item;
  const ConsumableData = ItemConfig?.dataModels?.consumable;
  if (!ItemConfig || typeof ConsumableData !== "function") return false;

  if (!CraftsmanGadgetItemDataModel || Object.getPrototypeOf(CraftsmanGadgetItemDataModel) !== ConsumableData) {
    CraftsmanGadgetItemDataModel = class CraftsmanGadgetItemData extends ConsumableData {
      static inventorySection = {
        id: "craftsman-gadgets",
        order: 350,
        label: "TYPES.Item.rebreya-main.gadgetPl",
        groups: { type: CRAFTSMAN_GADGET_ITEM_TYPE },
        columns: ["price", "weight", "quantity", "charges", "controls"]
      };
    };
  }

  ItemConfig.dataModels[CRAFTSMAN_GADGET_ITEM_TYPE] = CraftsmanGadgetItemDataModel;
  ItemConfig.typeLabels[CRAFTSMAN_GADGET_ITEM_TYPE] = "TYPES.Item.rebreya-main.gadget";
  ItemConfig.typeIcons[CRAFTSMAN_GADGET_ITEM_TYPE] = "fa-solid fa-gears";
  return true;
}
```

Add to `scripts/constants.js`:

```js
export const CRAFTSMAN_GADGET_ITEM_TYPE = `${MODULE_ID}.gadget`;
```

Call `registerCraftsmanGadgetItemType()` from `extendDnd5eItemTypes()`, add `documentTypes.Item.gadget` with `description.value` and `description.chat` HTML fields, and add singular/plural Russian type labels.

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `node --test tests/craftsman-gadget-item-type.test.mjs tests/module-manifest.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit the native Item type**

```powershell
git add scripts/constants.js scripts/integrations/craftsman-gadget-item-type.js scripts/integrations/dnd5e-sheet-extensions.js module.json lang/ru.json tests/craftsman-gadget-item-type.test.mjs tests/module-manifest.test.mjs
git commit -m "feat(craftsman): register physical gadget items"
```

---

### Task 2: Convert library templates and project activities by gadget state

**Files:**
- Create: `scripts/data/craftsman-gadget-item-data.js`
- Create: `tests/craftsman-gadget-item-data.test.mjs`

**Interfaces:**
- Consumes: a compendium feat source whose activities have `flags.rebreya-main.craftsmanGadget.operation` equal to `activate` or `action`.
- Produces: `buildCraftsmanGadgetItemSource(template, options): object`, `buildCraftsmanGadgetStateUpdate(item, state, overrides?): object`, `getCraftsmanGadgetQuantity(item): number`, and `expandCraftsmanGadgetSelection(items): string[]`.

- [ ] **Step 1: Write failing conversion and activity-state tests**

```js
test("converts a feat template into one prepared physical gadget stack", () => {
  const source = buildCraftsmanGadgetItemSource(template, {
    catalogId: "charged-boot",
    instanceId: "instance-one",
    restGeneration: "rest-one",
    quantity: 3
  });
  assert.equal(source.type, "rebreya-main.gadget");
  assert.equal(source.system.quantity, 3);
  assert.equal(source.system.weight.value, 0);
  assert.equal(source.system.price.value, 0);
  assert.equal(source.flags[MODULE_ID].craftsmanGadget.state, "prepared");
  assert.deepEqual(activityOperations(source), ["activate", "activate"]);
  assert.equal(source.flags[MODULE_ID].craftsmanGadgetActivities.length, 3);
  assert.equal(source.system.description.value, template.system.description.value);
});

test("projects only the action for active gadgets and no activities for spent gadgets", () => {
  assert.deepEqual(activityOperations(applyCraftsmanGadgetState(source, "active")), ["action"]);
  assert.deepEqual(activityOperations(applyCraftsmanGadgetState(source, "spent")), []);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/craftsman-gadget-item-data.test.mjs`

Expected: FAIL because `scripts/data/craftsman-gadget-item-data.js` does not exist.

- [ ] **Step 3: Implement source conversion with immutable stored activities**

```js
export function buildCraftsmanGadgetItemSource(template, options) {
  const source = cloneSource(template);
  const activities = Object.values(source.system?.activities ?? {}).map(cloneSource);
  source.type = CRAFTSMAN_GADGET_ITEM_TYPE;
  source.system = {
    ...source.system,
    quantity: Math.max(1, Math.trunc(Number(options.quantity) || 1)),
    weight: { value: 0, units: "lb" },
    price: { value: 0, denomination: "gp" },
    container: null,
    equipped: false,
    attuned: false,
    identified: true,
    activities: activitiesForState(activities, "prepared")
  };
  source.flags = mergeFlags(source.flags, {
    craftsmanGadget: {
      managed: true,
      catalogId: options.catalogId,
      instanceId: options.instanceId,
      restGeneration: options.restGeneration,
      state: "prepared",
      actionUsed: false
    },
    craftsmanGadgetActivities: activities
  });
  return source;
}

export function buildCraftsmanGadgetStateUpdate(item, state, overrides = {}) {
  const activities = cloneSource(item.flags?.[MODULE_ID]?.craftsmanGadgetActivities ?? []);
  return {
    name: state === "active" ? appendActiveSuffix(item.name) : item.name,
    "system.activities": activitiesForState(activities, state),
    [`flags.${MODULE_ID}.craftsmanGadget`]: {
      ...cloneSource(item.flags?.[MODULE_ID]?.craftsmanGadget ?? {}),
      ...overrides,
      state
    }
  };
}
```

Implement `activitiesForState` so `prepared` keeps only `activate`, `active` keeps only `action`, and `spent` returns an empty object keyed by original activity IDs. `expandCraftsmanGadgetSelection` repeats each prepared stack's `catalogId` exactly `system.quantity` times.

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `node --test tests/craftsman-gadget-item-data.test.mjs`

Expected: all tests PASS.

- [ ] **Step 5: Commit the conversion boundary**

```powershell
git add scripts/data/craftsman-gadget-item-data.js tests/craftsman-gadget-item-data.test.mjs
git commit -m "feat(craftsman): build stateful gadget inventory sources"
```

---

### Task 3: Replace long-rest feats with grouped physical stacks

**Files:**
- Modify: `scripts/combat/craftsman-gadget-service.js`
- Modify: `tests/craftsman-gadget-service.test.mjs`

**Interfaces:**
- Consumes: `buildCraftsmanGadgetItemSource`, `expandCraftsmanGadgetSelection`, and existing gadget compendium templates.
- Produces: atomic long-rest replacement where repeated choices are grouped by `catalogId` plus attached vehicle identity.

- [ ] **Step 1: Change the rest tests to require grouped stacks and full cleanup**

```js
test("groups six level-17 choices into two physical 3 + 3 stacks", async () => {
  dialog.selectedIds = ["charged-boot", "charged-boot", "charged-boot", "force-glove", "force-glove", "force-glove"];
  await service.handleRestCompleted(actor, { type: "long" });
  const managed = actor.items.filter(isManagedGadget);
  assert.equal(managed.length, 2);
  assert.deepEqual(managed.map((item) => item.system.quantity).sort(), [3, 3]);
  assert.ok(managed.every((item) => item.type === "rebreya-main.gadget"));
});

test("next long rest deletes prepared, active, and spent managed Items from every generation", async () => {
  actor.items.push(oldPrepared, forgottenActive, forgottenSpent, unmanagedGadget);
  await service.handleRestCompleted(actor, { type: "long" });
  assert.equal(actor.items.includes(oldPrepared), false);
  assert.equal(actor.items.includes(forgottenActive), false);
  assert.equal(actor.items.includes(forgottenSpent), false);
  assert.equal(actor.items.includes(unmanagedGadget), true);
});

test("rolls back a partially created new set and preserves the old set", async () => {
  actor.failCreateAfter = 1;
  await assert.rejects(service.handleRestCompleted(actor, { type: "long" }));
  assert.ok(actor.items.includes(oldPrepared));
  assert.equal(actor.items.filter((item) => item.flags?.[MODULE_ID]?.craftsmanGadget?.restGeneration === newGeneration).length, 0);
});
```

- [ ] **Step 2: Run the service tests and verify RED**

Run: `node --test tests/craftsman-gadget-service.test.mjs`

Expected: FAIL because rest currently creates one feat per choice and only reads/deletes the current generation.

- [ ] **Step 3: Implement grouped create-before-delete replacement**

```js
const oldGadgets = actorItems(actor).filter((item) => instanceState(item)?.managed === true);
const previousSelectedIds = actorGadgetState(actor)?.selectedIds?.length
  ? [...actorGadgetState(actor).selectedIds]
  : expandCraftsmanGadgetSelection(oldGadgets);
const groups = groupSelectedGadgets(selection.selectedIds, selection.vehicleAttachments);
const sources = groups.map((group) => buildCraftsmanGadgetItemSource(templateByCatalogId.get(group.catalogId), {
  catalogId: group.catalogId,
  instanceId: this.#randomId(),
  restGeneration,
  quantity: group.quantity,
  vehicleActorUuid: group.vehicleActorUuid
}));

let created = [];
try {
  created = await actor.createEmbeddedDocuments("Item", sources);
  if (created.length !== sources.length) throw new Error("Craftsman gadget loadout was only partially created.");
  for (const old of oldGadgets) await this.#cleanupGadget(actor, old);
  await actor.deleteEmbeddedDocuments("Item", oldGadgets.map(documentId).filter(Boolean));
  await this.#updateActorGadgetState(actor, { restGeneration, selectedIds: [...selection.selectedIds] });
}
catch (error) {
  const createdIds = created.map(documentId).filter(Boolean);
  if (createdIds.length) await actor.deleteEmbeddedDocuments("Item", createdIds);
  throw error;
}
```

Do not update the Actor's generation or selection flags until creation and old-set cleanup succeed.

- [ ] **Step 4: Run the service tests and verify GREEN**

Run: `node --test tests/craftsman-gadget-service.test.mjs`

Expected: all rest and existing automation tests PASS.

- [ ] **Step 5: Commit grouped rest inventory**

```powershell
git add scripts/combat/craftsman-gadget-service.js tests/craftsman-gadget-service.test.mjs
git commit -m "feat(craftsman): prepare grouped gadget stacks"
```

---

### Task 4: Split gadget stacks into active inventory Items

**Files:**
- Modify: `scripts/combat/craftsman-gadget-service.js`
- Modify: `tests/craftsman-gadget-service.test.mjs`

**Interfaces:**
- Consumes: `buildCraftsmanGadgetStateUpdate(item, state, overrides)` and physical prepared stack Items.
- Produces: serialized `#activateGadget(actor, item): Promise<Item>` with rollback on any split failure.

- [ ] **Step 1: Add failing quantity-one, split, identity, replacement, and rollback tests**

```js
test("activates a quantity-one gadget by updating the same Item", async () => {
  const originalId = item.id;
  await service.applyDnd5ePostUseActivity(activationActivity(item));
  assert.equal(actor.items.length, 1);
  assert.equal(actor.items[0].id, originalId);
  assert.equal(actor.items[0].name, `${baseName} (активный)`);
  assert.equal(gadgetState(actor.items[0]).state, "active");
  assert.deepEqual(activityOperations(actor.items[0]), ["action"]);
});

test("splits one active copy from a larger prepared stack", async () => {
  item.system.quantity = 3;
  const oldInstanceId = gadgetState(item).instanceId;
  await service.applyDnd5ePostUseActivity(activationActivity(item));
  const prepared = actor.items.find((candidate) => gadgetState(candidate).state === "prepared");
  const active = actor.items.find((candidate) => gadgetState(candidate).state === "active");
  assert.equal(prepared.system.quantity, 2);
  assert.notEqual(gadgetState(prepared).instanceId, oldInstanceId);
  assert.equal(active.system.quantity, 1);
  assert.equal(gadgetState(active).instanceId, oldInstanceId);
});

test("keeps the smoke workflow instance id on the active split copy", async () => {
  item.system.quantity = 2;
  const workflowInstanceId = gadgetState(item).instanceId;
  await service.applyDnd5ePostUseActivity(activationActivity(item), {}, { template: smokeTemplate });
  assert.equal(gadgetState(activeItem(actor)).instanceId, workflowInstanceId);
  assert.equal(smokeTemplate.flags[MODULE_ID].craftsmanGadget.instanceId, workflowInstanceId);
});

test("deletes a new active clone and restores the stack when source update fails", async () => {
  item.system.quantity = 2;
  item.failNextUpdate = true;
  await assert.rejects(service.applyDnd5ePostUseActivity(activationActivity(item)));
  assert.equal(actor.items.length, 1);
  assert.equal(item.system.quantity, 2);
  assert.equal(gadgetState(item).state, "prepared");
});
```

- [ ] **Step 2: Run the service tests and verify RED**

Run: `node --test tests/craftsman-gadget-service.test.mjs`

Expected: FAIL because activation currently mutates the source feat in place regardless of quantity.

- [ ] **Step 3: Implement an Actor/Item activation queue and transactional split**

```js
async #activateGadget(actor, item) {
  const quantity = getCraftsmanGadgetQuantity(item);
  if (quantity === 1) {
    await item.update(buildCraftsmanGadgetStateUpdate(item, "active", {
      activatedAtWorldTime: currentWorldTime(),
      expiresAtWorldTime: currentWorldTime() + 60
    }));
    return item;
  }

  const originalInstanceId = instanceState(item).instanceId;
  const activeSource = item.toObject();
  delete activeSource._id;
  applyObjectUpdate(activeSource, buildCraftsmanGadgetStateUpdate(item, "active", {
    instanceId: originalInstanceId,
    activatedAtWorldTime: currentWorldTime(),
    expiresAtWorldTime: currentWorldTime() + 60
  }));
  activeSource.system.quantity = 1;

  let active = null;
  try {
    [active] = await actor.createEmbeddedDocuments("Item", [activeSource]);
    await item.update({
      "system.quantity": quantity - 1,
      [`flags.${MODULE_ID}.craftsmanGadget.instanceId`]: this.#randomId()
    });
    return active;
  }
  catch (error) {
    if (active) await actor.deleteEmbeddedDocuments("Item", [documentId(active)]);
    throw error;
  }
}
```

Call this method before applying gadget effects. Spend any previous active gadget without deleting it, then apply the chosen gadget's effects to the returned active Item. Serialize by Actor and source Item so two rapid activity hooks cannot consume the same quantity.

- [ ] **Step 4: Run the service tests and verify GREEN**

Run: `node --test tests/craftsman-gadget-service.test.mjs`

Expected: all activation, smoke, cleanup, and existing damage/movement/vehicle tests PASS.

- [ ] **Step 5: Commit activation splitting**

```powershell
git add scripts/combat/craftsman-gadget-service.js tests/craftsman-gadget-service.test.mjs
git commit -m "feat(craftsman): split active gadgets from stacks"
```

---

### Task 5: Verify integration and publish the feature branch

**Files:**
- Modify only files required by failures directly caused by Tasks 1-4.

**Interfaces:**
- Consumes: all completed tasks.
- Produces: a clean, tested `lich_branch` pushed to `origin/lich_branch` without force.

- [ ] **Step 1: Run focused gadget and manifest checks**

Run:

```powershell
node --test tests/craftsman-gadget-item-type.test.mjs tests/craftsman-gadget-item-data.test.mjs tests/craftsman-gadget-service.test.mjs tests/module-manifest.test.mjs
```

Expected: all focused tests PASS with zero failures.

- [ ] **Step 2: Run every available repository check**

Run:

```powershell
npm test
```

Expected: all repository tests PASS with zero failures.

- [ ] **Step 3: Inspect the final diff and repository state**

Run:

```powershell
git diff --check
git status --short
git diff origin/main...HEAD --stat
git diff origin/main...HEAD -- scripts/constants.js scripts/integrations/craftsman-gadget-item-type.js scripts/data/craftsman-gadget-item-data.js scripts/combat/craftsman-gadget-service.js module.json lang/ru.json
```

Expected: no whitespace errors, no unrelated files, and only the approved gadget inventory implementation plus its docs/tests.

- [ ] **Step 4: Commit any final directly related corrections**

```powershell
git add scripts tests module.json lang/ru.json docs/superpowers
git commit -m "feat(craftsman): add physical gadget inventory"
```

Skip this commit if the worktree is already clean because Tasks 1-4 were committed independently.

- [ ] **Step 5: Fetch and re-check the primary branch before push**

Run:

```powershell
git fetch origin
git merge-base --is-ancestor origin/main HEAD
git status -sb
```

Expected: `origin/main` is an ancestor, the worktree is clean, and the current branch is `lich_branch`.

- [ ] **Step 6: Push without force**

Run: `git push origin lich_branch`

Expected: `origin/lich_branch` advances to the tested local HEAD.
