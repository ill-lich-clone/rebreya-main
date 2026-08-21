import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";

function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  };
}

function createHooks() {
  return { once() {}, on() {} };
}

test("storage texture API rejects players and forwards an authorized GM mutation", async () => {
  const gm = { active: true, id: "gm", isGM: true };
  const storageActor = {
    type: "npc",
    flags: { [MODULE_ID]: { storage: { enabled: true } } },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
  const token = {
    actor: storageActor,
    name: "Сундук",
    uuid: "Scene.scene.Token.chest"
  };
  const game = {
    modules: new Map([[MODULE_ID, {}]]),
    socket: { emit() {}, on() {} },
    system: { id: "dnd5e" },
    user: gm,
    users: { activeGM: gm, contents: [gm] },
    messages: { contents: [] },
    settings: { get: () => false }
  };
  const restores = [
    replaceGlobal("Hooks", createHooks()),
    replaceGlobal("Actor", class Actor {}),
    replaceGlobal("Item", class Item {}),
    replaceGlobal("Macro", class Macro {}),
    replaceGlobal("CONFIG", {}),
    replaceGlobal("fromUuid", async (uuid) => uuid === token.uuid ? token : null),
    replaceGlobal("foundry", {
      utils: {
        getProperty(source, path) {
          return path.split(".").reduce((value, key) => value?.[key], source);
        },
        setProperty(source, path, value) {
          const keys = path.split(".");
          const lastKey = keys.pop();
          const target = keys.reduce((current, key) => (current[key] ??= {}), source);
          target[lastKey] = value;
          return true;
        },
        deepClone(value) {
          return structuredClone(value);
        }
      }
    }),
    replaceGlobal("ui", { notifications: { error() {}, info() {}, warn() {} } }),
    replaceGlobal("game", game)
  ];

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?storage-texture-api=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    let textureWrites = 0;
    moduleApi.storageService.setTextureMode = async (actualToken, actualMode) => {
      textureWrites += 1;
      assert.equal(actualToken, token);
      assert.equal(actualMode, "opened");
      return { state: "unopened", displayMode: "opened" };
    };

    game.user.isGM = false;
    await assert.rejects(
      moduleApi.setStorageTextureMode(token.uuid, "opened"),
      /только мастер/u
    );
    assert.equal(textureWrites, 0);

    game.user.isGM = true;
    const result = await moduleApi.setStorageTextureMode(token.uuid, "opened");
    assert.deepEqual(result, { state: "unopened", displayMode: "opened" });
    assert.equal(textureWrites, 1);
  }
  finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("module composition materializes a corpse into token state and exposes it only through the read-only snapshot path", async () => {
  const gm = { active: true, id: "gm", isGM: true };
  const scene = { id: "scene" };
  const actor = {
    id: "champion",
    uuid: "Actor.champion",
    type: "npc",
    flags: {},
    system: { attributes: { hp: { value: 0 } } },
    items: []
  };
  const token = {
    id: "champion-token",
    uuid: "Scene.scene.Token.champion",
    name: "Чемпион",
    parent: scene,
    actor,
    flags: {},
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async update(patch) {
      for (const [path, value] of Object.entries(patch)) {
        const parts = path.split(".");
        const last = parts.pop();
        const target = parts.reduce((current, part) => (current[part] ??= {}), this);
        target[last] = structuredClone(value);
      }
      return this;
    }
  };
  const game = {
    modules: new Map([[MODULE_ID, { version: "1.4.152" }]]),
    packs: new Map(),
    socket: { emit() {}, on() {} },
    system: { id: "dnd5e" },
    user: gm,
    users: { activeGM: gm, contents: [gm] },
    messages: { contents: [] },
    settings: { get: () => false }
  };
  const restores = [
    replaceGlobal("Hooks", createHooks()),
    replaceGlobal("Actor", class Actor {}),
    replaceGlobal("Item", class Item {}),
    replaceGlobal("Macro", class Macro {}),
    replaceGlobal("CONFIG", {}),
    replaceGlobal("fromUuid", async (uuid) => uuid === token.uuid ? token : null),
    replaceGlobal("foundry", {
      utils: {
        getProperty(source, path) {
          return path.split(".").reduce((value, key) => value?.[key], source);
        },
        setProperty(source, path, value) {
          const keys = path.split(".");
          const lastKey = keys.pop();
          const target = keys.reduce((current, key) => (current[key] ??= {}), source);
          target[lastKey] = value;
          return true;
        },
        deepClone(value) {
          return structuredClone(value);
        }
      }
    }),
    replaceGlobal("ui", { notifications: { error() {}, info() {}, warn() {} } }),
    replaceGlobal("game", game)
  ];

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?corpse-composition=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    let materializations = 0;
    moduleApi.corpseStorageMaterializer.materialize = async (actualToken) => {
      materializations += 1;
      assert.equal(actualToken, token);
      return {
        rows: [{
          rowId: "corpse-v1:plate:laty",
          sourceType: "gear",
          sourceId: "laty",
          quantity: 1,
          itemData: { name: "Латный доспех", type: "equipment", system: { quantity: 1 } }
        }],
        coins: {},
        corpseMaterialization: {
          version: 1,
          status: "complete",
          sourceActorUuid: actor.uuid,
          sourceActorId: actor.id
        }
      };
    };
    moduleApi.storageOpenSoundService.playForToken = async () => {};

    await moduleApi.storageService.open(token);
    const snapshot = await moduleApi.getStorageSnapshot(token.uuid);

    assert.equal(materializations, 1);
    assert.equal(snapshot.state, "opened");
    assert.deepEqual(snapshot.rows.map((row) => row.sourceId), ["laty"]);
    await assert.rejects(moduleApi.configureStorageToken(token.uuid, {}), /не отмечен/u);
    await assert.rejects(moduleApi.resetStorageToken(token.uuid), /не отмечен/u);
  }
  finally {
    restores.reverse().forEach((restore) => restore());
  }
});
