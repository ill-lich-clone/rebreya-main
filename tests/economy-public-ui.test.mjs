import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const moduleApi = {
  async getPublicEconomySnapshot() {
    return {
      cities: [{
        id: "a", name: "Альфа", state: "S", regionId: "r", regionName: "R", cityType: "Порт", image: "a.webp"
      }],
      materialRows: [{
        materialId: "iron", name: "Железо", basePriceGold: 10, baseWeight: 1, worldDeficit: 5, hasWorldDeficit: true
      }]
    };
  },
  async getModel() {
    throw new Error("player context must not request the mechanical model");
  }
};

test("player EconomyApp never requests the mechanical model", async () => {
  const previousFoundry = globalThis.foundry;
  const previousGame = globalThis.game;
  const previousLocalStorage = globalThis.localStorage;
  class TestApplication { constructor() {} async _onRender() {} }
  globalThis.foundry = {
    applications: { api: { ApplicationV2: TestApplication, HandlebarsApplicationMixin: (Base) => Base, DialogV2: {} } }
  };
  globalThis.game = { user: { isGM: false }, settings: { get: () => false }, world: { id: "test" } };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  try {
    const { EconomyApp } = await import(`../scripts/ui/economy-app.js?public-player=${Date.now()}`);
    const context = await new EconomyApp(moduleApi)._prepareContext();
    assert.equal(context.isPublicView, true);
    assert.deepEqual(context.materialRows, [{
      materialId: "iron", name: "Железо", basePriceGold: 10, baseWeight: 1, worldDeficit: 5, hasWorldDeficit: true
    }]);
    assert.equal(Object.hasOwn(context.filters, "sort"), false);
    for (const forbidden of ["summary", "stateOverview", "tradeAuditLog", "activeEvents", "dataSource"]) {
      assert.equal(Object.hasOwn(context, forbidden), false, forbidden);
    }
  }
  finally {
    globalThis.foundry = previousFoundry;
    globalThis.game = previousGame;
    globalThis.localStorage = previousLocalStorage;
  }
});

test("EconomyApp retains the GM model branch and isolates the public template", async () => {
  const [source, template] = await Promise.all([
    readFile(new URL("../scripts/ui/economy-app.js", import.meta.url), "utf8"),
    readFile(new URL("../templates/economy-app.hbs", import.meta.url), "utf8")
  ]);
  assert.match(source, /const model = await this\.moduleApi\.getModel\(\)/u);
  assert.match(source, /this\.moduleApi\.openCityApp\(cityId\)/u);
  const start = template.indexOf("<!-- public-economy:start -->");
  const end = template.indexOf("<!-- public-economy:end -->", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const publicBranch = template.slice(start, end);
  for (const forbidden of [
    "rollback-trade-audit",
    "priceModifierPercent",
    "production",
    "demand",
    "netBalance",
    "open-world-routes",
    "open-global-events"
  ]) {
    assert.equal(publicBranch.includes(forbidden), false, forbidden);
  }
});
