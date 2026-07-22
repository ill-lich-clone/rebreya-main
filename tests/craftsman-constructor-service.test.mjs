import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => structuredClone(value)
  }
};

const {
  CraftsmanConstructorService,
  isCraftsmanConstructor,
  isLongRest
} = await import("../scripts/combat/craftsman-constructor-service.js");

function collection(contents = []) {
  return { contents, values: () => contents.values() };
}

const PREPARED_CONSTRUCT = Object.freeze({
  bodyId: "sturdy-body",
  combatModeId: "blind-fighting",
  skillIds: ["inv", "prc"]
});

function ownerActor({ constructor = true, prepared = true } = {}) {
  const summonUses = [];
  const updates = [];
  const activity = {
    id: "lchconstructsumm",
    flags: { "rebreya-main": { craftsmanConstructor: { kind: "constructSummon" } } },
    async use(...args) { summonUses.push(args); return true; }
  };
  const actor = {
    id: "owner-1",
    uuid: "Actor.owner-1",
    isOwner: true,
    flags: prepared ? {
      "rebreya-main": { craftsmanConstructPreparation: structuredClone(PREPARED_CONSTRUCT) }
    } : {},
    system: { traits: { languages: { value: ["common"], custom: "Эльфийский" } } },
    items: collection([
      { type: "class", system: { identifier: "craftsman-v01", levels: 5 } },
      ...(constructor ? [{
        type: "subclass",
        flags: { "rebreya-main": { archetypeId: "craftsman-specialty-constructor" } }
      }] : []),
      { type: "feat", system: { activities: collection([activity]) } }
    ]),
    summonUses,
    updates,
    activity,
    async update(patch) {
      updates.push(structuredClone(patch));
      if (Object.hasOwn(patch, "flags.rebreya-main.craftsmanConstructPreparation")) {
        const preparation = patch["flags.rebreya-main.craftsmanConstructPreparation"];
        this.flags["rebreya-main"] ??= {};
        this.flags["rebreya-main"].craftsmanConstructPreparation = preparation === null
          ? null
          : structuredClone(preparation);
      }
      return this;
    }
  };
  activity.item = { actor };
  return actor;
}

function constructToken(id = "new-token") {
  const updates = [];
  const createdItems = [];
  const deletedItemIds = [];
  const actor = {
    id: `actor-${id}`,
    uuid: `Scene.scene-1.Token.${id}.Actor.${id}`,
    isToken: true,
    items: collection([]),
    system: {
      abilities: { str: { value: 16 } },
      attributes: {
        ac: { value: 17, calc: "flat", flat: 17 },
        hp: { value: 30, max: 30 },
        senses: { blindsight: 0, darkvision: 60 },
        movement: { walk: 30 }
      },
      skills: Object.fromEntries(["acr", "arc", "ath", "inv", "prc", "ste"].map((skill) => [skill, { value: 0 }])),
      traits: { languages: { value: [], custom: "" } }
    },
    flags: { dnd5e: { summon: { origin: "Actor.owner-1.Item.construct" } } },
    async update(patch) { updates.push(structuredClone(patch)); Object.assign(this.flags, patch.flags ?? {}); return this; },
    async createEmbeddedDocuments(type, rows) { assert.equal(type, "Item"); createdItems.push(...structuredClone(rows)); return rows; },
    async deleteEmbeddedDocuments(type, ids) { assert.equal(type, "Item"); deletedItemIds.push(...ids); }
  };
  const tokenUpdates = [];
  const token = {
    id,
    uuid: `Scene.scene-1.Token.${id}`,
    actor,
    flags: {},
    async update(patch) { tokenUpdates.push(structuredClone(patch)); this.flags = patch.flags ?? this.flags; return this; },
    async delete() { this.deleted = true; }
  };
  actor.token = { document: token };
  return { token, actor, updates, createdItems, deletedItemIds, tokenUpdates };
}

test("constructor eligibility requires the Craftsman class and Constructor specialty", () => {
  assert.equal(isCraftsmanConstructor(ownerActor()), true);
  assert.equal(isCraftsmanConstructor(ownerActor({ constructor: false })), false);
  assert.equal(isLongRest({ longRest: true }, {}), true);
  assert.equal(isLongRest({ type: "short" }, {}), false);
});

test("long rest stores construct choices without using or placing the Summon activity", async () => {
  const owner = ownerActor({ prepared: false });
  const service = new CraftsmanConstructorService({
    promptConfiguration: async () => structuredClone(PREPARED_CONSTRUCT)
  });
  assert.equal(await service.handleRestCompleted(owner, { longRest: true }), true);
  assert.equal(owner.summonUses.length, 0);
  assert.deepEqual(
    owner.flags["rebreya-main"].craftsmanConstructPreparation,
    PREPARED_CONSTRUCT
  );
});

test("native Summon activity is blocked until long-rest construct choices exist", () => {
  const preparedOwner = ownerActor();
  const unpreparedOwner = ownerActor({ prepared: false });
  const service = new CraftsmanConstructorService();
  assert.equal(service.applyDnd5ePreUseActivity(preparedOwner.activity), true);
  assert.equal(service.applyDnd5ePreUseActivity(unpreparedOwner.activity), false);
});

test("post-summon configures the new synthetic actor before retiring an old construct", async () => {
  const owner = ownerActor();
  const fresh = constructToken();
  const old = constructToken("old-token");
  old.token.flags = {
    "rebreya-main": { craftsmanConstruct: { state: "active", ownerUuid: owner.uuid } }
  };
  const events = [];
  const originalFreshUpdate = fresh.actor.update.bind(fresh.actor);
  fresh.actor.update = async (patch) => { events.push("new-configured"); return originalFreshUpdate(patch); };
  old.token.delete = async () => { events.push("old-retired"); old.token.deleted = true; };

  const service = new CraftsmanConstructorService({
    promptConfiguration: async () => { throw new Error("post-summon must not prompt"); },
    findConstructTokens: () => [old.token]
  });
  const activity = { ...owner.activity, item: { actor: owner } };
  assert.equal(await service.handlePostSummon(activity, {}, [fresh.token], {}), true);

  assert.deepEqual(events, ["new-configured", "old-retired"]);
  const actorPatch = fresh.updates[0];
  assert.equal(actorPatch["system.attributes.hp.max"], 40);
  assert.equal(actorPatch["system.attributes.hp.value"], 40);
  assert.equal(actorPatch["system.attributes.senses.blindsight"], 10);
  assert.equal(actorPatch["system.skills.inv.value"], 1);
  assert.equal(actorPatch["system.skills.prc.value"], 1);
  assert.equal(actorPatch["flags.rebreya-main.craftsmanConstruct"].state, "active");
  assert.equal(fresh.createdItems.some((item) => item.name === "Сборка тела: Крепкий корпус"), true);
  assert.equal(fresh.createdItems.some((item) => item.name === "Боевой режим: Сражение вслепую"), true);
  for (const item of fresh.createdItems) {
    for (const [id, activity] of Object.entries(item.system?.activities ?? {})) {
      assert.match(id, /^[A-Za-z0-9]{16}$/u);
      assert.equal(activity._id, id);
    }
  }
  assert.equal(old.token.deleted, true);
  assert.equal(owner.flags["rebreya-main"].craftsmanConstructPreparation, null);
  assert.equal(service.applyDnd5ePreUseActivity(owner.activity), false);
});

test("summoning without prepared choices removes only the new token and preserves the old construct", async () => {
  const owner = ownerActor({ prepared: false });
  const fresh = constructToken();
  const old = constructToken("old-token");
  old.token.flags = {
    "rebreya-main": { craftsmanConstruct: { state: "active", ownerUuid: owner.uuid } }
  };
  const service = new CraftsmanConstructorService({ findConstructTokens: () => [old.token] });
  const activity = { ...owner.activity, item: { actor: owner } };
  assert.equal(await service.handlePostSummon(activity, {}, [fresh.token], {}), false);
  assert.equal(fresh.token.deleted, true);
  assert.notEqual(old.token.deleted, true);
});

test("disabling an active construct delegates token conversion to MapObjectTokenService", async () => {
  const converted = [];
  const mapObjectTokenService = {
    async convertTokenToObject(token, input, options) { converted.push({ token, input, options }); return token; }
  };
  const { token, actor } = constructToken();
  token.flags = {
    "rebreya-main": {
      craftsmanConstruct: {
        state: "active",
        ownerUuid: "Actor.owner-1",
        bodyId: "sturdy-body",
        combatModeId: "blind-fighting",
        skillIds: ["inv", "prc"]
      }
    }
  };
  actor.system.attributes.hp = { value: 0, max: 40 };
  const service = new CraftsmanConstructorService({ mapObjectTokenService });
  assert.equal(await service.disableConstruct(token, "zero-hp"), true);
  assert.equal(converted.length, 1);
  assert.equal(converted[0].input.hp, 40);
  assert.equal(converted[0].input.ac, 17);
  assert.equal(converted[0].options.flags.craftsmanConstruct.state, "disabled");
  assert.equal(converted[0].options.flags.craftsmanConstruct.reason, "zero-hp");
});

test("a disabled construct repairs through the object service after one minute", async () => {
  const restored = [];
  const mapObjectTokenService = {
    async restoreObjectActor(token, snapshot) { restored.push({ token, snapshot }); return token; }
  };
  const { token, actor } = constructToken();
  token.flags = {
    "rebreya-main": {
      mapObjectToken: true,
      craftsmanConstruct: {
        state: "disabled",
        ownerUuid: "Actor.owner-1",
        restoreSnapshot: {
          attributes: { movement: { walk: 30 }, senses: { darkvision: 60 } },
          sight: { enabled: true, range: 60, visionMode: "darkvision" }
        }
      }
    }
  };
  actor.system.attributes.hp = { value: 20, max: 40 };
  const service = new CraftsmanConstructorService({
    mapObjectTokenService,
    worldTime: () => 100,
    findConstructTokens: () => [token]
  });
  assert.equal(await service.repairConstruct(token), true);
  assert.equal(token.flags["rebreya-main"].craftsmanConstruct.state, "repairing");
  assert.equal(token.flags["rebreya-main"].craftsmanConstruct.activatesAtWorldTime, 160);
  await service.handleWorldTime(159);
  assert.equal(restored.length, 0);
  await service.handleWorldTime(160);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].snapshot.flags.craftsmanConstruct.state, "active");
  assert.deepEqual(restored[0].snapshot.system.attributes.hp, { value: 20, max: 40 });
  assert.deepEqual(restored[0].snapshot.system.attributes.movement, { walk: 30 });
});

test("shared HP lifecycle runs only on the authoritative client and accepts Actor.token as TokenDocument", async () => {
  const authoritativeConversions = [];
  const { token, actor } = constructToken();
  actor.token = token;
  actor.system.attributes.hp = { value: 0, max: 30 };
  token.flags = {
    "rebreya-main": {
      craftsmanConstruct: { state: "active", ownerUuid: "Actor.owner-1" }
    }
  };
  const mapObjectTokenService = {
    async convertTokenToObject(...args) { authoritativeConversions.push(args); return token; }
  };
  const observer = new CraftsmanConstructorService({
    mapObjectTokenService,
    isActiveGmClient: () => false
  });
  assert.equal(await observer.handleActorUpdated(actor), true);
  assert.equal(authoritativeConversions.length, 0);

  const authority = new CraftsmanConstructorService({
    mapObjectTokenService,
    isActiveGmClient: () => true
  });
  assert.equal(await authority.handleActorUpdated(actor), true);
  assert.equal(authoritativeConversions.length, 1);
  assert.equal(authoritativeConversions[0][0], token);
});
