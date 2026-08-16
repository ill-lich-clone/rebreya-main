import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import { StorageCommandService } from "../scripts/data/storage-command-service.js";
import { StorageService, readStorageState } from "../scripts/data/storage-service.js";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function applyPatch(target, patch) {
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split(".");
    let cursor = target;
    for (const part of parts.slice(0, -1)) cursor = cursor[part] ??= {};
    cursor[parts.at(-1)] = clone(value);
  }
}

function itemRow({
  rowId = "row-sword",
  name = "Меч",
  quantity = 3,
  sourceId = "Compendium.world.gear.Item.sword"
} = {}) {
  return {
    rowId,
    rowKind: "item",
    sourceType: "gear",
    sourceId,
    name,
    quantity,
    itemData: { name, type: "weapon", system: { quantity } }
  };
}

async function createHarness({
  rows = [itemRow()],
  coins = {},
  playerName = "Игрок Алиса",
  heroName = "Герой Эйра",
  rejectGrant = false,
  rejectSourceWrite = false
} = {}) {
  const messages = [];
  const grants = [];
  const completed = new Set();
  const scene = { id: "scene" };
  const player = { id: "player", name: playerName, isGM: false };
  const hero = {
    id: "hero",
    name: heroName,
    type: "character",
    testUserPermission: (user, permission) => user?.id === player.id && permission === "OWNER"
  };
  const characterToken = {
    id: "hero-token",
    uuid: "Scene.scene.Token.hero",
    parent: scene,
    actor: hero
  };
  const storageActor = {
    id: "storage-actor",
    type: "npc",
    flags: { [MODULE_ID]: { storage: { enabled: true } } },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  };
  const storageToken = {
    id: "chest",
    uuid: "Scene.scene.Token.chest",
    parent: scene,
    actor: storageActor,
    flags: {},
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
    async update(patch) {
      applyPatch(this, patch);
      return this;
    }
  };
  const storageService = new StorageService();
  await storageService.configure(storageToken, {
    state: "opened",
    displayMode: "opened",
    manualRows: rows,
    generatedRows: [],
    manualCoins: coins,
    generatedCoins: {},
    claimedRowIds: [],
    coinsClaimed: false
  });
  if (rejectSourceWrite) {
    storageToken.update = async () => { throw new Error("source write failed"); };
  }

  async function recordGrant(kind, mutationId, details = {}) {
    if (rejectGrant) throw new Error("target grant failed");
    if (!completed.has(mutationId)) grants.push({ kind, mutationId, ...details });
    completed.add(mutationId);
  }

  const inventoryService = {
    async addLootgenRowToCharacterOnce(row, actor, mutationId) {
      await recordGrant("row-self", mutationId, { row: clone(row), actor });
    },
    async addLootgenRowToInventoryOnce(row, mutationId) {
      await recordGrant("row-party", mutationId, { row: clone(row) });
    },
    async addCurrencyToCharacterOnce(value, actor, mutationId) {
      await recordGrant("coins-self", mutationId, { coins: clone(value), actor });
    },
    async addCurrencyToInventoryOnce(value, mutationId) {
      await recordGrant("coins-party", mutationId, { coins: clone(value) });
    }
  };
  const documents = new Map([
    [storageToken.uuid, storageToken],
    [characterToken.uuid, characterToken]
  ]);
  const service = new StorageCommandService({
    storageService,
    inventoryService,
    resolveToken: async (uuid) => documents.get(uuid) ?? null,
    measureDistance: () => 5,
    isVisibleTo: () => true,
    journalReader: { async read() { throw new Error("Journal reader must not run during a claim"); } },
    createChatMessage: async (data) => {
      messages.push({
        ...clone(data),
        sourceStateAtCreate: clone(readStorageState(storageToken))
      });
      return data;
    }
  });
  return { service, player, hero, storageToken, characterToken, messages, grants };
}

function rowClaimPayload(harness, overrides = {}) {
  return {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    rowId: "row-sword",
    destination: "self",
    mutationId: "claim-row-1",
    quantity: 2,
    ...overrides
  };
}

function coinClaimPayload(harness, overrides = {}) {
  return {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    destination: "self",
    mutationId: "claim-coins-1",
    ...overrides
  };
}

test("a successful partial row claim to self publishes one public message after the source mutation", async () => {
  const harness = await createHarness();

  const result = await harness.service.claimRow(rowClaimPayload(harness), { sender: harness.player });

  assert.equal(result.changed, true);
  assert.equal(harness.messages.length, 1);
  assert.equal(harness.messages[0].whisper, undefined);
  assert.match(harness.messages[0].content, /Игрок Алиса/iu);
  assert.match(harness.messages[0].content, /2 × Меч/iu);
  assert.match(harness.messages[0].content, /инвентар[ья].*Герой Эйра/iu);
  assert.equal(harness.messages[0].sourceStateAtCreate.manualRows[0].quantity, 1);
});

test("a successful row claim to party names the group inventory destination", async () => {
  const harness = await createHarness();

  await harness.service.claimRow(rowClaimPayload(harness, {
    destination: "party",
    mutationId: "claim-row-party",
    quantity: 1
  }), { sender: harness.player });

  assert.equal(harness.messages.length, 1);
  assert.match(harness.messages[0].content, /1 × Меч/iu);
  assert.match(harness.messages[0].content, /группов.*инвентар/iu);
});

test("coin claims to self render every positive denomination correctly", async () => {
  const harness = await createHarness({ rows: [], coins: { pp: 2, gp: 3, sp: 4, cp: 5 } });

  await harness.service.claimCoins(coinClaimPayload(harness), { sender: harness.player });

  assert.equal(harness.messages.length, 1);
  assert.match(harness.messages[0].content, /2 пм/iu);
  assert.match(harness.messages[0].content, /3 зм/iu);
  assert.match(harness.messages[0].content, /4 см/iu);
  assert.match(harness.messages[0].content, /5 мм/iu);
  assert.match(harness.messages[0].content, /инвентар[ья].*Герой Эйра/iu);
});

test("coin claims to party publish the amount and group inventory destination", async () => {
  const harness = await createHarness({ rows: [], coins: { gp: 12 } });

  await harness.service.claimCoins(coinClaimPayload(harness, {
    destination: "party",
    mutationId: "claim-coins-party"
  }), { sender: harness.player });

  assert.equal(harness.messages.length, 1);
  assert.match(harness.messages[0].content, /12 зм/iu);
  assert.match(harness.messages[0].content, /группов.*инвентар/iu);
});

test("a repeated mutation ID returns the cached claim without publishing twice", async () => {
  const harness = await createHarness();
  const payload = rowClaimPayload(harness, { quantity: 1, mutationId: "same-mutation" });

  await harness.service.claimRow(payload, { sender: harness.player });
  await harness.service.claimRow(payload, { sender: harness.player });

  assert.equal(harness.grants.length, 1);
  assert.equal(harness.messages.length, 1);
});

test("target failure, source write failure, and validation failure publish no message", async () => {
  const targetFailure = await createHarness({ rejectGrant: true });
  await assert.rejects(
    targetFailure.service.claimRow(rowClaimPayload(targetFailure), { sender: targetFailure.player }),
    /target grant failed/u
  );
  assert.equal(targetFailure.messages.length, 0);

  const sourceFailure = await createHarness({ rejectSourceWrite: true });
  await assert.rejects(
    sourceFailure.service.claimRow(rowClaimPayload(sourceFailure), { sender: sourceFailure.player }),
    /source write failed/u
  );
  assert.equal(sourceFailure.messages.length, 0);

  const validationFailure = await createHarness();
  await assert.rejects(
    validationFailure.service.claimRow(rowClaimPayload(validationFailure, { quantity: 99 }), {
      sender: validationFailure.player
    }),
    /доступного остатка/u
  );
  assert.equal(validationFailure.messages.length, 0);
});

test("claim messages escape presentation names and never expose source identifiers or flags", async () => {
  const harness = await createHarness({
    rows: [itemRow({
      name: "<script>предмет</script>",
      quantity: 1,
      sourceId: "Compendium.secret.pack.Item.hidden-source"
    })],
    playerName: "<img src=x onerror=alert(1)>",
    heroName: "<b>Скрытый герой</b>"
  });

  await harness.service.claimRow(rowClaimPayload(harness, { quantity: 1 }), { sender: harness.player });

  const content = harness.messages[0].content;
  assert.match(content, /&lt;script&gt;предмет&lt;\/script&gt;/u);
  assert.match(content, /&lt;img src=x onerror=alert\(1\)&gt;/u);
  assert.match(content, /&lt;b&gt;Скрытый герой&lt;\/b&gt;/u);
  assert.doesNotMatch(content, /<script|<img|<b>/iu);
  assert.doesNotMatch(content, /Compendium\.secret|hidden-source|flags|sourceId/iu);
});

test("Journal rows remain unclaimable and never publish a receipt message", async () => {
  const harness = await createHarness({
    rows: [{
      rowId: "journal-row",
      rowKind: "journal",
      sourceType: "journal",
      sourceId: "JournalEntry.secret-source",
      name: "Секретный журнал",
      img: "icons/svg/book.svg",
      quantity: 1
    }]
  });

  await assert.rejects(
    harness.service.claimRow(rowClaimPayload(harness, {
      rowId: "journal-row",
      quantity: 1,
      mutationId: "journal-claim"
    }), { sender: harness.player }),
    /журнал нельзя забрать/iu
  );
  assert.equal(harness.messages.length, 0);
});
