import test from "node:test";
import assert from "node:assert/strict";
import { MAGIC_ITEMS } from "../magicItem.js";
import { normalizeMagicItems, createMagicItemData, MagicItemsCompendiumService } from "../scripts/data/magic-items-compendium.js";
import { buildMagicItemAutomationProjection, buildEmbeddedMagicItemPatch } from "../scripts/data/magic-item-embedded-sync.js";
import { isHeldItemEligible } from "../scripts/integrations/held-items.js?v=1.5.29";
import * as equipment from "../scripts/integrations/equipment-bonuses.js";

globalThis.CONST ??= { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
const families = ["универсальный-инструмент", "магический-гримуар", "флакон-с-кровью", "амулет-благочестия", "барабан-задающего-ритм", "лунный-серп", "жезл-хранителя-договора"];
function focusData(family, bonus) {
  const [row] = normalizeMagicItems([MAGIC_ITEMS.find(item => item.id === `${family}-${bonus}`)]);
  return createMagicItemData(row, new Map());
}
const expectedChanges = bonus => [
  ["system.bonuses.msak.attack", 2, `+${bonus}`],
  ["system.bonuses.rsak.attack", 2, `+${bonus}`],
  ["system.bonuses.spell.dc", 2, `+${bonus}`]
];
for (const family of families) for (const bonus of [1, 2, 3]) {
  test(`${family} +${bonus} has a visible native transfer effect for spell attacks and DC`, () => {
    const data = focusData(family, bonus);
    assert.equal(data.effects.length, 1);
    const effect = data.effects[0];
    assert.deepEqual(effect.changes.map(({key,mode,value}) => [key,mode,value]), expectedChanges(bonus));
    assert.equal(effect.transfer, true);
    assert.equal(effect.disabled, false);
    assert.match(effect.name, new RegExp(`\\+${bonus}`));
    assert.equal(effect.flags["rebreya-main"].magicItemAutomation, true);
    assert.equal(data.system.attunement, "required");
  });
}

test("owned focus receives one native effect without losing manual data or duplicating it on sync", () => {
  const pack = focusData("универсальный-инструмент", 2);
  const projection = buildMagicItemAutomationProjection(pack);
  const manual = { _id: "manual", name: "Мой эффект", changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "3" }], flags: {} };
  const item = { _id: "owned", type: "equipment", name: "Мой инструмент", effects: [manual],
    system: { equipped: false, attunement: "optional", attuned: true, quantity: 2, description: { value: "Мой текст" }, activities: {}, uses: { ...pack.system.uses, spent: 1 } },
    flags: { "rebreya-main": { magicItemId: "универсальный-инструмент-2", magicItemAutomation: { kind: "class-spellcasting" } } } };
  const before = structuredClone(item);
  const resolution = { status: "resolved", magicItemId: "универсальный-инструмент-2" };
  const patch = buildEmbeddedMagicItemPatch(item, projection, resolution);
  assert.equal(patch.status, "updated");
  assert.equal(patch.update.effects.length, 2);
  assert.deepEqual(patch.update.effects.find(effect => effect._id === "manual"), manual);
  assert.deepEqual(patch.update.effects.find(effect => effect._id !== "manual").changes.map(({key,mode,value}) => [key,mode,value]), expectedChanges(2));
  assert.equal(patch.update.system.uses.spent, 1);
  for (const field of ["equipped", "attunement", "quantity", "description"]) assert.equal(Object.hasOwn(patch.update.system, field), false);
  assert.deepEqual(item, before);
  const updated = { ...item, ...patch.update, system: { ...item.system, ...patch.update.system } };
  assert.equal(buildEmbeddedMagicItemPatch(updated, projection, resolution).status, "unchanged");
  updated.effects.find(effect => effect._id !== "manual").disabled = true;
  assert.equal(buildEmbeddedMagicItemPatch(updated, projection, resolution).status, "unchanged", "native effect toggle survives managed sync");
});

test("ordinary spell preparation remains native and receives no second handler bonus", () => {
  const actor = { type: "character", spellcastingClasses: { wizard: { system: { identifier: "wizard" } } }, items: [{ id: "focus", type: "equipment", system: { equipped: true, attuned: true }, flags: { "rebreya-main": { magicItemId: "магический-гримуар-2", heldHands: ["left"] } } }] };
  class Item5e { prepareFinalAttributes() { return "native"; } }
  const spell = new Item5e();
  Object.assign(spell, { type: "spell", actor, system: { sourceClass: "wizard", activities: new Map([["attack", { type: "attack", attack: { bonus: "@custom", flat: false } }], ["save", { type: "save", save: { dc: { calculation: "spellcasting", bonus: "", value: 14 } } }]]) } });
  equipment.registerEquipmentBonusPatches({ CONFIG: { Item: { documentClass: Item5e } }, game: { system: { id: "dnd5e" } } });
  assert.equal(spell.prepareFinalAttributes(), "native");
  assert.equal(spell.system.activities.get("attack").attack.bonus, "@custom");
  assert.equal(spell.system.activities.get("save").save.dc.bonus, "");
  assert.equal(spell.system.activities.get("save").save.dc.value, 14);
});

test("active GM sync writes native spellcasting effects to an existing NPC focus", async () => {
  const packData = focusData("магический-гримуар", 1);
  const item = { _id: "npcFocus", id: "npcFocus", type: "equipment", name: packData.name,
    system: { equipped: true, attunement: "required", attuned: true, quantity: 1, activities: {} }, effects: [],
    flags: { "rebreya-main": { sourceType: "magicItem", magicItemId: "магический-гримуар-1" } },
    toObject() { return structuredClone({ _id: this._id, type: this.type, name: this.name, system: this.system, flags: this.flags, effects: this.effects }); } };
  const actor = { id: "npc", name: "Маг", type: "npc", items: { contents: [item] },
    async updateEmbeddedDocuments(type, updates) {
      assert.equal(type, "Item");
      assert.equal(updates.length, 1);
      const update = updates[0];
      item.effects = structuredClone(update.effects);
      item.flags = structuredClone(update.flags);
      item.system = { ...item.system, ...structuredClone(update.system) };
      return [item];
    } };
  item.actor = actor;
  const pack = { async getDocuments() { return [{ toObject: () => structuredClone(packData) }]; } };
  const service = new MagicItemsCompendiumService({ gameProvider: () => ({ system: { id: "dnd5e" }, actors: { contents: [actor] }, packs: new Map([["world.rebreya-magic-items", pack]]) }), isActiveGm: () => true });
  service.sync = async () => pack;
  const report = await service.syncOwnedMagicItems({ reportToConsole: false });
  assert.deepEqual(report.errors, []);
  assert.equal(report.updated.length, 1);
  assert.deepEqual(item.effects[0].changes.map(({key,mode,value}) => [key,mode,value]), expectedChanges(1));
  assert.equal((await service.syncOwnedMagicItems({ reportToConsole: false })).updated.length, 0);
});

test("the transformed universal tool keeps its existing held-item controls", () => {
  assert.equal(isHeldItemEligible({ type: "tool", flags: { "rebreya-main": { magicItemId: "универсальный-инструмент-1", magicToolTemplate: true } } }), true);
});

function clothingFixture() {
  const clothing = { id: "coat", type: "equipment", system: { quantity: 1, equipped: true }, flags: { "rebreya-main": { gearId: "mekhanizirovannaya-odezhda" } } };
  const actor = { type: "character", items: [clothing], flags: { "rebreya-main": { heroDoll: { slots: { clothing: { itemId: "coat" } } } } } };
  return { actor, clothing, slot: actor.flags["rebreya-main"].heroDoll.slots.clothing };
}

test("mechanized clothing requires a real canonical item in the clothing slot", () => {
  assert.equal(typeof equipment.getMechanizedClothingBonuses, "function");
  const { actor, clothing, slot } = clothingFixture();
  assert.deepEqual(equipment.getMechanizedClothingBonuses(actor), { strengthCheckBonus: 1, capacityMultiplierBonus: 1 });
  actor.items.push({ ...clothing, id: "second" });
  assert.equal(equipment.getMechanizedClothingBonuses(actor).capacityMultiplierBonus, 1);
  slot.itemId = "ghost";
  assert.equal(equipment.getMechanizedClothingBonuses(actor).strengthCheckBonus, 0);
  slot.itemId = "coat";
  clothing.flags["rebreya-main"].gearId = "other";
  assert.equal(equipment.getMechanizedClothingBonuses(actor).strengthCheckBonus, 0);
});

test("native clothing preparation adds one STR check bonus and preserves flat capacity and other rolls", () => {
  const { actor, slot } = clothingFixture();
  class Creature {
    prepareDerivedData() {
      const check = Number(Function(`return (${this.abilities.str.bonuses.check})`)());
      this.athletics = check + 2;
      this.strCheck = check;
      this.attributes.encumbrance.max = 10 * 15 * 2 * Number(Function(`return (${this.attributes.encumbrance.multipliers.maximum})`)()) + 7;
    }
  }
  const model = new Creature();
  Object.assign(model, { parent: actor, abilities: { str: { value: 10, bonuses: { check: "2", save: "3" } } },
    attributes: { encumbrance: { multipliers: { maximum: "1", encumbered: "1", heavilyEncumbered: "1" } } } });
  model._source = structuredClone({ abilities: model.abilities, attributes: model.attributes });
  const source = structuredClone(model._source);
  equipment.registerEquipmentBonusPatches({ CONFIG: { Actor: { dataModels: { character: Creature } } }, game: { system: { id: "dnd5e" } } });
  model.prepareDerivedData();
  assert.equal(model.strCheck, 3);
  assert.equal(model.athletics, 5);
  assert.equal(model.attributes.encumbrance.max, 327);
  assert.equal(model.attributes.encumbrance.multipliers.encumbered, "1");
  model.prepareDerivedData();
  assert.equal(model.strCheck, 3);
  assert.equal(model.attributes.encumbrance.max, 327);
  model.attributes.encumbrance.multipliers.maximum = "4 / 3";
  model.prepareDerivedData();
  assert.equal(model.attributes.encumbrance.max, 427, "native ×20 becomes ×21, preserving size ×2 and +7 flat");
  model.attributes.encumbrance.multipliers.maximum = "1";
  delete slot.itemId;
  model.prepareDerivedData();
  assert.equal(model.strCheck, 2);
  assert.equal(model.attributes.encumbrance.max, 307);
  assert.equal(model.abilities.str.bonuses.save, "3");
  assert.equal(model.abilities.str.value, 10);
  assert.deepEqual(model._source, source);
});
