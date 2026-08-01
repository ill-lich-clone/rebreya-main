import test from "node:test";
import assert from "node:assert/strict";

import {
  StorageService,
  deriveStorageDisplayName,
  isStorageActor,
  readStorageState
} from "../scripts/data/storage-service.js";

function createStorageToken(id, name = "Сундук") {
  const flags = {};
  return {
    id,
    name,
    flags,
    getFlag(scope, key) {
      return flags[scope]?.[key];
    },
    async update(update) {
      const [scope, key] = String(Object.keys(update)[0] ?? "")
        .replace(/^flags\./u, "")
        .split(".");
      flags[scope] = flags[scope] ?? {};
      flags[scope][key] = update[Object.keys(update)[0]];
      if (update.name) {
        this.name = update.name;
      }
      return this;
    }
  };
}

test("two storage tokens using one actor keep independent template snapshots", async () => {
  const service = new StorageService();
  const first = createStorageToken("first");
  const second = createStorageToken("second");

  await service.configure(first, {
    baseName: "Сундук",
    template: { name: "Простой", form: { itemCount: 1 } }
  });

  assert.equal(readStorageState(first).template.name, "Простой");
  assert.equal(readStorageState(first).template.form.itemCount, 1);
  assert.equal(readStorageState(second).template, null);
});

test("opening once merges manual rows and a generated result", async () => {
  let generationCount = 0;
  const service = new StorageService({
    generate: async () => {
      generationCount += 1;
      return {
        rows: [{ rowId: "generated" }],
        coins: { gp: 2 }
      };
    }
  });
  const token = createStorageToken("chest");

  await service.configure(token, { manualRows: [{ rowId: "manual" }] });
  const first = await service.open(token, {});
  const second = await service.open(token, {});

  assert.deepEqual(first.rows.map((row) => row.rowId), ["manual", "generated"]);
  assert.equal(first.coins.gp, 2);
  assert.equal(first.generatedNow, true);
  assert.equal(second.generatedNow, false);
  assert.equal(generationCount, 1);
});

test("storage actor marker and empty display name use Rebreya-owned flags", () => {
  assert.equal(isStorageActor({
    flags: {
      "rebreya-main": {
        storage: { enabled: true }
      }
    }
  }), true);
  assert.equal(deriveStorageDisplayName({ baseName: "Бочка", state: "empty" }), "Бочка (пусто)");
});
