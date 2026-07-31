import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { SpellAutomationRegistry } from "../scripts/combat/spell-automation-registry.js";
import { TransportCompendiumService } from "../scripts/data/transport-compendium.js";

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
  const restores = [
    replaceGlobal("Hooks", Hooks),
    replaceGlobal("Actor", class Actor {}),
    replaceGlobal("Item", class Item {}),
    replaceGlobal("Macro", class Macro {}),
    replaceGlobal("CONFIG", {}),
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
      socket: { on() {} },
      system: { id: "dnd5e" },
      user: {},
      users: { contents: [] },
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
    assert.equal(moduleApi.spellAutomationHookBridge.registry, moduleApi.spellAutomationRegistry);
    assert.ok(moduleApi.spellInterceptionRuntime);
    assert.ok(moduleApi.spellAreaRuntime);
    assert.equal(typeof moduleApi.spellAutomationService?.initialize, "function");
    assert.ok(moduleApi.transportCompendium instanceof TransportCompendiumService);

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
});
