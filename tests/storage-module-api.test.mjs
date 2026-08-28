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

test("opening GM settings for a marked storage does not perform first-open generation", async () => {
  class FakeApplicationV2 {}
  const gm = { active: true, id: "gm", isGM: true };
  const storageActor = {
    type: "npc",
    flags: { [MODULE_ID]: { storage: { enabled: true } } },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  };
  const token = {
    id: "chest",
    uuid: "Scene.scene.Token.chest",
    name: "Закрытый сундук",
    actor: storageActor
  };
  const game = {
    modules: new Map([[MODULE_ID, { version: "1.4.164" }]]),
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
    replaceGlobal("HTMLElement", class HTMLElement {}),
    replaceGlobal("CONFIG", {}),
    replaceGlobal("fromUuid", async (uuid) => uuid === token.uuid ? token : null),
    replaceGlobal("foundry", {
      applications: {
        api: {
          ApplicationV2: FakeApplicationV2,
          HandlebarsApplicationMixin: (Base) => Base
        }
      },
      utils: {
        deepClone: (value) => structuredClone(value),
        getProperty(source, path) {
          return path.split(".").reduce((value, key) => value?.[key], source);
        }
      }
    }),
    replaceGlobal("ui", { notifications: { error() {}, info() {}, warn() {} } }),
    replaceGlobal("game", game)
  ];

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?storage-config-no-open=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    let firstOpenCalls = 0;
    moduleApi.storageService.open = async () => { firstOpenCalls += 1; };
    const app = {
      characterTokenUuid: "",
      async render() {},
      requestTokenAnchor() {}
    };
    moduleApi.storageApps.set(`${token.uuid}:configure`, app);

    const result = await moduleApi.openStorageApp({
      tokenUuid: token.uuid,
      configure: true,
      anchorToToken: true
    });

    assert.equal(result, app);
    assert.equal(firstOpenCalls, 0);
  }
  finally {
    restores.reverse().forEach((restore) => restore());
  }
});

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

test("module composition materializes a corpse before allowing marker-guarded GM configuration", async () => {
  class FakeApplicationV2 {}
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
    replaceGlobal("HTMLElement", class HTMLElement {}),
    replaceGlobal("CONFIG", {}),
    replaceGlobal("fromUuid", async (uuid) => uuid === token.uuid ? token : null),
    replaceGlobal("foundry", {
      applications: {
        api: {
          ApplicationV2: FakeApplicationV2,
          HandlebarsApplicationMixin: (Base) => Base
        }
      },
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
    moduleApi.storageApps.set(`${token.uuid}:configure`, {
      characterTokenUuid: "",
      async render() {},
      requestTokenAnchor() {}
    });

    await assert.rejects(moduleApi.configureStorageToken(token.uuid, {}), /не отмечен/u);
    await moduleApi.openStorageApp({ tokenUuid: token.uuid, configure: true });
    const snapshot = await moduleApi.getStorageSnapshot(token.uuid);

    assert.equal(materializations, 1);
    assert.equal(snapshot.state, "opened");
    assert.deepEqual(snapshot.rows.map((row) => row.sourceId), ["laty"]);
    const configured = await moduleApi.configureStorageToken(token.uuid, { baseName: "Тело Чемпиона" });
    assert.equal(configured.baseName, "Тело Чемпиона");
    assert.equal(configured.corpseMaterialization.status, "complete");

    const reset = await moduleApi.resetStorageToken(token.uuid);
    assert.equal(reset.state, "empty");
    assert.equal(reset.corpseMaterialization.status, "complete");
    const reopened = await moduleApi.storageService.open(token);
    assert.equal(materializations, 1);
    assert.deepEqual(reopened.rows, []);
  }
  finally {
    restores.reverse().forEach((restore) => restore());
  }
});
