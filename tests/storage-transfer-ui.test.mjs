import test from "node:test";
import assert from "node:assert/strict";
import * as storageTransferUi from "../scripts/ui/storage-transfer-ui.js";

import {
  buildStorageDragData,
  parseStorageDragData,
  promptStorageTransferQuantity,
  storageGridColumns
} from "../scripts/ui/storage-transfer-ui.js";

test("storage drag payload round-trips only the authoritative row reference", () => {
  const payload = buildStorageDragData({
    tokenUuid: "Scene.scene.Token.chest",
    path: ["bag-row"],
    rowId: "row-1",
    quantity: 4
  });

  assert.deepEqual(parseStorageDragData(JSON.stringify(payload)), {
    type: "RebreyaStorageClaim",
    tokenUuid: "Scene.scene.Token.chest",
    path: ["bag-row"],
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

test("coin quantity prompt is unbounded for templates and bounded for embedded stacks", async () => {
  assert.equal(typeof storageTransferUi.promptStorageCoinQuantity, "function");
  const { promptStorageCoinQuantity } = storageTransferUi;
  const seen = [];
  assert.equal(await promptStorageCoinQuantity(null, {
    prompt: async (options) => {
      seen.push(options);
      return Number.MAX_SAFE_INTEGER;
    }
  }), Number.MAX_SAFE_INTEGER);
  assert.deepEqual(seen, [{ max: null, value: 1 }]);

  assert.equal(await promptStorageCoinQuantity(null, { prompt: async () => null }), null);
  for (const invalid of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      promptStorageCoinQuantity(null, { prompt: async () => invalid }),
      /Количество/u
    );
  }
  assert.equal(await promptStorageCoinQuantity(5, { prompt: async () => 5 }), 5);
  await assert.rejects(
    promptStorageCoinQuantity(5, { prompt: async () => 6 }),
    /Количество/u
  );
});
