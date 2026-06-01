import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import { GROUP_CONTEXT_ERRORS } from "../scripts/data/group-context-service.js";
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
        value: 0
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
  const actor = {
    id,
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
    getFlag(moduleId, key) {
      return this.flags?.[moduleId]?.[key];
    },
    async setFlag(moduleId, key, value) {
      this.flags[moduleId] ??= {};
      this.flags[moduleId][key] = value;
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
  const staleActor = createActor({ id: "stale-member", name: "Stale Member", type: "character" });
  const groupActor = createActor({
    id: "group-1",
    name: "Party",
    type: "group",
    isOwner: true,
    members: [{ actor: memberActor }]
  });
  const fixture = installInventoryFixture({
    actors: [groupActor, memberActor, staleActor],
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

    assert.deepEqual(snapshot.members.map((member) => member.actorId), ["member-a"]);
    assert.equal(snapshot.totalFoodPerDay, 2);
    assert.equal(snapshot.totalWaterGalPerDay, 3);
    assert.equal(snapshot.totalEnergyMax, 5);
    assert.equal(snapshot.availableActors.length, 0);
    assert.equal(snapshot.membershipManagedByNativeGroup, true);
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
