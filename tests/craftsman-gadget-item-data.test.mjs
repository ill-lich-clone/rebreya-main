import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";

const {
  buildCraftsmanGadgetItemSource,
  buildCraftsmanGadgetStateUpdate,
  expandCraftsmanGadgetSelection,
  getCraftsmanGadgetQuantity
} = await import("../scripts/data/craftsman-gadget-item-data.js");

function activity(id, operation) {
  return {
    _id: id,
    type: "utility",
    name: operation,
    flags: {
      [MODULE_ID]: {
        craftsmanGadget: { gadgetId: "charged-boot", operation }
      }
    }
  };
}

function gadgetTemplate() {
  return {
    _id: "template-id",
    id: "template-id",
    uuid: "Compendium.world.features.Item.template-id",
    name: "Заряженный ботинок",
    type: "feat",
    img: "icons/charged-boot.webp",
    folder: "template-folder",
    ownership: { default: 2 },
    system: {
      description: {
        value: "<h2>Дословное описание</h2><p>Не сокращать.</p>",
        chat: ""
      },
      source: { book: "D&D Ремесленник V0.1" },
      identifier: "craftsman-gadget-charged-boot",
      activities: {
        aaaaaaaaaaaaaaaa: activity("aaaaaaaaaaaaaaaa", "activate"),
        bbbbbbbbbbbbbbbb: activity("bbbbbbbbbbbbbbbb", "activate"),
        cccccccccccccccc: activity("cccccccccccccccc", "action")
      },
      uses: { spent: 0, max: "", recovery: [] }
    },
    effects: [],
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "craftsmanGadget",
        craftsmanGadgetTemplate: {
          gadgetId: "charged-boot",
          availability: "base",
          requiredLevel: 1
        }
      }
    }
  };
}

function activityOperations(source) {
  return Object.values(source.system.activities ?? {})
    .map((entry) => entry.flags?.[MODULE_ID]?.craftsmanGadget?.operation);
}

test("converts a feat template into one prepared physical gadget stack", () => {
  const template = gadgetTemplate();
  const source = buildCraftsmanGadgetItemSource(template, {
    catalogId: "charged-boot",
    instanceId: "instance-one",
    ownerUuid: "Actor.craftsman",
    restGeneration: "rest-one",
    quantity: 3
  });

  assert.equal(source.type, "rebreya-main.gadget");
  assert.equal(source.name, template.name);
  assert.equal(source.img, template.img);
  assert.equal(source._id, undefined);
  assert.equal(source.folder, undefined);
  assert.equal(source.ownership, undefined);
  assert.equal(source.system.quantity, 3);
  assert.deepEqual(source.system.weight, { value: 0, units: "lb" });
  assert.deepEqual(source.system.price, { value: 0, denomination: "gp" });
  assert.equal(source.system.container, null);
  assert.equal(source.system.uses.autoDestroy, false);
  assert.equal(source.system.description.value, template.system.description.value);
  assert.deepEqual(activityOperations(source), ["activate", "activate"]);
  assert.equal(
    Object.keys(source.flags[MODULE_ID].craftsmanGadgetActivities).length,
    3
  );
  assert.deepEqual(source.flags[MODULE_ID].craftsmanGadget, {
    managed: true,
    catalogId: "charged-boot",
    instanceId: "instance-one",
    ownerUuid: "Actor.craftsman",
    restGeneration: "rest-one",
    state: "prepared",
    vehicleUuid: "",
    actionUsed: false
  });
  assert.equal(source.flags[MODULE_ID].craftsmanGadgetTemplate, undefined);
  assert.equal(template.type, "feat");
  assert.equal(Object.keys(template.system.activities).length, 3);
});

test("projects active and spent Items to only their valid native activities", () => {
  const prepared = buildCraftsmanGadgetItemSource(gadgetTemplate(), {
    catalogId: "charged-boot",
    instanceId: "instance-one",
    ownerUuid: "Actor.craftsman",
    restGeneration: "rest-one",
    quantity: 1
  });
  const item = structuredClone(prepared);

  const activeUpdate = buildCraftsmanGadgetStateUpdate(item, "active", {
    expiresAtWorldTime: 60
  });
  assert.equal(activeUpdate.name, "Заряженный ботинок (активный)");
  assert.deepEqual(
    Object.values(activeUpdate["system.activities"]).map((entry) => entry.flags[MODULE_ID].craftsmanGadget.operation),
    ["action"]
  );
  assert.equal(activeUpdate[`flags.${MODULE_ID}.craftsmanGadget`].state, "active");
  assert.equal(activeUpdate[`flags.${MODULE_ID}.craftsmanGadget`].expiresAtWorldTime, 60);

  item.name = activeUpdate.name;
  item.flags[MODULE_ID].craftsmanGadget = activeUpdate[`flags.${MODULE_ID}.craftsmanGadget`];
  const spentUpdate = buildCraftsmanGadgetStateUpdate(item, "spent", { spentReason: "expired" });
  assert.equal(spentUpdate.name, "Заряженный ботинок (активный)");
  assert.deepEqual(spentUpdate["system.activities"], {});
  assert.equal(spentUpdate[`flags.${MODULE_ID}.craftsmanGadget`].spentReason, "expired");
});

test("reads physical quantities and expands managed stacks into exact prior selections", () => {
  const items = [
    {
      system: { quantity: 3 },
      flags: { [MODULE_ID]: { craftsmanGadget: { managed: true, catalogId: "charged-boot" } } }
    },
    {
      system: { quantity: 1 },
      flags: { [MODULE_ID]: { craftsmanGadget: { managed: true, catalogId: "force-glove" } } }
    },
    {
      system: { quantity: 99 },
      flags: { [MODULE_ID]: { craftsmanGadget: { managed: false, catalogId: "smoke-device" } } }
    }
  ];

  assert.equal(getCraftsmanGadgetQuantity(items[0]), 3);
  assert.equal(getCraftsmanGadgetQuantity({ system: { quantity: 0 } }), 0);
  assert.equal(getCraftsmanGadgetQuantity({ system: { quantity: -2 } }), 0);
  assert.equal(getCraftsmanGadgetQuantity({ system: {} }), 1);
  assert.deepEqual(expandCraftsmanGadgetSelection(items), [
    "charged-boot", "charged-boot", "charged-boot", "force-glove"
  ]);
});
