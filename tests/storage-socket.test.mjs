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
  isValidStorageOpenPayload,
  isValidStorageRestorePortablePayload,
  isValidStorageTokenCharacterPayload,
  storageCharacterTokenUuidForClaim
} from "../scripts/data/storage-command-service.js";

test("storage open payload requires one exact stable trigger mutation identity", () => {
  const payload = {
    tokenUuid: "Scene.scene.Token.chest",
    characterTokenUuid: "Scene.scene.Token.hero",
    mutationId: "open-1"
  };
  assert.equal(isValidStorageOpenPayload(payload), true);
  assert.equal(isValidStorageOpenPayload({ ...payload, path: ["bag"] }), true);
  assert.equal(isValidStorageOpenPayload({ ...payload, mutationId: "" }), false);
  assert.equal(isValidStorageOpenPayload({ ...payload, extra: true }), false);
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function storageIngressPlan({ groupActorId = "group-a", folderId = null, rowIds = ["row-1"] } = {}) {
  return {
    version: 1,
    groupActorId,
    rulesRevision: 0,
    requestedFolderId: folderId,
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
      action: { type: "legacy", folderId }
    })),
    rootOverrideSourceKeys: []
  };
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
  processedGroundMutations = new Set(),
  executionOrder = [],
  durabilityService = null,
  ingressCommit = null,
  logResolve = true,
  folderIds = ["folder-a"],
  rejectFolderAssignmentOnce = false,
  refreshResult = null,
  playerName = "Игрок",
  createChatMessage = null,
  logger = null,
  triggerService = null
} = {}) {
  const player = { id: "player", name: playerName, isGM: false };
  const gm = { id: "gm", isGM: true, active: true };
  const hero = {
    id: "hero",
    uuid: "Actor.hero",
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
  const groupActor = {
    id: "group-a",
    type: "group"
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
      await this.beforeUpdate?.(patch);
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
  const chatMessages = [];
  const warnings = [];
  const folderAssignments = [];
  const ingressCommitCalls = [];
  let shouldRejectFolderAssignment = rejectFolderAssignmentOnce;
  const inventoryService = {
    async getInventoryActor({ groupActorId = "" } = {}) {
      if (groupActorId && groupActorId !== groupActor.id) {
        throw new Error("Party inventory group target is unavailable.");
      }
      return groupActor;
    },
    async getInventorySnapshot({ groupActorId = "" } = {}) {
      await this.getInventoryActor({ groupActorId });
      return {
        actorId: groupActor.id,
        folders: folderIds.map((id) => ({ id }))
      };
    },
    async assignInventoryGrantFolder(request) {
      folderAssignments.push(clone(request));
      if (shouldRejectFolderAssignment) {
        shouldRejectFolderAssignment = false;
        throw new Error("folder assignment failed");
      }
      return { itemId: request.itemId, folderId: request.folderId };
    },
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
    async addCurrencyToInventoryOnce(coins, mutationId, options) {
      if (!completed.has(mutationId)) {
        coinGrants.push({ coins: clone(coins), mutationId, options: clone(options), destination: "party" });
      }
      completed.add(mutationId);
    },
    async commitInventoryIngressBatch(request, adapters) {
      ingressCommitCalls.push(clone(request));
      if (typeof ingressCommit === "function") return ingressCommit(request, adapters);
      const rows = await adapters.resolveRows();
      const planned = new Map((request.serializedPlan?.rows ?? []).map((row) => [row.sourceKey, row]));
      const overrides = new Set(request.serializedPlan?.rootOverrideSourceKeys ?? []);
      const results = [];
      for (const row of rows) {
        const planRow = planned.get(row.sourceKey) ?? {
          sourceKey: row.sourceKey,
          matchedRuleId: null,
          action: { type: "legacy", folderId: row.legacyFolderId ?? null }
        };
        const skipped = planRow?.action?.type === "skip" && !overrides.has(row.sourceKey);
        if (!skipped) {
          if (row.container) {
            const root = await adapters.grantContainer({
              actor: groupActor,
              container: clone(row.container),
              sourceKey: row.sourceKey,
              mutationId: `inventory-ingress:${request.batchMutationId}:${row.sourceKey}`,
              folderId: planRow?.action?.type === "folder" ? planRow.action.folderId : null
            });
            await inventoryService.assignInventoryGrantFolder({
              groupActorId: request.groupActorId,
              itemId: root.id,
              folderId: planRow.action.folderId ?? null
            });
          }
          else {
            await inventoryService.addLootgenRowToInventoryOnce(row, request.batchMutationId, {
              groupActorId: request.groupActorId,
              folderId: planRow.action.folderId ?? null,
              allowPersistedItemData: true
            });
          }
          await adapters.debitRow(row, { sourceKey: row.sourceKey });
        }
        results.push({
          sourceKey: row.sourceKey,
          matchedRuleId: planRow?.matchedRuleId ?? null,
          action: clone(planRow.action),
          overrideToRoot: overrides.has(row.sourceKey),
          derivedFolderId: ["folder", "legacy"].includes(planRow.action.type) ? planRow.action.folderId : null,
          changed: !skipped,
          targetItemIds: skipped ? [] : [row.container ? "materialized-bag" : "granted-item"]
        });
      }
      return {
        actorId: request.groupActorId,
        batchMutationId: request.batchMutationId,
        changed: results.some((row) => row.changed),
        rows: results
      };
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
        || processedGroundMutations.has(request.mutationId)
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
      processedGroundMutations.add(request.mutationId);
      return { created: true, merged: false, duplicate: false };
    },
    async refreshAfterStorageMutation(token, state) {
      refreshCalls.push({ token, state: clone(state) });
      return typeof refreshResult === "function"
        ? refreshResult(token, state, refreshCalls.length)
        : refreshResult;
    }
  };
  const commandDependencies = {
    storageService,
    inventoryService,
    resolveToken: async (uuid) => documents.get(uuid) ?? null,
    measureDistance: () => typeof distance === "function" ? distance() : distance,
    measurePointDistance: () => pointDistance,
    groundPileService,
    containerItemService,
    durabilityService,
    triggerService: triggerService ?? { async execute() { return { allowed: true, completedChainIds: [] }; } },
    isVisibleTo: () => visible,
    journalReader: journalReader ?? {
      async read(journalUuid) {
        journalReadCalls.push(journalUuid);
        return { name: "Полевые заметки", pages: [] };
      }
    },
    createChatMessage: createChatMessage ?? (async (data) => {
      chatMessages.push(clone(data));
      return data;
    }),
    logger: logger ?? {
      warn(...args) { warnings.push(args); }
    },
    resolveDepositSource: async (...args) => {
      if (logResolve) executionOrder.push("resolve");
      depositResolveCalls.push(clone(args[0]));
      return typeof depositSource === "function" ? depositSource(...args) : depositSource;
    }
  };
  const createCommandService = () => new StorageCommandService(commandDependencies);
  const service = createCommandService();

  return {
    player,
    gm,
    hero,
    targetHero,
    groupActor,
    characterToken,
    storageToken,
    storageService,
    service,
    createCommandService,
    itemGrants,
    coinGrants,
    groundCalls,
    groundCoinCalls,
    groundFindCalls,
    refreshCalls,
    depositResolveCalls,
    journalReadCalls,
    chatMessages,
    warnings,
    folderAssignments,
    ingressCommitCalls
  };
}

test("storage command service validates a supplied durability derivation dependency", () => {
  assert.throws(
    () => createHarness({ durabilityService: {} }),
    /getOrBuildDurability/u
  );
});

test("storage claims allow exactly ten feet and reject a greater distance", async () => {
  const near = createHarness({ distance: 10, visible: true });
  await near.storageService.open(near.storageToken);

  const accepted = await near.service.claimRow({
    tokenUuid: near.storageToken.uuid,
    characterTokenUuid: near.characterToken.uuid,
    rowId: "row-1",
    destination: "self",
    quantity: null,
    target: null,
    mutationId: "claim-at-ten-feet"
  }, { sender: near.player });

  assert.equal(accepted.changed, true);
  assert.equal(near.itemGrants.length, 1);

  const far = createHarness({ distance: 11, visible: true });
  await far.storageService.open(far.storageToken);

  await assert.rejects(
    far.service.claimRow({
      tokenUuid: far.storageToken.uuid,
      characterTokenUuid: far.characterToken.uuid,
      rowId: "row-1",
      destination: "self",
      quantity: null,
      target: null,
      mutationId: "claim-beyond-ten-feet"
    }, { sender: far.player }),
    /10 фут/iu
  );
  assert.equal(far.itemGrants.length, 0);
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
    source: { kind: "journal", sourceUuid: "JournalEntry.notes", documentName: "JournalEntry" },
    quantity: 1,
    mutationId: "journal-deposit"
  }), true);
  assert.equal(isValidStorageDepositPayload({
    tokenUuid: base.tokenUuid,
    characterTokenUuid: "",
    source: { kind: "journal", sourceUuid: "JournalEntry.notes", documentName: "JournalEntry", extra: true },
    quantity: 1,
    mutationId: "journal-deposit"
  }), false);
  assert.equal(isValidStorageDepositPayload({
    tokenUuid: base.tokenUuid,
    characterTokenUuid: "",
    source: { kind: "journal", sourceUuid: "JournalEntry.notes", documentName: "JournalEntry" },
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
      async read(sourceUuid, options) {
        readCalls.push([sourceUuid, options]);
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
      sourceDocumentName: "JournalEntryPage",
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
  assert.deepEqual(readCalls, [["JournalEntry.authoritative", {
    documentName: "JournalEntryPage"
  }]]);
  assert.deepEqual(journalOwnership, beforeOwnership);
  assert.deepEqual(readStorageState(harness.storageToken).readJournalRowIds, ["journal-row"]);

  const farHarness = createHarness({ distance: 11 });
  await farHarness.storageService.configure(farHarness.storageToken, {
    state: "opened",
    manualRows: [readStorageState(harness.storageToken).manualRows[0]]
  });
  await assert.rejects(farHarness.service.readJournal({
    tokenUuid: farHarness.storageToken.uuid,
    characterTokenUuid: farHarness.characterToken.uuid,
    rowId: "journal-row"
  }, { sender: farHarness.player }), /10 футов/iu);

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

test("GM Journal reads return the safe snapshot without marking or publishing the read", async () => {
  const harness = createHarness();
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [{
      rowKind: "journal",
      rowId: "journal-row",
      stackKey: "",
      sourceId: "JournalEntry.notes",
      sourceType: "journal",
      sourceDocumentName: "JournalEntry",
      name: "Полевые заметки",
      quantity: 1
    }]
  });
  const request = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    rowId: "journal-row"
  };

  const snapshot = await harness.service.readJournal(request, { sender: harness.gm });

  assert.deepEqual(snapshot, { name: "Полевые заметки", pages: [] });
  assert.deepEqual(readStorageState(harness.storageToken).readJournalRowIds, []);
  assert.deepEqual(harness.refreshCalls, []);
  assert.deepEqual(harness.chatMessages, []);
});

test("the first player Journal read after a GM read marks and publishes exactly once", async () => {
  const harness = createHarness();
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [{
      rowKind: "journal",
      rowId: "journal-row",
      stackKey: "",
      sourceId: "JournalEntry.notes",
      sourceType: "journal",
      sourceDocumentName: "JournalEntry",
      name: "Полевые заметки",
      quantity: 1
    }]
  });
  const request = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    rowId: "journal-row"
  };

  await harness.service.readJournal(request, { sender: harness.gm });
  assert.deepEqual(readStorageState(harness.storageToken).readJournalRowIds, []);
  assert.deepEqual(harness.refreshCalls, []);
  assert.deepEqual(harness.chatMessages, []);

  await harness.service.readJournal(request, { sender: harness.player });
  await harness.service.readJournal(request, { sender: harness.player });

  assert.deepEqual(readStorageState(harness.storageToken).readJournalRowIds, ["journal-row"]);
  assert.equal(harness.refreshCalls.length, 1);
  assert.equal(harness.chatMessages.length, 1);
});

test("only the first successful Journal read refreshes the root pile and publishes one sanitized public message", async () => {
  const harness = createHarness({
    playerName: "<Игрок>",
    journalReader: { async read() { return { name: "Snapshot", pages: [] }; } }
  });
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [{
      rowKind: "journal",
      rowId: "journal-row",
      stackKey: "",
      sourceId: "JournalEntry.notes",
      sourceType: "journal",
      name: "Запись <тайна>",
      quantity: 1
    }]
  });
  const request = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    rowId: "journal-row"
  };

  await harness.service.readJournal(request, { sender: harness.player });
  await harness.service.readJournal(request, { sender: harness.player });

  assert.equal(harness.refreshCalls.length, 1);
  assert.equal(harness.refreshCalls[0].token, harness.storageToken);
  assert.deepEqual(harness.refreshCalls[0].state, readStorageState(harness.storageToken));
  assert.equal(harness.chatMessages.length, 1);
  assert.equal(harness.chatMessages[0].whisper, undefined);
  assert.match(harness.chatMessages[0].content, /&lt;Игрок&gt;.*Запись &lt;тайна&gt;/u);
  assert.equal(JSON.stringify(harness.chatMessages).includes("JournalEntry.notes"), false);
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
  assert.equal(harness.refreshCalls.length, 1);
  assert.equal(harness.refreshCalls[0].token, harness.storageToken);
  assert.deepEqual(harness.refreshCalls[0].state, readStorageState(harness.storageToken));

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

test("failed Journal reading does not persist a read marker", async () => {
  const harness = createHarness({
    journalReader: {
      async read() {
        throw new Error("Запись журнала недоступна.");
      }
    }
  });
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [{
      rowKind: "journal",
      rowId: "journal-row",
      sourceId: "JournalEntry.failed",
      sourceType: "journal",
      name: "Записка",
      quantity: 1
    }]
  });

  await assert.rejects(harness.service.readJournal({
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    rowId: "journal-row"
  }, { sender: harness.player }), /недоступна/iu);

  assert.deepEqual(readStorageState(harness.storageToken).readJournalRowIds, []);
  assert.equal(harness.refreshCalls.length, 0);
  assert.equal(harness.chatMessages.length, 0);
});

test("Journal chat failure keeps the committed marker and records one warning", async () => {
  const harness = createHarness({
    createChatMessage: async () => { throw new Error("chat failed"); }
  });
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [{
      rowKind: "journal",
      rowId: "journal-row",
      stackKey: "",
      sourceId: "JournalEntry.notes",
      sourceType: "journal",
      name: "Записка",
      quantity: 1
    }]
  });

  await harness.service.readJournal({
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    rowId: "journal-row"
  }, { sender: harness.player });

  assert.deepEqual(readStorageState(harness.storageToken).readJournalRowIds, ["journal-row"]);
  assert.equal(harness.refreshCalls.length, 1);
  assert.equal(harness.warnings.length, 1);
  assert.match(String(harness.warnings[0][0]), /Journal read ChatMessage creation failed/u);
});

test("concurrent Journal reads serialize on the storage source queue", async () => {
  let releaseFirst;
  let markFirstStarted;
  let calls = 0;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  const harness = createHarness({
    journalReader: {
      async read() {
        calls += 1;
        if (calls === 1) {
          markFirstStarted();
          await firstGate;
        }
        return { name: "Записка", pages: [] };
      }
    }
  });
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [{
      rowKind: "journal",
      rowId: "journal-row",
      sourceId: "JournalEntry.concurrent",
      sourceType: "journal",
      name: "Записка",
      quantity: 1
    }]
  });
  const request = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    rowId: "journal-row"
  };

  const first = harness.service.readJournal(request, { sender: harness.player });
  await firstStarted;
  const second = harness.service.readJournal(request, { sender: harness.player });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  releaseFirst();
  await Promise.all([first, second]);

  assert.equal(calls, 2);
  assert.deepEqual(readStorageState(harness.storageToken).readJournalRowIds, ["journal-row"]);
});

test("concurrent Journal reads in sibling containers preserve both root mutations", async () => {
  const harness = createHarness();
  const journalBag = (bagId, journalId) => buildStorageContainerRow({
    containerId: bagId,
    storageKind: "bag",
    name: bagId,
    state: {
      state: "opened",
      manualRows: [{
        rowKind: "journal",
        rowId: journalId,
        sourceId: `JournalEntry.${journalId}`,
        sourceType: "journal",
        name: journalId,
        quantity: 1
      }],
      generatedRows: []
    }
  }, { rowId: bagId });
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [journalBag("bag-a", "journal-a"), journalBag("bag-b", "journal-b")]
  });

  let releaseFirstUpdate;
  let markFirstUpdateStarted;
  let updateCalls = 0;
  const firstUpdateGate = new Promise((resolve) => { releaseFirstUpdate = resolve; });
  const firstUpdateStarted = new Promise((resolve) => { markFirstUpdateStarted = resolve; });
  harness.storageToken.beforeUpdate = async () => {
    updateCalls += 1;
    if (updateCalls === 1) {
      markFirstUpdateStarted();
      await firstUpdateGate;
    }
  };

  const request = (path, rowId) => ({
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    path: [path],
    rowId
  });
  const first = harness.service.readJournal(request("bag-a", "journal-a"), { sender: harness.player });
  await firstUpdateStarted;
  const second = harness.service.readJournal(request("bag-b", "journal-b"), { sender: harness.player });
  await new Promise((resolve) => setImmediate(resolve));
  releaseFirstUpdate();
  await Promise.all([first, second]);

  assert.deepEqual(readStorageStateAtPath(harness.storageToken, ["bag-a"]).readJournalRowIds, ["journal-a"]);
  assert.deepEqual(readStorageStateAtPath(harness.storageToken, ["bag-b"]).readJournalRowIds, ["journal-b"]);
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

test("player can drop an ordinary Item at exactly ten feet", async () => {
  const harness = createHarness({
    pointDistance: 10,
    depositSource: {
      kind: "item",
      mode: "copy",
      available: 1,
      row: {
        rowId: "ten-foot-item",
        name: "Фляга",
        quantity: 1,
        itemData: { name: "Фляга", type: "loot", system: { quantity: 1 } }
      },
      canUserMove: () => true,
      async consume() { return { kind: "copy" }; },
      async restore() {}
    }
  });

  const result = await harness.service.dropItemToScene({
    itemUuid: "Item.ten-foot-item",
    characterTokenUuid: harness.characterToken.uuid,
    sceneId: "scene",
    x: 200,
    y: 100,
    quantity: 1,
    mutationId: "drop-at-ten-feet"
  }, { sender: harness.player });

  assert.equal(result.changed, true);
  assert.equal(harness.groundCalls.length, 1);
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

test("Journal scene drop accepts only the exact GM command payload", () => {
  assert.equal(typeof storageCommands.isValidStorageJournalDropPayload, "function");
  const { isValidStorageJournalDropPayload } = storageCommands;
  const payload = {
    sourceUuid: "JournalEntry.notes",
    documentName: "JournalEntry",
    mutationId: "journal-scene-1",
    sceneId: "scene",
    x: 100,
    y: 200
  };
  assert.equal(isValidStorageJournalDropPayload(payload), true);
  assert.equal(isValidStorageJournalDropPayload({ ...payload, sourceUuid: " notes " }), false);
  assert.equal(isValidStorageJournalDropPayload({ ...payload, documentName: "JournalEntryPage" }), true);
  assert.equal(isValidStorageJournalDropPayload({ ...payload, documentName: "Actor" }), false);
  assert.equal(isValidStorageJournalDropPayload({ ...payload, x: Number.NaN }), false);
  assert.equal(isValidStorageJournalDropPayload({ ...payload, characterTokenUuid: "Token.hero" }), false);
  assert.equal(isValidStorageJournalDropPayload({ ...payload, extra: true }), false);
});

test("GM Journal scene drop re-resolves one canonical reference and returns a compact result", async () => {
  const events = [];
  const harness = createHarness({
    depositSource: {
      kind: "journal",
      mode: "copy",
      available: 1,
      row: {
        rowKind: "journal",
        rowId: "source-row",
        stackKey: "",
        sourceId: "JournalEntry.authoritative",
        sourceType: "journal",
        sourceDocumentName: "JournalEntry",
        name: "Заметки Гартара",
        img: "icons/book.webp",
        quantity: 1
      },
      canUserMove: () => true,
      async consume(quantity) { events.push(["consume", quantity]); return { kind: "copy" }; },
      async restore(receipt) { events.push(["restore", receipt.kind]); }
    }
  });
  const payload = {
    sourceUuid: "JournalEntry.authoritative",
    documentName: "JournalEntry",
    mutationId: "journal-drop",
    sceneId: "scene",
    x: 100,
    y: 200
  };

  const result = await harness.service.dropJournalToScene(payload, { sender: harness.gm });

  assert.deepEqual(harness.depositResolveCalls, [{
    kind: "journal",
    sourceUuid: "JournalEntry.authoritative",
    documentName: "JournalEntry"
  }]);
  assert.deepEqual(events, [["consume", 1]]);
  assert.equal(harness.groundCalls[0].quantity, 1);
  assert.equal(harness.groundCalls[0].row.rowKind, "journal");
  assert.deepEqual(Object.keys(result).sort(), ["changed", "created", "duplicate", "merged"]);
  assert.equal(JSON.stringify(result).includes("JournalEntry"), false);
});

test("Journal scene drop rejects non-GM and invalid authoritative sources before transfer", async () => {
  let consumed = 0;
  const canonical = (overrides = {}) => ({
    kind: "journal",
    mode: "copy",
    available: 1,
    row: {
      rowKind: "journal",
      rowId: "journal-row",
      stackKey: "",
      sourceId: "JournalEntry.notes",
      sourceType: "journal",
      sourceDocumentName: "JournalEntry",
      name: "Запись",
      quantity: 1
    },
    canUserMove: () => true,
    async consume() { consumed += 1; return { kind: "copy" }; },
    async restore() {},
    ...overrides
  });
  const payload = {
    sourceUuid: "JournalEntry.notes",
    documentName: "JournalEntry",
    mutationId: "journal-guards",
    sceneId: "scene",
    x: 100,
    y: 200
  };
  const playerHarness = createHarness({ depositSource: canonical() });
  await assert.rejects(
    playerHarness.service.dropJournalToScene(payload, { sender: playerHarness.player }),
    /только мастер/iu
  );
  assert.equal(playerHarness.depositResolveCalls.length, 0);
  assert.equal(consumed, 0);

  for (const [name, source] of [
    ["kind", canonical({ kind: "item" })],
    ["mode", canonical({ mode: "move" })],
    ["available", canonical({ available: 2 })],
    ["row", canonical({ row: { rowKind: "journal", quantity: 1 } })]
  ]) {
    const harness = createHarness({ depositSource: source });
    await assert.rejects(
      harness.service.dropJournalToScene({ ...payload, mutationId: `journal-guard-${name}` }, { sender: harness.gm }),
      /Источник записи журнала/iu,
      name
    );
    assert.equal(harness.groundCalls.length, 0, name);
  }
  assert.equal(consumed, 0);
});

test("failed Journal scene transfer restores its copy receipt and preserves rollback failures", async () => {
  const events = [];
  const source = {
    kind: "journal",
    mode: "copy",
    available: 1,
    row: {
      rowKind: "journal",
      rowId: "journal-row",
      stackKey: "",
      sourceId: "JournalEntry.notes",
      sourceType: "journal",
      sourceDocumentName: "JournalEntry",
      name: "Запись",
      quantity: 1
    },
    canUserMove: () => true,
    async consume() { events.push("consume"); return { kind: "copy" }; },
    async restore() { events.push("restore"); }
  };
  const payload = {
    sourceUuid: "JournalEntry.notes",
    documentName: "JournalEntry",
    mutationId: "journal-rollback",
    sceneId: "scene",
    x: 100,
    y: 200
  };
  const harness = createHarness({ depositSource: source, groundFailure: new Error("scene transfer failed") });
  await assert.rejects(
    harness.service.dropJournalToScene(payload, { sender: harness.gm }),
    /scene transfer failed/u
  );
  assert.deepEqual(events, ["consume", "restore"]);

  const aggregateHarness = createHarness({
    groundFailure: new Error("scene transfer failed"),
    depositSource: {
      ...source,
      async restore() { throw new Error("copy rollback failed"); }
    }
  });
  await assert.rejects(
    aggregateHarness.service.dropJournalToScene({ ...payload, mutationId: "journal-aggregate" }, {
      sender: aggregateHarness.gm
    }),
    (error) => error instanceof AggregateError
      && error.errors.some((entry) => /scene transfer failed/u.test(entry.message))
      && error.errors.some((entry) => /copy rollback failed/u.test(entry.message))
  );
});

test("Journal scene mutation is idempotent and bound to Journal, scene, point, and sender", async () => {
  const processed = new Set();
  const source = {
    kind: "journal",
    mode: "copy",
    available: 1,
    row: {
      rowKind: "journal",
      rowId: "journal-row",
      stackKey: "",
      sourceId: "JournalEntry.notes",
      sourceType: "journal",
      sourceDocumentName: "JournalEntry",
      name: "Запись",
      quantity: 1
    },
    canUserMove: () => true,
    async consume() { return { kind: "copy" }; },
    async restore() {}
  };
  const harness = createHarness({ depositSource: source, processedGroundMutations: processed });
  const payload = {
    sourceUuid: "JournalEntry.notes",
    documentName: "JournalEntry",
    mutationId: "journal-idempotent",
    sceneId: "scene",
    x: 100,
    y: 200
  };
  const first = await harness.service.dropJournalToScene(payload, { sender: harness.gm });
  const retry = await harness.service.dropJournalToScene(payload, { sender: harness.gm });
  assert.deepEqual(retry, first);
  assert.equal(harness.groundCalls.length, 1);
  assert.equal(harness.depositResolveCalls.length, 1);

  for (const [name, changed, sender] of [
    ["Journal", { sourceUuid: "JournalEntry.other" }, harness.gm],
    ["document kind", { documentName: "JournalEntryPage" }, harness.gm],
    ["scene", { sceneId: "other-scene" }, harness.gm],
    ["point", { x: 101 }, harness.gm],
    ["sender", {}, { id: "other-gm", isGM: true }]
  ]) {
    await assert.rejects(
      harness.service.dropJournalToScene({ ...payload, ...changed }, { sender }),
      /mutationId/iu,
      name
    );
  }
  assert.equal(harness.groundCalls.length, 1);
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
  const harness = createHarness({ depositSource: source, executionOrder: order, pointDistance: 10 });
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
    createHarness({ depositSource: source({ available: 3 }), pointDistance: 11 }).service.dropCoinsToScene(payload, { sender: { id: "player", isGM: false } }),
    /10 фут/iu
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
    { name: "point", sender: { id: "player", isGM: false }, available: 1, canUserMove: true, pointDistance: 11 }
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

test("party container assignment completes before storage claim and retry reuses the materialized root", async () => {
  const materialized = [];
  const containerItemService = {
    async materializeToActorOnce(actor, snapshot, mutationId) {
      materialized.push({ actor, snapshot: clone(snapshot), mutationId });
      return { id: "native-party-container" };
    }
  };
  const harness = createHarness({
    containerItemService,
    rejectFolderAssignmentOnce: true
  });
  const containerRow = buildStorageContainerRow({
    containerId: "portable-party-bag",
    storageKind: "bag",
    name: "Партийная сумка",
    state: { baseName: "Партийная сумка", state: "opened", manualRows: [], generatedRows: [] }
  }, { rowId: "portable-party-row" });
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [containerRow]
  });
  const request = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    rowId: "portable-party-row",
    destination: "party",
    quantity: 1,
    target: { groupActorId: harness.groupActor.id, folderId: "folder-a" },
    mutationId: "portable-party-claim"
  };

  await assert.rejects(
    harness.service.claimRow(request, { sender: harness.player }),
    /folder assignment failed/u
  );
  assert.equal(readStorageState(harness.storageToken).manualRows.length, 1);

  await harness.service.claimRow(request, { sender: harness.player });

  assert.equal(materialized.length, 2);
  assert.equal(materialized[0].actor, harness.groupActor);
  assert.equal(materialized[0].mutationId, materialized[1].mutationId);
  assert.deepEqual(harness.folderAssignments, [
    { groupActorId: "group-a", itemId: "native-party-container", folderId: "folder-a" },
    { groupActorId: "group-a", itemId: "native-party-container", folderId: "folder-a" }
  ]);
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
      sourceDocumentName: "JournalEntry",
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
  const source = {
    kind: "journal",
    sourceUuid: "JournalEntry.notes",
    documentName: "JournalEntry"
  };

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
      { kind: "journal", sourceUuid: "JournalEntry.notes", documentName: "JournalEntry" },
      1,
      "journal-main",
      { characterTokenUuid: "" }
    );

    assert.deepEqual(calls[0].payload.source, {
      kind: "journal",
      sourceUuid: "JournalEntry.notes",
      documentName: "JournalEntry"
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

test("RebreyaMainModule sends one exact storage bulk claim payload", async () => {
  const previousGame = globalThis.game;
  const previousCanvas = globalThis.canvas;
  const previousHooks = globalThis.Hooks;
  const previousFoundry = globalThis.foundry;
  const gm = { id: "gm", isGM: true, active: true };
  globalThis.game = { user: gm, users: { activeGM: gm } };
  globalThis.canvas = { tokens: { controlled: [] } };
  globalThis.Hooks = { once() {}, on() {} };
  globalThis.foundry = { utils: { deepClone: clone } };
  try {
    const { RebreyaMainModule } = await import(`../scripts/main.js?storage-bulk=${Date.now()}`);
    const moduleApi = new RebreyaMainModule();
    const calls = [];
    moduleApi.inventoryService = {
      async getInventoryActor({ groupActorId }) {
        return groupActorId === "group-a" ? { id: "group-a", type: "group" } : null;
      }
    };
    const ingressPlan = storageIngressPlan();
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
      serialize() { return ingressPlan; }
    };
    moduleApi.storageCommandService = {
      async claimAll(payload, context) {
        calls.push({ payload: clone(payload), context });
        return { changed: true };
      }
    };

    await moduleApi.claimStorageAll(
      "Scene.scene.Token.chest",
      "party",
      "bulk-main",
      {
        characterTokenUuid: "Scene.scene.Token.hero",
        path: ["bag-row"],
        target: { groupActorId: "group-a", folderId: null }
      }
    );

    assert.deepEqual(calls[0].payload, {
      tokenUuid: "Scene.scene.Token.chest",
      characterTokenUuid: "Scene.scene.Token.hero",
      destination: "party",
      target: { groupActorId: "group-a", folderId: null },
      ingressPlan,
      mutationId: "bulk-main",
      path: ["bag-row"]
    });
    assert.equal(calls[0].context.sender, gm);
  }
  finally {
    globalThis.game = previousGame;
    globalThis.canvas = previousCanvas;
    globalThis.Hooks = previousHooks;
    globalThis.foundry = previousFoundry;
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
    await moduleApi.storageService.markJournalRead(harness.storageToken, "journal-row");

    const playerSnapshot = await moduleApi.getStorageSnapshot(harness.storageToken.uuid);
    assert.equal(playerSnapshot.rows.length, 3);
    assert.equal(playerSnapshot.rows.some((row) => "sourceId" in row), false);
    assert.deepEqual(playerSnapshot.rows.map((row) => row.journalRead), [true, false, false]);
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
  const far = createHarness({ distance: 11, depositSource: source });
  await assert.rejects(
    far.service.deposit(depositPayload(far), { sender: far.player }),
    /10 фут/iu
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

test("storage beforeOpen runs after access, can deny before mutation, and afterOpen observes committed state", async () => {
  const events = [];
  let harness;
  const triggerService = {
    async execute(event, _state, context) {
      events.push({ event, state: readStorageStateAtPath(context.storageToken, context.path).state, context });
      return event === "beforeOpen" && context.runId === "deny:beforeOpen"
        ? { allowed: false, message: "Хранилище заперто.", completedChainIds: ["lock"] }
        : { allowed: true, completedChainIds: [] };
    }
  };
  harness = createHarness({ triggerService });
  await assert.rejects(harness.service.open({
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    mutationId: "deny"
  }, { sender: harness.player }), /заперто/iu);
  assert.equal(readStorageState(harness.storageToken).state, "unopened");
  assert.deepEqual(events.map((entry) => [entry.event, entry.state]), [["beforeOpen", "unopened"]]);

  events.length = 0;
  await harness.service.open({
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    mutationId: "allow"
  }, { sender: harness.player });
  assert.deepEqual(events.map((entry) => [entry.event, entry.state]), [
    ["beforeOpen", "unopened"], ["afterOpen", "opened"]
  ]);
  assert.equal(events[0].context.characterActorUuid, "Actor.hero");

  const hiddenEvents = [];
  const hidden = createHarness({
    visible: false,
    triggerService: { async execute(...args) { hiddenEvents.push(args); } }
  });
  await assert.rejects(hidden.service.open({
    tokenUuid: hidden.storageToken.uuid,
    characterTokenUuid: hidden.characterToken.uuid,
    mutationId: "hidden"
  }, { sender: hidden.player }), /не видит/iu);
  assert.deepEqual(hiddenEvents, []);
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

  const farHarness = createHarness({ distance: 11 });
  farHarness.storageToken.actor.flags = {};
  farHarness.storageToken.actor.system = { attributes: { hp: { value: 0 } } };
  await assert.rejects(farHarness.service.open({
    tokenUuid: farHarness.storageToken.uuid,
    characterTokenUuid: farHarness.characterToken.uuid
  }, { sender: farHarness.player }), /10 футов/iu);

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
    target: { groupActorId: harness.groupActor.id, folderId: null },
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
  assert.deepEqual(harness.itemGrants[0].options, {
    allowPersistedItemData: true,
    groupActorId: harness.groupActor.id,
    folderId: null
  });
  assert.equal(harness.coinGrants.length, 1);
  assert.equal(readStorageState(harness.storageToken).state, "empty");
  assert.equal(harness.storageToken.name, "Сундук (пусто)");
});

test("afterClaim uses committed summaries and emptied runs once before final pile refresh", async () => {
  const order = [];
  const events = [];
  const harness = createHarness({
    triggerService: {
      async execute(event, _state, context) {
        if (["afterClaim", "emptied"].includes(event)) {
          order.push(event);
          events.push({ event, summary: clone(context.claimSummary), state: readStorageStateAtPath(context.storageToken, context.path).state });
        }
        return { allowed: true, completedChainIds: [] };
      }
    },
    refreshResult: () => {
      order.push("refresh");
      return { deleted: false };
    }
  });
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [{ rowId: "only", name: "Ключ", quantity: 1, itemData: { name: "Ключ", type: "loot", system: { quantity: 1 } } }],
    manualCoins: {}, generatedRows: [], generatedCoins: {}, coinsClaimed: true
  });
  const payload = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    rowId: "only", destination: "self", quantity: 1, target: null, ingressPlan: null,
    mutationId: "trigger-final-row"
  };

  const first = await harness.service.claimRow(payload, { sender: harness.player });
  const retry = await harness.service.claimRow(payload, { sender: harness.player });

  assert.equal(first.changed, true);
  assert.deepEqual(retry, first);
  assert.deepEqual(order, ["afterClaim", "emptied", "refresh"]);
  assert.deepEqual(events, [{
    event: "afterClaim",
    summary: { kind: "row", rowId: "only", quantity: 1, destination: "self", state: "empty" },
    state: "empty"
  }, {
    event: "emptied",
    summary: { kind: "row", rowId: "only", quantity: 1, destination: "self", state: "empty" },
    state: "empty"
  }]);
});

test("storage claims report when the final ordinary ground pile was deleted", async () => {
  const harness = createHarness({ refreshResult: { deleted: true } });
  await harness.storageService.open(harness.storageToken);

  const result = await harness.service.claimRow({
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    rowId: "row-1",
    destination: "self",
    quantity: null,
    target: null,
    mutationId: "claim-last-ground-row"
  }, { sender: harness.player });

  assert.equal(result.changed, true);
  assert.equal(result.sourceDeleted, true);
  assert.equal(harness.refreshCalls.length, 1);
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
    target: { groupActorId: harness.groupActor.id, folderId: "folder-a" },
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

test("party storage claims require an exact group and nullable folder target", () => {
  const rootPlan = storageIngressPlan();
  const folderPlan = storageIngressPlan({ folderId: "folder-a" });
  assert.equal(isValidStorageClaimRowPayload({
    tokenUuid: "Scene.scene.Token.chest",
    characterTokenUuid: "",
    rowId: "row-1",
    destination: "party",
    quantity: 1,
    target: { groupActorId: "group-a", folderId: null },
    ingressPlan: rootPlan,
    mutationId: "claim-row-party"
  }), true);
  assert.equal(isValidStorageClaimRowPayload({
    tokenUuid: "Scene.scene.Token.chest",
    characterTokenUuid: "",
    rowId: "row-1",
    destination: "party",
    quantity: 1,
    target: { groupActorId: "group-a", folderId: "folder-a" },
    ingressPlan: folderPlan,
    mutationId: "claim-row-party-folder"
  }), true);
  assert.equal(isValidStorageClaimRowPayload({
    tokenUuid: "Scene.scene.Token.chest",
    characterTokenUuid: "",
    rowId: "row-1",
    destination: "party",
    quantity: 1,
    target: { groupActorId: "group-a", folderId: null },
    ingressPlan: null,
    mutationId: "claim-row-party-no-plan"
  }), false);
  assert.equal(isValidStorageClaimRowPayload({
    tokenUuid: "Scene.scene.Token.chest",
    characterTokenUuid: "Scene.scene.Token.hero",
    rowId: "row-1",
    destination: "self",
    quantity: 1,
    target: null,
    ingressPlan: rootPlan,
    mutationId: "claim-row-self-with-plan"
  }), false);
  for (const target of [
    null,
    { groupActorId: "group-a" },
    { groupActorId: " group-a", folderId: null },
    { groupActorId: "group-a", folderId: " folder-a" },
    { groupActorId: "group-a", folderId: null, extra: true }
  ]) {
    assert.equal(isValidStorageClaimRowPayload({
      tokenUuid: "Scene.scene.Token.chest",
      characterTokenUuid: "",
      rowId: "row-1",
      destination: "party",
      quantity: 1,
      target,
      ingressPlan: rootPlan,
      mutationId: "claim-row-party-invalid"
    }), false);
  }
  assert.equal(isValidStorageClaimCoinsPayload({
    tokenUuid: "Scene.scene.Token.chest",
    characterTokenUuid: "",
    destination: "party",
    mutationId: "claim-coins-party"
  }), true);
});

test("storage bulk claim payload requires one exact self or party target", () => {
  assert.equal(typeof storageCommands.isValidStorageClaimAllPayload, "function");
  const self = {
    tokenUuid: "Scene.scene.Token.chest",
    characterTokenUuid: "Scene.scene.Token.hero",
    destination: "self",
    target: null,
    ingressPlan: null,
    mutationId: "claim-all-self"
  };
  const party = {
    tokenUuid: "Scene.scene.Token.chest",
    characterTokenUuid: "Scene.scene.Token.hero",
    destination: "party",
    target: { groupActorId: "group-a", folderId: null },
    ingressPlan: storageIngressPlan(),
    mutationId: "claim-all-party",
    path: ["bag-row"]
  };

  assert.equal(storageCommands.isValidStorageClaimAllPayload(self), true);
  assert.equal(storageCommands.isValidStorageClaimAllPayload(party), true);
  for (const payload of [
    { ...self, destination: "scene" },
    { ...self, characterTokenUuid: "" },
    { ...self, target: { groupActorId: "group-a", folderId: null } },
    { ...party, target: null },
    { ...party, target: { groupActorId: " group-a", folderId: null } },
    { ...party, extra: true }
  ]) {
    assert.equal(storageCommands.isValidStorageClaimAllPayload(payload), false);
  }
});

test("party bulk claim delegates all Item rows to one ingress commit while coins bypass descriptors", async () => {
  const harness = createHarness();
  await harness.storageService.open(harness.storageToken);
  const ingressPlan = storageIngressPlan();
  ingressPlan.rows[0].action = { type: "skip" };
  ingressPlan.rows[0].matchedRuleId = "skip-weapons";

  const result = await harness.service.claimAll({
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    destination: "party",
    target: { groupActorId: harness.groupActor.id, folderId: null },
    ingressPlan,
    mutationId: "filtered-storage-bulk"
  }, { sender: harness.player });

  assert.equal(harness.ingressCommitCalls.length, 1);
  assert.equal(harness.itemGrants.length, 0);
  assert.equal(harness.coinGrants.length, 1);
  assert.equal(result.coinsChanged, true);
  assert.deepEqual(result.claimedRowIds, []);
  assert.deepEqual(readStorageState(harness.storageToken).claimedRowIds, []);
  assert.equal(readStorageState(harness.storageToken).coinsClaimed, true);
});

test("bulk claim grants mixed rows, containers, and coins once while skipping Journals", async () => {
  const materializations = [];
  const materialized = new Set();
  const harness = createHarness({
    containerItemService: {
      async materializeToActorOnce(actor, snapshot, mutationId) {
        if (!materialized.has(mutationId)) materializations.push({ actor, snapshot: clone(snapshot), mutationId });
        materialized.add(mutationId);
        return { id: "materialized-bag" };
      }
    }
  });
  const bagRow = buildStorageContainerRow({
    containerId: "bulk-bag",
    storageKind: "bag",
    name: "Походная сумка",
    state: { state: "opened", manualRows: [], generatedRows: [] }
  }, { rowId: "bag-row" });
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [{
      rowId: "manual-row",
      rowKind: "item",
      name: "Верёвка",
      quantity: 2,
      itemData: { name: "Верёвка", type: "loot", system: { quantity: 2 } }
    }, {
      rowKind: "journal",
      rowId: "journal-row",
      sourceId: "JournalEntry.bulk-notes",
      sourceType: "journal",
      name: "Записка",
      quantity: 1
    }, bagRow],
    generatedRows: [{
      rowId: "generated-row",
      rowKind: "item",
      name: "Факел",
      quantity: 3,
      itemData: { name: "Факел", type: "consumable", system: { quantity: 3 } }
    }],
    manualCoins: { gp: 4, sp: 2 }
  });
  const request = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    destination: "self",
    target: null,
    mutationId: "bulk-mixed"
  };

  const first = await harness.service.claimAll(request, { sender: harness.player });
  const retry = await harness.service.claimAll(request, { sender: harness.player });

  assert.deepEqual(retry, first);
  assert.equal(first.changed, true);
  assert.equal(typeof first.state, "string");
  assert.equal(JSON.stringify(first).includes("JournalEntry."), false);
  assert.deepEqual(first.claimedRowIds, ["manual-row", "bag-row", "generated-row"]);
  assert.deepEqual(first.skippedJournalRowIds, ["journal-row"]);
  assert.equal(harness.itemGrants.length, 2);
  assert.equal(materializations.length, 1);
  assert.equal(harness.coinGrants.length, 1);
  assert.equal(harness.itemGrants.every(({ mutationId }) => mutationId.includes(":row:")), true);
  assert.match(materializations[0].mutationId, /:row:bag-row$/u);
  assert.match(harness.coinGrants[0].mutationId, /:coins$/u);
  const state = readStorageState(harness.storageToken);
  assert.deepEqual(state.claimedRowIds, ["manual-row", "bag-row", "generated-row"]);
  assert.equal(state.coinsClaimed, true);
  assert.deepEqual(state.manualRows.filter((row) => row.rowKind === "journal").map((row) => row.rowId), ["journal-row"]);
});

test("concurrent bulk retries with one mutation ID join one target-first execution", async () => {
  const harness = createHarness();
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [{
      rowId: "concurrent-row",
      rowKind: "item",
      name: "Фляга",
      quantity: 1,
      itemData: { name: "Фляга", type: "loot", system: { quantity: 1 } }
    }],
    manualCoins: { sp: 3 }
  });
  const request = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    destination: "self",
    target: null,
    mutationId: "bulk-concurrent-retry"
  };

  const [first, second] = await Promise.all([
    harness.service.claimAll(request, { sender: harness.player }),
    harness.service.claimAll(request, { sender: harness.player })
  ]);

  assert.deepEqual(second, first);
  assert.equal(harness.itemGrants.length, 1);
  assert.equal(harness.coinGrants.length, 1);
  assert.equal(harness.refreshCalls.length, 1);
});

test("sibling-container bulk claims serialize on one root token state", async () => {
  const harness = createHarness();
  const itemBag = (bagId, rowId) => buildStorageContainerRow({
    containerId: bagId,
    storageKind: "bag",
    name: bagId,
    state: {
      state: "opened",
      manualRows: [{
        rowId,
        rowKind: "item",
        name: rowId,
        quantity: 1,
        itemData: { name: rowId, type: "loot", system: { quantity: 1 } }
      }],
      generatedRows: []
    }
  }, { rowId: bagId });
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [itemBag("bag-a", "row-a"), itemBag("bag-b", "row-b")]
  });

  let releaseFirstUpdate;
  let markFirstUpdateStarted;
  let updateCalls = 0;
  const firstUpdateGate = new Promise((resolve) => { releaseFirstUpdate = resolve; });
  const firstUpdateStarted = new Promise((resolve) => { markFirstUpdateStarted = resolve; });
  harness.storageToken.beforeUpdate = async () => {
    updateCalls += 1;
    if (updateCalls === 1) {
      markFirstUpdateStarted();
      await firstUpdateGate;
    }
  };
  const request = (path, mutationId) => ({
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    destination: "self",
    target: null,
    mutationId,
    path: [path]
  });

  const first = harness.service.claimAll(request("bag-a", "bulk-bag-a"), { sender: harness.player });
  await firstUpdateStarted;
  const second = harness.service.claimAll(request("bag-b", "bulk-bag-b"), { sender: harness.player });
  await new Promise((resolve) => setImmediate(resolve));
  releaseFirstUpdate();
  await Promise.all([first, second]);

  assert.deepEqual(readStorageStateAtPath(harness.storageToken, ["bag-a"]).claimedRowIds, ["row-a"]);
  assert.deepEqual(readStorageStateAtPath(harness.storageToken, ["bag-b"]).claimedRowIds, ["row-b"]);
  assert.equal(harness.itemGrants.length, 2);
});

test("bulk claim retry resumes a failed source refresh without duplicate grants", async () => {
  let refreshAttempts = 0;
  const harness = createHarness({
    refreshResult() {
      refreshAttempts += 1;
      if (refreshAttempts === 1) throw new Error("refresh failed once");
      return { deleted: true };
    }
  });
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [{
      rowId: "refresh-row",
      rowKind: "item",
      name: "Кремень",
      quantity: 1,
      itemData: { name: "Кремень", type: "loot", system: { quantity: 1 } }
    }],
    manualCoins: { cp: 2 }
  });
  const request = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    destination: "self",
    target: null,
    mutationId: "bulk-refresh-resume"
  };

  await assert.rejects(
    harness.service.claimAll(request, { sender: harness.player }),
    /refresh failed once/u
  );
  assert.equal(harness.itemGrants.length, 1);
  assert.equal(harness.coinGrants.length, 1);

  const retry = await harness.service.claimAll(request, { sender: harness.player });

  assert.equal(retry.changed, false);
  assert.equal(retry.sourceDeleted, true);
  assert.equal(harness.itemGrants.length, 1);
  assert.equal(harness.coinGrants.length, 1);
  assert.equal(harness.refreshCalls.length, 2);
});

test("cached bulk claims revalidate live access and bind mutation IDs to one exact request", async () => {
  let currentDistance = 5;
  const selfHarness = createHarness({ distance: () => currentDistance });
  await selfHarness.storageService.open(selfHarness.storageToken);
  const selfRequest = {
    tokenUuid: selfHarness.storageToken.uuid,
    characterTokenUuid: selfHarness.characterToken.uuid,
    destination: "self",
    target: null,
    mutationId: "bulk-live-access"
  };
  await selfHarness.service.claimAll(selfRequest, { sender: selfHarness.player });
  currentDistance = 11;
  await assert.rejects(
    selfHarness.service.claimAll(selfRequest, { sender: selfHarness.player }),
    /10 футов/iu
  );

  const partyHarness = createHarness();
  await partyHarness.storageService.open(partyHarness.storageToken);
  const partyRequest = {
    tokenUuid: partyHarness.storageToken.uuid,
    characterTokenUuid: partyHarness.characterToken.uuid,
    destination: "party",
    target: { groupActorId: partyHarness.groupActor.id, folderId: null },
    mutationId: "bulk-bound-target"
  };
  await partyHarness.service.claimAll(partyRequest, { sender: partyHarness.player });
  await assert.rejects(
    partyHarness.service.claimAll({
      ...partyRequest,
      target: { groupActorId: partyHarness.groupActor.id, folderId: "folder-a" }
    }, { sender: partyHarness.player }),
    /mutationId|параметр/iu
  );
});

test("bulk target binding survives an active-GM service restart after partial failure", async () => {
  const harness = createHarness({
    rejectFolderAssignmentOnce: true,
    containerItemService: {
      async materializeToActorOnce() {
        return { id: "durable-bound-bag" };
      }
    }
  });
  const bagRow = buildStorageContainerRow({
    containerId: "durable-bound-bag",
    storageKind: "bag",
    name: "Сумка связного",
    state: { state: "opened", manualRows: [], generatedRows: [] }
  }, { rowId: "durable-bound-row" });
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [bagRow]
  });
  const request = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    destination: "party",
    target: { groupActorId: harness.groupActor.id, folderId: "folder-a" },
    mutationId: "bulk-durable-target"
  };

  await assert.rejects(
    harness.service.claimAll(request, { sender: harness.player }),
    /folder assignment failed/u
  );
  const restartedService = harness.createCommandService();
  await assert.rejects(
    restartedService.claimAll({
      ...request,
      target: { groupActorId: harness.groupActor.id, folderId: null }
    }, { sender: harness.player }),
    /mutationId|параметр/iu
  );
  assert.deepEqual(readStorageState(harness.storageToken).claimedRowIds, []);

  const resumed = await restartedService.claimAll(request, { sender: harness.player });
  assert.equal(resumed.changed, true);
  assert.deepEqual(readStorageState(harness.storageToken).claimedRowIds, ["durable-bound-row"]);
});

test("party bulk claim pins item, folder, and currency grants to the exact group", async () => {
  const harness = createHarness();
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [{
      rowId: "party-row",
      rowKind: "item",
      name: "Карта",
      quantity: 1,
      itemData: { name: "Карта", type: "loot", system: { quantity: 1 } }
    }],
    manualCoins: { gp: 1 }
  });

  await harness.service.claimAll({
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    destination: "party",
    target: { groupActorId: harness.groupActor.id, folderId: "folder-a" },
    mutationId: "bulk-party"
  }, { sender: harness.player });

  assert.deepEqual(harness.itemGrants[0].options, {
    allowPersistedItemData: true,
    groupActorId: harness.groupActor.id,
    folderId: "folder-a"
  });
  assert.deepEqual(harness.coinGrants[0].options, { groupActorId: harness.groupActor.id });
});

test("bulk claim retry resumes after a partial target-first failure without duplicate grants", async () => {
  const materialized = new Set();
  const harness = createHarness({
    rejectFolderAssignmentOnce: true,
    containerItemService: {
      async materializeToActorOnce(_actor, _snapshot, mutationId) {
        materialized.add(mutationId);
        return { id: "bulk-recovery-bag" };
      }
    }
  });
  const bagRow = buildStorageContainerRow({
    containerId: "bulk-recovery-bag",
    storageKind: "bag",
    name: "Сумка",
    state: { state: "opened", manualRows: [], generatedRows: [] }
  }, { rowId: "recovery-bag-row" });
  await harness.storageService.configure(harness.storageToken, {
    state: "opened",
    manualRows: [{
      rowId: "recovery-item-row",
      rowKind: "item",
      name: "Мел",
      quantity: 1,
      itemData: { name: "Мел", type: "loot", system: { quantity: 1 } }
    }, bagRow],
    manualCoins: { cp: 7 }
  });
  const request = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid,
    destination: "party",
    target: { groupActorId: harness.groupActor.id, folderId: "folder-a" },
    mutationId: "bulk-recovery"
  };

  await assert.rejects(harness.service.claimAll(request, { sender: harness.player }), /folder assignment failed/u);
  assert.deepEqual(readStorageState(harness.storageToken).claimedRowIds, ["recovery-item-row"]);
  assert.equal(harness.coinGrants.length, 0);

  const result = await harness.service.claimAll(request, { sender: harness.player });

  assert.equal(result.changed, true);
  assert.deepEqual(result.claimedRowIds, ["recovery-bag-row"]);
  assert.equal(harness.itemGrants.length, 1);
  assert.equal(materialized.size, 1);
  assert.equal(harness.coinGrants.length, 1);
  assert.deepEqual(readStorageState(harness.storageToken).claimedRowIds, [
    "recovery-item-row",
    "recovery-bag-row"
  ]);
});

test("bulk claim reuses storage authorization and the dead-NPC access path", async () => {
  const unauthorized = createHarness();
  await unauthorized.storageService.open(unauthorized.storageToken);
  await assert.rejects(unauthorized.service.claimAll({
    tokenUuid: unauthorized.storageToken.uuid,
    characterTokenUuid: unauthorized.characterToken.uuid,
    destination: "self",
    target: null,
    mutationId: "bulk-unauthorized"
  }, { sender: { id: "stranger", isGM: false } }), /принадлежащего вам персонажа/iu);
  assert.equal(unauthorized.itemGrants.length, 0);

  const corpse = createHarness();
  corpse.storageToken.actor.flags = {};
  corpse.storageToken.actor.system = { attributes: { hp: { value: 0 } } };
  await corpse.storageService.configure(corpse.storageToken, {
    state: "opened",
    manualRows: [{
      rowId: "corpse-row",
      rowKind: "item",
      name: "Кинжал",
      quantity: 1,
      itemData: { name: "Кинжал", type: "weapon", system: { quantity: 1 } }
    }]
  });

  const result = await corpse.service.claimAll({
    tokenUuid: corpse.storageToken.uuid,
    characterTokenUuid: corpse.characterToken.uuid,
    destination: "self",
    target: null,
    mutationId: "bulk-corpse"
  }, { sender: corpse.player });

  assert.equal(result.changed, true);
  assert.equal(corpse.itemGrants.length, 1);
  assert.deepEqual(readStorageState(corpse.storageToken).claimedRowIds, ["corpse-row"]);
});

test("self storage claims still require a character token", () => {
  assert.equal(isValidStorageClaimRowPayload({
    tokenUuid: "Scene.scene.Token.chest",
    characterTokenUuid: "",
    rowId: "row-1",
    destination: "self",
    quantity: 1,
    target: null,
    ingressPlan: null,
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
    target: { groupActorId: harness.groupActor.id, folderId: null },
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
    target: { groupActorId: harness.groupActor.id, folderId: null },
    mutationId: "failed-row"
  }, { sender: harness.player }), /grant failed/u);

  assert.equal(readStorageState(harness.storageToken).generatedRows[0].quantity, 5);
  assert.deepEqual(readStorageState(harness.storageToken).claimedRowIds, []);
});

test("party storage claims re-resolve the exact group and reject unavailable folders before granting", async () => {
  const harness = createHarness();
  const access = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid
  };
  await harness.service.open(access, { sender: harness.player });
  const base = {
    ...access,
    rowId: "row-1",
    destination: "party",
    quantity: 1
  };

  await assert.rejects(harness.service.claimRow({
    ...base,
    target: { groupActorId: "foreign-group", folderId: null },
    mutationId: "foreign-party-target"
  }, { sender: harness.player }), /group target is unavailable/iu);
  await assert.rejects(harness.service.claimRow({
    ...base,
    target: { groupActorId: harness.groupActor.id, folderId: "missing-folder" },
    mutationId: "missing-party-folder"
  }, { sender: harness.player }), /folder.*unavailable/iu);

  assert.equal(harness.itemGrants.length, 0);
  assert.equal(readStorageState(harness.storageToken).generatedRows[0].quantity, 1);
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
    target: { groupActorId: harness.groupActor.id, folderId: null },
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

test("partial party debit survives a lost storage acknowledgement and service restart", async () => {
  const harness = createHarness({ rowQuantity: 5 });
  const access = {
    tokenUuid: harness.storageToken.uuid,
    characterTokenUuid: harness.characterToken.uuid
  };
  await harness.service.open(access, { sender: harness.player });
  const request = {
    ...access,
    rowId: "row-1",
    destination: "party",
    quantity: 2,
    target: { groupActorId: harness.groupActor.id, folderId: null },
    mutationId: "partial-lost-ack"
  };
  const originalUpdate = harness.storageToken.update.bind(harness.storageToken);
  let rejectAfterAppliedDebit = true;
  harness.storageToken.update = async (patch) => {
    const result = await originalUpdate(patch);
    const nextState = patch[`flags.${MODULE_ID}.storage`];
    if (rejectAfterAppliedDebit && nextState?.generatedRows?.[0]?.quantity === 3) {
      rejectAfterAppliedDebit = false;
      throw new Error("storage acknowledgement lost");
    }
    return result;
  };

  await assert.rejects(
    harness.service.claimRow(request, { sender: harness.player }),
    /acknowledgement lost/u
  );
  assert.equal(readStorageState(harness.storageToken).generatedRows[0].quantity, 3);

  const recovered = await harness.createCommandService().claimRow(request, { sender: harness.player });

  assert.equal(recovered.changed, true);
  assert.equal(readStorageState(harness.storageToken).generatedRows[0].quantity, 3);
  assert.equal(harness.itemGrants.length, 1);
});

test("storage row payload validation accepts only exact character and scene targets", () => {
  const base = {
    tokenUuid: "Scene.scene.Token.chest",
    characterTokenUuid: "Scene.scene.Token.hero",
    rowId: "row-1",
    quantity: 1,
    ingressPlan: null,
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
    target: { actorUuid: "Actor.hero" },
    ingressPlan: storageIngressPlan()
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

test("canvas drop creates a ground pile only within ten feet of the character", async () => {
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
    pointDistance: 10,
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

  const far = createHarness({ rowQuantity: 3, pointDistance: 11 });
  await far.storageService.open(far.storageToken);
  await assert.rejects(far.service.claimRow({
    tokenUuid: far.storageToken.uuid,
    characterTokenUuid: far.characterToken.uuid,
    rowId: "row-1",
    destination: "scene",
    quantity: 1,
    target: { sceneId: "scene", x: 800, y: 800 },
    mutationId: "scene-too-far"
  }, { sender: far.player }), /10 фут/iu);
  assert.equal(far.groundCalls.length, 0);
  assert.equal(readStorageState(far.storageToken).generatedRows[0].quantity, 3);
});
