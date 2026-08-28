import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID, REBREYA_GROUP_FLAGS, SETTINGS_KEYS } from "../scripts/constants.js";
import {
  COMMAND_REQUEST_TYPE,
  COMMAND_RESULT_TYPE,
  SOCKET_CHANNEL
} from "../scripts/infrastructure/foundry/socket-command-bus.js";
import { normalizeTravelState } from "../scripts/data/travel-service.js";
import { normalizeGroupTransportState } from "../scripts/data/group-context-service.js";
import { requestSettingsUpdate } from "../scripts/legacy/settings-socket-relay.js";

let groupRegistryMutationCommands = {};
try {
  groupRegistryMutationCommands = await import(
    "../scripts/application/group-registry-mutation-commands.js"
  );
}
catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

let downtimeMutationCommands = {};
try {
  downtimeMutationCommands = await import(
    "../scripts/application/downtime-mutation-commands.js"
  );
}
catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

const originalHooks = globalThis.Hooks;
globalThis.Hooks = { once() {}, on() {} };
const { RebreyaMainModule } = await import(`../scripts/main.js?group-command-dispatch=${Date.now()}`);
if (originalHooks === undefined) {
  delete globalThis.Hooks;
}
else {
  globalThis.Hooks = originalHooks;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createUsers(users, activeGmId) {
  const collection = new Map(users.map((user) => [String(user.id), user]));
  collection.contents = users;
  collection.activeGM = collection.get(String(activeGmId)) ?? null;
  return collection;
}

function createCharacter(id, ownerId) {
  return {
    id,
    type: "character",
    ownership: { [ownerId]: 3 }
  };
}

function createGroup(id, members = []) {
  return {
    id,
    type: "group",
    system: { members: members.map((actor) => ({ actor })) },
    getFlag(moduleId, key) {
      return moduleId === MODULE_ID && key === REBREYA_GROUP_FLAGS.MANAGED ? true : undefined;
    }
  };
}

function installFixture({ currentUserId = "gm-a", includeGroupB = false } = {}) {
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  const previousUi = globalThis.ui;
  const gmA = { id: "gm-a", isGM: true, active: true };
  const gmB = { id: "gm-b", isGM: true, active: true };
  const playerA = { id: "player-a", isGM: false, active: true };
  const playerB = { id: "player-b", isGM: false, active: true };
  const memberA = createCharacter("character-a", playerA.id);
  const memberB = createCharacter("character-b", playerB.id);
  const groupA = createGroup("group-a", [memberA]);
  const groupB = createGroup("group-b", [memberB]);
  const users = createUsers([gmA, gmB, playerA, playerB], gmA.id);
  const actors = includeGroupB ? [groupA, memberA, groupB, memberB] : [groupA, memberA];
  const emitted = [];
  const writes = [];
  let activeSettingWrites = 0;
  let maxConcurrentSettingWrites = 0;
  const store = {
    [SETTINGS_KEYS.GROUP_STATE]: {
      version: 1,
      activeGroupActorId: groupA.id,
      groupsById: {
        [groupA.id]: {
          version: 1,
          groupActorId: groupA.id,
          calendar: { version: 1, isoDate: "1200-01-01", timeOfDaySeconds: 3600 },
          travelState: { version: 1, originCityId: "old", destinationCityId: "", mode: "land", traveledMiles: 2 },
          traderState: { retained: "yes" },
          questState: { unlocksByQuestId: { quest: true } }
        }
      }
    },
    [SETTINGS_KEYS.CALENDAR_STATE]: { version: 1, isoDate: "1300-01-01", timeOfDaySeconds: 0 },
    [SETTINGS_KEYS.COSMOLOGY_STATE]: { version: 1, mechanusEnabled: false, retained: "yes" },
    [SETTINGS_KEYS.CONNECTION_STATES]: { retainedConnection: false },
    [SETTINGS_KEYS.CITY_PRESENTATION_OVERRIDES]: { retainedCity: { description: "Retained" } },
    [SETTINGS_KEYS.REFERENCE_NOTES]: { "city::retained": { description: "Retained" } },
    [SETTINGS_KEYS.TRADE_ROUTE_OVERRIDES]: { retainedRoute: { description: "Retained", additionalPricePercent: 3 } },
    [SETTINGS_KEYS.STATE_POLICIES]: { retainedState: { taxPercent: 1, generalDutyPercent: 2, bilateralDuties: {} } }
  };
  if (includeGroupB) {
    store[SETTINGS_KEYS.GROUP_STATE].groupsById[groupB.id] = {
      version: 1,
      groupActorId: groupB.id,
      calendar: { version: 1, isoDate: "1200-01-31", timeOfDaySeconds: 7200 }
    };
  }

  globalThis.foundry = {
    utils: {
      deepClone: clone,
      mergeObject: (base, update) => ({ ...clone(base), ...clone(update) })
    }
  };
  globalThis.ui = { notifications: {} };
  globalThis.game = {
    user: users.get(currentUserId),
    users,
    actors: {
      contents: actors,
      get: (actorId) => actors.find((actor) => actor.id === actorId) ?? null
    },
    messages: { contents: [] },
    settings: {
      settings: new Map([
        [`${MODULE_ID}.${SETTINGS_KEYS.GROUP_STATE}`, { scope: "world" }],
        [`${MODULE_ID}.${SETTINGS_KEYS.COSMOLOGY_STATE}`, { scope: "world" }]
      ]),
      get(moduleId, key) {
        assert.equal(moduleId, MODULE_ID);
        return clone(store[key]);
      },
      async set(moduleId, key, value) {
        assert.equal(moduleId, MODULE_ID);
        activeSettingWrites += 1;
        maxConcurrentSettingWrites = Math.max(maxConcurrentSettingWrites, activeSettingWrites);
        try {
          await Promise.resolve();
          writes.push({ key, value: clone(value) });
          store[key] = clone(value);
          return value;
        }
        finally {
          activeSettingWrites -= 1;
        }
      }
    },
    socket: {
      emit(channel, message) {
        emitted.push({ channel, message: clone(message) });
      }
    }
  };

  return {
    actors,
    emitted,
    groupA,
    groupB,
    memberA,
    memberB,
    store,
    get maxConcurrentSettingWrites() {
      return maxConcurrentSettingWrites;
    },
    users: { gmA, gmB, playerA, playerB },
    writes,
    restore() {
      globalThis.game = previousGame;
      globalThis.foundry = previousFoundry;
      globalThis.ui = previousUi;
    }
  };
}

function buildLootgenIngressPlan(groupActorId, rowIds, { folderId = null } = {}) {
  return {
    version: 1,
    groupActorId,
    rulesRevision: 2,
    requestedFolderId: folderId,
    rows: rowIds.map((sourceKey) => ({
      sourceKey,
      identity: {
        sourceType: "gear",
        sourceId: sourceKey,
        documentType: "loot",
        durabilityState: "ineligible",
        quantity: 1
      },
      quantity: 1,
      matchedRuleId: null,
      action: { type: "legacy", folderId }
    })),
    rootOverrideSourceKeys: []
  };
}

function installCombatStatusGlobals() {
  const previousActor = globalThis.Actor;
  const previousActiveEffect = globalThis.ActiveEffect;
  const previousConfig = globalThis.CONFIG;
  const previousConst = globalThis.CONST;

  class TestActor {}
  class TestActiveEffect {}
  globalThis.Actor = TestActor;
  globalThis.ActiveEffect = TestActiveEffect;
  globalThis.CONFIG = { statusEffects: [] };
  globalThis.CONST = {
    ACTIVE_EFFECT_MODES: {
      ADD: 2
    }
  };

  return {
    Actor: TestActor,
    ActiveEffect: TestActiveEffect,
    restore() {
      if (previousActor === undefined) {
        delete globalThis.Actor;
      }
      else {
        globalThis.Actor = previousActor;
      }
      if (previousActiveEffect === undefined) {
        delete globalThis.ActiveEffect;
      }
      else {
        globalThis.ActiveEffect = previousActiveEffect;
      }
      if (previousConfig === undefined) {
        delete globalThis.CONFIG;
      }
      else {
        globalThis.CONFIG = previousConfig;
      }
      if (previousConst === undefined) {
        delete globalThis.CONST;
      }
      else {
        globalThis.CONST = previousConst;
      }
    }
  };
}

function createCombatActor(ActorClass, ActiveEffectClass, {
  id,
  type = "npc",
  ownerId = "",
  isOwner = false
} = {}) {
  const actor = new ActorClass();
  actor.id = id;
  actor.uuid = `Actor.${id}`;
  actor.type = type;
  actor.isOwner = isOwner;
  actor.ownership = ownerId ? { [ownerId]: 3 } : {};
  actor.effects = { contents: [] };
  actor.createEmbeddedDocuments = async (_type, documents) => {
    const created = documents.map((document, index) => {
      const effect = new ActiveEffectClass();
      Object.assign(effect, clone(document), {
        id: `effect-${actor.effects.contents.length + index + 1}`,
        _id: `effect-${actor.effects.contents.length + index + 1}`,
        parent: actor,
        getFlag(scope, key) {
          return this.flags?.[scope]?.[key];
        },
        async update(patch) {
          Object.assign(this, patch);
          return this;
        },
        async delete() {
          actor.effects.contents = actor.effects.contents.filter((entry) => entry !== this);
          return this;
        }
      });
      return effect;
    });
    actor.effects.contents.push(...created);
    return created;
  };
  return actor;
}

function commandRequest(command, senderId, payload, requestId = `${command}-request`) {
  return {
    type: COMMAND_REQUEST_TYPE,
    command,
    requestId,
    senderId,
    payload
  };
}

async function flushCommands() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function resultFor(fixture, requestId) {
  return fixture.emitted
    .map((entry) => entry.message)
    .find((message) => message.type === COMMAND_RESULT_TYPE && message.requestId === requestId);
}

test("group registry mutation commands expose exact group Actor payloads", () => {
  assert.equal(
    groupRegistryMutationCommands.GROUP_REGISTRY_REGISTER_COMMAND,
    "group.registry.register"
  );
  assert.equal(
    groupRegistryMutationCommands.GROUP_REGISTRY_ACTIVATE_COMMAND,
    "group.registry.activate"
  );
  assert.equal(
    groupRegistryMutationCommands.GROUP_INVENTORY_MERGE_LEGACY_COMMAND,
    "group.inventory.merge-legacy"
  );
  for (const validate of [
    groupRegistryMutationCommands.isValidGroupRegistryRegisterPayload,
    groupRegistryMutationCommands.isValidGroupRegistryActivatePayload,
    groupRegistryMutationCommands.isValidGroupInventoryMergeLegacyPayload
  ]) {
    assert.equal(validate?.({ groupActorId: "group-a" }), true);
    assert.equal(validate?.({ groupActorId: " group-a " }), false);
    assert.equal(validate?.({ groupActorId: "group-a", extra: true }), false);
    assert.equal(validate?.({ groupActorId: "" }), false);
  }
});

test("inactive GM routes group registry writers through typed commands and players cannot write locally", async () => {
  const fixture = installFixture({ currentUserId: "gm-b", includeGroupB: true });
  try {
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    let inventoryMutationCalls = 0;
    moduleApi.groupContextService.registerGroup = async (...args) => {
      calls.push(["register", ...args]);
      return { groupId: args[0] };
    };
    moduleApi.groupContextService.setActiveGroup = async (...args) => {
      calls.push(["activate", ...args]);
      return { groupId: args[0] };
    };
    moduleApi.inventoryService.mergeLegacyInventoryIntoGroup = async (...args) => {
      calls.push(["merge", ...args]);
      return { groupActorId: args[0], noop: true };
    };
    moduleApi.runInventoryMutation = async (operation) => {
      inventoryMutationCalls += 1;
      return operation();
    };

    const invoke = async (command, operation, data) => {
      const pending = operation();
      await flushCommands();
      const outbound = fixture.emitted.at(-1)?.message;
      assert.deepEqual(outbound, {
        type: COMMAND_REQUEST_TYPE,
        command,
        requestId: outbound?.requestId,
        senderId: fixture.users.gmB.id,
        payload: { groupActorId: fixture.groupB.id }
      });
      assert.equal(fixture.writes.length, 0);
      await moduleApi.handleSocketMessage({
        type: COMMAND_RESULT_TYPE,
        command,
        requestId: outbound.requestId,
        forUserId: fixture.users.gmB.id,
        senderId: fixture.users.gmA.id,
        ok: true,
        data
      });
      assert.deepEqual(await pending, data);
    };

    await invoke(
      "group.registry.register",
      () => moduleApi.registerPartyGroup(fixture.groupB.id),
      { groupId: fixture.groupB.id }
    );
    await invoke(
      "group.registry.activate",
      () => moduleApi.setActivePartyGroup(fixture.groupB.id),
      { groupId: fixture.groupB.id }
    );
    await invoke(
      "group.inventory.merge-legacy",
      () => moduleApi.mergeLegacyInventoryIntoGroup(fixture.groupB.id),
      { groupActorId: fixture.groupB.id, noop: true }
    );
    assert.deepEqual(calls, []);
    assert.equal(inventoryMutationCalls, 0);

    globalThis.game.user = fixture.users.gmA;
    const denied = commandRequest(
      "group.registry.register",
      fixture.users.playerA.id,
      { groupActorId: fixture.groupA.id },
      "group-register-player"
    );
    await moduleApi.handleSocketMessage(denied);
    await flushCommands();
    assert.equal(resultFor(fixture, denied.requestId)?.error?.code, "unauthorized");
    assert.deepEqual(calls, []);
    assert.equal(fixture.writes.length, 0);
  }
  finally {
    fixture.restore();
  }
});

test("RebreyaMainModule dispatches an authorized strict group.calendar.patch command", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const request = commandRequest(
      "group.calendar.patch",
      fixture.users.playerA.id,
      { groupActorId: fixture.groupA.id, patch: { isoDate: "1200-02-03" } },
      "calendar-valid"
    );

    await moduleApi.handleSocketMessage(request);
    await flushCommands();

    assert.equal(fixture.store[SETTINGS_KEYS.GROUP_STATE].groupsById[fixture.groupA.id].calendar.isoDate, "1200-02-03");
    assert.equal(fixture.store[SETTINGS_KEYS.GROUP_STATE].groupsById[fixture.groupA.id].calendar.timeOfDaySeconds, 3600);
    assert.deepEqual(resultFor(fixture, request.requestId), {
      type: COMMAND_RESULT_TYPE,
      command: request.command,
      requestId: request.requestId,
      forUserId: fixture.users.playerA.id,
      senderId: fixture.users.gmA.id,
      ok: true,
      data: { version: 1, isoDate: "1200-02-03", timeOfDaySeconds: 3600 }
    });
  }
  finally {
    fixture.restore();
  }
});

test("group.calendar.patch accepts valid five- and six-digit calendar years", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const cases = [
      ["calendar-year-10000", "10000-02-03"],
      ["calendar-year-100000", "100000-02-03"]
    ];

    for (const [requestId, isoDate] of cases) {
      await moduleApi.handleSocketMessage(commandRequest(
        "group.calendar.patch",
        fixture.users.playerA.id,
        { groupActorId: fixture.groupA.id, patch: { isoDate } },
        requestId
      ));
    }
    await flushCommands();

    for (const [requestId, isoDate] of cases) {
      assert.equal(resultFor(fixture, requestId)?.ok, true);
      assert.equal(resultFor(fixture, requestId)?.data?.isoDate, isoDate);
    }
    assert.equal(
      fixture.store[SETTINGS_KEYS.GROUP_STATE].groupsById[fixture.groupA.id].calendar.isoDate,
      "100000-02-03"
    );
  }
  finally {
    fixture.restore();
  }
});

test("group.calendar.patch rejects invalid shapes and a sender outside the requested group", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const cases = [
      ["empty", fixture.users.playerA.id, { groupActorId: fixture.groupA.id, patch: {} }, "invalid-payload"],
      ["extra", fixture.users.playerA.id, { groupActorId: fixture.groupA.id, patch: { isoDate: "1200-02-03", extra: true } }, "invalid-payload"],
      ["date", fixture.users.playerA.id, { groupActorId: fixture.groupA.id, patch: { isoDate: "1200-02-30" } }, "invalid-payload"],
      ["time", fixture.users.playerA.id, { groupActorId: fixture.groupA.id, patch: { timeOfDaySeconds: 86400 } }, "invalid-payload"],
      ["owner", fixture.users.playerB.id, { groupActorId: fixture.groupA.id, patch: { isoDate: "1200-02-03" } }, "unauthorized"]
    ];

    for (const [requestId, senderId, payload] of cases) {
      await moduleApi.handleSocketMessage(commandRequest("group.calendar.patch", senderId, payload, requestId));
    }
    await flushCommands();

    for (const [requestId, , , errorCode] of cases) {
      assert.equal(resultFor(fixture, requestId)?.ok, false);
      assert.equal(resultFor(fixture, requestId)?.error?.code, errorCode);
    }
    assert.equal(fixture.writes.length, 0);
  }
  finally {
    fixture.restore();
  }
});

test("group.calendar.transition dispatches the authorized group instead of the active GM group", async () => {
  const fixture = installFixture({ includeGroupB: true });
  try {
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.calendarTransitionCoordinator = {
      async moveTo() {
        throw new Error("group.calendar.transition must not fall back to the active GM group");
      },
      async moveToGroup(groupActorId, options) {
        calls.push({ groupActorId, options: clone(options) });
        return { groupActorId, calendar: { isoDate: options.toIsoDate } };
      }
    };
    const request = commandRequest(
      "group.calendar.transition",
      fixture.users.playerB.id,
      {
        groupActorId: fixture.groupB.id,
        options: {
          toIsoDate: "1200-02-01",
          processDowntime: true,
          processSupplies: true,
          processDailyCycles: true
        }
      },
      "calendar-transition-group-b"
    );

    await moduleApi.handleSocketMessage(request);
    await flushCommands();

    assert.deepEqual(calls, [{
      groupActorId: fixture.groupB.id,
      options: {
        toIsoDate: "1200-02-01",
        processDowntime: true,
        processSupplies: true,
        processDailyCycles: true
      }
    }]);
    assert.equal(resultFor(fixture, request.requestId)?.ok, true);
    assert.equal(resultFor(fixture, request.requestId)?.data?.groupActorId, fixture.groupB.id);
  }
  finally {
    fixture.restore();
  }
});

test("group.travel.replaceState normalizes input and replaces only travelState", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const travelState = {
      originCityId: " city-a ",
      destinationCityId: "city-b",
      mode: "unsupported",
      traveledMiles: -5,
      ignored: true
    };
    const request = commandRequest(
      "group.travel.replaceState",
      fixture.users.playerA.id,
      { groupActorId: fixture.groupA.id, travelState },
      "travel-valid"
    );

    await moduleApi.handleSocketMessage(request);
    await flushCommands();

    const groupState = fixture.store[SETTINGS_KEYS.GROUP_STATE].groupsById[fixture.groupA.id];
    assert.deepEqual(groupState.travelState, normalizeTravelState(travelState));
    assert.deepEqual(groupState.traderState, { retained: "yes" });
    assert.deepEqual(resultFor(fixture, request.requestId)?.data, {
      travelState: normalizeTravelState(travelState),
      appliedMiles: 0,
      fuelChange: null
    });

    const invalid = commandRequest(
      "group.travel.replaceState",
      fixture.users.playerA.id,
      { groupActorId: fixture.groupA.id, travelState, extra: true },
      "travel-extra"
    );
    await moduleApi.handleSocketMessage(invalid);
    await flushCommands();
    assert.equal(resultFor(fixture, invalid.requestId)?.error?.code, "invalid-payload");
  }
  finally {
    fixture.restore();
  }
});

test("group.transport.replaceState normalizes input and replaces only transportState", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const transportState = {
      activeTransportId: " member:wagon ",
      ignored: true
    };
    const request = commandRequest(
      "group.transport.replaceState",
      fixture.users.playerA.id,
      { groupActorId: fixture.groupA.id, transportState },
      "transport-valid"
    );

    await moduleApi.handleSocketMessage(request);
    await flushCommands();

    const groupState = fixture.store[SETTINGS_KEYS.GROUP_STATE].groupsById[fixture.groupA.id];
    assert.deepEqual(groupState.transportState, normalizeGroupTransportState(transportState));
    assert.deepEqual(groupState.travelState, {
      version: 1,
      originCityId: "old",
      destinationCityId: "",
      mode: "land",
      traveledMiles: 2
    });
    assert.deepEqual(resultFor(fixture, request.requestId)?.data, normalizeGroupTransportState(transportState));

    const invalid = commandRequest(
      "group.transport.replaceState",
      fixture.users.playerA.id,
      { groupActorId: fixture.groupA.id, transportState, extra: true },
      "transport-extra"
    );
    await moduleApi.handleSocketMessage(invalid);
    await flushCommands();
    assert.equal(resultFor(fixture, invalid.requestId)?.error?.code, "invalid-payload");
  }
  finally {
    fixture.restore();
  }
});

test("cosmology.setMechanus accepts only an exact boolean payload from a GM sender", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const valid = commandRequest(
      "cosmology.setMechanus",
      fixture.users.gmB.id,
      { enabled: true },
      "mechanus-valid"
    );
    await moduleApi.handleSocketMessage(valid);
    await flushCommands();
    assert.deepEqual(fixture.store[SETTINGS_KEYS.COSMOLOGY_STATE], {
      version: 1,
      mechanusEnabled: true,
      retained: "yes"
    });
    assert.equal(resultFor(fixture, valid.requestId)?.ok, true);

    const unauthorized = commandRequest(
      "cosmology.setMechanus",
      fixture.users.playerA.id,
      { enabled: false },
      "mechanus-player"
    );
    const invalid = commandRequest(
      "cosmology.setMechanus",
      fixture.users.gmB.id,
      { enabled: false, extra: true },
      "mechanus-extra"
    );
    await moduleApi.handleSocketMessage(unauthorized);
    await moduleApi.handleSocketMessage(invalid);
    await flushCommands();
    assert.equal(resultFor(fixture, unauthorized.requestId)?.error?.code, "unauthorized");
    assert.equal(resultFor(fixture, invalid.requestId)?.error?.code, "invalid-payload");
  }
  finally {
    fixture.restore();
  }
});

test("economy commands authorize GMs and preserve independent setting patches", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const cityCalls = [];
    moduleApi.repository.updateCityPresentation = async (...args) => {
      cityCalls.push(args);
      return { id: args[0] };
    };

    const requests = [
      commandRequest(
        "economy.city-presentation.update",
        fixture.users.gmB.id,
        { cityId: "city-a", patch: { description: "Updated" } },
        "economy-city"
      ),
      commandRequest(
        "economy.connection.set-active",
        fixture.users.gmB.id,
        { connectionId: "connection-a", isActive: false },
        "economy-connection"
      ),
      commandRequest(
        "economy.reference.update-description",
        fixture.users.gmB.id,
        { entryType: "city", entryId: "city-a", description: "Reference" },
        "economy-reference"
      ),
      commandRequest(
        "economy.trade-route.update-metadata",
        fixture.users.gmB.id,
        { connectionId: "route-a", patch: { additionalPricePercent: 7 } },
        "economy-route"
      ),
      commandRequest(
        "economy.state-policy.update",
        fixture.users.gmB.id,
        { stateId: "state-a", patch: { taxPercent: 4 } },
        "economy-policy"
      )
    ];
    for (const request of requests) {
      await moduleApi.handleSocketMessage(request);
    }
    const unauthorized = commandRequest(
      "economy.connection.set-active",
      fixture.users.playerA.id,
      { connectionId: "connection-player", isActive: false },
      "economy-player"
    );
    await moduleApi.handleSocketMessage(unauthorized);
    await flushCommands();

    assert.deepEqual(cityCalls, [["city-a", { description: "Updated" }]]);
    assert.equal(fixture.store[SETTINGS_KEYS.CONNECTION_STATES]["connection-a"], false);
    assert.deepEqual(fixture.store[SETTINGS_KEYS.REFERENCE_NOTES]["city::city-a"], { description: "Reference" });
    assert.deepEqual(fixture.store[SETTINGS_KEYS.TRADE_ROUTE_OVERRIDES]["route-a"], {
      description: "",
      additionalPricePercent: 7
    });
    assert.deepEqual(fixture.store[SETTINGS_KEYS.STATE_POLICIES]["state-a"], {
      taxPercent: 4,
      generalDutyPercent: 0,
      bilateralDuties: {}
    });
    assert.equal(fixture.store[SETTINGS_KEYS.CONNECTION_STATES]["connection-player"], undefined);
    assert.equal(resultFor(fixture, unauthorized.requestId)?.error?.code, "unauthorized");
    assert.equal(fixture.maxConcurrentSettingWrites, 1);
  }
  finally {
    fixture.restore();
  }
});

test("economy world reset writes every economy setting sequentially after trader state", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const resetOrder = [];
    moduleApi.traderService.resetState = async () => {
      resetOrder.push(SETTINGS_KEYS.TRADER_STATE);
      return 0;
    };
    const request = commandRequest(
      "economy.world-data.reset",
      fixture.users.gmB.id,
      {},
      "economy-reset"
    );

    await moduleApi.handleSocketMessage(request);
    await flushCommands();

    assert.equal(resultFor(fixture, request.requestId)?.ok, true);
    assert.deepEqual(resetOrder, [SETTINGS_KEYS.TRADER_STATE]);
    assert.deepEqual(fixture.writes.map((write) => write.key), [
      SETTINGS_KEYS.CONNECTION_STATES,
      SETTINGS_KEYS.CITY_PRESENTATION_OVERRIDES,
      SETTINGS_KEYS.REFERENCE_NOTES,
      SETTINGS_KEYS.TRADE_ROUTE_OVERRIDES,
      SETTINGS_KEYS.STATE_POLICIES
    ]);
    assert.equal(fixture.maxConcurrentSettingWrites, 1);
    for (const key of fixture.writes.map((write) => write.key)) {
      assert.deepEqual(fixture.store[key], {});
    }
  }
  finally {
    fixture.restore();
  }
});

test("an inactive GM routes economy writes through the typed command without a local setting write", async () => {
  const fixture = installFixture({ currentUserId: "gm-b" });
  try {
    const moduleApi = new RebreyaMainModule();
    let refreshCount = 0;
    moduleApi.refreshOpenApps = async () => {
      refreshCount += 1;
    };

    const pending = moduleApi.setConnectionActive("connection-a", false);
    await flushCommands();
    const request = fixture.emitted[0]?.message;
    assert.deepEqual(request, {
      type: COMMAND_REQUEST_TYPE,
      command: "economy.connection.set-active",
      requestId: request?.requestId,
      senderId: fixture.users.gmB.id,
      payload: { connectionId: "connection-a", isActive: false }
    });
    assert.equal(fixture.writes.length, 0);

    await moduleApi.handleSocketMessage({
      type: COMMAND_RESULT_TYPE,
      command: request.command,
      requestId: request.requestId,
      forUserId: fixture.users.gmB.id,
      senderId: fixture.users.gmA.id,
      ok: true,
      data: null
    });

    assert.equal(await pending, null);
    assert.equal(fixture.writes.length, 0);
    assert.equal(refreshCount, 1);
  }
  finally {
    fixture.restore();
  }
});

test("combat.status.set lets a character owner apply environment statuses through the active GM", async () => {
  const globals = installCombatStatusGlobals();
  const fixture = installFixture();
  try {
    const sourceActor = createCombatActor(globals.Actor, globals.ActiveEffect, {
      id: "character-a",
      type: "character",
      ownerId: fixture.users.playerA.id
    });
    const enemyActor = createCombatActor(globals.Actor, globals.ActiveEffect, {
      id: "enemy-a",
      type: "npc"
    });
    fixture.actors.push(sourceActor, enemyActor);
    const moduleApi = new RebreyaMainModule();
    const request = commandRequest(
      "combat.status.set",
      fixture.users.playerA.id,
      {
        actorId: enemyActor.id,
        statusId: "rebreya-surrounded",
        options: {
          active: true,
          durationRounds: 1,
          meta: {
            source: "rebreya-environment",
            sourceActorUuid: sourceActor.uuid,
            version: "surrounded-ac-1"
          }
        }
      },
      "status-valid"
    );

    await moduleApi.handleSocketMessage(request);
    await flushCommands();

    const effect = enemyActor.effects.contents[0];
    assert.equal(effect.flags["rebreya-main"].statusId, "rebreya-surrounded");
    assert.deepEqual(resultFor(fixture, request.requestId), {
      type: COMMAND_RESULT_TYPE,
      command: request.command,
      requestId: request.requestId,
      forUserId: fixture.users.playerA.id,
      senderId: fixture.users.gmA.id,
      ok: true,
      data: {
        actorId: enemyActor.id,
        statusId: "rebreya-surrounded",
        active: true,
        value: null,
        meta: {
          source: "rebreya-environment",
          sourceActorUuid: sourceActor.uuid,
          version: "surrounded-ac-1"
        },
        effectId: effect.id
      }
    });
  }
  finally {
    fixture.restore();
    globals.restore();
  }
});

test("grapple commands authorize the exact live source or target owner", async () => {
  const fixture = installFixture();
  const previousFromUuid = globalThis.fromUuid;
  const previousCanvas = globalThis.canvas;
  try {
    const scene = { id: "scene-a" };
    const sourceActor = { ownership: { [fixture.users.playerA.id]: 3 } };
    const targetActor = { ownership: { [fixture.users.playerB.id]: 3 } };
    const link = {
      linkId: "link-a", kind: "grapple", handSlot: "left",
      sourceTokenUuid: "Scene.scene-a.Token.source-a",
      targetTokenUuid: "Scene.scene-a.Token.target-a"
    };
    const source = {
      documentName: "Token", id: "source-a", uuid: link.sourceTokenUuid,
      parent: scene, actor: sourceActor
    };
    const target = {
      documentName: "Token", id: "target-a", uuid: link.targetTokenUuid,
      parent: scene, actor: targetActor,
      flags: { [MODULE_ID]: { grappleLink: link } },
      getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
    };
    globalThis.canvas = { scene };
    globalThis.fromUuid = async (uuid) => ({ [source.uuid]: source, [target.uuid]: target })[uuid] ?? null;
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.grappleAutomationService = {
      async toggle(payload) { calls.push(["toggle", clone(payload)]); return { action: "created" }; },
      async drag(payload) { calls.push(["drag", clone(payload)]); return { moved: true }; },
      async releaseAndMove(payload) { calls.push(["release", clone(payload)]); return { moved: true }; },
      async place(payload) { calls.push(["place", clone(payload)]); return { moved: true }; }
    };
    const requests = [
      commandRequest("combat.grapple.toggle", fixture.users.playerA.id, {
        sourceTokenUuid: source.uuid, targetTokenUuid: target.uuid, operationId: "toggle-ok"
      }, "toggle-ok"),
      commandRequest("combat.grapple.toggle", fixture.users.playerB.id, {
        sourceTokenUuid: source.uuid, targetTokenUuid: target.uuid, operationId: "toggle-denied"
      }, "toggle-denied"),
      commandRequest("combat.grapple.drag", fixture.users.playerA.id, {
        sourceTokenUuid: source.uuid, x: 100, y: 200, operationId: "drag-ok", requesterUserId: fixture.users.playerA.id
      }, "drag-ok"),
      commandRequest("combat.grapple.release-and-move", fixture.users.playerB.id, {
        targetTokenUuid: target.uuid, linkId: link.linkId, x: 300, y: 400,
        operationId: "release-ok", requesterUserId: fixture.users.playerB.id
      }, "release-ok"),
      commandRequest("combat.grapple.release-and-move", fixture.users.playerA.id, {
        targetTokenUuid: target.uuid, linkId: link.linkId, x: 300, y: 400,
        operationId: "release-denied", requesterUserId: fixture.users.playerA.id
      }, "release-denied"),
      commandRequest("combat.grapple.release-and-move", fixture.users.playerB.id, {
        targetTokenUuid: target.uuid, linkId: "stale", x: 300, y: 400,
        operationId: "release-stale", requesterUserId: fixture.users.playerB.id
      }, "release-stale")
    ];
    for (const request of requests) await moduleApi.handleSocketMessage(request);
    await flushCommands();

    assert.equal(resultFor(fixture, "toggle-ok")?.ok, true);
    assert.equal(resultFor(fixture, "drag-ok")?.ok, true);
    assert.equal(resultFor(fixture, "release-ok")?.ok, true);
    assert.equal(resultFor(fixture, "toggle-denied")?.error?.code, "unauthorized");
    assert.equal(resultFor(fixture, "release-denied")?.error?.code, "unauthorized");
    assert.equal(resultFor(fixture, "release-stale")?.error?.code, "unauthorized");
    assert.deepEqual(calls.map(([name]) => name), ["toggle", "drag", "release"]);
  }
  finally {
    if (previousFromUuid === undefined) delete globalThis.fromUuid;
    else globalThis.fromUuid = previousFromUuid;
    if (previousCanvas === undefined) delete globalThis.canvas;
    else globalThis.canvas = previousCanvas;
    fixture.restore();
  }
});

test("public grapple macros use one controlled source and the exact selected held target", async () => {
  const fixture = installFixture();
  const previousCanvas = globalThis.canvas;
  const previousFromUuid = globalThis.fromUuid;
  try {
    const sourceUuid = "Scene.scene-a.Token.source-a";
    const targetUuid = "Scene.scene-a.Token.target-a";
    const reservation = {
      linkId: "link-a", kind: "grapple", handSlot: "left",
      sourceTokenUuid: sourceUuid, targetTokenUuid: targetUuid
    };
    const sourceDocument = {
      documentName: "Token", id: "source-a", uuid: sourceUuid,
      actor: {
        flags: { [MODULE_ID]: { handReservations: [reservation] } },
        items: { contents: [] }, effects: { contents: [] },
        getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
      }
    };
    const targetDocument = { documentName: "Token", id: "target-a", uuid: targetUuid };
    const sourcePlaceable = { document: sourceDocument };
    const targetPlaceable = { document: targetDocument };
    fixture.users.gmA.targets = new Set([targetPlaceable]);
    globalThis.canvas = { tokens: { controlled: [sourcePlaceable] } };
    globalThis.fromUuid = async (uuid) => uuid === targetUuid ? targetDocument : null;
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.grappleAutomationService = {
      async toggle(payload) { calls.push(["toggle", clone(payload)]); return { action: "created" }; },
      async choosePlacement(payload) { calls.push(["preview", clone(payload)]); return { cancelled: false, x: 250, y: 350 }; },
      async place(payload) { calls.push(["place", clone(payload)]); return { moved: true }; }
    };

    assert.deepEqual(await moduleApi.toggleGrapple(), { action: "created" });
    assert.deepEqual(await moduleApi.moveGrappled(), { moved: true });
    assert.deepEqual(calls.map(([name]) => name), ["toggle", "preview", "place"]);
    assert.equal(calls[0][1].sourceTokenUuid, sourceUuid);
    assert.equal(calls[0][1].targetTokenUuid, targetUuid);
    assert.deepEqual({ x: calls[2][1].x, y: calls[2][1].y }, { x: 250, y: 350 });
  }
  finally {
    if (previousCanvas === undefined) delete globalThis.canvas;
    else globalThis.canvas = previousCanvas;
    if (previousFromUuid === undefined) delete globalThis.fromUuid;
    else globalThis.fromUuid = previousFromUuid;
    fixture.restore();
  }
});

test("public grapple macro catches an asynchronous self-target failure and shows a warning", async () => {
  const fixture = installFixture();
  const previousCanvas = globalThis.canvas;
  try {
    const sourceUuid = "Scene.scene-a.Token.source-a";
    const sourceDocument = { documentName: "Token", id: "source-a", uuid: sourceUuid };
    const sourcePlaceable = { document: sourceDocument };
    fixture.users.gmA.targets = new Set([sourcePlaceable]);
    globalThis.canvas = { tokens: { controlled: [sourcePlaceable] } };
    const warnings = [];
    globalThis.ui.notifications.warn = (message) => warnings.push(message);
    const moduleApi = new RebreyaMainModule();
    moduleApi.grappleAutomationService = {
      async toggle() {
        throw Object.assign(new Error("invalid-target"), { code: "invalid-target" });
      }
    };

    assert.equal(await moduleApi.toggleGrapple(), null);
    assert.deepEqual(warnings, ["Нельзя схватить самого себя."]);
  }
  finally {
    if (previousCanvas === undefined) delete globalThis.canvas;
    else globalThis.canvas = previousCanvas;
    fixture.restore();
  }
});

test("performer.activePerformance.apply accepts only the source actor owner", async () => {
  const fixture = installFixture();
  try {
    const performerActor = createCharacter("performer-a", fixture.users.playerA.id);
    fixture.actors.push(performerActor);
    const moduleApi = new RebreyaMainModule();
    const commits = [];
    moduleApi.performerAutomationService.commitActivePerformance = async (payload) => {
      commits.push(clone(payload));
      return { applied: true, targetActorId: payload.targetActorId };
    };
    const payload = {
      sourceActorId: performerActor.id,
      sourceItemId: "performer-item",
      targetActorId: "ally-a",
      targetTokenUuid: "Scene.scene-a.Token.ally-a",
      total: 24
    };
    const authorized = commandRequest(
      "performer.activePerformance.apply",
      fixture.users.playerA.id,
      payload,
      "performer-authorized"
    );
    const unauthorized = commandRequest(
      "performer.activePerformance.apply",
      fixture.users.playerB.id,
      payload,
      "performer-unauthorized"
    );

    await moduleApi.handleSocketMessage(authorized);
    await moduleApi.handleSocketMessage(unauthorized);
    await flushCommands();

    assert.deepEqual(commits, [payload]);
    assert.equal(resultFor(fixture, authorized.requestId)?.ok, true);
    assert.equal(resultFor(fixture, unauthorized.requestId)?.error?.code, "unauthorized");
  }
  finally {
    fixture.restore();
  }
});

test("typed inventory mutations authorize group members and dispatch strict payloads", async () => {
  const fixture = installFixture();
  const previousFromUuid = globalThis.fromUuid;
  try {
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.inventoryService.executeTakeMutation = async (payload) => {
      calls.push(["take", clone(payload)]);
      return { action: "take" };
    };
    moduleApi.inventoryService.executeSaleMutation = async (payload) => {
      calls.push(["sale", clone(payload)]);
      return { action: "sale" };
    };
    moduleApi.inventoryService.executeImportMutation = async (payload) => {
      calls.push(["import", clone(payload)]);
      return { action: "import" };
    };
    moduleApi.inventoryService.executeCurrencyUpdateMutation = async (payload) => {
      calls.push(["currency-update", clone(payload)]);
      return { action: "currency-update" };
    };
    moduleApi.inventoryService.executeCurrencyConvertMutation = async (payload) => {
      calls.push(["currency-convert", clone(payload)]);
      return { action: "currency-convert" };
    };
    const sourceItem = { parent: fixture.memberA };
    globalThis.fromUuid = async (uuid) => uuid === "Actor.character-a.Item.source"
      ? sourceItem
      : null;
    const importPlan = {
      version: 1,
      groupActorId: fixture.groupA.id,
      rulesRevision: 0,
      requestedFolderId: null,
      rows: [{
        sourceKey: "item",
        identity: {
          sourceType: "",
          sourceId: "",
          documentType: "loot",
          durabilityState: "ineligible",
          quantity: 1
        },
        quantity: 1,
        matchedRuleId: null,
        action: { type: "legacy", folderId: null }
      }],
      rootOverrideSourceKeys: []
    };
    const requests = [
      commandRequest("inventory.take", fixture.users.playerA.id, {
        inventoryActorId: fixture.groupA.id,
        itemId: "stock-item",
        mutationId: "inventory-take-1",
        quantity: 1,
        targetActorId: fixture.memberA.id
      }, "inventory-take"),
      commandRequest("inventory.sale", fixture.users.playerA.id, {
        inventoryActorId: fixture.groupA.id,
        itemId: "stock-item",
        mutationId: "inventory-sale-1",
        quantity: 1
      }, "inventory-sale"),
      commandRequest("inventory.import", fixture.users.playerA.id, {
        inventoryActorId: fixture.groupA.id,
        itemUuid: "Actor.character-a.Item.source",
        mutationId: "inventory-import-1",
        folderId: null,
        ingressPlan: importPlan
      }, "inventory-import"),
      commandRequest("inventory.currency.update", fixture.users.playerA.id, {
        inventoryActorId: fixture.groupA.id,
        values: { pp: 1, gp: 319, sp: 0, cp: 2 }
      }, "inventory-currency-update"),
      commandRequest("inventory.currency.convert", fixture.users.playerA.id, {
        inventoryActorId: fixture.groupA.id,
        mode: "gp"
      }, "inventory-currency-convert")
    ];

    for (const request of requests) {
      await moduleApi.handleSocketMessage(request);
    }
    await moduleApi.handleSocketMessage(commandRequest("inventory.sale", fixture.users.playerB.id, {
      inventoryActorId: fixture.groupA.id,
      itemId: "stock-item",
      mutationId: "inventory-sale-denied",
      quantity: 1
    }, "inventory-sale-denied"));
    await moduleApi.handleSocketMessage(commandRequest("inventory.currency.convert", fixture.users.playerB.id, {
      inventoryActorId: fixture.groupA.id,
      mode: "gp"
    }, "inventory-currency-denied"));
    const invalidImports = [
      commandRequest("inventory.import", fixture.users.playerA.id, {
        groupActorId: fixture.groupA.id,
        itemUuid: "Actor.character-a.Item.source",
        mutationId: "inventory-import-old-shape"
      }, "inventory-import-old-shape"),
      commandRequest("inventory.import", fixture.users.playerA.id, {
        inventoryActorId: fixture.groupA.id,
        itemUuid: "Actor.character-a.Item.source",
        mutationId: "inventory-import-missing-folder"
      }, "inventory-import-missing-folder"),
      commandRequest("inventory.import", fixture.users.playerA.id, {
        inventoryActorId: fixture.groupA.id,
        itemUuid: "Actor.character-a.Item.source",
        mutationId: "inventory-import-extra",
        folderId: null,
        ingressPlan: importPlan,
        extra: true
      }, "inventory-import-extra"),
      commandRequest("inventory.import", fixture.users.playerA.id, {
        inventoryActorId: fixture.groupA.id,
        itemUuid: "Actor.character-a.Item.source",
        mutationId: "inventory-import-untrimmed-folder",
        folderId: " folder-a",
        ingressPlan: importPlan
      }, "inventory-import-untrimmed-folder")
    ];
    for (const request of invalidImports) {
      await moduleApi.handleSocketMessage(request);
    }
    await moduleApi.handleSocketMessage(commandRequest("inventory.import", fixture.users.playerB.id, {
      inventoryActorId: fixture.groupA.id,
      itemUuid: "Actor.character-a.Item.source",
      mutationId: "inventory-import-denied",
      folderId: null,
      ingressPlan: importPlan
    }, "inventory-import-denied"));
    await flushCommands();

    assert.deepEqual(calls.map(([kind]) => kind), ["take", "sale", "import", "currency-update", "currency-convert"]);
    for (const request of requests) {
      assert.equal(resultFor(fixture, request.requestId)?.ok, true);
    }
    assert.equal(resultFor(fixture, "inventory-sale-denied")?.error?.code, "unauthorized");
    assert.equal(resultFor(fixture, "inventory-currency-denied")?.error?.code, "unauthorized");
    for (const request of invalidImports) {
      assert.equal(resultFor(fixture, request.requestId)?.error?.code, "invalid-payload");
    }
    assert.equal(resultFor(fixture, "inventory-import-denied")?.error?.code, "unauthorized");
  }
  finally {
    globalThis.fromUuid = previousFromUuid;
    fixture.restore();
  }
});

test("typed inventory dismantle authorizes the exact group member and rejects unsafe payloads", async () => {
  const fixture = installFixture({ includeGroupB: true });
  try {
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.inventoryService.executeDismantleMutation = async (payload) => {
      calls.push(clone(payload));
      return { action: "dismantle" };
    };
    const payload = {
      inventoryActorId: fixture.groupA.id,
      itemId: "stock-item",
      mutationId: "inventory-dismantle-1",
      quantity: 1
    };
    const authorized = commandRequest(
      "inventory.dismantle",
      fixture.users.playerA.id,
      payload,
      "inventory-dismantle-authorized"
    );
    const outsider = commandRequest(
      "inventory.dismantle",
      fixture.users.playerB.id,
      payload,
      "inventory-dismantle-outsider"
    );
    const invalid = commandRequest(
      "inventory.dismantle",
      fixture.users.playerA.id,
      { ...payload, extra: true },
      "inventory-dismantle-invalid"
    );
    const fractional = commandRequest(
      "inventory.dismantle",
      fixture.users.playerA.id,
      { ...payload, quantity: 0.5 },
      "inventory-dismantle-fractional"
    );

    await moduleApi.handleSocketMessage(authorized);
    await moduleApi.handleSocketMessage(outsider);
    await moduleApi.handleSocketMessage(invalid);
    await moduleApi.handleSocketMessage(fractional);
    await flushCommands();

    assert.deepEqual(calls, [payload]);
    assert.equal(resultFor(fixture, authorized.requestId)?.ok, true);
    assert.equal(resultFor(fixture, outsider.requestId)?.error?.code, "unauthorized");
    assert.equal(resultFor(fixture, invalid.requestId)?.error?.code, "invalid-payload");
    assert.equal(resultFor(fixture, fractional.requestId)?.error?.code, "invalid-payload");
  }
  finally {
    fixture.restore();
  }
});

test("typed inventory dismantle preserves explicit ownership of the exact group Actor", async () => {
  const fixture = installFixture({ includeGroupB: true });
  try {
    fixture.groupA.ownership = { [fixture.users.playerB.id]: 3 };
    fixture.groupA.testUserPermission = (user, permission) => (
      permission === "OWNER" && user?.id === fixture.users.playerB.id
    );
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.inventoryService.executeDismantleMutation = async (payload) => {
      calls.push(clone(payload));
      return { action: "dismantle" };
    };
    const payload = {
      inventoryActorId: fixture.groupA.id,
      itemId: "stock-item",
      mutationId: "inventory-dismantle-manager",
      quantity: 1
    };
    const request = commandRequest(
      "inventory.dismantle",
      fixture.users.playerB.id,
      payload,
      "inventory-dismantle-manager"
    );

    await moduleApi.handleSocketMessage(request);
    await flushCommands();

    assert.deepEqual(calls, [payload]);
    assert.equal(resultFor(fixture, request.requestId)?.ok, true);
  }
  finally {
    fixture.restore();
  }
});

test("typed inventory import lets group members copy compendium items into the party inventory", async () => {
  const fixture = installFixture();
  const previousFromUuid = globalThis.fromUuid;
  const calls = [];
  const compendiumItem = {
    id: "compendium-item",
    uuid: "Compendium.rebreya-main.gear.Item.compendium-item",
    pack: "rebreya-main.gear",
    system: {
      quantity: 1
    },
    toObject() {
      return {
        name: "Compendium Torch",
        type: "loot",
        system: {
          quantity: 1
        }
      };
    }
  };

  try {
    const moduleApi = new RebreyaMainModule();
    moduleApi.inventoryService.executeImportMutation = async (payload) => {
      calls.push(clone(payload));
      return { action: "import" };
    };
    globalThis.fromUuid = async (uuid) => uuid === compendiumItem.uuid ? compendiumItem : null;
    const ingressPlan = {
      version: 1,
      groupActorId: fixture.groupA.id,
      rulesRevision: 0,
      requestedFolderId: "folder-a",
      rows: [{
        sourceKey: "item",
        identity: {
          sourceType: "",
          sourceId: "",
          documentType: "loot",
          durabilityState: "ineligible",
          quantity: 1
        },
        quantity: 1,
        matchedRuleId: null,
        action: { type: "legacy", folderId: "folder-a" }
      }],
      rootOverrideSourceKeys: []
    };
    const request = commandRequest("inventory.import", fixture.users.playerA.id, {
      inventoryActorId: fixture.groupA.id,
      itemUuid: compendiumItem.uuid,
      mutationId: "inventory-import-compendium",
      folderId: "folder-a",
      ingressPlan
    }, "inventory-import-compendium");

    await moduleApi.handleSocketMessage(request);
    await flushCommands();

    assert.deepEqual(calls, [{
      inventoryActorId: fixture.groupA.id,
      itemUuid: compendiumItem.uuid,
      mutationId: "inventory-import-compendium",
      folderId: "folder-a",
      ingressPlan
    }]);
    assert.equal(resultFor(fixture, request.requestId)?.ok, true);
  }
  finally {
    globalThis.fromUuid = previousFromUuid;
    fixture.restore();
  }
});

test("typed inventory import recognizes an owned synthetic token actor through its exact group member", async () => {
  const fixture = installFixture();
  const previousFromUuid = globalThis.fromUuid;
  try {
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.inventoryService.executeImportMutation = async (payload) => {
      calls.push(clone(payload));
      return { action: "import" };
    };
    const syntheticActor = {
      id: "synthetic-character-a",
      type: "character",
      isToken: true,
      token: { actorId: fixture.memberA.id },
      ownership: { [fixture.users.playerA.id]: 3 }
    };
    globalThis.fromUuid = async (uuid) => uuid === "Scene.scene-a.Token.token-a.Item.source"
      ? { parent: syntheticActor }
      : null;
    const payload = {
      inventoryActorId: fixture.groupA.id,
      itemUuid: "Scene.scene-a.Token.token-a.Item.source",
      mutationId: "inventory-import-synthetic-1",
      folderId: null,
      ingressPlan: buildLootgenIngressPlan(fixture.groupA.id, ["item"])
    };
    const request = commandRequest(
      "inventory.import",
      fixture.users.playerA.id,
      payload,
      "inventory-import-synthetic"
    );

    await moduleApi.handleSocketMessage(request);
    await flushCommands();

    assert.deepEqual(calls, [payload]);
    assert.equal(resultFor(fixture, request.requestId)?.ok, true);
  }
  finally {
    globalThis.fromUuid = previousFromUuid;
    fixture.restore();
  }
});

test("Lootgen take-all previews once, sends one typed batch, and refreshes once", async () => {
  const fixture = installFixture({ currentUserId: "player-a" });
  const rowIds = Array.from({ length: 20 }, (_, index) => `loot-row-${index}`);
  const state = {
    lootId: "loot-batch",
    createdBy: fixture.users.gmA.id,
    rows: rowIds.map((rowId) => ({
      rowId,
      quantity: 1,
      claimed: false,
      itemData: {
        name: rowId,
        type: "loot",
        system: { quantity: 1 },
        flags: { [MODULE_ID]: { sourceType: "gear", sourceId: rowId } }
      }
    })),
    coins: { gp: 3, totalCopper: 300 },
    coinsClaimed: false
  };
  const message = {
    id: "message-loot-batch",
    author: fixture.users.gmA,
    getFlag: (moduleId, key) => moduleId === MODULE_ID && key === "lootgenChat" ? state : null
  };
  game.messages.contents.push(message);
  const moduleApi = new RebreyaMainModule();
  const calls = { preview: 0, collect: 0, socket: [], refresh: 0, single: 0 };
  moduleApi.claimLootgenChatRowToInventory = async () => {
    calls.single += 1;
    throw new Error("take-all must not dispatch per-row claims");
  };
  const ingressPlan = buildLootgenIngressPlan(fixture.groupA.id, rowIds);
  moduleApi.inventoryIngressPlanner = {
    async preview(request) {
      calls.preview += 1;
      assert.equal(request.rows.length, 20);
      return { request };
    },
    async collectChoices() {
      calls.collect += 1;
      return { rootOverrideSourceKeys: [] };
    },
    serialize() {
      return ingressPlan;
    }
  };
  moduleApi.socketCommandBus.request = async (command, payload) => {
    calls.socket.push({ command, payload: clone(payload) });
    return {
      changed: true,
      claimedRowIds: rowIds,
      claimedCoins: true,
      receipt: { actorId: fixture.groupA.id }
    };
  };
  moduleApi.refreshInventoryViews = async ({ actorIds }) => {
    calls.refresh += 1;
    assert.deepEqual(actorIds, [fixture.groupA.id]);
  };

  try {
    const changed = await moduleApi.claimLootgenChatAllToInventory(state.lootId, {
      claimId: "loot-batch-mutation",
      quiet: true
    });

    assert.equal(changed, true);
    assert.equal(calls.preview, 1);
    assert.equal(calls.collect, 1);
    assert.equal(calls.refresh, 1);
    assert.equal(calls.single, 0);
    assert.deepEqual(calls.socket, [{
      command: "inventory.ingress.lootgen",
      payload: {
        batchMutationId: "loot-batch-mutation",
        groupActorId: fixture.groupA.id,
        lootId: state.lootId,
        rowIds,
        includeCoins: true,
        ingressPlan
      }
    }]);
  }
  finally {
    fixture.restore();
  }
});

test("direct Lootgen take-all sends one optimized typed batch through the active GM", async () => {
  const fixture = installFixture({ currentUserId: "player-a" });
  const sources = Array.from({ length: 20 }, (_, index) => ({
    sourceType: "gear",
    sourceId: `gear-${index}`,
    sourceDocumentId: "",
    isBroken: false,
    quantity: 1,
    directGrantId: `direct-row-${index}`
  }));
  const rowIds = sources.map((row) => row.directGrantId);
  const ingressPlan = buildLootgenIngressPlan(fixture.groupA.id, rowIds);
  const moduleApi = new RebreyaMainModule();
  const calls = { build: 0, preview: 0, collect: 0, socket: [], refresh: 0 };
  moduleApi.inventoryService.buildLootgenItemData = async (row) => {
    calls.build += 1;
    return {
      name: row.sourceId,
      type: "loot",
      system: { quantity: row.quantity },
      flags: { [MODULE_ID]: { sourceType: row.sourceType, sourceId: row.sourceId } }
    };
  };
  moduleApi.inventoryIngressPlanner = {
    async preview(request) {
      calls.preview += 1;
      assert.equal(request.rows.length, 20);
      assert.equal(request.batch, true);
      return { request };
    },
    async collectChoices() {
      calls.collect += 1;
      return { rootOverrideSourceKeys: [] };
    },
    serialize() {
      return ingressPlan;
    }
  };
  moduleApi.socketCommandBus.request = async (command, payload) => {
    calls.socket.push({ command, payload: clone(payload) });
    return { changed: true, actorId: fixture.groupA.id, rows: [] };
  };
  moduleApi.refreshInventoryViews = async ({ actorIds }) => {
    calls.refresh += 1;
    assert.deepEqual(actorIds, [fixture.groupA.id]);
  };

  try {
    const result = await moduleApi.addLootgenRowsToInventory(sources, {
      coins: { pp: 0, gp: 3, sp: 0, cp: 0 },
      batchMutationId: "direct-lootgen-batch"
    });

    assert.equal(result.changed, true);
    assert.equal(calls.build, 20);
    assert.equal(calls.preview, 1);
    assert.equal(calls.collect, 1);
    assert.equal(calls.refresh, 1);
    assert.equal(calls.socket.length, 1);
    assert.equal(calls.socket[0].command, "inventory.ingress.direct");
    assert.deepEqual(calls.socket[0].payload.sources.map((row) => row.sourceKey), rowIds);
    assert.deepEqual(calls.socket[0].payload.coins, { pp: 0, gp: 3, sp: 0, cp: 0 });
    assert.deepEqual(calls.socket[0].payload.ingressPlan, ingressPlan);
  }
  finally {
    fixture.restore();
  }
});

test("active GM revalidates and commits one direct Lootgen batch for the exact group", async () => {
  const fixture = installFixture();
  const sources = ["direct-a", "direct-b"].map((sourceKey) => ({
    sourceKey,
    sourceType: "gear",
    sourceId: sourceKey,
    sourceDocumentId: "",
    isBroken: false,
    quantity: 1
  }));
  const ingressPlan = buildLootgenIngressPlan(
    fixture.groupA.id,
    sources.map((source) => source.sourceKey)
  );
  const moduleApi = new RebreyaMainModule();
  const calls = { builds: 0, commits: 0, coins: 0 };
  moduleApi.inventoryService.buildLootgenItemData = async (source) => {
    calls.builds += 1;
    return {
      name: source.sourceId,
      type: "loot",
      system: { quantity: source.quantity },
      flags: { [MODULE_ID]: { sourceType: source.sourceType, sourceId: source.sourceId } }
    };
  };
  moduleApi.inventoryService.commitInventoryIngressBatch = async (request, adapters) => {
    calls.commits += 1;
    assert.equal(request.groupActorId, fixture.groupA.id);
    assert.equal(request.sourceOrigin, "lootgen");
    assert.deepEqual((await adapters.resolveRows()).map((row) => row.sourceKey), ["direct-a", "direct-b"]);
    return { actorId: fixture.groupA.id, changed: true, rows: [] };
  };
  moduleApi.inventoryService.addCurrencyToInventoryOnce = async (coins, mutationId, options) => {
    calls.coins += 1;
    assert.deepEqual(coins, { pp: 0, gp: 2, sp: 0, cp: 0 });
    assert.equal(mutationId, "direct-command-batch:coins");
    assert.deepEqual(options, { groupActorId: fixture.groupA.id });
  };
  moduleApi.refreshInventoryViews = async () => {};
  const payload = {
    batchMutationId: "direct-command-batch",
    coins: { pp: 0, gp: 2, sp: 0, cp: 0 },
    groupActorId: fixture.groupA.id,
    ingressPlan,
    sourceOrigin: "lootgen",
    sources
  };

  try {
    const authorized = commandRequest(
      "inventory.ingress.direct",
      fixture.users.playerA.id,
      payload,
      "direct-command-authorized"
    );
    await moduleApi.handleSocketMessage(authorized);
    await flushCommands();

    const authorizedResult = resultFor(fixture, authorized.requestId);
    assert.equal(authorizedResult?.ok, true, JSON.stringify(authorizedResult));
    assert.deepEqual(calls, { builds: 2, commits: 1, coins: 1 });

    const denied = commandRequest(
      "inventory.ingress.direct",
      fixture.users.playerB.id,
      payload,
      "direct-command-denied"
    );
    await moduleApi.handleSocketMessage(denied);
    await flushCommands();
    assert.equal(resultFor(fixture, denied.requestId)?.error?.code, "unauthorized");
    assert.deepEqual(calls, { builds: 2, commits: 1, coins: 1 });

    const invalid = commandRequest(
      "inventory.ingress.direct",
      fixture.users.playerA.id,
      { ...payload, sources: [{ ...sources[0], extra: true }, sources[1]] },
      "direct-command-invalid"
    );
    await moduleApi.handleSocketMessage(invalid);
    await flushCommands();
    assert.equal(resultFor(fixture, invalid.requestId)?.error?.code, "invalid-payload");
    assert.deepEqual(calls, { builds: 2, commits: 1, coins: 1 });
  }
  finally {
    fixture.restore();
  }
});

test("public model grants use the same single direct-ingress command", async () => {
  const fixture = installFixture({ currentUserId: "player-a" });
  const moduleApi = new RebreyaMainModule();
  const plan = buildLootgenIngressPlan(fixture.groupA.id, ["item"]);
  let socketCall = null;
  moduleApi.inventoryService.buildModelItemData = async () => ({
    name: "Model sword",
    type: "weapon",
    system: { quantity: 1 },
    flags: { [MODULE_ID]: { sourceType: "gear", sourceId: "model-sword" } }
  });
  moduleApi.inventoryIngressPlanner = {
    preview: async () => ({}),
    collectChoices: async () => ({ rootOverrideSourceKeys: [] }),
    serialize: () => plan
  };
  moduleApi.socketCommandBus.request = async (command, payload) => {
    socketCall = { command, payload: clone(payload) };
    return { actorId: fixture.groupA.id, changed: true, rows: [] };
  };
  moduleApi.refreshInventoryViews = async () => {};

  try {
    await moduleApi.addModelItemToInventory("gear", "model-sword", 1, {
      groupActorId: fixture.groupA.id,
      folderId: null,
      batchMutationId: "public-model-command"
    });

    assert.equal(socketCall.command, "inventory.ingress.direct");
    assert.equal(socketCall.payload.sourceOrigin, "public-model");
    assert.equal(socketCall.payload.sources.length, 1);
    assert.equal(socketCall.payload.ingressPlan.groupActorId, fixture.groupA.id);
  }
  finally {
    fixture.restore();
  }
});

test("typed Lootgen ingress validates and authorizes the exact group batch", async () => {
  const fixture = installFixture();
  const rowIds = ["loot-row-1"];
  const ingressPlan = buildLootgenIngressPlan(fixture.groupA.id, rowIds);
  const state = {
    lootId: "loot-command",
    createdBy: fixture.users.gmA.id,
    rows: [],
    coins: {},
    coinsClaimed: true
  };
  game.messages.contents.push({
    id: "message-loot-command",
    author: fixture.users.gmA,
    getFlag: (moduleId, key) => moduleId === MODULE_ID && key === "lootgenChat" ? state : null
  });
  const moduleApi = new RebreyaMainModule();
  const calls = [];
  moduleApi.lootClaimService.claimBatch = async (request) => {
    calls.push(clone(request));
    return { changed: true, claimedRowIds: rowIds, claimedCoins: false, receipt: null };
  };
  moduleApi.refreshInventoryViews = async () => {};
  const payload = {
    batchMutationId: "loot-command-batch",
    groupActorId: fixture.groupA.id,
    lootId: state.lootId,
    rowIds,
    includeCoins: false,
    ingressPlan
  };

  try {
    const request = commandRequest(
      "inventory.ingress.lootgen",
      fixture.users.playerA.id,
      payload,
      "loot-command-request"
    );
    await moduleApi.handleSocketMessage(request);
    await flushCommands();

    assert.deepEqual(calls, [{
      messageId: "message-loot-command",
      lootId: state.lootId,
      claimId: payload.batchMutationId,
      rowIds,
      includeCoins: false,
      ingressPlan
    }]);
    const lootCommandResult = resultFor(fixture, request.requestId);
    assert.equal(lootCommandResult?.ok, true, JSON.stringify(lootCommandResult));

    const invalid = commandRequest("inventory.ingress.lootgen", fixture.users.playerA.id, {
      ...payload,
      rowIds: ["different-row"]
    }, "loot-command-invalid");
    await moduleApi.handleSocketMessage(invalid);
    await flushCommands();
    assert.equal(resultFor(fixture, invalid.requestId)?.error?.code, "invalid-payload");
  }
  finally {
    fixture.restore();
  }
});

test("Lootgen cancel dispatches nothing and stale retry rebuilds a fresh preview", async () => {
  const fixture = installFixture({ currentUserId: "player-a" });
  const state = {
    lootId: "loot-retry-preview",
    createdBy: fixture.users.gmA.id,
    rows: [{
      rowId: "retry-row",
      quantity: 1,
      claimed: false,
      itemData: {
        name: "Retry row",
        type: "loot",
        system: { quantity: 1 },
        flags: { [MODULE_ID]: { sourceType: "gear", sourceId: "retry-row" } }
      }
    }],
    coins: {},
    coinsClaimed: true
  };
  game.messages.contents.push({
    id: "message-retry-preview",
    author: fixture.users.gmA,
    getFlag: (moduleId, key) => moduleId === MODULE_ID && key === "lootgenChat" ? state : null
  });
  const moduleApi = new RebreyaMainModule();
  let previewCalls = 0;
  let collectCalls = 0;
  let socketCalls = 0;
  const plan = buildLootgenIngressPlan(fixture.groupA.id, ["retry-row"]);
  moduleApi.inventoryIngressPlanner = {
    async preview() {
      previewCalls += 1;
      return {};
    },
    async collectChoices() {
      collectCalls += 1;
      return collectCalls === 1 ? null : { rootOverrideSourceKeys: [] };
    },
    serialize: () => plan
  };
  moduleApi.socketCommandBus.request = async () => {
    socketCalls += 1;
    throw Object.assign(new Error("stale plan"), { code: "plan-stale" });
  };

  try {
    assert.equal(await moduleApi.claimLootgenChatRowToInventory(state.lootId, "retry-row"), false);
    assert.equal(socketCalls, 0);
    await assert.rejects(
      moduleApi.claimLootgenChatRowToInventory(state.lootId, "retry-row"),
      (error) => error?.code === "plan-stale"
    );
    await assert.rejects(
      moduleApi.claimLootgenChatRowToInventory(state.lootId, "retry-row"),
      (error) => error?.code === "plan-stale"
    );
    assert.equal(previewCalls, 3);
    assert.equal(collectCalls, 3);
    assert.equal(socketCalls, 2);
    assert.equal(state.rows[0].claimed, false);
  }
  finally {
    fixture.restore();
  }
});

test("Lootgen composition grant delegates Item rows once and handles coins outside descriptors", async () => {
  const fixture = installFixture();
  const moduleApi = new RebreyaMainModule();
  const rowIds = ["folder-row", "skip-row"];
  const ingressPlan = buildLootgenIngressPlan(fixture.groupA.id, rowIds);
  const liveState = {
    lootId: "loot-composed-grant",
    rows: rowIds.map((rowId) => ({
      rowId,
      quantity: 1,
      claimed: false,
      itemData: {
        name: rowId,
        type: "loot",
        system: { quantity: 1 },
        flags: { [MODULE_ID]: { sourceType: "gear", sourceId: rowId } }
      }
    }))
  };
  const message = {
    getFlag: () => liveState
  };
  const calls = { commit: 0, coins: 0, once: 0 };
  moduleApi.inventoryService.addLootgenRowToInventoryOnce = async () => {
    calls.once += 1;
  };
  moduleApi.inventoryService.commitInventoryIngressBatch = async (request, adapters) => {
    calls.commit += 1;
    assert.deepEqual((await adapters.resolveRows()).map((row) => row.sourceKey), rowIds);
    assert.equal(request.sourceOrigin, "lootgen");
    return {
      actorId: fixture.groupA.id,
      rows: [
        { sourceKey: "folder-row", changed: true },
        { sourceKey: "skip-row", changed: false }
      ]
    };
  };
  moduleApi.inventoryService.addCurrencyToInventoryOnce = async (_coins, mutationId, options) => {
    calls.coins += 1;
    assert.equal(mutationId, `loot-coins:${calls.coins === 1 ? "composed-batch" : "coins-only-batch"}`);
    assert.deepEqual(options, calls.coins === 1 ? { groupActorId: fixture.groupA.id } : undefined);
  };

  try {
    const result = await moduleApi.lootClaimService.grantBatch({
      claimId: "composed-batch",
      lootId: liveState.lootId,
      rows: clone(liveState.rows),
      coins: { gp: 1, totalCopper: 100 },
      includeCoins: true,
      ingressPlan,
      message
    });

    assert.deepEqual(result.acceptedRowIds, ["folder-row"]);
    assert.equal(result.coinsGranted, true);
    assert.deepEqual(calls, { commit: 1, coins: 1, once: 0 });

    const coinsOnlyResult = await moduleApi.lootClaimService.grantBatch({
      claimId: "coins-only-batch",
      lootId: liveState.lootId,
      rows: [],
      coins: { sp: 2, totalCopper: 20 },
      includeCoins: true,
      ingressPlan: null,
      message
    });

    assert.deepEqual(coinsOnlyResult.acceptedRowIds, []);
    assert.equal(coinsOnlyResult.coinsGranted, true);
    assert.deepEqual(calls, { commit: 1, coins: 2, once: 0 });
  }
  finally {
    fixture.restore();
  }
});

test("module API carries the exact party folder target through storage and direct Item import", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const storageCalls = [];
    const importCalls = [];
    moduleApi.inventoryService.getInventoryActor = async (options) => {
      assert.deepEqual(options, { create: false, groupActorId: fixture.groupA.id });
      return fixture.groupA;
    };
    moduleApi.storageCommandService.claimRow = async (payload, context) => {
      storageCalls.push({ payload: clone(payload), senderId: context.sender.id });
      return { changed: true };
    };
    const storageIngressPlan = buildLootgenIngressPlan(fixture.groupA.id, ["row-1"], {
      folderId: "folder-a"
    });
    moduleApi.getStorageSnapshot = async () => ({
      rows: [{
        rowId: "row-1",
        rowKind: "item",
        quantity: 1,
        itemData: { name: "Sword", type: "weapon", system: { quantity: 1 } }
      }]
    });
    moduleApi.inventoryIngressPlanner = {
      async preview() { return {}; },
      async collectChoices() { return { rootOverrideSourceKeys: [] }; },
      serialize() { return storageIngressPlan; }
    };
    moduleApi.inventoryService.importDroppedItem = async (dropData, options) => {
      importCalls.push({ dropData: clone(dropData), options: clone(options) });
      return { actorId: fixture.groupA.id };
    };

    await moduleApi.claimStorageRow(
      "Scene.scene.Token.chest",
      "row-1",
      "party",
      "claim-party-folder",
      {
        quantity: 1,
        target: { groupActorId: fixture.groupA.id, folderId: "folder-a" }
      }
    );
    await moduleApi.importInventoryDrop(
      { type: "Item", uuid: "Compendium.world.items.Item.torch" },
      { groupActorId: fixture.groupA.id, folderId: "folder-a" }
    );

    assert.deepEqual(storageCalls, [{
      payload: {
        tokenUuid: "Scene.scene.Token.chest",
        characterTokenUuid: "Scene.scene.Token.chest",
        rowId: "row-1",
        destination: "party",
        quantity: 1,
        target: { groupActorId: fixture.groupA.id, folderId: "folder-a" },
        ingressPlan: storageIngressPlan,
        mutationId: "claim-party-folder"
      },
      senderId: fixture.users.gmA.id
    }]);
    assert.deepEqual(importCalls, [{
      dropData: { type: "Item", uuid: "Compendium.world.items.Item.torch" },
      options: { groupActorId: fixture.groupA.id, folderId: "folder-a" }
    }]);
  }
  finally {
    fixture.restore();
  }
});

test("typed party storage claims authorize membership in the exact target group", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    const refreshes = [];
    moduleApi.refreshInventoryViews = async ({ actorIds }) => {
      refreshes.push([...actorIds]);
    };
    moduleApi.storageCommandService.claimRow = async (payload, { sender }) => {
      calls.push({ payload: clone(payload), senderId: sender.id });
      return { changed: true };
    };
    const payload = {
      tokenUuid: "Scene.scene.Token.chest",
      characterTokenUuid: "Scene.scene.Token.hero",
      rowId: "row-1",
      destination: "party",
      quantity: 1,
      target: { groupActorId: fixture.groupA.id, folderId: null },
      ingressPlan: buildLootgenIngressPlan(fixture.groupA.id, ["row-1"]),
      mutationId: "party-storage-authorized"
    };
    const authorized = commandRequest(
      "storage.claim-row",
      fixture.users.playerA.id,
      payload,
      "party-storage-authorized"
    );
    const unauthorized = commandRequest(
      "storage.claim-row",
      fixture.users.playerB.id,
      { ...payload, mutationId: "party-storage-unauthorized" },
      "party-storage-unauthorized"
    );

    await moduleApi.handleSocketMessage(authorized);
    await moduleApi.handleSocketMessage(unauthorized);
    await flushCommands();

    assert.deepEqual(calls, [{ payload, senderId: fixture.users.playerA.id }]);
    assert.deepEqual(refreshes, [[fixture.groupA.id]]);
    assert.equal(resultFor(fixture, authorized.requestId)?.ok, true);
    assert.equal(resultFor(fixture, unauthorized.requestId)?.error?.code, "unauthorized");
  }
  finally {
    fixture.restore();
  }
});

test("player setCombatStatus routes environment status changes for unowned actors through sockets", async () => {
  const globals = installCombatStatusGlobals();
  const fixture = installFixture({ currentUserId: "player-a" });
  try {
    const sourceActor = createCombatActor(globals.Actor, globals.ActiveEffect, {
      id: "character-a",
      type: "character",
      ownerId: fixture.users.playerA.id,
      isOwner: true
    });
    const enemyActor = createCombatActor(globals.Actor, globals.ActiveEffect, {
      id: "enemy-a",
      type: "npc",
      isOwner: false
    });
    fixture.actors.push(sourceActor, enemyActor);
    const moduleApi = new RebreyaMainModule();
    let refreshCount = 0;
    moduleApi.refreshOpenApps = async () => {
      refreshCount += 1;
    };

    const pending = moduleApi.setCombatStatus(enemyActor, "rebreya-surrounded", {
      active: true,
      durationRounds: 1,
      meta: {
        source: "rebreya-environment",
        sourceActorUuid: sourceActor.uuid,
        version: "surrounded-ac-1"
      }
    });
    const request = fixture.emitted[0]?.message;
    assert.equal(request?.type, COMMAND_REQUEST_TYPE);
    assert.equal(request?.command, "combat.status.set");
    assert.equal(request?.senderId, fixture.users.playerA.id);
    assert.deepEqual(request?.payload, {
      actorId: enemyActor.id,
      statusId: "rebreya-surrounded",
      options: {
        active: true,
        durationRounds: 1,
        meta: {
          source: "rebreya-environment",
          sourceActorUuid: sourceActor.uuid,
          version: "surrounded-ac-1"
        }
      }
    });

    await moduleApi.handleSocketMessage({
      type: COMMAND_RESULT_TYPE,
      command: request.command,
      requestId: request.requestId,
      forUserId: fixture.users.playerA.id,
      senderId: fixture.users.gmA.id,
      ok: true,
      data: {
        actorId: enemyActor.id,
        statusId: "rebreya-surrounded",
        active: true,
        value: null,
        meta: {
          source: "rebreya-environment",
          sourceActorUuid: sourceActor.uuid,
          version: "surrounded-ac-1"
        },
        effectId: "effect-1"
      }
    });

    assert.equal((await pending).statusId, "rebreya-surrounded");
    assert.equal(refreshCount, 1);
    assert.equal(enemyActor.effects.contents.length, 0);
  }
  finally {
    fixture.restore();
    globals.restore();
  }
});

test("player routes owned synthetic actor environment statuses through the active GM by UUID", async () => {
  const globals = installCombatStatusGlobals();
  const fixture = installFixture({ currentUserId: "player-a" });
  try {
    const syntheticActor = createCombatActor(globals.Actor, globals.ActiveEffect, {
      id: "enemy-delta",
      type: "npc",
      isOwner: true
    });
    syntheticActor.uuid = "Scene.scene-a.Token.enemy-token.Actor.delta";
    const moduleApi = new RebreyaMainModule();

    const pending = moduleApi.setCombatStatus(syntheticActor, "rebreya-surrounded", {
      active: true,
      durationRounds: 1,
      meta: {
        source: "rebreya-environment",
        sourceActorUuid: fixture.memberA.uuid ?? `Actor.${fixture.memberA.id}`,
        version: "surrounded-ac-1"
      }
    });
    const request = fixture.emitted[0]?.message;

    assert.equal(request?.command, "combat.status.set");
    assert.equal(request?.payload?.actorUuid, syntheticActor.uuid);
    assert.equal(syntheticActor.effects.contents.length, 0);

    await moduleApi.handleSocketMessage({
      type: COMMAND_RESULT_TYPE,
      command: request.command,
      requestId: request.requestId,
      forUserId: fixture.users.playerA.id,
      senderId: fixture.users.gmA.id,
      ok: true,
      data: { active: true, statusId: "rebreya-surrounded" }
    });
    await pending;
  }
  finally {
    fixture.restore();
    globals.restore();
  }
});

test("active GM resolves a synthetic actor UUID before applying an environment status", async () => {
  const globals = installCombatStatusGlobals();
  const fixture = installFixture();
  const previousFromUuid = globalThis.fromUuid;
  try {
    const sourceActor = createCombatActor(globals.Actor, globals.ActiveEffect, {
      id: "character-a",
      type: "character",
      ownerId: fixture.users.playerA.id
    });
    const syntheticActor = createCombatActor(globals.Actor, globals.ActiveEffect, {
      id: "enemy-delta",
      type: "npc"
    });
    syntheticActor.uuid = "Scene.scene-a.Token.enemy-token.Actor.delta";
    fixture.actors.push(sourceActor);
    globalThis.fromUuid = async (uuid) => uuid === syntheticActor.uuid ? syntheticActor : null;
    const moduleApi = new RebreyaMainModule();
    const request = commandRequest(
      "combat.status.set",
      fixture.users.playerA.id,
      {
        actorUuid: syntheticActor.uuid,
        statusId: "rebreya-surrounded",
        options: {
          active: true,
          durationRounds: 1,
          meta: {
            source: "rebreya-environment",
            sourceActorUuid: sourceActor.uuid,
            version: "surrounded-ac-1"
          }
        }
      },
      "synthetic-status"
    );

    await moduleApi.handleSocketMessage(request);
    await flushCommands();

    assert.equal(resultFor(fixture, request.requestId)?.ok, true);
    assert.equal(syntheticActor.effects.contents.length, 1);
  }
  finally {
    globalThis.fromUuid = previousFromUuid;
    fixture.restore();
    globals.restore();
  }
});

test("downtime mutation commands require exact safe payloads", () => {
  const {
    DOWNTIME_WEEKS_GRANT_COMMAND,
    DOWNTIME_WEEKS_REVOKE_COMMAND,
    DOWNTIME_HISTORY_CLEAR_COMMAND,
    DOWNTIME_REQUEST_CREATE_COMMAND,
    DOWNTIME_REQUEST_UPDATE_COMMAND,
    DOWNTIME_REQUEST_SET_STATUS_COMMAND,
    DOWNTIME_REQUEST_SET_CHECKS_COMMAND,
    DOWNTIME_REQUEST_RECORD_CHECK_COMMAND,
    DOWNTIME_PROJECT_CONTINUE_COMMAND,
    DOWNTIME_PROJECT_CLOSE_COMMAND,
    isValidDowntimeWeeksGrantPayload,
    isValidDowntimeWeeksRevokePayload,
    isValidDowntimeHistoryClearPayload,
    isValidDowntimeRequestCreatePayload,
    isValidDowntimeRequestUpdatePayload,
    isValidDowntimeRequestSetStatusPayload,
    isValidDowntimeRequestSetChecksPayload,
    isValidDowntimeRequestRecordCheckPayload,
    isValidDowntimeProjectContinuePayload,
    isValidDowntimeProjectClosePayload
  } = downtimeMutationCommands;
  const request = {
    groupId: "group-a",
    actorId: "character-a",
    actionId: "training",
    title: "Training",
    description: "",
    weeks: 1,
    craftProject: null,
    targetActionSelections: []
  };
  const cases = [
    [DOWNTIME_WEEKS_GRANT_COMMAND, isValidDowntimeWeeksGrantPayload, { groupId: "group-a", actorIds: ["character-a"], weeks: 1, reason: "", fromIsoDate: "" }],
    [DOWNTIME_WEEKS_REVOKE_COMMAND, isValidDowntimeWeeksRevokePayload, { groupId: "group-a", actorIds: ["character-a"], weeks: 1, reason: "" }],
    [DOWNTIME_HISTORY_CLEAR_COMMAND, isValidDowntimeHistoryClearPayload, { groupId: "group-a" }],
    [DOWNTIME_REQUEST_CREATE_COMMAND, isValidDowntimeRequestCreatePayload, request],
    [DOWNTIME_REQUEST_UPDATE_COMMAND, isValidDowntimeRequestUpdatePayload, { ...request, requestId: "downtime-1" }],
    [DOWNTIME_REQUEST_SET_STATUS_COMMAND, isValidDowntimeRequestSetStatusPayload, { groupId: "group-a", requestId: "downtime-1", status: "approved", result: "" }],
    [DOWNTIME_REQUEST_SET_CHECKS_COMMAND, isValidDowntimeRequestSetChecksPayload, { groupId: "group-a", requestId: "downtime-1", checks: [] }],
    [DOWNTIME_REQUEST_RECORD_CHECK_COMMAND, isValidDowntimeRequestRecordCheckPayload, { groupId: "group-a", actorId: "character-a", requestId: "downtime-1", checkId: "check-1", result: { total: 17 } }],
    [DOWNTIME_PROJECT_CONTINUE_COMMAND, isValidDowntimeProjectContinuePayload, { groupId: "group-a", actorId: "character-a", requestId: "downtime-1", checkId: "check-1", result: { total: 17 } }],
    [DOWNTIME_PROJECT_CLOSE_COMMAND, isValidDowntimeProjectClosePayload, { groupId: "group-a", actorId: "character-a", requestId: "downtime-1" }]
  ];

  for (const [command, validate, payload] of cases) {
    assert.equal(typeof command, "string");
    assert.equal(validate?.(payload), true, command);
    assert.equal(validate?.({ ...payload, extra: true }), false, `${command}: extra key`);
  }
  assert.equal(isValidDowntimeWeeksGrantPayload?.({ groupId: "group-a", actorIds: [], weeks: 0, reason: "", fromIsoDate: "" }), false);
  assert.equal(isValidDowntimeRequestCreatePayload?.({ ...request, craftProject: [] }), false);
  assert.equal(isValidDowntimeRequestSetChecksPayload?.({ groupId: "group-a", requestId: "downtime-1", checks: {}, }), false);
  assert.equal(isValidDowntimeRequestRecordCheckPayload?.({ groupId: "group-a", actorId: "character-a", requestId: "downtime-1", checkId: "check-1", result: { constructor: "unsafe" } }), false);
});

test("downtime typed commands authorize exact group members and stamp the socket sender", async () => {
  const fixture = installFixture({ includeGroupB: true });
  try {
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.downtimeService = {
      async grantWeeks(payload) { calls.push(["grant", clone(payload)]); return { actorIds: payload.actorIds }; },
      async revokeWeeks(payload) { calls.push(["revoke", clone(payload)]); return { actorIds: payload.actorIds }; },
      async clearHistory(payload) { calls.push(["clear", clone(payload)]); return { actorIds: [fixture.memberA.id] }; },
      async createRequest(payload) { calls.push(["create", clone(payload)]); return { id: "request-create", actorId: payload.actorId }; },
      async updateRequest(payload) { calls.push(["update", clone(payload)]); return { id: payload.requestId, actorId: payload.actorId }; },
      async setRequestStatus(requestId, status, options) { calls.push(["status", requestId, status, clone(options)]); return { id: requestId, actorId: fixture.memberA.id }; },
      async setRequestChecks(requestId, checks, options) { calls.push(["checks", requestId, clone(checks), clone(options)]); return { id: requestId, actorId: fixture.memberA.id }; },
      async recordCheckResult(requestId, checkId, result, options) { calls.push(["record", requestId, checkId, clone(result), clone(options)]); return { id: requestId, actorId: fixture.memberA.id }; },
      async continueProject(requestId, options) { calls.push(["continue", requestId, clone(options)]); return { id: requestId, actorId: fixture.memberA.id }; },
      async closeProject(requestId, options) { calls.push(["close", requestId, clone(options)]); return { id: requestId, actorId: fixture.memberA.id }; }
    };
    const requestPayload = {
      groupId: fixture.groupA.id,
      actorId: fixture.memberA.id,
      actionId: "training",
      title: "Training",
      description: "",
      weeks: 1,
      craftProject: null,
      targetActionSelections: []
    };
    const requests = [
      commandRequest("downtime.request.create", fixture.users.playerA.id, requestPayload, "downtime-create"),
      commandRequest("downtime.request.update", fixture.users.playerA.id, { ...requestPayload, requestId: "downtime-1" }, "downtime-update"),
      commandRequest("downtime.request.set-status", fixture.users.gmB.id, { groupId: fixture.groupA.id, requestId: "downtime-1", status: "approved", result: "ok" }, "downtime-status"),
      commandRequest("downtime.request.set-checks", fixture.users.gmB.id, { groupId: fixture.groupA.id, requestId: "downtime-1", checks: [] }, "downtime-checks"),
      commandRequest("downtime.request.record-check", fixture.users.playerA.id, { groupId: fixture.groupA.id, actorId: fixture.memberA.id, requestId: "downtime-1", checkId: "check-1", result: { total: 18 } }, "downtime-record"),
      commandRequest("downtime.project.continue", fixture.users.playerA.id, { groupId: fixture.groupA.id, actorId: fixture.memberA.id, requestId: "downtime-1", checkId: "check-1", result: { total: 18 } }, "downtime-continue"),
      commandRequest("downtime.project.close", fixture.users.playerA.id, { groupId: fixture.groupA.id, actorId: fixture.memberA.id, requestId: "downtime-1" }, "downtime-close"),
      commandRequest("downtime.weeks.grant", fixture.users.gmB.id, { groupId: fixture.groupA.id, actorIds: [fixture.memberA.id], weeks: 1, reason: "", fromIsoDate: "" }, "downtime-grant"),
      commandRequest("downtime.weeks.revoke", fixture.users.gmB.id, { groupId: fixture.groupA.id, actorIds: [fixture.memberA.id], weeks: 1, reason: "" }, "downtime-revoke"),
      commandRequest("downtime.history.clear", fixture.users.gmB.id, { groupId: fixture.groupA.id }, "downtime-clear")
    ];
    for (const request of requests) await moduleApi.handleSocketMessage(request);
    const denied = commandRequest("downtime.request.create", fixture.users.playerB.id, requestPayload, "downtime-foreign-owner");
    const playerGrant = commandRequest("downtime.weeks.grant", fixture.users.playerA.id, { groupId: fixture.groupA.id, actorIds: [fixture.memberA.id], weeks: 1, reason: "", fromIsoDate: "" }, "downtime-player-grant");
    await moduleApi.handleSocketMessage(denied);
    await moduleApi.handleSocketMessage(playerGrant);
    await flushCommands();

    for (const request of requests) assert.equal(resultFor(fixture, request.requestId)?.ok, true, request.command);
    assert.equal(resultFor(fixture, denied.requestId)?.error?.code, "unauthorized");
    assert.equal(resultFor(fixture, playerGrant.requestId)?.error?.code, "unauthorized");
    assert.deepEqual(calls.find(([name]) => name === "create")?.[1]?.submittedByUserId, fixture.users.playerA.id);
    assert.equal(calls.find(([name]) => name === "record")?.[4]?.recordedByUserId, fixture.users.playerA.id);
    assert.equal(calls.find(([name]) => name === "continue")?.[2]?.recordedByUserId, fixture.users.playerA.id);
    assert.equal(calls.find(([name]) => name === "close")?.[2]?.projectClosedByUserId, fixture.users.playerA.id);
    assert.deepEqual(calls.find(([name]) => name === "grant")?.[1], {
      groupId: fixture.groupA.id,
      actorIds: [fixture.memberA.id],
      weeks: 1,
      reason: "",
      fromIsoDate: ""
    });
    assert.equal(fixture.writes.length, 0);
  }
  finally {
    fixture.restore();
  }
});

test("inactive downtime callers await a typed result while legacy raw requests do nothing", async () => {
  const fixture = installFixture({ currentUserId: "gm-b" });
  try {
    const moduleApi = new RebreyaMainModule();
    let localWrites = 0;
    let refreshes = 0;
    moduleApi.downtimeService.createRequest = async () => {
      localWrites += 1;
      return { id: "local", actorId: fixture.memberA.id };
    };
    moduleApi.refreshDowntimeViews = async () => {
      refreshes += 1;
    };
    const pending = moduleApi.createDowntimeRequest({
      groupId: fixture.groupA.id,
      actorId: fixture.memberA.id,
      actionId: "training",
      title: "Training",
      description: "",
      weeks: 1,
      craftProject: null,
      targetActionSelections: []
    });
    await flushCommands();
    const outbound = fixture.emitted[0]?.message;
    assert.deepEqual(outbound, {
      type: COMMAND_REQUEST_TYPE,
      command: "downtime.request.create",
      requestId: outbound?.requestId,
      senderId: fixture.users.gmB.id,
      payload: {
        groupId: fixture.groupA.id,
        actorId: fixture.memberA.id,
        actionId: "training",
        title: "Training",
        description: "",
        weeks: 1,
        craftProject: null,
        targetActionSelections: []
      }
    });
    assert.equal(localWrites, 0);
    assert.equal(fixture.writes.length, 0);
    await moduleApi.handleSocketMessage({
      type: COMMAND_RESULT_TYPE,
      command: outbound.command,
      requestId: outbound.requestId,
      forUserId: fixture.users.gmB.id,
      senderId: fixture.users.gmA.id,
      ok: true,
      data: { id: "remote", actorId: fixture.memberA.id }
    });
    assert.deepEqual(await pending, { id: "remote", actorId: fixture.memberA.id });
    assert.equal(refreshes, 1);

    fixture.emitted.length = 0;
    globalThis.game.user = fixture.users.gmA;
    await moduleApi.handleSocketMessage({
      type: "downtime-create-request",
      requestId: "retired-downtime-request",
      senderId: fixture.users.playerA.id,
      payload: { groupId: fixture.groupA.id, actorId: fixture.memberA.id }
    });
    assert.equal(localWrites, 0);
    assert.equal(fixture.writes.length, 0);
    assert.equal(fixture.emitted.length, 0);
  }
  finally {
    fixture.restore();
  }
});

test("downtime and calendar commands preserve concurrent changes to one group state", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const grant = commandRequest("downtime.weeks.grant", fixture.users.gmB.id, {
      groupId: fixture.groupA.id,
      actorIds: [fixture.memberA.id],
      weeks: 1,
      reason: "",
      fromIsoDate: "1200-01-03"
    }, "downtime-concurrent-grant");
    const calendar = commandRequest("group.calendar.patch", fixture.users.playerA.id, {
      groupActorId: fixture.groupA.id,
      patch: { isoDate: "1200-01-04" }
    }, "downtime-concurrent-calendar");

    await Promise.all([
      moduleApi.handleSocketMessage(grant),
      moduleApi.handleSocketMessage(calendar)
    ]);
    await flushCommands();

    const groupState = fixture.store[SETTINGS_KEYS.GROUP_STATE].groupsById[fixture.groupA.id];
    assert.equal(resultFor(fixture, grant.requestId)?.ok, true);
    assert.equal(resultFor(fixture, calendar.requestId)?.ok, true);
    assert.equal(groupState.calendar.isoDate, "1200-01-04");
    assert.equal(moduleApi.downtimeService.getSnapshot({ actorId: fixture.memberA.id }).grants.length, 1);
    assert.equal(fixture.maxConcurrentSettingWrites, 1);
  }
  finally {
    fixture.restore();
  }
});

test("RebreyaMainModule rejects an unknown typed command before legacy dispatch", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const request = commandRequest("unknown.command", fixture.users.playerA.id, {}, "unknown");
    await moduleApi.handleSocketMessage(request);
    await flushCommands();

    assert.deepEqual(resultFor(fixture, request.requestId), {
      type: COMMAND_RESULT_TYPE,
      command: request.command,
      requestId: request.requestId,
      forUserId: fixture.users.playerA.id,
      senderId: fixture.users.gmA.id,
      ok: false,
      error: {
        code: "unknown-command",
        message: "Unknown socket command: unknown.command"
      }
    });
    assert.equal(fixture.emitted.every((entry) => entry.channel === SOCKET_CHANNEL), true);
  }
  finally {
    fixture.restore();
  }
});

test("inactive clients ignore legacy setSetting messages", async () => {
  const fixture = installFixture({ currentUserId: "gm-b" });
  try {
    const moduleApi = new RebreyaMainModule();
    await moduleApi.handleSocketMessage({
      type: "setSetting",
      key: SETTINGS_KEYS.GROUP_STATE,
      data: { version: 1, groupsById: {} },
      senderId: fixture.users.playerA.id,
      requestId: "legacy-inactive"
    });

    assert.equal(fixture.writes.length, 0);
    assert.equal(fixture.emitted.length, 0);
  }
  finally {
    fixture.restore();
  }
});

test("an inactive GM routes setMechanusEnabled through the typed command result", async () => {
  const fixture = installFixture({ currentUserId: "gm-b" });
  try {
    const moduleApi = new RebreyaMainModule();
    let refreshCount = 0;
    moduleApi.refreshOpenApps = async () => {
      refreshCount += 1;
    };

    const pending = moduleApi.setMechanusEnabled(true);
    const request = fixture.emitted[0]?.message;
    assert.deepEqual(request, {
      type: COMMAND_REQUEST_TYPE,
      command: "cosmology.setMechanus",
      requestId: request?.requestId,
      senderId: fixture.users.gmB.id,
      payload: { enabled: true }
    });
    await moduleApi.handleSocketMessage({
      type: COMMAND_RESULT_TYPE,
      command: request.command,
      requestId: request.requestId,
      forUserId: fixture.users.gmB.id,
      senderId: fixture.users.gmA.id,
      ok: true,
      data: { version: 1, mechanusEnabled: true, retained: "yes" }
    });

    assert.deepEqual(await pending, { version: 1, mechanusEnabled: true, retained: "yes" });
    assert.equal(fixture.writes.length, 0);
    assert.equal(refreshCount, 0);
  }
  finally {
    fixture.restore();
  }
});

test("legacy requestSettingsUpdate rejects world writes locally for compatibility callers", async () => {
  const fixture = installFixture();
  try {
    await assert.rejects(
      requestSettingsUpdate(SETTINGS_KEYS.GROUP_STATE, { version: 1, groupsById: {} }),
      (error) => error?.code === "raw-setting-disabled" && error?.message === "raw-setting-disabled"
    );
    assert.equal(fixture.writes.length, 0);
    assert.equal(fixture.emitted.length, 0);
  }
  finally {
    fixture.restore();
  }
});
