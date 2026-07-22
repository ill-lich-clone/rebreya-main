import test from "node:test";
import assert from "node:assert/strict";

import {
  MAP_OBJECT_ACTOR_SOURCE_ID,
  MAP_OBJECT_MACRO_SOURCE_ID,
  MAP_OBJECT_MACRO_NAME,
  MAP_OBJECT_TEMPLATE_ACTOR_NAME,
  MapObjectTokenService,
  TRANSPARENT_OBJECT_TOKEN_PATH,
  buildExistingMapObjectTokenPatch,
  buildMapObjectMacroData,
  buildMapObjectActorDelta,
  buildMapObjectTemplateActorData,
  buildMapObjectTokenData,
  normalizeMapObjectInput
} from "../scripts/data/map-object-token-service.js";

function getPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function mergeInto(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] ??= {};
      mergeInto(target[key], value);
    }
    else {
      target[key] = value;
    }
  }
}

function createCollection(documents = []) {
  return { contents: documents };
}

function createDocument(data, updates = []) {
  return {
    ...structuredClone(data),
    id: data.id ?? data._id ?? crypto.randomUUID(),
    getFlag(scope, key) {
      return getPath(this.flags, `${scope}.${key}`);
    },
    async update(patch) {
      updates.push(patch);
      mergeInto(this, structuredClone(patch));
      return this;
    }
  };
}

function createServiceEnvironment({ activeGm = true, actors = [], macros = [] } = {}) {
  const actorUpdates = [];
  const macroUpdates = [];
  const actorCreates = [];
  const macroCreates = [];
  const actorCollection = createCollection(actors);
  const macroCollection = createCollection(macros);
  const game = { actors: actorCollection, macros: macroCollection };
  const Actor = {
    async create(data) {
      actorCreates.push(data);
      const document = createDocument(data, actorUpdates);
      actorCollection.contents.push(document);
      return document;
    }
  };
  const Macro = {
    async create(data) {
      macroCreates.push(data);
      const document = createDocument(data, macroUpdates);
      macroCollection.contents.push(document);
      return document;
    }
  };
  const service = new MapObjectTokenService({
    gameProvider: () => game,
    actorProvider: () => Actor,
    macroProvider: () => Macro,
    isActiveGmClient: () => activeGm
  });

  return {
    actorCollection,
    actorCreates,
    actorUpdates,
    game,
    macroCollection,
    macroCreates,
    macroUpdates,
    service
  };
}

test("normalizeMapObjectInput applies documented defaults", () => {
  assert.deepEqual(normalizeMapObjectInput({}), {
    name: "Объект",
    hp: 10,
    ac: 10,
    damageThreshold: 0,
    size: 1
  });
});

test("normalizeMapObjectInput converts numeric strings", () => {
  assert.deepEqual(normalizeMapObjectInput({
    name: "  Каменная дверь  ",
    hp: "25",
    ac: "15",
    damageThreshold: "8",
    size: "1.5"
  }), {
    name: "Каменная дверь",
    hp: 25,
    ac: 15,
    damageThreshold: 8,
    size: 1.5
  });
});

test("normalizeMapObjectInput rejects invalid names, ranges, and non-quarter sizes", () => {
  assert.throws(() => normalizeMapObjectInput({ name: "   " }), /name is required/u);
  assert.throws(() => normalizeMapObjectInput({ hp: 0 }), /hp must be an integer from 1 to 1000000/u);
  assert.throws(() => normalizeMapObjectInput({ ac: 101 }), /ac must be an integer from 0 to 100/u);
  assert.throws(() => normalizeMapObjectInput({ damageThreshold: -1 }), /damageThreshold must be an integer from 0 to 1000000/u);
  assert.throws(() => normalizeMapObjectInput({ size: 1.1 }), /size must be from 0.25 to 20 in 0.25 increments/u);
});

test("buildMapObjectTemplateActorData builds the player-hidden managed NPC template", () => {
  assert.deepEqual(buildMapObjectTemplateActorData(), {
    name: MAP_OBJECT_TEMPLATE_ACTOR_NAME,
    type: "npc",
    ownership: { default: 0 },
    flags: {
      "rebreya-main": {
        managed: true,
        sourceId: MAP_OBJECT_ACTOR_SOURCE_ID
      }
    },
    prototypeToken: {
      actorLink: false,
      disposition: 0,
      texture: { src: TRANSPARENT_OBJECT_TOKEN_PATH },
      displayName: 50,
      displayBars: 50,
      bar1: { attribute: "attributes.hp" },
      sight: { enabled: false },
      width: 1,
      height: 1
    }
  });
});

test("buildMapObjectMacroData builds the managed creation macro", () => {
  assert.deepEqual(buildMapObjectMacroData(), {
    name: MAP_OBJECT_MACRO_NAME,
    type: "script",
    scope: "global",
    command: "await game.rebreyaMain?.createMapObjectToken?.();",
    ownership: { default: 0 },
    flags: {
      "rebreya-main": {
        managed: true,
        sourceId: MAP_OBJECT_MACRO_SOURCE_ID
      }
    }
  });
});

test("data builders use Foundry display and ownership constants when available", () => {
  const originalConst = globalThis.CONST;
  globalThis.CONST = {
    TOKEN_DISPLAY_MODES: { ALWAYS: 777 },
    DOCUMENT_OWNERSHIP_LEVELS: { NONE: -5 }
  };

  try {
    const actor = buildMapObjectTemplateActorData();
    const macro = buildMapObjectMacroData();
    const token = buildMapObjectTokenData({
      actor: { id: "template-actor" },
      input: {},
      point: { x: 100, y: 100 },
      gridSize: 100
    });

    assert.equal(actor.ownership.default, -5);
    assert.equal(macro.ownership.default, -5);
    assert.equal(actor.prototypeToken.displayName, 777);
    assert.equal(actor.prototypeToken.displayBars, 777);
    assert.equal(token.displayName, 777);
    assert.equal(token.displayBars, 777);
  }
  finally {
    globalThis.CONST = originalConst;
  }
});

test("buildMapObjectTokenData builds an unlinked neutral object token with delta attributes", () => {
  const data = buildMapObjectTokenData({
    actor: { id: "template-actor" },
    input: { name: "Portcullis", hp: "30", ac: "19", damageThreshold: "10", size: "1.5" },
    point: { x: 400, y: 600 },
    gridSize: 100
  });

  assert.deepEqual(data, {
    actorId: "template-actor",
    actorLink: false,
    name: "Portcullis",
    disposition: 0,
    texture: { src: TRANSPARENT_OBJECT_TOKEN_PATH },
    displayName: 50,
    displayBars: 50,
    bar1: { attribute: "attributes.hp" },
    sight: { enabled: false },
    width: 1.5,
    height: 1.5,
    x: 325,
    y: 525,
    delta: {
      name: "Portcullis",
      system: {
        attributes: {
          hp: { value: 30, max: 30, temp: 0, tempmax: 0, dt: 10 },
          ac: { calc: "flat", flat: 19 }
        }
      }
    },
    flags: {
      "rebreya-main": {
        managed: true,
        sourceId: MAP_OBJECT_ACTOR_SOURCE_ID,
        mapObjectToken: true
      }
    }
  });
});

test("existing-token object patch preserves identity, art, size, items, and effects", () => {
  const token = {
    actorId: "construct-actor",
    texture: { src: "construct.webp" },
    width: 1,
    height: 1,
    actor: { items: [{ id: "weapon" }], effects: [{ id: "body" }] },
    flags: { "rebreya-main": { craftsmanConstruct: { state: "active" } } }
  };
  const patch = buildExistingMapObjectTokenPatch({
    token,
    hp: 26,
    ac: 17,
    damageThreshold: 0,
    flags: { craftsmanConstruct: { state: "disabled" } }
  });

  assert.equal(Object.hasOwn(patch, "actorId"), false);
  assert.equal(Object.hasOwn(patch, "texture"), false);
  assert.equal(Object.hasOwn(patch, "width"), false);
  assert.deepEqual(token.actor.items, [{ id: "weapon" }]);
  assert.deepEqual(token.actor.effects, [{ id: "body" }]);
  assert.deepEqual(patch.delta.system.attributes.hp, { value: 26, max: 26, temp: 0, tempmax: 0, dt: 0 });
  assert.deepEqual(patch.flags["rebreya-main"].craftsmanConstruct, { state: "disabled" });
});

test("map object ActorDelta builder is shared by new and existing object tokens", () => {
  const delta = buildMapObjectActorDelta({ name: "Конструкт", hp: 20, ac: 16, damageThreshold: 2 });
  assert.deepEqual(delta, {
    name: "Конструкт",
    system: {
      attributes: {
        hp: { value: 20, max: 20, temp: 0, tempmax: 0, dt: 2 },
        ac: { calc: "flat", flat: 16 }
      }
    }
  });
});

test("existing token conversion and restoration update only object attributes and managed flags", async () => {
  const updates = [];
  const token = {
    name: "Конструкт",
    flags: {},
    async update(patch) {
      updates.push(structuredClone(patch));
      mergeInto(this, structuredClone(patch));
      return this;
    }
  };
  const { service } = createServiceEnvironment();
  await service.convertTokenToObject(token, { name: "Конструкт", hp: 20, ac: 16 }, {
    flags: { craftsmanConstruct: { state: "disabled" } }
  });
  await service.restoreObjectActor(token, {
    name: "Конструкт",
    system: { attributes: { hp: { value: 3, max: 20 }, ac: { calc: "flat", flat: 16 } } },
    flags: { craftsmanConstruct: { state: "active" } }
  });
  await service.markObjectDestroyed(token, { flags: { craftsmanConstruct: { state: "destroyed" } } });

  assert.equal(updates.length, 3);
  assert.equal(updates[0].flags["rebreya-main"].mapObjectToken, true);
  assert.equal(updates[1].delta.system.attributes.hp.value, 3);
  assert.equal(updates[2].flags["rebreya-main"].craftsmanConstruct.state, "destroyed");
});

test("transparent template and placed tokens bind bar1 to HP", () => {
  const template = buildMapObjectTemplateActorData();
  const token = buildMapObjectTokenData({
    actor: { id: "template-actor" },
    input: {},
    point: { x: 100, y: 100 },
    gridSize: 100
  });

  assert.deepEqual(template.prototypeToken.bar1, { attribute: "attributes.hp" });
  assert.deepEqual(token.bar1, { attribute: "attributes.hp" });
});

test("syncManagedDocuments skips writes for a non-active GM client", async () => {
  for (const activeGm of [false]) {
    const environment = createServiceEnvironment({ activeGm });

    const result = await environment.service.syncManagedDocuments();

    assert.deepEqual(result, { skipped: true, actor: null, macro: null });
    assert.equal(environment.actorCreates.length, 0);
    assert.equal(environment.macroCreates.length, 0);
    assert.equal(environment.actorUpdates.length, 0);
    assert.equal(environment.macroUpdates.length, 0);
  }
});

test("syncManagedDocuments creates exactly one managed Actor and Macro for the active GM", async () => {
  const environment = createServiceEnvironment();

  const result = await environment.service.syncManagedDocuments();

  assert.equal(environment.actorCreates.length, 1);
  assert.equal(environment.macroCreates.length, 1);
  assert.strictEqual(result.actor, environment.actorCollection.contents[0]);
  assert.strictEqual(result.macro, environment.macroCollection.contents[0]);
  assert.equal(result.actor.getFlag("rebreya-main", "sourceId"), MAP_OBJECT_ACTOR_SOURCE_ID);
  assert.equal(result.macro.getFlag("rebreya-main", "sourceId"), MAP_OBJECT_MACRO_SOURCE_ID);
});

test("syncManagedDocuments updates and reuses managed documents without creating duplicates", async () => {
  const environment = createServiceEnvironment();
  const first = await environment.service.syncManagedDocuments();
  first.actor.name = "Old managed actor";
  first.macro.command = "old command";
  first.macro.type = "chat";

  const second = await environment.service.syncManagedDocuments();

  assert.strictEqual(second.actor, first.actor);
  assert.strictEqual(second.macro, first.macro);
  assert.equal(environment.actorCreates.length, 1);
  assert.equal(environment.macroCreates.length, 1);
  assert.equal(environment.actorUpdates.length, 1);
  assert.equal(environment.macroUpdates.length, 1);
  assert.equal(Object.hasOwn(environment.actorUpdates[0], "id"), false);
  assert.equal(Object.hasOwn(environment.actorUpdates[0], "_id"), false);
  assert.equal(Object.hasOwn(environment.actorUpdates[0], "type"), false);
  assert.equal(Object.hasOwn(environment.macroUpdates[0], "id"), false);
  assert.equal(Object.hasOwn(environment.macroUpdates[0], "_id"), false);
  assert.equal(environment.macroUpdates[0].type, "script");
  assert.equal(first.macro.type, "script");
});

test("syncManagedDocuments ignores unrelated document flags when managed fields match", async () => {
  const actorUpdates = [];
  const macroUpdates = [];
  const actor = createDocument({
    ...buildMapObjectTemplateActorData(),
    flags: {
      ...buildMapObjectTemplateActorData().flags,
      "another-module": { preserve: true }
    }
  }, actorUpdates);
  const macro = createDocument({
    ...buildMapObjectMacroData(),
    flags: {
      ...buildMapObjectMacroData().flags,
      "another-module": { preserve: true }
    }
  }, macroUpdates);
  const environment = createServiceEnvironment({ actors: [actor], macros: [macro] });

  await environment.service.syncManagedDocuments();

  assert.equal(environment.actorCreates.length, 0);
  assert.equal(environment.macroCreates.length, 0);
  assert.equal(actorUpdates.length, 0);
  assert.equal(macroUpdates.length, 0);
});

test("syncManagedDocuments ignores Foundry-expanded defaults and creator ownership", async () => {
  const actorUpdates = [];
  const macroUpdates = [];
  const actorData = buildMapObjectTemplateActorData();
  const macroData = buildMapObjectMacroData();
  const actor = createDocument({
    ...actorData,
    ownership: { default: actorData.ownership.default, creator: 3 },
    prototypeToken: {
      ...actorData.prototypeToken,
      texture: {
        ...actorData.prototypeToken.texture,
        anchorX: 0.5,
        anchorY: 0.5,
        fit: "contain"
      },
      sight: {
        ...actorData.prototypeToken.sight,
        range: 0,
        angle: 360
      },
      alpha: 1,
      hidden: false
    }
  }, actorUpdates);
  const macro = createDocument({
    ...macroData,
    ownership: { default: macroData.ownership.default, creator: 3 }
  }, macroUpdates);
  const environment = createServiceEnvironment({ actors: [actor], macros: [macro] });

  await environment.service.syncManagedDocuments();

  assert.equal(actorUpdates.length, 0);
  assert.equal(macroUpdates.length, 0);
});

test("syncManagedDocuments does not adopt same-name documents without the managed source flag", async () => {
  const userActorUpdates = [];
  const userMacroUpdates = [];
  const userActor = createDocument({ name: MAP_OBJECT_TEMPLATE_ACTOR_NAME, type: "npc", flags: {} }, userActorUpdates);
  const userMacro = createDocument({ name: MAP_OBJECT_MACRO_NAME, type: "script", flags: {} }, userMacroUpdates);
  const environment = createServiceEnvironment({ actors: [userActor], macros: [userMacro] });

  const result = await environment.service.syncManagedDocuments();

  assert.notStrictEqual(result.actor, userActor);
  assert.notStrictEqual(result.macro, userMacro);
  assert.equal(environment.actorCreates.length, 1);
  assert.equal(environment.macroCreates.length, 1);
  assert.equal(userActorUpdates.length, 0);
  assert.equal(userMacroUpdates.length, 0);
});

test("createToken delegates a normalized payload to the scene embedded-document API", async () => {
  const managedActor = createDocument(buildMapObjectTemplateActorData());
  const environment = createServiceEnvironment({ actors: [managedActor] });
  const created = { id: "new-token" };
  const calls = [];
  const scene = {
    async createEmbeddedDocuments(type, documents) {
      calls.push({ type, documents });
      return [created];
    }
  };

  const result = await environment.service.createToken({
    name: "  Ancient gate  ",
    hp: "40",
    ac: "17",
    damageThreshold: "5",
    size: "2"
  }, {
    scene,
    point: { x: 300, y: 500 },
    gridSize: 100
  });

  assert.strictEqual(result, created);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, "Token");
  assert.equal(calls[0].documents.length, 1);
  assert.equal(calls[0].documents[0].actorId, managedActor.id);
  assert.equal(calls[0].documents[0].name, "Ancient gate");
  assert.deepEqual(calls[0].documents[0].delta.system.attributes, {
    hp: { value: 40, max: 40, temp: 0, tempmax: 0, dt: 5 },
    ac: { calc: "flat", flat: 17 }
  });
  assert.equal(calls[0].documents[0].texture.src, TRANSPARENT_OBJECT_TOKEN_PATH);
  assert.equal(calls[0].documents[0].x, 200);
  assert.equal(calls[0].documents[0].y, 400);
});
