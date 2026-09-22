import test from "node:test";
import assert from "node:assert/strict";

test("registers the Craftsman gadget as a native consumable-derived inventory section", async () => {
  const previousConfig = globalThis.CONFIG;
  class ConsumableData {}
  globalThis.CONFIG = {
    Item: {
      dataModels: { consumable: ConsumableData },
      typeLabels: {},
      typeIcons: {}
    }
  };

  try {
    const {
      getCraftsmanGadgetItemDataModel,
      registerCraftsmanGadgetItemType
    } = await import(`../scripts/integrations/craftsman-gadget-item-type.js?test=${Date.now()}`);

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
    assert.equal(globalThis.CONFIG.Item.dataModels["rebreya-main.gadget"], Model);
    assert.equal(
      globalThis.CONFIG.Item.typeLabels["rebreya-main.gadget"],
      "TYPES.Item.rebreya-main.gadget"
    );
    assert.equal(
      globalThis.CONFIG.Item.typeLabels["rebreya-main.gadgetPl"],
      "TYPES.Item.rebreya-main.gadgetPl"
    );
    assert.equal(globalThis.CONFIG.Item.typeIcons["rebreya-main.gadget"], "fa-solid fa-gears");
  }
  finally {
    globalThis.CONFIG = previousConfig;
  }
});

test("does not register the gadget Item type without the native consumable DataModel", async () => {
  const previousConfig = globalThis.CONFIG;
  globalThis.CONFIG = {
    Item: {
      dataModels: {},
      typeLabels: {},
      typeIcons: {}
    }
  };

  try {
    const { registerCraftsmanGadgetItemType } = await import(
      `../scripts/integrations/craftsman-gadget-item-type.js?missing-consumable=${Date.now()}`
    );

    assert.equal(registerCraftsmanGadgetItemType(), false);
    assert.equal(globalThis.CONFIG.Item.dataModels["rebreya-main.gadget"], undefined);
  }
  finally {
    globalThis.CONFIG = previousConfig;
  }
});

test("deferred gadget registration survives dnd5e replacing Item data models during init", async () => {
  const previousConfig = globalThis.CONFIG;
  class InitialConsumableData {}
  class FinalConsumableData {}
  globalThis.CONFIG = {
    Item: {
      dataModels: { consumable: InitialConsumableData },
      typeLabels: {},
      typeIcons: {}
    }
  };

  try {
    const {
      getCraftsmanGadgetItemDataModel,
      scheduleCraftsmanGadgetItemTypeRegistration
    } = await import(`../scripts/integrations/craftsman-gadget-item-type.js?deferred=${Date.now()}`);
    const scheduled = [];

    scheduleCraftsmanGadgetItemTypeRegistration({
      schedule: (callback) => scheduled.push(callback)
    });
    globalThis.CONFIG.Item.dataModels = { consumable: FinalConsumableData };
    scheduled.forEach((callback) => callback());

    const Model = getCraftsmanGadgetItemDataModel();
    assert.equal(scheduled.length, 1);
    assert.equal(Object.getPrototypeOf(Model), FinalConsumableData);
    assert.equal(globalThis.CONFIG.Item.dataModels["rebreya-main.gadget"], Model);
  }
  finally {
    globalThis.CONFIG = previousConfig;
  }
});
