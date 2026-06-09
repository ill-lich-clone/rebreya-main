import test from "node:test";
import assert from "node:assert/strict";

import {
  handleCreatedRationItem,
  registerRationFoodConversionHook
} from "../scripts/integrations/ration-food-conversion.js";

test("ration conversion hook prompts the dropping user and converts after confirmation", async () => {
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;

  const infos = [];
  let convertedItem = null;
  const item = {
    name: "Пайки",
    parent: {
      type: "character"
    }
  };
  const moduleApi = {
    inventoryService: {
      canManagePartyInventory: () => true,
      getRationFoodConversion: (sourceItem) => {
        assert.equal(sourceItem, item);
        return {
          itemName: "Пайки",
          quantity: 2,
          weightEach: 2,
          foodLb: 4
        };
      },
      convertRationItemToFoodSupply: async (sourceItem) => {
        convertedItem = sourceItem;
        return {
          itemName: "Пайки",
          foodLb: 4
        };
      }
    },
    inventoryApp: {
      renderOptions: null,
      render(options) {
        this.renderOptions = options;
      }
    }
  };

  globalThis.game = {
    user: {
      id: "player-1"
    }
  };
  globalThis.ui = {
    notifications: {
      info: (message) => infos.push(message),
      error: () => {}
    }
  };

  try {
    const handled = await handleCreatedRationItem(item, {}, "player-1", moduleApi, {
      confirm: async (conversion) => {
        assert.equal(conversion.foodLb, 4);
        return true;
      }
    });

    assert.equal(handled, true);
    assert.equal(convertedItem, item);
    assert.deepEqual(moduleApi.inventoryApp.renderOptions, { force: true });
    assert.equal(infos.some((message) => message.includes("4 фнт. еды группы")), true);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
  }
});

test("ration conversion hook ignores createItem events from other users", async () => {
  const previousGame = globalThis.game;
  let convertCalls = 0;
  const item = {
    name: "Rations",
    parent: {
      type: "character"
    }
  };

  globalThis.game = {
    user: {
      id: "player-1"
    }
  };

  try {
    const handled = await handleCreatedRationItem(item, {}, "player-2", {
      inventoryService: {
        canManagePartyInventory: () => true,
        getRationFoodConversion: () => ({
          itemName: "Rations",
          quantity: 1,
          weightEach: 2,
          foodLb: 2
        }),
        convertRationItemToFoodSupply: async () => {
          convertCalls += 1;
        }
      }
    }, {
      confirm: async () => {
        throw new Error("dialog should not open for another user's drop");
      }
    });

    assert.equal(handled, false);
    assert.equal(convertCalls, 0);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("registerRationFoodConversionHook wires a createItem listener", async () => {
  const calls = [];
  const Hooks = {
    on(hookName, listener) {
      calls.push({ hookName, listener });
    }
  };

  const registered = registerRationFoodConversionHook({}, { Hooks });

  assert.equal(registered, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].hookName, "createItem");
});
