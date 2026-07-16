import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID, REBREYA_GROUP_FLAGS, SETTINGS_KEYS } from "../scripts/constants.js";

const previousActor = globalThis.Actor;
const previousItem = globalThis.Item;
globalThis.Actor = class TestActorDocument {};
globalThis.Item = class TestItemDocument {};

const {
  captureInventoryTransferIdentity,
  InventoryService,
  itemsCanRepresentSameTransfer
} = await import(`../scripts/data/inventory-service.js?mutation-recovery=${Date.now()}`);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

test("inventory transfer identity keeps durability-homogeneous stacks separate", () => {
  const durability = {
    version: 1,
    eligible: true,
    state: "intact",
    breakStage: 0,
    materialProfile: "steel",
    construction: "sturdy",
    size: "small",
    hp: { value: 15, max: 15 },
    ac: 17,
    damageThreshold: 6
  };
  const makeData = (nextDurability) => ({
    name: "Longsword",
    type: "weapon",
    flags: {
      [MODULE_ID]: {
        sourceType: "gear",
        sourceId: "longsword",
        durability: nextDurability
      }
    }
  });

  assert.equal(itemsCanRepresentSameTransfer(makeData(durability), makeData(clone(durability))), true);
  assert.equal(itemsCanRepresentSameTransfer(
    makeData(durability),
    makeData({ ...durability, state: "broken", breakStage: 1 })
  ), false);
  assert.equal(itemsCanRepresentSameTransfer(
    makeData(durability),
    makeData({ ...durability, hp: { value: 14, max: 15 } })
  ), false);
  assert.equal(itemsCanRepresentSameTransfer(makeData(null), makeData(null)), true);
  assert.equal(itemsCanRepresentSameTransfer(makeData(durability), makeData(null)), false);
});

test("broken lootgen grants persist full durability exactly once and do not merge with intact gear", async () => {
  const steel = { id: "steel", name: "Сталь" };
  const gear = {
    id: "steel-sword",
    name: "Стальной меч",
    equipmentType: "Оружие",
    predominantMaterialId: steel.id,
    predominantMaterialName: steel.name,
    weight: 3,
    priceGoldEquivalent: 15
  };
  const model = {
    gear: [gear],
    gearById: new Map([[gear.id, gear]]),
    materials: [steel],
    materialById: new Map([[steel.id, steel]]),
    materialByGoodId: new Map()
  };
  const sourceData = {
    name: gear.name,
    type: "weapon",
    system: {
      quantity: 1,
      equipped: false,
      damage: { base: { number: 1, denomination: 8, bonus: "" } }
    },
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "gear",
        sourceId: gear.id,
        gearId: gear.id
      }
    }
  };
  const sourceDocument = {
    id: "steel-sword-doc",
    uuid: "Compendium.world.rebreya-gear.Item.steel-sword-doc",
    toObject: () => clone({ ...sourceData, _id: "steel-sword-doc" })
  };
  const gearPack = {
    collection: "world.rebreya-gear",
    async getIndex() {
      return [{ _id: sourceDocument.id, flags: clone(sourceData.flags) }];
    },
    async getDocument(documentId) {
      return documentId === sourceDocument.id ? sourceDocument : null;
    }
  };
  const group = createActor({ id: "loot-group", type: "group", managed: true });
  const fixture = installFixture({
    group,
    actors: [group],
    packs: new Map([["world.rebreya-gear", gearPack]]),
    moduleApi: { getModel: async () => model }
  });

  try {
    const brokenRow = {
      sourceType: "gear",
      sourceId: gear.id,
      quantity: 1,
      isBroken: true
    };
    await fixture.service.addLootgenRowToInventoryOnce(brokenRow, "loot-broken-1");
    await fixture.service.addLootgenRowToInventoryOnce(brokenRow, "loot-broken-1");

    assert.equal(group.items.contents.length, 1);
    assert.equal(group.items.contents[0].type, "weapon");
    assert.deepEqual(group.items.contents[0].system.damage, sourceData.system.damage);
    assert.equal(group.items.contents[0].system.quantity, 1);
    assert.equal(group.items.contents[0].flags[MODULE_ID].durability.state, "broken");
    assert.equal(group.items.contents[0].flags[MODULE_ID].durability.breakStage, 1);
    assert.equal(
      group.items.contents[0].flags[MODULE_ID].durability.hp.value,
      group.items.contents[0].flags[MODULE_ID].durability.hp.max
    );

    await fixture.service.addLootgenRowToInventoryOnce({
      ...brokenRow,
      isBroken: false
    }, "loot-intact-1");

    assert.equal(group.items.contents.length, 2);
    await fixture.service.addLootgenRowToInventory({
      ...brokenRow,
      isBroken: false,
      itemData: {
        name: "Поддельный артефакт",
        type: "weapon",
        system: { rarity: "legendary", quantity: 1 },
        flags: { [MODULE_ID]: { magical: true } }
      }
    });

    assert.equal(group.items.contents.length, 2);
    assert.equal(group.items.contents.every((item) => item.name === gear.name && item.type === "weapon"), true);
    assert.equal(group.items.contents.some((item) => item.flags[MODULE_ID].magical === true), false);
    const states = group.items.contents.map((item) => item.flags[MODULE_ID].durability?.state ?? "uninitialized");
    assert.deepEqual(states.sort(), ["broken", "uninitialized"]);
  }
  finally {
    fixture.restore();
  }
});

test("calendar execution guard stops supply mutations before the next persistent side effect", async () => {
  let authority = true;
  let foodUpdates = 0;
  let waterUpdates = 0;
  const food = createItem({
    id: "food",
    name: "Еда",
    quantity: 5,
    flags: { [MODULE_ID]: { resourceKey: "food", sourceType: "supply" } },
    onUpdate: () => {
      foodUpdates += 1;
      authority = false;
    }
  });
  const water = createItem({
    id: "water",
    name: "Галлоны воды",
    quantity: 5,
    flags: { [MODULE_ID]: { resourceKey: "water", sourceType: "supply" } },
    onUpdate: () => {
      waterUpdates += 1;
    }
  });
  const group = createActor({
    id: "guard-group",
    type: "group",
    managed: true,
    items: [food, water],
    members: []
  });
  const fixture = installFixture({
    group,
    actors: [group],
    moduleApi: {
      getModel: async () => ({ materials: [], materialById: new Map(), materialByGoodId: new Map(), gear: [], gearById: new Map() })
    }
  });
  const guard = () => {
    if (!authority) {
      throw new Error("calendar execution context changed");
    }
  };

  try {
    await assert.rejects(
      fixture.service.consumeSuppliesOneDay({ guard, assertExecutionContext: guard }),
      /execution context changed/iu
    );
    assert.equal(foodUpdates, 1);
    assert.equal(waterUpdates, 0);
  }
  finally {
    fixture.restore();
  }
});

test("calendar supply consumption stays pinned to its captured group", async () => {
  const foodA = createItem({
    id: "food-a",
    name: "Еда",
    quantity: 5,
    flags: { [MODULE_ID]: { resourceKey: "food", sourceType: "supply" } }
  });
  const foodB = createItem({
    id: "food-b",
    name: "Еда",
    quantity: 9,
    flags: { [MODULE_ID]: { resourceKey: "food", sourceType: "supply" } }
  });
  const memberA = createActor({ id: "member-a", type: "character" });
  const memberB = createActor({ id: "member-b", type: "character" });
  const groupA = createActor({
    id: "supply-group-a",
    type: "group",
    managed: true,
    items: [foodA],
    members: [{ actor: memberA }]
  });
  const groupB = createActor({
    id: "supply-group-b",
    type: "group",
    managed: true,
    items: [foodB],
    members: [{ actor: memberB }]
  });
  const fixture = installFixture({
    group: groupB,
    actors: [groupA, groupB, memberA, memberB],
    moduleApi: {
      getModel: async () => ({
        materials: [],
        materialById: new Map(),
        materialByGoodId: new Map(),
        gear: [],
        gearById: new Map()
      })
    },
    partyState: {
      members: {
        [memberA.id]: { role: "member", foodPerDay: 1, waterGalPerDay: 0 },
        [memberB.id]: { role: "member", foodPerDay: 1, waterGalPerDay: 0 }
      }
    }
  });

  try {
    await fixture.service.consumeSuppliesOneDay({
      groupId: groupA.id,
      applyEnergy: false,
      guard: () => true
    });

    assert.equal(foodA.system.quantity, 4);
    assert.equal(foodB.system.quantity, 9);
  }
  finally {
    fixture.restore();
  }
});

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
  img = "icons/svg/item-bag.svg",
  quantity = 1,
  price = { value: 0, denomination: "gp" },
  system = null,
  flags = {},
  extraData = {},
  failUpdate = false,
  failDelete = false,
  throwAfterUpdateOnce = false,
  throwAfterDeleteOnce = false,
  onUpdate = null,
  onDelete = null
} = {}) {
  const item = new globalThis.Item();
  let updateAckLost = false;
  let deleteAckLost = false;
  const itemSystem = system ? clone(system) : {
    quantity,
    price: clone(price),
    weight: { value: 1 }
  };
  itemSystem.quantity = quantity ?? itemSystem.quantity;
  Object.assign(item, {
    ...clone(extraData),
    id,
    _id: id,
    uuid: "",
    name,
    type,
    img,
    flags: clone(flags),
    system: itemSystem,
    toObject() {
      return clone({
        ...extraData,
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
      onUpdate?.(this, clone(patch));
      if (throwAfterUpdateOnce && !updateAckLost) {
        updateAckLost = true;
        throw new Error("source update acknowledgment lost");
      }
      return this;
    },
    async delete() {
      if (failDelete) throw new Error("source delete failed");
      const index = this.parent?.items?.contents?.indexOf(this) ?? -1;
      if (index >= 0) this.parent.items.contents.splice(index, 1);
      onDelete?.(this);
      if (throwAfterDeleteOnce && !deleteAckLost) {
        deleteAckLost = true;
        throw new Error("source delete acknowledgment lost");
      }
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
  members = [],
  owners = [],
  throwAfterCreateOnce = false,
  onCreate = null
} = {}) {
  const actor = new globalThis.Actor();
  let createAckLost = false;
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
    testUserPermission(user, permission) {
      return permission === "OWNER" && (user?.isGM === true || owners.includes(user?.id));
    },
    async update(patch) {
      applyPatch(this, patch);
      return this;
    },
    async createEmbeddedDocuments(_documentName, documents) {
      const created = documents.map((document, index) => {
        const { _id, id: _ignoredId, name, type, img, flags, system, ...extraData } = clone(document);
        return createItem({
          id: `created-${this.items.contents.length + index + 1}`,
          name,
          type,
          img,
          quantity: system?.quantity,
          price: system?.price,
          system,
          flags,
          extraData
        });
      });
      for (const item of created) {
        item.parent = this;
        item.uuid = `${this.uuid}.Item.${item.id}`;
        this.items.contents.push(item);
      }
      onCreate?.(created);
      if (throwAfterCreateOnce && !createAckLost) {
        createAckLost = true;
        throw new Error("item creation acknowledgment lost");
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

function installFixture({
  group,
  actors,
  uuidDocuments = new Map(),
  partyState = {},
  packs = new Map(),
  moduleApi: moduleApiOverrides = {},
  user = { id: "gm", isGM: true, active: true },
  activeGM = { id: "gm", isGM: true, active: true },
  users = [],
  hideDeletedUuidDocuments = false,
  beforeSettingsSet = null,
  afterSettingsSet = null
}) {
  const previousFoundry = globalThis.foundry;
  const previousGame = globalThis.game;
  const previousFromUuid = globalThis.fromUuid;
  const settingsStore = {
    [SETTINGS_KEYS.PARTY_STATE]: clone(partyState),
    [SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL]: {}
  };
  const settingsWrites = [];
  globalThis.foundry = {
    utils: {
      deepClone: clone,
      getProperty: (source, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], source),
      setProperty,
      mergeObject: (target, source) => ({ ...clone(target), ...clone(source) }),
      flattenObject: (source) => clone(source)
    }
  };
  const knownUsers = [...new Map([user, activeGM, ...users]
    .filter(Boolean)
    .map((entry) => [entry.id, entry])).values()];
  globalThis.game = {
    user,
    users: {
      activeGM,
      contents: knownUsers,
      get: (userId) => knownUsers.find((entry) => entry.id === userId) ?? null
    },
    actors: {
      contents: actors,
      get: (actorId) => actors.find((actor) => actor.id === actorId) ?? null
    },
    packs: {
      get: (packId) => packs.get(packId) ?? null
    },
    settings: {
      get: (_moduleId, key) => clone(settingsStore[key]),
      async set(_moduleId, key, value) {
        const event = { key, value: clone(value) };
        await beforeSettingsSet?.(event);
        settingsStore[key] = clone(value);
        settingsWrites.push(event);
        await afterSettingsSet?.(event);
        return value;
      }
    }
  };
  globalThis.fromUuid = async (uuid) => {
    const document = uuidDocuments.get(uuid) ?? null;
    if (hideDeletedUuidDocuments
      && document instanceof globalThis.Item
      && document.parent
      && !document.parent.items?.contents?.includes(document)) {
      return null;
    }
    return document;
  };
  const moduleApi = {
    groupContextService: {
      resolveForCurrentUser: () => ({
        groupActor: group,
        groupId: group.id,
        canManage: true,
        members: group.system.members.map((row) => row.actor)
      }),
      resolveForGroup: (groupId) => {
        const resolvedGroup = actors.find((actor) => actor.id === groupId && actor.type === "group") ?? group;
        return {
          groupActor: resolvedGroup,
          groupId: resolvedGroup.id,
          canManage: true,
          members: resolvedGroup.system.members.map((row) => row.actor)
        };
      }
    },
    ...moduleApiOverrides
  };

  return {
    service: new InventoryService(moduleApi),
    settingsStore,
    settingsWrites,
    restore() {
      globalThis.foundry = previousFoundry;
      globalThis.game = previousGame;
      globalThis.fromUuid = previousFromUuid;
    }
  };
}

function buildSourceDepletionPayload(sourceItem, targetItem, transferId) {
  const quantity = sourceItem.system.quantity;
  return {
    transferId,
    sourceItemUuid: sourceItem.uuid,
    targetItemUuid: targetItem.uuid,
    targetActorUuid: targetItem.parent.uuid,
    expectedIdentity: captureInventoryTransferIdentity(sourceItem),
    expectedQuantity: quantity,
    targetReceipt: {
      targetItemUuid: targetItem.uuid,
      created: true,
      beforeQuantity: 0,
      afterQuantity: quantity,
      delta: quantity
    }
  };
}

test("distributed source depletion requires a captured identity and quantity", async () => {
  const gm = { id: "gm", isGM: true, active: true };
  const player = { id: "player", isGM: false, active: true };
  let deleteCalls = 0;
  const source = createItem({
    id: "captured-source",
    name: "Captured source",
    quantity: 1,
    flags: { [MODULE_ID]: { sourceType: "gear", sourceId: "captured-source" } },
    onDelete: () => { deleteCalls += 1; }
  });
  const target = createItem({
    id: "captured-target",
    name: source.name,
    quantity: 1,
    flags: clone(source.flags)
  });
  const hero = createActor({ id: "hero", items: [target], owners: [player.id] });
  const group = createActor({
    id: "group",
    type: "group",
    managed: true,
    items: [source],
    members: [{ actor: hero }]
  });
  const uuidDocuments = new Map([[source.uuid, source], [target.uuid, target], [hero.uuid, hero]]);
  const fixture = installFixture({
    group,
    actors: [group, hero],
    uuidDocuments,
    user: gm,
    activeGM: gm,
    users: [player],
    hideDeletedUuidDocuments: true
  });
  const payload = buildSourceDepletionPayload(source, target, "party-transfer:captured-required");
  delete payload.expectedIdentity;

  try {
    await assert.rejects(
      fixture.service.handlePartyInventorySourceDepletionSocketRequest(payload, { senderId: player.id }),
      /captured identity|identity and quantity/iu
    );
    assert.equal(deleteCalls, 0);
    assert.equal(group.items.contents.includes(source), true);
    assert.deepEqual(fixture.settingsStore[SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL], {});

    const malformedReceiptPayload = buildSourceDepletionPayload(
      source,
      target,
      "party-transfer:captured-receipt-required"
    );
    delete malformedReceiptPayload.targetReceipt.beforeQuantity;
    await assert.rejects(
      fixture.service.handlePartyInventorySourceDepletionSocketRequest(
        malformedReceiptPayload,
        { senderId: player.id }
      ),
      /target receipt|captured identity and quantity receipt/iu
    );
    assert.equal(deleteCalls, 0);
    assert.equal(group.items.contents.includes(source), true);
  }
  finally {
    fixture.restore();
  }
});

test("distributed source depletion observes a delete whose acknowledgment was lost", async () => {
  const gm = { id: "gm", isGM: true, active: true };
  const player = { id: "player", isGM: false, active: true };
  let deleteCalls = 0;
  const source = createItem({
    id: "ack-source",
    name: "ACK source",
    quantity: 1,
    flags: { [MODULE_ID]: { sourceType: "gear", sourceId: "ack-source" } },
    throwAfterDeleteOnce: true,
    onDelete: () => { deleteCalls += 1; }
  });
  const target = createItem({
    id: "ack-target",
    name: source.name,
    quantity: 1,
    flags: clone(source.flags)
  });
  const hero = createActor({ id: "hero", items: [target], owners: [player.id] });
  const group = createActor({
    id: "group",
    type: "group",
    managed: true,
    items: [source],
    members: [{ actor: hero }]
  });
  const fixture = installFixture({
    group,
    actors: [group, hero],
    uuidDocuments: new Map([[source.uuid, source], [target.uuid, target], [hero.uuid, hero]]),
    user: gm,
    activeGM: gm,
    users: [player],
    hideDeletedUuidDocuments: true
  });
  const payload = buildSourceDepletionPayload(source, target, "party-transfer:delete-ack-lost");

  try {
    const first = await fixture.service.handlePartyInventorySourceDepletionSocketRequest(payload, { senderId: player.id });
    const retry = await fixture.service.handlePartyInventorySourceDepletionSocketRequest(payload, { senderId: player.id });

    assert.deepEqual(retry, first);
    assert.equal(deleteCalls, 1);
    assert.equal(group.items.contents.includes(source), false);
    const record = fixture.settingsStore[SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL].records
      .find((entry) => entry.id === payload.transferId);
    assert.equal(record.terminal, true);
    assert.equal(record.kind, "party-inventory-source-depletion");
  }
  finally {
    fixture.restore();
  }
});

test("distributed source depletion survives source-deleted journal ACK loss", async () => {
  const gm = { id: "gm", isGM: true, active: true };
  const player = { id: "player", isGM: false, active: true };
  let deleteCalls = 0;
  let checkpointAckLost = false;
  const source = createItem({
    id: "journal-source",
    name: "Journal source",
    quantity: 1,
    flags: { [MODULE_ID]: { sourceType: "gear", sourceId: "journal-source" } },
    onDelete: () => { deleteCalls += 1; }
  });
  const target = createItem({
    id: "journal-target",
    name: source.name,
    quantity: 1,
    flags: clone(source.flags)
  });
  const hero = createActor({ id: "hero", items: [target], owners: [player.id] });
  const group = createActor({
    id: "group",
    type: "group",
    managed: true,
    items: [source],
    members: [{ actor: hero }]
  });
  const fixture = installFixture({
    group,
    actors: [group, hero],
    uuidDocuments: new Map([[source.uuid, source], [target.uuid, target], [hero.uuid, hero]]),
    user: gm,
    activeGM: gm,
    users: [player],
    hideDeletedUuidDocuments: true,
    afterSettingsSet: ({ key, value }) => {
      const phase = value?.records?.find((entry) => entry.id === "party-transfer:journal-ack-lost")?.phase;
      if (key === SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL
        && phase === "source-depleted"
        && !checkpointAckLost) {
        checkpointAckLost = true;
        throw new Error("source-deleted journal acknowledgment lost");
      }
    }
  });
  const payload = buildSourceDepletionPayload(source, target, "party-transfer:journal-ack-lost");

  try {
    const first = await fixture.service.handlePartyInventorySourceDepletionSocketRequest(payload, { senderId: player.id });
    const retry = await fixture.service.handlePartyInventorySourceDepletionSocketRequest(payload, { senderId: player.id });

    assert.deepEqual(retry, first);
    assert.equal(checkpointAckLost, true);
    assert.equal(retry.handled, true);
    assert.equal(deleteCalls, 1);
    assert.equal(group.items.contents.includes(source), false);
    const record = fixture.settingsStore[SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL].records
      .find((entry) => entry.id === payload.transferId);
    assert.equal(record.terminal, true);
  }
  finally {
    fixture.restore();
  }
});

test("a new active GM completes a prepared source deletion without a second effect", async () => {
  const oldGm = { id: "old-gm", isGM: true, active: true };
  const newGm = { id: "new-gm", isGM: true, active: true };
  const player = { id: "player", isGM: false, active: true };
  let deleteCalls = 0;
  const source = createItem({
    id: "failover-source",
    name: "Failover source",
    quantity: 1,
    flags: { [MODULE_ID]: { sourceType: "gear", sourceId: "failover-source" } },
    onDelete: () => {
      deleteCalls += 1;
      globalThis.game.users.activeGM = newGm;
    }
  });
  const target = createItem({
    id: "failover-target",
    name: source.name,
    quantity: 1,
    flags: clone(source.flags)
  });
  const hero = createActor({ id: "hero", items: [target], owners: [player.id] });
  const group = createActor({
    id: "group",
    type: "group",
    managed: true,
    items: [source],
    members: [{ actor: hero }]
  });
  const fixture = installFixture({
    group,
    actors: [group, hero],
    uuidDocuments: new Map([[source.uuid, source], [target.uuid, target], [hero.uuid, hero]]),
    user: oldGm,
    activeGM: oldGm,
    users: [newGm, player],
    hideDeletedUuidDocuments: true
  });
  const payload = buildSourceDepletionPayload(source, target, "party-transfer:gm-failover");

  try {
    await assert.rejects(
      fixture.service.handlePartyInventorySourceDepletionSocketRequest(payload, { senderId: player.id }),
      /active GM/iu
    );
    globalThis.game.user = newGm;
    const retry = await fixture.service.handlePartyInventorySourceDepletionSocketRequest(payload, { senderId: player.id });

    assert.equal(retry.handled, true);
    assert.equal(deleteCalls, 1);
    assert.equal(group.items.contents.includes(source), false);
    const record = fixture.settingsStore[SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL].records
      .find((entry) => entry.id === payload.transferId);
    assert.equal(record.terminal, true);
  }
  finally {
    fixture.restore();
  }
});

test("craft Once APIs require the active GM before touching durable or world state", async () => {
  const group = createActor({ id: "group", type: "group", managed: true });
  const fixture = installFixture({
    group,
    actors: [group],
    user: { id: "standby-gm", isGM: true, active: true },
    activeGM: { id: "primary-gm", isGM: true, active: true }
  });
  const operations = [
    () => fixture.service.reserveCraftResourcesOnce({
      projectId: "project-owner",
      predominantMaterialId: "iron",
      predominantMaterialLb: 1
    }, "owner-reserve"),
    () => fixture.service.spendCraftReservationOnce(
      "project-owner",
      { predominantMaterialLb: 1 },
      "owner-spend"
    ),
    () => fixture.service.releaseCraftReservationOnce(
      "project-owner",
      { predominantMaterialId: "iron", predominantMaterialLb: 1 },
      "owner-release"
    ),
    () => fixture.service.createCraftOutputsOnce([
      { sourceType: "gear", sourceId: "longsword", quantity: 1 }
    ], "owner-output")
  ];

  try {
    for (const operation of operations) {
      await assert.rejects(operation(), /active GM/iu);
    }
    assert.deepEqual(fixture.settingsStore[SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL], {});
    assert.deepEqual(fixture.settingsWrites, []);
    assert.equal(group.items.contents.length, 0);
  }
  finally {
    fixture.restore();
  }
});

test("craft Once APIs require an explicit nonempty stable mutation ID", async () => {
  const group = createActor({ id: "group", type: "group", managed: true });
  const fixture = installFixture({ group, actors: [group] });
  const operations = [
    () => fixture.service.reserveCraftResourcesOnce({ projectId: "project-id" }, "  "),
    () => fixture.service.spendCraftReservationOnce("project-id", {}, ""),
    () => fixture.service.releaseCraftReservationOnce("project-id", {}, null),
    () => fixture.service.createCraftOutputsOnce([
      { sourceType: "gear", sourceId: "longsword", quantity: 1 }
    ], undefined),
    () => fixture.service.spendCraftReservationOnce("project-id", {}, 42)
  ];

  try {
    for (const operation of operations) {
      await assert.rejects(operation(), /nonempty stable mutation ID/iu);
    }
    assert.deepEqual(fixture.settingsStore[SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL], {});
    assert.deepEqual(fixture.settingsWrites, []);
    assert.equal(group.items.contents.length, 0);
  }
  finally {
    fixture.restore();
  }
});

test("all craft Once APIs stay pinned to the captured group instead of the currently selected group", async () => {
  const ironA = createItem({
    id: "iron-a",
    quantity: 5,
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron", materialId: "iron" } }
  });
  const ironB = createItem({
    id: "iron-b",
    quantity: 50,
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron", materialId: "iron" } }
  });
  const groupA = createActor({ id: "group-a", type: "group", managed: true, items: [ironA] });
  const groupB = createActor({ id: "group-b", type: "group", managed: true, items: [ironB] });
  const sourceData = {
    _id: "gear-captured",
    name: "Captured Gear",
    type: "weapon",
    system: { quantity: 1, equipped: false },
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "gear",
        gearId: "captured-gear"
      }
    }
  };
  const sourceDocument = {
    id: sourceData._id,
    uuid: `Compendium.world.rebreya-gear.Item.${sourceData._id}`,
    toObject: () => clone(sourceData)
  };
  const gearPack = {
    collection: "world.rebreya-gear",
    async getDocument(documentId) {
      return documentId === sourceDocument.id ? sourceDocument : null;
    }
  };
  const fixture = installFixture({
    group: groupB,
    actors: [groupA, groupB],
    packs: new Map([["world.rebreya-gear", gearPack]])
  });
  const executionOptions = {
    groupId: groupA.id,
    guard: () => true,
    assertExecutionContext: () => true
  };

  try {
    await fixture.service.reserveCraftResourcesOnce({
      projectId: "captured-project",
      predominantMaterialId: "iron",
      predominantMaterialLb: 1
    }, "captured-reserve", executionOptions);
    await fixture.service.spendCraftReservationOnce(
      "captured-project",
      { predominantMaterialLb: 0.25 },
      "captured-spend",
      executionOptions
    );
    await fixture.service.releaseCraftReservationOnce(
      "captured-project",
      { predominantMaterialId: "iron", predominantMaterialLb: 0.5 },
      "captured-release",
      executionOptions
    );
    await fixture.service.createCraftOutputsOnce([{
      sourceType: "gear",
      sourceId: "captured-gear",
      sourceDocumentId: sourceDocument.id,
      quantity: 1
    }], "captured-output", executionOptions);

    assert.equal(ironA.system.quantity, 4.5);
    assert.equal(ironB.system.quantity, 50);
    assert.equal(groupA.items.contents.filter((item) => item.name === sourceData.name).length, 1);
    assert.equal(groupB.items.contents.filter((item) => item.name === sourceData.name).length, 0);
    const records = fixture.settingsStore[SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL].records
      .filter((record) => record.id.startsWith("captured-"));
    assert.equal(records.length, 4);
    assert.equal(records.every((record) => record.groupId === groupA.id), true);
    assert.equal(records.every((record) => record.actorId === groupA.id), true);

    await assert.rejects(
      fixture.service.reserveCraftResourcesOnce({
        projectId: "captured-project",
        predominantMaterialId: "iron",
        predominantMaterialLb: 1
      }, "captured-reserve", {
        ...executionOptions,
        groupId: groupB.id
      }),
      /group|actor|reconciliation/iu
    );
    assert.equal(ironB.system.quantity, 50);
  }
  finally {
    fixture.restore();
  }
});

test("craft reservation retry observes an update completed after the old guard became stale", async () => {
  let oldGuardCurrent = true;
  let updateCalls = 0;
  const iron = createItem({
    id: "guarded-iron",
    quantity: 5,
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron", materialId: "iron" } },
    onUpdate: () => {
      updateCalls += 1;
      oldGuardCurrent = false;
    }
  });
  const group = createActor({ id: "guarded-group", type: "group", managed: true, items: [iron] });
  const fixture = installFixture({ group, actors: [group] });
  const request = {
    projectId: "guarded-project",
    predominantMaterialId: "iron",
    predominantMaterialLb: 1
  };
  const oldGuard = () => {
    if (!oldGuardCurrent) throw new Error("craft execution context changed");
  };

  try {
    await assert.rejects(
      fixture.service.reserveCraftResourcesOnce(request, "guarded-reserve", {
        groupId: group.id,
        guard: oldGuard,
        assertExecutionContext: oldGuard
      }),
      /execution context changed/iu
    );
    assert.equal(iron.system.quantity, 4);
    assert.equal(updateCalls, 1);
    const prepared = fixture.settingsStore[SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL].records
      .find((record) => record.id === "guarded-reserve");
    assert.equal(prepared.phase, "prepared");
    assert.equal(prepared.terminal, false);

    const result = await fixture.service.reserveCraftResourcesOnce(request, "guarded-reserve", {
      groupId: group.id,
      guard: () => true,
      assertExecutionContext: () => true
    });
    assert.equal(result.length, 1);
    assert.equal(iron.system.quantity, 4);
    assert.equal(updateCalls, 1);
    const committed = fixture.settingsStore[SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL].records
      .find((record) => record.id === "guarded-reserve");
    assert.equal(committed.terminal, true);
  }
  finally {
    fixture.restore();
  }
});

test("craft output retry adopts the item created while the old GM lost authority", async () => {
  const oldGm = { id: "old-gm", isGM: true, active: true };
  const newGm = { id: "new-gm", isGM: true, active: true };
  let createCalls = 0;
  const group = createActor({
    id: "output-group",
    type: "group",
    managed: true,
    onCreate: () => {
      createCalls += 1;
      globalThis.game.users.activeGM = newGm;
    }
  });
  const sourceData = {
    _id: "failover-gear-document",
    name: "Failover Gear",
    type: "weapon",
    system: { quantity: 1, equipped: false },
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "gear",
        gearId: "failover-gear"
      }
    }
  };
  const sourceDocument = {
    id: sourceData._id,
    uuid: `Compendium.world.rebreya-gear.Item.${sourceData._id}`,
    toObject: () => clone(sourceData)
  };
  const fixture = installFixture({
    group,
    actors: [group],
    user: oldGm,
    activeGM: oldGm,
    packs: new Map([["world.rebreya-gear", {
      collection: "world.rebreya-gear",
      async getDocument(documentId) {
        return documentId === sourceDocument.id ? sourceDocument : null;
      }
    }]])
  });
  const outputs = [{
    sourceType: "gear",
    sourceId: "failover-gear",
    sourceDocumentId: sourceDocument.id,
    quantity: 1
  }];
  const oldGuard = () => {
    if (globalThis.game.users.activeGM.id !== oldGm.id) {
      throw new Error("craft execution authority changed");
    }
  };

  try {
    await assert.rejects(
      fixture.service.createCraftOutputsOnce(outputs, "failover-output", {
        groupId: group.id,
        guard: oldGuard,
        assertExecutionContext: oldGuard
      }),
      /active GM|execution authority changed/iu
    );
    assert.equal(group.items.contents.length, 1);
    assert.equal(createCalls, 1);
    const prepared = fixture.settingsStore[SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL].records
      .find((record) => record.id === "failover-output");
    assert.equal(prepared.phase, "prepared");

    globalThis.game.user = newGm;
    const result = await fixture.service.createCraftOutputsOnce(outputs, "failover-output", {
      groupId: group.id,
      guard: () => true,
      assertExecutionContext: () => true
    });
    assert.equal(result.length, 1);
    assert.equal(group.items.contents.length, 1);
    assert.equal(createCalls, 1);
    const committed = fixture.settingsStore[SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL].records
      .find((record) => record.id === "failover-output");
    assert.equal(committed.terminal, true);
  }
  finally {
    fixture.restore();
  }
});

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

test("party tool rank normalizes to a nonnegative integer and resolves exact-label actor tools first", async () => {
  const lowRankTool = createItem({
    id: "smith-low",
    name: "Smith Tool",
    type: "tool",
    flags: {
      [MODULE_ID]: {
        sourceType: "gear",
        linkedTool: "\u041a\u0443\u0437\u043d\u0435\u0446\u0430",
        rank: 1
      }
    }
  });
  const highRankTool = createItem({
    id: "smith-high",
    name: "Better Smith Tool",
    type: "tool",
    system: {
      quantity: 1,
      type: { value: "art", baseItem: "smith" }
    },
    flags: {
      [MODULE_ID]: {
        sourceType: "gear",
        rebreyaToolId: "smith",
        rank: 4.9
      }
    }
  });
  const flaggedLoot = createItem({
    id: "not-a-tool",
    type: "loot",
    flags: {
      [MODULE_ID]: {
        sourceType: "gear",
        rebreyaToolId: "smith",
        rank: 99
      }
    }
  });
  const brokenTool = createItem({
    id: "smith-broken",
    name: "Broken Smith Tool",
    type: "tool",
    quantity: 1,
    flags: {
      [MODULE_ID]: {
        sourceType: "gear",
        rebreyaToolId: "smith",
        rank: 99,
        durability: { state: "broken", breakStage: 1 }
      }
    }
  });
  const destroyedTool = createItem({
    id: "smith-destroyed",
    name: "Destroyed Smith Tool",
    type: "tool",
    quantity: 1,
    flags: {
      [MODULE_ID]: {
        sourceType: "gear",
        rebreyaToolId: "smith",
        rank: 100,
        durability: { state: "destroyed", breakStage: 2 }
      }
    }
  });
  const emptyTool = createItem({
    id: "smith-empty",
    name: "Empty Smith Tool Stack",
    type: "tool",
    quantity: 0,
    flags: {
      [MODULE_ID]: {
        sourceType: "gear",
        rebreyaToolId: "smith",
        rank: 101
      }
    }
  });
  const invalidTools = [brokenTool, destroyedTool, emptyTool];
  const hero = createActor({
    id: "hero",
    items: [lowRankTool, highRankTool, flaggedLoot, ...invalidTools]
  });
  const group = createActor({
    id: "group",
    type: "group",
    managed: true,
    members: [{ actor: hero }]
  });
  const fixture = installFixture({ group, actors: [group, hero] });

  try {
    const configured = await fixture.service.updatePartyMemberTool(hero.id, "\u041a\u0443\u0437\u043d\u0435\u0446\u0430", {
      owned: true,
      rank: 2.8
    });
    assert.equal(configured.rank, 2);
    assert.equal(fixture.settingsStore[SETTINGS_KEYS.PARTY_STATE].members.hero.tools.smith.rank, 2);

    const actorAccess = await fixture.service.resolveMemberToolAccess(hero.id, "smith");
    assert.deepEqual(actorAccess, {
      rank: 4,
      source: "item",
      itemUuid: highRankTool.uuid
    });

    hero.items.contents = invalidTools;
    assert.deepEqual(await fixture.service.resolveMemberToolAccess(hero.id, "smith"), {
      rank: 2,
      source: "manual",
      itemUuid: ""
    });

    const clamped = await fixture.service.updatePartyMemberTool(hero.id, "smith", { rank: -8.2 });
    assert.equal(clamped.rank, 0);
    assert.equal(await fixture.service.resolveMemberToolAccess(hero.id, "alchemy"), null);
  }
  finally {
    fixture.restore();
  }
});

test("craft reservation atomically debits fractional predominant and base raw materials once", async () => {
  const iron = createItem({
    id: "iron-stack",
    name: "Iron",
    quantity: 4,
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron", materialId: "iron" } }
  });
  const baseRaw = createItem({
    id: "smith-base-stack",
    name: "Smith Base Raw",
    quantity: 2.5,
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "smith-base", materialId: "smith-base" } }
  });
  const group = createActor({ id: "group", type: "group", managed: true, items: [iron, baseRaw] });
  const fixture = installFixture({ group, actors: [group] });
  const quote = {
    projectId: "project-atomic",
    predominantMaterialId: "iron",
    predominantMaterialLb: 1.25,
    baseRawMaterialId: "smith-base",
    baseRawQuantity: 0.33333
  };

  try {
    const first = await fixture.service.reserveCraftResourcesOnce(quote, "reserve-atomic");
    const retry = await fixture.service.reserveCraftResourcesOnce(quote, "reserve-atomic");

    assert.deepEqual(first, retry);
    assert.deepEqual(first.map((receipt) => ({
      resource: receipt.resource,
      sourceId: receipt.sourceId,
      quantity: receipt.quantity,
      beforeQuantity: receipt.beforeQuantity,
      afterQuantity: receipt.afterQuantity
    })), [
      {
        resource: "predominant",
        sourceId: "iron",
        quantity: 1.25,
        beforeQuantity: 4,
        afterQuantity: 2.75
      },
      {
        resource: "baseRaw",
        sourceId: "smith-base",
        quantity: 0.33333,
        beforeQuantity: 2.5,
        afterQuantity: 2.16667
      }
    ]);
    assert.equal(iron.system.quantity, 2.75);
    assert.equal(baseRaw.system.quantity, 2.16667);

    const spend = {
      predominantMaterialLb: 0.25,
      baseRawQuantity: 0.11111
    };
    const spendReceipt = await fixture.service.spendCraftReservationOnce("project-atomic", spend, "spend-atomic");
    assert.deepEqual(
      await fixture.service.spendCraftReservationOnce("project-atomic", spend, "spend-atomic"),
      spendReceipt
    );

    const remaining = {
      predominantMaterialId: "iron",
      predominantMaterialLb: 1,
      baseRawMaterialId: "smith-base",
      baseRawQuantity: 0.22222
    };
    const releaseReceipts = await fixture.service.releaseCraftReservationOnce(
      "project-atomic",
      remaining,
      "release-atomic"
    );
    assert.deepEqual(
      await fixture.service.releaseCraftReservationOnce("project-atomic", remaining, "release-atomic"),
      releaseReceipts
    );
    assert.equal(iron.system.quantity, 3.75);
    assert.equal(baseRaw.system.quantity, 2.38889);
  }
  finally {
    fixture.restore();
  }
});

test("exact craft reservation zero stacks cannot be taken, sold, or minted", async () => {
  const takeMaterial = createItem({
    id: "take-zero-stack",
    name: "Take Material",
    quantity: 1,
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "take-zero", materialId: "take-zero" } }
  });
  const saleMaterial = createItem({
    id: "sale-zero-stack",
    name: "Sale Material",
    quantity: 1,
    price: { value: 10, denomination: "gp" },
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "sale-zero", materialId: "sale-zero" } }
  });
  const hero = createActor({ id: "hero" });
  const group = createActor({
    id: "group",
    type: "group",
    managed: true,
    items: [takeMaterial, saleMaterial],
    members: [{ actor: hero }]
  });
  const fixture = installFixture({ group, actors: [group, hero] });

  try {
    await fixture.service.reserveCraftResourcesOnce({
      projectId: "project-exact-zero",
      predominantMaterialId: "take-zero",
      predominantMaterialLb: 1,
      baseRawMaterialId: "sale-zero",
      baseRawQuantity: 1
    }, "reserve-exact-zero");
    assert.equal(takeMaterial.system.quantity, 0);
    assert.equal(saleMaterial.system.quantity, 0);

    let takeError = null;
    let saleError = null;
    try {
      await fixture.service.takeInventoryItemToCharacter(takeMaterial.id, {
        actorId: hero.id,
        quantity: 1,
        mutationId: "take-exact-zero"
      });
    }
    catch (error) {
      takeError = error;
    }
    try {
      await fixture.service.sellInventoryItem(saleMaterial.id, 1, {
        mutationId: "sell-exact-zero"
      });
    }
    catch (error) {
      saleError = error;
    }

    assert.match(takeError?.message ?? "", /quantity/u);
    assert.match(saleError?.message ?? "", /quantity/u);
    assert.equal(group.items.contents.includes(takeMaterial), true);
    assert.equal(group.items.contents.includes(saleMaterial), true);
    assert.equal(hero.items.contents.length, 0);
    assert.deepEqual(group.system.currency, { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 });
  }
  finally {
    fixture.restore();
  }
});

test("craft reserve and release coalesce the same canonical material into one receipt", async () => {
  const iron = createItem({
    id: "iron-stack",
    name: "Iron",
    quantity: 2,
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron", materialId: "iron" } }
  });
  const group = createActor({ id: "group", type: "group", managed: true, items: [iron] });
  const fixture = installFixture({ group, actors: [group] });
  const resources = {
    predominantMaterialId: "iron",
    predominantMaterialLb: 0.75,
    baseRawMaterialId: "iron",
    baseRawQuantity: 0.25
  };

  try {
    const reserved = await fixture.service.reserveCraftResourcesOnce({
      projectId: "project-coalesced",
      ...resources
    }, "reserve-coalesced");
    assert.equal(reserved.length, 1);
    assert.equal(reserved[0].sourceId, "iron");
    assert.equal(reserved[0].quantity, 1);
    assert.equal(reserved[0].delta, 1);
    assert.equal(iron.system.quantity, 1);

    const released = await fixture.service.releaseCraftReservationOnce(
      "project-coalesced",
      resources,
      "release-coalesced"
    );
    assert.equal(released.length, 1);
    assert.equal(released[0].sourceId, "iron");
    assert.equal(released[0].quantity, 1);
    assert.equal(released[0].delta, 1);
    assert.equal(iron.system.quantity, 2);
    assert.equal(group.items.contents.length, 1);
  }
  finally {
    fixture.restore();
  }
});

test("coalesced craft release creates one canonical material stack in an empty inventory", async () => {
  const material = {
    id: "iron",
    name: "Iron",
    description: "",
    priceGold: 1,
    weight: 1,
    type: "Material"
  };
  const group = createActor({ id: "group", type: "group", managed: true });
  const fixture = installFixture({
    group,
    actors: [group],
    moduleApi: {
      getModel: async () => ({ materialById: new Map([[material.id, material]]) })
    }
  });

  try {
    const released = await fixture.service.releaseCraftReservationOnce("project-empty-release", {
      predominantMaterialId: "iron",
      predominantMaterialLb: 0.6,
      baseRawMaterialId: "iron",
      baseRawQuantity: 0.4
    }, "release-empty-coalesced");
    const retry = await fixture.service.releaseCraftReservationOnce("project-empty-release", {
      predominantMaterialId: "iron",
      predominantMaterialLb: 0.6,
      baseRawMaterialId: "iron",
      baseRawQuantity: 0.4
    }, "release-empty-coalesced");

    assert.deepEqual(retry, released);
    assert.equal(released.length, 1);
    assert.equal(released[0].quantity, 1);
    assert.equal(group.items.contents.length, 1);
    assert.equal(group.items.contents[0].system.quantity, 1);
  }
  finally {
    fixture.restore();
  }
});

test("craft reservation compensates completed material steps in reverse after a partial failure", async () => {
  const iron = createItem({
    id: "iron-stack",
    quantity: 4,
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron", materialId: "iron" } }
  });
  const failingBaseRaw = createItem({
    id: "base-stack",
    quantity: 2,
    failUpdate: true,
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "base", materialId: "base" } }
  });
  const group = createActor({ id: "group", type: "group", managed: true, items: [iron, failingBaseRaw] });
  const fixture = installFixture({ group, actors: [group] });
  const quote = {
    projectId: "project-failure",
    predominantMaterialId: "iron",
    predominantMaterialLb: 1.5,
    baseRawMaterialId: "base",
    baseRawQuantity: 0.5
  };

  try {
    await assert.rejects(
      fixture.service.reserveCraftResourcesOnce(quote, "reserve-failure"),
      /source update failed/u
    );
    assert.equal(iron.system.quantity, 4);
    assert.equal(failingBaseRaw.system.quantity, 2);

    await assert.rejects(
      fixture.service.reserveCraftResourcesOnce(quote, "reserve-failure"),
      /source update failed/u
    );
    assert.equal(iron.system.quantity, 4);
    assert.equal(failingBaseRaw.system.quantity, 2);
  }
  finally {
    fixture.restore();
  }
});

test("craft reservation survives an applied update throw and durable journal acknowledgment loss", async () => {
  const iron = createItem({
    id: "iron-ambiguous",
    quantity: 2,
    throwAfterUpdateOnce: true,
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron", materialId: "iron" } }
  });
  const group = createActor({ id: "group", type: "group", managed: true, items: [iron] });
  let journalAckLost = false;
  const fixture = installFixture({
    group,
    actors: [group],
    afterSettingsSet: ({ key, value }) => {
      const phase = value?.records?.find((record) => record.id === "reserve-ambiguous")?.phase;
      if (key === SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL
        && phase === "receipt-1-applied"
        && !journalAckLost) {
        journalAckLost = true;
        throw new Error("journal acknowledgment lost");
      }
    }
  });
  const quote = deepFreeze({
    projectId: "project-ambiguous",
    predominantMaterialId: "iron",
    predominantMaterialLb: 1
  });

  try {
    const first = await fixture.service.reserveCraftResourcesOnce(quote, "reserve-ambiguous");
    const retry = await fixture.service.reserveCraftResourcesOnce(quote, "reserve-ambiguous");

    assert.equal(journalAckLost, true);
    assert.deepEqual(retry, first);
    assert.equal(iron.system.quantity, 1);
    const record = fixture.settingsStore[SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL]
      .records.find((entry) => entry.id === "reserve-ambiguous");
    assert.equal(record.terminal, true);
    assert.deepEqual(record.request, {
      projectId: "project-ambiguous",
      predominantMaterialId: "iron",
      predominantMaterialLb: 1,
      baseRawMaterialId: "",
      baseRawQuantity: 0
    });
    assert.deepEqual(quote, {
      projectId: "project-ambiguous",
      predominantMaterialId: "iron",
      predominantMaterialLb: 1
    });
  }
  finally {
    fixture.restore();
  }
});

test("craft reservation compensates both applied receipts in actual reverse order", async () => {
  const updateOrder = [];
  const iron = createItem({
    id: "iron-reverse",
    quantity: 4,
    onUpdate: (item) => updateOrder.push([item.id, item.system.quantity]),
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron", materialId: "iron" } }
  });
  const baseRaw = createItem({
    id: "base-reverse",
    quantity: 1,
    onUpdate: (item) => updateOrder.push([item.id, item.system.quantity]),
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "base", materialId: "base" } }
  });
  const group = createActor({ id: "group", type: "group", managed: true, items: [iron, baseRaw] });
  let rejectedSecondCheckpoint = false;
  const fixture = installFixture({
    group,
    actors: [group],
    beforeSettingsSet: ({ key, value }) => {
      const phase = value?.records?.find((record) => record.id === "reserve-reverse-order")?.phase;
      if (key === SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL
        && phase === "receipt-2-applied"
        && !rejectedSecondCheckpoint) {
        rejectedSecondCheckpoint = true;
        throw new Error("second receipt journal write failed");
      }
    }
  });
  const quote = deepFreeze({
    projectId: "project-reverse-order",
    predominantMaterialId: "iron",
    predominantMaterialLb: 1,
    baseRawMaterialId: "base",
    baseRawQuantity: 1
  });

  try {
    await assert.rejects(
      fixture.service.reserveCraftResourcesOnce(quote, "reserve-reverse-order"),
      /second receipt journal write failed/u
    );
    assert.deepEqual(updateOrder, [
      ["iron-reverse", 3],
      ["base-reverse", 0],
      ["base-reverse", 1],
      ["iron-reverse", 4]
    ]);
    assert.equal(iron.system.quantity, 4);
    assert.equal(baseRaw.system.quantity, 1);

    await assert.rejects(
      fixture.service.reserveCraftResourcesOnce(quote, "reserve-reverse-order"),
      /second receipt journal write failed/u
    );
    assert.equal(updateOrder.length, 4);
  }
  finally {
    fixture.restore();
  }
});

test("craft release does not mint material when a later refund step fails", async () => {
  const iron = createItem({
    id: "iron-stack",
    quantity: 3,
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "iron", materialId: "iron" } }
  });
  const failingBaseRaw = createItem({
    id: "base-stack",
    quantity: 1.5,
    failUpdate: true,
    flags: { [MODULE_ID]: { sourceType: "material", sourceId: "base", materialId: "base" } }
  });
  const group = createActor({ id: "group", type: "group", managed: true, items: [iron, failingBaseRaw] });
  const fixture = installFixture({ group, actors: [group] });
  const remaining = {
    predominantMaterialId: "iron",
    predominantMaterialLb: 0.75,
    baseRawMaterialId: "base",
    baseRawQuantity: 0.25
  };

  try {
    await assert.rejects(
      fixture.service.releaseCraftReservationOnce("project-release-failure", remaining, "release-failure"),
      /source update failed/u
    );
    assert.equal(iron.system.quantity, 3);
    assert.equal(failingBaseRaw.system.quantity, 1.5);

    await assert.rejects(
      fixture.service.releaseCraftReservationOnce("project-release-failure", remaining, "release-failure"),
      /source update failed/u
    );
    assert.equal(iron.system.quantity, 3);
    assert.equal(failingBaseRaw.system.quantity, 1.5);
  }
  finally {
    fixture.restore();
  }
});

test("sourceDocumentId accepts only its matching managed canonical world gear document", async () => {
  const baseSource = {
    name: "Longsword",
    type: "weapon",
    system: { quantity: 1, equipped: false },
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "gear",
        gearId: "longsword"
      }
    }
  };
  const canonicalDocument = {
    id: "canonical-longsword",
    uuid: "Compendium.world.rebreya-gear.Item.canonical-longsword",
    toObject: () => clone({ ...baseSource, _id: "canonical-longsword" })
  };
  const unmanagedDocument = {
    id: "unmanaged-longsword",
    uuid: "Compendium.world.rebreya-gear.Item.unmanaged-longsword",
    toObject: () => {
      const source = clone({ ...baseSource, _id: "unmanaged-longsword" });
      source.flags[MODULE_ID].managed = false;
      return source;
    }
  };
  const untypedDocument = {
    id: "untyped-longsword",
    uuid: "Compendium.world.rebreya-gear.Item.untyped-longsword",
    toObject: () => {
      const source = clone({ ...baseSource, _id: "untyped-longsword" });
      delete source.flags[MODULE_ID].sourceType;
      return source;
    }
  };
  const cases = [
    {
      name: "unmanaged explicit source",
      sourceDocumentId: unmanagedDocument.id,
      collection: "world.rebreya-gear"
    },
    {
      name: "managed source without explicit gear type",
      sourceDocumentId: untypedDocument.id,
      collection: "world.rebreya-gear"
    },
    {
      name: "missing explicit source with an index fallback",
      sourceDocumentId: "missing-longsword",
      collection: "world.rebreya-gear"
    },
    {
      name: "lookalike noncanonical pack",
      sourceDocumentId: canonicalDocument.id,
      collection: "world.lookalike-gear"
    }
  ];
  const accepted = [];

  for (const [index, scenario] of cases.entries()) {
    const pack = {
      collection: scenario.collection,
      async getIndex() {
        return [{
          _id: canonicalDocument.id,
          name: baseSource.name,
          flags: clone(baseSource.flags)
        }];
      },
      async getDocument(documentId) {
        if (documentId === canonicalDocument.id) return canonicalDocument;
        if (documentId === unmanagedDocument.id) return unmanagedDocument;
        if (documentId === untypedDocument.id) return untypedDocument;
        return null;
      }
    };
    const group = createActor({ id: `group-${index}`, type: "group", managed: true });
    const fixture = installFixture({
      group,
      actors: [group],
      packs: new Map([["world.rebreya-gear", pack]])
    });
    try {
      await fixture.service.createCraftOutputsOnce([{
        sourceType: "gear",
        sourceId: "longsword",
        sourceDocumentId: scenario.sourceDocumentId,
        quantity: 1
      }], `canonical-source-${index}`);
      accepted.push(scenario.name);
    }
    catch (error) {
      assert.match(error.message, /canonical|managed|source document/iu);
    }
    finally {
      fixture.restore();
    }
  }

  assert.deepEqual(accepted, []);
});

test("craft outputs reject every dnd5e and Rebreya magic marker", async () => {
  const markers = [
    ["dnd5e mgc array", { system: { properties: ["mgc"] } }],
    ["dnd5e mgc object", { system: { properties: { mgc: true } } }],
    ["dnd5e rarity", { system: { rarity: "rare" } }],
    ["Rebreya magical", { flags: { magical: true } }],
    ["Rebreya isMagical", { flags: { isMagical: true } }],
    ["Rebreya isMagic", { flags: { isMagic: true } }],
    ["Rebreya magic", { flags: { magic: true } }],
    ["Rebreya magic item ID", { flags: { magicItemId: "magic-source" } }],
    ["Rebreya magic ID", { flags: { magicId: "magic-source" } }],
    ["Rebreya magic item marker", { flags: { magicItem: true } }],
    ["Rebreya magic item metadata", { flags: { magicItem: { rarity: "rare" } } }],
    ["Rebreya weapon template", { flags: { magicWeaponTemplate: true } }],
    ["Rebreya armor template", { flags: { magicArmorTemplate: true } }],
    ["Rebreya shield template", { flags: { magicShieldTemplate: true } }],
    ["Rebreya equipment template", { flags: { magicEquipmentTemplate: true } }],
    ["Rebreya ammunition template", { flags: { magicAmmunitionTemplate: true } }]
  ];
  const documents = new Map(markers.map(([name, marker], index) => {
    const sourceId = `gear-${index}`;
    const sourceData = {
      _id: `document-${index}`,
      name,
      type: "weapon",
      system: {
        quantity: 1,
        equipped: false,
        ...(clone(marker.system ?? {}))
      },
      flags: {
        [MODULE_ID]: {
          managed: true,
          sourceType: "gear",
          gearId: sourceId,
          ...(clone(marker.flags ?? {}))
        }
      }
    };
    return [sourceData._id, {
      id: sourceData._id,
      uuid: `Compendium.world.rebreya-gear.Item.${sourceData._id}`,
      sourceId,
      toObject: () => clone(sourceData)
    }];
  }));
  const pack = {
    collection: "world.rebreya-gear",
    async getIndex() {
      return [];
    },
    async getDocument(documentId) {
      return documents.get(documentId) ?? null;
    }
  };
  const group = createActor({ id: "group", type: "group", managed: true });
  const fixture = installFixture({
    group,
    actors: [group],
    packs: new Map([["world.rebreya-gear", pack]])
  });
  const accepted = [];

  try {
    for (const [index, [name]] of markers.entries()) {
      const document = documents.get(`document-${index}`);
      try {
        await fixture.service.createCraftOutputsOnce([{
          sourceType: "gear",
          sourceId: document.sourceId,
          sourceDocumentId: document.id,
          quantity: 1
        }], `magic-marker-${index}`);
        accepted.push(name);
      }
      catch (error) {
        assert.match(error.message, /magic/iu);
      }
    }
  }
  finally {
    fixture.restore();
  }

  assert.deepEqual(accepted, []);
  assert.equal(group.items.contents.length, 0);
});

test("craft outputs clear legacy attuned and every supported attunement form", async () => {
  const forms = [
    [true, false],
    ["required", ""],
    [2, 0],
    [{ value: 2, required: true }, { value: 0, required: true }]
  ];
  const documents = new Map(forms.map(([attunement], index) => {
    const sourceId = `attunement-gear-${index}`;
    const documentId = `attunement-document-${index}`;
    const sourceData = {
      _id: documentId,
      name: `Attunement Gear ${index}`,
      type: "weapon",
      system: {
        quantity: 1,
        equipped: true,
        attuned: true,
        attunement: clone(attunement)
      },
      flags: {
        [MODULE_ID]: {
          managed: true,
          sourceType: "gear",
          gearId: sourceId
        }
      }
    };
    return [documentId, {
      id: documentId,
      uuid: `Compendium.world.rebreya-gear.Item.${documentId}`,
      sourceId,
      toObject: () => clone(sourceData)
    }];
  }));
  const pack = {
    collection: "world.rebreya-gear",
    async getDocument(documentId) {
      return documents.get(documentId) ?? null;
    }
  };
  const group = createActor({ id: "group", type: "group", managed: true });
  const fixture = installFixture({
    group,
    actors: [group],
    packs: new Map([["world.rebreya-gear", pack]])
  });

  try {
    const outputs = await fixture.service.createCraftOutputsOnce(
      Array.from(documents.values()).map((document) => ({
        sourceType: "gear",
        sourceId: document.sourceId,
        sourceDocumentId: document.id,
        quantity: 1
      })),
      "clear-attunement-forms"
    );

    assert.equal(outputs.length, forms.length);
    for (const [index, [, expectedAttunement]] of forms.entries()) {
      assert.equal(outputs[index].system.attuned, false);
      assert.deepEqual(outputs[index].system.attunement, expectedAttunement);
    }
  }
  finally {
    fixture.restore();
  }
});

test("craft outputs clone the complete managed gear document once and initialize intact durability", async () => {
  const sourceData = {
    _id: "gear-longsword",
    name: "Longsword",
    type: "weapon",
    img: "icons/weapons/swords/longsword.webp",
    system: {
      quantity: 1,
      equipped: true,
      attuned: true,
      damage: {
        base: { number: 1, denomination: 8, types: ["slashing"] }
      },
      activities: {
        attack: {
          type: "attack",
          damage: { parts: [{ number: 1, denomination: 8, types: ["slashing"] }] }
        }
      }
    },
    effects: [{ name: "Functional source effect" }],
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "gear",
        gearId: "longsword",
        heldHands: ["left"],
        versatileBaseDamageOriginal: { number: 1, denomination: 8 }
      }
    }
  };
  const sourceDocument = {
    id: sourceData._id,
    uuid: `Compendium.world.rebreya-gear.Item.${sourceData._id}`,
    toObject: () => clone(sourceData)
  };
  const pack = {
    collection: "world.rebreya-gear",
    async getIndex() {
      return [{
        _id: sourceData._id,
        name: sourceData.name,
        flags: sourceData.flags
      }];
    },
    async getDocument(documentId) {
      return documentId === sourceData._id ? sourceDocument : null;
    }
  };
  const durabilityCalls = [];
  const group = createActor({ id: "group", type: "group", managed: true });
  const fixture = installFixture({
    group,
    actors: [group],
    packs: new Map([["world.rebreya-gear", pack]]),
    moduleApi: {
      durabilityService: {
        async initializeItem(item, options) {
          durabilityCalls.push([item.id, clone(options)]);
          await item.update({
            [`flags.${MODULE_ID}.durability`]: {
              state: "intact",
              hp: { value: 15, max: 15 }
            }
          });
        }
      }
    }
  });
  const outputs = [{ sourceType: "gear", sourceId: "longsword", quantity: 2 }];

  try {
    const first = await fixture.service.createCraftOutputsOnce(outputs, "craft-output-once");
    const retry = await fixture.service.createCraftOutputsOnce(outputs, "craft-output-once");

    assert.equal(first.length, 1);
    assert.equal(retry[0], first[0]);
    assert.equal(group.items.contents.length, 1);
    assert.equal(first[0].system.quantity, 2);
    assert.deepEqual(first[0].system.damage, sourceData.system.damage);
    assert.deepEqual(first[0].system.activities, sourceData.system.activities);
    assert.deepEqual(first[0].effects, sourceData.effects);
    assert.equal(first[0].system.equipped, false);
    assert.equal(first[0].system.attuned, false);
    assert.equal(first[0].flags[MODULE_ID].heldHands, undefined);
    assert.equal(first[0].flags[MODULE_ID].versatileBaseDamageOriginal, undefined);
    assert.equal(first[0].flags[MODULE_ID].sourceType, "gear");
    assert.equal(first[0].flags[MODULE_ID].sourceId, "longsword");
    assert.equal(first[0].flags[MODULE_ID].gearId, "longsword");
    assert.deepEqual(first[0].flags[MODULE_ID].durability, {
      state: "intact",
      hp: { value: 15, max: 15 }
    });
    assert.deepEqual(durabilityCalls, [[first[0].id, { force: true }]]);

    await assert.rejects(
      fixture.service.createCraftOutputsOnce([
        { sourceType: "magicItem", sourceId: "longsword", quantity: 1 }
      ], "craft-output-magic"),
      /magic/i
    );
    assert.equal(group.items.contents.length, 1);
  }
  finally {
    fixture.restore();
  }
});

test("craft output recovers from write-then-throw creation with frozen source and request payloads", async () => {
  const sourceData = deepFreeze({
    _id: "gear-frozen",
    name: "Frozen Payload Gear",
    type: "weapon",
    system: {
      quantity: 1,
      equipped: true,
      attuned: true,
      attunement: { value: 0, required: false }
    },
    flags: {
      [MODULE_ID]: {
        managed: true,
        sourceType: "gear",
        gearId: "frozen-gear"
      }
    }
  });
  let sourceReads = 0;
  const sourceDocument = {
    id: sourceData._id,
    uuid: `Compendium.world.rebreya-gear.Item.${sourceData._id}`,
    toObject: () => {
      sourceReads += 1;
      return sourceData;
    }
  };
  const pack = {
    collection: "world.rebreya-gear",
    async getDocument(documentId) {
      return documentId === sourceDocument.id ? sourceDocument : null;
    }
  };
  const group = createActor({
    id: "group",
    type: "group",
    managed: true,
    throwAfterCreateOnce: true
  });
  const fixture = installFixture({
    group,
    actors: [group],
    packs: new Map([["world.rebreya-gear", pack]])
  });
  const outputs = deepFreeze([{
    sourceType: "gear",
    sourceId: "frozen-gear",
    sourceDocumentId: sourceDocument.id,
    quantity: 1
  }]);

  try {
    const first = await fixture.service.createCraftOutputsOnce(outputs, "frozen-output");
    const retry = await fixture.service.createCraftOutputsOnce(outputs, "frozen-output");

    assert.equal(first.length, 1);
    assert.equal(retry[0], first[0]);
    assert.equal(sourceReads, 1);
    assert.equal(group.items.contents.length, 1);
    assert.equal(first[0].name, sourceData.name);
    assert.equal(first[0].system.equipped, false);
    assert.equal(first[0].system.attuned, false);
    assert.deepEqual(first[0].system.attunement, { value: 0, required: false });
    const record = fixture.settingsStore[SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL]
      .records.find((entry) => entry.id === "frozen-output");
    assert.deepEqual(record.request, outputs);
  }
  finally {
    fixture.restore();
  }
});

test.after(() => {
  globalThis.Actor = previousActor;
  globalThis.Item = previousItem;
});
