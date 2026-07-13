import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID, SETTINGS_KEYS } from "../scripts/constants.js";
import { CraftingService } from "../scripts/data/crafting-service.js";
import { InventoryService } from "../scripts/data/inventory-service.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function installFoundryUtils() {
  const previousFoundry = globalThis.foundry;
  globalThis.foundry = {
    utils: {
      deepClone: clone,
      getProperty: (source, path) => String(path ?? "").split(".").reduce((current, part) => current?.[part], source),
      mergeObject: (target, source) => ({ ...target, ...source }),
      setProperty: (source, path, value) => {
        const parts = String(path ?? "").split(".");
        let cursor = source;
        for (const [index, part] of parts.entries()) {
          if (index === parts.length - 1) {
            cursor[part] = value;
            return;
          }

          cursor[part] ??= {};
          cursor = cursor[part];
        }
      }
    }
  };
  return () => {
    globalThis.foundry = previousFoundry;
  };
}

function createActor({
  id,
  name = "Actor",
  type = "character",
  isOwner = true,
  members = []
} = {}) {
  const actor = {
    id,
    name,
    type,
    img: "icons/svg/mystery-man.svg",
    isOwner,
    system: {
      abilities: {
        str: {
          value: 10
        },
        con: {
          mod: 0
        }
      },
      currency: {
        pp: 0,
        gp: 0,
        ep: 0,
        sp: 0,
        cp: 0
      },
      members
    },
    items: {
      contents: [],
      get: () => null
    },
    getFlag() {
      return undefined;
    }
  };
  return actor;
}

function installFixture({
  actors = [],
  partyState = {},
  craftState = {},
  craftMutationJournal = {},
  onSettingSet = null
} = {}) {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  const settingsStore = {
    [SETTINGS_KEYS.PARTY_STATE]: partyState,
    [SETTINGS_KEYS.CRAFT_STATE]: craftState,
    [SETTINGS_KEYS.CRAFT_MUTATION_JOURNAL]: craftMutationJournal
  };

  globalThis.game = {
    user: {
      id: "gm",
      isGM: true
    },
    actors: {
      contents: actors,
      get: (actorId) => actors.find((actor) => actor.id === actorId) ?? null
    },
    settings: {
      get: (moduleId, key) => moduleId === MODULE_ID ? settingsStore[key] : undefined,
      set: async (moduleId, key, value) => {
        if (moduleId === MODULE_ID) {
          if (typeof onSettingSet === "function") {
            await onSettingSet({ key, value: clone(value), settingsStore });
          }
          else {
            settingsStore[key] = clone(value);
          }
        }
        return value;
      }
    }
  };

  return {
    settingsStore,
    restore() {
      globalThis.game = previousGame;
      restoreFoundry();
    }
  };
}

function createCraftModel() {
  const material = { id: "iron", name: "Iron" };
  const gear = {
    id: "iron-gear",
    name: "Iron Gear",
    linkedTool: "",
    predominantMaterialId: material.id,
    priceGoldEquivalent: 10,
    weight: 4
  };
  return {
    materials: [material],
    materialById: new Map([[material.id, material]]),
    gear: [gear],
    gearById: new Map([[gear.id, gear]])
  };
}

function createCraftModuleApi({ materialQuantity = 10, onUpdateQuantity, onAddModelItem } = {}) {
  const model = createCraftModel();
  const state = {
    materialQuantity,
    gearQuantity: 0,
    updates: [],
    additions: []
  };
  const moduleApi = {
    inventoryService: {
      canManagePartyInventory: () => true,
      resolveRebreyaToolId: () => "",
      getRebreyaToolLabel: () => ""
    },
    getModel: async () => model,
    getPartySnapshot: async () => ({
      members: [{
        actorId: "crafter",
        actorName: "Crafter",
        actorImg: "",
        tools: []
      }]
    }),
    getInventorySnapshot: async () => ({
      allItems: [
        {
          itemId: "material-item",
          sourceType: "material",
          sourceId: "iron",
          quantity: state.materialQuantity
        },
        ...(state.gearQuantity > 0 ? [{
          itemId: "gear-item",
          sourceType: "gear",
          sourceId: "iron-gear",
          quantity: state.gearQuantity
        }] : [])
      ]
    }),
    async updateInventoryItemQuantity(itemId, quantity) {
      state.updates.push({ itemId, quantity });
      if (typeof onUpdateQuantity === "function") {
        await onUpdateQuantity({ itemId, quantity, state });
      }
      else {
        state.materialQuantity = quantity;
      }
      return { itemId, quantity };
    },
    async addModelItemToInventory(sourceType, sourceId, quantity) {
      state.additions.push({ sourceType, sourceId, quantity });
      if (typeof onAddModelItem === "function") {
        return onAddModelItem({ sourceType, sourceId, quantity, state });
      }
      if (sourceType === "material") state.materialQuantity += quantity;
      if (sourceType === "gear") state.gearQuantity += quantity;
      return { sourceType, sourceId, quantity };
    }
  };
  return { model, moduleApi, state };
}

test("CraftingService crafters and queueTask use native group members from getPartySnapshot", async () => {
  const nativeMember = createActor({ id: "native-member", name: "Native Crafter" });
  const staleMember = createActor({ id: "stale-member", name: "Stale Crafter" });
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    members: [{ actor: nativeMember }]
  });
  const fixture = installFixture({
    actors: [groupActor, nativeMember, staleMember],
    partyState: {
      members: {
        "stale-member": {
          tools: {
            smith: {
              owned: true,
              prof: true,
              mod: 9
            }
          }
        }
      }
    },
    craftState: {
      version: 1,
      counter: 0,
      queue: []
    }
  });
  const model = {
    materials: [],
    materialById: new Map(),
    gear: [{
      id: "simple-gear",
      name: "Simple Gear",
      linkedTool: "",
      priceGoldEquivalent: 10,
      weight: 2
    }],
    gearById: new Map()
  };
  model.gearById.set("simple-gear", model.gear[0]);
  const moduleApi = {
    groupContextService: {
      resolveForCurrentUser: () => ({ groupActor })
    },
    getModel: async () => model
  };
  const inventoryService = new InventoryService(moduleApi);
  moduleApi.inventoryService = inventoryService;
  moduleApi.getPartySnapshot = () => inventoryService.getPartySnapshot({ actor: groupActor });
  const craftingService = new CraftingService(moduleApi);

  try {
    const snapshot = await craftingService.getSnapshot({ crafterActorId: "stale-member" });

    assert.deepEqual(snapshot.crafters.map((crafter) => crafter.actorId), ["native-member"]);
    assert.equal(snapshot.crafters[0].selected, true);

    const queuedTask = await craftingService.queueTask({
      gearId: "simple-gear",
      quantity: 1,
      crafterActorId: "stale-member"
    });

    assert.equal(queuedTask.crafterActorId, "native-member");
    assert.equal(queuedTask.crafterName, "Native Crafter");
    assert.equal(fixture.settingsStore[SETTINGS_KEYS.CRAFT_STATE].queue[0].crafterActorId, "native-member");
  }
  finally {
    fixture.restore();
  }
});

test("queueTask restores debited materials when craft state persistence fails", async () => {
  let failCraftWrite = true;
  const fixture = installFixture({
    craftState: { version: 1, counter: 0, queue: [] },
    onSettingSet({ key, value, settingsStore }) {
      if (key === SETTINGS_KEYS.CRAFT_STATE && failCraftWrite) {
        failCraftWrite = false;
        throw new Error("craft state unavailable");
      }
      settingsStore[key] = clone(value);
    }
  });
  const { moduleApi, state } = createCraftModuleApi();
  const service = new CraftingService(moduleApi);

  try {
    await assert.rejects(
      service.queueTask({ gearId: "iron-gear", quantity: 1, mutationId: "queue-failure" }),
      /craft state unavailable/u
    );
    assert.equal(state.materialQuantity, 10);
    assert.deepEqual(fixture.settingsStore[SETTINGS_KEYS.CRAFT_STATE].queue, []);
  }
  finally {
    fixture.restore();
  }
});

test("cancelTask leaves the task available when its material refund fails", async () => {
  const task = {
    id: "craft-cancel",
    gearId: "iron-gear",
    quantity: 1,
    materialId: "iron",
    materialSpentLb: 2,
    progress: 0,
    progressTarget: 10,
    progressPerDay: 5
  };
  const fixture = installFixture({
    craftState: { version: 1, counter: 1, queue: [clone(task)] }
  });
  const { moduleApi } = createCraftModuleApi({
    materialQuantity: 8,
    onAddModelItem() {
      throw new Error("refund failed");
    }
  });
  const service = new CraftingService(moduleApi);

  try {
    await assert.rejects(service.cancelTask(task.id), /refund failed/u);
    assert.deepEqual(fixture.settingsStore[SETTINGS_KEYS.CRAFT_STATE].queue, [task]);
  }
  finally {
    fixture.restore();
  }
});

test("processOneDay preserves a completed task until output creation succeeds", async () => {
  const task = {
    id: "craft-output",
    gearId: "iron-gear",
    gearName: "Iron Gear",
    quantity: 1,
    materialId: "iron",
    materialSpentLb: 2,
    progress: 5,
    progressTarget: 10,
    progressPerDay: 5
  };
  const fixture = installFixture({
    craftState: { version: 1, counter: 1, queue: [clone(task)] }
  });
  const { moduleApi } = createCraftModuleApi({
    onAddModelItem() {
      throw new Error("output failed");
    }
  });
  const service = new CraftingService(moduleApi);

  try {
    await assert.rejects(service.processOneDay({ mutationId: "day-output-failure" }), /output failed/u);
    assert.equal(fixture.settingsStore[SETTINGS_KEYS.CRAFT_STATE].queue.length, 1);
    assert.equal(fixture.settingsStore[SETTINGS_KEYS.CRAFT_STATE].queue[0].id, task.id);
  }
  finally {
    fixture.restore();
  }
});

test("queueTask retry with the same mutation id never debits materials twice", async () => {
  let ambiguousWrite = true;
  const fixture = installFixture({
    craftState: { version: 1, counter: 0, queue: [] },
    onSettingSet({ key, value, settingsStore }) {
      settingsStore[key] = clone(value);
      if (key === SETTINGS_KEYS.CRAFT_STATE && ambiguousWrite) {
        ambiguousWrite = false;
        throw new Error("response lost after craft persistence");
      }
    }
  });
  const { moduleApi, state } = createCraftModuleApi();
  const service = new CraftingService(moduleApi);

  try {
    const first = await service.queueTask({ gearId: "iron-gear", quantity: 1, mutationId: "queue-retry" });
    const second = await service.queueTask({ gearId: "iron-gear", quantity: 1, mutationId: "queue-retry" });

    assert.equal(first.id, second.id);
    assert.equal(state.materialQuantity, 8);
    assert.equal(state.updates.length, 1);
    assert.equal(fixture.settingsStore[SETTINGS_KEYS.CRAFT_STATE].queue.length, 1);
  }
  finally {
    fixture.restore();
  }
});

test("cancel and completion retries inspect receipts before granting value again", async () => {
  const cancelTask = {
    id: "craft-refund-retry",
    gearId: "iron-gear",
    quantity: 1,
    materialId: "iron",
    materialSpentLb: 2,
    progress: 0,
    progressTarget: 10,
    progressPerDay: 5
  };
  const outputTask = {
    id: "craft-output-retry",
    gearId: "iron-gear",
    quantity: 1,
    materialId: "iron",
    materialSpentLb: 2,
    progress: 5,
    progressTarget: 10,
    progressPerDay: 5
  };
  const fixture = installFixture({
    craftState: { version: 1, counter: 2, queue: [clone(cancelTask), clone(outputTask)] }
  });
  const thrown = new Set();
  const { moduleApi, state } = createCraftModuleApi({
    materialQuantity: 8,
    onAddModelItem({ sourceType, quantity, state: inventoryState }) {
      if (sourceType === "material") inventoryState.materialQuantity += quantity;
      if (sourceType === "gear") inventoryState.gearQuantity += quantity;
      if (!thrown.has(sourceType)) {
        thrown.add(sourceType);
        throw new Error(`lost ${sourceType} response`);
      }
      return { sourceType, quantity };
    }
  });
  const service = new CraftingService(moduleApi);

  try {
    assert.equal(await service.cancelTask(cancelTask.id), true);
    assert.equal(await service.cancelTask(cancelTask.id), true);
    const firstDay = await service.processOneDay({ mutationId: "completion-retry" });
    const secondDay = await service.processOneDay({ mutationId: "completion-retry" });

    assert.equal(firstDay.completedCount, 1);
    assert.equal(secondDay.completedCount, 1);
    assert.equal(state.materialQuantity, 10);
    assert.equal(state.gearQuantity, 1);
    assert.equal(state.additions.filter((entry) => entry.sourceType === "material").length, 1);
    assert.equal(state.additions.filter((entry) => entry.sourceType === "gear").length, 1);
  }
  finally {
    fixture.restore();
  }
});
