import assert from "node:assert/strict";
import test from "node:test";

import { PurchaseBasketJournalRepository } from "../scripts/infrastructure/foundry/purchase-basket-journal-repository.js";

test("purchase basket journal persists phase records through the canonical world repository", async () => {
  const calls = [];
  let state = { version: 1, records: [] };
  const worldSettingMutationRepository = {
    readObject(key) {
      calls.push(["read", key]);
      return structuredClone(state);
    },
    async replaceObject(key, next) {
      calls.push(["replace", key]);
      state = structuredClone(next);
    }
  };
  const repository = new PurchaseBasketJournalRepository({ worldSettingMutationRepository });

  await repository.start({ id: "purchase-1", phase: "prepared", fingerprint: "fp" });
  await repository.checkpoint("purchase-1", "prepared", "items-applied", { itemUuids: ["Actor.a.Item.i"] });
  await repository.finish("purchase-1", { status: "committed" });

  const record = await repository.find("purchase-1");
  assert.equal(record.phase, "items-applied");
  assert.equal(record.terminal, true);
  assert.deepEqual(record.result, { status: "committed" });
  assert.ok(calls.every(([, key]) => key === "purchaseBasketJournal"));
});
