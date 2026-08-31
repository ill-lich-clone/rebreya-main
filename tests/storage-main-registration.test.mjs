import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  COMMAND_REQUEST_TYPE,
  COMMAND_RESULT_TYPE
} from "../scripts/infrastructure/foundry/socket-command-bus.js";

function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  };
}

function createModuleRuntime({ user, users }) {
  const emitted = [];
  const restores = [
    replaceGlobal("Hooks", { once() {}, on() {} }),
    replaceGlobal("canvas", { tokens: { controlled: [] } }),
    replaceGlobal("CONFIG", {}),
    replaceGlobal("fromUuid", async () => null),
    replaceGlobal("foundry", { utils: { randomID: () => "generated-mutation" } }),
    replaceGlobal("game", {
      user,
      users: { activeGM: users.find((candidate) => candidate.isGM), contents: users },
      socket: { emit(channel, message) { emitted.push({ channel, message }); } },
      settings: { get: () => false, set: async () => undefined }
    })
  ];
  return { emitted, restore: () => restores.reverse().forEach((restore) => restore()) };
}

async function waitForSocketResult(emitted, requestId) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    const result = emitted.find(({ message }) => (
      message?.type === COMMAND_RESULT_TYPE && message.requestId === requestId
    ));
    if (result) return result.message;
  }
  return null;
}

function ingressPlan(groupActorId = "group-a", rowIds = ["row-1"]) {
  return {
    version: 1,
    groupActorId,
    rulesRevision: 0,
    requestedFolderId: null,
    rows: rowIds.map((sourceKey) => ({
      sourceKey,
      identity: {
        sourceType: "",
        sourceId: "",
        documentType: "weapon",
        durabilityState: "ineligible",
        quantity: 1
      },
      quantity: 1,
      matchedRuleId: null,
      action: { type: "legacy", folderId: null }
    })),
    rootOverrideSourceKeys: []
  };
}

test("main registers the storage deposit socket API and current cache keys", async () => {
  const main = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
  const storageCommand = await readFile(new URL("../scripts/data/storage-command-service.js", import.meta.url), "utf8");
  const storageHooks = await readFile(new URL("../scripts/integrations/storage-token-hooks.js", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url), "utf8"));

  assert.match(main, /isValidStorageDepositPayload/u);
  assert.match(main, /StorageJournalReader/u);
  assert.match(main, /STORAGE_DEPOSIT_COMMAND\s*=\s*"storage\.deposit"/u);
  assert.match(main, /register\(STORAGE_DEPOSIT_COMMAND,\s*\{/u);
  assert.match(main, /this\.storageCommandService\.deposit\(payload,\s*\{ sender \}\)/u);
  assert.match(main, /async inspectStorageDepositSource\(/u);
  assert.match(main, /async depositStorageItem\(/u);
  assert.match(main, /async setStorageRowBroken\(/u);
  assert.match(main, /isValidStorageDropItemPayload/u);
  assert.match(main, /STORAGE_DROP_ITEM_COMMAND\s*=\s*"storage\.drop-item-to-scene"/u);
  assert.match(main, /register\(STORAGE_DROP_ITEM_COMMAND,\s*\{/u);
  assert.match(main, /this\.storageCommandService\.dropItemToScene\(payload,\s*\{ sender \}\)/u);
  assert.match(main, /async dropStorageItemToScene\(/u);
  assert.match(main, /isValidStorageJournalDropPayload/u);
  assert.match(main, /STORAGE_JOURNAL_DROP_COMMAND\s*=\s*"storage\.journal\.drop-to-scene"/u);
  assert.match(main, /register\(STORAGE_JOURNAL_DROP_COMMAND,\s*\{/u);
  assert.match(main, /authorize:\s*\(_payload,\s*\{ sender \}\)\s*=>\s*sender\?\.isGM\s*===\s*true/u);
  assert.match(main, /this\.storageCommandService\.dropJournalToScene\(payload,\s*\{ sender \}\)/u);
  assert.match(main, /async dropStorageJournalToScene\(/u);
  assert.doesNotMatch(main, /BuiltinCoinTemplateService|builtinCoinTemplateService|restoreBuiltinCoinTemplates/u);
  assert.match(main, /this\.storageJournalReader = new StorageJournalReader\(\{/u);
  assert.match(main, /this\.storageTriggerDnd5eAdapter = new StorageTriggerDnd5eAdapter\(\{/u);
  assert.match(main, /this\.storageTriggerService = new StorageTriggerService\(\{/u);
  assert.match(main, /this\.storageTriggerPromptBroker = new StorageTriggerPromptBroker\(\{/u);
  assert.match(main, /this\.storageTriggerPromptBroker\.handleMessage\(message, senderId\)/u);
  assert.match(main, /STORAGE_TRIGGER_READ_COMMAND\s*=\s*"storage\.triggers\.read"/u);
  assert.match(main, /STORAGE_TRIGGER_SAVE_COMMAND\s*=\s*"storage\.triggers\.save"/u);
  assert.match(main, /STORAGE_TRIGGER_RESET_COMMAND\s*=\s*"storage\.triggers\.reset"/u);
  assert.match(main, /register\(STORAGE_TRIGGER_READ_COMMAND,\s*\{[\s\S]*?sender\?\.isGM\s*===\s*true/u);
  assert.match(main, /register\(STORAGE_TRIGGER_SAVE_COMMAND,\s*\{[\s\S]*?sender\?\.isGM\s*===\s*true/u);
  assert.match(main, /register\(STORAGE_TRIGGER_RESET_COMMAND,\s*\{[\s\S]*?sender\?\.isGM\s*===\s*true/u);
  assert.match(main, /async getStorageTriggers\(/u);
  assert.match(main, /async saveStorageTriggers\(/u);
  assert.match(main, /async resetStorageTriggerExecutions\(/u);
  assert.match(main, /async openStorageTriggerEditor\(/u);
  assert.match(main, /this\.triggerTargetCoordinator = new TriggerTargetCoordinator\(\{/u);
  assert.match(main, /this\.doorTriggerCommandService = new DoorTriggerCommandService\(\{/u);
  assert.match(main, /triggerTargetCoordinator:\s*this\.triggerTargetCoordinator/u);
  assert.match(main, /DOOR_OPEN_COMMAND\s*=\s*"door\.open"/u);
  assert.match(main, /DOOR_TRIGGER_READ_COMMAND\s*=\s*"door\.triggers\.read"/u);
  assert.match(main, /DOOR_TRIGGER_SAVE_COMMAND\s*=\s*"door\.triggers\.save"/u);
  assert.match(main, /DOOR_TRIGGER_RESET_COMMAND\s*=\s*"door\.triggers\.reset"/u);
  assert.match(main, /getDoorTriggerPreflight\(/u);
  assert.match(main, /async getDoorTriggers\(/u);
  assert.match(main, /async saveDoorTriggers\(/u);
  assert.match(main, /async resetDoorTriggerExecutions\(/u);
  assert.match(main, /async attemptDoorOpen\(/u);
  assert.match(main, /async openDoorTriggerEditor\(/u);
  assert.match(main, /registerDoorTriggerHooks\(moduleApi/u);
  assert.match(main, /registerStorageTokenDropHooks\(moduleApi/u);
  assert.match(main, /STORAGE_TOKEN_CHARACTER_COMMAND\s*=\s*"storage\.token-to-character"/u);
  assert.match(main, /register\(STORAGE_TOKEN_CHARACTER_COMMAND,\s*\{/u);
  assert.match(main, /async moveStorageTokenToCharacter\(/u);
  assert.match(main, /STORAGE_RESTORE_PORTABLE_COMMAND\s*=\s*"storage\.restore-portable"/u);
  assert.match(main, /register\(STORAGE_RESTORE_PORTABLE_COMMAND,\s*\{/u);
  assert.match(main, /this\.storageCommandService\.restorePortableItem\(payload,\s*\{ sender \}\)/u);
  assert.match(main, /this\.storageContainerItemService = new StorageContainerItemService\(\);/u);
  assert.match(main, /await this\.storageGroundPileService\.repairLegacyCoinRows\(\);/u);
  for (const importPath of [
    "data/storage-service.js?v=1.4.195-storage-administration",
    "data/storage-open-sound-service.js?v=1.4.145-coin-icons-storage-sound",
    "data/storage-access.js?v=1.4.197-door-trigger-target",
    "data/storage-ground-pile-service.js?v=1.4.195-storage-administration",
    "data/storage-container-item-service.js?v=1.4.130-storage-player-fixes",
    "data/storage-deposit-source.js?v=1.4.195-storage-administration",
    "data/storage-command-service.js?v=1.4.197-door-trigger-target",
    "data/storage-trigger-service.js?v=1.4.197-door-trigger-target",
    "integrations/storage-token-hooks.js?v=1.4.197-door-trigger-target",
    "combat/hooks.js?v=1.4.191-magic-item-runtime",
    "integrations/storage-transfer-drop.js?v=1.4.161-journal-scene-items",
    "integrations/storage-token-drop.js?v=1.4.132-storage-owned-character-resolution",
    "integrations/storage-container-hierarchy.js?v=1.4.122-storage-container-cycle-repair"
  ]) {
    assert.equal(main.includes(importPath), true, importPath);
  }
  for (const importPath of [
    "storage-service.js?v=1.4.195-storage-administration",
    "storage-deposit-source.js?v=1.4.195-storage-administration",
    "storage-access.js?v=1.4.197-door-trigger-target"
  ]) {
    assert.equal(storageCommand.includes(importPath), true, importPath);
  }
  for (const importPath of [
    "data/storage-access.js?v=1.4.197-door-trigger-target",
    "ui/storage-token-overlay.js?v=1.4.197-door-trigger-target",
    "storage-ground-pile-frame.js?v=1.4.195-storage-administration"
  ]) {
    assert.equal(storageHooks.includes(importPath), true, importPath);
  }
  assert.equal(manifest.version, "1.4.199");
  assert.match(main, /await registerStorageContainerHierarchyHooks\(\{ Hooks \}\)/u);
});

test("real door command registrations validate and execute exact typed routes", async () => {
  const gm = { id: "gm", isGM: true, active: true };
  const player = { id: "player", isGM: false, active: true };
  const runtime = createModuleRuntime({ user: gm, users: [gm, player] });
  try {
    const main = await import(`../scripts/main.js?door-registration=${Date.now()}`);
    const moduleApi = new main.RebreyaMainModule();
    const calls = [];
    moduleApi.doorTriggerCommandService = {
      async open(payload, context) { calls.push(["open", payload, context]); return { opened: true }; },
      async readTriggers(payload, context) { calls.push(["read", payload, context]); return { enabled: false, triggers: {} }; },
      async saveTriggers(payload, context) { calls.push(["save", payload, context]); return { enabled: payload.enabled, triggers: {} }; },
      async resetTriggers(payload, context) { calls.push(["reset", payload, context]); return { enabled: true, triggers: {} }; }
    };
    const definitions = {
      chainsByEvent: { beforeOpen: [], afterOpen: [], afterClaim: [], emptied: [] }
    };
    const requests = [
      [main.DOOR_OPEN_COMMAND, "door-open", { wallUuid: "Scene.room.Wall.north", characterTokenUuid: "Scene.room.Token.hero", mutationId: "open-1" }],
      [main.DOOR_TRIGGER_READ_COMMAND, "door-read", { wallUuid: "Scene.room.Wall.north" }],
      [main.DOOR_TRIGGER_SAVE_COMMAND, "door-save", { wallUuid: "Scene.room.Wall.north", enabled: true, definitions, expectedRevision: 0, operationId: "save-1" }],
      [main.DOOR_TRIGGER_RESET_COMMAND, "door-reset", { wallUuid: "Scene.room.Wall.north", operationId: "reset-1" }]
    ];
    for (const [command, requestId, payload] of requests) {
      assert.equal(moduleApi.socketCommandBus.handleMessage({
        type: COMMAND_REQUEST_TYPE, command, requestId, senderId: gm.id, payload
      }, { transportSenderId: gm.id }), true);
      assert.equal((await waitForSocketResult(runtime.emitted, requestId))?.ok, true);
    }
    assert.deepEqual(calls.map(([name]) => name), ["open", "read", "save", "reset"]);
    assert.equal(calls.every(([, , context]) => context.sender === gm), true);

    assert.equal(moduleApi.socketCommandBus.handleMessage({
      type: COMMAND_REQUEST_TYPE,
      command: main.DOOR_TRIGGER_READ_COMMAND,
      requestId: "door-player-read",
      senderId: player.id,
      payload: { wallUuid: "Scene.room.Wall.north" }
    }, { transportSenderId: player.id }), true);
    assert.equal((await waitForSocketResult(runtime.emitted, "door-player-read"))?.error?.code, "unauthorized");
    assert.equal(calls.length, 4);
  }
  finally {
    runtime.restore();
  }
});

test("real storage command registrations validate envelopes and execute their composed handlers", async () => {
  const gm = { id: "gm", isGM: true, active: true };
  const player = { id: "player", isGM: false, active: true };
  const runtime = createModuleRuntime({ user: gm, users: [gm, player] });
  try {
    const {
      RebreyaMainModule,
      STORAGE_CLAIM_ALL_COMMAND,
      STORAGE_COIN_DROP_COMMAND,
      STORAGE_JOURNAL_DROP_COMMAND,
      STORAGE_JOURNAL_READ_COMMAND
    } = await import(
      `../scripts/main.js?storage-registration=${Date.now()}`
    );
    assert.equal(STORAGE_CLAIM_ALL_COMMAND, "storage.claim-all");
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.storageCommandService = {
      async readJournal(payload, context) {
        calls.push({ command: "journal", payload, context });
        return { name: "Journal", pages: [] };
      },
      async dropCoinsToScene(payload, context) {
        calls.push({ command: "coins", payload, context });
        return { created: true };
      },
      async dropJournalToScene(payload, context) {
        calls.push({ command: "journal-drop", payload, context });
        return { changed: true, created: true, merged: false, duplicate: false };
      },
      async claimAll(payload, context) {
        calls.push({ command: "bulk", payload, context });
        return { changed: true, claimedRowIds: ["row-1"] };
      }
    };

    const journalPayload = { tokenUuid: "Scene.scene.Token.chest", characterTokenUuid: "", rowId: "journal-row" };
    const coinPayload = {
      characterTokenUuid: "Scene.scene.Token.hero",
      denomination: "gp",
      itemUuid: "Item.coin",
      mutationId: "coin-command",
      quantity: 2,
      sceneId: "Scene.scene",
      x: 100,
      y: 200
    };
    const journalDropPayload = {
      sourceUuid: "JournalEntry.notes",
      documentName: "JournalEntry",
      mutationId: "journal-drop-command",
      sceneId: "Scene.scene",
      x: 100,
      y: 200
    };
    const bulkPayload = {
      tokenUuid: "Scene.scene.Token.chest",
      characterTokenUuid: "Scene.scene.Token.hero",
      destination: "self",
      target: null,
      ingressPlan: null,
      mutationId: "bulk-command"
    };
    for (const [command, requestId, payload] of [
      [STORAGE_JOURNAL_READ_COMMAND, "journal-valid", journalPayload],
      [STORAGE_COIN_DROP_COMMAND, "coins-valid", coinPayload],
      [STORAGE_JOURNAL_DROP_COMMAND, "journal-drop-valid", journalDropPayload],
      [STORAGE_CLAIM_ALL_COMMAND, "bulk-valid", bulkPayload]
    ]) {
      assert.equal(moduleApi.socketCommandBus.handleMessage({
        type: COMMAND_REQUEST_TYPE, command, requestId, senderId: gm.id, payload
      }, { transportSenderId: gm.id }), true);
      assert.deepEqual(await waitForSocketResult(runtime.emitted, requestId), {
        type: COMMAND_RESULT_TYPE,
        command,
        requestId,
        forUserId: gm.id,
        senderId: gm.id,
        ok: true,
        data: command === STORAGE_JOURNAL_READ_COMMAND
          ? { name: "Journal", pages: [] }
          : command === STORAGE_JOURNAL_DROP_COMMAND
            ? { changed: true, created: true, merged: false, duplicate: false }
          : command === STORAGE_CLAIM_ALL_COMMAND
            ? { changed: true, claimedRowIds: ["row-1"] }
            : { created: true }
      });
    }
    assert.deepEqual(calls.map(({ command, payload }) => ({ command, payload })), [
      { command: "journal", payload: journalPayload },
      { command: "coins", payload: coinPayload },
      { command: "journal-drop", payload: journalDropPayload },
      { command: "bulk", payload: bulkPayload }
    ]);
    assert.equal(calls[0].context.sender, gm);
    assert.equal(calls[1].context.sender, gm);
    assert.equal(calls[2].context.sender, gm);
    assert.equal(calls[3].context.sender, gm);

    for (const [command, requestId, payload] of [
      [STORAGE_JOURNAL_READ_COMMAND, "journal-invalid", { ...journalPayload, rowId: "" }],
      [STORAGE_COIN_DROP_COMMAND, "coins-invalid", { ...coinPayload, denomination: "electrum" }],
      [STORAGE_JOURNAL_DROP_COMMAND, "journal-drop-invalid", { ...journalDropPayload, extra: true }],
      [STORAGE_CLAIM_ALL_COMMAND, "bulk-invalid", { ...bulkPayload, target: {} }]
    ]) {
      assert.equal(moduleApi.socketCommandBus.handleMessage({
        type: COMMAND_REQUEST_TYPE, command, requestId, senderId: gm.id, payload
      }, { transportSenderId: gm.id }), true);
      assert.equal((await waitForSocketResult(runtime.emitted, requestId))?.error?.code, "invalid-payload");
    }
    assert.equal(calls.length, 4);

    assert.equal(moduleApi.socketCommandBus.handleMessage({
      type: COMMAND_REQUEST_TYPE,
      command: STORAGE_JOURNAL_DROP_COMMAND,
      requestId: "journal-drop-player",
      senderId: player.id,
      payload: journalDropPayload
    }, { transportSenderId: player.id }), true);
    assert.equal((await waitForSocketResult(runtime.emitted, "journal-drop-player"))?.error?.code, "unauthorized");
    assert.equal(calls.length, 4);
  }
  finally {
    runtime.restore();
  }
});

test("storage bulk party command rejects a sender who manages no member of the exact group", async () => {
  const gm = { id: "gm", isGM: true, active: true };
  const player = { id: "player", isGM: false, active: true };
  const runtime = createModuleRuntime({ user: gm, users: [gm, player] });
  try {
    const { MODULE_ID, REBREYA_GROUP_FLAGS } = await import("../scripts/constants.js");
    const { RebreyaMainModule, STORAGE_CLAIM_ALL_COMMAND } = await import(
      `../scripts/main.js?storage-bulk-authorization=${Date.now()}`
    );
    const member = {
      id: "member",
      testUserPermission: () => false
    };
    const group = {
      id: "group-a",
      type: "group",
      system: { members: [{ actor: member }] },
      getFlag: (scope, key) => scope === MODULE_ID && key === REBREYA_GROUP_FLAGS.MANAGED
    };
    globalThis.game.actors = {
      get: (id) => id === group.id ? group : null,
      contents: [group]
    };
    const moduleApi = new RebreyaMainModule();
    moduleApi.groupContextService.getRegistry = () => ({ groupsById: { [group.id]: { id: group.id } } });
    let calls = 0;
    moduleApi.storageCommandService = {
      async claimAll() {
        calls += 1;
        return { changed: true };
      }
    };
    const payload = {
      tokenUuid: "Scene.scene.Token.chest",
      characterTokenUuid: "Scene.scene.Token.hero",
      destination: "party",
      target: { groupActorId: group.id, folderId: null },
      ingressPlan: ingressPlan(group.id),
      mutationId: "bulk-forbidden"
    };

    assert.equal(moduleApi.socketCommandBus.handleMessage({
      type: COMMAND_REQUEST_TYPE,
      command: STORAGE_CLAIM_ALL_COMMAND,
      requestId: "bulk-forbidden",
      senderId: player.id,
      payload
    }, { transportSenderId: player.id }), true);

    assert.equal((await waitForSocketResult(runtime.emitted, "bulk-forbidden"))?.error?.code, "unauthorized");
    assert.equal(calls, 0);
  }
  finally {
    runtime.restore();
  }
});

test("real public coin API uses active-GM direct execution and player socket routing", async () => {
  const gm = { id: "gm", isGM: true, active: true };
  const player = { id: "player", isGM: false, active: true };
  const runtime = createModuleRuntime({ user: gm, users: [gm, player] });
  try {
    const { RebreyaMainModule, STORAGE_COIN_DROP_COMMAND } = await import(
      `../scripts/main.js?storage-coin-api=${Date.now()}`
    );
    const moduleApi = new RebreyaMainModule();
    const directCalls = [];
    moduleApi.storageCommandService = {
      async dropCoinsToScene(payload, context) {
        directCalls.push({ payload, context });
        return { direct: true };
      }
    };
    const request = {
      characterTokenUuid: "Scene.scene.Token.hero",
      sceneId: "Scene.scene",
      x: 10,
      y: 20,
      quantity: 3
    };
    assert.deepEqual(await moduleApi.dropStorageCoinsToScene(" Item.coin ", " gp ", request), { direct: true });
    assert.deepEqual({ ...directCalls[0].payload, mutationId: "generated" }, {
      itemUuid: "Item.coin",
      denomination: "gp",
      characterTokenUuid: "Scene.scene.Token.hero",
      sceneId: "Scene.scene",
      x: 10,
      y: 20,
      quantity: 3,
      mutationId: "generated"
    });
    assert.match(directCalls[0].payload.mutationId, /^storage-coin-scene-.+-generated-mutation$/u);
    assert.equal(directCalls[0].context.sender, gm);

    globalThis.game.user = player;
    const pending = moduleApi.dropStorageCoinsToScene("Item.coin", "gp", { ...request, mutationId: "player-coin" });
    const outbound = runtime.emitted.at(-1).message;
    assert.match(outbound.requestId, /^command-/u);
    assert.deepEqual(outbound, {
      type: COMMAND_REQUEST_TYPE,
      command: STORAGE_COIN_DROP_COMMAND,
      requestId: outbound.requestId,
      senderId: player.id,
      payload: {
        itemUuid: "Item.coin",
        denomination: "gp",
        characterTokenUuid: "Scene.scene.Token.hero",
        sceneId: "Scene.scene",
        x: 10,
        y: 20,
        quantity: 3,
        mutationId: "player-coin"
      }
    });
    assert.equal(directCalls.length, 1);
    moduleApi.socketCommandBus.handleMessage({
      type: COMMAND_RESULT_TYPE,
      command: STORAGE_COIN_DROP_COMMAND,
      requestId: outbound.requestId,
      forUserId: player.id,
      senderId: gm.id,
      ok: true,
      data: { routed: true }
    });
    assert.deepEqual(await pending, { routed: true });
  }
  finally {
    runtime.restore();
  }
});

test("real public Journal scene API uses active-GM direct execution and player socket routing", async () => {
  const gm = { id: "gm", isGM: true, active: true };
  const player = { id: "player", isGM: false, active: true };
  const runtime = createModuleRuntime({ user: gm, users: [gm, player] });
  try {
    const { RebreyaMainModule, STORAGE_JOURNAL_DROP_COMMAND } = await import(
      `../scripts/main.js?storage-journal-api=${Date.now()}`
    );
    const moduleApi = new RebreyaMainModule();
    const directCalls = [];
    moduleApi.storageCommandService = {
      async dropJournalToScene(payload, context) {
        directCalls.push({ payload, context });
        return { direct: true };
      }
    };
    const request = { sceneId: "scene", x: 100, y: 200, mutationId: "gm-journal-drop" };
    assert.deepEqual(
      await moduleApi.dropStorageJournalToScene(" JournalEntry.notes ", {
        ...request,
        documentName: "JournalEntryPage"
      }),
      { direct: true }
    );
    assert.deepEqual(directCalls[0].payload, {
      sourceUuid: "JournalEntry.notes",
      documentName: "JournalEntryPage",
      mutationId: "gm-journal-drop",
      sceneId: "scene",
      x: 100,
      y: 200
    });
    assert.equal(directCalls[0].context.sender, gm);

    globalThis.game.user = player;
    const pending = moduleApi.dropStorageJournalToScene("JournalEntry.notes", {
      ...request,
      documentName: "JournalEntryPage",
      mutationId: "player-journal-drop"
    });
    const outbound = runtime.emitted.at(-1).message;
    assert.deepEqual(outbound, {
      type: COMMAND_REQUEST_TYPE,
      command: STORAGE_JOURNAL_DROP_COMMAND,
      requestId: outbound.requestId,
      senderId: player.id,
      payload: {
        sourceUuid: "JournalEntry.notes",
        documentName: "JournalEntryPage",
        mutationId: "player-journal-drop",
        sceneId: "scene",
        x: 100,
        y: 200
      }
    });
    assert.equal(directCalls.length, 1);
    moduleApi.socketCommandBus.handleMessage({
      type: COMMAND_RESULT_TYPE,
      command: STORAGE_JOURNAL_DROP_COMMAND,
      requestId: outbound.requestId,
      forUserId: player.id,
      senderId: gm.id,
      ok: true,
      data: { routed: true }
    });
    assert.deepEqual(await pending, { routed: true });
  }
  finally {
    runtime.restore();
  }
});

test("composed storage command service receives the module durability service instance", async () => {
  const gm = { id: "gm", isGM: true, active: true };
  const runtime = createModuleRuntime({ user: gm, users: [gm] });
  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?storage-durability=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    assert.equal(moduleApi.storageCommandService.durabilityService, moduleApi.durabilityService);
    assert.equal(moduleApi.storageCommandService.triggerTargetCoordinator, moduleApi.triggerTargetCoordinator);
  }
  finally {
    runtime.restore();
  }
});

test("mixed coin asset stays presentation-only and is outside composition and template sync", async () => {
  const [main, presentation] = await Promise.all([
    readFile(new URL("../scripts/main.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/data/storage-pile-presentation.js", import.meta.url), "utf8")
  ]);

  assert.match(presentation, /assets\/storage\/piles/u);
  assert.match(presentation, /\["coins", "", "Куча монет", "coins\.png"\]/u);
  assert.doesNotMatch(main, /assets\/storage\/piles\/coins\.png/u);
});

test("storage drop hook registrations have independent error boundaries", async () => {
  const main = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
  const transferRegistration = main.indexOf("registerStorageTransferDropHooks(moduleApi");
  const tokenRegistration = main.indexOf("registerStorageTokenDropHooks(moduleApi");
  const transferCatch = main.indexOf("Failed to register storage transfer drop hooks", transferRegistration);

  assert.ok(transferRegistration >= 0);
  assert.ok(tokenRegistration > transferRegistration);
  assert.ok(transferCatch > transferRegistration && transferCatch < tokenRegistration);
});
