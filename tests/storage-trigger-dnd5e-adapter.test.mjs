import test from "node:test";
import assert from "node:assert/strict";

import { StorageTriggerDnd5eAdapter } from "../scripts/data/storage-trigger-dnd5e-adapter.js";

function actorFixture() {
  const updates = [];
  const deleted = [];
  const item = {
    id: "key", uuid: "Actor.hero.Item.key", documentName: "Item", name: "Ключ",
    system: { quantity: 2 }, flags: { core: { sourceId: "Compendium.keys.Item.iron" } },
    async update(patch) { updates.push(patch); this.system.quantity = patch["system.quantity"]; },
    async delete() { deleted.push(this.id); }
  };
  const actor = {
    uuid: "Actor.hero", documentName: "Actor", type: "character", items: { contents: [item] },
    async rollSavingThrow(config, dialog, message) {
      assert.deepEqual(config, { ability: "dex", target: 14 });
      assert.deepEqual(dialog, { configure: false });
      assert.equal(message.create, true);
      return [{ total: 12 }];
    },
    async applyDamage(rows) { return rows; }
  };
  return { actor, item, updates, deleted };
}

test("storage trigger dnd5e adapter resolves the authoritative character and item", async () => {
  const { actor, item, updates } = actorFixture();
  const adapter = new StorageTriggerDnd5eAdapter({ fromUuid: async (uuid) => (
    uuid === actor.uuid ? actor : uuid === item.uuid ? item : null
  ) });
  const context = { characterActorUuid: actor.uuid };

  assert.equal(await adapter.hasItem(context, { itemUuid: item.uuid }), true);
  assert.equal(await adapter.hasItem(context, { sourceId: "Compendium.keys.Item.iron" }), true);
  assert.deepEqual(await adapter.rollCheck(context, { kind: "savingThrow", ability: "dex", dc: 14 }), {
    success: false, total: 12
  });
  assert.deepEqual(await adapter.consumeItem(context, { itemUuid: item.uuid, quantity: 1 }), {
    success: true, itemUuid: item.uuid, quantity: 1
  });
  assert.deepEqual(updates, [{ "system.quantity": 1 }]);
});

test("storage trigger dnd5e adapter rolls and applies configured damage", async () => {
  const { actor } = actorFixture();
  const adapter = new StorageTriggerDnd5eAdapter({
    fromUuid: async () => actor,
    rollFormula: async (formula) => {
      assert.equal(formula, "2d6");
      return 7;
    }
  });
  const result = await adapter.applyDamage({ characterActorUuid: actor.uuid }, {
    formula: "2d6", damageType: "piercing"
  });
  assert.deepEqual(result, { success: true, applied: 7, damageType: "piercing" });
});
