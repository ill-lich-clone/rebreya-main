import test from "node:test";
import assert from "node:assert/strict";

const {
  EnvironmentAutomationService,
  computeRebreyaSurrounding
} = await import("../scripts/combat/environment-automation-service.js");
const { registerCombatHooks } = await import("../scripts/combat/hooks.js");

function createToken(id, x, y, disposition, actor = {}) {
  return {
    id,
    x,
    y,
    center: { x: x + 50, y: y + 50 },
    actor: { uuid: `Actor.${id}`, ...actor },
    document: {
      uuid: `Scene.Token.${id}`,
      width: 1,
      height: 1,
      disposition
    }
  };
}

test("Rebreya environment detects a target surrounded by two opposite hostiles", () => {
  const target = createToken("target", 100, 100, 1);
  const attacker = createToken("attacker", 0, 100, -1);
  const ally = createToken("ally", 200, 100, -1);
  const bystander = createToken("bystander", 100, 0, 1);

  assert.equal(computeRebreyaSurrounding({
    attackerToken: attacker,
    targetToken: target,
    tokens: [target, attacker, ally, bystander],
    gridSize: 100
  }).surrounded, true);
});

test("Rebreya environment applies surrounded and open-position statuses", async () => {
  const targetActor = { uuid: "Actor.target" };
  const target = createToken("target", 100, 100, 1, targetActor);
  const attacker = createToken("attacker", 0, 100, -1);
  const ally = createToken("ally", 200, 100, -1);
  const statusCalls = [];
  const moduleApi = {
    combatStatusService: {
      getStatus() {
        return { active: false, meta: {} };
      },
      async setStatus(...args) {
        statusCalls.push(args);
        return true;
      }
    }
  };
  const service = new EnvironmentAutomationService(moduleApi, {
    getCanvas: () => ({
      grid: { size: 100, sizeX: 100, sizeY: 100 },
      tokens: { placeables: [target, attacker, ally] }
    })
  });

  assert.equal(await service.updateTargetEnvironment(attacker, target), true);
  assert.deepEqual(statusCalls.map(([, statusId]) => statusId), [
    "rebreya-surrounded",
    "rebreya-open-position"
  ]);
  assert.deepEqual(statusCalls.map(([, , options]) => options.meta), [
    {
      source: "rebreya-environment",
      sourceActorUuid: "Actor.attacker",
      version: "surrounded-ac-1"
    },
    {
      source: "rebreya-environment",
      sourceActorUuid: "Actor.attacker",
      version: "surrounded-ac-1"
    }
  ]);
});

test("Rebreya environment routes status changes through the module combat status API", async () => {
  const targetActor = { id: "target", uuid: "Actor.target" };
  const target = createToken("target", 100, 100, 1, targetActor);
  const attacker = createToken("attacker", 0, 100, -1);
  const ally = createToken("ally", 200, 100, -1);
  const routedCalls = [];
  const moduleApi = {
    getCombatStatus() {
      return { active: false, meta: {} };
    },
    async setCombatStatus(...args) {
      routedCalls.push(args);
      return true;
    },
    combatStatusService: {
      getStatus() {
        throw new Error("low-level status service should not be used");
      },
      async setStatus() {
        throw new Error("low-level status service should not be used");
      }
    }
  };
  const service = new EnvironmentAutomationService(moduleApi, {
    getCanvas: () => ({
      grid: { size: 100, sizeX: 100, sizeY: 100 },
      tokens: { placeables: [target, attacker, ally] }
    })
  });

  assert.equal(await service.updateTargetEnvironment(attacker, target), true);
  assert.deepEqual(routedCalls.map(([, statusId]) => statusId), [
    "rebreya-surrounded",
    "rebreya-open-position"
  ]);
});

test("Rebreya environment does not rewrite current automatic statuses", async () => {
  const targetActor = { uuid: "Actor.target" };
  const target = createToken("target", 100, 100, 1, targetActor);
  const attacker = createToken("attacker", 0, 100, -1);
  const ally = createToken("ally", 200, 100, -1);
  const statusCalls = [];
  const moduleApi = {
    combatStatusService: {
      getStatus() {
        return {
          active: true,
          meta: {
            source: "rebreya-environment",
            sourceActorUuid: "Actor.attacker",
            version: "surrounded-ac-1"
          }
        };
      },
      async setStatus(...args) {
        statusCalls.push(args);
        return true;
      }
    }
  };
  const service = new EnvironmentAutomationService(moduleApi, {
    getCanvas: () => ({
      grid: { size: 100, sizeX: 100, sizeY: 100 },
      tokens: { placeables: [target, attacker, ally] }
    })
  });

  assert.equal(await service.updateTargetEnvironment(attacker, target), true);
  assert.deepEqual(statusCalls, []);
});

test("Rebreya environment refreshes stale automatic status metadata once", async () => {
  const targetActor = { uuid: "Actor.target" };
  const target = createToken("target", 100, 100, 1, targetActor);
  const attacker = createToken("attacker", 0, 100, -1);
  const ally = createToken("ally", 200, 100, -1);
  const statuses = new Map([
    ["rebreya-surrounded", {
      active: true,
      meta: {
        source: "rebreya-environment",
        sourceActorUuid: "Actor.attacker"
      }
    }],
    ["rebreya-open-position", {
      active: true,
      meta: {
        source: "rebreya-environment",
        sourceActorUuid: "Actor.attacker"
      }
    }]
  ]);
  const statusCalls = [];
  const moduleApi = {
    combatStatusService: {
      getStatus(_actor, statusId) {
        return statuses.get(statusId) ?? { active: false, meta: {} };
      },
      async setStatus(_actor, statusId, options) {
        statusCalls.push([statusId, options]);
        statuses.set(statusId, { active: true, meta: options.meta });
        return true;
      }
    }
  };
  const service = new EnvironmentAutomationService(moduleApi, {
    getCanvas: () => ({
      grid: { size: 100, sizeX: 100, sizeY: 100 },
      tokens: { placeables: [target, attacker, ally] }
    })
  });

  assert.equal(await service.updateTargetEnvironment(attacker, target), true);
  assert.equal(await service.updateTargetEnvironment(attacker, target), true);
  assert.deepEqual(statusCalls.map(([statusId]) => statusId), [
    "rebreya-surrounded",
    "rebreya-open-position"
  ]);
  assert.deepEqual(statusCalls.map(([, options]) => options.meta), [
    {
      source: "rebreya-environment",
      sourceActorUuid: "Actor.attacker",
      version: "surrounded-ac-1"
    },
    {
      source: "rebreya-environment",
      sourceActorUuid: "Actor.attacker",
      version: "surrounded-ac-1"
    }
  ]);
});

test("Rebreya environment registers target and attack hooks", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const listeners = [];
  const handled = [];

  globalThis.Hooks = {
    on(hookName, listener) {
      listeners.push({ hookName, listener });
      return listeners.length;
    }
  };
  globalThis.game = { user: { id: "player-a" } };

  try {
    registerCombatHooks({
      environmentAutomationService: {
        async updateCurrentTargetEnvironment() {
          handled.push("target");
        },
        async applyDnd5eAttackRollConfig(config) {
          handled.push(config);
        },
        async applyMidiPreAttackRoll(workflow) {
          handled.push(workflow);
        }
      }
    });

    const hookNames = listeners.map((entry) => entry.hookName);
    assert.ok(hookNames.includes("targetToken"));
    assert.ok(hookNames.includes("controlToken"));
    assert.ok(hookNames.includes("dnd5e.preRollAttack"));
    assert.ok(hookNames.includes("midi-qol.preAttackRoll"));

    const targetTokenHook = listeners.find((entry) => entry.hookName === "targetToken").listener;
    await targetTokenHook({ id: "player-b" });
    await targetTokenHook({ id: "player-a" });
    await listeners.find((entry) => entry.hookName === "dnd5e.preRollAttack").listener({ id: "dnd5e" }, {}, {});
    await listeners.find((entry) => entry.hookName === "midi-qol.preAttackRoll").listener({ id: "midi" });

    assert.deepEqual(handled, ["target", { id: "dnd5e" }, { id: "midi" }]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("firearm item sheet repair hook does not rerender item sheets", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const listeners = [];
  const repairedItems = [];

  globalThis.Hooks = {
    on(hookName, listener) {
      listeners.push({ hookName, listener });
      return listeners.length;
    }
  };
  globalThis.game = {};

  try {
    registerCombatHooks({
      combatAttackService: {
        async repairFirearmActivities(item) {
          repairedItems.push(item);
          return { updated: 1 };
        }
      }
    });

    const item = { id: "rifle" };
    let renderCalls = 0;
    listeners.find((entry) => entry.hookName === "renderItemSheet").listener({
      document: item,
      render() {
        renderCalls += 1;
      }
    });
    await Promise.resolve();

    assert.deepEqual(repairedItems, [item]);
    assert.equal(renderCalls, 0);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("reaction capability index receives targeted document invalidation hooks", () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const listeners = new Map();
  const calls = [];
  const activeScene = { id: "scene-1" };
  globalThis.Hooks = {
    on(hookName, listener) {
      listeners.set(hookName, listener);
      return listeners.size;
    }
  };
  globalThis.game = {};
  globalThis.canvas = { scene: activeScene };

  try {
    registerCombatHooks({
      reactionCapabilityIndex: {
        rebuildScene: (scene) => calls.push(["rebuildScene", scene]),
        refreshActor: (actor) => calls.push(["refreshActor", actor]),
        removeActor: (actor) => calls.push(["removeActor", actor]),
        refreshToken: (token) => calls.push(["refreshToken", token]),
        removeToken: (uuid) => calls.push(["removeToken", uuid]),
        invalidateScene: (sceneId) => calls.push(["invalidateScene", sceneId])
      }
    });

    for (const hookName of [
      "canvasReady",
      "createActor",
      "updateActor",
      "deleteActor",
      "createItem",
      "updateItem",
      "deleteItem",
      "createActiveEffect",
      "updateActiveEffect",
      "deleteActiveEffect",
      "createToken",
      "updateToken",
      "deleteToken",
      "updateUser",
      "deleteCombat"
    ]) {
      assert.equal(typeof listeners.get(hookName), "function", hookName);
    }

    const actor = { uuid: "Actor.hero" };
    const item = { parent: actor };
    const effect = { parent: actor };
    const tokenDocument = { uuid: "Scene.scene-1.Token.hero", actor, parent: activeScene };
    listeners.get("canvasReady")(activeScene);
    listeners.get("createActor")(actor);
    listeners.get("updateActor")(actor);
    listeners.get("deleteActor")(actor);
    listeners.get("createItem")(item);
    listeners.get("updateActiveEffect")(effect);
    listeners.get("createToken")(tokenDocument);
    listeners.get("deleteToken")(tokenDocument);
    listeners.get("updateUser")({ id: "owner" });
    listeners.get("deleteCombat")({ scene: { id: "scene-1" } });

    assert.deepEqual(calls, [
      ["rebuildScene", activeScene],
      ["refreshActor", actor],
      ["refreshActor", actor],
      ["removeActor", actor],
      ["refreshActor", actor],
      ["refreshActor", actor],
      ["refreshToken", tokenDocument],
      ["removeToken", tokenDocument.uuid],
      ["rebuildScene", activeScene],
      ["invalidateScene", "scene-1"]
    ]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
  }
});
