import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cases = [
  ["trader-app.js", "const inventoryByKey"],
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
  for (const methodName of ["openLootgenApp", "openTrader", "openTraderV2"]) {
    const methodStart = source.indexOf(`async ${methodName}`);
    const methodEnd = source.indexOf("\n  async ", methodStart + 1);
    assert.notEqual(methodStart, -1);
    assert.equal(source.slice(methodStart, methodEnd).includes("bringAppToFront(app)"), true, methodName);
  }
});
