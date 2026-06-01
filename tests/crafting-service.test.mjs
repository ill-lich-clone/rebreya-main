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

function installFixture({ actors = [], partyState = {}, craftState = {} } = {}) {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  const settingsStore = {
    [SETTINGS_KEYS.PARTY_STATE]: partyState,
    [SETTINGS_KEYS.CRAFT_STATE]: craftState
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
          settingsStore[key] = value;
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
