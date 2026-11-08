import assert from "node:assert/strict";
import test from "node:test";
import { EconomyRepository } from "../scripts/data/repository.js";

test("economy reuses the baseline model with disabled events and still applies active events", async (t) => {
  const policies = {};
  let builds = 0;
  const restore = Object.fromEntries(["game", "foundry", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of Object.entries(restore)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  globalThis.game = { settings: { get: () => undefined } };
  globalThis.foundry = { utils: { deepClone(value) { if (value === policies) builds++; return structuredClone(value); } } };
  globalThis.fetch = async path => ({
    ok: true,
    json: async () => ({
      "cities.json": [{ id: "test-city", name: "Test City" }],
      "goods.json": [{ id: "grain", name: "Grain" }],
      "reference.json": {}
    })[path.split("/").at(-1)] ?? []
  });
  const repository = new EconomyRepository();
  repository.getStatePolicies = () => policies;
  const base = await repository.load();
  assert.equal(builds, 1);

  builds = 0;
  repository.setGlobalEventsService({ collectEconomicModifiers: () => ({ enabled: false }) });
  assert.equal(builds, 1);
  assert.deepEqual(repository.model, base);

  builds = 0;
  const event = { id: "festival", name: "Festival" };
  repository.setGlobalEventsService({
    collectEconomicModifiers: () => ({
      enabled: true,
      activeEvents: [event],
      cityEventsByCityId: { "test-city": [event] },
      cityGoodEffectsByCityId: {
        "test-city": { grain: { priceEffects: [{ event: { stacking: { mode: "stack" } }, effect: { mode: "addPercent", value: 0.25 } }] } }
      }
    })
  });
  assert.equal(builds, 2);
  assert.deepEqual(repository.model.cityById.get("test-city").activeEventNames, ["Festival"]);
  assert.equal(repository.model.cityById.get("test-city").goodsRows[0].eventPriceModifierPercent, 0.25);
  assert.deepEqual(repository.model.globalEvents.activeEvents, [event]);
});
