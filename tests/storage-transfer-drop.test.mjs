import test from "node:test";
import assert from "node:assert/strict";

import {
  handleStorageActorSheetDrop,
  handleStorageCanvasDrop,
  registerStorageTransferDropHooks,
  transferPortableStorageItemDropToCanvas,
  transferStorageDropToCanvas,
  transferStorageDropToCharacter
} from "../scripts/integrations/storage-transfer-drop.js";
import { STORAGE_DRAG_TYPE } from "../scripts/ui/storage-transfer-ui.js";

const storageDrop = {
  type: STORAGE_DRAG_TYPE,
  tokenUuid: "Scene.scene.Token.chest",
  rowId: "row-1",
  quantity: 5
};

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

test("drop hooks consume only Rebreya storage payloads", () => {
  const registrations = new Map();
  const Hooks = { on(name, handler) { registrations.set(name, handler); } };
  assert.equal(registerStorageTransferDropHooks({}, { Hooks }), true);
  assert.equal(registerStorageTransferDropHooks({}, { Hooks }), false);

  assert.equal(registrations.get("dropActorSheetData")(
    { type: "character", uuid: "Actor.hero" }, {}, { type: "Item", uuid: "Item.sword" }
  ), true);
  assert.equal(registrations.get("dropCanvasData")(
    { scene: { id: "scene" } }, { type: "Item", uuid: "Item.sword", x: 1, y: 2 }
  ), true);

  assert.equal(handleStorageActorSheetDrop(
    { type: "character", uuid: "Actor.hero" }, { ...storageDrop, quantity: 1 },
    { claimStorageRow: async () => ({ changed: true }) }
  ), false);
  assert.equal(handleStorageCanvasDrop(
    { scene: { id: "scene" } }, { ...storageDrop, quantity: 1, x: 1, y: 2 },
    { claimStorageRow: async () => ({ changed: true }) }
  ), false);
});
