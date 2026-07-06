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
  globalThis.game = {};

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

    await listeners.find((entry) => entry.hookName === "targetToken").listener();
    await listeners.find((entry) => entry.hookName === "dnd5e.preRollAttack").listener({ id: "dnd5e" }, {}, {});
    await listeners.find((entry) => entry.hookName === "midi-qol.preAttackRoll").listener({ id: "midi" });

    assert.deepEqual(handled, ["target", { id: "dnd5e" }, { id: "midi" }]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});
