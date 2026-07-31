import test from "node:test";
import assert from "node:assert/strict";

import {
  findManagedGroupTokenAtPoint,
  handleTransportGroupDrop,
  isTransportCompendiumActorDrop,
  registerTransportGroupDropHooks
} from "../scripts/integrations/transport-group-drop.js";

const validTransportData = {
  type: "Actor",
  uuid: "Compendium.world.rebreya-transport.Actor.lchtransport0001",
  x: 150,
  y: 150
};

const worldTransportData = {
  type: "Actor",
  uuid: "Actor.world-lincoln",
  x: 150,
  y: 150
};

const worldTransportActor = {
  uuid: worldTransportData.uuid,
  type: "vehicle",
  pack: null,
  _stats: {
    compendiumSource: validTransportData.uuid
  },
  getFlag(scope, key) {
    if (scope !== "rebreya-main") return undefined;
    if (key === "managed") return true;
    if (key === "sourceId") return "transport-v01-lincoln";
    if (key === "transport") {
      return {
        instance: false,
        sourceId: "transport-v01-lincoln"
      };
    }
    return undefined;
  }
};

function createToken({
  id = "group-a",
  bounds = [100, 100, 200, 200],
  managed = true,
  actorType = "group"
} = {}) {
  const [left, top, right, bottom] = bounds;
  return {
    actor: {
      id,
      type: actorType,
      getFlag: (_scope, key) => key === "managedPartyGroup" ? managed : undefined
    },
    bounds: {
      contains: (x, y) => x >= left && x <= right && y >= top && y <= bottom
    }
  };
}

function createCanvasWithGroupToken(options = {}) {
  return { tokens: { placeables: [createToken(options)] } };
}

test("transport drop detection accepts only Actor UUIDs from the managed pack", () => {
  assert.equal(isTransportCompendiumActorDrop(validTransportData), true);
  assert.equal(isTransportCompendiumActorDrop({ ...validTransportData, type: "Item" }), false);
  assert.equal(isTransportCompendiumActorDrop({
    ...validTransportData,
    uuid: "Compendium.world.other.Actor.lchtransport0001"
  }), false);
  assert.equal(isTransportCompendiumActorDrop({ ...validTransportData, uuid: "Actor.vehicle-a" }), false);
});

test("transport drop detection accepts a managed world copy linked to the transport compendium", () => {
  assert.equal(isTransportCompendiumActorDrop(worldTransportData, {
    resolveWorldActor: (uuid) => uuid === worldTransportData.uuid ? worldTransportActor : null
  }), true);
  assert.equal(isTransportCompendiumActorDrop(worldTransportData, {
    resolveWorldActor: () => ({
      ...worldTransportActor,
      getFlag: () => undefined
    })
  }), false);
});

test("transport drop detection resolves a world Actor from the Foundry actor collection", () => {
  const previousGame = globalThis.game;
  globalThis.game = {
    actors: {
      get: (actorId) => actorId === "world-lincoln" ? worldTransportActor : null
    }
  };
  try {
    assert.equal(isTransportCompendiumActorDrop(worldTransportData), true);
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("accepted transport drop suppresses Foundry synchronously and imports asynchronously", async () => {
  const calls = [];
  const moduleApi = {
    async importTransportIntoGroup(payload) {
      calls.push(payload);
      return { actorId: "vehicle-a" };
    }
  };

  const allowed = handleTransportGroupDrop(
    createCanvasWithGroupToken(),
    validTransportData,
    moduleApi
  );

  assert.equal(allowed, false);
  await Promise.resolve();
  assert.deepEqual(calls, [{
    groupActorId: "group-a",
    sourceActorUuid: validTransportData.uuid
  }]);
});

test("managed world transport drop is routed to the group import API", async () => {
  const calls = [];
  const allowed = handleTransportGroupDrop(
    createCanvasWithGroupToken(),
    worldTransportData,
    {
      async importTransportIntoGroup(payload) {
        calls.push(payload);
      }
    },
    {
      resolveWorldActor: (uuid) => uuid === worldTransportData.uuid ? worldTransportActor : null
    }
  );

  assert.equal(allowed, false);
  await Promise.resolve();
  assert.deepEqual(calls, [{
    groupActorId: "group-a",
    sourceActorUuid: worldTransportData.uuid
  }]);
});

test("empty canvas, unrelated actors, and missing coordinates preserve Foundry behavior", () => {
  const moduleApi = { importTransportIntoGroup: async () => ({}) };
  const emptyCanvas = { tokens: { placeables: [] } };
  const groupCanvas = createCanvasWithGroupToken({ bounds: [0, 0, 10, 10] });

  assert.equal(handleTransportGroupDrop(emptyCanvas, validTransportData, moduleApi), true);
  assert.equal(handleTransportGroupDrop(groupCanvas, {
    type: "Actor",
    uuid: "Actor.other",
    x: 1,
    y: 1
  }, moduleApi), true);
  assert.equal(handleTransportGroupDrop(groupCanvas, {
    type: "Actor",
    uuid: validTransportData.uuid
  }, moduleApi), true);
});

test("managed token lookup selects the topmost eligible group", () => {
  const lower = createToken({ id: "lower" });
  const unmanaged = createToken({ id: "unmanaged", managed: false });
  const character = createToken({ id: "character", actorType: "character" });
  const upper = createToken({ id: "upper" });
  const canvas = { tokens: { placeables: [lower, unmanaged, character, upper] } };

  assert.equal(findManagedGroupTokenAtPoint(canvas, 150, 150), upper);
  assert.equal(findManagedGroupTokenAtPoint({
    tokens: { placeables: [lower, unmanaged, character] }
  }, 150, 150), lower);
  assert.equal(findManagedGroupTokenAtPoint({
    tokens: { placeables: [unmanaged, character] }
  }, 150, 150), null);
});

test("failed asynchronous import reports an error without falling through to token creation", async () => {
  const errors = [];
  const previousUi = globalThis.ui;
  globalThis.ui = { notifications: { error: (message) => errors.push(message) } };
  try {
    const allowed = handleTransportGroupDrop(
      createCanvasWithGroupToken(),
      validTransportData,
      {
        async importTransportIntoGroup() {
          throw new Error("Бак повреждён");
        }
      }
    );

    assert.equal(allowed, false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(errors, ["Бак повреждён"]);
  }
  finally {
    globalThis.ui = previousUi;
  }
});

test("hook registration is idempotent for the same Hooks object", () => {
  const registrations = [];
  const Hooks = {
    on(name, callback) {
      registrations.push([name, callback]);
    }
  };
  const moduleApi = { importTransportIntoGroup: async () => ({}) };

  assert.equal(registerTransportGroupDropHooks(moduleApi, { Hooks }), true);
  assert.equal(registerTransportGroupDropHooks(moduleApi, { Hooks }), false);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0][0], "dropCanvasData");
  assert.equal(registrations[0][1](createCanvasWithGroupToken(), validTransportData), false);
});
