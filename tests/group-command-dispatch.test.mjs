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

function installFixture({ currentUserId = "gm-a" } = {}) {
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  const previousUi = globalThis.ui;
  const gmA = { id: "gm-a", isGM: true, active: true };
  const gmB = { id: "gm-b", isGM: true, active: true };
  const playerA = { id: "player-a", isGM: false, active: true };
  const playerB = { id: "player-b", isGM: false, active: true };
  const memberA = createCharacter("character-a", playerA.id);
  const groupA = createGroup("group-a", [memberA]);
  const users = createUsers([gmA, gmB, playerA, playerB], gmA.id);
  const actors = [groupA, memberA];
  const emitted = [];
  const writes = [];
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
    [SETTINGS_KEYS.COSMOLOGY_STATE]: { version: 1, mechanusEnabled: false, retained: "yes" }
  };

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
        writes.push({ key, value: clone(value) });
        store[key] = clone(value);
        return value;
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
    memberA,
    store,
    users: { gmA, gmB, playerA, playerB },
    writes,
    restore() {
      globalThis.game = previousGame;
      globalThis.foundry = previousFoundry;
      globalThis.ui = previousUi;
    }
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
