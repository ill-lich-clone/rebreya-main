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

test("concurrent cold readers share one dataset load and one model", async (t) => {
  const original = { game: globalThis.game, foundry: globalThis.foundry, fetch: globalThis.fetch };
  t.after(() => Object.assign(globalThis, original));
  const gate = Promise.withResolvers();
  const paths = [];
  globalThis.game = { settings: { get: () => undefined } };
  globalThis.foundry = { utils: { deepClone: structuredClone } };
  globalThis.fetch = async path => { paths.push(path); await gate.promise; return { ok: true, json: async () => [] }; };
  const repository = new EconomyRepository();
  const readers = Array.from({ length: 6 }, () => repository.load());
  gate.resolve();
  const models = await Promise.all(readers);
  assert.equal(paths.length, 9);
  assert.ok(models.every(model => model === repository.model));
  await repository.reload();
  assert.equal(paths.length, 18);
});

test("a forced reload supersedes an older load and failed loads can be retried", async (t) => {
  const original = { game: globalThis.game, foundry: globalThis.foundry, fetch: globalThis.fetch };
  t.after(() => Object.assign(globalThis, original));
  const slow = Promise.withResolvers();
  let batch = "old";
  globalThis.game = { settings: { get: () => undefined } };
  globalThis.foundry = { utils: { deepClone: structuredClone } };
  globalThis.fetch = async path => {
    const name = batch;
    if (name === "old") await slow.promise;
    if (name === "failed") throw new Error("dataset unavailable");
    const rows = path.endsWith("/cities.json") ? [{ id: name, name }] : [];
    return { ok: true, json: async () => rows };
  };
  const repository = new EconomyRepository();
  const older = repository.load();
  batch = "new";
  const current = await repository.reload();
  assert.equal(await older, current);
  slow.resolve();
  await new Promise(setImmediate);
  assert.equal(repository.model.cities[0].id, "new");
  batch = "failed";
  await assert.rejects(repository.reload(), /dataset unavailable/u);
  assert.equal(await repository.load(), current);
  batch = "retried";
  assert.equal((await repository.reload()).cities[0].id, "retried");
});
