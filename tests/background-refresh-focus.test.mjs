import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cases = [
  ["trader-app-v2.js", "this.#playSequencerEntrance"],
  ["lootgen-app.js", "element.querySelectorAll"]
];

for (const [fileName, firstInteractiveWork] of cases) {
  test(`${fileName} background render does not bring its window to front`, async () => {
    const source = await readFile(new URL(`../scripts/ui/${fileName}`, import.meta.url), "utf8");
    const renderStart = source.indexOf("async _onRender");
    const renderEnd = source.indexOf(firstInteractiveWork, renderStart);
    assert.notEqual(renderStart, -1);
    assert.notEqual(renderEnd, -1);

    const renderMethod = source.slice(renderStart, renderEnd);
    assert.equal(renderMethod.includes("bringAppToFront(this)"), false);
  });
}

test("explicit trader and loot generator opens still bring their windows to front", async () => {
  const source = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
  for (const methodName of ["openLootgenApp", "openTraderV2"]) {
    const methodStart = source.indexOf(`async ${methodName}`);
    const methodEnd = source.indexOf("\n  async ", methodStart + 1);
    assert.notEqual(methodStart, -1);
    assert.equal(source.slice(methodStart, methodEnd).includes("bringAppToFront(app)"), true, methodName);
  }
});

test("legacy trader entry points delegate to Trader V2 without a second app registry", async () => {
  const source = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");
  const openTraderStart = source.indexOf("async openTrader(");
  const openTraderEnd = source.indexOf("\n  async ", openTraderStart + 1);
  const openSheetStart = source.indexOf("async openTraderSheet(");
  const openSheetEnd = source.indexOf("\n  async ", openSheetStart + 1);

  assert.match(source.slice(openTraderStart, openTraderEnd), /return this\.openTraderV2\(cityId, traderKey, options\)/u);
  assert.match(source.slice(openSheetStart, openSheetEnd), /return this\.openTraderV2\(cityId, traderKey, options\)/u);
  assert.doesNotMatch(source, /traderApps/u);
  assert.doesNotMatch(source, /ui\/trader-app\.js/u);
});

test("city trader buttons use the canonical Trader V2 route only", async () => {
  const [source, template] = await Promise.all([
    readFile(new URL("../scripts/ui/city-app.js", import.meta.url), "utf8"),
    readFile(new URL("../templates/city-app.hbs", import.meta.url), "utf8")
  ]);

  assert.doesNotMatch(source, /openTraderV2/u);
  assert.doesNotMatch(source, /open-trader-new/u);
  assert.doesNotMatch(template, /open-trader-new/u);
});
