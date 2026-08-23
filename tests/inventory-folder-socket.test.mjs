import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID, REBREYA_GROUP_FLAGS, SETTINGS_KEYS } from "../scripts/constants.js";
import {
  INVENTORY_FOLDER_CREATE_COMMAND,
  INVENTORY_FOLDER_RENAME_COMMAND,
  INVENTORY_FOLDER_MOVE_COMMAND,
  INVENTORY_FOLDER_DELETE_COMMAND,
  INVENTORY_ITEM_FOLDER_MOVE_COMMAND
} from "../scripts/data/inventory-service.js";
import {
  COMMAND_REQUEST_TYPE,
  COMMAND_RESULT_TYPE
} from "../scripts/infrastructure/foundry/socket-command-bus.js";

const originalHooks = globalThis.Hooks;
globalThis.Hooks = { once() {}, on() {} };
const { RebreyaMainModule } = await import(`../scripts/main.js?inventory-folder-socket=${Date.now()}`);
if (originalHooks === undefined) delete globalThis.Hooks;
else globalThis.Hooks = originalHooks;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createUser(id, { isGM = false, flags = {} } = {}) {
  return {
    id,
    isGM,
    active: true,
    flags: clone(flags),
    setFlagCalls: [],
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async setFlag(scope, key, value) {
      this.setFlagCalls.push({ scope, key, value: clone(value) });
      this.flags[scope] ??= {};
      this.flags[scope][key] = clone(value);
      return value;
    }
  };
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

function createGroup(id, members, { folders = [], itemFolderIds = {}, items = [] } = {}) {
  const flags = {
    [MODULE_ID]: {
      [REBREYA_GROUP_FLAGS.MANAGED]: true,
      inventoryFolders: {
        version: 1,
        folders: clone(folders),
        itemFolderIds: clone(itemFolderIds)
      }
    }
  };
  const contents = items.map((item) => ({ ...clone(item) }));
  return {
    id,
    type: "group",
    system: { members: members.map((actor) => ({ actor })) },
    flags,
    setFlagCalls: [],
    items: {
      contents,
      get: (itemId) => contents.find((item) => item.id === itemId) ?? null
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async setFlag(scope, key, value) {
      this.setFlagCalls.push({ scope, key, value: clone(value) });
      this.flags[scope] ??= {};
      this.flags[scope][key] = clone(value);
      return value;
    }
  };
}

function installFixture({ currentUserId = "gm-a", groupAFolders = [], groupAItems = [] } = {}) {
  const previousGame = globalThis.game;
  const previousFoundry = globalThis.foundry;
  const previousUi = globalThis.ui;
  const gm = createUser("gm-a", { isGM: true });
  const playerA = createUser("player-a");
  const playerB = createUser("player-b");
  const memberA = createCharacter("member-a", playerA.id);
  const memberB = createCharacter("member-b", playerB.id);
  const groupA = createGroup("group-a", [memberA], {
    folders: groupAFolders,
    items: groupAItems
  });
  const groupB = createGroup("group-b", [memberB]);
  const users = createUsers([gm, playerA, playerB], gm.id);
  const actors = [groupA, groupB, memberA, memberB];
  const emitted = [];
  const settingsWrites = [];
  const groupState = {
    version: 1,
    activeGroupActorId: groupA.id,
    groupsById: {
      [groupA.id]: { version: 1, groupActorId: groupA.id },
      [groupB.id]: { version: 1, groupActorId: groupB.id }
    }
  };
  const settingsStore = {
    [SETTINGS_KEYS.GROUP_STATE]: groupState,
    [SETTINGS_KEYS.CALENDAR_STATE]: {},
    [SETTINGS_KEYS.COSMOLOGY_STATE]: {}
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
      settings: new Map(),
      get(_moduleId, key) {
        return clone(settingsStore[key]);
      },
      async set(_moduleId, key, value) {
        settingsWrites.push({ key, value: clone(value) });
        settingsStore[key] = clone(value);
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
    emitted,
    groupA,
    groupB,
    memberA,
    memberB,
    settingsWrites,
    users: { gm, playerA, playerB },
    restore() {
      globalThis.game = previousGame;
      globalThis.foundry = previousFoundry;
      globalThis.ui = previousUi;
    }
  };
}

function commandRequest(command, senderId, payload, requestId) {
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

const COMMAND_CASES = [
  {
    command: INVENTORY_FOLDER_CREATE_COMMAND,
    method: "createInventoryFolder",
    payload: { groupActorId: "group-a", folderId: "created", name: "Created", parentId: null },
    wrongValue: (payload) => ({ ...payload, parentId: 7 })
  },
  {
    command: INVENTORY_FOLDER_RENAME_COMMAND,
    method: "renameInventoryFolder",
    payload: { groupActorId: "group-a", folderId: "a", name: "Renamed" },
    wrongValue: (payload) => ({ ...payload, folderId: null })
  },
  {
    command: INVENTORY_FOLDER_MOVE_COMMAND,
    method: "moveInventoryFolder",
    payload: { groupActorId: "group-a", folderId: "a", parentId: null },
    wrongValue: (payload) => ({ ...payload, parentId: false })
  },
  {
    command: INVENTORY_FOLDER_DELETE_COMMAND,
    method: "deleteInventoryFolder",
    payload: { groupActorId: "group-a", folderId: "a" },
    wrongValue: (payload) => ({ ...payload, folderId: null })
  },
  {
    command: INVENTORY_ITEM_FOLDER_MOVE_COMMAND,
    method: "moveInventoryItemToFolder",
    payload: { groupActorId: "group-a", itemId: "item-a", folderId: null },
    wrongValue: (payload) => ({ ...payload, folderId: 7 })
  }
];

test("five folder commands dispatch exact payloads and refresh only the returned Actor", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    const refreshCalls = [];
    moduleApi.refreshInventoryViews = async (request) => {
      refreshCalls.push(clone(request));
    };
    for (const entry of COMMAND_CASES) {
      moduleApi.inventoryService[entry.method] = async (payload) => {
        calls.push({ method: entry.method, payload: clone(payload) });
        return { actorId: payload.groupActorId, changed: true };
      };
      await moduleApi.handleSocketMessage(commandRequest(
        entry.command,
        fixture.users.playerA.id,
        entry.payload,
        `valid-${entry.command}`
      ));
    }
    await flushCommands();

    assert.deepEqual(calls, COMMAND_CASES.map((entry) => ({
      method: entry.method,
      payload: entry.payload
    })));
    assert.deepEqual(refreshCalls, COMMAND_CASES.map(() => ({ actorIds: [fixture.groupA.id] })));
    for (const entry of COMMAND_CASES) {
      assert.equal(resultFor(fixture, `valid-${entry.command}`)?.ok, true);
    }
  }
  finally {
    fixture.restore();
  }
});

test("folder command validators reject missing, extra, untrimmed and wrong nullable fields", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    let executions = 0;
    const invalidRequestIds = [];
    for (const entry of COMMAND_CASES) {
      moduleApi.inventoryService[entry.method] = async () => {
        executions += 1;
        return { actorId: fixture.groupA.id };
      };
      const missing = clone(entry.payload);
      delete missing[Object.keys(missing)[0]];
      const variants = [
        missing,
        { ...entry.payload, extra: true },
        { ...entry.payload, groupActorId: " group-a" },
        { ...entry.payload, groupActorId: "g".repeat(161) },
        entry.wrongValue(entry.payload)
      ];
      if (Object.hasOwn(entry.payload, "name")) {
        variants.push(
          { ...entry.payload, name: " Untrimmed" },
          { ...entry.payload, name: "n".repeat(81) }
        );
      }
      for (const [index, payload] of variants.entries()) {
        const requestId = `invalid-${entry.command}-${index}`;
        invalidRequestIds.push(requestId);
        await moduleApi.handleSocketMessage(commandRequest(
          entry.command,
          fixture.users.playerA.id,
          payload,
          requestId
        ));
      }
    }
    await flushCommands();

    assert.equal(executions, 0);
    for (const requestId of invalidRequestIds) {
      assert.equal(resultFor(fixture, requestId)?.error?.code, "invalid-payload");
    }
  }
  finally {
    fixture.restore();
  }
});

test("folder commands enforce the GM/member/foreign/unknown/transport authorization matrix", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const senders = [];
    moduleApi.refreshInventoryViews = async () => {};
    moduleApi.inventoryService.createInventoryFolder = async (payload) => {
      senders.push(payload.folderId);
      return { actorId: payload.groupActorId, folderId: payload.folderId, changed: true };
    };
    const payload = (folderId) => ({
      groupActorId: fixture.groupA.id,
      folderId,
      name: folderId,
      parentId: null
    });
    const requests = [
      commandRequest(INVENTORY_FOLDER_CREATE_COMMAND, fixture.users.gm.id, payload("gm"), "auth-gm"),
      commandRequest(INVENTORY_FOLDER_CREATE_COMMAND, fixture.users.playerA.id, payload("member"), "auth-member"),
      commandRequest(INVENTORY_FOLDER_CREATE_COMMAND, fixture.users.playerB.id, payload("foreign"), "auth-foreign"),
      commandRequest(INVENTORY_FOLDER_CREATE_COMMAND, "missing-user", payload("unknown"), "auth-unknown")
    ];
    for (const request of requests) await moduleApi.handleSocketMessage(request);
    await moduleApi.handleSocketMessage(
      commandRequest(INVENTORY_FOLDER_CREATE_COMMAND, fixture.users.playerA.id, payload("forged"), "auth-mismatch"),
      fixture.users.playerB.id
    );
    await flushCommands();

    assert.deepEqual(senders, ["gm", "member"]);
    assert.equal(resultFor(fixture, "auth-gm")?.ok, true);
    assert.equal(resultFor(fixture, "auth-member")?.ok, true);
    assert.equal(resultFor(fixture, "auth-foreign")?.error?.code, "unauthorized");
    assert.equal(resultFor(fixture, "auth-unknown")?.error?.code, "unknown-sender");
    assert.equal(resultFor(fixture, "auth-mismatch")?.error?.code, "sender-mismatch");
  }
  finally {
    fixture.restore();
  }
});

test("create replay is idempotent while a conflicting stable folder ID fails", async () => {
  const fixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    moduleApi.refreshInventoryViews = async () => {};
    const payload = {
      groupActorId: fixture.groupA.id,
      folderId: "stable-folder",
      name: "Stable",
      parentId: null
    };

    await moduleApi.handleSocketMessage(commandRequest(
      INVENTORY_FOLDER_CREATE_COMMAND,
      fixture.users.playerA.id,
      payload,
      "create-first"
    ));
    await moduleApi.handleSocketMessage(commandRequest(
      INVENTORY_FOLDER_CREATE_COMMAND,
      fixture.users.playerA.id,
      payload,
      "create-replay"
    ));
    await moduleApi.handleSocketMessage(commandRequest(
      INVENTORY_FOLDER_CREATE_COMMAND,
      fixture.users.playerA.id,
      { ...payload, name: "Conflict" },
      "create-conflict"
    ));
    await flushCommands();

    assert.equal(fixture.groupA.setFlagCalls.length, 1);
    assert.equal(resultFor(fixture, "create-first")?.data?.changed, true);
    assert.equal(resultFor(fixture, "create-replay")?.data?.changed, false);
    assert.equal(resultFor(fixture, "create-conflict")?.error?.code, "command-failed");
  }
  finally {
    fixture.restore();
  }
});

test("queued folder moves re-read live Actor state and reject a newly formed cycle", async () => {
  const fixture = installFixture({
    groupAFolders: [
      { id: "a", name: "A", parentId: null },
      { id: "b", name: "B", parentId: null }
    ]
  });
  try {
    const moduleApi = new RebreyaMainModule();
    moduleApi.refreshInventoryViews = async () => {};
    let releaseBlock;
    let enterBlock;
    const entered = new Promise((resolve) => { enterBlock = resolve; });
    const blocked = moduleApi.worldMutationCoordinator.run(
      `inventory-folders:${fixture.groupA.id}`,
      async () => {
        enterBlock();
        await new Promise((resolve) => { releaseBlock = resolve; });
      }
    );
    await entered;
    await moduleApi.handleSocketMessage(commandRequest(
      INVENTORY_FOLDER_MOVE_COMMAND,
      fixture.users.playerA.id,
      { groupActorId: fixture.groupA.id, folderId: "a", parentId: "b" },
      "stale-cycle"
    ));
    await new Promise((resolve) => setImmediate(resolve));
    fixture.groupA.flags[MODULE_ID].inventoryFolders.folders = [
      { id: "a", name: "A", parentId: null },
      { id: "b", name: "B", parentId: "a" }
    ];
    releaseBlock();
    await blocked;
    await flushCommands();

    assert.equal(resultFor(fixture, "stale-cycle")?.error?.code, "command-failed");
    assert.equal(fixture.groupA.setFlagCalls.length, 0);
  }
  finally {
    fixture.restore();
  }
});

test("module folder wrappers validate locally and route non-active clients through exact commands", async () => {
  const gmFixture = installFixture();
  try {
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    const refreshCalls = [];
    moduleApi.refreshInventoryViews = async (request) => refreshCalls.push(clone(request));
    for (const entry of COMMAND_CASES) {
      moduleApi.inventoryService[entry.method] = async (payload) => {
        calls.push({ method: entry.method, payload: clone(payload) });
        return { actorId: payload.groupActorId, changed: true };
      };
      await moduleApi[entry.method](entry.payload);
    }
    await assert.rejects(
      moduleApi.createInventoryFolder({ ...COMMAND_CASES[0].payload, extra: true }),
      /payload/iu
    );
    assert.deepEqual(calls, COMMAND_CASES.map((entry) => ({ method: entry.method, payload: entry.payload })));
    assert.deepEqual(refreshCalls, COMMAND_CASES.map(() => ({ actorIds: [gmFixture.groupA.id] })));
  }
  finally {
    gmFixture.restore();
  }

  const playerFixture = installFixture({ currentUserId: "player-a" });
  try {
    const moduleApi = new RebreyaMainModule();
    const requests = [];
    moduleApi.socketCommandBus.request = async (command, payload) => {
      requests.push({ command, payload: clone(payload) });
      return { actorId: payload.groupActorId };
    };
    for (const entry of COMMAND_CASES) await moduleApi[entry.method](entry.payload);

    assert.deepEqual(requests, COMMAND_CASES.map((entry) => ({
      command: entry.command,
      payload: entry.payload
    })));
  }
  finally {
    playerFixture.restore();
  }
});

test("personal expansion state merges queued views and writes only the current User flag", async () => {
  const fixture = installFixture({
    groupAFolders: [
      { id: "a", name: "A", parentId: null },
      { id: "b", name: "B", parentId: null }
    ]
  });
  fixture.users.gm.flags[MODULE_ID] = {
    inventoryFolderUi: {
      version: 1,
      groups: {
        [fixture.groupA.id]: { expandedFolderIds: ["a", "stale"] }
      }
    }
  };
  try {
    const moduleApi = new RebreyaMainModule();
    assert.deepEqual(
      moduleApi.getInventoryFolderUiState(fixture.groupA.id, ["a", "b"]),
      { version: 1, groupActorId: fixture.groupA.id, expandedFolderIds: ["a"] }
    );
    fixture.users.gm.flags[MODULE_ID].inventoryFolderUi.groups[fixture.groupA.id]
      .expandedFolderIds = ["stale"];

    let releaseBlock;
    let enterBlock;
    const entered = new Promise((resolve) => { enterBlock = resolve; });
    const blocked = moduleApi.worldMutationCoordinator.run(
      `inventory-folder-ui:${fixture.users.gm.id}`,
      async () => {
        enterBlock();
        await new Promise((resolve) => { releaseBlock = resolve; });
      }
    );
    await entered;
    const pending = moduleApi.setInventoryFolderExpanded(fixture.groupA.id, "b", true);
    fixture.users.gm.flags[MODULE_ID].inventoryFolderUi.groups[fixture.groupA.id]
      .expandedFolderIds = ["a", "stale"];
    releaseBlock();
    await blocked;

    assert.deepEqual(await pending, {
      version: 1,
      groupActorId: fixture.groupA.id,
      expandedFolderIds: ["a", "b"]
    });
    assert.deepEqual(await moduleApi.setInventoryFolderExpanded(fixture.groupA.id, "a", false), {
      version: 1,
      groupActorId: fixture.groupA.id,
      expandedFolderIds: ["b"]
    });
    assert.deepEqual(
      fixture.users.gm.getFlag(MODULE_ID, "inventoryFolderUi").groups[fixture.groupA.id],
      { expandedFolderIds: ["b"] }
    );
    assert.equal(fixture.users.gm.setFlagCalls.length, 2);
    assert.equal(fixture.groupA.setFlagCalls.length, 0);
    assert.equal(fixture.settingsWrites.length, 0);
    assert.equal(fixture.emitted.length, 0);
  }
  finally {
    fixture.restore();
  }
});
