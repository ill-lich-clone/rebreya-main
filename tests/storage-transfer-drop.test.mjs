import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  handleStorageActorSheetDrop,
  handleStorageCanvasDrop,
  registerStorageTransferDropHooks,
  transferFoundryItemDropToCanvas,
  transferFoundryJournalDropToCanvas,
  transferPortableStorageItemDropToCanvas,
  transferStorageDropToCanvas,
  transferStorageDropToCharacter
} from "../scripts/integrations/storage-transfer-drop.js";
import { STORAGE_DRAG_TYPE } from "../scripts/ui/storage-transfer-ui.js";
import { createDnd5eItemData } from "../scripts/data/gear-compendium.js";
import { resolveStorageDepositSource } from "../scripts/data/storage-deposit-source.js";

globalThis.CONST ??= { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };

const storageDrop = {
  type: STORAGE_DRAG_TYPE,
  tokenUuid: "Scene.scene.Token.chest",
  rowId: "row-1",
  quantity: 5
};

test("NotesLayer leaves JournalEntry and JournalEntryPage drops entirely to Foundry", async () => {
  const calls = [];
  const notes = {};
  const canvas = { notes, activeLayer: notes, scene: { id: "scene" } };
  const handled = handleStorageCanvasDrop(canvas, {
    type: "JournalEntry", uuid: "JournalEntry.notes", x: 120, y: 180
  }, {
    async dropStorageJournalToScene(...args) { calls.push(args); }
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(handled, true);
  assert.equal(handleStorageCanvasDrop(canvas, {
    type: "JournalEntryPage", uuid: "JournalEntry.notes.JournalEntryPage.page", x: 120, y: 180
  }, {
    async dropStorageJournalToScene(...args) { calls.push(args); }
  }), true);
  assert.deepEqual(calls, []);
});

test("non-Notes layers route JournalEntry drops only to the Journal scene API", async () => {
  const calls = [];
  const canvas = { notes: {}, activeLayer: {}, scene: { id: "scene" } };
  assert.equal(handleStorageCanvasDrop(canvas, {
    type: "JournalEntry", uuid: "JournalEntry.notes", x: 120, y: 180
  }, {
    async dropStorageJournalToScene(...args) {
      calls.push(args);
      return { changed: true };
    }
  }), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [["JournalEntry.notes", {
    documentName: "JournalEntry", sceneId: "scene", x: 120, y: 180
  }]]);
});

test("non-Notes layers route JournalEntryPage drops to the same scene API", async () => {
  const canvas = { notes: {}, activeLayer: {}, scene: { id: "scene" } };
  const calls = [];
  assert.equal(handleStorageCanvasDrop(canvas, {
    type: "JournalEntryPage", uuid: "JournalEntry.notes.JournalEntryPage.page", x: 1, y: 2
  }, { async dropStorageJournalToScene(...args) { calls.push(args); } }), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [["JournalEntry.notes.JournalEntryPage.page", {
    documentName: "JournalEntryPage", sceneId: "scene", x: 1, y: 2
  }]]);
});

test("malformed Journal drag data preserves Foundry behavior", () => {
  const canvas = { notes: {}, activeLayer: {}, scene: { id: "scene" } };
  assert.equal(handleStorageCanvasDrop(canvas, {
    type: "JournalEntry", uuid: "", x: 1, y: 2
  }, {}), true);
});

test("Journal scene helper validates the exact drop point before calling the API", async () => {
  const calls = [];
  const result = await transferFoundryJournalDropToCanvas(
    { scene: { id: "scene" } },
    { type: "JournalEntry", uuid: "JournalEntry.notes", x: 120, y: 180 },
    { async dropStorageJournalToScene(...args) { calls.push(args); return { changed: true }; } }
  );

  assert.deepEqual(result, { handled: true, result: { changed: true } });
  assert.deepEqual(calls, [["JournalEntry.notes", {
    documentName: "JournalEntry", sceneId: "scene", x: 120, y: 180
  }]]);
  await assert.rejects(
    transferFoundryJournalDropToCanvas(
      { scene: { id: "scene" } },
      { type: "JournalEntry", uuid: "JournalEntry.notes", x: Number.NaN, y: 180 },
      { async dropStorageJournalToScene() { throw new Error("must not call"); } }
    ),
    /Не удалось определить место/u
  );
});

test("character sheet drop asks quantity and targets that character", async () => {
  const calls = [];
  const actor = { type: "character", uuid: "Actor.hero" };
  const result = await transferStorageDropToCharacter(actor, storageDrop, {
    async claimStorageRow(...args) { calls.push(args); return { changed: true }; }
  }, { prompt: async ({ max }) => max - 2 });

  assert.equal(result.quantity, 3);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), [storageDrop.tokenUuid, storageDrop.rowId, "character"]);
  assert.match(calls[0][3], /^storage-drop-/u);
  assert.deepEqual(calls[0][4], { quantity: 3, target: { actorUuid: actor.uuid } });
});

test("canvas drop targets the exact scene point and cancellation preserves source", async () => {
  const calls = [];
  const canvas = { scene: { id: "scene" } };
  const data = { ...storageDrop, x: 240, y: 360 };
  const api = { async claimStorageRow(...args) { calls.push(args); } };

  const moved = await transferStorageDropToCanvas(canvas, data, api, { prompt: async () => 2 });
  assert.equal(moved.quantity, 2);
  assert.deepEqual(calls[0][4], {
    quantity: 2,
    target: { sceneId: "scene", x: 240, y: 360 }
  });

  const cancelled = await transferStorageDropToCanvas(canvas, data, api, { prompt: async () => null });
  assert.equal(cancelled.cancelled, true);
  assert.equal(calls.length, 1);
});

test("canvas drop on a character token moves the storage row to that character", async () => {
  const calls = [];
  const actor = { type: "character", uuid: "Actor.hero" };
  const canvas = {
    scene: { id: "scene", grid: { size: 100 } },
    grid: { size: 100 },
    tokens: {
      placeables: [{
        visible: true,
        actor,
        document: { x: 200, y: 300, width: 1, height: 1 }
      }]
    }
  };
  const data = { ...storageDrop, quantity: 1, x: 240, y: 360 };

  const result = await transferStorageDropToCanvas(canvas, data, {
    async claimStorageRow(...args) { calls.push(args); return { changed: true }; }
  }, { prompt: async () => 1 });

  assert.equal(result.handled, true);
  assert.deepEqual(calls[0].slice(0, 3), [storageDrop.tokenUuid, storageDrop.rowId, "character"]);
  assert.deepEqual(calls[0][4], {
    quantity: 1,
    target: { actorUuid: actor.uuid }
  });
});

test("portable dnd5e container Item drops restore a storage token on the scene", async () => {
  const calls = [];
  const result = await transferPortableStorageItemDropToCanvas(
    { scene: { id: "scene" } },
    { type: "Item", uuid: "Actor.hero.Item.bag", x: 120, y: 180 },
    {
      async dropPortableStorageItemToScene(...args) {
        calls.push(args);
        return { changed: true, tokenUuid: "Scene.scene.Token.bag" };
      }
    },
    {
      resolveUuid: async () => ({
        type: "container",
        flags: {
          "rebreya-main": {
            storageContainer: {
              containerId: "bag-1",
              storageKind: "bag",
              name: "Сумка",
              state: { baseName: "Сумка", state: "opened", manualRows: [], generatedRows: [] }
            }
          }
        }
      })
    }
  );

  assert.equal(result.handled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "Actor.hero.Item.bag");
  assert.deepEqual(calls[0][1], { sceneId: "scene", x: 120, y: 180 });
});

test("ordinary inventory and compendium Items drop onto the exact scene point", async () => {
  const calls = [];
  const api = {
    async inspectStorageDepositSource(source) {
      assert.deepEqual(source, { kind: "item", itemUuid: "Actor.hero.Item.arrow" });
      return { available: 5 };
    },
    async dropStorageItemToScene(...args) {
      calls.push(args);
      return { changed: true };
    }
  };

  const result = await transferFoundryItemDropToCanvas(
    { scene: { id: "scene" } },
    { type: "Item", uuid: "Actor.hero.Item.arrow", x: 240, y: 360 },
    api,
    { prompt: async ({ max }) => max - 2 }
  );

  assert.equal(result.handled, true);
  assert.equal(result.quantity, 3);
  assert.deepEqual(calls[0][0], "Actor.hero.Item.arrow");
  assert.deepEqual(calls[0][1], { sceneId: "scene", x: 240, y: 360, quantity: 3 });
});

test("managed Coin Items route only to the physical currency pile API", async () => {
  const coinCalls = [];
  const itemCalls = [];
  const result = await transferFoundryItemDropToCanvas(
    { scene: { id: "scene" } },
    { type: "Item", uuid: "Compendium.world.rebreya-gear.Item.gold-template", x: 240, y: 360 },
    {
      async inspectStorageDepositSource(source) {
        assert.deepEqual(source, {
          kind: "item",
          itemUuid: "Compendium.world.rebreya-gear.Item.gold-template"
        });
        return { kind: "coin-template", denomination: "gp", available: null, mode: "copy" };
      },
      async dropStorageCoinsToScene(...args) { coinCalls.push(args); return { changed: true }; },
      async dropStorageItemToScene(...args) { itemCalls.push(args); return { changed: true }; }
    },
    { prompt: async ({ max, value }) => {
      assert.equal(max, null);
      assert.equal(value, 1);
      return 25;
    } }
  );

  assert.equal(result.handled, true);
  assert.equal(result.quantity, 25);
  assert.deepEqual(coinCalls, [["Compendium.world.rebreya-gear.Item.gold-template", "gp", {
    sceneId: "scene",
    x: 240,
    y: 360,
    quantity: 25
  }]]);
  assert.deepEqual(itemCalls, []);
});

test("the synced gear-compendium gold row reaches manual coin API without an Item route", async () => {
  const gear = JSON.parse(readFileSync(new URL("../data/gear.json", import.meta.url), "utf8").replace(/^\uFEFF/u, ""));
  const sourceRow = gear.find((item) => item.id === "zolotaya-moneta");
  const itemData = createDnd5eItemData(sourceRow, new Map([["Сокровища", "treasure-folder"]]));
  const item = {
    ...itemData,
    id: itemData._id,
    uuid: `Compendium.world.rebreya-gear.Item.${itemData._id}`,
    documentName: "Item",
    parent: null,
    pack: "world.rebreya-gear",
    toObject() { return structuredClone(itemData); }
  };
  const coinCalls = [];
  const itemCalls = [];

  await transferFoundryItemDropToCanvas(
    { scene: { id: "scene" } },
    { type: "Item", uuid: item.uuid, x: 240, y: 360 },
    {
      async inspectStorageDepositSource(sourceRef) {
        const source = await resolveStorageDepositSource(sourceRef, { fromUuid: async () => item });
        return {
          kind: source.kind,
          denomination: source.denomination,
          available: source.available,
          mode: source.mode
        };
      },
      async dropStorageCoinsToScene(...args) { coinCalls.push(args); return { changed: true }; },
      async dropStorageItemToScene(...args) { itemCalls.push(args); return { changed: true }; }
    },
    { prompt: async () => 100 }
  );

  assert.equal(itemData.flags["rebreya-main"].sourceType, "gear");
  assert.deepEqual(itemData.flags["rebreya-main"].storageCoinTemplate, {
    version: 1,
    denomination: "gp"
  });
  assert.deepEqual(coinCalls, [[item.uuid, "gp", {
    sceneId: "scene",
    x: 240,
    y: 360,
    quantity: 100
  }]]);
  assert.deepEqual(itemCalls, []);
});

test("ordinary native dnd5e containers are accepted as whole scene drops", async () => {
  const calls = [];
  const result = await transferFoundryItemDropToCanvas(
    { scene: { id: "scene" } },
    { type: "Item", uuid: "Actor.hero.Item.backpack", x: 120, y: 180 },
    {
      async inspectStorageDepositSource() { return { available: 1 }; },
      async dropStorageItemToScene(...args) { calls.push(args); return { changed: true }; }
    },
    { prompt: async ({ max }) => max }
  );

  assert.equal(result.handled, true);
  assert.equal(result.quantity, 1);
  assert.deepEqual(calls[0][1], { sceneId: "scene", x: 120, y: 180, quantity: 1 });
});

test("drop hooks consume Rebreya storage payloads and every Foundry Item on canvas", () => {
  const registrations = new Map();
  const Hooks = { on(name, handler) { registrations.set(name, handler); } };
  const moduleApi = {
    async inspectStorageDepositSource() { return { available: 1 }; },
    async dropStorageItemToScene() { return { changed: true }; }
  };
  assert.equal(registerStorageTransferDropHooks(moduleApi, { Hooks }), true);
  assert.equal(registerStorageTransferDropHooks(moduleApi, { Hooks }), false);

  assert.equal(registrations.get("dropActorSheetData")(
    { type: "character", uuid: "Actor.hero" }, {}, { type: "Item", uuid: "Item.sword" }
  ), true);
  assert.equal(registrations.get("dropCanvasData")(
    { scene: { id: "scene" } }, { type: "Item", uuid: "Item.sword", x: 1, y: 2 }
  ), false);

  assert.equal(handleStorageActorSheetDrop(
    { type: "character", uuid: "Actor.hero" }, { ...storageDrop, quantity: 1 },
    { claimStorageRow: async () => ({ changed: true }) }
  ), false);
  assert.equal(handleStorageCanvasDrop(
    { scene: { id: "scene" } }, { ...storageDrop, quantity: 1, x: 1, y: 2 },
    { claimStorageRow: async () => ({ changed: true }) }
  ), false);
});
