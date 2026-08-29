import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { SpellAutomationRegistry } from "../scripts/combat/spell-automation-registry.js";
import { SpellInstanceRuntime } from "../scripts/combat/spell-instance-runtime.js";
import { SummonLifecycleRuntime } from "../scripts/combat/summon-lifecycle-runtime.js";
import { PrivilegedMutationGateway } from "../scripts/application/privileged-mutation-gateway.js";
import { TransportCompendiumService } from "../scripts/data/transport-compendium.js";
import { BuiltinStorageActorService } from "../scripts/data/builtin-storage-actor-service.js";
import { StorageOpenSoundService } from "../scripts/data/storage-open-sound-service.js?v=1.4.145-coin-icons-storage-sound";
import { GrappleAutomationService } from "../scripts/combat/grapple-automation-service.js";
import { GrappleMacroService } from "../scripts/combat/grapple-macro-service.js";
import { GrapplePlacementPreview } from "../scripts/combat/grapple-placement-preview.js";
import {
  COMMAND_REQUEST_TYPE,
  COMMAND_RESULT_TYPE
} from "../scripts/infrastructure/foundry/socket-command-bus.js";
import { SPELL_INSTANCE_MUTATION_COMMAND } from "../scripts/integrations/spell-instance-socket.js";
import { SUMMON_LIFECYCLE_MUTATION_COMMAND } from "../scripts/integrations/summon-lifecycle-socket.js";

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
    assert.ok(moduleApi.privilegedMutationGateway instanceof PrivilegedMutationGateway);
    assert.ok(moduleApi.builtinStorageActorService instanceof BuiltinStorageActorService);
    assert.equal("builtinCoinTemplateService" in moduleApi, false);
    assert.equal(typeof moduleApi.restoreBuiltinCoinTemplates, "undefined");
    assert.ok(moduleApi.storageOpenSoundService instanceof StorageOpenSoundService);
    assert.ok(moduleApi.grappleAutomationService instanceof GrappleAutomationService);
    assert.ok(moduleApi.grappleMacroService instanceof GrappleMacroService);
    assert.ok(moduleApi.grapplePlacementPreview instanceof GrapplePlacementPreview);
    assert.equal(typeof moduleApi.toggleGrapple, "function");
    assert.equal(typeof moduleApi.moveGrappled, "function");
    for (const hook of ["preUpdateToken", "deleteActiveEffect", "deleteToken", "canvasReady"]) {
      assert.ok((Hooks.listeners.get(hook)?.length ?? 0) >= 1, hook);
    }
    const restoredDocuments = {
      folder: { id: "storage-folder" },
      actors: [{ id: "copper" }]
    };
    moduleApi.builtinStorageActorService = {
      async sync() {
        return restoredDocuments;
      }
    };
    assert.equal(await moduleApi.restoreBuiltinStorageActors(), restoredDocuments);

    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      moduleApi.builtinStorageActorService = {
        async sync() {
          throw new Error("folder unavailable");
        }
      };
      assert.equal(await moduleApi.restoreBuiltinStorageActors(), null);
    }
    finally {
      console.warn = originalWarn;
    }
    assert.match(String(warnings[0]?.[0] ?? ""), /Failed to restore built-in storage actors/u);
    assert.ok(moduleApi.spellAutomationRegistry instanceof SpellAutomationRegistry);
    assert.ok(moduleApi.spellInstanceRuntime instanceof SpellInstanceRuntime);
    assert.ok(moduleApi.summonLifecycleRuntime instanceof SummonLifecycleRuntime);
    assert.equal(moduleApi.spellInstanceRuntime.activeOperationCount, 0);
    assert.equal(moduleApi.summonLifecycleRuntime.pendingClaimCount, 0);
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
    assert.equal(diagnostics.pendingSummonClaims, 0);
    assert.throws(() => diagnostics.recipes.push("instance:leak:v1"), TypeError);

    const summonProvider = moduleApi.registerSummonProvider({
      runtime: "summon",
      recipe: "composition-summon",
      version: 1
    });
    assert.equal(
      moduleApi.spellAutomationRegistry.resolve({ runtime: "summon", recipe: "composition-summon", version: 1 }),
      summonProvider
    );

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

    assert.equal(moduleApi.socketCommandBus.handleMessage({
      type: COMMAND_REQUEST_TYPE,
      command: SUMMON_LIFECYCLE_MUTATION_COMMAND,
      requestId: "invalid-summon-lifecycle-mutation",
      senderId: activeGm.id,
      payload: {}
    }, { transportSenderId: activeGm.id }), true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(emittedSocketMessages.find(({ message }) => (
      message?.type === COMMAND_RESULT_TYPE
      && message.command === SUMMON_LIFECYCLE_MUTATION_COMMAND
      && message.requestId === "invalid-summon-lifecycle-mutation"
    ))?.message.error?.code, "invalid-payload");

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

test("composition root owns grapple services, typed commands, public macros, and managed sync", async () => {
  const source = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
  assert.equal(source.match(/new GrappleAutomationService\(/gu)?.length, 1);
  assert.equal(source.match(/new GrappleMacroService\(/gu)?.length, 1);
  assert.equal(source.match(/new GrapplePlacementPreview\(/gu)?.length, 1);
  for (const command of [
    "GRAPPLE_TOGGLE_COMMAND",
    "GRAPPLE_PLACE_COMMAND",
    "GRAPPLE_DRAG_COMMAND",
    "GRAPPLE_RELEASE_AND_MOVE_COMMAND"
  ]) {
    assert.equal(source.match(new RegExp(`socketCommandBus\\.register\\(${command},`, "gu"))?.length, 1, command);
  }
  assert.match(source, /async toggleGrapple\(\)/u);
  assert.match(source, /async moveGrappled\(\)/u);
  assert.match(source, /await this\.grappleMacroService\.syncManagedDocuments\(\)/u);
  assert.match(source, /await this\.grappleAutomationService\.reconcileScene\(globalThis\.canvas\.scene\)/u);
});

test("composition root exposes safe public city reads and GM-only presentation mutations", async () => {
  const source = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /import\s+\{\s*buildPublicCitySnapshot,\s*buildPublicEconomySnapshot\s*\}\s+from\s+"\.\/application\/public-economy-read-model\.js";/u
  );
  for (const methodName of [
    "getPublicCitySnapshot",
    "getPublicEconomySnapshot",
    "getCityPresentation",
    "updateCityPresentation",
    "resetCityPresentation",
    "refreshCityViews"
  ]) {
    assert.match(source, new RegExp(`(?:async\\s+)?${methodName}\\(`, "u"), methodName);
  }
  assert.equal(source.match(/this\.cityApps\s*=\s*new Map\(\)/gu)?.length, 1);
  assert.doesNotMatch(source, /publicCityApps|playerCityApps|new PublicCityApp/u);
  assert.match(source, /return this\.openTraderV2\(cityId, traderKey, options\)/u);

  const publicCityStart = source.indexOf("  async getPublicCitySnapshot(cityId)");
  const publicCityEnd = source.indexOf("\n  async getPublicEconomySnapshot()", publicCityStart);
  assert.notEqual(publicCityStart, -1);
  assert.notEqual(publicCityEnd, -1);
  const publicCityMethod = source.slice(publicCityStart, publicCityEnd);
  assert.match(publicCityMethod, /return buildPublicCitySnapshot\(/u);
  assert.doesNotMatch(publicCityMethod, /return this\.getCitySnapshot\(cityId\)/u);

  const updateStart = source.indexOf("  async updateCityPresentation(cityId, patch = {})");
  const updateEnd = source.indexOf("\n  async resetCityPresentation", updateStart);
  assert.notEqual(updateStart, -1);
  assert.notEqual(updateEnd, -1);
  const updateMethodSource = source.slice(updateStart, updateEnd);
  assert.match(updateMethodSource, /privilegedMutationGateway\.mutate\(ECONOMY_CITY_PRESENTATION_UPDATE_COMMAND/u);
  assert.doesNotMatch(updateMethodSource, /game\.user\?\.isGM/u);
  assert.match(updateMethodSource, /refreshCityViews\(\{ cityIds: \[cityId\] \}\)/u);
});

test("composition root owns one inventory ingress graph and one batch dispatch helper", async () => {
  const source = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /\.\/data\/inventory-service\.js\?v=1\.4\.177-integer-dismantle-repair/u,
    "inventory-service cache key must change with the ingress-rule command export surface"
  );
  assert.equal(source.match(/new InventoryIngressRuleCompilerCache\(/gu)?.length, 1);
  assert.equal(source.match(/new InventoryIngressPlanner\(/gu)?.length, 1);
  for (const command of [
    "INVENTORY_INGRESS_LOOTGEN_COMMAND"
  ]) {
    assert.equal(source.match(new RegExp(`register\\(${command},`, "gu"))?.length, 1, command);
  }
  for (const command of [
    "INVENTORY_INGRESS_RULE_CREATE_COMMAND",
    "INVENTORY_INGRESS_RULE_UPDATE_COMMAND",
    "INVENTORY_INGRESS_RULE_DELETE_COMMAND"
  ]) {
    assert.equal(source.match(new RegExp(`registerInventoryOrganizationMutation\\(\\s*${command},`, "gu"))?.length, 1, command);
  }
  for (const method of [
    "getInventoryIngressRuleState",
    "createInventoryIngressRule",
    "updateInventoryIngressRule",
    "deleteInventoryIngressRule",
    "claimLootgenChatAllToInventory",
    "claimStorageAll",
    "importInventoryDrop"
  ]) {
    assert.match(source, new RegExp(`(?:async\\s+)?${method}\\(`, "u"), method);
  }
  assert.match(source, /async #dispatchInventoryIngress\(/u);
  assert.equal(source.match(/game\.rebreyaMain\s*=\s*moduleApi/gu)?.length, 1);
  assert.equal(source.match(/module\.api\s*=\s*moduleApi/gu)?.length, 1);
  assert.doesNotMatch(source, /InventoryIngressFilterApp|new\s+InventoryIngress.*Application/u);
  assert.doesNotMatch(source, /Hooks\.on\(["']createItem["'][\s\S]{0,300}inventoryIngress/iu);
});
