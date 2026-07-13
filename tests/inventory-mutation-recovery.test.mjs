import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID, REBREYA_GROUP_FLAGS, SETTINGS_KEYS } from "../scripts/constants.js";

const previousActor = globalThis.Actor;
const previousItem = globalThis.Item;
globalThis.Actor = class TestActorDocument {};
globalThis.Item = class TestItemDocument {};

const { InventoryService } = await import(`../scripts/data/inventory-service.js?mutation-recovery=${Date.now()}`);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function setProperty(source, path, value) {
  const parts = String(path ?? "").split(".");
  let cursor = source;
  for (const [index, part] of parts.entries()) {
    if (index === parts.length - 1) {
      cursor[part] = value;
    }
    else {
      cursor[part] ??= {};
      cursor = cursor[part];
    }
  }
}

function applyPatch(source, patch) {
  for (const [path, value] of Object.entries(patch ?? {})) {
    setProperty(source, path, clone(value));
  }
}

function createItem({
  id,
  name = "Item",
  type = "loot",
  quantity = 1,
  price = { value: 0, denomination: "gp" },
  flags = {},
  failUpdate = false,
  failDelete = false
} = {}) {
  const item = new globalThis.Item();
  Object.assign(item, {
    id,
    _id: id,
    uuid: "",
    name,
    type,
    img: "icons/svg/item-bag.svg",
    flags: clone(flags),
    system: {
      quantity,
      price: clone(price),
      weight: { value: 1 }
    },
    toObject() {
      return clone({
        _id: this.id,
        name: this.name,
        type: this.type,
        img: this.img,
        flags: this.flags,
        system: this.system
      });
    },
    async update(patch) {
      if (failUpdate) throw new Error("source update failed");
      applyPatch(this, patch);
      return this;
    },
    async delete() {
      if (failDelete) throw new Error("source delete failed");
      const index = this.parent?.items?.contents?.indexOf(this) ?? -1;
      if (index >= 0) this.parent.items.contents.splice(index, 1);
      return this;
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  });
  return item;
}

function createActor({
  id,
  type = "character",
  isOwner = true,
  items = [],
  currency = {},
  managed = false,
  members = []
} = {}) {
  const actor = new globalThis.Actor();
  Object.assign(actor, {
    id,
    uuid: `Actor.${id}`,
    name: id,
    type,
    isOwner,
    flags: managed ? { [MODULE_ID]: { [REBREYA_GROUP_FLAGS.MANAGED]: true } } : {},
    system: {
      currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0, ...currency },
      abilities: { str: { value: 10 }, con: { mod: 0 } },
      members
    },
    items: {
      contents: items,
      get(itemId) {
        return this.contents.find((item) => item.id === itemId) ?? null;
      }
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async update(patch) {
      applyPatch(this, patch);
      return this;
    },
    async createEmbeddedDocuments(_documentName, documents) {
      const created = documents.map((document, index) => createItem({
        id: `created-${this.items.contents.length + index + 1}`,
        name: document.name,
        type: document.type,
        quantity: document.system?.quantity,
        price: document.system?.price,
        flags: document.flags
      }));
      for (const item of created) {
        item.parent = this;
        item.uuid = `${this.uuid}.Item.${item.id}`;
        this.items.contents.push(item);
      }
      return created;
    }
  });
  for (const item of actor.items.contents) {
    item.parent = actor;
    item.uuid = `${actor.uuid}.Item.${item.id}`;
  }
  return actor;
}

function installFixture({ group, actors, uuidDocuments }) {
  const previousFoundry = globalThis.foundry;
  const previousGame = globalThis.game;
  const previousFromUuid = globalThis.fromUuid;
  const settingsStore = {
    [SETTINGS_KEYS.PARTY_STATE]: {},
    [SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL]: {}
  };
  globalThis.foundry = {
    utils: {
      deepClone: clone,
      getProperty: (source, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], source),
      setProperty,
      mergeObject: (target, source) => ({ ...clone(target), ...clone(source) }),
      flattenObject: (source) => clone(source)
    }
  };
  globalThis.game = {
    user: { id: "gm", isGM: true, active: true },
    users: { activeGM: { id: "gm", isGM: true, active: true } },
    actors: {
      contents: actors,
      get: (actorId) => actors.find((actor) => actor.id === actorId) ?? null
    },
    settings: {
      get: (_moduleId, key) => clone(settingsStore[key]),
      async set(_moduleId, key, value) {
        settingsStore[key] = clone(value);
        return value;
      }
    }
  };
  globalThis.fromUuid = async (uuid) => uuidDocuments.get(uuid) ?? null;
  const moduleApi = {
    groupContextService: {
      resolveForCurrentUser: () => ({ groupActor: group, canManage: true }),
      resolveForGroup: () => ({ groupActor: group, canManage: true, members: group.system.members.map((row) => row.actor) })
    }
  };

  return {
    service: new InventoryService(moduleApi),
    restore() {
      globalThis.foundry = previousFoundry;
      globalThis.game = previousGame;
      globalThis.fromUuid = previousFromUuid;
    }
  };
}

test("take compensates a created target item when source depletion fails", async () => {
  const source = createItem({ id: "source", name: "Rope", quantity: 2, failUpdate: true });
  const hero = createActor({ id: "hero" });
  const group = createActor({
    id: "group",
    type: "group",
    managed: true,
    items: [source],
    members: [{ actor: hero }]
  });
  const fixture = installFixture({ group, actors: [group, hero], uuidDocuments: new Map() });

  try {
    await assert.rejects(
      fixture.service.takeInventoryItemToCharacter(source.id, {
        actorId: hero.id,
        quantity: 1,
        mutationId: "take-failure"
      }),
      /source update failed/u
    );
    assert.equal(hero.items.contents.length, 0);
    assert.equal(source.system.quantity, 2);
  }
  finally {
    fixture.restore();
  }
});

test("sale reverses credited currency when source depletion fails", async () => {
  const source = createItem({
    id: "sale-source",
    name: "Sword",
    quantity: 2,
    price: { value: 10, denomination: "gp" },
    failUpdate: true
  });
  const group = createActor({ id: "group", type: "group", managed: true, items: [source] });
  const fixture = installFixture({ group, actors: [group], uuidDocuments: new Map() });

  try {
    await assert.rejects(fixture.service.sellInventoryItem(source.id, 1, {
      mutationId: "sale-failure"
    }), /source update failed/u);
    assert.deepEqual(group.system.currency, { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 });
    assert.equal(source.system.quantity, 2);
  }
  finally {
    fixture.restore();
  }
});

test("import compensates the target item when deleting the source fails", async () => {
  const source = createItem({ id: "import-source", name: "Lantern", quantity: 1, failDelete: true });
  const hero = createActor({ id: "hero", items: [source] });
  const group = createActor({
    id: "group",
    type: "group",
    managed: true,
    members: [{ actor: hero }]
  });
  const uuidDocuments = new Map([[source.uuid, source]]);
  const fixture = installFixture({ group, actors: [group, hero], uuidDocuments });

  try {
    await assert.rejects(
      fixture.service.importDroppedItem({ uuid: source.uuid, mutationId: "import-failure" }),
      /source delete failed/u
    );
    assert.equal(group.items.contents.length, 0);
    assert.equal(hero.items.contents.includes(source), true);
  }
  finally {
    fixture.restore();
  }
});

test("repeating successful inventory mutation ids never applies an economic delta twice", async () => {
  const takeSource = createItem({ id: "take-source", name: "Rope", quantity: 2 });
  const saleSource = createItem({
    id: "sale-source",
    name: "Sword",
    quantity: 2,
    price: { value: 10, denomination: "gp" }
  });
  const importSource = createItem({ id: "import-source", name: "Lantern", quantity: 1 });
  const hero = createActor({ id: "hero", items: [importSource] });
  const group = createActor({
    id: "group",
    type: "group",
    managed: true,
    items: [takeSource, saleSource],
    members: [{ actor: hero }]
  });
  const uuidDocuments = new Map([[importSource.uuid, importSource]]);
  const fixture = installFixture({ group, actors: [group, hero], uuidDocuments });

  try {
    await fixture.service.takeInventoryItemToCharacter(takeSource.id, {
      actorId: hero.id,
      quantity: 1,
      mutationId: "take-repeat"
    });
    await fixture.service.takeInventoryItemToCharacter(takeSource.id, {
      actorId: hero.id,
      quantity: 1,
      mutationId: "take-repeat"
    });
    await fixture.service.sellInventoryItem(saleSource.id, 1, { mutationId: "sale-repeat" });
    await fixture.service.sellInventoryItem(saleSource.id, 1, { mutationId: "sale-repeat" });
    await fixture.service.importDroppedItem({ uuid: importSource.uuid, mutationId: "import-repeat" });
    await fixture.service.importDroppedItem({ uuid: importSource.uuid, mutationId: "import-repeat" });

    assert.equal(takeSource.system.quantity, 1);
    assert.equal(saleSource.system.quantity, 1);
    assert.equal(group.system.currency.gp, 5);
    assert.equal(hero.items.contents.filter((item) => item.name === "Rope").length, 1);
    assert.equal(group.items.contents.filter((item) => item.name === "Lantern").length, 1);
  }
  finally {
    fixture.restore();
  }
});

test.after(() => {
  globalThis.Actor = previousActor;
  globalThis.Item = previousItem;
});
