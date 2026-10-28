import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { patchDnd5eTooltipRaceGuard } from "../scripts/integrations/dnd5e-tooltip-compat.js";
import * as compat from "../scripts/integrations/dnd5e-tooltip-compat.js";

function createGame(original, { element = null } = {}) {
  return {
    system: { id: "dnd5e" },
    tooltip: { element },
    dnd5e: {
      tooltips: {
        _onHoverContentLink: original
      }
    }
  };
}

test("dnd5e tooltip guard suppresses only the stale null dataset race", async () => {
  const staleRace = new TypeError("Cannot read properties of null (reading 'dataset')");
  const game = createGame(async () => {
    throw staleRace;
  });

  assert.equal(patchDnd5eTooltipRaceGuard({ gameProvider: () => game }), true);
  await assert.doesNotReject(() => game.dnd5e.tooltips._onHoverContentLink({}));
});

test("dnd5e tooltip guard preserves unrelated failures", async () => {
  const unrelated = new TypeError("Cannot read properties of null (reading 'classList')");
  const game = createGame(async () => {
    throw unrelated;
  });

  patchDnd5eTooltipRaceGuard({ gameProvider: () => game });
  await assert.rejects(
    () => game.dnd5e.tooltips._onHoverContentLink({}),
    error => error === unrelated
  );
});

test("dnd5e tooltip guard does not suppress dataset failures while a tooltip target exists", async () => {
  const activeFailure = new TypeError("Cannot read properties of null (reading 'dataset')");
  const game = createGame(async () => {
    throw activeFailure;
  }, { element: { dataset: {} } });

  patchDnd5eTooltipRaceGuard({ gameProvider: () => game });
  await assert.rejects(
    () => game.dnd5e.tooltips._onHoverContentLink({}),
    error => error === activeFailure
  );
});

test("dnd5e tooltip guard is idempotent and ignores unsupported runtimes", () => {
  const original = async () => "ok";
  const game = createGame(original);

  assert.equal(patchDnd5eTooltipRaceGuard({ gameProvider: () => game }), true);
  const wrapped = game.dnd5e.tooltips._onHoverContentLink;
  assert.equal(patchDnd5eTooltipRaceGuard({ gameProvider: () => game }), false);
  assert.equal(game.dnd5e.tooltips._onHoverContentLink, wrapped);

  assert.equal(patchDnd5eTooltipRaceGuard({ gameProvider: () => ({ system: { id: "pf2e" } }) }), false);
});

test("missing tooltip document does not call richTooltip handler, valid documents still do", async () => {
  const calls = [];
  const game = createGame(async doc => { calls.push(doc); return doc.richTooltip(); }, { element: { dataset: {} } });
  patchDnd5eTooltipRaceGuard({ gameProvider: () => game });
  await assert.doesNotReject(() => game.dnd5e.tooltips._onHoverContentLink(null));
  await assert.doesNotReject(() => game.dnd5e.tooltips._onHoverContentLink(undefined));
  assert.deepEqual(calls, []);
  const doc = { richTooltip: () => "content" };
  assert.equal(await game.dnd5e.tooltips._onHoverContentLink(doc), "content");
  assert.deepEqual(calls, [doc]);
});

test("inventory resize runs once on the next frame with latest entries and skips detached elements", () => {
  const frames = [], calls = [];
  class Inventory { _onResize(entries) { calls.push({ owner: this, entries }); } }
  const game = { system: { id: "dnd5e" } };
  const options = { gameProvider: () => game, customElementsProvider: () => ({ get: name => name === "dnd5e-inventory" ? Inventory : null }) };
  assert.equal(compat.patchDnd5eInventoryResizeGuard?.(options), true);
  assert.equal(compat.patchDnd5eInventoryResizeGuard(options), false);
  const instance = new Inventory();
  instance.isConnected = true;
  instance.ownerDocument = { defaultView: { requestAnimationFrame: callback => { frames.push(callback); return frames.length; } } };
  instance._onResize([{ width: 300 }]); instance._onResize([{ width: 400 }]);
  assert.deepEqual(calls, []); assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(calls.length, 1); assert.equal(calls[0].owner, instance);
  assert.deepEqual(calls[0].entries, [{ width: 400 }]);
  instance._onResize([{ width: 500 }]); instance.isConnected = false; frames.shift()();
  assert.equal(calls.length, 1);
  assert.equal(compat.patchDnd5eInventoryResizeGuard({ gameProvider: () => ({ system: { id: "pf2e" } }) }), false);
});

test("inventory without animation frames preserves connected fallback and skips detached nodes", () => {
  const calls = [];
  class Inventory { _onResize(entries) { calls.push(entries); } }
  compat.patchDnd5eInventoryResizeGuard({ gameProvider: () => ({ system: { id: "dnd5e" } }), customElementsProvider: () => ({ get: () => Inventory }) });
  const instance = new Inventory();
  instance.isConnected = true;
  instance._onResize(["connected"]);
  instance.isConnected = false;
  instance._onResize(["detached"]);
  assert.deepEqual(calls, [["connected"]]);
});

test("main registers the dnd5e tooltip guard during ready", async () => {
  const source = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /from "\.\/integrations\/dnd5e-tooltip-compat\.js\?v=1\.5\.21"/u
  );
  assert.match(source, /patchDnd5eTooltipRaceGuard\(\);/u);
});

test("rich item tooltip adds explicit rank once and leaves missing or invalid rank alone", async () => {
  const subtitle = { text: "Оружие", markup: "<em>Оружие</em>", get textContent() { return this.text; }, set textContent(value) { this.text = value; this.markup = ""; }, insertAdjacentText(_position, text) { this.text += text; } };
  const tooltip = { querySelector: selector => selector === ".header .subtitle" ? subtitle : null };
  const game = createGame(async () => { subtitle.text = "Оружие"; subtitle.markup = "<em>Оружие</em>"; }, { element: { dataset: {} } });
  game.dnd5e.tooltips.tooltip = tooltip;
  patchDnd5eTooltipRaceGuard({ gameProvider: () => game });
  for (const [rank, expected] of [[0, "Оружие • Ранг 0"], [7, "Оружие • Ранг 7"], [undefined, "Оружие"], ["oops", "Оружие"]]) {
    const doc = { documentName: "Item", flags: { "rebreya-main": { rank } }, system: { identified: true } };
    await game.dnd5e.tooltips._onHoverContentLink(doc);
    assert.equal(subtitle.textContent, expected);
    assert.equal(subtitle.markup, "<em>Оружие</em>");
    await game.dnd5e.tooltips._onHoverContentLink(doc);
    assert.equal(subtitle.textContent, expected);
  }
});

test("unidentified item rank stays hidden from players and is visible to the GM", async () => {
  const subtitle = { textContent: "Unknown", insertAdjacentText(_position, text) { this.textContent += text; } };
  const game = createGame(async () => { subtitle.textContent = "Unknown"; }, { element: { dataset: {} } });
  game.user = { isGM: false };
  game.dnd5e.tooltips.tooltip = { querySelector: () => subtitle };
  patchDnd5eTooltipRaceGuard({ gameProvider: () => game });
  const doc = { documentName: "Item", flags: { "rebreya-main": { rank: 7 } }, system: { identified: false } };
  await game.dnd5e.tooltips._onHoverContentLink(doc);
  assert.equal(subtitle.textContent, "Unknown");
  game.user.isGM = true;
  await game.dnd5e.tooltips._onHoverContentLink(doc);
  assert.equal(subtitle.textContent, "Unknown • Ранг 7");
});

test("owned magic tooltip presents catalog attunement without changing existing description", async () => {
  const description = { children: [], append(node) { this.children.push(node); } };
  const game = createGame(async () => { description.children = []; }, { element: { dataset: {} } });
  game.user = { isGM: false };
  game.dnd5e.tooltips.tooltip = { querySelector: selector => selector === ".content > .description" ? description : null, ownerDocument: { createElement: () => ({ textContent: "" }) } };
  patchDnd5eTooltipRaceGuard({ gameProvider: () => game });
  const item = { documentName: "Item", parent: { documentName: "Actor" }, system: { identified: true }, flags: { "rebreya-main": { catalogAttunement: "магом <мастером>" } } };
  await game.dnd5e.tooltips._onHoverContentLink(item);
  assert.equal(description.children[0].textContent, "Настройка: магом <мастером>");
  await game.dnd5e.tooltips._onHoverContentLink(item);
  assert.equal(description.children.length, 1);
  item.system.identified = false;
  await game.dnd5e.tooltips._onHoverContentLink(item);
  assert.equal(description.children.length, 0);
  item.system.identified = true;
  description.textContent = "Описание. Настройка: магом <мастером>";
  await game.dnd5e.tooltips._onHoverContentLink(item);
  assert.equal(description.children.length, 0);
});
