import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import { StorageService, readStorageState } from "../scripts/data/storage-service.js";
import {
  StorageCommandService,
  isValidStorageClaimCoinsPayload,
  isValidStorageClaimRowPayload,
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

function createHarness({ distance = 5, visible = true } = {}) {
  const player = { id: "player", isGM: false };
  const hero = {
    id: "hero",
    type: "character",
    testUserPermission: (user, permission) => user?.id === player.id && permission === "OWNER"
  };
  const scene = { id: "scene" };
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
    [storageToken.uuid, storageToken]
  ]);
  const itemGrants = [];
  const coinGrants = [];
  const completed = new Set();
  const inventoryService = {
    async addLootgenRowToCharacterOnce(row, actor, mutationId) {
      if (!completed.has(mutationId)) itemGrants.push({ row: clone(row), actor, mutationId, destination: "self" });
      completed.add(mutationId);
    },
    async addLootgenRowToInventoryOnce(row, mutationId) {
      if (!completed.has(mutationId)) itemGrants.push({ row: clone(row), mutationId, destination: "party" });
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
        quantity: 1,
        itemData: { name: "Меч", type: "weapon", system: { quantity: 1 } }
      }],
      coins: { gp: 2 }
    })
  });
  const service = new StorageCommandService({
    storageService,
    inventoryService,
    resolveToken: async (uuid) => documents.get(uuid) ?? null,
    measureDistance: () => distance,
    isVisibleTo: () => visible
  });

  return { player, hero, characterToken, storageToken, storageService, service, itemGrants, coinGrants };
}

test("storage claim rejects a player outside five feet before granting an item", async () => {
  const harness = createHarness({ distance: 10, visible: true });
  await harness.storageService.open(harness.storageToken);

  await assert.rejects(
    harness.service.claimRow({
      tokenUuid: harness.storageToken.uuid,
      characterTokenUuid: harness.characterToken.uuid,
      rowId: "row-1",
      destination: "self",
      mutationId: "claim-1"
    }, { sender: harness.player }),
    /5 фут/iu
  );
  assert.equal(harness.itemGrants.length, 0);
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
  assert.equal(harness.coinGrants.length, 1);
  assert.equal(readStorageState(harness.storageToken).state, "empty");
  assert.equal(harness.storageToken.name, "Сундук (пусто)");
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
