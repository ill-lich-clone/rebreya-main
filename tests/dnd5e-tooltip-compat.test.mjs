import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { patchDnd5eTooltipRaceGuard } from "../scripts/integrations/dnd5e-tooltip-compat.js";

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

test("main registers the dnd5e tooltip guard during ready", async () => {
  const source = await readFile(new URL("../scripts/main.js", import.meta.url), "utf8");

  assert.match(
    source,
    /from "\.\/integrations\/dnd5e-tooltip-compat\.js\?v=1\.4\.215-tooltip-race"/u
  );
  assert.match(source, /patchDnd5eTooltipRaceGuard\(\);/u);
});
