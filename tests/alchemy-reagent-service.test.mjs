import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildAlchemyActivities } from "../scripts/data/alchemy-automation.js";
import { WorldSettingMutationRepository } from "../scripts/infrastructure/foundry/world-setting-mutation-repository.js";
import {
  AlchemyReagentService, calculateActiveReagentTotal, registerAlchemyReagentSettings, resolveAlchemyPotionUse
} from "../scripts/data/alchemy-reagent-service.js";

const MODULE = "rebreya-main";
const catalog = JSON.parse(await readFile(new URL("../data/alchemy-products.json", import.meta.url), "utf8"));
const product = catalog.find((entry) => entry.id === "alchemy-1");
const drinkActivityId = Object.keys(buildAlchemyActivities(product))[0];

test("the GM receipt journal is a hidden world setting", () => {
  const calls = [];
  registerAlchemyReagentSettings({ settings: { register: (...args) => calls.push(args) } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], MODULE);
  assert.equal(calls[0][1], "alchemyReagentJournal");
  assert.deepEqual(calls[0][2], { scope: "world", config: false, type: Object, default: { version: 1, records: {} } });
});

function effect(level, expiresAt, extra = {}) {
  return { disabled: false, flags: { [MODULE]: { alchemyReagent: { level, expiresAt } } }, ...extra };
}

test("active reagent total sums only enabled, unexpired managed effects", () => {
  const actor = { effects: { contents: [effect(3, 160), effect(1, 160), effect(7, 100),
    effect(5, 200, { disabled: true }), effect(9, 200, { isSuppressed: true }), { flags: {} }] } };
  assert.equal(calculateActiveReagentTotal(actor, 100), 4);
  assert.equal(calculateActiveReagentTotal(actor, 160), 0);
  actor.effects.contents[0].disabled = true;
  assert.equal(calculateActiveReagentTotal(actor, 101), 1);
});

test("world-time refresh includes Foundry ApplicationV2 actor sheets", () => {
  const previous = { ui: globalThis.ui, foundry: globalThis.foundry };
  const actor = { effects: { contents: [effect(2, 160)] } };
  const calls = [];
  const app = { actor, render(options) { calls.push(options); } };
  globalThis.ui = { windows: {} };
  globalThis.foundry = { applications: { instances: new Map([["sheet", app]]) } };
  try {
    new AlchemyReagentService({ game: { time: { worldTime: 100 } } }).refreshOpenSheets();
    assert.equal(calls.length, 1);
  }
  finally {
    globalThis.ui = previous.ui;
    globalThis.foundry = previous.foundry;
  }
});

test("authored fixed, random and choice durations preserve zero and cancellation", async () => {
  assert.deepEqual(await resolveAlchemyPotionUse(product), { reagentLevel: 2, durationSeconds: 60 });
  let rolls = 0;
  assert.deepEqual(await resolveAlchemyPotionUse({ ...product, duration: "1к4 часа" }, {
    rollHours: async () => { rolls += 1; return 3; }
  }), { reagentLevel: 2, durationSeconds: 10800 });
  assert.equal(rolls, 1);
  assert.deepEqual(await resolveAlchemyPotionUse({ ...product, duration: "Мгновенно или 1 час" }, {
    chooseDuration: async () => 0
  }), { reagentLevel: 2, durationSeconds: 0 });
  assert.deepEqual(await resolveAlchemyPotionUse({ ...product, reagentLevel: null }, {
    askReagentLevel: async () => 0
  }), { reagentLevel: 0, durationSeconds: 60 });
  assert.equal(await resolveAlchemyPotionUse({ ...product, reagentLevel: null }, {
    askReagentLevel: async () => null
  }), null);
});

test("native DialogV2 cancel action is treated as cancellation for both prompts", async () => {
  const previous = globalThis.foundry;
  globalThis.foundry = { applications: { api: { DialogV2: { wait: async () => "cancel" } } } };
  try {
    assert.equal(await resolveAlchemyPotionUse({ ...product, duration: "Мгновенно или 1 час" }), null);
    assert.equal(await resolveAlchemyPotionUse({ ...product, reagentLevel: null }), null);
  }
  finally {
    globalThis.foundry = previous;
  }
});

test("pre-use records exactly one selected drinker and rejects missing or multiple targets", () => {
  const source = { uuid: "Actor.source", id: "source" };
  const target = { uuid: "Actor.target" };
  const activity = { id: drinkActivityId, actor: source, item: { id: "item1" }, flags: { [MODULE]: {
    alchemyAutomation: { kind: "potion", productId: product.id },
    alchemyReagent: { reagentLevel: 2, duration: "1 минута" }
  } } };
  const game = { user: { targets: new Set([{ actor: target }]) } };
  const service = new AlchemyReagentService({ game });
  const usage = {};
  const message = { data: { flags: {} } };
  assert.equal(service.handlePreUse(activity, usage, {}, message), true);
  assert.deepEqual(message.data.flags[MODULE].alchemyPotionUse, {
    sourceActorUuid: source.uuid, targetActorUuid: target.uuid, productId: product.id,
    durationSeconds: 60, reagentLevel: 2
  });
  game.user.targets = new Set();
  assert.equal(service.handlePreUse(activity, {}, {}, { data: { flags: {} } }), false);
  game.user.targets = new Set([{ actor: target }, { actor: { uuid: "Actor.other" } }]);
  assert.equal(service.handlePreUse(activity, {}, {}, { data: { flags: {} } }), false);
});

test("pre-use reads a changed reagent level from the actual owned potion", () => {
  const target = { uuid: "Actor.target" };
  const activity = { id: drinkActivityId, actor: { uuid: "Actor.source" }, item: {
    id: "item1", flags: { [MODULE]: { reagentLevel: 5 } }
  }, flags: { [MODULE]: {
    alchemyAutomation: { kind: "potion", productId: product.id },
    alchemyReagent: { reagentLevel: 2, duration: "1 минута" }
  } } };
  const service = new AlchemyReagentService({ game: { user: { targets: new Set([{ actor: target }]) } } });
  const message = { data: { flags: {} } };
  assert.equal(service.handlePreUse(activity, {}, {}, message), true);
  assert.equal(message.data.flags[MODULE].alchemyPotionUse.reagentLevel, 5);
});

test("a cloned belt potion consumes its own quantity instead of the original stack", () => {
  const consumption = { type: "material", target: "original", updateSource(change) { this.target = change.target; } };
  const activity = { item: { id: "belt-copy" }, flags: { [MODULE]: { alchemyConsumeOwnQuantity: true } },
    consumption: { targets: [consumption] } };
  const service = new AlchemyReagentService({ game: {} });
  assert.equal(service.handlePreConsumption(activity), true);
  assert.equal(consumption.target, "belt-copy");
});

test("cancelling a duration choice does not resume or consume the potion", async () => {
  const pending = [];
  let resumed = 0;
  const target = { uuid: "Actor.target" };
  const source = { uuid: "Actor.source", id: "source", items: { get: () => ({ system: {
    activities: { get: () => ({ use: async () => { resumed += 1; } }) }
  } }) } };
  const activity = { id: drinkActivityId, actor: source, item: { id: "item1" }, flags: { [MODULE]: {
    alchemyAutomation: { kind: "potion", productId: product.id },
    alchemyReagent: { reagentLevel: 2, duration: "Мгновенно или 1 час" }
  } } };
  const service = new AlchemyReagentService({ game: { user: { targets: new Set([{ actor: target }]) } },
    chooseDuration: async () => null, schedule: (operation) => pending.push(operation()) });
  assert.equal(service.handlePreUse(activity, {}, {}, { data: { flags: {} } }), false);
  await Promise.all(pending);
  assert.equal(resumed, 0);
});

test("a selected duration resumes the original activity once with the same target and parameters", async () => {
  const pending = [];
  const target = { uuid: "Actor.target" };
  const game = { user: { targets: new Set([{ actor: target }]) } };
  let resumedMessage;
  let resumed = 0;
  const source = { uuid: "Actor.source", id: "source" };
  const activity = { id: drinkActivityId, actor: source, item: { id: "item1" }, flags: { [MODULE]: {
    alchemyAutomation: { kind: "potion", productId: product.id },
    alchemyReagent: { reagentLevel: 2, duration: "Мгновенно или 1 час" }
  } } };
  let service;
  const original = { async use(usage, dialog, message) {
    resumed += 1;
    resumedMessage = message;
    assert.equal(service.handlePreUse(activity, usage, dialog, message), true);
  } };
  source.items = { get: () => ({ system: { activities: { get: () => original } } }) };
  service = new AlchemyReagentService({ game, chooseDuration: async () => 3600,
    schedule: (operation) => pending.push(operation()) });
  assert.equal(service.handlePreUse(activity, {}, {}, { data: { flags: {} } }), false);
  await Promise.all(pending);
  assert.equal(resumed, 1);
  assert.equal(resumedMessage.data.flags[MODULE].alchemyPotionUse.durationSeconds, 3600);
  assert.equal(resumedMessage.data.flags[MODULE].alchemyPotionUse.targetActorUuid, target.uuid);
});

test("a foreign-target use obtains GM reservation before resuming the activity", async () => {
  const pending = [];
  const reserved = [];
  const target = { uuid: "Actor.target", isOwner: false };
  const token = { actor: target, document: { uuid: "Scene.scene1.Token.target1" } };
  const gm = { id: "gm", active: true, isGM: true };
  const game = { user: { id: "player", targets: new Set([token]) }, users: { activeGM: gm } };
  const source = { uuid: "Actor.source", id: "source" };
  const activity = { id: drinkActivityId, actor: source, item: { id: "item1" }, flags: { [MODULE]: {
    alchemyAutomation: { kind: "potion", productId: product.id },
    alchemyReagent: { reagentLevel: 2, duration: "1 минута" }
  } } };
  let service;
  let resumedMessage;
  source.items = { get: () => ({ system: { activities: { get: () => ({ async use(usage, dialog, message) {
    resumedMessage = message;
    assert.equal(service.handlePreUse(activity, usage, dialog, message), true);
    return { message: {} };
  } }) } } }) };
  service = new AlchemyReagentService({ game, operationIdFactory: () => "op1",
    reservationRequester: async (payload) => { reserved.push(payload); return { status: "reserved" }; },
    schedule: (operation) => pending.push(operation()) });
  assert.equal(service.handlePreUse(activity, {}, {}, { data: { flags: {} } }), false);
  await Promise.all(pending);
  assert.equal(reserved.length, 1);
  assert.equal(reserved[0].sourceItemId, "item1");
  assert.equal(reserved[0].targetTokenUuid, token.document.uuid);
  assert.equal(resumedMessage.data.flags[MODULE].alchemyPotionUse.reservationId, "op1");
});

test("an instantaneous potion does not require a GM-only reagent operation", () => {
  const target = { uuid: "Actor.target", isOwner: false };
  const activity = { id: drinkActivityId, actor: { uuid: "Actor.source" }, item: { id: "item1" }, flags: { [MODULE]: {
    alchemyAutomation: { kind: "potion", productId: product.id },
    alchemyReagent: { reagentLevel: 2, duration: "Мгновенно" }
  } } };
  const service = new AlchemyReagentService({ game: { user: { id: "player", targets: new Set([{ actor: target }]) } } });
  assert.equal(service.handlePreUse(activity, {}, {}, { data: { flags: {} } }), true);
});

function fixture() {
  const sender = { id: "player", isGM: false };
  const source = {
    uuid: "Actor.source", id: "source", items: { contents: [], get: () => null },
    testUserPermission(user) { return user.id === sender.id; }
  };
  const target = {
    uuid: "Actor.target", id: "target", flags: {}, effects: { contents: [] },
    testUserPermission(user) { return user.id === sender.id; },
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    async setFlag(scope, key, value) {
      const parts = key.split(".");
      let current = this.flags[scope] ??= {};
      for (const part of parts.slice(0, -1)) current = current[part] ??= {};
      current[parts.at(-1)] = structuredClone(value);
    },
    async createEmbeddedDocuments(type, rows) {
      assert.equal(type, "ActiveEffect");
      const created = rows.map((row) => structuredClone(row));
      this.effects.contents.push(...created);
      return created;
    }
  };
  const itemFlags = { managed: true, sourceType: "alchemyProduct", alchemyProductId: product.id,
    sourceNumber: product.sourceNumber, productType: product.productType, rank: product.rank };
  const message = {
    uuid: "ChatMessage.message1", id: "message1", author: sender,
    flags: {
      dnd5e: {
        item: { id: "item1", uuid: "Actor.source.Item.item1" },
        activity: { id: drinkActivityId }, targets: [{ uuid: target.uuid }],
        use: { consumed: { deleted: [{ _id: "item1", type: "consumable", flags: { [MODULE]: itemFlags } }] } }
      },
      [MODULE]: { alchemyPotionUse: {
        sourceActorUuid: source.uuid, targetActorUuid: target.uuid, productId: product.id,
        durationSeconds: 60, reagentLevel: 2
      } }
    }
  };
  const lookup = new Map([[source.uuid, source], [target.uuid, target], [message.uuid, message]]);
  const options = { fromUuid: async (uuid) => lookup.get(uuid) ?? null,
    getProduct: async (id) => catalog.find((entry) => entry.id === id),
    game: { time: { worldTime: 100 }, user: sender } };
  return { sender, source, target, message, options };
}

test("a completed use records one effect on the selected target even after replay or reload", async () => {
  const { sender, target, message, options } = fixture();
  const service = new AlchemyReagentService(options);
  await Promise.all([service.applyRecordedUse(message, { sender }), service.applyRecordedUse(message, { sender })]);
  assert.equal(target.effects.contents.length, 1);
  assert.equal(calculateActiveReagentTotal(target, 100), 2);
  assert.equal(calculateActiveReagentTotal(target, 160), 0);
  target.effects.contents = [];
  await new AlchemyReagentService(options).applyRecordedUse(message, { sender });
  assert.equal(target.effects.contents.length, 0);
});

test("MIDI uses wait for the same workflow to complete before sending one mutation", async () => {
  const { message, target, options } = fixture();
  target.isOwner = false;
  const calls = [];
  const service = new AlchemyReagentService({ ...options, mutationRequester: async (payload) => calls.push(payload) });
  const workflow = {};
  await service.handleUse({}, { workflow }, { message });
  assert.deepEqual(calls, []);
  await service.handleMidiComplete({});
  assert.deepEqual(calls, []);
  await service.handleMidiComplete(workflow);
  await service.handleMidiComplete(workflow);
  assert.deepEqual(calls, [{ messageUuid: message.uuid }]);
});

test("an aborted MIDI workflow cancels its unused GM reservation", async () => {
  const { message, options } = fixture();
  message.flags[MODULE].alchemyPotionUse.reservationId = "op1";
  const cancellations = [];
  const service = new AlchemyReagentService({ ...options, cancellationRequester: async (id) => cancellations.push(id) });
  const workflow = {};
  await service.handleUse({}, { workflow }, { message });
  await service.handleMidiAbort(workflow);
  await service.handleMidiComplete(workflow);
  assert.deepEqual(cancellations, ["op1"]);
});

test("unconsumed, cancelled, forged-target and unauthorized uses do not mutate the actor", async () => {
  const { sender, target, message, options } = fixture();
  const service = new AlchemyReagentService(options);
  const forged = structuredClone(message);
  forged.flags[MODULE].alchemyPotionUse.targetActorUuid = "Actor.other";
  await assert.rejects(() => service.applyRecordedUse(forged, { sender }));
  const unconsumed = structuredClone(message);
  delete unconsumed.flags.dnd5e.use.consumed;
  await assert.rejects(() => service.applyRecordedUse(unconsumed, { sender }));
  const forgedLevel = structuredClone(message);
  forgedLevel.flags[MODULE].alchemyPotionUse.reagentLevel = 9;
  await assert.rejects(() => service.applyRecordedUse(forgedLevel, { sender }));
  await assert.rejects(() => service.applyRecordedUse(message, { sender: { id: "stranger", isGM: false } }));
  assert.equal(target.effects.contents.length, 0);
});

test("a stack decrement is accepted and independent uses add their reagent levels", async () => {
  const { sender, source, target, message, options } = fixture();
  const data = message.flags.dnd5e.use.consumed.deleted[0];
  source.items.get = (id) => id === "item1" ? { ...data, id: "item1" } : null;
  message.flags.dnd5e.use.consumed = { item: { item1: [{ keyPath: "system.quantity", delta: -1 }] } };
  const other = structuredClone(message);
  other.id = "message2";
  other.uuid = "ChatMessage.message2";
  const service = new AlchemyReagentService(options);
  await Promise.all([service.applyRecordedUse(message, { sender }), service.applyRecordedUse(other, { sender })]);
  assert.equal(calculateActiveReagentTotal(target, 100), 4);
  assert.deepEqual(Object.keys(target.flags[MODULE].alchemyReagentOperations).sort(), ["message1", "message2"]);
});

test("an explicitly adjusted reagent level on the used item remains authoritative", async () => {
  const { sender, target, message, options } = fixture();
  message.flags.dnd5e.use.consumed.deleted[0].flags[MODULE].reagentLevel = 5;
  message.flags[MODULE].alchemyPotionUse.reagentLevel = 5;
  await new AlchemyReagentService(options).applyRecordedUse(message, { sender });
  assert.equal(calculateActiveReagentTotal(target, 100), 5);
});

function foreignFixture() {
  const setup = fixture();
  const { sender, source, target, message, options } = setup;
  target.testUserPermission = () => false;
  target.isOwner = false;
  const itemData = message.flags.dnd5e.use.consumed.deleted[0];
  const item = { ...structuredClone(itemData), id: "item1", parent: source,
    system: { quantity: 1, activities: buildAlchemyActivities(product) } };
  source.items = { contents: [item], get(id) { return this.contents.find((entry) => entry.id === id) ?? null; } };
  const scene = { id: "scene1", tokens: { contents: [] } };
  const targetToken = { uuid: "Scene.scene1.Token.target1", actor: target, parent: scene, hidden: false };
  const sourceToken = { uuid: "Scene.scene1.Token.source1", actor: source, parent: scene, hidden: false };
  scene.tokens.contents = [targetToken, sourceToken];
  sender.viewedScene = scene.id;
  sender.targets = new Set([{ document: targetToken, actor: target }]);
  const previousResolver = options.fromUuid;
  options.fromUuid = async (uuid) => uuid === targetToken.uuid ? targetToken : previousResolver(uuid);
  const gm = { id: "gm", active: true, isGM: true };
  options.game = { user: gm, users: { activeGM: gm }, time: { worldTime: 100 } };
  options.receiptWaitMs = 0;
  let journal = { version: 1, records: {} };
  let chain = Promise.resolve();
  options.reservationRepository = {
    readObject() { return structuredClone(journal); },
    mutateObject(_key, mutator) {
      const next = chain.then(async () => {
        const current = structuredClone(journal);
        const result = await mutator(current);
        journal = structuredClone(current);
        return result;
      });
      chain = next.catch(() => {});
      return next;
    }
  };
  const payload = {
    operationId: "op1", sourceActorUuid: source.uuid, sourceItemId: item.id,
    targetActorUuid: target.uuid, targetTokenUuid: targetToken.uuid, productId: product.id,
    durationSeconds: 60, reagentLevel: 2
  };
  message.flags[MODULE].alchemyPotionUse.reservationId = payload.operationId;
  return { ...setup, item, payload };
}

test("a forged chat receipt cannot add reagents to a non-owned actor without observed consumption", async () => {
  const { sender, target, message, options } = foreignFixture();
  const service = new AlchemyReagentService(options);
  assert.equal(await service.authorizeRecordedUse(message, sender), false);
  await assert.rejects(() => service.applyRecordedUse(message, { sender }));
  assert.equal(target.effects.contents.length, 0);
});

test("GM cannot reserve a potion that does not actually exist on the owned actor", async () => {
  const { sender, source, options, payload } = foreignFixture();
  source.items.contents = [];
  const service = new AlchemyReagentService(options);
  await assert.rejects(() => service.reserveUse(payload, { sender }));
});

test("splitting a potion stack into a belt slot does not count as consumption", async () => {
  const { sender, source, message, options, item, payload } = foreignFixture();
  const service = new AlchemyReagentService(options);
  await service.reserveUse(payload, { sender });
  item.system.quantity = 0;
  source.items.contents.push({ id: "beltcopy", type: "consumable", flags: structuredClone(item.flags), system: { quantity: 1 } });
  await service.observeItemConsumption(item, { system: { quantity: 0 } }, sender.id);
  assert.equal(await service.authorizeRecordedUse(message, sender), false);
});

test("consuming another stack cannot make a later belt split look like this reservation's use", async () => {
  const { sender, source, message, options, item, payload } = foreignFixture();
  const other = { ...item, id: "item2", system: { quantity: 1, activities: buildAlchemyActivities(product) } };
  source.items.contents.push(other);
  const service = new AlchemyReagentService(options);
  await service.reserveUse({ ...payload, sourceItemId: "item2" }, { sender });
  source.items.contents = [other];
  await service.observeItemConsumption(item, {}, sender.id, { deleted: true });
  other.system.quantity = 0;
  source.items.contents.push({ id: "beltcopy", type: "consumable", flags: structuredClone(other.flags), system: { quantity: 1 } });
  await service.observeItemConsumption(other, { system: { quantity: 0 } }, sender.id);
  message.flags.dnd5e.item = { id: "item2", uuid: "Actor.source.Item.item2" };
  message.flags.dnd5e.use.consumed.deleted[0]._id = "item2";
  assert.equal(await service.authorizeRecordedUse(message, sender), false);
});

test("GM observes one actual item deletion for one reserved foreign-target use", async () => {
  const { sender, source, target, message, options, item, payload } = foreignFixture();
  const service = new AlchemyReagentService(options);
  await service.reserveUse(payload, { sender });
  assert.equal(await service.authorizeRecordedUse(message, sender), false);
  source.items.contents = [];
  await service.observeItemConsumption(item, {}, sender.id, { deleted: true });
  assert.equal(await service.authorizeRecordedUse(message, sender), true);
  await service.applyRecordedUse(message, { sender });
  assert.equal(calculateActiveReagentTotal(target, 100), 2);
  const forgedReplay = { ...message, flags: structuredClone(message.flags) };
  forgedReplay.id = "message2";
  forgedReplay.uuid = "ChatMessage.message2";
  await assert.rejects(() => service.applyRecordedUse(forgedReplay, { sender }));
  assert.equal(target.effects.contents.length, 1);
});

test("a second concurrent reservation for the same potion waits for the first use", async () => {
  const { sender, source, target, message, options, item, payload } = foreignFixture();
  const service = new AlchemyReagentService(options);
  await service.reserveUse(payload, { sender });
  await assert.rejects(() => service.reserveUse({ ...payload, operationId: "op2" }, { sender }), /дождитесь/iu);
  source.items.contents = [];
  await service.observeItemConsumption(item, {}, sender.id, { deleted: true });
  await service.applyRecordedUse(message, { sender });
  const second = { ...message, flags: structuredClone(message.flags) };
  second.id = "message2";
  second.uuid = "ChatMessage.message2";
  second.flags[MODULE].alchemyPotionUse.reservationId = "op2";
  await assert.rejects(() => service.applyRecordedUse(second, { sender }));
  assert.equal(target.effects.contents.length, 1);
});

test("a GM restart after verified consumption retains the receipt and recovers an effect write", async () => {
  const { sender, source, target, message, options, item, payload } = foreignFixture();
  const original = new AlchemyReagentService(options);
  await original.reserveUse(payload, { sender });
  source.items.contents = [];
  await original.observeItemConsumption(item, {}, sender.id, { deleted: true });
  const realSetFlag = target.setFlag;
  target.setFlag = async () => { throw new Error("temporary flag failure"); };
  await assert.rejects(() => new AlchemyReagentService(options).applyRecordedUse(message, { sender }));
  assert.equal(target.effects.contents.length, 1);
  target.setFlag = realSetFlag;
  await new AlchemyReagentService(options).applyRecordedUse(message, { sender });
  assert.equal(target.effects.contents.length, 1);
  assert.equal(target.flags[MODULE].alchemyReagentOperations.message1, true);
});

test("the actual world-setting repository preserves a confirmed receipt across service instances", async () => {
  const { sender, source, target, message, options, item, payload } = foreignFixture();
  let stored = { version: 1, records: {} };
  const settings = {
    get: () => structuredClone(stored),
    async set(_scope, _key, value) { stored = structuredClone(value); }
  };
  const gateway = { commit(_key, operation) { return operation({ assertActiveGm() {} }); } };
  options.reservationRepository = new WorldSettingMutationRepository({ mutationGateway: gateway, gameProvider: () => ({ settings }) });
  const original = new AlchemyReagentService(options);
  await original.reserveUse(payload, { sender });
  source.items.contents = [];
  await original.observeItemConsumption(item, {}, sender.id, { deleted: true });
  assert.equal(stored.records.op1.consumed, true);
  await new AlchemyReagentService(options).applyRecordedUse(message, { sender });
  assert.equal(target.effects.contents.length, 1);
  assert.deepEqual(stored, { version: 1, records: {} });
});

test("concurrent forged message IDs cannot claim the same observed consumption twice", async () => {
  const { sender, source, target, message, options, item, payload } = foreignFixture();
  const service = new AlchemyReagentService(options);
  await service.reserveUse(payload, { sender });
  source.items.contents = [];
  await service.observeItemConsumption(item, {}, sender.id, { deleted: true });
  const forged = { ...message, id: "message2", uuid: "ChatMessage.message2", flags: structuredClone(message.flags) };
  const results = await Promise.allSettled([
    service.applyRecordedUse(message, { sender }), service.applyRecordedUse(forged, { sender })
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(target.effects.contents.length, 1);
});

test("a request waits briefly for the GM to persist the observed consumption", async () => {
  const { sender, source, target, message, options, item, payload } = foreignFixture();
  options.receiptWaitMs = 500;
  const service = new AlchemyReagentService(options);
  await service.reserveUse(payload, { sender });
  const authorization = service.authorizeRecordedUse(message, sender);
  source.items.contents = [];
  await service.observeItemConsumption(item, {}, sender.id, { deleted: true });
  assert.equal(await authorization, true);
  await service.applyRecordedUse(message, { sender });
  assert.equal(target.effects.contents.length, 1);
});
