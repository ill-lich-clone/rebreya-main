import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import {
  planPortableContainerCycleRepairs,
  planPortableContainerReparent,
  repairPortableContainerCycles,
  registerStorageContainerHierarchyHooks
} from "../scripts/integrations/storage-container-hierarchy.js";

function item(id, name, parentId = null, { portable = false } = {}) {
  return {
    id,
    name,
    type: "container",
    system: { container: parentId },
    flags: portable ? {
      [MODULE_ID]: {
        storageContainer: {
          containerId: `container-${id}`,
          storageKind: "bag",
          name,
          img: `${id}.webp`,
          state: { baseName: name, state: "opened", manualRows: [], generatedRows: [] }
        }
      }
    } : {}
  };
}

function actor(items) {
  const document = {
    id: "hero",
    documentName: "Actor",
    type: "character",
    items: { contents: items },
    updates: [],
    async updateEmbeddedDocuments(documentName, patches, options) {
      assert.equal(documentName, "Item");
      this.updates.push({ patches: structuredClone(patches), options: structuredClone(options) });
      for (const patch of patches) {
        const target = items.find((entry) => entry.id === patch._id);
        if (target) target.system.container = patch["system.container"];
      }
      return patches;
    }
  };
  for (const entry of items) entry.parent = document;
  return document;
}

test("portable storage is detached to recover a dnd5e container cycle", async () => {
  const backpack = item("backpack", "Рюкзак", "bag");
  const bag = item("bag", "Сумка хранения", "backpack", { portable: true });
  const owner = actor([backpack, bag]);

  assert.deepEqual(planPortableContainerCycleRepairs(owner, { updatedItemId: backpack.id }), [{
    _id: bag.id,
    "system.container": null
  }]);

  const repaired = await repairPortableContainerCycles(owner, { updatedItemId: backpack.id });

  assert.equal(repaired.length, 1);
  assert.equal(bag.system.container, null);
  assert.equal(backpack.system.container, bag.id);
  assert.equal(owner.updates.length, 1);
  assert.equal(owner.updates[0].options.rebreyaStorageContainerCycleRepair, true);
});

test("valid nested portable storage is left unchanged", async () => {
  const bag = item("bag", "Сумка хранения", null, { portable: true });
  const backpack = item("backpack", "Рюкзак", bag.id);
  const owner = actor([bag, backpack]);

  assert.deepEqual(planPortableContainerCycleRepairs(owner), []);
  assert.deepEqual(await repairPortableContainerCycles(owner), []);
  assert.equal(owner.updates.length, 0);
});

test("moving an ancestor into portable storage rotates the hierarchy without hiding either container", () => {
  const backpack = item("backpack", "Рюкзак");
  const bag = item("bag", "Сумка хранения", backpack.id, { portable: true });
  const owner = actor([backpack, bag]);

  assert.deepEqual(planPortableContainerReparent(backpack, {
    system: { container: bag.id }
  }), {
    actor: owner,
    sourceId: backpack.id,
    sourceParentId: null,
    targetId: bag.id
  });
});

test("hierarchy hooks repair existing and newly-created cycles only on the active GM", async () => {
  const registrations = new Map();
  const Hooks = { on(name, fn) { registrations.set(name, fn); } };
  const bag = item("bag", "Сумка хранения", "backpack", { portable: true });
  const backpack = item("backpack", "Рюкзак", "bag");
  const owner = actor([bag, backpack]);
  const game = { actors: { contents: [owner] } };

  const result = await registerStorageContainerHierarchyHooks({
    Hooks,
    gameProvider: () => game,
    isActiveGm: () => true,
    notify: () => {}
  });

  assert.equal(result.repaired, 1);
  assert.equal(bag.system.container, null);
  assert.equal(typeof registrations.get("createItem"), "function");
  assert.equal(typeof registrations.get("preUpdateItem"), "function");
  assert.equal(typeof registrations.get("updateItem"), "function");

  bag.system.container = backpack.id;
  backpack.system.container = null;
  assert.equal(registrations.get("preUpdateItem")(
    backpack,
    { system: { container: bag.id } },
    {},
    "gm"
  ), false);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(bag.system.container, null);
  assert.equal(backpack.system.container, bag.id);
  assert.equal(owner.updates.length, 2);
});
