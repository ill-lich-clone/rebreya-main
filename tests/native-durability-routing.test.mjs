import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";

function users(activeGm, ...others) {
  const contents = [activeGm, ...others];
  return {
    activeGM: activeGm,
    contents,
    get(id) { return contents.find((user) => user.id === id) ?? null; }
  };
}

test("depleted native targets prompt once and apply the explicit GM choice", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const activeGm = { id: "gm-a", isGM: true, active: true };
  globalThis.Hooks = { once() {} };
  globalThis.game = { user: activeGm, users: users(activeGm) };
  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?native-outcome=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const token = { uuid: "Scene.scene.Token.chest", name: "Сундук", flags: { [MODULE_ID]: { objectDurability: { state: "intact" } } } };
    const calls = { damage: [], prompt: [], resolve: [] };
    moduleApi.nativeObjectDurabilityService = {
      async resolve(target) {
        return { kind: "chest", uuid: token.uuid, token: typeof target === "string" ? token : target };
      },
      async damage(target, options) {
        calls.damage.push([target, structuredClone(options)]);
        return { outcome: "depleted", nextFlag: { state: "intact", hp: { value: 0, max: 18 } } };
      },
      async resolveDepletion(target, choice, options) {
        calls.resolve.push([target, choice, structuredClone(options)]);
        token.flags[MODULE_ID].objectDurability.state = choice;
        return { outcome: choice };
      }
    };
    moduleApi.promptDurabilityOutcome = async (options) => {
      calls.prompt.push(options);
      return "broken";
    };

    const result = await moduleApi.damageItem(token, {
      amount: 18,
      damageType: "bludgeoning",
      mutationId: "damage-chest-1"
    });

    assert.deepEqual(result, { outcome: "broken" });
    assert.equal(calls.prompt.length, 1);
    assert.equal(calls.prompt[0].name, "Сундук");
    assert.deepEqual(calls.resolve, [[token, "broken", { mutationId: "damage-chest-1" }]]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("inactive GM routes neutral durability damage to the active GM command", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const emitted = [];
  const activeGm = { id: "gm-a", isGM: true, active: true };
  const inactiveGm = { id: "gm-b", isGM: true, active: true };
  globalThis.Hooks = { once() {} };
  globalThis.game = {
    user: inactiveGm,
    users: users(activeGm, inactiveGm),
    socket: { emit(channel, message) { emitted.push([channel, message]); } }
  };
  try {
    const {
      DURABILITY_TARGET_DAMAGE_COMMAND,
      RebreyaMainModule
    } = await import(`../scripts/main.js?native-route=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const token = { uuid: "Scene.scene.Token.chest" };
    moduleApi.nativeObjectDurabilityService.resolve = async () => ({ kind: "chest", uuid: token.uuid, token });

    const pending = moduleApi.damageDurabilityTarget(token, {
      amount: 9,
      damageType: "force",
      mutationId: "native-damage-1"
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(emitted.length, 1);
    const [channel, request] = emitted[0];
    assert.equal(channel, `module.${MODULE_ID}`);
    assert.equal(request.command, DURABILITY_TARGET_DAMAGE_COMMAND);
    assert.deepEqual(request.payload, {
      amount: 9,
      damageType: "force",
      mutationId: "native-damage-1",
      targetUuid: token.uuid
    });

    await moduleApi.handleSocketMessage({
      type: "rebreya.command.result",
      command: request.command,
      requestId: request.requestId,
      forUserId: inactiveGm.id,
      senderId: activeGm.id,
      ok: true,
      data: { outcome: "damaged" }
    }, activeGm.id);
    assert.deepEqual(await pending, { outcome: "damaged" });
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});

test("active GM validates and executes routed native destruction decisions", async () => {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const emitted = [];
  const activeGm = { id: "gm-a", isGM: true, active: true };
  const inactiveGm = { id: "gm-b", isGM: true, active: true };
  globalThis.Hooks = { once() {} };
  globalThis.game = {
    user: activeGm,
    users: users(activeGm, inactiveGm),
    socket: { emit(channel, message) { emitted.push([channel, message]); } }
  };
  try {
    const {
      DURABILITY_TARGET_DAMAGE_COMMAND,
      RebreyaMainModule
    } = await import(`../scripts/main.js?native-execute=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const token = { uuid: "Scene.scene.Token.chest", name: "Сундук", flags: { [MODULE_ID]: { objectDurability: { state: "intact" } } } };
    const damageCalls = [];
    moduleApi.nativeObjectDurabilityService = {
      async resolve() { return { kind: "chest", uuid: token.uuid, token }; },
      async damage(target, options) {
        damageCalls.push([target, structuredClone(options)]);
        return { outcome: "damaged" };
      }
    };

    await moduleApi.handleSocketMessage({
      type: "rebreya.command",
      command: DURABILITY_TARGET_DAMAGE_COMMAND,
      requestId: "native-request-1",
      senderId: inactiveGm.id,
      payload: {
        amount: 4,
        damageType: "slashing",
        mutationId: "native-mutation-1",
        targetUuid: token.uuid
      }
    }, inactiveGm.id);
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(damageCalls, [[token.uuid, {
      amount: 4,
      damageType: "slashing",
      mutationId: "native-mutation-1",
      targetUuid: token.uuid
    }]]);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0][1].ok, true);
    assert.deepEqual(emitted[0][1].data, { outcome: "damaged" });
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
  }
});
