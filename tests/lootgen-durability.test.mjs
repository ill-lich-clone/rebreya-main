import assert from "node:assert/strict";
import test from "node:test";

import {
  applyLootgenBrokenDurability,
  applyLootgenRowDurability,
  buildLootgenRowIdentity,
  collectBreakableManagedGearIds,
  normalizeBrokenEquipmentChance,
  normalizeLootgenBrokenMarker,
  rollLootgenBrokenState
} from "../scripts/data/lootgen-durability.js";

test("broken equipment chance is an integer clamped to 0-100", () => {
  assert.equal(normalizeBrokenEquipmentChance(-4), 0);
  assert.equal(normalizeBrokenEquipmentChance(12.9), 12);
  assert.equal(normalizeBrokenEquipmentChance(140), 100);
  assert.equal(normalizeBrokenEquipmentChance("bad"), 0);
});

test("only mundane gear rows can roll as broken", () => {
  assert.equal(rollLootgenBrokenState({ sourceType: "gear", chance: 50, random: () => 0.49 }), true);
  assert.equal(rollLootgenBrokenState({ sourceType: "gear", chance: 50, random: () => 0.5 }), false);
  assert.equal(rollLootgenBrokenState({ sourceType: "material", chance: 100, random: () => 0 }), false);
  assert.equal(rollLootgenBrokenState({ sourceType: "magicItem", chance: 100, random: () => 0 }), false);
  assert.equal(rollLootgenBrokenState({ sourceType: "gear", chance: 100, isEligible: false, random: () => 0 }), false);
});

test("breakable gear ids come only from eligible canonical managed index entries", () => {
  const flags = (sourceId, extra = {}) => ({
    "rebreya-main": {
      managed: true,
      sourceType: "gear",
      sourceId,
      gearId: sourceId,
      ...extra
    }
  });
  const ids = collectBreakableManagedGearIds([
    { type: "weapon", flags: flags("sword"), system: { rarity: "" } },
    { type: "weapon", flags: flags("magic-sword", { magical: true }) },
    { type: "loot", flags: flags("material", { sourceType: "material", materialId: "iron" }) },
    { type: "weapon", flags: { "rebreya-main": { managed: false, sourceType: "gear", sourceId: "fake" } } }
  ]);

  assert.deepEqual([...ids], ["sword"]);
});

test("intact and broken copies of the same gear have different row identities", () => {
  const base = { sourceType: "gear", sourceId: "longsword" };

  assert.notEqual(
    buildLootgenRowIdentity({ ...base, isBroken: false }),
    buildLootgenRowIdentity({ ...base, isBroken: true })
  );
  assert.equal(normalizeLootgenBrokenMarker({ ...base, isBroken: 1 }), true);
  assert.equal(normalizeLootgenBrokenMarker({ sourceType: "magicItem", sourceId: "wand", isBroken: true }), false);
});

test("broken roll handles the chance boundaries without consuming randomness", () => {
  let calls = 0;
  const random = () => {
    calls += 1;
    return 0.5;
  };

  assert.equal(rollLootgenBrokenState({ sourceType: "gear", chance: 0, random }), false);
  assert.equal(rollLootgenBrokenState({ sourceType: "gear", chance: 100, random }), true);
  assert.equal(calls, 0);
});

test("broken loot keeps normal item data and receives a full second durability pool", () => {
  const itemData = {
    name: "Железный меч",
    type: "weapon",
    system: {
      quantity: 1,
      damage: { base: { number: 1, denomination: 8 } }
    },
    flags: {
      "rebreya-main": {
        sourceType: "gear",
        sourceId: "iron-sword",
        gearId: "iron-sword"
      }
    }
  };

  const result = applyLootgenBrokenDurability(itemData, {
    isBroken: true,
    sourceType: "gear",
    sourceId: "iron-sword",
    gear: {
      id: "iron-sword",
      predominantMaterialId: "iron",
      predominantMaterialName: "Железо"
    },
    material: { id: "iron", name: "Железо" },
    updatedAt: "2026-07-16T12:00:00.000Z"
  });

  assert.notEqual(result, itemData);
  assert.deepEqual(result.system.damage, itemData.system.damage);
  assert.equal(result.flags["rebreya-main"].durability.state, "broken");
  assert.equal(result.flags["rebreya-main"].durability.breakStage, 1);
  assert.ok(result.flags["rebreya-main"].durability.hp.max > 0);
  assert.equal(
    result.flags["rebreya-main"].durability.hp.value,
    result.flags["rebreya-main"].durability.hp.max
  );
  assert.deepEqual(result.flags["rebreya-main"].durability.initializedFrom, {
    sourceType: "gear",
    sourceId: "iron-sword"
  });
  assert.equal(result.flags["rebreya-main"].durability.updatedAt, "2026-07-16T12:00:00.000Z");
  assert.equal(itemData.flags["rebreya-main"].durability, undefined);
});

test("magic and ineligible loot never receive broken durability", () => {
  const magic = {
    name: "Волшебный меч",
    type: "weapon",
    system: { rarity: "rare" },
    flags: { "rebreya-main": { sourceType: "magicItem", magical: true } }
  };
  const material = {
    name: "Железо",
    type: "loot",
    flags: { "rebreya-main": { sourceType: "material", materialId: "iron" } }
  };

  assert.equal(applyLootgenBrokenDurability(magic, {
    isBroken: true,
    sourceType: "magicItem"
  }).flags["rebreya-main"].durability, undefined);
  assert.equal(applyLootgenBrokenDurability(material, {
    isBroken: true,
    sourceType: "material"
  }).flags["rebreya-main"].durability, undefined);
});

test("row durability resolves the managed gear and predominant material from the model", () => {
  const gear = {
    id: "steel-shield",
    predominantMaterialId: "steel",
    predominantMaterialName: "Сталь"
  };
  const material = { id: "steel", name: "Сталь" };
  const itemData = {
    name: "Стальной щит",
    type: "equipment",
    flags: { "rebreya-main": { sourceType: "gear", sourceId: gear.id, gearId: gear.id } }
  };

  const result = applyLootgenRowDurability(itemData, {
    sourceType: "gear",
    sourceId: gear.id,
    isBroken: true
  }, {
    model: {
      gearById: new Map([[gear.id, gear]]),
      materialById: new Map([[material.id, material]])
    },
    updatedAt: "2026-07-16T13:00:00.000Z"
  });

  const flag = result.flags["rebreya-main"].durability;
  assert.equal(flag.materialProfile, "steel");
  assert.equal(flag.state, "broken");
  assert.equal(flag.updatedAt, "2026-07-16T13:00:00.000Z");
});
