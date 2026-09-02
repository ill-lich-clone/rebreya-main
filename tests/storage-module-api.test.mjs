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

test("storage source inspection exposes only safe canonical placement metadata", async () => {
  class FakeApplicationV2 {}
  const itemData = (uuid, flags) => ({
    uuid,
    documentName: "Item",
    name: uuid.endsWith("bed") ? "Кровать" : "Сторонняя кровать",
    type: "loot",
    img: "icons/bed.webp",
    system: { quantity: 1 },
    flags,
    toObject() {
      return {
        name: this.name,
        type: this.type,
        img: this.img,
        system: structuredClone(this.system),
        flags: structuredClone(this.flags)
      };
    }
  });
  const bed = itemData("Compendium.rebreya-main.gear.Item.bed", {
    [MODULE_ID]: { sourceType: "gear", sourceId: "krovat", gearId: "krovat" }
  });
  const external = itemData("Compendium.external.gear.Item.bed", {});
  const documents = new Map([[bed.uuid, bed], [external.uuid, external]]);
  const restores = [
    replaceGlobal("Hooks", createHooks()),
    replaceGlobal("Actor", class Actor {}),
    replaceGlobal("Item", class Item {}),
    replaceGlobal("Macro", class Macro {}),
    replaceGlobal("HTMLElement", class HTMLElement {}),
    replaceGlobal("CONFIG", {}),
    replaceGlobal("fromUuid", async (uuid) => documents.get(uuid) ?? null),
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
    replaceGlobal("game", {
      modules: new Map([[MODULE_ID, { version: "1.4.211" }]]),
      socket: { emit() {}, on() {} },
      system: { id: "dnd5e" },
      user: { active: true, id: "gm", isGM: true },
      users: { contents: [] },
      messages: { contents: [] },
      settings: { get: () => false }
    })
  ];

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?storage-placement-inspection=${Date.now()}`);
    const context = { storageService: {}, storageContainerItemService: {} };
    const managed = await RebreyaMainModule.prototype.inspectStorageDepositSource.call(
      context,
      { kind: "item", itemUuid: bed.uuid }
    );
    assert.deepEqual(managed.placement, { width: 1, height: 2, rotationMode: "cardinal" });
    assert.equal(managed.name, "Кровать");
    assert.equal(managed.available, 1);

    const fallback = await RebreyaMainModule.prototype.inspectStorageDepositSource.call(
      context,
      { kind: "item", itemUuid: external.uuid }
    );
    assert.equal(fallback.placement, null);
  }
  finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("storage scene APIs serialize optional furniture rotation without changing legacy payloads", async () => {
  class FakeApplicationV2 {}
  const gm = { active: true, id: "gm", isGM: true };
  const restores = [
    replaceGlobal("Hooks", createHooks()),
    replaceGlobal("Actor", class Actor {}),
    replaceGlobal("Item", class Item {}),
    replaceGlobal("Macro", class Macro {}),
    replaceGlobal("HTMLElement", class HTMLElement {}),
    replaceGlobal("CONFIG", {}),
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
    replaceGlobal("game", {
      modules: new Map([[MODULE_ID, { version: "1.4.211" }]]),
      socket: { emit() {}, on() {} },
      system: { id: "dnd5e" },
      user: gm,
      users: { activeGM: gm, contents: [gm] },
      messages: { contents: [] },
      settings: { get: () => false }
    })
  ];

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?storage-orientation-api=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const itemPayloads = [];
    const claimPayloads = [];
    moduleApi.storageCommandService.dropItemToScene = async (payload) => {
      itemPayloads.push(structuredClone(payload));
      return { changed: true };
    };
    moduleApi.storageCommandService.claimRow = async (payload) => {
      claimPayloads.push(structuredClone(payload));
      return { changed: true };
    };

    await moduleApi.dropStorageItemToScene("Item.bed", {
      characterTokenUuid: "Scene.scene.Token.hero",
      sceneId: "scene",
      x: 100,
      y: 200,
      quantity: 1,
      rotation: 90,
      mutationId: "bed-drop"
    });
    await moduleApi.dropStorageItemToScene("Item.chair", {
      characterTokenUuid: "Scene.scene.Token.hero",
      sceneId: "scene",
      x: 300,
      y: 400,
      quantity: 1,
      mutationId: "chair-drop"
    });
    await moduleApi.claimStorageRow("Scene.scene.Token.chest", "bed-row", "scene", "bed-claim", {
      characterTokenUuid: "Scene.scene.Token.hero",
      quantity: 1,
      target: { sceneId: "scene", x: 500, y: 600, rotation: 270 }
    });

    assert.equal(itemPayloads[0].rotation, 90);
    assert.equal(Object.hasOwn(itemPayloads[1], "rotation"), false);
    assert.equal(claimPayloads[0].target.rotation, 270);
  }
  finally {
    restores.reverse().forEach((restore) => restore());
  }
});

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

test("storage broken-state API is GM-only and forwards the exact row, value, and nested path", async () => {
  const gm = { active: true, id: "gm", isGM: true };
  const storageActor = {
    type: "npc",
    flags: { [MODULE_ID]: { storage: { enabled: true } } },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  };
  const token = { actor: storageActor, name: "Сундук", uuid: "Scene.scene.Token.chest", flags: {} };
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
        getProperty(source, path) { return path.split(".").reduce((value, key) => value?.[key], source); },
        deepClone: (value) => structuredClone(value)
      }
    }),
    replaceGlobal("ui", { notifications: { error() {}, info() {}, warn() {} } }),
    replaceGlobal("game", game)
  ];

  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?storage-broken-api=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const writes = [];
    moduleApi.storageService.setRowBroken = async (...args) => {
      writes.push(args);
      return { state: "opened", manualRows: [] };
    };
    moduleApi.storageGroundPileService.refreshAfterStorageMutation = async () => {};

    game.user.isGM = false;
    await assert.rejects(
      moduleApi.setStorageRowBroken(token.uuid, "shield", true, { path: ["bag"] }),
      /только мастер/u
    );
    assert.deepEqual(writes, []);

    game.user.isGM = true;
    await moduleApi.setStorageRowBroken(token.uuid, "shield", true, { path: ["bag"] });
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0], token);
    assert.equal(writes[0][1], "shield");
    assert.equal(writes[0][2], true);
    assert.deepEqual(writes[0][3], { path: ["bag"] });
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
    actor.system.attributes.hp.value = 7;
    const driftedSnapshot = await moduleApi.getStorageSnapshot(token.uuid);
    assert.deepEqual(driftedSnapshot.rows.map((row) => row.sourceId), ["laty"]);
    const configured = await moduleApi.configureStorageToken(token.uuid, {
      baseName: "Тело Чемпиона",
      mixGeneratedLoot: true
    });
    assert.equal(configured.baseName, "Тело Чемпиона");
    assert.equal(configured.mixGeneratedLoot, true);
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
