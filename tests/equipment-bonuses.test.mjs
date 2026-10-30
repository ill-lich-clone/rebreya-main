import test from "node:test";
import assert from "node:assert/strict";
import { isHeldItemEligible } from "../scripts/integrations/held-items.js?v=1.4.383";
const equipment = await import("../scripts/integrations/equipment-bonuses.js").catch(() => ({}));
const families = [
  ["универсальный-инструмент", "artificer", true], ["магический-гримуар", "wizard", true],
  ["флакон-с-кровью", "sorcerer", false], ["амулет-благочестия", "cleric", false],
  ["барабан-задающего-ритм", "bard", true], ["лунный-серп", "druid", true],
  ["жезл-хранителя-договора", "warlock", true]
];
function fixture(family, cls, bonus, held = true) {
  const focus = { id: "focus", type: "equipment", system: { equipped: true, attunement: "required", attuned: true },
    flags: { "rebreya-main": { magicItemId: `${family}-${bonus}`, heldHands: held ? ["left"] : [] } } };
  const actor = { type: "character", items: [focus], spellcastingClasses: { [cls]: { system: { identifier: cls } }, other: { system: { identifier: "paladin" } } },
    flags: { "rebreya-main": {} } };
  focus.actor = actor;
  const spell = { type: "spell", actor, system: { sourceClass: cls, activities: new Map() } };
  return { focus, actor, spell };
}

for (const [family, cls, held] of families) for (const bonus of [1, 2, 3]) {
  test(`${family} +${bonus} improves only ${cls} spells while active`, () => {
    assert.equal(typeof equipment.getClassSpellcastingItemBonus, "function");
    const { focus, spell } = fixture(family, cls, bonus, held);
    assert.equal(equipment.getClassSpellcastingItemBonus(spell), bonus);
    spell.system.sourceClass = "other";
    assert.equal(equipment.getClassSpellcastingItemBonus(spell), 0);
    spell.system.sourceClass = "";
    assert.equal(equipment.getClassSpellcastingItemBonus(spell), 0);
    spell.system.sourceClass = cls;
    focus.system.attuned = false;
    assert.equal(equipment.getClassSpellcastingItemBonus(spell), 0);
    focus.system.attuned = true;
    focus.system.equipped = false;
    assert.equal(equipment.getClassSpellcastingItemBonus(spell), family === "флакон-с-кровью" ? bonus : 0);
    focus.system.equipped = true;
    if (held) {
      focus.flags["rebreya-main"].heldHands = [];
      assert.equal(equipment.getClassSpellcastingItemBonus(spell), 0);
    }
  });
}

test("class bonuses support the canonical reworked sorcerer and ranger, and deduplicate families", () => {
  assert.equal(typeof equipment.getClassSpellcastingItemBonus, "function");
  const { focus, actor, spell } = fixture("флакон-с-кровью", "sorcerer-rework-v011", 2, false);
  assert.equal(equipment.getClassSpellcastingItemBonus(spell), 2);
  actor.items.push({ ...focus, id: "copy", flags: { "rebreya-main": { magicItemId: "флакон-с-кровью-3" } } });
  assert.equal(equipment.getClassSpellcastingItemBonus(spell), 3);
  const ranger = fixture("лунный-серп", "ranger", 1);
  assert.equal(equipment.getClassSpellcastingItemBonus(ranger.spell), 1);
  ranger.actor.spellcastingClasses.ranger.system.identifier = "unknown";
  assert.equal(equipment.getClassSpellcastingItemBonus(ranger.spell), 0);
});

test("native preparation includes scoped attack and DC bonuses without source writes or accumulation", () => {
  assert.equal(typeof equipment.registerEquipmentBonusPatches, "function");
  const { spell, focus } = fixture("магический-гримуар", "wizard", 2);
  const attack = { type: "attack", attack: { flat: false, bonus: "@custom + 1d4" }, labels: {} };
  const save = { type: "save", save: { dc: { calculation: "spellcasting", bonus: "+1", formula: "" } }, labels: {} };
  const fixed = { type: "save", save: { dc: { calculation: "", formula: "17", value: 17 } }, labels: {} };
  const flat = { type: "attack", attack: { flat: true, bonus: "7" }, labels: {} };
  spell.system.activities = new Map([['a', attack], ['s', save], ['f', fixed], ['flat', flat]]);
  class Item5e {
    prepareFinalAttributes() {
      save.save.dc.value ??= 13;
      save.save.dc.value += Number(Function(`return (${save.save.dc.bonus})`)());
      attack.labels.toHit = attack.attack.bonus;
      save.labels.save = String(save.save.dc.value);
      return "prepared";
    }
  }
  Object.setPrototypeOf(spell, Item5e.prototype);
  spell._source = { system: { activities: { a: structuredClone(attack), s: structuredClone(save) } } };
  const source = structuredClone(spell._source);
  const config = { Item: { documentClass: Item5e }, Actor: { dataModels: {} } };
  const options = { CONFIG: config, game: { system: { id: "dnd5e" } } };
  equipment.registerEquipmentBonusPatches(options);
  equipment.registerEquipmentBonusPatches(options);
  assert.equal(spell.prepareFinalAttributes(), "prepared");
  const augmented = attack.attack.bonus;
  assert.ok(augmented.includes("@custom + 1d4"));
  assert.match(augmented, /2/);
  assert.equal(save.save.dc.value, 16);
  assert.equal(save.labels.save, "16");
  spell.prepareFinalAttributes();
  assert.equal(attack.attack.bonus, augmented);
  assert.equal(save.save.dc.value, 16);
  focus.system.equipped = false;
  spell.prepareFinalAttributes();
  assert.equal(attack.attack.bonus, "@custom + 1d4");
  assert.equal(save.save.dc.value, 14);
  assert.equal(fixed.save.dc.value, 17);
  assert.equal(flat.attack.bonus, "7");
  assert.deepEqual(spell._source, source);
  assert.deepEqual(equipment.registerEquipmentBonusPatches({ CONFIG: config, game: { system: { id: "other" } } }), { item: false, actors: [] });
});

test("the transformed universal tool remains eligible for the existing held-item controls", () => {
  const { focus } = fixture("универсальный-инструмент", "artificer", 1);
  focus.type = "tool";
  focus.flags["rebreya-main"].magicToolTemplate = true;
  assert.equal(isHeldItemEligible(focus), true);
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
