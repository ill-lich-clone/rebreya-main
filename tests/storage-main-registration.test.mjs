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

test("main registers the storage deposit socket API and current cache keys", async () => {
  const main = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
  const storageCommand = await readFile(new URL("../scripts/data/storage-command-service.js", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url), "utf8"));

  assert.match(main, /isValidStorageDepositPayload/u);
  assert.match(main, /StorageJournalReader/u);
  assert.match(main, /STORAGE_DEPOSIT_COMMAND\s*=\s*"storage\.deposit"/u);
  assert.match(main, /register\(STORAGE_DEPOSIT_COMMAND,\s*\{/u);
  assert.match(main, /this\.storageCommandService\.deposit\(payload,\s*\{ sender \}\)/u);
  assert.match(main, /async inspectStorageDepositSource\(/u);
  assert.match(main, /async depositStorageItem\(/u);
  assert.match(main, /isValidStorageDropItemPayload/u);
  assert.match(main, /STORAGE_DROP_ITEM_COMMAND\s*=\s*"storage\.drop-item-to-scene"/u);
  assert.match(main, /register\(STORAGE_DROP_ITEM_COMMAND,\s*\{/u);
  assert.match(main, /this\.storageCommandService\.dropItemToScene\(payload,\s*\{ sender \}\)/u);
  assert.match(main, /async dropStorageItemToScene\(/u);
  assert.doesNotMatch(main, /BuiltinCoinTemplateService|builtinCoinTemplateService|restoreBuiltinCoinTemplates/u);
  assert.match(main, /this\.storageJournalReader = new StorageJournalReader\(\{/u);
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
    "data/storage-service.js?v=1.4.152-dead-npc-looting",
    "data/storage-open-sound-service.js?v=1.4.145-coin-icons-storage-sound",
    "data/storage-access.js?v=1.4.133-ground-item-polish",
    "data/storage-ground-pile-service.js?v=1.4.155-journal-pile-presentation",
    "data/storage-container-item-service.js?v=1.4.130-storage-player-fixes",
    "data/storage-deposit-source.js?v=1.4.144-spreadsheet-coins-ground-repair",
    "data/storage-command-service.js?v=1.4.152-dead-npc-looting",
    "integrations/storage-token-hooks.js?v=1.4.154-corpse-storage-broken-name",
    "combat/hooks.js?v=1.4.147-race-damage",
    "integrations/storage-transfer-drop.js?v=1.4.144-spreadsheet-coins-ground-repair",
    "integrations/storage-token-drop.js?v=1.4.132-storage-owned-character-resolution",
    "integrations/storage-container-hierarchy.js?v=1.4.122-storage-container-cycle-repair"
  ]) {
    assert.equal(main.includes(importPath), true, importPath);
  }
  for (const importPath of [
    "storage-service.js?v=1.4.152-dead-npc-looting",
    "storage-deposit-source.js?v=1.4.144-spreadsheet-coins-ground-repair"
  ]) {
    assert.equal(storageCommand.includes(importPath), true, importPath);
  }
  assert.equal(manifest.version, "1.4.156");
  assert.match(main, /await registerStorageContainerHierarchyHooks\(\{ Hooks \}\)/u);
});

test("real storage command registrations validate envelopes and execute their composed handlers", async () => {
  const gm = { id: "gm", isGM: true, active: true };
  const runtime = createModuleRuntime({ user: gm, users: [gm] });
  try {
    const { RebreyaMainModule, STORAGE_COIN_DROP_COMMAND, STORAGE_JOURNAL_READ_COMMAND } = await import(
      `../scripts/main.js?storage-registration=${Date.now()}`
    );
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
    for (const [command, requestId, payload] of [
      [STORAGE_JOURNAL_READ_COMMAND, "journal-valid", journalPayload],
      [STORAGE_COIN_DROP_COMMAND, "coins-valid", coinPayload]
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
        data: command === STORAGE_JOURNAL_READ_COMMAND ? { name: "Journal", pages: [] } : { created: true }
      });
    }
    assert.deepEqual(calls.map(({ command, payload }) => ({ command, payload })), [
      { command: "journal", payload: journalPayload },
      { command: "coins", payload: coinPayload }
    ]);
    assert.equal(calls[0].context.sender, gm);
    assert.equal(calls[1].context.sender, gm);

    for (const [command, requestId, payload] of [
      [STORAGE_JOURNAL_READ_COMMAND, "journal-invalid", { ...journalPayload, rowId: "" }],
      [STORAGE_COIN_DROP_COMMAND, "coins-invalid", { ...coinPayload, denomination: "electrum" }]
    ]) {
      assert.equal(moduleApi.socketCommandBus.handleMessage({
        type: COMMAND_REQUEST_TYPE, command, requestId, senderId: gm.id, payload
      }, { transportSenderId: gm.id }), true);
      assert.equal((await waitForSocketResult(runtime.emitted, requestId))?.error?.code, "invalid-payload");
    }
    assert.equal(calls.length, 2);
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

test("composed storage command service receives the module durability service instance", async () => {
  const gm = { id: "gm", isGM: true, active: true };
  const runtime = createModuleRuntime({ user: gm, users: [gm] });
  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?storage-durability=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    assert.equal(moduleApi.storageCommandService.durabilityService, moduleApi.durabilityService);
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
