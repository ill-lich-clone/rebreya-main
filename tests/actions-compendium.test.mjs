import test from "node:test";
import assert from "node:assert/strict";

import {
  ActionsCompendiumService,
  buildActionReferenceAliases,
  getActionReferenceDefinitions
} from "../scripts/data/actions-compendium.js";

test("the active GM creates both world reaction Items once with native reaction activities", async t => {
  const previous = { game: globalThis.game, Item: globalThis.Item, CONST: globalThis.CONST };
  t.after(() => Object.assign(globalThis, previous));
  const gm = { id: "gm", isGM: true, active: true };
  const items = [];
  globalThis.game = { user: gm, users: { activeGM: gm }, items: { contents: items } };
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
  let writes = 0;
  globalThis.Item = { implementation: { async createDocuments(rows) { writes++; items.push(...rows); } } };
  const entries = [
    { key: "parry", actionId: "glossary-parry", name: "Парирование ⚡", description: "Добавьте БМ к КД." },
    { key: "opportunity-attack", actionId: "glossary-opportunity-attack", name: "Провоцированные атаки ⚡",
      description: "Поднимается из положения ничком." }
  ];
  const service = new ActionsCompendiumService();
  await Promise.all([service.syncWorldReactions(entries), service.syncWorldReactions(entries)]);
  await service.syncWorldReactions(entries);
  assert.equal(writes, 1);
  assert.deepEqual(items.map(item => Object.values(item.system.activities)[0]?.activation.type), ["reaction", "reaction"]);
  for (const item of items) {
    const [[id, activity]] = Object.entries(item.system.activities);
    assert.match(id, /^[A-Za-z0-9]{16}$/u);
    assert.equal(activity._id, id);
  }
  assert.match(items[1].system.description.value, /<a href="https:\/\/docs\.google\.com/);
});

test("reaction action references expose an explicit alias without the decorative lightning marker", () => {
  assert.deepEqual(
    buildActionReferenceAliases("Провоцированные атаки ⚡"),
    ["Провоцированные атаки"]
  );
  assert.deepEqual(buildActionReferenceAliases("Атака"), []);
});

test("action reference definitions expose the same stable source identity used by managed items", () => {
  const opportunity = getActionReferenceDefinitions()
    .find((entry) => entry.canonicalName === "Провоцированные атаки ⚡");

  assert.equal(opportunity.sourceId, "glossary-opportunity-attack");
  assert.deepEqual(opportunity.aliases, ["Провоцированные атаки"]);
});
