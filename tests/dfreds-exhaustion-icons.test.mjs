import test from "node:test";
import assert from "node:assert/strict";
import { repairDfredsExhaustionIcons } from "../scripts/integrations/dfreds-exhaustion-icons.js";

const namespace = "dfreds-convenient-effects";
const oldIcon = level => `modules/${namespace}/images/exhaustion${level}.svg`;
const newIcon = level => `systems/dnd5e/icons/svg/statuses/exhaustion-${level}.svg`;
const flag = (scope, key) => scope === namespace && key === "isConvenient";

test("DFreds icon repair updates only exact obsolete icons on active world effects", async () => {
  const oldEffects = [2, 3, 4, 5].map(level => ({
    id: `effect-${level}`, img: oldIcon(level), getFlag: flag,
    statuses: new Set(["exhaustion"]), changes: [{ key: "effect" }]
  }));
  const unaffected = [
    { id: "one", img: oldIcon(1), getFlag: flag },
    { id: "other", img: "worlds/test/images/exhaustion2.svg", getFlag: flag },
    { id: "ordinary", img: oldIcon(2), getFlag: () => false },
    { id: "backup", img: oldIcon(2), getFlag: () => true }
  ];
  const calls = [];
  const item = {
    getFlag: flag,
    effects: { contents: [...oldEffects, ...unaffected] },
    async updateEmbeddedDocuments(type, updates) {
      calls.push({ type, updates });
      for (const { _id, img } of updates) this.effects.contents.find(effect => effect.id === _id).img = img;
    }
  };
  const backup = { ...item, getFlag: () => true, updateEmbeddedDocuments: () => assert.fail("Backup changed") };
  const game = {
    system: { id: "dnd5e", version: "6.0.6" },
    user: { id: "gm", isGM: true, active: true },
    items: { contents: [backup, item] }
  };

  await repairDfredsExhaustionIcons({ ...game, user: { isGM: false } });
  await repairDfredsExhaustionIcons({ ...game, system: { id: "dnd5e", version: "5.3.0" } });
  assert.equal(calls.length, 0);
  await repairDfredsExhaustionIcons(game);
  await repairDfredsExhaustionIcons(game);
  assert.deepEqual(calls, [{
    type: "ActiveEffect",
    updates: [2, 3, 4, 5].map(level => ({ _id: `effect-${level}`, img: newIcon(level) }))
  }]);
  assert.ok(oldEffects.every(effect => effect.statuses.has("exhaustion") && effect.changes.length === 1));
});
