import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { SpellAutomationRegistry } from "../scripts/combat/spell-automation-registry.js";
import { SpellInstanceRuntime } from "../scripts/combat/spell-instance-runtime.js";
import { TransportCompendiumService } from "../scripts/data/transport-compendium.js";
import {
  COMMAND_REQUEST_TYPE,
  COMMAND_RESULT_TYPE
} from "../scripts/infrastructure/foundry/socket-command-bus.js";
import { SPELL_INSTANCE_MUTATION_COMMAND } from "../scripts/integrations/spell-instance-socket.js";

function createHooks() {
  const onceCallbacks = new Map();
  const listeners = new Map();
  return {
    onceCallbacks,
    listeners,
    once(name, callback) {
      onceCallbacks.set(name, callback);
    },
    on(name, callback) {
      const callbacks = listeners.get(name) ?? [];
      callbacks.push(callback);
      listeners.set(name, callbacks);
      return callbacks.length;
    }
  };
}

function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
      return;
    }
    delete globalThis[name];
  };
}

test("ready composes spell automation on one registry alongside legacy hook registrations", async () => {
  const Hooks = createHooks();
  const module = {};
  const emittedSocketMessages = [];
  const activeGm = { active: true, id: "gm", isGM: true };
  let actorLookups = 0;
  let timerCalls = 0;
  const restores = [
    replaceGlobal("Hooks", Hooks),
    replaceGlobal("Actor", class Actor {}),
    replaceGlobal("Item", class Item {}),
    replaceGlobal("Macro", class Macro {}),
    replaceGlobal("CONFIG", {}),
    replaceGlobal("fromUuid", async () => {
      actorLookups += 1;
      return null;
    }),
    replaceGlobal("setTimeout", (...args) => {
      timerCalls += 1;
      return globalThis.setImmediate(...args);
    }),
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
    replaceGlobal("game", {
      modules: new Map([["rebreya-main", module]]),
      socket: {
        emit(channel, message) {
          emittedSocketMessages.push({ channel, message });
        },
        on() {}
      },
      system: { id: "dnd5e" },
      user: activeGm,
      users: { activeGM: activeGm, contents: [activeGm] },
      messages: { contents: [] },
      settings: { get: () => false }
    })
  ];

  try {
    const { RebreyaMainModule } = await import(new URL("../scripts/main.js?composition-test", import.meta.url));
    RebreyaMainModule.prototype.initialize = async () => {};

    await Hooks.onceCallbacks.get("ready")();

    const moduleApi = module.api;
    assert.ok(moduleApi.spellAutomationRegistry instanceof SpellAutomationRegistry);
    assert.ok(moduleApi.spellInstanceRuntime instanceof SpellInstanceRuntime);
    assert.equal(moduleApi.spellInstanceRuntime.activeOperationCount, 0);
    assert.equal(moduleApi.spellAutomationHookBridge.registry, moduleApi.spellAutomationRegistry);
    assert.ok(moduleApi.spellInterceptionRuntime);
    assert.ok(moduleApi.spellAreaRuntime);
    assert.equal(typeof moduleApi.spellAutomationService?.initialize, "function");
    assert.ok(moduleApi.transportCompendium instanceof TransportCompendiumService);
    assert.equal(
      moduleApi.spellAutomationRegistry.resolve({ runtime: "instance", recipe: "melfs-minute-meteors", version: 1 }),
      moduleApi.melfsMinuteMeteorsRecipe
    );
    const diagnostics = moduleApi.getSpellAutomationDiagnostics();
    assert.ok(Object.isFrozen(diagnostics));
    assert.ok(Object.isFrozen(diagnostics.recipes));
    assert.deepEqual(diagnostics.recipes, ["instance:melfs-minute-meteors:v1"]);
    assert.equal(diagnostics.activeOperations, 0);
    assert.throws(() => diagnostics.recipes.push("instance:leak:v1"), TypeError);

    assert.equal(moduleApi.socketCommandBus.handleMessage({
      type: COMMAND_REQUEST_TYPE,
      command: SPELL_INSTANCE_MUTATION_COMMAND,
      requestId: "invalid-spell-instance-mutation",
      senderId: activeGm.id,
      payload: {}
    }, { transportSenderId: activeGm.id }), true);
    await new Promise((resolve) => setImmediate(resolve));
    const response = emittedSocketMessages.find(({ message }) => (
      message?.type === COMMAND_RESULT_TYPE
      && message.command === SPELL_INSTANCE_MUTATION_COMMAND
      && message.requestId === "invalid-spell-instance-mutation"
    ));
    assert.deepEqual(response?.message, {
      type: COMMAND_RESULT_TYPE,
      command: SPELL_INSTANCE_MUTATION_COMMAND,
      requestId: "invalid-spell-instance-mutation",
      forUserId: activeGm.id,
      senderId: activeGm.id,
      ok: false,
      error: {
        code: "invalid-payload",
        message: "Socket command payload is invalid"
      }
    });
    assert.equal(actorLookups, 0);
    assert.equal(timerCalls, 0);
    assert.ok(emittedSocketMessages.every(({ message }) => message?.type === COMMAND_RESULT_TYPE));

    const handlers = { preUseActivity: () => false, postSummon: () => true };
    moduleApi.spellInterceptionRuntime.registerRecipe({ recipe: "counterspell", version: 1, handlers });
    moduleApi.spellAreaRuntime.registerRecipe({ recipe: "moonbeam", version: 1, handlers: {} });
    assert.equal(
      moduleApi.spellAutomationRegistry.resolve({ runtime: "interception", recipe: "counterspell", version: 1 })?.handlers?.preUseActivity,
      handlers.preUseActivity
    );
    assert.equal(
      moduleApi.spellAutomationRegistry.resolve({ runtime: "area", recipe: "moonbeam", version: 1 })?.handlers?.preUseActivity,
      undefined
    );

    const activity = {
      flags: { "rebreya-main": { spellAutomation: { runtime: "interception", recipe: "counterspell", version: 1 } } }
    };
    const preUseResults = Hooks.listeners.get("dnd5e.preUseActivity").map((callback) => callback(activity, {}, {}, {}));
    assert.ok(preUseResults.includes(false));
    assert.ok(Hooks.listeners.has("combatTurn"));
    assert.ok(Hooks.listeners.has("dnd5e.postSummon"));
    assert.equal(
      await Promise.all(Hooks.listeners.get("dnd5e.postSummon").map((callback) => callback(activity, {}, [], {})))
        .then((results) => results.filter((result) => result === true).length),
      Hooks.listeners.get("dnd5e.postSummon").length
    );
  }
  finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("composition root synchronizes the managed transport Actor compendium", async () => {
  const source = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");

  assert.match(source, /import\s+\{\s*TransportCompendiumService\s*\}\s+from\s+"\.\/data\/transport-compendium\.js";/u);
  assert.match(source, /this\.transportCompendium\s*=\s*new TransportCompendiumService/u);
  assert.match(source, /await this\.transportCompendium\.sync\(\);/u);
  assert.match(source, /registerTransportGroupDropHooks\(moduleApi,\s*\{\s*Hooks\s*\}\);/u);
  assert.match(source, /registerTransportVehicleSheetHooks\(moduleApi,\s*\{\s*Hooks\s*\}\);/u);
});
