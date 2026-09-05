import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID, REBREYA_GROUP_FLAGS, SETTINGS_KEYS } from "../scripts/constants.js";
import { InventoryIngressPlanner } from "../scripts/application/inventory-ingress-planner.js";
import { buildInventoryIngressDescriptor } from "../scripts/data/inventory-ingress-descriptor.js";
import { InventoryIngressRuleCompilerCache } from "../scripts/data/inventory-ingress-rules.js";

const previousActor = globalThis.Actor;
const previousItem = globalThis.Item;
globalThis.Actor = class TestActorDocument {};
globalThis.Item = class TestItemDocument {};

const {
  captureInventoryTransferIdentity,
  InventoryService
} = await import(`../scripts/data/inventory-service.js?simple-transfer=${Date.now()}`);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function setProperty(source, path, value) {
  const parts = String(path ?? "").split(".");
  let cursor = source;
  for (const [index, part] of parts.entries()) {
    if (index === parts.length - 1) cursor[part] = clone(value);
    else {
      cursor[part] ??= {};
      cursor = cursor[part];
    }
  }
}

function applyPatch(source, patch) {
  for (const [path, value] of Object.entries(patch ?? {})) setProperty(source, path, value);
}

function createItem({
  id,
  name = "Item",
  quantity = 1,
  failUpdate = false,
  driftOnUpdate = null,
  throwAfterUpdateOnce = false,
  throwAfterDeleteOnce = false,
  events = []
} = {}) {
  const item = new globalThis.Item();
  let updateAckLost = false;
  let deleteAckLost = false;
  Object.assign(item, {
    id,
    _id: id,
    uuid: "",
    name,
    type: "loot",
    img: "icons/svg/item-bag.svg",
    flags: {},
    system: {
      quantity,
      price: { value: 0, denomination: "gp" },
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
      if (driftOnUpdate !== null) {
        this.system.quantity = driftOnUpdate;
        throw new Error("source quantity drifted");
      }
      events.push(`debit:update:${this.id}`);
      applyPatch(this, patch);
      if (throwAfterUpdateOnce && !updateAckLost) {
        updateAckLost = true;
        throw new Error("source update acknowledgment lost");
      }
      return this;
    },
    async delete() {
      events.push(`debit:delete:${this.id}`);
      const index = this.parent?.items?.contents?.indexOf(this) ?? -1;
      if (index >= 0) this.parent.items.contents.splice(index, 1);
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
  items = [],
  members = [],
  managed = false,
  flags: suppliedFlags = {},
  failCreate = false,
  throwAfterCreateOnce = false,
  events = []
} = {}) {
  const actor = new globalThis.Actor();
  let createAckLost = false;
  const flags = clone(suppliedFlags);
  if (managed) {
    flags[MODULE_ID] = { [REBREYA_GROUP_FLAGS.MANAGED]: true };
  }
  Object.assign(actor, {
    id,
    uuid: `Actor.${id}`,
    name: id,
    type,
    isOwner: true,
    flags,
    createEmbeddedDocumentsCalls: 0,
    system: {
      currency: { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 },
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
    async setFlag(scope, key, value) {
      this.flags[scope] ??= {};
      this.flags[scope][key.startsWith("==") ? key.slice(2) : key] = clone(value);
      return value;
    },
    async createEmbeddedDocuments(_documentName, documents) {
      if (failCreate) throw new Error("target create failed");
      this.createEmbeddedDocumentsCalls += 1;
      events.push(`credit:create:${this.id}`);
      const created = documents.map((data, index) => {
        const item = createItem({
          id: `created-${this.items.contents.length + index + 1}`,
          name: data.name,
          quantity: data.system?.quantity,
          events
        });
        item.type = data.type;
        item.img = data.img;
        item.flags = clone(data.flags ?? {});
        item.system = clone(data.system ?? {});
        item.parent = this;
        item.uuid = `${this.uuid}.Item.${item.id}`;
        this.items.contents.push(item);
        return item;
      });
      if (throwAfterCreateOnce && !createAckLost) {
        createAckLost = true;
        throw new Error("target create acknowledgment lost");
      }
      return created;
    }
  });
  for (const item of items) {
    item.parent = actor;
    item.uuid = `${actor.uuid}.Item.${item.id}`;
  }
  return actor;
}

function installFixture({ group, actors, failJournalWrite = false, uuidDocuments = new Map() } = {}) {
  const previousFoundry = globalThis.foundry;
  const previousGame = globalThis.game;
  const previousFromUuid = globalThis.fromUuid;
  const settingsStore = {
    [SETTINGS_KEYS.PARTY_STATE]: {},
    [SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL]: {}
  };
  const settingsWrites = [];
  globalThis.foundry = {
    utils: {
      deepClone: clone,
      getProperty: (source, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], source),
      setProperty,
      mergeObject: (target, source) => ({ ...clone(target), ...clone(source) }),
      flattenObject: clone
    }
  };
  const gm = { id: "gm", isGM: true, active: true };
  globalThis.game = {
    user: gm,
    users: {
      activeGM: gm,
      contents: [gm],
      get: (id) => id === gm.id ? gm : null
    },
    actors: {
      contents: actors,
      get: (id) => actors.find((actor) => actor.id === id) ?? null
    },
    packs: { get: () => null },
    settings: {
      get: (_moduleId, key) => clone(settingsStore[key]),
      async set(_moduleId, key, value) {
        if (key === SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL && failJournalWrite) {
          throw new Error("journal write failed");
        }
        settingsStore[key] = clone(value);
        settingsWrites.push({ key, value: clone(value) });
        return value;
      }
    }
  };
  globalThis.fromUuid = async (uuid) => {
    const document = uuidDocuments.get(uuid) ?? null;
    if (document instanceof globalThis.Item
      && document.parent
      && !document.parent.items.contents.includes(document)) {
      return null;
    }
    return document;
  };
  let service = null;
  const compilerCache = new InventoryIngressRuleCompilerCache();
  const planner = new InventoryIngressPlanner({
    readRules: (groupActorId) => service.getInventoryIngressRuleState({ groupActorId }),
    buildDescriptor: (itemData) => buildInventoryIngressDescriptor(itemData, {
      model: { gearById: new Map(), materialById: new Map(), materialByGoodId: new Map() }
    }),
    resolveDismantleOutputs: () => [],
    compilerCache,
    confirm: async () => ({ rootOverrideSourceKeys: [] })
  });
  const moduleApi = {
    groupContextService: {
      resolveForCurrentUser: () => ({ groupActor: group, groupId: group.id, canManage: true, members: group.system.members.map((row) => row.actor) }),
      resolveForGroup: () => ({ groupActor: group, groupId: group.id, canManage: true, members: group.system.members.map((row) => row.actor) })
    },
    inventoryIngressPlanner: planner,
    getModel: async () => ({ materialById: new Map() })
  };
  service = new InventoryService(moduleApi);
  return {
    service,
    moduleApi,
    planner,
    settingsStore,
    settingsWrites,
    restore() {
      globalThis.foundry = previousFoundry;
      globalThis.game = previousGame;
      globalThis.fromUuid = previousFromUuid;
    }
  };
}

function ingressItemData(sourceId, quantity = 1) {
  return {
    name: `Item ${sourceId}`,
    type: "loot",
    img: "icons/svg/item-bag.svg",
    system: {
      quantity,
      price: { value: 0, denomination: "gp" },
      weight: { value: 1, units: "lb" }
    },
    flags: {
      [MODULE_ID]: {
        sourceType: "gear",
        sourceId,
        gearId: sourceId
      }
    }
  };
}

async function serializeIngressPlan(planner, groupActorId, rows) {
  const preview = await planner.preview({
    groupActorId,
    requestedFolderId: null,
    rows,
    batch: rows.length > 1
  });
  return planner.serialize(preview, { rootOverrideSourceKeys: [] });
}

test("simple take moves whole and partial stacks credit-first with one terminal journal write", async () => {
  for (const { quantity, takeQuantity, expectedSourceQuantity } of [
    { quantity: 1, takeQuantity: 1, expectedSourceQuantity: null },
    { quantity: 5, takeQuantity: 2, expectedSourceQuantity: 3 }
  ]) {
    const events = [];
    const source = createItem({ id: `source-${quantity}`, name: "Rope", quantity, events });
    const hero = createActor({ id: `hero-${quantity}`, events });
    const group = createActor({
      id: `group-${quantity}`,
      type: "group",
      managed: true,
      items: [source],
      members: [{ actor: hero }],
      events
    });
    const fixture = installFixture({ group, actors: [group, hero] });

    try {
      const result = await fixture.service.takeInventoryItemToCharacter(source.id, {
        actorId: hero.id,
        quantity: takeQuantity,
        mutationId: `take-${quantity}`
      });

      assert.equal(hero.items.contents.length, 1);
      assert.equal(hero.items.contents[0].system.quantity, takeQuantity);
      assert.equal(group.items.get(source.id)?.system.quantity ?? null, expectedSourceQuantity);
      assert.equal(result.sourceActorId, group.id);
      assert.deepEqual(events.slice(0, 2), [
        `credit:create:${hero.id}`,
        `${quantity === 1 ? "debit:delete" : "debit:update"}:${source.id}`
      ]);
      const journalWrites = fixture.settingsWrites.filter((entry) => entry.key === SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL);
      assert.equal(journalWrites.length, 1);
      assert.equal(journalWrites[0].value.records[0].kind, "inventory-simple-v1");
      assert.equal(journalWrites[0].value.records[0].terminal, true);
    }
    finally {
      fixture.restore();
    }
  }
});

test("simple take confirms applied create and debit after lost acknowledgments", async () => {
  const events = [];
  const source = createItem({ id: "source", name: "Rope", quantity: 2, throwAfterUpdateOnce: true, events });
  const hero = createActor({ id: "hero", throwAfterCreateOnce: true, events });
  const group = createActor({ id: "group", type: "group", managed: true, items: [source], members: [{ actor: hero }], events });
  const fixture = installFixture({ group, actors: [group, hero] });

  try {
    const result = await fixture.service.takeInventoryItemToCharacter(source.id, {
      actorId: hero.id,
      quantity: 1,
      mutationId: "take-lost-ack"
    });

    assert.equal(result.quantity, 1);
    assert.equal(hero.items.contents.length, 1);
    assert.equal(source.system.quantity, 1);
    assert.deepEqual(events, ["credit:create:hero", "debit:update:source"]);
    assert.equal(fixture.settingsWrites.length, 1);
  }
  finally {
    fixture.restore();
  }
});

test("simple take leaves source unchanged on create failure and rolls target back on debit failure", async () => {
  const createSource = createItem({ id: "create-source", quantity: 2 });
  const createHero = createActor({ id: "create-hero", failCreate: true });
  const createGroup = createActor({ id: "create-group", type: "group", managed: true, items: [createSource], members: [{ actor: createHero }] });
  const createFixture = installFixture({ group: createGroup, actors: [createGroup, createHero] });
  try {
    await assert.rejects(createFixture.service.takeInventoryItemToCharacter(createSource.id, {
      actorId: createHero.id,
      quantity: 1,
      mutationId: "take-create-failure"
    }), /target create failed/u);
    assert.equal(createSource.system.quantity, 2);
    assert.equal(createHero.items.contents.length, 0);
    assert.equal(createFixture.settingsWrites.length, 1);
  }
  finally {
    createFixture.restore();
  }

  const debitSource = createItem({ id: "debit-source", quantity: 2, failUpdate: true });
  const debitHero = createActor({ id: "debit-hero" });
  const debitGroup = createActor({ id: "debit-group", type: "group", managed: true, items: [debitSource], members: [{ actor: debitHero }] });
  const debitFixture = installFixture({ group: debitGroup, actors: [debitGroup, debitHero] });
  try {
    await assert.rejects(debitFixture.service.takeInventoryItemToCharacter(debitSource.id, {
      actorId: debitHero.id,
      quantity: 1,
      mutationId: "take-debit-failure"
    }), (error) => error?.code === "transfer-failed-compensated");
    assert.equal(debitSource.system.quantity, 2);
    assert.equal(debitHero.items.contents.length, 0);
    assert.equal(debitFixture.settingsWrites.length, 1);
  }
  finally {
    debitFixture.restore();
  }
});

test("simple take preserves the exact target when the source drifts during debit", async () => {
  const source = createItem({ id: "drift-source", quantity: 3, driftOnUpdate: 7 });
  const hero = createActor({ id: "drift-hero" });
  const group = createActor({
    id: "drift-group",
    type: "group",
    managed: true,
    items: [source],
    members: [{ actor: hero }]
  });
  const fixture = installFixture({ group, actors: [group, hero] });

  try {
    await assert.rejects(
      fixture.service.takeInventoryItemToCharacter(source.id, {
        actorId: hero.id,
        quantity: 1,
        mutationId: "take-source-drift"
      }),
      (error) => error?.code === "transfer-manual-review"
    );
    assert.equal(source.system.quantity, 7);
    assert.equal(hero.items.contents.length, 1);
  }
  finally {
    fixture.restore();
  }
});

test("simple ingress writes one terminal inventory outcome for 1, 20 and 100 rows", async () => {
  for (const rowCount of [1, 20, 100]) {
    const group = createActor({ id: `ingress-group-${rowCount}`, type: "group", managed: true });
    const fixture = installFixture({ group, actors: [group] });
    const rows = Array.from({ length: rowCount }, (_unused, index) => ({
      sourceKey: `row-${index + 1}`,
      quantity: 1,
      itemData: ingressItemData(`source-${index + 1}`),
      legacyFolderId: null,
      container: null
    }));
    const debited = [];

    try {
      const serializedPlan = await serializeIngressPlan(fixture.planner, group.id, rows);
      const result = await fixture.service.commitInventoryIngressBatch({
        groupActorId: group.id,
        batchMutationId: `batch-${rowCount}`,
        sourceOrigin: "import",
        serializedPlan
      }, {
        resolveRows: async () => clone(rows),
        debitRow: async (row) => debited.push(row.sourceKey)
      });

      assert.equal(result.rows.length, rowCount);
      assert.equal(group.items.contents.length, rowCount);
      assert.deepEqual(debited, rows.map((row) => row.sourceKey));
      const journalWrites = fixture.settingsWrites.filter((entry) => entry.key === SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL);
      assert.equal(journalWrites.length, 1);
      assert.equal(journalWrites[0].value.records.length, 1);
      assert.equal(journalWrites[0].value.records[0].kind, "inventory-simple-v1");
    }
    finally {
      fixture.restore();
    }
  }
});

test("simple ingress resolves its authoritative source only after entering the inventory queue", async () => {
  const group = createActor({ id: "queued-ingress-group", type: "group", managed: true });
  const fixture = installFixture({ group, actors: [group] });
  const rows = [{
    sourceKey: "queued-row",
    quantity: 1,
    itemData: ingressItemData("queued-source"),
    legacyFolderId: null,
    container: null
  }];
  let releaseQueue;
  let markQueueStarted;
  const queueStarted = new Promise((resolve) => {
    markQueueStarted = resolve;
  });
  let resolveCalls = 0;
  let blocker;
  let pending;

  try {
    const serializedPlan = await serializeIngressPlan(fixture.planner, group.id, rows);
    blocker = fixture.service.mutationCoordinator.run("inventory", () => {
      markQueueStarted();
      return new Promise((resolve) => {
        releaseQueue = resolve;
      });
    });
    await queueStarted;
    pending = fixture.service.commitInventoryIngressBatch({
      groupActorId: group.id,
      batchMutationId: "queued-ingress",
      sourceOrigin: "import",
      serializedPlan
    }, {
      resolveRows: async () => {
        resolveCalls += 1;
        return clone(rows);
      },
      debitRow: async () => {}
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(resolveCalls, 0);

    releaseQueue();
    await blocker;
    const result = await pending;
    assert.equal(resolveCalls, 1);
    assert.equal(result.changed, true);
  }
  finally {
    releaseQueue?.();
    await Promise.allSettled([blocker, pending].filter(Boolean));
    fixture.restore();
  }
});

test("simple ingress does not evict an active execution while completed results are bounded", async () => {
  const group = createActor({ id: "bounded-ingress-group", type: "group", managed: true });
  const fixture = installFixture({ group, actors: [group], failJournalWrite: true });
  const firstRows = [{
    sourceKey: "bounded-first-row",
    quantity: 1,
    itemData: ingressItemData("bounded-first-source"),
    legacyFolderId: null,
    container: null
  }];
  const overflowRows = [{
    sourceKey: "bounded-overflow-row",
    quantity: 1,
    itemData: ingressItemData("bounded-overflow-source"),
    legacyFolderId: null,
    container: null
  }];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  let firstDebitCalls = 0;

  try {
    const firstRequest = {
      groupActorId: group.id,
      batchMutationId: "bounded-first",
      sourceOrigin: "storage",
      serializedPlan: await serializeIngressPlan(fixture.planner, group.id, firstRows)
    };
    const firstCallbacks = {
      resolveRows: async () => {
        await firstGate;
        return clone(firstRows);
      },
      debitRow: async () => { firstDebitCalls += 1; }
    };
    const first = fixture.service.commitInventoryIngressBatch(firstRequest, firstCallbacks);
    await new Promise((resolve) => setImmediate(resolve));

    for (let index = 0; index < 255; index += 1) {
      fixture.service.simpleIngressExecutions.set(`held-${index}`, {
        fingerprint: `held-${index}`,
        promise: new Promise(() => {}),
        settled: false
      });
    }

    const overflowRequest = {
      groupActorId: group.id,
      batchMutationId: "bounded-overflow",
      sourceOrigin: "storage",
      serializedPlan: await serializeIngressPlan(fixture.planner, group.id, overflowRows)
    };
    const overflow = fixture.service.commitInventoryIngressBatch(overflowRequest, {
      resolveRows: async () => clone(overflowRows),
      debitRow: async () => {}
    });
    await new Promise((resolve) => setImmediate(resolve));
    const duplicate = fixture.service.commitInventoryIngressBatch(firstRequest, firstCallbacks);

    releaseFirst();
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
    await overflow;

    assert.deepEqual(duplicateResult, firstResult);
    assert.equal(firstDebitCalls, 1);
  }
  finally {
    releaseFirst?.();
    fixture.restore();
  }
});

test("simple ingress transient failure does not evict a retained simple outcome", async () => {
  const group = createActor({ id: "transient-ingress-group", type: "group", managed: true });
  const fixture = installFixture({ group, actors: [group] });
  const rows = [{
    sourceKey: "transient-row",
    quantity: 1,
    itemData: ingressItemData("transient-source"),
    legacyFolderId: null,
    container: null
  }];

  try {
    for (let index = 0; index < 256; index += 1) {
      fixture.service.simpleIngressExecutions.set(`retained-${index}`, {
        fingerprint: `retained-${index}`,
        promise: Promise.resolve({ mode: "simple", value: { auditPersisted: false } }),
        settled: true
      });
    }
    const request = {
      groupActorId: group.id,
      batchMutationId: "transient-preflight",
      sourceOrigin: "storage",
      serializedPlan: await serializeIngressPlan(fixture.planner, group.id, rows)
    };

    await assert.rejects(
      fixture.service.commitInventoryIngressBatch(request, {
        resolveRows: async () => { throw new Error("source unavailable"); },
        debitRow: async () => {}
      }),
      /source unavailable/u
    );

    assert.equal(fixture.service.simpleIngressExecutions.has("retained-0"), true);
    assert.equal(fixture.service.simpleIngressExecutions.has("transient-preflight"), false);
  }
  finally {
    fixture.restore();
  }
});

test("simple ingress stops on the first failed row, rolls it back and replays the partial outcome", async () => {
  const group = createActor({ id: "partial-group", type: "group", managed: true });
  const fixture = installFixture({ group, actors: [group] });
  const rows = ["first", "failed", "later"].map((sourceKey) => ({
    sourceKey,
    quantity: 1,
    itemData: ingressItemData(sourceKey),
    legacyFolderId: null,
    container: null
  }));
  const debited = [];
  let resolveCalls = 0;

  try {
    const serializedPlan = await serializeIngressPlan(fixture.planner, group.id, rows);
    const request = {
      groupActorId: group.id,
      batchMutationId: "partial-batch",
      sourceOrigin: "storage",
      serializedPlan
    };
    const callbacks = {
      resolveRows: async () => {
        resolveCalls += 1;
        return clone(rows);
      },
      debitRow: async (row) => {
        debited.push(row.sourceKey);
        if (row.sourceKey === "failed") throw new Error("source debit failed");
      }
    };

    let firstError;
    await assert.rejects(
      fixture.service.commitInventoryIngressBatch(request, callbacks),
      (error) => {
        firstError = error;
        return error?.code === "inventory-ingress-partial"
          && error?.failedSourceKey === "failed"
          && JSON.stringify(error?.completedSourceKeys) === JSON.stringify(["first"])
          && JSON.stringify(error?.unprocessedSourceKeys) === JSON.stringify(["later"]);
      }
    );
    assert.deepEqual(group.items.contents.map((item) => item.name), ["Item first"]);
    assert.deepEqual(debited, ["first", "failed"]);
    assert.equal(fixture.settingsWrites.length, 1);

    await assert.rejects(
      fixture.service.commitInventoryIngressBatch(request, callbacks),
      (error) => error?.code === firstError.code
        && error?.failedSourceKey === firstError.failedSourceKey
        && JSON.stringify(error?.completedSourceKeys) === JSON.stringify(firstError.completedSourceKeys)
    );
    assert.equal(resolveCalls, 1);
    assert.deepEqual(debited, ["first", "failed"]);
    assert.deepEqual(group.items.contents.map((item) => item.name), ["Item first"]);
  }
  finally {
    fixture.restore();
  }
});

test("simple ingress keeps a drifted merge target for manual review instead of overwriting it", async () => {
  const existing = createItem({ id: "merge-drift-target", name: "Item merge-drift", quantity: 2 });
  existing.flags = clone(ingressItemData("merge-drift").flags);
  existing.system = clone(ingressItemData("merge-drift", 2).system);
  const group = createActor({ id: "merge-drift-group", type: "group", managed: true, items: [existing] });
  const fixture = installFixture({ group, actors: [group] });
  const rows = [{
    sourceKey: "merge-drift-row",
    quantity: 1,
    itemData: ingressItemData("merge-drift"),
    legacyFolderId: null,
    container: null
  }];

  try {
    const serializedPlan = await serializeIngressPlan(fixture.planner, group.id, rows);
    await assert.rejects(
      fixture.service.commitInventoryIngressBatch({
        groupActorId: group.id,
        batchMutationId: "merge-drift-batch",
        sourceOrigin: "import",
        serializedPlan
      }, {
        resolveRows: async () => clone(rows),
        debitRow: async () => {
          existing.system.quantity = 9;
          throw new Error("source debit failed after target drift");
        }
      }),
      (error) => error?.code === "transfer-manual-review"
        && error?.failedSourceKey === "merge-drift-row"
    );
    assert.equal(existing.system.quantity, 9);
    assert.equal(group.items.contents.length, 1);
  }
  finally {
    fixture.restore();
  }
});

test("simple ingress does not resume an orphaned target after restart without a terminal outcome", async () => {
  const group = createActor({ id: "orphan-group", type: "group", managed: true });
  const fixture = installFixture({ group, actors: [group], failJournalWrite: true });
  const rows = [{
    sourceKey: "orphan-row",
    quantity: 1,
    itemData: ingressItemData("orphan-source"),
    legacyFolderId: null,
    container: null
  }];
  let debitCalls = 0;

  try {
    const serializedPlan = await serializeIngressPlan(fixture.planner, group.id, rows);
    const request = {
      groupActorId: group.id,
      batchMutationId: "orphan-batch",
      sourceOrigin: "storage",
      serializedPlan
    };
    const callbacks = {
      resolveRows: async () => clone(rows),
      debitRow: async () => { debitCalls += 1; }
    };

    const first = await fixture.service.commitInventoryIngressBatch(request, callbacks);
    const inProcessRetry = await fixture.service.commitInventoryIngressBatch(request, callbacks);
    assert.equal(first.auditPersisted, false);
    assert.deepEqual(inProcessRetry, first);
    assert.equal(debitCalls, 1);
    assert.equal(group.items.contents.length, 1);

    const restarted = new InventoryService(fixture.moduleApi);
    await assert.rejects(
      restarted.commitInventoryIngressBatch(request, callbacks),
      (error) => error?.code === "transfer-manual-review"
        && error?.failedSourceKey === "orphan-row"
    );
    assert.equal(debitCalls, 1);
    assert.equal(group.items.contents.length, 1);
  }
  finally {
    fixture.restore();
  }
});

test("simple native drag depletes the source once and records one terminal outcome", async () => {
  const source = createItem({ id: "drag-source", name: "Rope", quantity: 1 });
  const hero = createActor({ id: "drag-hero" });
  const group = createActor({
    id: "drag-group",
    type: "group",
    managed: true,
    items: [source],
    members: [{ actor: hero }]
  });
  const [target] = await hero.createEmbeddedDocuments("Item", [{
    ...source.toObject(),
    _id: undefined,
    system: { ...clone(source.system), quantity: 1 }
  }]);
  const uuidDocuments = new Map([
    [source.uuid, source],
    [target.uuid, target],
    [hero.uuid, hero]
  ]);
  const fixture = installFixture({ group, actors: [group, hero], uuidDocuments });
  const payload = {
    transferId: "native-drag-1",
    sourceItemUuid: source.uuid,
    targetItemUuid: target.uuid,
    targetActorUuid: hero.uuid,
    expectedIdentity: captureInventoryTransferIdentity(source),
    expectedQuantity: 1,
    targetReceipt: {
      targetItemUuid: target.uuid,
      created: true,
      beforeQuantity: 0,
      afterQuantity: 1,
      delta: 1
    }
  };

  try {
    const result = await fixture.service.handlePartyInventorySourceDepletionSocketRequest(payload, {
      senderId: "gm"
    });
    const replay = await fixture.service.handlePartyInventorySourceDepletionSocketRequest(payload, {
      senderId: "gm"
    });

    assert.deepEqual(replay, result);
    assert.equal(group.items.get(source.id), null);
    assert.equal(hero.items.contents.length, 1);
    assert.equal(hero.createEmbeddedDocumentsCalls, 1);
    assert.equal(result.actorId, group.id);
    assert.equal(result.targetActorId, hero.id);
    const journalWrites = fixture.settingsWrites.filter((entry) => entry.key === SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL);
    assert.equal(journalWrites.length, 1);
    assert.equal(journalWrites[0].value.records[0].kind, "inventory-simple-v1");
  }
  finally {
    fixture.restore();
  }
});

test("simple take deduplicates concurrent ids, serializes distinct ids and rejects payload conflicts", async () => {
  const source = createItem({ id: "concurrent-source", quantity: 2 });
  const hero = createActor({ id: "concurrent-hero" });
  const group = createActor({ id: "concurrent-group", type: "group", managed: true, items: [source], members: [{ actor: hero }] });
  const fixture = installFixture({ group, actors: [group, hero] });

  try {
    const exact = {
      actorId: hero.id,
      quantity: 1,
      mutationId: "concurrent-same"
    };
    const [first, joined] = await Promise.all([
      fixture.service.takeInventoryItemToCharacter(source.id, exact),
      fixture.service.takeInventoryItemToCharacter(source.id, exact)
    ]);
    assert.deepEqual(joined, first);
    assert.equal(source.system.quantity, 1);
    assert.equal(hero.items.contents.length, 1);

    await assert.rejects(
      fixture.service.takeInventoryItemToCharacter(source.id, {
        ...exact,
        quantity: 2
      }),
      (error) => error?.code === "mutation-conflict"
    );

    const second = await fixture.service.takeInventoryItemToCharacter(source.id, {
      actorId: hero.id,
      quantity: 1,
      mutationId: "concurrent-distinct"
    });
    assert.equal(second.quantity, 1);
    assert.equal(group.items.get(source.id), null);
    assert.equal(hero.items.contents.length, 2);
    assert.equal(fixture.settingsWrites.length, 2);
  }
  finally {
    fixture.restore();
  }
});

test("simple take keeps a successful outcome in memory when terminal audit persistence fails", async () => {
  const source = createItem({ id: "audit-source", quantity: 1 });
  const hero = createActor({ id: "audit-hero" });
  const group = createActor({ id: "audit-group", type: "group", managed: true, items: [source], members: [{ actor: hero }] });
  const fixture = installFixture({ group, actors: [group, hero], failJournalWrite: true });
  const request = { actorId: hero.id, quantity: 1, mutationId: "audit-failure" };

  try {
    const first = await fixture.service.takeInventoryItemToCharacter(source.id, request);
    const retry = await fixture.service.takeInventoryItemToCharacter(source.id, request);

    assert.equal(first.auditPersisted, false);
    assert.match(first.auditWarning, /journal write failed/u);
    assert.deepEqual(retry, first);
    assert.equal(group.items.get(source.id), null);
    assert.equal(hero.items.contents.length, 1);
  }
  finally {
    fixture.restore();
  }
});

test("simple take replays a persisted terminal outcome in a new service without resolving the deleted source", async () => {
  const source = createItem({ id: "persisted-source", quantity: 1 });
  const hero = createActor({ id: "persisted-hero" });
  const group = createActor({ id: "persisted-group", type: "group", managed: true, items: [source], members: [{ actor: hero }] });
  const fixture = installFixture({ group, actors: [group, hero] });
  const request = { actorId: hero.id, quantity: 1, mutationId: "persisted-outcome" };

  try {
    const first = await fixture.service.takeInventoryItemToCharacter(source.id, request);
    const restartedService = new InventoryService(fixture.moduleApi);
    const replay = await restartedService.takeInventoryItemToCharacter(source.id, request);

    assert.deepEqual(replay, first);
    assert.equal(hero.items.contents.length, 1);
    assert.equal(fixture.settingsWrites.length, 1);
  }
  finally {
    fixture.restore();
  }
});

test("simple take without a terminal record after restart requires manual review", async () => {
  const source = createItem({ id: "unknown-source", quantity: 1 });
  const hero = createActor({ id: "unknown-hero" });
  const group = createActor({ id: "unknown-group", type: "group", managed: true, items: [source], members: [{ actor: hero }] });
  const fixture = installFixture({ group, actors: [group, hero], failJournalWrite: true });
  const request = { actorId: hero.id, quantity: 1, mutationId: "unknown-outcome" };

  try {
    await fixture.service.takeInventoryItemToCharacter(source.id, request);
    const restartedService = new InventoryService(fixture.moduleApi);
    await assert.rejects(
      restartedService.takeInventoryItemToCharacter(source.id, request),
      (error) => error?.code === "transfer-manual-review"
    );
    assert.equal(hero.items.contents.length, 1);
  }
  finally {
    fixture.restore();
  }
});

test.after(() => {
  globalThis.Actor = previousActor;
  globalThis.Item = previousItem;
});
