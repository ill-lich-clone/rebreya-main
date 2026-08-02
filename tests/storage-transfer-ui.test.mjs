import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStorageDragData,
  parseStorageDragData,
  promptStorageTransferQuantity,
  storageGridColumns
} from "../scripts/ui/storage-transfer-ui.js";

test("storage drag payload round-trips only the authoritative row reference", () => {
  const payload = buildStorageDragData({
    tokenUuid: "Scene.scene.Token.chest",
    rowId: "row-1",
    quantity: 4
  });

  assert.deepEqual(parseStorageDragData(JSON.stringify(payload)), {
    type: "RebreyaStorageClaim",
    tokenUuid: "Scene.scene.Token.chest",
    rowId: "row-1",
    quantity: 4
  });
  assert.equal(parseStorageDragData("{}"), null);
  assert.equal(parseStorageDragData({ ...payload, quantity: 0 }), null);
});

test("storage grid keeps three columns through six entries and grows near-square", () => {
  assert.equal(storageGridColumns(1), 3);
  assert.equal(storageGridColumns(6), 3);
  assert.equal(storageGridColumns(7), 4);
  assert.equal(storageGridColumns(10), 4);
  assert.equal(storageGridColumns(13), 5);
});

test("quantity prompt bypasses one item, supports cancellation, and validates bounds", async () => {
  let prompts = 0;
  assert.equal(await promptStorageTransferQuantity(1, {
    prompt: async () => { prompts += 1; return 1; }
  }), 1);
  assert.equal(prompts, 0);

  assert.equal(await promptStorageTransferQuantity(5, {
    prompt: async ({ max, value }) => {
      prompts += 1;
      assert.equal(max, 5);
      assert.equal(value, 5);
      return null;
    }
  }), null);
  assert.equal(prompts, 1);

  await assert.rejects(
    promptStorageTransferQuantity(5, { prompt: async () => 6 }),
    /Количество/u
  );
});
