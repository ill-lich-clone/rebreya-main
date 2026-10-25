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
    /from "\.\/integrations\/dnd5e-tooltip-compat\.js\?v=1\.5\.6"/u
  );
  assert.match(source, /patchDnd5eTooltipRaceGuard\(\);/u);
});
