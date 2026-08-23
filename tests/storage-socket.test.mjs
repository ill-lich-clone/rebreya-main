import test from "node:test";
import assert from "node:assert/strict";
import * as storageCommands from "../scripts/data/storage-command-service.js";

import { MODULE_ID } from "../scripts/constants.js";
import { StorageService, readStorageState, readStorageStateAtPath } from "../scripts/data/storage-service.js";
import { buildStorageContainerRow } from "../scripts/data/storage-container-snapshot.js";
import { resolveStorageDepositSource } from "../scripts/data/storage-deposit-source.js";
import {
  StorageCommandService,
  isValidStorageClaimCoinsPayload,
  isValidStorageClaimRowPayload,
  isValidStorageDepositPayload,
  isValidStorageDropItemPayload,
  isValidStorageJournalReadPayload,
  isValidStorageRestorePortablePayload,
  isValidStorageTokenCharacterPayload,
  storageCharacterTokenUuidForClaim
} from "../scripts/data/storage-command-service.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function applyPatch(target, patch) {
  for (const [path, value] of Object.entries(patch)) {
    const parts = path.split(".");
    let cursor = target;
    for (const part of parts.slice(0, -1)) {
      cursor[part] ??= {};
      cursor = cursor[part];
    }
    cursor[parts.at(-1)] = clone(value);
  }
}

function createHarness({
  distance = 5,
  pointDistance = 5,
  visible = true,
  rowQuantity = 1,
  rejectItemGrant = false,
  depositSource = null,
  journalReader = null,
  containerItemService = null,
  groundFailure = null,
  coinGroundFailure = null,
  processedCoinMutations = new Set(),
  executionOrder = [],
  durabilityService = null,
  logResolve = true
} = {}) {
  const player = { id: "player", isGM: false };
  const gm = { id: "gm", isGM: true, active: true };
  const hero = {
    id: "hero",
    type: "character",
    testUserPermission: (user, permission) => user?.id === player.id && permission === "OWNER"
  };
  const scene = { id: "scene" };
  const targetHero = {
    id: "target-hero",
    uuid: "Actor.target-hero",
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
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
  const storageToken = {
    id: "chest",
    uuid: "Scene.scene.Token.chest",
    name: "Сундук",
    parent: scene,
    actor: storageActor,
    flags: {},
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async update(patch) {
      applyPatch(this, patch);
      return this;
    }
  };
  const documents = new Map([
    [characterToken.uuid, characterToken],
    [storageToken.uuid, storageToken],
    [targetHero.uuid, targetHero]
  ]);
  const itemGrants = [];
  const coinGrants = [];
  const completed = new Set();
  const groundCalls = [];
  const groundCoinCalls = [];
  const groundFindCalls = [];
  const refreshCalls = [];
  const depositResolveCalls = [];
  const journalReadCalls = [];
  const inventoryService = {
    async addLootgenRowToCharacterOnce(row, actor, mutationId) {
      if (rejectItemGrant) throw new Error("grant failed");
      if (!completed.has(mutationId)) itemGrants.push({ row: clone(row), actor, mutationId, destination: "self" });
      completed.add(mutationId);
      return { actorId: actor.id, itemId: "granted-item", quantity: row.quantity };
    },
    async addLootgenRowToInventoryOnce(row, mutationId, options) {
      if (rejectItemGrant) throw new Error("grant failed");
      if (!completed.has(mutationId)) itemGrants.push({ row: clone(row), mutationId, options: clone(options), destination: "party" });
      completed.add(mutationId);
    },
    async addCurrencyToCharacterOnce(coins, actor, mutationId) {
      if (!completed.has(mutationId)) coinGrants.push({ coins: clone(coins), actor, mutationId, destination: "self" });
      completed.add(mutationId);
    },
    async addCurrencyToInventoryOnce(coins, mutationId) {
      if (!completed.has(mutationId)) coinGrants.push({ coins: clone(coins), mutationId, destination: "party" });
      completed.add(mutationId);
    }
  };
  const storageService = new StorageService({
    generate: async () => ({
      rows: [{
        rowId: "row-1",
        quantity: rowQuantity,
        itemData: { name: "Меч", type: "weapon", system: { quantity: rowQuantity } }
      }],
      coins: { gp: 2 }
    })
  });
  const groundPileService = {
    findProcessedMutationAtPoint(request) {
      executionOrder.push("find");
      groundFindCalls.push(clone(request));
      return processedCoinMutations.has(request.mutationId)
        ? { created: false, merged: false, duplicate: true, token: { uuid: "Scene.scene.Token.coin-pile" } }
        : null;
    },
    async transferCoinsToScene(request) {
      executionOrder.push("transfer-coins");
      if (coinGroundFailure) throw coinGroundFailure;
      groundCoinCalls.push(clone(request));
      processedCoinMutations.add(request.mutationId);
      return { created: true, duplicate: false };
    },
    async transferToScene(request) {
      executionOrder.push("transfer");
      if (groundFailure) throw groundFailure;
      groundCalls.push(clone(request));
      return { created: true };
    },
    async refreshAfterStorageMutation(token, state) {
      refreshCalls.push({ token, state: clone(state) });
    }
  };
  const service = new StorageCommandService({
    storageService,
    inventoryService,
    resolveToken: async (uuid) => documents.get(uuid) ?? null,
    measureDistance: () => distance,
    measurePointDistance: () => pointDistance,
    groundPileService,
    containerItemService,
    durabilityService,
    isVisibleTo: () => visible,
    journalReader: journalReader ?? {
      async read(journalUuid) {
        journalReadCalls.push(journalUuid);
        return { name: "Полевые заметки", pages: [] };
      }
    },
    resolveDepositSource: async (...args) => {
      if (logResolve) executionOrder.push("resolve");
      depositResolveCalls.push(clone(args[0]));
      return typeof depositSource === "function" ? depositSource(...args) : depositSource;
    }
  });

  return {
    player,
    gm,
    hero,
    targetHero,
    characterToken,
    storageToken,
    storageService,
    service,
    itemGrants,
    coinGrants,
    groundCalls,
    groundCoinCalls,
    groundFindCalls,
    refreshCalls,
    depositResolveCalls,
    journalReadCalls
  };
}

test("storage command service validates a supplied durability derivation dependency", () => {
  assert.throws(
    () => createHarness({ durabilityService: {} }),
    /getOrBuildDurability/u
  );
});

test("storage claim rejects a player outside five feet before granting an item", async () => {
  const harness = createHarness({ distance: 10, visible: true });
  await harness.storageService.open(harness.storageToken);

  await assert.rejects(
    harness.service.claimRow({
      tokenUuid: harness.storageToken.uuid,
      characterTokenUuid: harness.characterToken.uuid,
      rowId: "row-1",
      destination: "self",
      quantity: null,
      target: null,
      mutationId: "claim-1"
    }, { sender: harness.player }),
    /5 фут/iu
  );
  assert.equal(harness.itemGrants.length, 0);
});

function depositPayload(harness, overrides = {}) {
  return {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    source: { kind: "item", itemUuid: "Actor.hero.Item.arrow" },
    quantity: 2,
    mutationId: "deposit-1",
    ...overrides
  };
}

test("storage deposit payload validation accepts only exact item, Journal, and storage-row sources", () => {
  const base = {
    tokenUuid: "Scene.scene.Token.chest",
    characterTokenUuid: "Scene.scene.Token.hero",
    quantity: 2,
    mutationId: "deposit-1"
  };
  assert.equal(isValidStorageDepositPayload({
    ...base,
    source: { kind: "item", itemUuid: "Actor.hero.Item.arrow" }
  }), true);
  assert.equal(isValidStorageDepositPayload({
    ...base,
    source: {
      kind: "storage-row",
      tokenUuid: "Scene.scene.Token.pile",
      rowId: "row-1",
      quantity: 4
    }
  }), true);
  assert.equal(isValidStorageDepositPayload({
    ...base,
    path: ["bag-row"],
    source: { kind: "item", itemUuid: "Actor.hero.Item.arrow" }
  }), true);
  assert.equal(isValidStorageDepositPayload({
    ...base,
    path: Array.from({ length: 9 }, (_, index) => `row-${index}`),
    source: { kind: "item", itemUuid: "Actor.hero.Item.arrow" }
  }), false);
  assert.equal(isValidStorageDepositPayload({
    ...base,
    source: { kind: "item", itemUuid: "Actor.hero.Item.arrow", extra: true }
  }), false);
  assert.equal(isValidStorageDepositPayload({
    tokenUuid: base.tokenUuid,
    characterTokenUuid: "",
    source: { kind: "journal", journalUuid: "JournalEntry.notes" },
    quantity: 1,
    mutationId: "journal-deposit"
  }), true);
  assert.equal(isValidStorageDepositPayload({
    tokenUuid: base.tokenUuid,
    characterTokenUuid: "",
    source: { kind: "journal", journalUuid: "JournalEntry.notes", extra: true },
    quantity: 1,
    mutationId: "journal-deposit"
  }), false);
  assert.equal(isValidStorageDepositPayload({
    tokenUuid: base.tokenUuid,
    characterTokenUuid: "",
    source: { kind: "journal", journalUuid: "JournalEntry.notes" },
    quantity: 1,
    mutationId: "journal-deposit",
    extra: true
  }), false);
  assert.equal(isValidStorageDepositPayload({
    ...base,
    quantity: 1,
    source: { kind: "storage-token", tokenUuid: "Scene.scene.Token.other-chest" }
  }), true);
  assert.equal(isValidStorageDepositPayload({
    ...base,
    source: { kind: "Actor", itemUuid: "Actor.hero" }
  }), false);
});

test("storage Journal read payload accepts only exact root and path identities without a Journal UUID", () => {
  const root = {
    tokenUuid: "Scene.scene.Token.chest",
    characterTokenUuid: "Scene.scene.Token.hero",
    rowId: "journal-row"
  };
  assert.equal(isValidStorageJournalReadPayload(root), true);
  assert.equal(isValidStorageJournalReadPayload({ ...root, path: ["bag-row"] }), true);
  assert.equal(isValidStorageJournalReadPayload({ ...root, journalUuid: "JournalEntry.evil" }), false);
  assert.equal(isValidStorageJournalReadPayload({ ...root, extra: true }), false);
  assert.equal(isValidStorageJournalReadPayload({ ...root, tokenUuid: "" }), false);
  assert.equal(isValidStorageJournalReadPayload({ ...root, rowId: "" }), false);
  assert.equal(isValidStorageJournalReadPayload({ ...root, characterTokenUuid: " hero " }), false);
  assert.equal(isValidStorageJournalReadPayload({ ...root, path: [""] }), false);
  assert.equal(isValidStorageJournalReadPayload({ ...root, path: Array(9).fill("row") }), false);
});

test("storage Journal reads re-run access checks and use only an authoritative unclaimed row source", async () => {
  const journalOwnership = { default: 0, gm: 3 };
  const beforeOwnership = structuredClone(journalOwnership);
  const readCalls = [];
  const harness = createHarness({
    journalReader: {
      async read(journalUuid) {
        readCalls.push(journalUuid);
        return { name: "Полевые заметки", pages: [] };
      }
    }
  });
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [{
      rowKind: "journal",
      rowId: "journal-row",
      stackKey: "",
      sourceId: "JournalEntry.authoritative",
      sourceType: "journal",
      name: "Полевые заметки",
      img: "icons/book.webp",
      quantity: 1
    }]
  });
  const payload = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    rowId: "journal-row",
    journalUuid: "JournalEntry.polluted"
  };

  const snapshot = await harness.service.readJournal(payload, { sender: harness.player });

  assert.deepEqual(snapshot, { name: "Полевые заметки", pages: [] });
  assert.deepEqual(readCalls, ["JournalEntry.authoritative"]);
  assert.deepEqual(journalOwnership, beforeOwnership);

  const farHarness = createHarness({ distance: 6 });
  await farHarness.storageService.configure(farHarness.storageToken, {
    state: "opened",
    manualRows: [readStorageState(harness.storageToken).manualRows[0]]
  });
  await assert.rejects(farHarness.service.readJournal({
    tokenUuid: farHarness.storageToken.uuid,
    characterTokenUuid: farHarness.characterToken.uuid,
    rowId: "journal-row"
  }, { sender: farHarness.player }), /5 футов/iu);

  const hiddenHarness = createHarness({ visible: false });
  await assert.rejects(hiddenHarness.service.readJournal({
    tokenUuid: hiddenHarness.storageToken.uuid,
    characterTokenUuid: hiddenHarness.characterToken.uuid,
    rowId: "journal-row"
  }, { sender: hiddenHarness.player }), /не видит/iu);

  const otherSceneHarness = createHarness();
  otherSceneHarness.characterToken.parent = { id: "other-scene" };
  await assert.rejects(otherSceneHarness.service.readJournal({
    tokenUuid: otherSceneHarness.storageToken.uuid,
    characterTokenUuid: otherSceneHarness.characterToken.uuid,
    rowId: "journal-row"
  }, { sender: otherSceneHarness.player }), /одной сцене/iu);

  await assert.rejects(harness.service.readJournal({
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    rowId: "journal-row"
  }, { sender: { id: "stranger", isGM: false } }), /принадлежащего вам персонажа/iu);
});

test("storage Journal reads resolve nested state live and fail closed for unavailable rows", async () => {
  const harness = createHarness();
  const nestedJournal = {
    rowKind: "journal",
    rowId: "nested-journal",
    stackKey: "",
    sourceId: "JournalEntry.nested",
    sourceType: "journal",
    name: "Вложенная запись",
    img: "icons/book.webp",
    quantity: 1
  };
  const bagRow = buildStorageContainerRow({
    containerId: "bag-journal",
    storageKind: "bag",
    name: "Сумка",
    state: {
      baseName: "Сумка",
      state: "opened",
      manualRows: [nestedJournal],
      generatedRows: [],
      claimedRowIds: [],
      manualCoins: {},
      generatedCoins: {},
      coinsClaimed: false
    }
  }, { rowId: "bag-row" });
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [bagRow]
  });
  const request = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    path: ["bag-row"],
    rowId: "nested-journal"
  };

  await harness.service.readJournal(request, { sender: harness.player });
  assert.deepEqual(harness.journalReadCalls, ["JournalEntry.nested"]);

  const nestedState = readStorageStateAtPath(harness.storageToken, ["bag-row"]);
  nestedState.claimedRowIds = ["nested-journal"];
  bagRow.container.state = nestedState;
  await harness.storageService.configure(harness.storageToken, { state: "opened", manualRows: [bagRow] });
  await assert.rejects(harness.service.readJournal(request, { sender: harness.player }), /недоступна/iu);

  await harness.storageService.configure(harness.storageToken, { state: "opened", manualRows: [] });
  await assert.rejects(harness.service.readJournal({ ...request, path: [] }, { sender: harness.player }), /недоступна/iu);

  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [{
      rowId: "ordinary",
      name: "Ключ",
      quantity: 1,
      itemData: { name: "Ключ", type: "loot", system: { quantity: 1 } }
    }]
  });
  await assert.rejects(harness.service.readJournal({
    ...request,
    path: [],
    rowId: "ordinary"
  }, { sender: harness.player }), /недоступна/iu);

  await harness.storageService.configure(harness.storageToken, {
    state: "unopened",
    manualRows: [nestedJournal]
  });
  await assert.rejects(harness.service.readJournal({
    ...request,
    path: [],
    rowId: "nested-journal"
  }, { sender: harness.player }), /Сначала откройте/iu);
});

test("storage Journal reads require exact opened state instead of accepting empty storage", async () => {
  const harness = createHarness();
  await harness.storageService.configure(harness.storageToken, {
    state: "empty",
    manualRows: [{
      rowKind: "journal",
      rowId: "journal-row",
      sourceId: "JournalEntry.empty",
      sourceType: "journal",
      name: "Недоступная запись",
      quantity: 1
    }]
  });

  await assert.rejects(harness.service.readJournal({
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    rowId: "journal-row"
  }, { sender: harness.player }), /Сначала откройте/iu);
  assert.deepEqual(harness.journalReadCalls, []);
});

test("storage Journal reads reject sourceType-only rows without authoritative Journal rowKind", async () => {
  const harness = createHarness();
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [{
      rowKind: "item",
      rowId: "forged-journal",
      sourceId: "JournalEntry.forged",
      sourceType: "journal",
      name: "Поддельная запись",
      quantity: 1
    }]
  });

  await assert.rejects(harness.service.readJournal({
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    rowId: "forged-journal"
  }, { sender: harness.player }), /недоступна/iu);
  assert.deepEqual(harness.journalReadCalls, []);
});

test("portable scene restore payload accepts one exact item and finite scene point", () => {
  const payload = {
    itemUuid: "Actor.hero.Item.bag",
    characterTokenUuid: "Scene.scene.Token.hero",
    sceneId: "scene",
    x: 120,
    y: 180,
    mutationId: "portable-scene"
  };
  assert.equal(isValidStorageRestorePortablePayload(payload), true);
  assert.equal(isValidStorageRestorePortablePayload({ ...payload, x: Number.NaN }), false);
  assert.equal(isValidStorageRestorePortablePayload({ ...payload, extra: true }), false);
});

test("storage token character transfer payload accepts only exact document identities", () => {
  const payload = {
    tokenUuid: "Scene.scene.Token.chest",
    characterTokenUuid: "Scene.scene.Token.hero",
    actorUuid: "Actor.hero",
    mutationId: "token-to-character"
  };
  assert.equal(isValidStorageTokenCharacterPayload(payload), true);
  assert.equal(isValidStorageTokenCharacterPayload({ ...payload, actorUuid: "" }), false);
  assert.equal(isValidStorageTokenCharacterPayload({ ...payload, extra: true }), false);
});

test("whole storage token transfer materializes its container tree in an owned character and removes the scene token", async () => {
  const consumed = [];
  const materialized = [];
  const source = {
    kind: "storage-token",
    mode: "move",
    available: 1,
    row: { container: { containerId: "portable-chest", name: "Сундук", state: {} } },
    canUserMove: () => true,
    async consume(quantity) { consumed.push(quantity); return { kind: "storage-token" }; },
    async restore() {}
  };
  const containerItemService = {
    async materializeToActorOnce(actor, snapshot, mutationId) {
      materialized.push({ actor, snapshot: clone(snapshot), mutationId });
      return { id: "portable-item" };
    }
  };
  const harness = createHarness({ depositSource: source, containerItemService });

  const result = await harness.service.moveStorageTokenToCharacter({
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    actorUuid: harness.targetHero.uuid,
    mutationId: "token-to-character"
  }, { sender: harness.player });

  assert.deepEqual(consumed, [1]);
  assert.equal(materialized.length, 1);
  assert.equal(materialized[0].actor, harness.targetHero);
  assert.equal(materialized[0].snapshot.containerId, "portable-chest");
  assert.match(materialized[0].mutationId, /token-to-character/u);
  assert.equal(result.changed, true);
});

test("a scene pile with one ordinary item grants that item without creating a container", async () => {
  const consumed = [];
  const materialized = [];
  const source = {
    kind: "storage-token",
    mode: "move",
    available: 3,
    row: {
      rowKind: "item",
      rowId: "gold-row",
      name: "Золото",
      quantity: 3,
      itemData: { name: "Золото", type: "loot", system: { quantity: 3 } }
    },
    canUserMove: () => true,
    async consume(quantity) { consumed.push(quantity); return { kind: "storage-token" }; },
    async restore() {}
  };
  const containerItemService = {
    async materializeToActorOnce(...args) {
      materialized.push(args);
      return { id: "unexpected-container" };
    }
  };
  const harness = createHarness({ depositSource: source, containerItemService });

  const result = await harness.service.moveStorageTokenToCharacter({
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    actorUuid: harness.targetHero.uuid,
    mutationId: "single-item-to-character"
  }, { sender: harness.player });

  assert.deepEqual(consumed, [3]);
  assert.equal(materialized.length, 0);
  assert.equal(harness.itemGrants.length, 1);
  assert.equal(harness.itemGrants[0].row.name, "Золото");
  assert.equal(harness.itemGrants[0].actor, harness.targetHero);
  assert.equal(result.itemUuid, "granted-item");
  assert.equal(result.containerId, "");
});

test("generic Item scene drop payload accepts an exact quantity and finite scene point", () => {
  const payload = {
    itemUuid: "Actor.hero.Item.arrows",
    characterTokenUuid: "Scene.scene.Token.hero",
    sceneId: "scene",
    x: 120,
    y: 180,
    quantity: 2,
    mutationId: "item-scene"
  };
  assert.equal(isValidStorageDropItemPayload(payload), true);
  assert.equal(isValidStorageDropItemPayload({ ...payload, quantity: 0 }), false);
  assert.equal(isValidStorageDropItemPayload({ ...payload, extra: true }), false);
});

test("managed coin scene payload validator accepts only the exact typed command", () => {
  assert.equal(typeof storageCommands.isValidStorageCoinDropPayload, "function");
  const { isValidStorageCoinDropPayload } = storageCommands;
  const payload = {
    itemUuid: "Item.gold-template",
    denomination: "gp",
    characterTokenUuid: "Scene.scene.Token.hero",
    sceneId: "scene",
    x: 120,
    y: 180,
    quantity: 25,
    mutationId: "coin-scene"
  };
  assert.equal(isValidStorageCoinDropPayload(payload), true);
  for (const invalid of [
    { ...payload, extra: true },
    { ...payload, denomination: "gold" },
    { ...payload, quantity: 0 },
    { ...payload, quantity: 1.5 },
    { ...payload, quantity: Number.MAX_SAFE_INTEGER + 1 },
    { ...payload, itemUuid: "" },
    { ...payload, sceneId: "" },
    { ...payload, mutationId: "" },
    { ...payload, x: Number.POSITIVE_INFINITY },
    { ...payload, y: Number.NaN }
  ]) {
    assert.equal(isValidStorageCoinDropPayload(invalid), false);
  }
});

test("managed coin drop re-resolves authority, consumes an owned stack, and transfers only manual coins", async () => {
  const order = [];
  const consumed = [];
  const source = {
    kind: "coin-template",
    denomination: "gp",
    mode: "move",
    available: 4,
    canUserMove: () => true,
    async consume(quantity) { order.push("consume"); consumed.push(quantity); return { kind: "item-update" }; },
    async restore() { order.push("restore"); }
  };
  const harness = createHarness({ depositSource: source, executionOrder: order, pointDistance: 5 });
  const result = await harness.service.dropCoinsToScene({
    itemUuid: "Actor.hero.Item.gold",
    denomination: "gp",
    characterTokenUuid: harness.characterToken.uuid,
    sceneId: "scene",
    x: 400,
    y: 500,
    quantity: 2,
    mutationId: "drop-gold"
  }, { sender: harness.player });

  assert.equal(result.changed, true);
  assert.deepEqual(order, ["find", "find", "resolve", "consume", "transfer-coins"]);
  assert.deepEqual(consumed, [2]);
  assert.equal(harness.groundCalls.length, 0);
  assert.equal(harness.groundCoinCalls.length, 1);
  assert.deepEqual(harness.groundCoinCalls[0].coins, { gp: 2 });
  assert.equal("row" in harness.groundCoinCalls[0], false);
  assert.equal(harness.groundCoinCalls[0].ownerUserId, harness.player.id);
});

test("managed coin retries find the processed pile before resolving a consumed source", async () => {
  const processed = new Set();
  let sourceAvailable = true;
  const harness = createHarness({
    processedCoinMutations: processed,
    depositSource: async () => {
      if (!sourceAvailable) throw new Error("source was consumed");
      return {
        kind: "coin-template",
        denomination: "sp",
        mode: "move",
        available: 1,
        canUserMove: () => true,
        async consume() { sourceAvailable = false; return { kind: "item-delete" }; },
        async restore() {}
      };
    }
  });
  const payload = {
    itemUuid: "Actor.hero.Item.silver",
    denomination: "sp",
    characterTokenUuid: harness.characterToken.uuid,
    sceneId: "scene",
    x: 100,
    y: 100,
    quantity: 1,
    mutationId: "drop-silver-once"
  };

  await harness.service.dropCoinsToScene(payload, { sender: harness.player });
  const duplicate = await harness.service.dropCoinsToScene(payload, { sender: harness.player });

  assert.equal(duplicate.duplicate, true);
  assert.equal(harness.depositResolveCalls.length, 1);
  assert.equal(harness.groundCoinCalls.length, 1);
});

test("managed coin drop rejects stale denomination, excess quantity, ownership, and character context", async () => {
  const payload = {
    itemUuid: "Actor.hero.Item.coin",
    denomination: "gp",
    characterTokenUuid: "Scene.scene.Token.hero",
    sceneId: "scene",
    x: 100,
    y: 100,
    quantity: 3,
    mutationId: "coin-guards"
  };
  const source = (overrides = {}) => ({
    kind: "coin-template",
    denomination: "gp",
    mode: "move",
    available: 2,
    canUserMove: () => true,
    async consume() { return { kind: "item-update" }; },
    async restore() {},
    ...overrides
  });
  await assert.rejects(
    createHarness({ depositSource: source({ denomination: "sp" }) }).service.dropCoinsToScene(payload, { sender: { id: "gm", isGM: true } }),
    /номинал/iu
  );
  await assert.rejects(
    createHarness({ depositSource: source() }).service.dropCoinsToScene(payload, { sender: { id: "gm", isGM: true } }),
    /Количество/u
  );
  await assert.rejects(
    createHarness({ depositSource: source({ available: 3, canUserMove: () => false }) }).service.dropCoinsToScene(payload, { sender: { id: "player", isGM: false } }),
    /прав/iu
  );
  await assert.rejects(
    createHarness({ depositSource: source({ available: 3 }), pointDistance: 6 }).service.dropCoinsToScene(payload, { sender: { id: "player", isGM: false } }),
    /5 фут/iu
  );
  await assert.rejects(
    createHarness({ depositSource: source({ available: 3 }) }).service.dropCoinsToScene({ ...payload, characterTokenUuid: "" }, { sender: { id: "player", isGM: false } }),
    /персонаж/iu
  );
});

test("failed managed coin transfer restores an embedded source", async () => {
  const calls = [];
  const harness = createHarness({
    coinGroundFailure: new Error("coin transfer failed"),
    depositSource: {
      kind: "coin-template",
      denomination: "cp",
      mode: "move",
      available: 2,
      canUserMove: () => true,
      async consume() { calls.push("consume"); return { kind: "item-delete" }; },
      async restore() { calls.push("restore"); }
    }
  });
  await assert.rejects(harness.service.dropCoinsToScene({
    itemUuid: "Actor.hero.Item.copper",
    denomination: "cp",
    characterTokenUuid: harness.characterToken.uuid,
    sceneId: "scene",
    x: 100,
    y: 100,
    quantity: 2,
    mutationId: "drop-copper"
  }, { sender: harness.player }), /coin transfer failed/u);
  assert.deepEqual(calls, ["consume", "restore"]);
});

test("unsafe cumulative coin transfer restores the deleted embedded managed Coin source", async () => {
  const restored = [];
  const actor = {
    uuid: "Actor.hero",
    documentName: "Actor",
    testUserPermission: (user, permission) => user?.id === "player" && permission === "OWNER",
    async createEmbeddedDocuments(type, rows, options) {
      restored.push({ type, rows: clone(rows), options: clone(options) });
      return rows;
    }
  };
  const item = {
    id: "copper-stack",
    uuid: "Actor.hero.Item.copper-stack",
    documentName: "Item",
    parent: actor,
    name: "Медные монеты",
    type: "loot",
    img: "icons/coins-copper.webp",
    flags: { [MODULE_ID]: { storageCoinTemplate: { version: 1, denomination: "cp" } } },
    system: { quantity: 2 },
    deleted: false,
    toObject() {
      return {
        _id: this.id,
        name: this.name,
        type: this.type,
        img: this.img,
        flags: clone(this.flags),
        system: clone(this.system)
      };
    },
    async delete() {
      this.deleted = true;
      return this;
    }
  };
  const harness = createHarness({
    coinGroundFailure: new Error("Сумма монет cp должна оставаться неотрицательным безопасным целым числом."),
    depositSource: (sourceRef) => resolveStorageDepositSource(sourceRef, {
      fromUuid: async (uuid) => uuid === item.uuid ? item : null
    })
  });

  await assert.rejects(harness.service.dropCoinsToScene({
    itemUuid: item.uuid,
    denomination: "cp",
    characterTokenUuid: harness.characterToken.uuid,
    sceneId: "scene",
    x: 100,
    y: 100,
    quantity: 2,
    mutationId: "drop-copper-overflow"
  }, { sender: harness.player }), /безопасным целым/u);

  assert.equal(item.deleted, true);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].type, "Item");
  assert.equal(restored[0].rows[0].system.quantity, 2);
  assert.deepEqual(restored[0].options, { keepId: true });
});

test("managed Coin Items cannot enter ordinary storage rows", async () => {
  const harness = createHarness({
    depositSource: {
      kind: "coin-template",
      denomination: "gp",
      mode: "copy",
      available: null,
      canUserMove: () => true,
      async consume() { return { kind: "copy" }; },
      async restore() {}
    }
  });
  await harness.storageService.open(harness.storageToken);
  let depositRows = 0;
  harness.storageService.depositRow = async () => { depositRows += 1; };
  await assert.rejects(harness.service.deposit(depositPayload(harness, { quantity: 1 }), {
    sender: harness.player
  }), /монет/iu);
  assert.equal(depositRows, 0);
});

test("managed Coin Items cannot enter the ordinary ground Item row command", async () => {
  let consumed = 0;
  let derived = 0;
  const harness = createHarness({
    durabilityService: {
      async getOrBuildDurability() { derived += 1; return { eligible: true }; }
    },
    depositSource: {
      kind: "coin-template",
      denomination: "gp",
      mode: "copy",
      available: null,
      canUserMove: () => true,
      async consume() { consumed += 1; return { kind: "copy" }; },
      async restore() {}
    }
  });
  await assert.rejects(harness.service.dropItemToScene({
    itemUuid: "Item.gold-template",
    characterTokenUuid: harness.characterToken.uuid,
    sceneId: "scene",
    x: 100,
    y: 100,
    quantity: 1,
    mutationId: "wrong-ground-route"
  }, { sender: harness.player }), /монет/iu);
  assert.equal(consumed, 0);
  assert.equal(derived, 0);
  assert.equal(harness.groundCalls.length, 0);
});

test("world, compendium, and embedded Items derive durability before ground source consumption", async (t) => {
  const derivedFlag = {
    eligible: true,
    hp: { value: 12, max: 12 },
    ac: 16,
    damageThreshold: 3,
    state: "intact",
    updatedAt: 111
  };
  for (const scenario of [
    { name: "world", itemUuid: "Item.cuirass", mode: "copy" },
    { name: "compendium", itemUuid: "Compendium.rebreya.items.Item.cuirass", mode: "copy" },
    { name: "embedded", itemUuid: "Actor.hero.Item.cuirass", mode: "move" }
  ]) {
    await t.test(scenario.name, async () => {
      const events = [];
      const sourceItem = { uuid: scenario.itemUuid, updates: [] };
      const source = {
        kind: "item",
        mode: scenario.mode,
        available: 4,
        sourceKey: scenario.itemUuid,
        item: sourceItem,
        row: {
          rowId: "cuirass",
          name: "Кираса",
          quantity: 4,
          itemData: { name: "Кираса", type: "equipment", system: { quantity: 4 } }
        },
        canUserMove: () => true,
        async consume() { events.push("consume"); return { kind: scenario.mode === "copy" ? "copy" : "item-update" }; },
        async restore() {}
      };
      const originalRow = clone(source.row);
      const harness = createHarness({
        depositSource: source,
        pointDistance: 5,
        executionOrder: events,
        logResolve: false,
        durabilityService: {
          async getOrBuildDurability(item) {
            events.push("derive");
            assert.equal(item, sourceItem);
            return derivedFlag;
          }
        }
      });

      const result = await harness.service.dropItemToScene({
        itemUuid: scenario.itemUuid,
        characterTokenUuid: harness.characterToken.uuid,
        sceneId: "scene",
        x: 400,
        y: 500,
        quantity: 2,
        mutationId: `drop-cuirass-${scenario.name}`
      }, { sender: harness.player });

      assert.equal(result.changed, true);
      assert.deepEqual(events, ["derive", "consume", "transfer"]);
      assert.deepEqual(harness.groundCalls[0].row.itemData.flags[MODULE_ID].durability, derivedFlag);
      assert.notEqual(harness.groundCalls[0].row.itemData.flags[MODULE_ID].durability, derivedFlag);
      assert.equal(harness.groundCalls[0].row.itemData.system.quantity, 2);
      assert.equal(harness.groundCalls[0].ownerUserId, harness.player.id);
      assert.deepEqual(source.row, originalRow);
      assert.equal(sourceItem.updates.length, 0);
      assert.equal(sourceItem.flags, undefined);
    });
  }
});

test("ground preparation preserves an existing damaged durability flag exactly", async () => {
  const damagedFlag = {
    eligible: true,
    hp: { value: 3, max: 11 },
    ac: 15,
    damageThreshold: 2,
    state: "damaged",
    updatedAt: 987654321
  };
  const sourceItem = { flags: { [MODULE_ID]: { durability: clone(damagedFlag) } } };
  const source = {
    kind: "item",
    mode: "copy",
    available: 1,
    item: sourceItem,
    row: { rowId: "damaged-cuirass", quantity: 1, itemData: { name: "Кираса", type: "equipment", system: { quantity: 1 } } },
    canUserMove: () => true,
    async consume() { return { kind: "copy" }; },
    async restore() {}
  };
  const harness = createHarness({
    depositSource: source,
    durabilityService: {
      async getOrBuildDurability(item) {
        assert.equal(item, sourceItem);
        return clone(item.flags[MODULE_ID].durability);
      }
    }
  });

  await harness.service.dropItemToScene({
    itemUuid: "Item.damaged-cuirass",
    sceneId: "scene",
    x: 10,
    y: 20,
    quantity: 1,
    mutationId: "drop-damaged-cuirass"
  }, { sender: harness.gm });

  assert.deepEqual(harness.groundCalls[0].row.itemData.flags[MODULE_ID].durability, damagedFlag);
  assert.deepEqual(sourceItem.flags[MODULE_ID].durability, damagedFlag);
});

test("ineligible ground Items shed stale durability only from the cloned pile row", async () => {
  let derives = 0;
  const staleDurability = {
    eligible: true,
    hp: { value: 2, max: 8 },
    ac: 13,
    damageThreshold: 1,
    state: "damaged",
    updatedAt: 123456
  };
  const sourceItem = {
    name: "Рацион",
    type: "consumable",
    flags: { [MODULE_ID]: { durability: clone(staleDurability) } }
  };
  const source = {
    kind: "item",
    mode: "copy",
    available: 1,
    item: sourceItem,
    row: {
      rowId: "ration",
      quantity: 1,
      itemData: {
        name: "Рацион",
        type: "consumable",
        system: { quantity: 1 },
        flags: {
          [MODULE_ID]: { durability: clone(staleDurability), presentation: { label: "Сухпаёк" } },
          "other-module": { retained: true }
        }
      }
    },
    canUserMove: () => true,
    async consume() { return { kind: "copy" }; },
    async restore() {}
  };
  const originalRow = clone(source.row);
  const originalSourceItem = clone(sourceItem);
  const harness = createHarness({
    depositSource: source,
    durabilityService: { async getOrBuildDurability() { derives += 1; return null; } }
  });

  await harness.service.dropItemToScene({
    itemUuid: "Item.ration",
    sceneId: "scene",
    x: 10,
    y: 20,
    quantity: 1,
    mutationId: "drop-ration"
  }, { sender: harness.gm });

  assert.equal(derives, 1);
  assert.equal(harness.groundCalls[0].row.itemData.flags?.[MODULE_ID]?.durability, undefined);
  assert.deepEqual(harness.groundCalls[0].row.itemData.flags[MODULE_ID].presentation, { label: "Сухпаёк" });
  assert.deepEqual(harness.groundCalls[0].row.itemData.flags["other-module"], { retained: true });
  assert.deepEqual(source.row, originalRow);
  assert.deepEqual(sourceItem, originalSourceItem);
});

test("durability derivation failure leaves the ground source untouched", async () => {
  const events = [];
  const sourceItem = { system: { quantity: 1 }, deleted: false, updates: [] };
  const source = {
    kind: "item",
    mode: "move",
    available: 1,
    item: sourceItem,
    row: { rowId: "cuirass", quantity: 1, itemData: { name: "Кираса", type: "equipment", system: { quantity: 1 } } },
    canUserMove: () => true,
    async consume() { events.push("consume"); sourceItem.deleted = true; return { kind: "item-delete" }; },
    async restore() { events.push("restore"); }
  };
  const harness = createHarness({
    depositSource: source,
    executionOrder: events,
    logResolve: false,
    durabilityService: {
      async getOrBuildDurability() { events.push("derive"); throw new Error("derive failed"); }
    }
  });

  await assert.rejects(harness.service.dropItemToScene({
    itemUuid: "Actor.hero.Item.cuirass",
    sceneId: "scene",
    x: 10,
    y: 20,
    quantity: 1,
    mutationId: "drop-derive-failure"
  }, { sender: harness.gm }), /derive failed/u);

  assert.deepEqual(events, ["derive"]);
  assert.equal(sourceItem.system.quantity, 1);
  assert.equal(sourceItem.deleted, false);
  assert.deepEqual(sourceItem.updates, []);
  assert.equal(harness.groundCalls.length, 0);
});

test("ground durability derivation waits for quantity, ownership, and point validation", async () => {
  const basePayload = {
    itemUuid: "Actor.hero.Item.cuirass",
    characterTokenUuid: "Scene.scene.Token.hero",
    sceneId: "scene",
    x: 10,
    y: 20,
    quantity: 1,
    mutationId: "drop-validation"
  };
  for (const scenario of [
    { name: "quantity", sender: { id: "gm", isGM: true }, available: 0, canUserMove: true, pointDistance: 5 },
    { name: "ownership", sender: { id: "player", isGM: false }, available: 1, canUserMove: false, pointDistance: 5 },
    { name: "point", sender: { id: "player", isGM: false }, available: 1, canUserMove: true, pointDistance: 6 }
  ]) {
    let derives = 0;
    let consumes = 0;
    const harness = createHarness({
      pointDistance: scenario.pointDistance,
      depositSource: {
        kind: "item",
        mode: "move",
        available: scenario.available,
        row: { rowId: "cuirass", quantity: 1, itemData: { name: "Кираса", type: "equipment", system: { quantity: 1 } } },
        canUserMove: () => scenario.canUserMove,
        async consume() { consumes += 1; return { kind: "item-update" }; },
        async restore() {}
      },
      durabilityService: {
        async getOrBuildDurability() { derives += 1; return { eligible: true }; }
      }
    });

    await assert.rejects(
      harness.service.dropItemToScene({ ...basePayload, mutationId: `drop-validation-${scenario.name}` }, { sender: scenario.sender })
    );
    assert.equal(derives, 0, scenario.name);
    assert.equal(consumes, 0, scenario.name);
    assert.equal(harness.groundCalls.length, 0, scenario.name);
  }
});

test("native container Items restore as storage tokens with their full recursive contents", async () => {
  const consumed = [];
  const restored = [];
  const snapshot = {
    containerId: "native-bag",
    storageKind: "bag",
    name: "Рюкзак",
    img: "bag.webp",
    state: { baseName: "Рюкзак", state: "opened", manualRows: [], generatedRows: [] }
  };
  const source = {
    kind: "storage-item",
    mode: "move",
    available: 1,
    sourceKey: "Actor.hero.Item.backpack",
    row: buildStorageContainerRow(snapshot),
    canUserMove: () => true,
    async consume(quantity) { consumed.push(quantity); return { kind: "storage-item" }; },
    async restore() {}
  };
  const containerItemService = {
    async restoreSnapshotToScene(actualSnapshot, target) {
      restored.push({ snapshot: clone(actualSnapshot), target: clone(target) });
      return { uuid: "Scene.scene.Token.backpack" };
    }
  };
  const harness = createHarness({
    depositSource: source,
    containerItemService,
    pointDistance: 5,
    durabilityService: {
      async getOrBuildDurability() { throw new Error("container durability must be skipped"); }
    }
  });

  const result = await harness.service.dropItemToScene({
    itemUuid: "Actor.hero.Item.backpack",
    characterTokenUuid: harness.characterToken.uuid,
    sceneId: "scene",
    x: 220,
    y: 330,
    quantity: 1,
    mutationId: "drop-backpack"
  }, { sender: harness.player });

  assert.equal(result.tokenUuid, "Scene.scene.Token.backpack");
  assert.deepEqual(consumed, [1]);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].snapshot.containerId, "native-bag");
  assert.equal(restored[0].target.ownerUserId, harness.player.id);
  assert.equal(harness.groundCalls.length, 0);
});

test("failed Item scene creation restores the moved inventory source", async () => {
  const calls = [];
  const source = {
    kind: "item",
    mode: "move",
    available: 1,
    sourceKey: "Actor.hero.Item.doll",
    row: { rowId: "doll", quantity: 1, itemData: { system: { quantity: 1 } } },
    canUserMove: () => true,
    async consume() { calls.push("consume"); return { kind: "item-delete" }; },
    async restore() { calls.push("restore"); }
  };
  const harness = createHarness({
    depositSource: source,
    groundFailure: new Error("scene create failed")
  });

  await assert.rejects(harness.service.dropItemToScene({
    itemUuid: "Actor.hero.Item.doll",
    characterTokenUuid: harness.characterToken.uuid,
    sceneId: "scene",
    x: 100,
    y: 100,
    quantity: 1,
    mutationId: "drop-doll"
  }, { sender: harness.player }), /scene create failed/u);
  assert.deepEqual(calls, ["consume", "restore"]);
});

test("command claims a row from a nested container path and keeps the parent row", async () => {
  const harness = createHarness();
  const bagRow = buildStorageContainerRow({
    containerId: "bag-command",
    storageKind: "bag",
    name: "Сумка",
    state: {
      baseName: "Сумка",
      state: "opened",
      manualRows: [{
        rowId: "nested-item",
        name: "Ключ",
        quantity: 2,
        itemData: { name: "Ключ", type: "loot", system: { quantity: 2 } }
      }],
      generatedRows: [],
      claimedRowIds: [],
      manualCoins: {},
      generatedCoins: {},
      coinsClaimed: false
    }
  }, { rowId: "bag-row" });
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [bagRow]
  });

  const result = await harness.service.claimRow({
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    path: ["bag-row"],
    rowId: "nested-item",
    destination: "self",
    quantity: 1,
    target: null,
    mutationId: "nested-claim"
  }, { sender: harness.player });

  assert.equal(result.row.name, "Ключ");
  assert.equal(readStorageStateAtPath(harness.storageToken, ["bag-row"]).manualRows[0].quantity, 1);
  assert.deepEqual(readStorageState(harness.storageToken).manualRows.map((row) => row.rowId), ["bag-row"]);
  assert.equal(harness.itemGrants.length, 1);
});

test("claiming a container materializes a native dnd5e tree instead of a flat loot row", async () => {
  const materialized = [];
  const containerItemService = {
    async materializeToActorOnce(actor, snapshot, mutationId) {
      materialized.push({ actor, snapshot: clone(snapshot), mutationId });
      return { id: "native-container" };
    }
  };
  const harness = createHarness({ containerItemService });
  const containerRow = buildStorageContainerRow({
    containerId: "portable-bag",
    storageKind: "bag",
    name: "Сумка хранения",
    state: { baseName: "Сумка хранения", state: "opened", manualRows: [], generatedRows: [] }
  }, { rowId: "portable-row" });
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [containerRow]
  });

  await harness.service.claimRow({
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    rowId: "portable-row",
    destination: "self",
    quantity: 1,
    target: null,
    mutationId: "portable-claim"
  }, { sender: harness.player });

  assert.equal(materialized.length, 1);
  assert.equal(materialized[0].actor, harness.hero);
  assert.equal(materialized[0].snapshot.containerId, "portable-bag");
  assert.equal(harness.itemGrants.length, 0);
  assert.equal(readStorageState(harness.storageToken).state, "empty");
});

test("storage deposits are idempotent and move the selected quantity once", async () => {
  const consumeCalls = [];
  const source = {
    kind: "item",
    mode: "move",
    available: 5,
    sourceKey: "Actor.hero.Item.arrow",
    row: {
      rowId: "deposit-arrow",
      stackKey: "same-arrow",
      name: "Стрела",
      quantity: 5,
      itemData: { name: "Стрела", type: "consumable", system: { quantity: 5 } }
    },
    canUserMove: () => true,
    async consume(quantity) {
      consumeCalls.push(quantity);
      return { kind: "item-update", beforeQuantity: 5 };
    },
    async restore() {}
  };
  const harness = createHarness({ depositSource: source });
  await harness.storageService.configure(harness.storageToken, {
    state: "empty",
    displayMode: "empty"
  });
  const payload = depositPayload(harness);

  const first = await harness.service.deposit(payload, { sender: harness.player });
  const second = await harness.service.deposit(payload, { sender: harness.player });

  assert.equal(first.quantity, 2);
  assert.deepEqual(second, first);
  assert.deepEqual(consumeCalls, [2]);
  assert.equal(readStorageState(harness.storageToken).manualRows[0].quantity, 2);
  assert.equal(readStorageState(harness.storageToken).state, "opened");
});

test("Journal deposits are GM-only, quantity-one, re-resolved, and consumed only after authorization", async () => {
  const consumeCalls = [];
  const journalSource = {
    kind: "journal",
    mode: "copy",
    available: 1,
    sourceKey: "JournalEntry.notes",
    row: {
      rowKind: "journal",
      rowId: "journal-row",
      stackKey: "",
      sourceId: "JournalEntry.notes",
      sourceType: "journal",
      name: "Полевые заметки",
      img: "icons/book.webp",
      quantity: 1
    },
    canUserMove: (user) => user?.isGM === true,
    async consume(quantity) {
      consumeCalls.push(quantity);
      return { kind: "copy" };
    },
    async restore() { return false; }
  };
  const harness = createHarness({ depositSource: journalSource });
  await harness.storageService.configure(harness.storageToken, {
    state: "empty",
    displayMode: "empty"
  });
  const source = { kind: "journal", journalUuid: "JournalEntry.notes" };

  await assert.rejects(
    harness.service.deposit(depositPayload(harness, {
      characterTokenUuid: "",
      source,
      quantity: 1,
      mutationId: "journal-player"
    }), { sender: harness.player }),
    /журнал.*мастер|мастер.*журнал/iu
  );
  assert.deepEqual(consumeCalls, []);
  assert.deepEqual(readStorageState(harness.storageToken).manualRows, []);

  await assert.rejects(
    harness.service.deposit(depositPayload(harness, {
      characterTokenUuid: "",
      source,
      quantity: 2,
      mutationId: "journal-quantity"
    }), { sender: harness.gm }),
    /журнал.*1|количеств/iu
  );
  assert.deepEqual(consumeCalls, []);
  assert.deepEqual(readStorageState(harness.storageToken).manualRows, []);

  const result = await harness.service.deposit(depositPayload(harness, {
    characterTokenUuid: "",
    source,
    quantity: 1,
    mutationId: "journal-gm"
  }), { sender: harness.gm });

  assert.equal(result.quantity, 1);
  assert.equal(result.sourceMode, "copy");
  assert.deepEqual(consumeCalls, [1]);
  assert.deepEqual(harness.depositResolveCalls, [source]);
  assert.deepEqual(readStorageState(harness.storageToken).manualRows, [journalSource.row]);
});

test("Journal rows are rejected before every claim materialization path while GM deletion remains available", async () => {
  const materialized = [];
  const harness = createHarness({
    durabilityService: {
      async getOrBuildDurability() { throw new Error("Journal durability must be skipped"); }
    },
    containerItemService: {
      async materializeToActorOnce(...args) { materialized.push(args); }
    }
  });
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [{
      rowKind: "journal",
      rowId: "journal-row",
      stackKey: "",
      sourceId: "JournalEntry.notes",
      sourceType: "journal",
      name: "Полевые заметки",
      img: "icons/book.webp",
      quantity: 1
    }]
  });

  await assert.rejects(
    harness.service.claimRow({
      tokenUuid: harness.storageToken.uuid,
      characterTokenUuid: harness.characterToken.uuid,
      rowId: "journal-row",
      destination: "self",
      quantity: 1,
      target: null,
      mutationId: "journal-claim"
    }, { sender: harness.player }),
    /журнал.*нельзя забрать/iu
  );
  assert.deepEqual(harness.itemGrants, []);
  assert.deepEqual(harness.groundCalls, []);
  assert.deepEqual(materialized, []);
  assert.deepEqual(readStorageState(harness.storageToken).claimedRowIds, []);

  const deleted = await harness.storageService.deleteRow(harness.storageToken, "journal-row");
  assert.deepEqual(deleted.manualRows, []);
  assert.equal(deleted.state, "empty");
});

test("RebreyaMainModule preserves the exact Journal source in an active-GM deposit", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const previousHooks = globalThis.Hooks;
  const gm = { id: "gm", isGM: true, active: true };
  globalThis.game = { user: gm, users: { activeGM: gm } };
  globalThis.canvas = { tokens: { controlled: [] } };
  globalThis.Hooks = { once() {}, on() {} };
  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?journal-deposit=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.storageCommandService = {
      async deposit(payload, context) {
        calls.push({ payload: clone(payload), context });
        return { changed: true };
      }
    };

    await moduleApi.depositStorageItem(
      "Scene.scene.Token.chest",
      { kind: "journal", journalUuid: "JournalEntry.notes" },
      1,
      "journal-main",
      { characterTokenUuid: "" }
    );

    assert.deepEqual(calls[0].payload.source, {
      kind: "journal",
      journalUuid: "JournalEntry.notes"
    });
    assert.equal(calls[0].context.sender, gm);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
    globalThis.Hooks = previousHooks;
  }
});

test("RebreyaMainModule sends an exact UUID-free storage Journal read payload", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const previousHooks = globalThis.Hooks;
  const gm = { id: "gm", isGM: true, active: true };
  globalThis.game = { user: gm, users: { activeGM: gm } };
  globalThis.canvas = { tokens: { controlled: [] } };
  globalThis.Hooks = { once() {}, on() {} };
  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?journal-read=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.storageCommandService = {
      async readJournal(payload, context) {
        calls.push({ payload: clone(payload), context });
        return { name: "Полевые заметки", pages: [] };
      }
    };

    await moduleApi.readStorageJournal("Scene.scene.Token.chest", "journal-row", {
      characterTokenUuid: "",
      path: ["bag-row"],
      journalUuid: "JournalEntry.polluted"
    });

    assert.deepEqual(calls[0].payload, {
      tokenUuid: "Scene.scene.Token.chest",
      characterTokenUuid: "",
      rowId: "journal-row",
      path: ["bag-row"]
    });
    assert.equal(calls[0].context.sender, gm);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
    globalThis.Hooks = previousHooks;
  }
});

test("player storage snapshots omit Journal sources while GM diagnostics retain them", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const previousHooks = globalThis.Hooks;
  const previousFoundry = globalThis.foundry;
  const previousFromUuid = globalThis.fromUuid;
  const player = { id: "player", isGM: false };
  const gm = { id: "gm", isGM: true, active: true };
  const harness = createHarness();
  globalThis.game = { user: player, users: { activeGM: gm } };
  globalThis.canvas = { tokens: { controlled: [] } };
  globalThis.Hooks = { once() {}, on() {} };
  globalThis.foundry = { utils: { deepClone: clone } };
  globalThis.fromUuid = async (uuid) => uuid === harness.storageToken.uuid ? harness.storageToken : null;
  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?journal-snapshot=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    await moduleApi.storageService.configure(harness.storageToken, {
      state: "opened",
      manualRows: [
        {
          rowKind: "journal",
          rowId: "journal-row",
          stackKey: "",
          sourceId: "JournalEntry.private",
          sourceType: "journal",
          name: "Полевые заметки",
          img: "icons/book.webp",
          quantity: 1
        },
        {
          rowKind: "item",
          rowId: "source-type-journal",
          sourceId: "JournalEntry.source-type-only",
          sourceType: "journal",
          name: "Поддельная Journal-строка",
          quantity: 1
        },
        {
          rowKind: "journal",
          rowId: "row-kind-journal",
          sourceId: "JournalEntry.row-kind-only",
          sourceType: "item",
          name: "Повреждённая Journal-строка",
          quantity: 1
        }
      ]
    });

    const playerSnapshot = await moduleApi.getStorageSnapshot(harness.storageToken.uuid);
    assert.equal(playerSnapshot.rows.length, 3);
    assert.equal(playerSnapshot.rows.some((row) => "sourceId" in row), false);
    assert.equal("manualRows" in playerSnapshot, false);

    globalThis.game.user = gm;
    const gmSnapshot = await moduleApi.getStorageSnapshot(harness.storageToken.uuid);
    assert.deepEqual(gmSnapshot.rows.map((row) => row.sourceId), [
      "JournalEntry.private",
      "JournalEntry.source-type-only",
      "JournalEntry.row-kind-only"
    ]);
    assert.equal(gmSnapshot.manualRows[0].sourceId, "JournalEntry.private");
  }
  finally {
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
    globalThis.Hooks = previousHooks;
    globalThis.foundry = previousFoundry;
    globalThis.fromUuid = previousFromUuid;
  }
});

test("storage deposits reject distance and source ownership before mutation", async () => {
  const consumeCalls = [];
  const source = {
    kind: "item",
    mode: "move",
    available: 2,
    sourceKey: "Actor.other.Item.arrow",
    row: {
      rowId: "deposit-arrow",
      stackKey: "arrow",
      name: "Стрела",
      quantity: 2,
      itemData: { system: { quantity: 2 } }
    },
    canUserMove: () => false,
    async consume() { consumeCalls.push(true); },
    async restore() {}
  };
  const far = createHarness({ distance: 10, depositSource: source });
  await assert.rejects(
    far.service.deposit(depositPayload(far), { sender: far.player }),
    /5 фут/iu
  );

  const near = createHarness({ depositSource: source });
  await assert.rejects(
    near.service.deposit(depositPayload(near), { sender: near.player }),
    /прав|влад/iu
  );
  assert.deepEqual(consumeCalls, []);
  assert.deepEqual(readStorageState(near.storageToken).manualRows, []);
});

test("failed source consumption restores the exact target storage state", async () => {
  const source = {
    kind: "item",
    mode: "move",
    available: 2,
    sourceKey: "Actor.hero.Item.arrow",
    row: {
      rowId: "deposit-arrow",
      stackKey: "arrow",
      name: "Стрела",
      quantity: 2,
      itemData: { system: { quantity: 2 } }
    },
    canUserMove: () => true,
    async consume() { throw new Error("consume failed"); },
    async restore() { throw new Error("restore must not run without a receipt"); }
  };
  const harness = createHarness({ depositSource: source });
  await harness.storageService.configure(harness.storageToken, {
    baseName: "Сундук",
    state: "empty",
    displayMode: "empty"
  });
  const before = readStorageState(harness.storageToken);

  await assert.rejects(
    harness.service.deposit(depositPayload(harness), { sender: harness.player }),
    /consume failed/u
  );

  assert.deepEqual(readStorageState(harness.storageToken), before);
  assert.equal(harness.storageToken.name, "Сундук (пусто)");
});

test("storage open rejects a token hidden from the player", async () => {
  const harness = createHarness({ visible: false });
  await assert.rejects(
    harness.service.open({
      tokenUuid: harness.storageToken.uuid,
      characterTokenUuid: harness.characterToken.uuid
    }, { sender: harness.player }),
    /не видит/iu
  );
  assert.equal(readStorageState(harness.storageToken).state, "unopened");
});

test("storage open returns a compact socket acknowledgement instead of the full nested contents", async () => {
  const harness = createHarness();

  const result = await harness.service.open({
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid
  }, { sender: harness.player });

  assert.deepEqual(Object.keys(result).sort(), ["displayMode", "generatedNow", "state"]);
  assert.equal(result.state, "opened");
  assert.equal(result.displayMode, "opened");
  assert.equal("rows" in result, false);
});

test("dead NPC storage open reuses player access checks, allows GM, and rejects a living unmarked NPC", async () => {
  const harness = createHarness();
  harness.storageToken.actor.flags = {};
  harness.storageToken.actor.system = { attributes: { hp: { value: 0 } } };

  const playerResult = await harness.service.open({
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid
  }, { sender: harness.player });

  assert.deepEqual(Object.keys(playerResult).sort(), ["displayMode", "generatedNow", "state"]);

  const gmHarness = createHarness();
  gmHarness.storageToken.actor.flags = {};
  gmHarness.storageToken.actor.system = { attributes: { hp: { value: -1 } } };
  const gmResult = await gmHarness.service.open({
    tokenUuid: gmHarness.storageToken.uuid,
    characterTokenUuid: ""
  }, { sender: gmHarness.gm });
  assert.equal(gmResult.state, "opened");

  const farHarness = createHarness({ distance: 6 });
  farHarness.storageToken.actor.flags = {};
  farHarness.storageToken.actor.system = { attributes: { hp: { value: 0 } } };
  await assert.rejects(farHarness.service.open({
    tokenUuid: farHarness.storageToken.uuid,
    characterTokenUuid: farHarness.characterToken.uuid
  }, { sender: farHarness.player }), /5 футов/iu);

  const livingHarness = createHarness();
  livingHarness.storageToken.actor.flags = {};
  livingHarness.storageToken.actor.system = { attributes: { hp: { value: 1 } } };
  await assert.rejects(livingHarness.service.open({
    tokenUuid: livingHarness.storageToken.uuid,
    characterTokenUuid: livingHarness.characterToken.uuid
  }, { sender: livingHarness.player }), /не является хранилищем/iu);
});

test("repeated storage claims grant rows and coins only once and empty the token", async () => {
  const harness = createHarness();
  const access = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid
  };
  await harness.service.open(access, { sender: harness.player });

  const rowRequest = {
    ...access,
    rowId: "row-1",
    destination: "party",
    quantity: null,
    target: null,
    mutationId: "claim-row-1"
  };
  await harness.service.claimRow(rowRequest, { sender: harness.player });
  await harness.service.claimRow(rowRequest, { sender: harness.player });

  const coinRequest = {
    ...access,
    destination: "self",
    mutationId: "claim-coins-1"
  };
  await harness.service.claimCoins(coinRequest, { sender: harness.player });
  await harness.service.claimCoins(coinRequest, { sender: harness.player });

  assert.equal(harness.itemGrants.length, 1);
  assert.deepEqual(harness.itemGrants[0].options, { allowPersistedItemData: true });
  assert.equal(harness.coinGrants.length, 1);
  assert.equal(readStorageState(harness.storageToken).state, "empty");
  assert.equal(harness.storageToken.name, "Сундук (пусто)");
});

test("storage claim derives durability on its detached grant row", async () => {
  const durability = {
    eligible: true,
    state: "intact",
    breakStage: 0,
    hp: { value: 10, max: 10 }
  };
  const harness = createHarness({
    durabilityService: {
      async getOrBuildDurability(itemData) {
        assert.equal(itemData.name, "Меч");
        return clone(durability);
      }
    }
  });
  const access = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid
  };
  await harness.service.open(access, { sender: harness.player });

  await harness.service.claimRow({
    ...access,
    rowId: "row-1",
    destination: "party",
    quantity: 1,
    target: null,
    mutationId: "durable-storage-claim"
  }, { sender: harness.player });

  assert.deepEqual(harness.itemGrants[0].row.itemData.flags[MODULE_ID].durability, durability);
  assert.equal(readStorageState(harness.storageToken).generatedRows[0]?.itemData?.flags?.[MODULE_ID]?.durability, undefined);
});

test("storage rejects a character token the sender does not own", async () => {
  const harness = createHarness();
  const stranger = { id: "stranger", isGM: false };
  await assert.rejects(
    harness.service.open({
      tokenUuid: harness.storageToken.uuid,
      characterTokenUuid: harness.characterToken.uuid
    }, { sender: stranger }),
    /персонаж/iu
  );
});

test("party storage claims accept an empty character token for a GM client", () => {
  assert.equal(isValidStorageClaimRowPayload({
    tokenUuid: "Scene.scene.Token.chest",
    characterTokenUuid: "",
    rowId: "row-1",
    destination: "party",
    quantity: 1,
    target: null,
    mutationId: "claim-row-party"
  }), true);
  assert.equal(isValidStorageClaimCoinsPayload({
    tokenUuid: "Scene.scene.Token.chest",
    characterTokenUuid: "",
    destination: "party",
    mutationId: "claim-coins-party"
  }), true);
});

test("self storage claims still require a character token", () => {
  assert.equal(isValidStorageClaimRowPayload({
    tokenUuid: "Scene.scene.Token.chest",
    characterTokenUuid: "",
    rowId: "row-1",
    destination: "self",
    quantity: 1,
    target: null,
    mutationId: "claim-row-self"
  }), false);
  assert.equal(isValidStorageClaimCoinsPayload({
    tokenUuid: "Scene.scene.Token.chest",
    characterTokenUuid: "",
    destination: "self",
    mutationId: "claim-coins-self"
  }), false);
});

test("GM party claims provide a backwards-compatible token UUID for older active GM clients", () => {
  assert.equal(storageCharacterTokenUuidForClaim({
    controlledCharacterTokenUuid: "",
    storageTokenUuid: "Scene.scene.Token.chest",
    destination: "party",
    isGM: true
  }), "Scene.scene.Token.chest");
  assert.equal(storageCharacterTokenUuidForClaim({
    controlledCharacterTokenUuid: "",
    storageTokenUuid: "Scene.scene.Token.chest",
    destination: "party",
    isGM: false
  }), "");
});

test("partial storage transfers grant and remove only the requested quantity", async () => {
  const harness = createHarness({ rowQuantity: 5 });
  const access = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid
  };
  await harness.service.open(access, { sender: harness.player });

  const result = await harness.service.claimRow({
    ...access,
    rowId: "row-1",
    destination: "party",
    quantity: 2,
    target: null,
    mutationId: "partial-row"
  }, { sender: harness.player });

  assert.equal(result.quantity, 2);
  assert.equal(harness.itemGrants.length, 1);
  assert.equal(harness.itemGrants[0].row.quantity, 2);
  assert.equal(harness.itemGrants[0].row.itemData.system.quantity, 2);
  assert.equal(readStorageState(harness.storageToken).generatedRows[0].quantity, 3);
});

test("failed destination grants do not decrement storage", async () => {
  const harness = createHarness({ rowQuantity: 5, rejectItemGrant: true });
  const access = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid
  };
  await harness.service.open(access, { sender: harness.player });

  await assert.rejects(harness.service.claimRow({
    ...access,
    rowId: "row-1",
    destination: "party",
    quantity: 2,
    target: null,
    mutationId: "failed-row"
  }, { sender: harness.player }), /grant failed/u);

  assert.equal(readStorageState(harness.storageToken).generatedRows[0].quantity, 5);
  assert.deepEqual(readStorageState(harness.storageToken).claimedRowIds, []);
});

test("duplicate partial mutations decrement once and competing quantities serialize", async () => {
  const harness = createHarness({ rowQuantity: 5 });
  const access = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid
  };
  await harness.service.open(access, { sender: harness.player });
  const duplicate = {
    ...access,
    rowId: "row-1",
    destination: "party",
    quantity: 2,
    target: null,
    mutationId: "same-partial"
  };

  await harness.service.claimRow(duplicate, { sender: harness.player });
  await harness.service.claimRow(duplicate, { sender: harness.player });
  assert.equal(readStorageState(harness.storageToken).generatedRows[0].quantity, 3);
  assert.equal(harness.itemGrants.length, 1);

  const competing = await Promise.allSettled([
    harness.service.claimRow({ ...duplicate, quantity: 2, mutationId: "race-a" }, { sender: harness.player }),
    harness.service.claimRow({ ...duplicate, quantity: 2, mutationId: "race-b" }, { sender: harness.player })
  ]);
  assert.deepEqual(competing.map((entry) => entry.status), ["fulfilled", "rejected"]);
  assert.equal(readStorageState(harness.storageToken).generatedRows[0].quantity, 1);
  assert.equal(harness.itemGrants.length, 2);
});

test("storage row payload validation accepts only exact character and scene targets", () => {
  const base = {
    tokenUuid: "Scene.scene.Token.chest",
    characterTokenUuid: "Scene.scene.Token.hero",
    rowId: "row-1",
    quantity: 1,
    mutationId: "drop-1"
  };
  assert.equal(isValidStorageClaimRowPayload({
    ...base,
    destination: "character",
    target: { actorUuid: "Actor.hero" }
  }), true);
  assert.equal(isValidStorageClaimRowPayload({
    ...base,
    destination: "scene",
    target: { sceneId: "scene", x: 100, y: 200 }
  }), true);
  assert.equal(isValidStorageClaimRowPayload({
    ...base,
    destination: "scene",
    target: { sceneId: "scene", x: "100", y: 200 }
  }), false);
  assert.equal(isValidStorageClaimRowPayload({
    ...base,
    destination: "party",
    target: { actorUuid: "Actor.hero" }
  }), false);
});

test("sheet drop grants to an owned target character before decrementing source", async () => {
  const harness = createHarness({ rowQuantity: 4 });
  const access = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid
  };
  await harness.service.open(access, { sender: harness.player });
  const result = await harness.service.claimRow({
    ...access,
    rowId: "row-1",
    destination: "character",
    quantity: 2,
    target: { actorUuid: harness.targetHero.uuid },
    mutationId: "character-drop"
  }, { sender: harness.player });

  assert.equal(result.quantity, 2);
  assert.equal(harness.itemGrants[0].actor, harness.targetHero);
  assert.equal(harness.itemGrants[0].row.quantity, 2);
  assert.equal(readStorageState(harness.storageToken).generatedRows[0].quantity, 2);
  assert.equal(harness.refreshCalls.length, 1);
});

test("canvas drop creates a ground pile only within five feet of the character", async () => {
  const events = [];
  const derivedFlag = {
    eligible: true,
    hp: { value: 9, max: 9 },
    ac: 14,
    damageThreshold: 1,
    state: "intact",
    updatedAt: 222
  };
  let derivedInput = null;
  const harness = createHarness({
    rowQuantity: 3,
    pointDistance: 5,
    executionOrder: events,
    durabilityService: {
      async getOrBuildDurability(item) {
        events.push("derive");
        derivedInput = clone(item);
        return derivedFlag;
      }
    }
  });
  const access = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid
  };
  await harness.service.open(access, { sender: harness.player });
  const originalClaim = harness.storageService.claim.bind(harness.storageService);
  harness.storageService.claim = async (...args) => {
    events.push("claim");
    return originalClaim(...args);
  };
  await harness.service.claimRow({
    ...access,
    rowId: "row-1",
    destination: "scene",
    quantity: 2,
    target: { sceneId: "scene", x: 400, y: 500 },
    mutationId: "scene-drop"
  }, { sender: harness.player });

  assert.equal(harness.groundCalls.length, 1);
  assert.deepEqual(events, ["derive", "transfer", "claim"]);
  assert.equal(derivedInput.system.quantity, 2);
  assert.deepEqual(harness.groundCalls[0].row.itemData.flags[MODULE_ID].durability, derivedFlag);
  assert.equal(harness.groundCalls[0].quantity, 2);
  assert.deepEqual(
    { sceneId: harness.groundCalls[0].sceneId, x: harness.groundCalls[0].x, y: harness.groundCalls[0].y },
    { sceneId: "scene", x: 400, y: 500 }
  );
  assert.equal(readStorageState(harness.storageToken).generatedRows[0].quantity, 1);

  const far = createHarness({ rowQuantity: 3, pointDistance: 10 });
  await far.storageService.open(far.storageToken);
  await assert.rejects(far.service.claimRow({
    tokenUuid: far.storageToken.uuid,
    characterTokenUuid: far.characterToken.uuid,
    rowId: "row-1",
    destination: "scene",
    quantity: 1,
    target: { sceneId: "scene", x: 800, y: 800 },
    mutationId: "scene-too-far"
  }, { sender: far.player }), /5 фут/iu);
  assert.equal(far.groundCalls.length, 0);
  assert.equal(readStorageState(far.storageToken).generatedRows[0].quantity, 3);
});
