import test from "node:test";
import assert from "node:assert/strict";

import { DOWNTIME_ITEM_TYPE, MODULE_ID } from "../scripts/constants.js";
import { GROUP_CONTEXT_ERRORS } from "../scripts/data/group-context-service.js";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import {
  INVENTORY_CURRENCY_CONVERT_COMMAND,
  INVENTORY_CURRENCY_UPDATE_COMMAND,
  InventoryService,
  captureInventoryTransferIdentity
} from "../scripts/data/inventory-service.js";

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
      flattenObject: (source, prefix = "") => Object.entries(source ?? {}).reduce((flat, [key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          Object.assign(flat, globalThis.foundry.utils.flattenObject(value, path));
        }
        else {
          flat[path] = value;
        }
        return flat;
      }, {}),
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

function applyPatch(target, patch) {
  for (const [path, value] of Object.entries(patch ?? {})) {
    foundry.utils.setProperty(target, path, value);
  }
}

function createItem({
  id,
  name = "Item",
  type = "loot",
  quantity = 1,
  weight = 0,
  flags = {},
  extra = {}
} = {}) {
  const item = {
    _id: id,
    id,
    name,
    type,
    img: "icons/svg/item-bag.svg",
    system: {
      quantity,
      weight: {
        value: weight
      }
    },
    flags,
    ...clone(extra),
    toObject() {
      return clone({
        _id: this._id,
        name: this.name,
        type: this.type,
        img: this.img,
        system: this.system,
        flags: this.flags,
        folder: this.folder,
        sort: this.sort,
        ownership: this.ownership,
        _stats: this._stats
      });
    },
    async update(patch) {
      applyPatch(this, patch);
      return this;
    },
    getFlag(moduleId, key) {
      return this.flags?.[moduleId]?.[key];
    },
    async delete() {
      const parentItems = this.parent?.items?.contents;
      if (Array.isArray(parentItems)) {
        const index = parentItems.indexOf(this);
        if (index >= 0) {
          parentItems.splice(index, 1);
        }
      }
      return this;
    }
  };
  return item;
}

function createActor({
  id,
  name = "Actor",
  type = "npc",
  isOwner = false,
  currency = {},
  items = [],
  flags = {},
  abilities = {},
  members = []
} = {}) {
  const setFlagCalls = [];
  const actor = {
    id,
    uuid: `Actor.${id}`,
    name,
    type,
    img: "icons/svg/mystery-man.svg",
    isOwner,
    system: {
      currency: {
        pp: 0,
        gp: 0,
        ep: 0,
        sp: 0,
        cp: 0,
        ...currency
      },
      abilities: {
        str: {
          value: abilities.str?.value ?? 10
        },
        con: {
          mod: abilities.con?.mod ?? 0
        }
      },
      members
    },
    items: {
      contents: items,
      get: (itemId) => actor.items.contents.find((item) => item.id === itemId) ?? null
    },
    flags: clone(flags),
    setFlagCalls,
    getFlag(moduleId, key) {
      return this.flags?.[moduleId]?.[key];
    },
    async setFlag(moduleId, key, value) {
      setFlagCalls.push({ moduleId, key, value: clone(value) });
      this.flags[moduleId] ??= {};
      this.flags[moduleId][key] = clone(value);
      return value;
    },
    async update(patch) {
      applyPatch(this, patch);
      return this;
    },
    async createEmbeddedDocuments(_documentName, documents) {
      const created = documents.map((document, index) => {
        const item = createItem({
          id: `created-${this.items.contents.length + index + 1}`,
          name: document.name,
          type: document.type,
          quantity: foundry.utils.getProperty(document, "system.quantity"),
          flags: document.flags,
          extra: document
        });
        this.items.contents.push(item);
        return item;
      });
      return created;
    }
  };
  for (const item of actor.items.contents) {
    item.parent = actor;
  }
  return actor;
}

function installInventoryFixture({
  actors = [],
  user = { id: "gm", isGM: true },
  partyState = {},
  groupState = {}
} = {}) {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  const previousActor = globalThis.Actor;
  const previousConst = globalThis.CONST;
  let state = partyState;
  let actorCreateCalls = 0;
  let createdActor = null;

  globalThis.Actor = class TestActor {
    static async create(data) {
      actorCreateCalls += 1;
      createdActor = createActor({
        id: "legacy-party",
        name: data.name,
        type: data.type,
        isOwner: true
      });
      createdActor.img = data.img;
      createdActor.flags = data.flags;
      actors.push(createdActor);
      return createdActor;
    }
  };
  globalThis.CONST = {
    DOCUMENT_OWNERSHIP_LEVELS: {
      OWNER: 3,
      OBSERVER: 2
    }
  };
  globalThis.game = {
    user,
    actors: {
      contents: actors,
      get: (actorId) => actors.find((actor) => actor.id === actorId) ?? null
    },
    settings: {
      get: (_moduleId, key) => key === "groupState" ? groupState : state,
      set: async (_moduleId, key, nextState) => {
        if (key === "groupState") {
          groupState = nextState;
        }
        else {
          state = nextState;
        }
        return nextState;
      }
    }
  };

  return {
    get actorCreateCalls() {
      return actorCreateCalls;
    },
    get createdActor() {
      return createdActor;
    },
    get state() {
      return state;
    },
    get groupState() {
      return groupState;
    },
    restore() {
      globalThis.game = previousGame;
      globalThis.Actor = previousActor;
      globalThis.CONST = previousConst;
      restoreFoundry();
    }
  };
}

test("getInventoryActor returns resolved dnd5e group actor when group context exists", async () => {
  const groupActor = createActor({ id: "group-1", name: "Party", type: "group", isOwner: true });
  const fixture = installInventoryFixture({
    actors: [groupActor],
    partyState: { inventoryActorId: "legacy-party" }
  });
  const legacyActor = createActor({ id: "legacy-party", name: "Инвентарь группы Rebreya", type: "npc", isOwner: true });
  game.actors.contents.push(legacyActor);
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({ groupActor })
    }
  });

  try {
    const actor = await service.getInventoryActor({ create: true });

    assert.equal(actor, groupActor);
  }
  finally {
    fixture.restore();
  }
});

test("getInventorySnapshot classifies Rebreya downtime items as downtime templates", async () => {
  const downtimeItem = createItem({
    id: "downtime-research",
    name: "Исследование",
    type: DOWNTIME_ITEM_TYPE
  });
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: true,
    items: [downtimeItem]
  });
  const fixture = installInventoryFixture({
    actors: [groupActor]
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({ groupActor })
    },
    getModel: async () => ({
      materials: [],
      materialById: new Map(),
      materialByGoodId: new Map(),
      gear: [],
      gearById: new Map()
    })
  });

  try {
    const snapshot = await service.getInventorySnapshot();
    const filtered = await service.getInventorySnapshot({ typeFilter: "downtime" });

    assert.equal(snapshot.items[0].sourceType, "downtime");
    assert.equal(snapshot.items[0].sourceTypeLabel, "Простой");
    assert.equal(snapshot.items[0].itemTypeLabel, "Простой");
    assert.deepEqual(filtered.items.map((item) => item.itemId), ["downtime-research"]);
  }
  finally {
    fixture.restore();
  }
});

test("getInventorySnapshot projects normalized Actor folder state without writing it", async () => {
  const sword = createItem({ id: "sword", name: "Sword", type: "weapon", quantity: 2, weight: 3 });
  const torch = createItem({ id: "torch", name: "Torch", quantity: 4, weight: 1 });
  const groupActor = createActor({
    id: "group-a",
    name: "Party A",
    type: "group",
    isOwner: true,
    items: [sword, torch],
    flags: {
      [MODULE_ID]: {
        inventoryFolders: {
          version: 99,
          folders: [
            { id: "weapons", name: " Оружие ", parentId: "missing" }
          ],
          itemFolderIds: {
            sword: "weapons",
            stale: "weapons",
            torch: "missing"
          }
        }
      }
    }
  });
  let resolveForGroupCalls = 0;
  const fixture = installInventoryFixture({ actors: [groupActor] });
  const service = new InventoryService({
    groupContextService: {
      resolveForGroup: (groupActorId) => {
        resolveForGroupCalls += 1;
        assert.equal(groupActorId, "group-a");
        return { groupActor };
      },
      resolveForCurrentUser: () => assert.fail("explicit group lookup must not use current group")
    },
    getModel: async () => ({
      materials: [],
      materialById: new Map(),
      materialByGoodId: new Map(),
      gear: [],
      gearById: new Map()
    })
  });

  try {
    const snapshot = await service.getInventorySnapshot({
      createActor: false,
      groupActorId: "group-a"
    });

    assert.equal(resolveForGroupCalls, 1);
    assert.deepEqual(snapshot.folders, [
      { id: "weapons", name: "Оружие", parentId: null }
    ]);
    assert.equal(snapshot.folderStateVersion, 1);
    assert.equal(snapshot.allItems.find((row) => row.itemId === "sword").folderId, "weapons");
    assert.equal(snapshot.allItems.find((row) => row.itemId === "torch").folderId, null);
    assert.equal(groupActor.setFlagCalls.length, 0);

    const summaryBefore = clone(snapshot.summary);
    groupActor.flags[MODULE_ID].inventoryFolders = undefined;
    const rootSnapshot = await service.getInventorySnapshot({ createActor: false, groupActorId: "group-a" });
    assert.deepEqual(rootSnapshot.folders, []);
    assert.ok(rootSnapshot.allItems.every((row) => row.folderId === null));
    assert.deepEqual(rootSnapshot.summary, summaryBefore);
    assert.equal(groupActor.setFlagCalls.length, 0);
  }
  finally {
    fixture.restore();
  }
});

test("folder mutations normalize current Actor state and write exactly once only when changed", async () => {
  const sword = createItem({ id: "sword", name: "Sword", quantity: 7 });
  let itemUpdateCalls = 0;
  let itemDeleteCalls = 0;
  sword.update = async () => {
    itemUpdateCalls += 1;
    return sword;
  };
  sword.delete = async () => {
    itemDeleteCalls += 1;
    return sword;
  };
  const groupActor = createActor({
    id: "group-a",
    name: "Party A",
    type: "group",
    isOwner: true,
    items: [sword],
    flags: {
      [MODULE_ID]: {
        inventoryFolders: {
          version: 42,
          folders: [{ id: "orphan", name: " Orphan ", parentId: "missing" }],
          itemFolderIds: { stale: "orphan" }
        }
      }
    }
  });
  let resolveCalls = 0;
  const fixture = installInventoryFixture({ actors: [groupActor] });
  let createEmbeddedCalls = 0;
  const createEmbeddedDocuments = groupActor.createEmbeddedDocuments.bind(groupActor);
  groupActor.createEmbeddedDocuments = async (...args) => {
    createEmbeddedCalls += 1;
    return createEmbeddedDocuments(...args);
  };
  const service = new InventoryService({
    groupContextService: {
      resolveForGroup: (groupActorId) => {
        resolveCalls += 1;
        assert.equal(groupActorId, "group-a");
        return { groupActor };
      }
    },
    worldMutationCoordinator: new WorldMutationCoordinator()
  });

  try {
    const created = await service.createInventoryFolder({
      groupActorId: "group-a",
      folderId: "weapons",
      name: " Weapons ",
      parentId: null
    });
    assert.deepEqual(created, {
      actorId: "group-a",
      folderId: "weapons",
      changed: true,
      deletedFolderId: ""
    });
    assert.deepEqual(groupActor.setFlagCalls[0].value, {
      version: 1,
      folders: [
        { id: "orphan", name: "Orphan", parentId: null },
        { id: "weapons", name: "Weapons", parentId: null }
      ],
      itemFolderIds: {}
    });

    const replay = await service.createInventoryFolder({
      groupActorId: "group-a",
      folderId: "weapons",
      name: "Weapons",
      parentId: null
    });
    assert.equal(replay.changed, false);
    assert.equal(groupActor.setFlagCalls.length, 1);

    assert.equal((await service.renameInventoryFolder({
      groupActorId: "group-a",
      folderId: "weapons",
      name: "Armory"
    })).changed, true);
    assert.equal((await service.moveInventoryFolder({
      groupActorId: "group-a",
      folderId: "orphan",
      parentId: "weapons"
    })).changed, true);
    const flagWritesBeforeItemMove = groupActor.setFlagCalls.length;
    const itemMove = await service.moveInventoryItemToFolder({
      groupActorId: "group-a",
      itemId: "sword",
      folderId: "orphan"
    });
    assert.equal(itemMove.changed, true);
    assert.equal(itemMove.itemId, "sword");
    assert.equal(groupActor.setFlagCalls.length, flagWritesBeforeItemMove + 1);
    assert.equal(itemUpdateCalls, 0);
    assert.equal(itemDeleteCalls, 0);
    assert.equal(createEmbeddedCalls, 0);
    assert.equal(sword.system.quantity, 7);

    const deleted = await service.deleteInventoryFolder({ groupActorId: "group-a", folderId: "orphan" });
    assert.equal(deleted.changed, true);
    assert.equal(deleted.deletedFolderId, "orphan");
    assert.equal(groupActor.getFlag(MODULE_ID, "inventoryFolders").itemFolderIds.sword, "weapons");
    assert.equal(groupActor.setFlagCalls.length, 5);
    assert.equal(resolveCalls, 6);

    const missingDelete = await service.deleteInventoryFolder({ groupActorId: "group-a", folderId: "missing" });
    assert.equal(missingDelete.changed, false);
    assert.equal(missingDelete.deletedFolderId, "");
    assert.equal(groupActor.setFlagCalls.length, 5);
  }
  finally {
    fixture.restore();
  }
});

test("assignInventoryGrantFolder uses the canonical mutation path and rejects a missing Item", async () => {
  const sword = createItem({ id: "sword", name: "Sword" });
  const groupActor = createActor({
    id: "group-a",
    type: "group",
    isOwner: true,
    items: [sword],
    flags: {
      [MODULE_ID]: {
        inventoryFolders: {
          version: 1,
          folders: [{ id: "weapons", name: "Weapons", parentId: null }],
          itemFolderIds: {}
        }
      }
    }
  });
  const fixture = installInventoryFixture({ actors: [groupActor] });
  const service = new InventoryService({
    groupContextService: { resolveForGroup: () => ({ groupActor }) },
    worldMutationCoordinator: new WorldMutationCoordinator()
  });

  try {
    const result = await service.assignInventoryGrantFolder({
      groupActorId: "group-a",
      itemId: "sword",
      folderId: "weapons"
    });
    assert.equal(result.itemId, "sword");
    assert.equal(result.changed, true);
    assert.equal(groupActor.setFlagCalls.length, 1);
    const rootResult = await service.assignInventoryGrantFolder({
      groupActorId: "group-a",
      itemId: "sword",
      folderId: null
    });
    assert.equal(rootResult.folderId, null);
    assert.equal(rootResult.changed, true);
    assert.equal(groupActor.setFlagCalls.length, 2);
    await assert.rejects(
      () => service.assignInventoryGrantFolder({
        groupActorId: "group-a",
        itemId: "missing",
        folderId: "weapons"
      }),
      (error) => error?.code === "item-not-found"
    );
    assert.equal(groupActor.setFlagCalls.length, 2);
  }
  finally {
    fixture.restore();
  }
});

test("folder mutations re-resolve after queue wait and reject a stale cycle", async () => {
  const initialActor = createActor({ id: "group-a", type: "group", isOwner: true });
  const currentActor = createActor({
    id: "group-a",
    type: "group",
    isOwner: true,
    flags: {
      [MODULE_ID]: {
        inventoryFolders: {
          version: 1,
          folders: [
            { id: "branch", name: "Branch", parentId: null },
            { id: "target", name: "Target", parentId: "branch" }
          ],
          itemFolderIds: {}
        }
      }
    }
  });
  const coordinator = new WorldMutationCoordinator();
  let releaseQueue;
  const blocker = coordinator.run("inventory-folders:group-a", () => new Promise((resolve) => {
    releaseQueue = resolve;
  }));
  await new Promise((resolve) => setImmediate(resolve));
  let resolvedActor = initialActor;
  const fixture = installInventoryFixture({ actors: [initialActor, currentActor] });
  const service = new InventoryService({
    groupContextService: { resolveForGroup: () => ({ groupActor: resolvedActor }) },
    worldMutationCoordinator: coordinator
  });

  try {
    const pendingMove = service.moveInventoryFolder({
      groupActorId: "group-a",
      folderId: "branch",
      parentId: "target"
    });
    resolvedActor = currentActor;
    releaseQueue();
    await blocker;
    await assert.rejects(pendingMove, (error) => error?.code === "folder-cycle");
    assert.equal(initialActor.setFlagCalls.length, 0);
    assert.equal(currentActor.setFlagCalls.length, 0);
  }
  finally {
    fixture.restore();
  }
});

test("folder mutation coordinator serializes one Actor and allows another Actor to proceed", async () => {
  const groupA = createActor({ id: "group-a", type: "group", isOwner: true });
  const groupB = createActor({ id: "group-b", type: "group", isOwner: true });
  let releaseA;
  const originalSetFlagA = groupA.setFlag.bind(groupA);
  groupA.setFlag = async (...args) => {
    await new Promise((resolve) => {
      releaseA = resolve;
    });
    return originalSetFlagA(...args);
  };
  const fixture = installInventoryFixture({ actors: [groupA, groupB] });
  const service = new InventoryService({
    groupContextService: {
      resolveForGroup: (groupActorId) => ({ groupActor: groupActorId === "group-a" ? groupA : groupB })
    },
    worldMutationCoordinator: new WorldMutationCoordinator()
  });

  try {
    const firstA = service.createInventoryFolder({
      groupActorId: "group-a",
      folderId: "a-one",
      name: "A one",
      parentId: null
    });
    await new Promise((resolve) => setImmediate(resolve));
    const secondA = service.createInventoryFolder({
      groupActorId: "group-a",
      folderId: "a-two",
      name: "A two",
      parentId: null
    });
    const resultB = await service.createInventoryFolder({
      groupActorId: "group-b",
      folderId: "b-one",
      name: "B one",
      parentId: null
    });

    assert.equal(resultB.changed, true);
    assert.equal(groupB.setFlagCalls.length, 1);
    assert.equal(groupA.setFlagCalls.length, 0);
    releaseA();
    await firstA;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(groupA.setFlagCalls.length, 1);
    releaseA();
    await secondA;
    assert.equal(groupA.setFlagCalls.length, 2);
  }
  finally {
    fixture.restore();
  }
});

test("getTransportSnapshot does not treat warehouse items as concrete group transport", async () => {
  const wagon = createItem({
    id: "wagon-1",
    name: "Тяжёлый гражданский фургон",
    type: "equipment",
    quantity: 1,
    weight: 6000,
    flags: {
      [MODULE_ID]: {
        sourceType: "gear",
        transport: {
          typeLabel: "Механический транспорт",
          travelSpeedMph: 12,
          cargoCapacityLb: 10000,
          hp: { value: 200, max: 200 },
          ac: 14,
          crew: 1,
          passengers: 8,
          fuel: "Жидкий уголь 1/8 галлона"
        }
      }
    }
  });
  const groupActor = createActor({
    id: "group-transport",
    name: "Party",
    type: "group",
    isOwner: true,
    items: [wagon]
  });
  const groupState = {
    groupsById: {
      [groupActor.id]: {
        transportState: {
          activeTransportId: "item:wagon-1"
        }
      }
    }
  };
  const fixture = installInventoryFixture({
    actors: [groupActor],
    groupState
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({
        groupActor,
        groupId: groupActor.id,
        canManage: true,
        groupState: groupState.groupsById[groupActor.id]
      })
    },
    getModel: async () => ({
      materials: [],
      materialById: new Map(),
      materialByGoodId: new Map(),
      gear: [],
      gearById: new Map()
    })
  });

  try {
    const inventorySnapshot = await service.getInventorySnapshot();
    const transportSnapshot = await service.getTransportSnapshot({ inventorySnapshot });

    assert.equal(transportSnapshot.hasVehicles, false);
    assert.equal(transportSnapshot.activeTransportId, "");
    assert.equal(transportSnapshot.activeVehicle, null);
    assert.equal(transportSnapshot.effectiveSpeedMph, 3);
    assert.deepEqual(transportSnapshot.vehicles, []);
    assert.deepEqual(transportSnapshot.fuel, {
      configured: false,
      selector: {
        uuid: "",
        sourceUuid: "",
        sourceType: "",
        sourceId: "",
        type: "",
        normalizedName: "",
        name: "",
        img: ""
      },
      card: null,
      quantity: 0,
      consumptionPerMile: 0,
      unit: "",
      miles: 0,
      isEmpty: false,
      stacks: [],
      reason: "noTransport"
    });
  }
  finally {
    fixture.restore();
  }
});

test("vehicle member reads D&D5e 5.2.5 native fields and live instance state", async () => {
  const fuelItem = createItem({
    id: "fuel-b",
    name: "Жидкий уголь",
    quantity: 3,
    flags: {
      [MODULE_ID]: { sourceType: "good", sourceId: "liquid-coal" }
    },
    extra: { uuid: "Actor.group-a.Item.fuel-b" }
  });
  const secondFuelItem = createItem({
    id: "fuel-a",
    name: "Жидкий уголь",
    quantity: 2,
    flags: {
      [MODULE_ID]: { sourceType: "good", sourceId: "liquid-coal" }
    },
    extra: { uuid: "Actor.group-a.Item.fuel-a" }
  });
  const actor = createActor({
    id: "vehicle-a",
    name: "Тяжёлый гражданский фургон",
    type: "vehicle",
    isOwner: true,
    flags: {
      [MODULE_ID]: {
        sourceId: "transport-v01-heavy-wagon",
        transport: {
          instance: true,
          sourceActorUuid: "Compendium.world.rebreya-transport.Actor.heavywagon",
          groupActorId: "group-a",
          consumption: {
            kind: "fuel",
            amount: 0.125,
            unit: "gal",
            cadence: "mile",
            raw: "Жидкий уголь 1/8 галлона"
          },
          instanceState: {
            condition: "damaged",
            fuelConsumption: {
              amount: 2,
              unit: "lb"
            },
            fuelSelector: {
              uuid: "Compendium.world.goods.Item.coal",
              sourceType: "good",
              sourceId: "liquid-coal",
              type: "loot",
              normalizedName: "жидкий уголь",
              name: "Жидкий уголь",
              img: "icons/coal.webp"
            }
          }
        }
      }
    }
  });
  actor.system.attributes = {
    hp: { value: 72, max: 100 },
    ac: { flat: 17 },
    capacity: { cargo: { value: 5000, units: "lb" } },
    travel: { speeds: { land: 12 } }
  };
  actor.system.crew = { max: 2, value: [] };
  actor.system.passengers = { max: 6, value: [] };
  const groupActor = createActor({
    id: "group-a",
    name: "Партия",
    type: "group",
    isOwner: true,
    members: [{ actor }],
    items: [fuelItem, secondFuelItem]
  });
  const fixture = installInventoryFixture({
    actors: [groupActor, actor],
    partyState: {
      members: {
        "vehicle-a": {
          role: "member"
        }
      }
    }
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({
        groupActor,
        groupId: groupActor.id,
        groupState: {
          memberStateByActorId: {
            "vehicle-a": {
              role: "transport",
              capBonusLb: 250
            }
          }
        },
        members: [actor],
        canManage: true
      })
    },
    getModel: async () => ({
      materials: [],
      materialById: new Map(),
      materialByGoodId: new Map(),
      gear: [],
      gearById: new Map()
    })
  });

  try {
    const snapshot = await service.getPartySnapshot();
    const member = snapshot.members[0];

    assert.equal(member.transport.actorId, "vehicle-a");
    assert.equal(member.transport.actorUuid, "Actor.vehicle-a");
    assert.equal(member.transport.isActorBacked, true);
    assert.equal(member.transport.canEditState, true);
    assert.equal(member.transport.cargoCapacityLb, 5000);
    assert.equal(member.transport.crew, 2);
    assert.equal(member.transport.passengers, 6);
    assert.equal(member.transport.hpValue, 72);
    assert.equal(member.transport.hpMax, 100);
    assert.equal(member.transport.ac, 17);
    assert.equal(member.transport.condition, "damaged");
    assert.equal(member.transport.conditionLabel, "Повреждён");
    assert.equal(member.capacityLb, 5250);

    const transportSnapshot = await service.getTransportSnapshot({
      partySnapshot: snapshot,
      inventorySnapshot: {
        actor: { canEdit: true },
        canDropInventoryItems: true
      }
    });
    assert.equal(transportSnapshot.fuel.quantity, 5);
    assert.equal(transportSnapshot.fuel.consumptionPerMile, 2);
    assert.equal(transportSnapshot.fuel.unit, "lb");
    assert.equal(transportSnapshot.fuel.consumptionSource, "override");
    assert.equal(transportSnapshot.fuel.miles, 2);
    assert.equal(transportSnapshot.fuel.card.name, "Жидкий уголь");
    assert.equal(transportSnapshot.fuel.card.openUuid, "Actor.group-a.Item.fuel-a");
    assert.equal(transportSnapshot.fuel.card.quantity, 5);
    assert.equal(transportSnapshot.fuel.card.canOpen, true);
    assert.deepEqual(transportSnapshot.fuel.stacks.map((stack) => stack.itemId), ["fuel-a", "fuel-b"]);

    delete actor.flags[MODULE_ID].transport.instanceState.fuelConsumption;
    const fallbackPartySnapshot = await service.getPartySnapshot();
    const fallbackTransportSnapshot = await service.getTransportSnapshot({
      partySnapshot: fallbackPartySnapshot,
      inventorySnapshot: {
        actor: { canEdit: true },
        canDropInventoryItems: true
      }
    });
    assert.equal(fallbackTransportSnapshot.fuel.consumptionPerMile, 0.125);
    assert.equal(fallbackTransportSnapshot.fuel.unit, "gal");
    assert.equal(fallbackTransportSnapshot.fuel.consumptionSource, "transport");
    assert.equal(fallbackTransportSnapshot.fuel.miles, 40);

    fuelItem.system.quantity = 0;
    secondFuelItem.system.quantity = 0;
    const emptyFuelSnapshot = await service.getTransportSnapshot({
      partySnapshot: snapshot,
      inventorySnapshot: {
        actor: { canEdit: true },
        canDropInventoryItems: true
      }
    });
    assert.equal(emptyFuelSnapshot.fuel.configured, true);
    assert.equal(emptyFuelSnapshot.fuel.quantity, 0);
    assert.equal(emptyFuelSnapshot.fuel.miles, 0);
    assert.equal(emptyFuelSnapshot.fuel.isEmpty, true);
    assert.equal(emptyFuelSnapshot.fuel.card.openUuid, "Actor.group-a.Item.fuel-a");
  }
  finally {
    fixture.restore();
  }
});

test("getTransportSnapshot returns active-first rows with independent fuel views", async () => {
  const coalItem = createItem({
    id: "fuel-coal",
    name: "Уголь",
    quantity: 8,
    flags: {
      [MODULE_ID]: { sourceType: "good", sourceId: "coal" }
    },
    extra: { uuid: "Actor.group-a.Item.fuel-coal" }
  });
  const cokeItem = createItem({
    id: "fuel-coke",
    name: "Кокс",
    quantity: 12,
    flags: {
      [MODULE_ID]: { sourceType: "good", sourceId: "coke" }
    },
    extra: { uuid: "Actor.group-a.Item.fuel-coke" }
  });
  const groupActor = createActor({
    id: "group-a",
    name: "Партия",
    type: "group",
    isOwner: true,
    items: [coalItem, cokeItem]
  });
  const makeTransport = ({ id, name, sourceId, fuelName, amount, unit }) => ({
    actorId: id,
    actorName: name,
    transport: {
      id: `member:${id}`,
      actorId: id,
      name,
      isTransport: true,
      isConcreteInstance: true,
      isActorBacked: true,
      canEditState: true,
      speedMph: 10,
      cargoCapacityLb: 1000,
      hpValue: 40,
      hpMax: 40,
      condition: "operational",
      fuelSelector: {
        uuid: `Compendium.world.goods.Item.${sourceId}`,
        sourceType: "good",
        sourceId,
        type: "loot",
        normalizedName: fuelName.toLocaleLowerCase("ru"),
        name: fuelName,
        img: "icons/svg/item-bag.svg"
      },
      fuelConsumption: { amount, unit },
      consumption: { kind: "fuel", amount, unit, cadence: "mile", raw: fuelName }
    }
  });
  const service = new InventoryService({
    getModel: async () => ({
      materials: [],
      materialById: new Map(),
      materialByGoodId: new Map(),
      gear: [],
      gearById: new Map()
    })
  });

  const snapshot = await service.getTransportSnapshot({
    partySnapshot: {
      canManage: true,
      inventoryWeight: 0,
      members: [
        makeTransport({ id: "vehicle-a", name: "Броневик", sourceId: "coal", fuelName: "Уголь", amount: 2, unit: "lb" }),
        makeTransport({ id: "vehicle-b", name: "Фургон", sourceId: "coke", fuelName: "Кокс", amount: 0.5, unit: "gal" })
      ]
    },
    inventorySnapshot: {
      actor: { canEdit: true },
      canDropInventoryItems: true
    },
    context: {
      groupActor,
      groupId: groupActor.id,
      groupState: {
        transportState: { activeTransportId: "member:vehicle-b" }
      },
      canManage: true
    }
  });

  assert.deepEqual(snapshot.vehicles.map((vehicle) => vehicle.id), [
    "member:vehicle-b",
    "member:vehicle-a"
  ]);
  assert.equal(snapshot.vehicles[0].active, true);
  assert.equal(snapshot.vehicles[0].fuel.card.name, "Кокс");
  assert.equal(snapshot.vehicles[0].fuel.quantity, 12);
  assert.equal(snapshot.vehicles[0].fuel.consumptionPerMile, 0.5);
  assert.equal(snapshot.vehicles[0].fuel.unit, "gal");
  assert.equal(snapshot.vehicles[1].active, false);
  assert.equal(snapshot.vehicles[1].fuel.card.name, "Уголь");
  assert.equal(snapshot.vehicles[1].fuel.quantity, 8);
  assert.equal(snapshot.vehicles[1].fuel.consumptionPerMile, 2);
  assert.equal(snapshot.vehicles[1].fuel.unit, "lb");
  assert.equal(snapshot.fuel, snapshot.vehicles[0].fuel);
});

test("ordinary D&D5e vehicles are not selectable as concrete Rebreya transport", async () => {
  const actor = createActor({
    id: "ordinary-vehicle",
    name: "Обычная повозка",
    type: "vehicle",
    isOwner: true
  });
  actor.system.attributes = {
    hp: { value: 20, max: 20 },
    capacity: { cargo: { value: 500, units: "lb" } },
    travel: { speeds: { land: 4 } }
  };
  const groupActor = createActor({
    id: "group-ordinary",
    name: "Партия",
    type: "group",
    isOwner: true,
    members: [{ actor }]
  });
  const fixture = installInventoryFixture({
    actors: [groupActor, actor],
    partyState: {
      members: {
        "ordinary-vehicle": { role: "transport" }
      }
    }
  });
  const context = {
    groupActor,
    groupId: groupActor.id,
    groupState: {
      memberStateByActorId: {
        "ordinary-vehicle": { role: "transport" }
      },
      transportState: {
        activeTransportId: "member:ordinary-vehicle"
      }
    },
    members: [actor],
    canManage: true
  };
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => context
    },
    getModel: async () => ({
      materials: [],
      materialById: new Map(),
      materialByGoodId: new Map(),
      gear: [],
      gearById: new Map()
    })
  });

  try {
    const partySnapshot = await service.getPartySnapshot();
    const transportSnapshot = await service.getTransportSnapshot({
      partySnapshot,
      context,
      inventorySnapshot: {
        actor: { canEdit: true },
        canDropInventoryItems: true,
        inventoryWeight: 0
      }
    });

    assert.equal(partySnapshot.members[0].transport.canEditState, false);
    assert.deepEqual(transportSnapshot.vehicles, []);
    assert.equal(transportSnapshot.activeTransportId, "");
  }
  finally {
    fixture.restore();
  }
});

test("mount member uses explicit native cargo plus the configured capacity bonus", async () => {
  const mount = createActor({
    id: "mount-a",
    name: "Боевой конь",
    type: "vehicle",
    isOwner: true
  });
  mount.system.attributes = {
    hp: { value: 0, max: 0 },
    ac: { flat: 11 },
    capacity: { cargo: { value: 540, units: "lb" } },
    travel: { speeds: { land: 6 } }
  };
  const groupActor = createActor({
    id: "group-mount",
    name: "Партия",
    type: "group",
    isOwner: true,
    members: [{ actor: mount }]
  });
  const fixture = installInventoryFixture({
    actors: [groupActor, mount],
    partyState: {
      members: {
        "mount-a": {
          role: "mount",
          capBonusLb: 60
        }
      }
    }
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({
        groupActor,
        groupId: groupActor.id,
        members: [mount],
        canManage: true
      })
    },
    getModel: async () => ({
      materials: [],
      materialById: new Map(),
      materialByGoodId: new Map(),
      gear: [],
      gearById: new Map()
    })
  });

  try {
    const snapshot = await service.getPartySnapshot();

    assert.equal(snapshot.members[0].transport.cargoCapacityLb, 540);
    assert.equal(snapshot.members[0].capacityLb, 600);
  }
  finally {
    fixture.restore();
  }
});

test("getTransportSnapshot ignores ordinary character members", async () => {
  const hero = createActor({
    id: "hero-1",
    name: "Hero",
    type: "character",
    isOwner: true,
    abilities: {
      str: { value: 20 }
    }
  });
  hero.system.attributes = {
    movement: {
      walk: 30
    },
    hp: {
      value: 80,
      max: 80
    }
  };
  const groupActor = createActor({
    id: "group-members",
    name: "Party",
    type: "group",
    isOwner: true,
    members: [{ actor: hero }]
  });
  const groupState = {
    groupsById: {
      [groupActor.id]: {
        transportState: {
          activeTransportId: ""
        }
      }
    }
  };
  const fixture = installInventoryFixture({
    actors: [groupActor, hero],
    groupState,
    partyState: {
      members: {
        [hero.id]: {
          role: "member"
        }
      }
    }
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({
        groupActor,
        groupId: groupActor.id,
        canManage: true,
        groupState: groupState.groupsById[groupActor.id]
      })
    },
    getModel: async () => ({
      materials: [],
      materialById: new Map(),
      materialByGoodId: new Map(),
      gear: [],
      gearById: new Map()
    })
  });

  try {
    const transportSnapshot = await service.getTransportSnapshot();

    assert.equal(transportSnapshot.hasVehicles, false);
    assert.deepEqual(transportSnapshot.vehicles, []);
    assert.equal(transportSnapshot.activeVehicle, null);
    assert.equal(transportSnapshot.effectiveSpeedMph, 3);
    assert.equal(transportSnapshot.speedSourceLabel, "Пешком");
  }
  finally {
    fixture.restore();
  }
});

function createGroupContextService(groupActor, fixture, { onSetRegistry = null } = {}) {
  return {
    resolveForGroup(groupActorId) {
      assert.equal(groupActorId, groupActor.id);
      return {
        groupActor,
        groupId: groupActor.id,
        groupState: fixture.groupState.groupsById?.[groupActor.id] ?? {
          groupActorId: groupActor.id,
          migration: {
            legacyInventoryMergedAt: 0,
            legacyInventoryActorId: ""
          }
        }
      };
    },
    getRegistry() {
      return fixture.groupState;
    },
    async setRegistry(nextRegistry) {
      await onSetRegistry?.(nextRegistry);
      await game.settings.set(MODULE_ID, "groupState", nextRegistry);
      return nextRegistry;
    }
  };
}

function createLegacyMergeFixture({
  user = { id: "gm", isGM: true },
  groupItems = [],
  legacyItems = [],
  legacyActor = null,
  groupManaged = true,
  groupState = null,
  onSetRegistry = null
} = {}) {
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: true,
    currency: {
      pp: 1,
      gp: 2,
      sp: 3,
      cp: 4
    },
    items: groupItems,
    flags: groupManaged ? { [MODULE_ID]: { managedPartyGroup: true } } : {}
  });
  const inventoryActor = legacyActor ?? createActor({
    id: "legacy-party",
    name: "Legacy",
    type: "npc",
    isOwner: true,
    currency: {
      pp: 5,
      gp: 6,
      sp: 7,
      cp: 8
    },
    items: legacyItems
  });
  const fixture = installInventoryFixture({
    actors: legacyActor === null ? [groupActor, inventoryActor] : [groupActor, legacyActor].filter(Boolean),
    user,
    partyState: { inventoryActorId: inventoryActor?.id ?? "" },
    groupState: groupState ?? {
      version: 1,
      activeGroupActorId: groupActor.id,
      groupsById: {
        [groupActor.id]: {
          groupActorId: groupActor.id,
          migration: {
            legacyInventoryMergedAt: 0,
            legacyInventoryActorId: ""
          }
        }
      }
    }
  });
  const service = new InventoryService({
    groupContextService: createGroupContextService(groupActor, fixture, { onSetRegistry })
  });

  return {
    fixture,
    service,
    groupActor,
    legacyActor: inventoryActor
  };
}

test("mergeLegacyInventoryIntoGroup sums legacy currency into group actor", async () => {
  const { fixture, service, groupActor } = createLegacyMergeFixture();

  try {
    const result = await service.mergeLegacyInventoryIntoGroup(groupActor.id);

    assert.deepEqual(groupActor.system.currency, {
      pp: 6,
      gp: 8,
      ep: 0,
      sp: 10,
      cp: 12
    });
    assert.equal(result.mergedCurrency.pp, 5);
    assert.equal(result.mergedCurrency.gp, 6);
    assert.equal(result.mergedCurrency.sp, 7);
    assert.equal(result.mergedCurrency.cp, 8);
    assert.equal(result.noop, false);
  }
  finally {
    fixture.restore();
  }
});

test("mergeLegacyInventoryIntoGroup merges matching sourceType and sourceId quantities", async () => {
  const flags = { [MODULE_ID]: { sourceType: "gear", sourceId: "rope" } };
  const groupItem = createItem({ id: "group-rope", name: "Rope", type: "loot", quantity: 2, flags });
  const legacyItem = createItem({ id: "legacy-rope", name: "Rope", type: "loot", quantity: 3, flags });
  const { fixture, service, groupActor } = createLegacyMergeFixture({
    groupItems: [groupItem],
    legacyItems: [legacyItem]
  });

  try {
    const result = await service.mergeLegacyInventoryIntoGroup(groupActor.id);

    assert.equal(groupItem.system.quantity, 5);
    assert.equal(groupActor.items.contents.length, 1);
    assert.equal(result.mergedItems, 1);
    assert.equal(result.createdItems, 0);
  }
  finally {
    fixture.restore();
  }
});

test("mergeLegacyInventoryIntoGroup merges custom items by normalized name and type", async () => {
  const groupItem = createItem({ id: "group-gem", name: "  Blue   Gem ", type: "loot", quantity: 4 });
  const legacyItem = createItem({ id: "legacy-gem", name: "blue gem", type: "loot", quantity: 2 });
  const { fixture, service, groupActor } = createLegacyMergeFixture({
    groupItems: [groupItem],
    legacyItems: [legacyItem]
  });

  try {
    const result = await service.mergeLegacyInventoryIntoGroup(groupActor.id);

    assert.equal(groupItem.system.quantity, 6);
    assert.equal(groupActor.items.contents.length, 1);
    assert.equal(result.mergedItems, 1);
    assert.equal(result.createdItems, 0);
  }
  finally {
    fixture.restore();
  }
});

test("mergeLegacyInventoryIntoGroup aggregates duplicate custom legacy items by merge key", async () => {
  const groupItem = createItem({ id: "group-gem", name: "Blue Gem", type: "loot", quantity: 4 });
  const firstLegacyItem = createItem({ id: "legacy-gem-a", name: "blue gem", type: "loot", quantity: 2 });
  const secondLegacyItem = createItem({ id: "legacy-gem-b", name: " Blue   Gem ", type: "loot", quantity: 3 });
  const { fixture, service, groupActor } = createLegacyMergeFixture({
    groupItems: [groupItem],
    legacyItems: [firstLegacyItem, secondLegacyItem]
  });

  try {
    const result = await service.mergeLegacyInventoryIntoGroup(groupActor.id);

    assert.equal(groupItem.system.quantity, 9);
    assert.equal(groupActor.items.contents.length, 1);
    assert.equal(result.mergedItems, 1);
    assert.equal(result.createdItems, 0);
  }
  finally {
    fixture.restore();
  }
});

test("mergeLegacyInventoryIntoGroup aggregates duplicate source legacy items by sourceType and sourceId", async () => {
  const flags = { [MODULE_ID]: { sourceType: "gear", sourceId: "rope" } };
  const groupItem = createItem({ id: "group-rope", name: "Rope", type: "loot", quantity: 1, flags });
  const firstLegacyItem = createItem({ id: "legacy-rope-a", name: "Rope", type: "loot", quantity: 2, flags });
  const secondLegacyItem = createItem({ id: "legacy-rope-b", name: "Rope Coil", type: "loot", quantity: 4, flags });
  const { fixture, service, groupActor } = createLegacyMergeFixture({
    groupItems: [groupItem],
    legacyItems: [firstLegacyItem, secondLegacyItem]
  });

  try {
    const result = await service.mergeLegacyInventoryIntoGroup(groupActor.id);

    assert.equal(groupItem.system.quantity, 7);
    assert.equal(groupActor.items.contents.length, 1);
    assert.equal(result.mergedItems, 1);
    assert.equal(result.createdItems, 0);
  }
  finally {
    fixture.restore();
  }
});

test("mergeLegacyInventoryIntoGroup creates sanitized new embedded items", async () => {
  const legacyItem = createItem({
    id: "legacy-new",
    name: "New Relic",
    type: "loot",
    quantity: 9,
    extra: {
      folder: "folder-id",
      sort: 100,
      ownership: { default: 3 },
      _stats: { systemId: "dnd5e" }
    }
  });
  const { fixture, service, groupActor } = createLegacyMergeFixture({
    legacyItems: [legacyItem]
  });

  try {
    const result = await service.mergeLegacyInventoryIntoGroup(groupActor.id);
    const created = groupActor.items.contents[0].toObject();

    assert.equal(result.createdItems, 1);
    assert.equal(created.name, "New Relic");
    assert.equal(created.system.quantity, 9);
    assert.equal(created._id, "created-1");
    assert.equal(created.folder, undefined);
    assert.equal(created.sort, undefined);
    assert.equal(created.ownership, undefined);
    assert.equal(created._stats, undefined);
  }
  finally {
    fixture.restore();
  }
});

test("mergeLegacyInventoryIntoGroup is idempotent for the same group and legacy actor pair", async () => {
  const legacyItem = createItem({ id: "legacy-item", name: "Torch", type: "loot", quantity: 3 });
  const { fixture, service, groupActor } = createLegacyMergeFixture({
    legacyItems: [legacyItem]
  });

  try {
    const firstResult = await service.mergeLegacyInventoryIntoGroup(groupActor.id);
    const secondResult = await service.mergeLegacyInventoryIntoGroup(groupActor.id);

    assert.equal(firstResult.noop, false);
    assert.equal(secondResult.noop, true);
    assert.deepEqual(groupActor.system.currency, {
      pp: 6,
      gp: 8,
      ep: 0,
      sp: 10,
      cp: 12
    });
    assert.equal(groupActor.items.contents.length, 1);
    assert.equal(groupActor.items.contents[0].system.quantity, 3);
  }
  finally {
    fixture.restore();
  }
});

test("mergeLegacyInventoryIntoGroup rejects non-GM users", async () => {
  const { fixture, service, groupActor } = createLegacyMergeFixture({
    user: { id: "player-1", isGM: false }
  });

  try {
    await assert.rejects(
      () => service.mergeLegacyInventoryIntoGroup(groupActor.id),
      /only by a GM/u
    );
  }
  finally {
    fixture.restore();
  }
});

test("mergeLegacyInventoryIntoGroup no-ops when no legacy actor exists", async () => {
  const { fixture, service, groupActor } = createLegacyMergeFixture({
    legacyActor: null
  });
  fixture.state.inventoryActorId = "missing-legacy";

  try {
    const result = await service.mergeLegacyInventoryIntoGroup(groupActor.id);

    assert.equal(result.noop, true);
    assert.equal(result.legacyInventoryActorId, "missing-legacy");
    assert.deepEqual(groupActor.system.currency, {
      pp: 1,
      gp: 2,
      ep: 0,
      sp: 3,
      cp: 4
    });
    assert.equal(groupActor.items.contents.length, 0);
  }
  finally {
    fixture.restore();
  }
});

test("mergeLegacyInventoryIntoGroup does not double currency after partial failure", async () => {
  let setRegistryCalls = 0;
  const { fixture, service, groupActor } = createLegacyMergeFixture({
    onSetRegistry: async () => {
      setRegistryCalls += 1;
      if (setRegistryCalls === 1) {
        throw new Error("registry write failed after currency");
      }
    }
  });

  try {
    await assert.rejects(
      () => service.mergeLegacyInventoryIntoGroup(groupActor.id),
      /registry write failed after currency/u
    );
    assert.deepEqual(groupActor.system.currency, {
      pp: 6,
      gp: 8,
      ep: 0,
      sp: 10,
      cp: 12
    });

    const result = await service.mergeLegacyInventoryIntoGroup(groupActor.id);

    assert.equal(result.noop, false);
    assert.deepEqual(groupActor.system.currency, {
      pp: 6,
      gp: 8,
      ep: 0,
      sp: 10,
      cp: 12
    });
  }
  finally {
    fixture.restore();
  }
});

test("mergeLegacyInventoryIntoGroup does not double existing item quantity after partial failure", async () => {
  let setRegistryCalls = 0;
  const groupItem = createItem({ id: "group-torch", name: "Torch", type: "loot", quantity: 2 });
  const legacyItem = createItem({ id: "legacy-torch", name: "Torch", type: "loot", quantity: 3 });
  const { fixture, service, groupActor } = createLegacyMergeFixture({
    groupItems: [groupItem],
    legacyItems: [legacyItem],
    onSetRegistry: async () => {
      setRegistryCalls += 1;
      if (setRegistryCalls === 2) {
        throw new Error("registry write failed after item");
      }
    }
  });

  try {
    await assert.rejects(
      () => service.mergeLegacyInventoryIntoGroup(groupActor.id),
      /registry write failed after item/u
    );
    assert.equal(groupItem.system.quantity, 5);

    const result = await service.mergeLegacyInventoryIntoGroup(groupActor.id);

    assert.equal(result.noop, false);
    assert.equal(groupItem.system.quantity, 5);
    assert.equal(groupActor.items.contents.length, 1);
  }
  finally {
    fixture.restore();
  }
});

test("mergeLegacyInventoryIntoGroup applies only source quantity delta after partial marker", async () => {
  const groupItem = createItem({ id: "group-torch", name: "Torch", type: "loot", quantity: 10 });
  const firstLegacyItem = createItem({ id: "legacy-torch-a", name: "Torch", type: "loot", quantity: 2 });
  const secondLegacyItem = createItem({ id: "legacy-torch-b", name: " torch ", type: "loot", quantity: 3 });
  const { fixture, service, groupActor } = createLegacyMergeFixture({
    groupItems: [groupItem],
    legacyItems: [firstLegacyItem, secondLegacyItem],
    groupState: {
      version: 1,
      activeGroupActorId: "group-1",
      groupsById: {
        "group-1": {
          groupActorId: "group-1",
          migration: {
            legacyInventoryMergedAt: 0,
            legacyInventoryActorId: "",
            legacyInventoryMergePairs: {
              "legacy-party::group-1": {
                legacyInventoryActorId: "legacy-party",
                groupActorId: "group-1",
                currencyAppliedAt: 0,
                completedAt: 0,
                itemsByKey: {
                  "custom:torch:loot": {
                    quantityApplied: 2,
                    targetItemId: "group-torch",
                    created: false,
                    appliedAt: 100
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  try {
    const result = await service.mergeLegacyInventoryIntoGroup(groupActor.id);

    assert.equal(result.mergedItems, 1);
    assert.equal(groupItem.system.quantity, 13);
    assert.equal(fixture.groupState.groupsById["group-1"].migration.legacyInventoryMergePairs["legacy-party::group-1"].itemsByKey["custom:torch:loot"].quantityApplied, 5);
  }
  finally {
    fixture.restore();
  }
});

test("mergeLegacyInventoryIntoGroup does not duplicate created item after partial failure", async () => {
  let setRegistryCalls = 0;
  const legacyItem = createItem({ id: "legacy-lantern", name: "Lantern", type: "loot", quantity: 1 });
  const { fixture, service, groupActor } = createLegacyMergeFixture({
    legacyItems: [legacyItem],
    onSetRegistry: async () => {
      setRegistryCalls += 1;
      if (setRegistryCalls === 2) {
        throw new Error("registry write failed after create");
      }
    }
  });

  try {
    await assert.rejects(
      () => service.mergeLegacyInventoryIntoGroup(groupActor.id),
      /registry write failed after create/u
    );
    assert.equal(groupActor.items.contents.length, 1);

    const result = await service.mergeLegacyInventoryIntoGroup(groupActor.id);

    assert.equal(result.noop, false);
    assert.equal(groupActor.items.contents.length, 1);
    assert.equal(groupActor.items.contents[0].name, "Lantern");
    assert.equal(groupActor.items.contents[0].system.quantity, 1);
  }
  finally {
    fixture.restore();
  }
});

test("mergeLegacyInventoryIntoGroup no-ops when legacy actor flag has completed pair marker", async () => {
  const pairKey = "legacy-party::group-1";
  const legacyActor = createActor({
    id: "legacy-party",
    name: "Legacy",
    type: "npc",
    currency: {
      gp: 10
    },
    items: [createItem({ id: "legacy-item", name: "Torch", type: "loot", quantity: 3 })],
    flags: {
      [MODULE_ID]: {
        legacyInventoryMergedIntoGroup: {
          pairs: {
            [pairKey]: {
              groupActorId: "group-1",
              completedAt: 123
            }
          }
        }
      }
    }
  });
  const { fixture, service, groupActor } = createLegacyMergeFixture({
    legacyActor
  });

  try {
    const result = await service.mergeLegacyInventoryIntoGroup(groupActor.id);

    assert.equal(result.noop, true);
    assert.deepEqual(groupActor.system.currency, {
      pp: 1,
      gp: 2,
      ep: 0,
      sp: 3,
      cp: 4
    });
    assert.equal(groupActor.items.contents.length, 0);
  }
  finally {
    fixture.restore();
  }
});

test("mergeLegacyInventoryIntoGroup rejects unmanaged group before mutating", async () => {
  const { fixture, service, groupActor } = createLegacyMergeFixture({
    groupManaged: false,
    legacyItems: [createItem({ id: "legacy-item", name: "Torch", type: "loot", quantity: 3 })]
  });

  try {
    await assert.rejects(
      () => service.mergeLegacyInventoryIntoGroup(groupActor.id),
      /registered as a Rebreya party group/u
    );
    assert.deepEqual(groupActor.system.currency, {
      pp: 1,
      gp: 2,
      ep: 0,
      sp: 3,
      cp: 4
    });
    assert.equal(groupActor.items.contents.length, 0);
  }
  finally {
    fixture.restore();
  }
});

test("getInventoryActor does not create legacy actor when group context resolves", async () => {
  const groupActor = createActor({ id: "group-1", name: "Party", type: "group", isOwner: true });
  const fixture = installInventoryFixture({ actors: [groupActor] });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({ groupActor })
    }
  });

  try {
    const actor = await service.getInventoryActor({ create: true });

    assert.equal(actor, groupActor);
    assert.equal(fixture.actorCreateCalls, 0);
  }
  finally {
    fixture.restore();
  }
});

test("getInventoryActor preserves legacy actor creation without group context service", async () => {
  const fixture = installInventoryFixture();
  const service = new InventoryService({});

  try {
    const actor = await service.getInventoryActor({ create: true });

    assert.equal(actor, fixture.createdActor);
    assert.equal(actor.name, "Инвентарь группы Rebreya");
    assert.equal(actor.type, "npc");
    assert.equal(fixture.state.inventoryActorId, "legacy-party");

    const foundActor = await service.getInventoryActor({ create: true });
    assert.equal(foundActor, actor);
    assert.equal(fixture.actorCreateCalls, 1);
  }
  finally {
    fixture.restore();
  }
});

test("canManagePartyInventory allows GMs and resolved group actor owners only", () => {
  const groupActor = createActor({ id: "group-1", name: "Party", type: "group", isOwner: true });
  const fixture = installInventoryFixture({
    actors: [groupActor],
    user: { id: "player-1", isGM: false }
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({ groupActor })
    }
  });

  try {
    assert.equal(service.canManagePartyInventory(), true);

    groupActor.isOwner = false;
    assert.equal(service.canManagePartyInventory(), false);

    game.user = { id: "gm", isGM: true };
    assert.equal(service.canManagePartyInventory(), true);
  }
  finally {
    fixture.restore();
  }
});

test("canDropInventoryItems allows owners of native group members without full inventory management", () => {
  const memberActor = createActor({ id: "member-1", name: "Hero", type: "character", isOwner: true });
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: false,
    flags: { [MODULE_ID]: { managedPartyGroup: true } },
    members: [{ actor: memberActor }]
  });
  groupActor.uuid = "Actor.group-1";
  const fixture = installInventoryFixture({
    actors: [groupActor, memberActor],
    user: { id: "player-1", isGM: false }
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({
        groupActor,
        members: [memberActor],
        canManage: true
      }),
      resolveForGroup: () => ({
        groupActor,
        members: [memberActor],
        canManage: true
      })
    }
  });

  try {
    assert.equal(service.canManagePartyInventory(), false);
    assert.equal(service.canDropInventoryItems(), true);
  }
  finally {
    fixture.restore();
  }
});

test("takeInventoryItemToCharacter moves one party inventory item to a character", async () => {
  const inventoryItem = createItem({
    id: "item-a",
    name: "Silver Mirror",
    quantity: 2,
    extra: {
      system: {
        quantity: 2,
        price: {
          value: 2,
          denomination: "gp"
        },
        weight: {
          value: 1
        }
      }
    }
  });
  const groupActor = createActor({
    id: "group-a",
    name: "Party",
    type: "group",
    isOwner: true,
    items: [inventoryItem]
  });
  const heroActor = createActor({
    id: "hero-a",
    name: "Hero",
    type: "character",
    isOwner: true
  });
  const fixture = installInventoryFixture({
    actors: [groupActor, heroActor]
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({ groupActor })
    }
  });

  try {
    const result = await service.takeInventoryItemToCharacter("item-a", {
      actorId: "hero-a"
    });

    assert.equal(result.itemName, "Silver Mirror");
    assert.equal(inventoryItem.system.quantity, 1);
    assert.equal(heroActor.items.contents.length, 1);
    assert.equal(heroActor.items.contents[0].name, "Silver Mirror");
    assert.equal(heroActor.items.contents[0].system.quantity, 1);
  }
  finally {
    fixture.restore();
  }
});

test("sellInventoryItem sells a nonmagical item for half price into party currency", async () => {
  const inventoryItem = createItem({
    id: "item-a",
    name: "Silver Mirror",
    quantity: 2,
    flags: {
      [MODULE_ID]: {
        sourceType: "gear"
      }
    },
    extra: {
      system: {
        quantity: 2,
        price: {
          value: 2,
          denomination: "gp"
        },
        weight: {
          value: 1
        }
      }
    }
  });
  const groupActor = createActor({
    id: "group-a",
    name: "Party",
    type: "group",
    isOwner: true,
    currency: {
      gp: 1
    },
    items: [inventoryItem]
  });
  const fixture = installInventoryFixture({
    actors: [groupActor]
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({ groupActor })
    }
  });

  try {
    const result = await service.sellInventoryItem("item-a", 2);

    assert.equal(result.itemName, "Silver Mirror");
    assert.equal(result.quantity, 2);
    assert.equal(result.gainedCopper, 200);
    assert.equal(groupActor.items.contents.includes(inventoryItem), false);
    assert.deepEqual(groupActor.system.currency, {
      pp: 0,
      gp: 3,
      ep: 0,
      sp: 0,
      cp: 0
    });
  }
  finally {
    fixture.restore();
  }
});

test("sellInventoryItem rejects magical items", async () => {
  const inventoryItem = createItem({
    id: "item-a",
    name: "Arcane Mirror",
    quantity: 1,
    flags: {
      [MODULE_ID]: {
        sourceType: "magicItem",
        magical: true
      }
    },
    extra: {
      system: {
        quantity: 1,
        price: {
          value: 10,
          denomination: "gp"
        },
        weight: {
          value: 1
        }
      }
    }
  });
  const groupActor = createActor({
    id: "group-a",
    name: "Party",
    type: "group",
    isOwner: true,
    items: [inventoryItem]
  });
  const fixture = installInventoryFixture({
    actors: [groupActor]
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({ groupActor })
    }
  });

  try {
    await assert.rejects(
      () => service.sellInventoryItem("item-a", 1),
      /[Мм]агичес/u
    );
  }
  finally {
    fixture.restore();
  }
});

test("getPartySnapshot counts carried character inventory weight against party cargo", async () => {
  const groupItem = createItem({ id: "group-rope", name: "Rope", quantity: 2, weight: 5 });
  const memberItem = createItem({ id: "member-pack", name: "Pack", quantity: 3, weight: 4 });
  const memberActor = createActor({
    id: "member-1",
    name: "Hero",
    type: "character",
    isOwner: true,
    currency: { pp: 2, gp: 3, sp: 4, cp: 5 },
    abilities: { str: { value: 10 } },
    items: [memberItem]
  });
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: true,
    flags: { [MODULE_ID]: { managedPartyGroup: true } },
    members: [{ actor: memberActor }],
    items: [groupItem]
  });
  const fixture = installInventoryFixture({
    actors: [groupActor, memberActor]
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({
        groupActor,
        members: [memberActor],
        canManage: true
      })
    },
    async getModel() {
      return {
        materials: [],
        materialById: new Map(),
        materialByGoodId: new Map(),
        gear: [],
        gearById: new Map()
      };
    }
  });

  try {
    const snapshot = await service.getPartySnapshot();

    assert.equal(snapshot.partyInventoryWeight, 10);
    assert.equal(snapshot.memberInventoryWeight, 12);
    assert.equal(snapshot.inventoryWeight, 22);
    assert.equal(snapshot.freeCapacityLb, 128);
    assert.equal(snapshot.members[0].inventoryWeight, 12);
    assert.equal(snapshot.members[0].currencyGp, 23.45);
  }
  finally {
    fixture.restore();
  }
});

test("player inventory Item imports use the exact typed GM payload with a folder target", async () => {
  const previousItem = globalThis.Item;
  const previousFromUuid = globalThis.fromUuid;
  const memberActor = createActor({ id: "member-1", name: "Hero", type: "character", isOwner: true });
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: false,
    flags: { [MODULE_ID]: { managedPartyGroup: true } },
    members: [{ actor: memberActor }]
  });
  groupActor.uuid = "Actor.group-1";
  const sourceItem = createItem({ id: "source-item", name: "Torch", quantity: 2 });
  sourceItem.uuid = "Actor.member-1.Item.source-item";
  sourceItem.parent = memberActor;
  memberActor.items.contents.push(sourceItem);
  const requests = [];
  const fixture = installInventoryFixture({
    actors: [groupActor, memberActor],
    user: { id: "player-1", isGM: false }
  });
  globalThis.Item = Object;
  globalThis.fromUuid = async (uuid) => (uuid === sourceItem.uuid ? sourceItem : null);
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({
        groupActor,
        members: [memberActor],
        canManage: true
      }),
      resolveForGroup: (groupActorId) => groupActorId === groupActor.id
        ? { groupActor, members: [memberActor], canManage: true }
        : null
    },
    socketCommandBus: {
      async request(command, payload) {
        requests.push({ command, payload: clone(payload) });
        return groupActor;
      }
    }
  });

  try {
    const result = await service.importDroppedItem(
      { uuid: sourceItem.uuid, mutationId: "typed-folder-import" },
      { groupActorId: groupActor.id, folderId: "folder-new" }
    );

    assert.equal(result, groupActor);
    assert.deepEqual(groupActor.items.contents, []);
    assert.equal(memberActor.items.contents.includes(sourceItem), true);
    assert.deepEqual(requests, [{
      command: "inventory.import",
      payload: {
        inventoryActorId: groupActor.id,
        itemUuid: sourceItem.uuid,
        mutationId: "typed-folder-import",
        folderId: "folder-new"
      }
    }]);
  }
  finally {
    fixture.restore();
    globalThis.Item = previousItem;
    globalThis.fromUuid = previousFromUuid;
  }
});

test("lootgen chat item data drops into party inventory through the loot claim API", async () => {
  const memberActor = createActor({ id: "member-1", name: "Hero", type: "character", isOwner: true });
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: false,
    flags: { [MODULE_ID]: { managedPartyGroup: true } },
    members: [{ actor: memberActor }]
  });
  const claims = [];
  const fixture = installInventoryFixture({
    actors: [groupActor, memberActor],
    user: { id: "player-1", isGM: false }
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({
        groupActor,
        members: [memberActor],
        canManage: true
      })
    },
    claimLootgenChatRowToInventory: async (lootId, rowId) => {
      claims.push({ lootId, rowId });
      return true;
    }
  });

  try {
    const result = await service.importDroppedItem({
      type: "Item",
      data: {
        name: "Test Relic",
        type: "loot",
        flags: {
          [MODULE_ID]: {
            lootgenChat: {
              lootId: "loot-1",
              rowId: "row-1"
            }
          }
        }
      }
    });

    assert.equal(result, true);
    assert.deepEqual(claims, [{ lootId: "loot-1", rowId: "row-1" }]);
    assert.deepEqual(groupActor.items.contents, []);
  }
  finally {
    fixture.restore();
  }
});

test("player party currency edits and conversions route through the GM command bus", async () => {
  const memberActor = createActor({ id: "member-1", name: "Hero", type: "character", isOwner: true });
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: false,
    flags: { [MODULE_ID]: { managedPartyGroup: true } },
    members: [{ actor: memberActor }]
  });
  const requests = [];
  const fixture = installInventoryFixture({
    actors: [groupActor, memberActor],
    user: { id: "player-1", isGM: false }
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({
        groupActor,
        members: [memberActor],
        canManage: true
      })
    },
    socketCommandBus: {
      request: async (command, payload) => {
        requests.push({ command, payload });
        return { requested: true, command, payload };
      }
    }
  });

  try {
    const updateResult = await service.updateCurrency({ pp: 1, gp: 319, sp: 0, cp: 2 });
    const convertResult = await service.convertCurrency("gp");

    assert.equal(updateResult.requested, true);
    assert.equal(convertResult.requested, true);
    assert.deepEqual(requests, [
      {
        command: INVENTORY_CURRENCY_UPDATE_COMMAND,
        payload: {
          inventoryActorId: "group-1",
          values: { pp: 1, gp: 319, sp: 0, cp: 2 }
        }
      },
      {
        command: INVENTORY_CURRENCY_CONVERT_COMMAND,
        payload: {
          inventoryActorId: "group-1",
          mode: "gp"
        }
      }
    ]);
  }
  finally {
    fixture.restore();
  }
});

test("active GM executes party currency socket mutations on the managed group actor", async () => {
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: true,
    currency: { pp: 2, gp: 5, sp: 11, cp: 9 },
    flags: { [MODULE_ID]: { managedPartyGroup: true } }
  });
  const fixture = installInventoryFixture({
    actors: [groupActor],
    user: { id: "gm", isGM: true, active: true }
  });
  const service = new InventoryService({});

  try {
    const updated = await service.executeCurrencyUpdateMutation({
      inventoryActorId: "group-1",
      values: { pp: 0, gp: 12, sp: 3, cp: 4 }
    });
    const converted = await service.executeCurrencyConvertMutation({
      inventoryActorId: "group-1",
      mode: "gp"
    });

    assert.deepEqual(
      { pp: updated.pp, gp: updated.gp, sp: updated.sp, cp: updated.cp, totalCopper: updated.totalCopper },
      { pp: 0, gp: 12, sp: 3, cp: 4, totalCopper: 1234 }
    );
    assert.deepEqual(
      { pp: converted.pp, gp: converted.gp, sp: converted.sp, cp: converted.cp, totalCopper: converted.totalCopper },
      { pp: 0, gp: 12, sp: 3, cp: 4, totalCopper: 1234 }
    );
    assert.equal(groupActor.system.currency.gp, 12);
  }
  finally {
    fixture.restore();
  }
});

test("accepted party inventory item deletes the source item when the user manages the group inventory", async () => {
  const previousItem = globalThis.Item;
  const previousFromUuid = globalThis.fromUuid;
  const sourceItem = createItem({ id: "source-item", name: "Torch", quantity: 2 });
  sourceItem.uuid = "Actor.group-1.Item.source-item";
  const acceptedItem = createItem({ id: "accepted-item", name: "Torch", quantity: 2 });
  acceptedItem.uuid = "Actor.member-1.Item.accepted-item";
  const memberActor = createActor({
    id: "member-1",
    name: "Hero",
    type: "character",
    isOwner: true,
    items: [acceptedItem]
  });
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: true,
    flags: { [MODULE_ID]: { managedPartyGroup: true } },
    members: [{ actor: memberActor }],
    items: [sourceItem]
  });
  const fixture = installInventoryFixture({
    actors: [groupActor, memberActor],
    user: { id: "gm", isGM: true, active: true }
  });
  globalThis.game.users = {
    activeGM: globalThis.game.user,
    get: (userId) => userId === globalThis.game.user.id ? globalThis.game.user : null
  };
  globalThis.Item = Object;
  globalThis.fromUuid = async (uuid) => {
    if (uuid === sourceItem.uuid) {
      return groupActor.items.contents.includes(sourceItem) ? sourceItem : null;
    }
    return uuid === acceptedItem.uuid ? acceptedItem : null;
  };
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({
        groupActor,
        members: [memberActor],
        canManage: true
      })
    }
  });

  try {
    const expectedIdentity = captureInventoryTransferIdentity(sourceItem);
    const result = await service.handleAcceptedPartyInventoryItem(acceptedItem, {
      sourceItemUuid: sourceItem.uuid,
      transferId: "party-transfer:gm-direct",
      targetItemUuid: acceptedItem.uuid,
      expectedIdentity,
      expectedQuantity: 2,
      targetReceipt: {
        targetItemUuid: acceptedItem.uuid,
        created: true,
        beforeQuantity: 0,
        afterQuantity: 2,
        delta: 2
      }
    });

    assert.equal(result.handled, true);
    assert.equal(result.requested, false);
    assert.equal(groupActor.items.contents.includes(sourceItem), false);
    assert.equal(memberActor.items.contents.includes(acceptedItem), true);
  }
  finally {
    fixture.restore();
    globalThis.Item = previousItem;
    globalThis.fromUuid = previousFromUuid;
  }
});

test("accepted party inventory item routes source deletion through the GM when the group is unowned", async () => {
  const previousItem = globalThis.Item;
  const previousFromUuid = globalThis.fromUuid;
  const sourceItem = createItem({ id: "source-item", name: "Torch", quantity: 2 });
  sourceItem.uuid = "Actor.group-1.Item.source-item";
  const acceptedItem = createItem({ id: "accepted-item", name: "Torch", quantity: 2 });
  acceptedItem.uuid = "Actor.member-1.Item.accepted-item";
  const memberActor = createActor({
    id: "member-1",
    name: "Hero",
    type: "character",
    isOwner: true,
    items: [acceptedItem]
  });
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: false,
    flags: { [MODULE_ID]: { managedPartyGroup: true } },
    members: [{ actor: memberActor }],
    items: [sourceItem]
  });
  const emitted = [];
  const fixture = installInventoryFixture({
    actors: [groupActor, memberActor],
    user: { id: "player-1", isGM: false }
  });
  globalThis.game.users = {
    activeGM: { id: "gm", isGM: true, active: true }
  };
  globalThis.Item = Object;
  globalThis.fromUuid = async (uuid) => ({
    [sourceItem.uuid]: sourceItem,
    [acceptedItem.uuid]: acceptedItem
  })[uuid] ?? null;
  globalThis.game.socket = {
    emit(channel, message) {
      emitted.push({ channel, message });
    }
  };
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({
        groupActor,
        members: [memberActor],
        canManage: true
      })
    }
  });

  try {
    const expectedIdentity = captureInventoryTransferIdentity(sourceItem);
    const targetReceipt = {
      targetItemUuid: acceptedItem.uuid,
      created: true,
      beforeQuantity: 0,
      afterQuantity: 2,
      delta: 2
    };
    const result = await service.handleAcceptedPartyInventoryItem(acceptedItem, {
      sourceItemUuid: sourceItem.uuid,
      transferId: "party-transfer:player-request",
      targetItemUuid: acceptedItem.uuid,
      expectedIdentity,
      expectedQuantity: 2,
      targetReceipt
    });

    assert.equal(result.handled, true);
    assert.equal(result.requested, true);
    assert.equal(groupActor.items.contents.includes(sourceItem), true);
    assert.deepEqual(emitted, [{
      channel: "module.rebreya-main",
      message: {
        type: "inventory-source-depletion-request",
        payload: {
          transferId: "party-transfer:player-request",
          sourceItemUuid: sourceItem.uuid,
          targetItemUuid: acceptedItem.uuid,
          targetActorUuid: memberActor.uuid,
          expectedIdentity,
          expectedQuantity: 2,
          targetReceipt
        },
        senderId: "player-1"
      }
    }]);
  }
  finally {
    fixture.restore();
    globalThis.Item = previousItem;
    globalThis.fromUuid = previousFromUuid;
  }
});

test("active GM applies a validated player inventory import socket request", async () => {
  const previousItem = globalThis.Item;
  const previousFromUuid = globalThis.fromUuid;
  const memberActor = createActor({ id: "member-1", name: "Hero", type: "character", isOwner: false });
  memberActor.ownership = { player: 3 };
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: true,
    flags: { [MODULE_ID]: { managedPartyGroup: true } },
    members: [{ actor: memberActor }]
  });
  groupActor.uuid = "Actor.group-1";
  const sourceItem = createItem({ id: "source-item", name: "Torch", quantity: 2 });
  sourceItem.uuid = "Actor.member-1.Item.source-item";
  sourceItem.parent = memberActor;
  memberActor.items.contents.push(sourceItem);
  const fixture = installInventoryFixture({
    actors: [groupActor, memberActor],
    user: { id: "gm", isGM: true, active: true }
  });
  const gmUser = game.user;
  const playerUser = { id: "player", isGM: false, active: true };
  globalThis.game.users = {
    activeGM: gmUser,
    get: (id) => ({ gm: gmUser, player: playerUser })[id] ?? null,
    contents: [gmUser, playerUser]
  };
  globalThis.Item = Object;
  globalThis.fromUuid = async (uuid) => ({
    [sourceItem.uuid]: sourceItem,
    [groupActor.uuid]: groupActor
  })[uuid] ?? null;
  const service = new InventoryService({
    groupContextService: {
      resolveForGroup: () => ({
        groupActor,
        members: [memberActor],
        canManage: true
      })
    },
    async getModel() {
      return {};
    }
  });

  try {
    const result = await service.handleImportDroppedItemSocketRequest({
      itemUuid: sourceItem.uuid,
      targetActorUuid: groupActor.uuid
    }, {
      senderId: "player"
    });

    assert.equal(result, groupActor);
    assert.equal(groupActor.items.contents.length, 1);
    assert.equal(groupActor.items.contents[0].name, "Torch");
    assert.equal(groupActor.items.contents[0].system.quantity, 2);
    assert.equal(memberActor.items.contents.includes(sourceItem), false);
  }
  finally {
    fixture.restore();
    globalThis.Item = previousItem;
    globalThis.fromUuid = previousFromUuid;
  }
});

test("GM rejects inventory import requests from actors outside the target group", async () => {
  const previousItem = globalThis.Item;
  const previousFromUuid = globalThis.fromUuid;
  const groupMember = createActor({ id: "member-1", name: "Party Hero", type: "character" });
  const outsiderActor = createActor({ id: "outsider-1", name: "Outsider", type: "character" });
  outsiderActor.ownership = { player: 3 };
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: true,
    flags: { [MODULE_ID]: { managedPartyGroup: true } },
    members: [{ actor: groupMember }]
  });
  groupActor.uuid = "Actor.group-1";
  const sourceItem = createItem({ id: "source-item", name: "Torch", quantity: 2 });
  sourceItem.uuid = "Actor.outsider-1.Item.source-item";
  sourceItem.parent = outsiderActor;
  outsiderActor.items.contents.push(sourceItem);
  const fixture = installInventoryFixture({
    actors: [groupActor, groupMember, outsiderActor],
    user: { id: "gm", isGM: true, active: true }
  });
  const gmUser = game.user;
  const playerUser = { id: "player", isGM: false, active: true };
  globalThis.game.users = {
    activeGM: gmUser,
    get: (id) => ({ gm: gmUser, player: playerUser })[id] ?? null,
    contents: [gmUser, playerUser]
  };
  globalThis.Item = Object;
  globalThis.fromUuid = async (uuid) => ({
    [sourceItem.uuid]: sourceItem,
    [groupActor.uuid]: groupActor
  })[uuid] ?? null;
  const service = new InventoryService({
    groupContextService: {
      resolveForGroup: () => ({
        groupActor,
        members: [groupMember],
        canManage: true
      })
    }
  });

  try {
    await assert.rejects(
      service.handleImportDroppedItemSocketRequest({
        itemUuid: sourceItem.uuid,
        targetActorUuid: groupActor.uuid
      }, {
        senderId: "player"
      }),
      /не входит в эту группу/u
    );
    assert.equal(groupActor.items.contents.length, 0);
    assert.equal(outsiderActor.items.contents.includes(sourceItem), true);
  }
  finally {
    fixture.restore();
    globalThis.Item = previousItem;
    globalThis.fromUuid = previousFromUuid;
  }
});

test("getInventoryActor falls back to legacy actor creation for known no-group context errors", async () => {
  const fixture = installInventoryFixture();
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => {
        throw new Error(GROUP_CONTEXT_ERRORS.GM_NO_ACTIVE_GROUP);
      }
    }
  });

  try {
    const actor = await service.getInventoryActor({ create: true });

    assert.equal(actor, fixture.createdActor);
    assert.equal(actor.name, "Инвентарь группы Rebreya");
    assert.equal(fixture.actorCreateCalls, 1);
  }
  finally {
    fixture.restore();
  }
});

test("getInventorySnapshot with createActor false reports player no-group context without legacy actor", async () => {
  const fixture = installInventoryFixture({
    user: { id: "player-1", isGM: false }
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => {
        throw new Error(GROUP_CONTEXT_ERRORS.PLAYER_NO_GROUP);
      }
    }
  });

  try {
    const snapshot = await service.getInventorySnapshot({ createActor: false });

    assert.equal(snapshot.groupContextError, GROUP_CONTEXT_ERRORS.PLAYER_NO_GROUP);
    assert.equal(snapshot.hasActor, false);
    assert.equal(fixture.actorCreateCalls, 0);
  }
  finally {
    fixture.restore();
  }
});

test("getInventoryActor rethrows unexpected group resolver errors without creating legacy actor", async () => {
  const fixture = installInventoryFixture();
  const unexpectedError = new Error("resolver crashed");
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => {
        throw unexpectedError;
      }
    }
  });

  try {
    await assert.rejects(
      () => service.getInventoryActor({ create: true }),
      (error) => error === unexpectedError
    );
    assert.equal(fixture.actorCreateCalls, 0);
  }
  finally {
    fixture.restore();
  }
});

test("getInventorySnapshot rethrows unexpected group resolver errors", async () => {
  const fixture = installInventoryFixture();
  const unexpectedError = new Error("resolver crashed");
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => {
        throw unexpectedError;
      }
    }
  });

  try {
    await assert.rejects(
      () => service.getInventorySnapshot({ createActor: false }),
      (error) => error === unexpectedError
    );
    assert.equal(fixture.actorCreateCalls, 0);
  }
  finally {
    fixture.restore();
  }
});

test("addSupply rejects when resolved group actor is not owned by a non-GM user", async () => {
  const groupActor = createActor({ id: "group-1", name: "Party", type: "group", isOwner: false });
  const fixture = installInventoryFixture({
    actors: [groupActor],
    user: { id: "player-1", isGM: false }
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({ groupActor })
    }
  });

  try {
    await assert.rejects(
      () => service.addSupply("food", 1),
      /Партийным инвентарём управляют владельцы склада\./u
    );
  }
  finally {
    fixture.restore();
  }
});

test("addSupply accepts negative supply deltas and clamps the final stock at zero", async () => {
  const water = createItem({
    id: "water",
    name: "Water",
    quantity: 20,
    weight: 8,
    flags: { [MODULE_ID]: { resourceKey: "water" } }
  });
  const food = createItem({
    id: "food",
    name: "Food",
    quantity: 4,
    weight: 1,
    flags: { [MODULE_ID]: { resourceKey: "food" } }
  });
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: true,
    items: [water, food]
  });
  const fixture = installInventoryFixture({
    actors: [groupActor]
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({ groupActor })
    }
  });

  try {
    await service.addSupply("water", -10);
    await service.addSupply("food", -40);

    assert.equal(water.system.quantity, 10);
    assert.equal(food.system.quantity, 0);
  }
  finally {
    fixture.restore();
  }
});

test("getPartySnapshot uses native group system.members and ignores stale partyState members", async () => {
  const memberActor = createActor({
    id: "member-a",
    name: "Native Member",
    type: "character",
    abilities: {
      str: { value: 12 },
      con: { mod: 1 }
    }
  });
  const defaultStateMemberActor = createActor({
    id: "member-b",
    name: "Default State Native Member",
    type: "character",
    abilities: {
      str: { value: 8 },
      con: { mod: 0 }
    }
  });
  const staleActor = createActor({ id: "stale-member", name: "Stale Member", type: "character" });
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: true,
    members: [{ actor: memberActor }, { actor: defaultStateMemberActor }]
  });
  const fixture = installInventoryFixture({
    actors: [groupActor, memberActor, defaultStateMemberActor, staleActor],
    partyState: {
      members: {
        "member-a": {
          foodPerDay: 2,
          waterGalPerDay: 3,
          conModOverride: 2
        },
        "stale-member": {
          foodPerDay: 99,
          waterGalPerDay: 99
        }
      }
    }
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({ groupActor })
    },
    getModel: async () => ({
      materials: [],
      materialById: new Map(),
      materialByGoodId: new Map(),
      gear: [],
      gearById: new Map()
    })
  });

  try {
    const snapshot = await service.getPartySnapshot({ actor: groupActor });
    const defaultStateMember = snapshot.members.find((member) => member.actorId === "member-b");

    assert.deepEqual(snapshot.members.map((member) => member.actorId), ["member-b", "member-a"]);
    assert.equal(defaultStateMember.role, "member");
    assert.equal(defaultStateMember.foodPerDay, 1);
    assert.equal(defaultStateMember.waterGalPerDay, 1);
    assert.equal(defaultStateMember.strength, 8);
    assert.equal(snapshot.totalFoodPerDay, 3);
    assert.equal(snapshot.totalWaterGalPerDay, 4);
    assert.equal(snapshot.totalEnergyMax, 8);
    assert.equal(snapshot.availableActors.length, 0);
    assert.equal(snapshot.membershipManagedByNativeGroup, true);
  }
  finally {
    fixture.restore();
  }
});

test("native group member edits persist in scoped group state", async () => {
  const memberActor = createActor({
    id: "vehicle-a",
    name: "Групповой транспорт",
    type: "vehicle",
    isOwner: true
  });
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: true,
    members: [{ actor: memberActor }]
  });
  const groupState = {
    memberStateByActorId: {
      "vehicle-a": {
        role: "transport"
      }
    }
  };
  const fixture = installInventoryFixture({
    actors: [groupActor, memberActor],
    partyState: {
      members: {
        "vehicle-a": {
          role: "member",
          capBonusLb: 10
        }
      }
    }
  });
  const context = {
    groupActor,
    groupId: groupActor.id,
    groupState,
    members: [memberActor],
    canManage: true
  };
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => context,
      async mutateGroupState(groupActorId, mutator) {
        assert.equal(groupActorId, groupActor.id);
        return mutator(groupState);
      }
    }
  });

  try {
    await service.updatePartyMember("vehicle-a", {
      capBonusLb: 333,
      foodPerDay: 0
    });
    await service.updatePartyMemberTool("vehicle-a", "smith", {
      owned: true,
      prof: 1
    });
    await service.setMemberEnergy("vehicle-a", 2);

    assert.equal(groupState.memberStateByActorId["vehicle-a"].role, "transport");
    assert.equal(groupState.memberStateByActorId["vehicle-a"].capBonusLb, 333);
    assert.equal(groupState.memberStateByActorId["vehicle-a"].foodPerDay, 0);
    assert.equal(groupState.memberStateByActorId["vehicle-a"].tools.smith.owned, true);
    assert.equal(groupState.memberStateByActorId["vehicle-a"].energyCurrent, 2);
    assert.equal(fixture.state.members["vehicle-a"].role, "member");
    assert.equal(fixture.state.members["vehicle-a"].capBonusLb, 10);
  }
  finally {
    fixture.restore();
  }
});

test("addPartyMember and removePartyMember reject native group contexts without mutating partyState members", async () => {
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: true
  });
  const initialMembers = {
    "member-a": {
      foodPerDay: 2
    }
  };
  const fixture = installInventoryFixture({
    actors: [groupActor],
    partyState: {
      members: clone(initialMembers)
    }
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({ groupActor })
    }
  });

  try {
    await assert.rejects(
      () => service.addPartyMember("member-b"),
      /Состав группы управляется листом dnd5e группы/u
    );
    await assert.rejects(
      () => service.removePartyMember("member-a"),
      /Состав группы управляется листом dnd5e группы/u
    );
    assert.deepEqual(fixture.state.members, initialMembers);
  }
  finally {
    fixture.restore();
  }
});

test("consumeSuppliesOneDay applies energy only to native group system.members", async () => {
  const memberActor = createActor({
    id: "member-a",
    name: "Native Member",
    type: "character",
    abilities: {
      con: { mod: 0 }
    }
  });
  const staleActor = createActor({
    id: "stale-member",
    name: "Stale Member",
    type: "character"
  });
  const food = createItem({
    id: "food",
    name: "Food",
    quantity: 1,
    flags: {
      [MODULE_ID]: {
        resourceKey: "food"
      }
    }
  });
  const water = createItem({
    id: "water",
    name: "Water",
    quantity: 1,
    flags: {
      [MODULE_ID]: {
        resourceKey: "water"
      }
    }
  });
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: true,
    items: [food, water],
    members: [{ actor: memberActor }]
  });
  const fixture = installInventoryFixture({
    actors: [groupActor, memberActor, staleActor],
    partyState: {
      members: {
        "member-a": {
          foodPerDay: 2,
          waterGalPerDay: 2,
          energyCurrent: 3
        },
        "stale-member": {
          foodPerDay: 99,
          waterGalPerDay: 99,
          energyCurrent: 3
        }
      }
    }
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({ groupActor })
    },
    getModel: async () => ({
      materials: [],
      materialById: new Map(),
      materialByGoodId: new Map(),
      gear: [],
      gearById: new Map()
    })
  });

  try {
    const result = await service.consumeSuppliesOneDay();

    assert.deepEqual(result.energyUpdates.map((entry) => entry.actorId), ["member-a"]);
    assert.equal(result.memberCount, 1);
    assert.equal(result.foodRequired, 2);
    assert.equal(result.waterRequired, 2);
    assert.equal(fixture.state.members["member-a"].energyCurrent, 2);
    assert.equal(fixture.state.members["stale-member"].energyCurrent, 3);
  }
  finally {
    fixture.restore();
  }
});

test("party supply coverage makes food and water expenses zero without energy penalties", async () => {
  const memberActor = createActor({
    id: "member-a",
    name: "Druid-fed Member",
    type: "character",
    abilities: { con: { mod: 0 } }
  });
  const food = createItem({
    id: "food",
    name: "Food",
    quantity: 5,
    flags: { [MODULE_ID]: { resourceKey: "food" } }
  });
  const water = createItem({
    id: "water",
    name: "Water",
    quantity: 5,
    flags: { [MODULE_ID]: { resourceKey: "water" } }
  });
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: true,
    items: [food, water],
    members: [{ actor: memberActor }]
  });
  const fixture = installInventoryFixture({
    actors: [groupActor, memberActor],
    partyState: {
      coverFoodExpenses: true,
      coverWaterExpenses: true,
      members: {
        "member-a": { foodPerDay: 2, waterGalPerDay: 3, energyCurrent: 3 }
      }
    }
  });
  const service = new InventoryService({
    groupContextService: { resolveForCurrentUser: () => ({ groupActor }) },
    getModel: async () => ({
      materials: [],
      materialById: new Map(),
      materialByGoodId: new Map(),
      gear: [],
      gearById: new Map()
    })
  });

  try {
    const snapshot = await service.getPartySnapshot({ actor: groupActor });
    const result = await service.consumeSuppliesOneDay();

    assert.equal(snapshot.coverFoodExpenses, true);
    assert.equal(snapshot.coverWaterExpenses, true);
    assert.equal(snapshot.totalFoodPerDay, 0);
    assert.equal(snapshot.totalWaterGalPerDay, 0);
    assert.equal(result.foodSpent, 0);
    assert.equal(result.waterSpent, 0);
    assert.equal(result.foodShortage, 0);
    assert.equal(result.waterShortage, 0);
    assert.equal(result.energyUpdates[0].hungry, false);
    assert.equal(fixture.state.members["member-a"].energyCurrent, 3);
    assert.equal(food.system.quantity, 5);
    assert.equal(water.system.quantity, 5);
  }
  finally {
    fixture.restore();
  }
});

test("consumeSuppliesOneDay uses a lightweight party snapshot without loading the economy model", async () => {
  const memberActor = createActor({
    id: "member-a",
    name: "Hungry Member",
    type: "character",
    abilities: { con: { mod: 0 } }
  });
  const food = createItem({
    id: "food",
    name: "Food",
    quantity: 5,
    flags: { [MODULE_ID]: { resourceKey: "food" } }
  });
  const water = createItem({
    id: "water",
    name: "Water",
    quantity: 5,
    flags: { [MODULE_ID]: { resourceKey: "water" } }
  });
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: true,
    items: [food, water],
    members: [{ actor: memberActor }]
  });
  const fixture = installInventoryFixture({
    actors: [groupActor, memberActor],
    partyState: {
      members: {
        "member-a": { foodPerDay: 1, waterGalPerDay: 1, energyCurrent: 3 }
      }
    }
  });
  const service = new InventoryService({
    groupContextService: { resolveForCurrentUser: () => ({ groupActor }) },
    getModel: async () => {
      throw new Error("economy model should not be loaded for supply consumption");
    }
  });

  try {
    const result = await service.consumeSuppliesOneDay();

    assert.equal(result.foodSpent, 1);
    assert.equal(result.waterSpent, 1);
    assert.equal(food.system.quantity, 4);
    assert.equal(water.system.quantity, 4);
  }
  finally {
    fixture.restore();
  }
});

test("consumeSuppliesDays batches supply item and energy writes for calendar month shifts", async () => {
  const memberActor = createActor({
    id: "member-a",
    name: "Batch Member",
    type: "character",
    abilities: { con: { mod: 0 } }
  });
  const food = createItem({
    id: "food",
    name: "Food",
    quantity: 10,
    flags: { [MODULE_ID]: { resourceKey: "food" } }
  });
  const water = createItem({
    id: "water",
    name: "Water",
    quantity: 10,
    flags: { [MODULE_ID]: { resourceKey: "water" } }
  });
  let foodUpdates = 0;
  let waterUpdates = 0;
  food.update = async (patch) => {
    foodUpdates += 1;
    applyPatch(food, patch);
    return food;
  };
  water.update = async (patch) => {
    waterUpdates += 1;
    applyPatch(water, patch);
    return water;
  };
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: true,
    items: [food, water],
    members: [{ actor: memberActor }]
  });
  const fixture = installInventoryFixture({
    actors: [groupActor, memberActor],
    partyState: {
      members: {
        "member-a": { foodPerDay: 1, waterGalPerDay: 1, energyCurrent: 3 }
      }
    }
  });
  let stateWrites = 0;
  const originalSet = game.settings.set;
  game.settings.set = async (...args) => {
    stateWrites += 1;
    return originalSet(...args);
  };
  const service = new InventoryService({
    groupContextService: { resolveForCurrentUser: () => ({ groupActor }) },
    getModel: async () => {
      throw new Error("economy model should not be loaded for batched supply consumption");
    }
  });

  try {
    const result = await service.consumeSuppliesDays(3);

    assert.equal(result.days, 3);
    assert.equal(result.supplies.length, 3);
    assert.deepEqual(result.supplyTotals, {
      foodSpent: 3,
      waterSpent: 3,
      foodShortage: 0,
      waterShortage: 0
    });
    assert.equal(food.system.quantity, 7);
    assert.equal(water.system.quantity, 7);
    assert.equal(foodUpdates, 1);
    assert.equal(waterUpdates, 1);
    assert.equal(stateWrites, 1);
  }
  finally {
    fixture.restore();
  }
});

test("consumeSuppliesDays skips supply item writes when coverage prevents spending", async () => {
  const memberActor = createActor({
    id: "member-a",
    name: "Covered Member",
    type: "character",
    abilities: { con: { mod: 0 } }
  });
  const food = createItem({
    id: "food",
    name: "Food",
    quantity: 10,
    flags: { [MODULE_ID]: { resourceKey: "food" } }
  });
  const water = createItem({
    id: "water",
    name: "Water",
    quantity: 10,
    flags: { [MODULE_ID]: { resourceKey: "water" } }
  });
  let supplyWrites = 0;
  food.update = async (patch) => {
    supplyWrites += 1;
    applyPatch(food, patch);
    return food;
  };
  water.update = async (patch) => {
    supplyWrites += 1;
    applyPatch(water, patch);
    return water;
  };
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: true,
    items: [food, water],
    members: [{ actor: memberActor }]
  });
  const fixture = installInventoryFixture({
    actors: [groupActor, memberActor],
    partyState: {
      coverFoodExpenses: true,
      coverWaterExpenses: true,
      members: {
        "member-a": { foodPerDay: 5, waterGalPerDay: 5, energyCurrent: 3 }
      }
    }
  });
  const service = new InventoryService({
    groupContextService: { resolveForCurrentUser: () => ({ groupActor }) },
    getModel: async () => ({ materials: [], materialById: new Map(), materialByGoodId: new Map(), gear: [], gearById: new Map() })
  });

  try {
    const result = await service.consumeSuppliesDays(5);

    assert.equal(result.supplyTotals.foodSpent, 0);
    assert.equal(result.supplyTotals.waterSpent, 0);
    assert.equal(food.system.quantity, 10);
    assert.equal(water.system.quantity, 10);
    assert.equal(supplyWrites, 0);
  }
  finally {
    fixture.restore();
  }
});
