import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  applyDurabilityDamage,
  buildDurabilitySignature,
  buildInitialDurability,
  isDurabilityEligible,
  markDurabilityBroken,
  markDurabilityDestroyed,
  resolveDurabilityProfile
} from "../scripts/data/durability-rules.js";

const MATERIALS_URL = new URL("../data/materials.json", import.meta.url);
const MATERIALS = JSON.parse(readFileSync(MATERIALS_URL, "utf8"));

const MATERIAL_ROWS = [
  ["fabric", "Ткань", 1, 3, 9, 0],
  ["wood", "Дерево", 3, 6, 12, 2],
  ["glass", "Стекло", 2, 5, 11, 0],
  ["leather", "Кожа", 2, 6, 11, 2],
  ["iron", "Железо", 5, 11, 14, 5],
  ["steel", "Сталь", 7, 15, 17, 6],
  ["adamantine", "Адамантин", 10, 22, 19, 10],
  ["stone", "Камень", 4, 8, 13, 3],
  ["mithral", "Мифрил", 6, 12, 15, 5],
  ["crystal", "Кристалл", 4, 11, 12, 4]
];

const MATERIAL_ALIASES = {
  fabric: [
    "fabric", "cloth", "textile", "ткань", "текстиль", "нить", "silk", "шёлк",
    "wool", "шерсть", "linen", "лён", "cotton", "хлопок", "canvas", "холст",
    "paper", "бумага", "parchment", "пергамент"
  ],
  wood: ["wood", "timber", "дерево", "древесина", "bone", "кость", "bamboo", "бамбук"],
  glass: ["glass", "стекло", "obsidian", "обсидиан"],
  leather: ["leather", "кожа", "hide", "шкура", "skin", "fur", "мех"],
  iron: [
    "iron", "железо", "copper", "медь", "tin", "олово", "lead", "свинец",
    "silver", "серебро", "gold", "золото", "platinum", "платина", "bronze",
    "бронза", "brass", "латунь"
  ],
  steel: ["steel", "сталь", "refined steel", "закалённая сталь", "эльфийская сталь", "дьявольское железо"],
  adamantine: ["adamantine", "adamant", "адамантин", "адамантий"],
  stone: [
    "stone", "камень", "slate", "сланец", "clay", "глина", "brick", "кирпич",
    "limestone", "известняк", "lime", "известь", "masonry", "каменная кладка"
  ],
  mithral: ["mithral", "mithril", "мифрил", "митрил"],
  crystal: ["crystal", "кристалл", "gem", "gemstone", "самоцвет", "quartz", "кварц"]
};

function resolveFromMaterialName(name, overrides = {}) {
  return resolveDurabilityProfile({
    itemData: { type: "weapon", system: { properties: new Set() } },
    gear: { predominantMaterialName: name },
    material: null,
    ...overrides
  });
}

test("every durability material row resolves both fragile and sturdy values", () => {
  for (const [materialProfile, materialName, fragile, sturdy, ac, damageThreshold] of MATERIAL_ROWS) {
    const sturdyProfile = resolveFromMaterialName(materialName);
    assert.deepEqual(sturdyProfile, {
      materialProfile,
      construction: "sturdy",
      size: "small",
      hpMax: sturdy,
      ac,
      damageThreshold
    });

    const fragileProfile = resolveFromMaterialName(materialName, {
      itemData: {
        type: "equipment",
        system: { properties: [] },
        flags: { "rebreya-main": { durability: { construction: "fragile" } } }
      }
    });
    assert.equal(fragileProfile.hpMax, fragile);
    assert.equal(fragileProfile.construction, "fragile");
  }
});

test("all six size multipliers return integer steel HP for sturdy and fragile construction", () => {
  const expectedBySize = {
    tiny: { sturdy: 8, fragile: 4 },
    small: { sturdy: 15, fragile: 7 },
    medium: { sturdy: 30, fragile: 14 },
    large: { sturdy: 45, fragile: 21 },
    huge: { sturdy: 60, fragile: 28 },
    gargantuan: { sturdy: 90, fragile: 42 }
  };

  for (const [size, expected] of Object.entries(expectedBySize)) {
    for (const construction of ["sturdy", "fragile"]) {
      const profile = resolveFromMaterialName("Сталь", {
        gear: {
          predominantMaterialName: "Сталь",
          durability: { size, construction }
        }
      });
      assert.equal(profile.size, size);
      assert.equal(profile.construction, construction);
      assert.equal(profile.hpMax, expected[construction], `${size} ${construction}`);
      assert.equal(Number.isInteger(profile.hpMax), true, `${size} ${construction}`);
    }
  }
});

test("fragile Tiny objects have at least one integer HP", () => {
  const profile = resolveFromMaterialName("Ткань", {
    gear: {
      predominantMaterialName: "Ткань",
      durability: { size: "tiny", construction: "fragile" }
    }
  });

  assert.equal(profile.hpMax, 1);
});

test("explicit item metadata wins over gear, material record, and material aliases", () => {
  const profile = resolveDurabilityProfile({
    itemData: {
      type: "weapon",
      system: { properties: new Set() },
      flags: {
        "rebreya-main": {
          durability: {
            materialProfile: "glass",
            construction: "fragile",
            size: "large"
          }
        }
      }
    },
    gear: {
      predominantMaterialName: "Сталь",
      durability: { materialProfile: "iron", construction: "sturdy", size: "tiny" }
    },
    material: { name: "Адамантин", durabilityProfile: "mithral" }
  });

  assert.deepEqual(profile, {
    materialProfile: "glass",
    construction: "fragile",
    size: "large",
    hpMax: 6,
    ac: 11,
    damageThreshold: 0
  });
});

test("gear metadata wins over a material record and aliases", () => {
  const profile = resolveDurabilityProfile({
    itemData: { type: "equipment", system: { properties: [] } },
    gear: {
      predominantMaterialName: "Сталь",
      durability: { materialProfile: "leather", construction: "fragile", size: "medium" }
    },
    material: { name: "Адамантин", durabilityProfile: "mithral" }
  });

  assert.deepEqual(profile, {
    materialProfile: "leather",
    construction: "fragile",
    size: "medium",
    hpMax: 4,
    ac: 11,
    damageThreshold: 2
  });
});

test("material-record profile mapping wins over categorized name aliases", () => {
  const profile = resolveDurabilityProfile({
    itemData: { type: "equipment", system: { properties: [] } },
    gear: { predominantMaterialName: "Сталь" },
    material: { name: "Сталь", durabilityProfile: "crystal" }
  });

  assert.equal(profile.materialProfile, "crystal");
  assert.equal(profile.hpMax, 11);
});

test("exact Russian and English material aliases cover each durability category", () => {
  for (const [expectedProfile, aliases] of Object.entries(MATERIAL_ALIASES)) {
    for (const alias of aliases) {
      assert.equal(resolveFromMaterialName(alias).materialProfile, expectedProfile, alias);
    }
  }
});

test("curated exact aliases cover current catalog representatives from all durability profiles", () => {
  const catalogByName = new Map(MATERIALS.map((material) => [material.name, material]));
  const catalogAliases = [
    ["fabric", "Шерсть чудовища"],
    ["wood", "Осколок кости чудовища"],
    ["glass", "Обсидиановый осколок"],
    ["leather", "Шкура чудовища"],
    ["iron", "Железо"],
    ["steel", "Эльфийская сталь"],
    ["adamantine", "Освящённый адамантий"],
    ["stone", "Грозовой камень"],
    ["mithral", "Мифрил"],
    ["crystal", "Чистый кристалл маны"]
  ];

  for (const [expectedProfile, materialName] of catalogAliases) {
    const material = catalogByName.get(materialName);
    assert.ok(material && material.isSynthetic === false, `${materialName} is a source row`);
    assert.equal(resolveFromMaterialName(material.name).materialProfile, expectedProfile, materialName);
  }

  assert.equal(catalogByName.get("Шерсть чудовища")?.type, "Существо");
});

test("material aliases are exact and never use fuzzy substring matches", () => {
  const profile = resolveFromMaterialName("steelwood composite");

  assert.equal(profile.materialProfile, "wood");
  assert.equal(profile.diagnosticToken, "unknown-material:steelwood composite");
});

test("resolution defaults to sturdy small Wood and reports an unknown material diagnostic", () => {
  const profile = resolveDurabilityProfile({
    itemData: { type: "tool", system: { properties: [] } },
    gear: { predominantMaterialName: "Unobtainium" },
    material: null
  });

  assert.deepEqual(profile, {
    materialProfile: "wood",
    construction: "sturdy",
    size: "small",
    hpMax: 6,
    ac: 12,
    damageThreshold: 2,
    diagnosticToken: "unknown-material:unobtainium"
  });
});

test("ordinary physical gear is eligible and non-gear document types are not", () => {
  for (const type of ["weapon", "equipment", "tool", "container", "consumable", "loot"]) {
    assert.equal(isDurabilityEligible({ type, system: { properties: new Set(), rarity: "" } }), true, type);
  }
  for (const type of ["spell", "feat", "class", "subclass", "background"]) {
    assert.equal(isDurabilityEligible({ type, system: { properties: new Set(), rarity: "" } }), false, type);
  }
});

test("materials-compendium source and linked-good loot forms are not durability eligible", () => {
  const sourceMaterial = MATERIALS.find((material) => material.name === "Шерсть чудовища");
  const linkedGoodMaterial = MATERIALS.find((material) => material.name === "Железо");
  assert.ok(sourceMaterial);
  assert.equal(sourceMaterial.linkedGoodId, null);
  assert.ok(linkedGoodMaterial?.linkedGoodId);

  for (const material of [sourceMaterial, linkedGoodMaterial]) {
    const itemData = {
      name: material.name,
      type: "loot",
      system: {
        properties: [],
        rarity: "",
        type: {
          value: "trade",
          subtype: String(material.subtype ?? "").trim()
        }
      },
      flags: {
        "rebreya-main": {
          managed: true,
          materialId: material.id,
          linkedGoodId: material.linkedGoodId ?? null,
          source: material.source ?? "",
          isSynthetic: Boolean(material.isSynthetic)
        }
      }
    };

    assert.equal(isDurabilityEligible(itemData), false, material.name);
  }
});

test("Rebreya material and goods stack markers are excluded while functional loot gear remains eligible", () => {
  const excludedFlags = [
    { sourceType: "material", sourceId: "material-3" },
    { linkedGoodId: "zhelezo" },
    { sourceType: "good", sourceId: "zhelezo" },
    { sourceType: "resource", sourceId: "supplies" }
  ];

  for (const flags of excludedFlags) {
    assert.equal(isDurabilityEligible({
      type: "loot",
      system: { properties: [], rarity: "" },
      flags: { "rebreya-main": flags }
    }), false, JSON.stringify(flags));
  }

  assert.equal(isDurabilityEligible({
    type: "loot",
    system: { properties: [], rarity: "" },
    flags: {
      "rebreya-main": {
        sourceType: "gear",
        sourceId: "pohodnyy-nabor",
        gearId: "pohodnyy-nabor"
      }
    }
  }), true);
});

test("actual party supply flags never initialize durability", () => {
  for (const flags of [
    { managedPartySupply: true, resourceKey: "food" },
    { sourceType: "supply", resourceKey: "water" },
    { resourceKey: "food" }
  ]) {
    assert.equal(isDurabilityEligible({
      type: "loot",
      system: { properties: [], rarity: "" },
      flags: { "rebreya-main": flags }
    }), false);
  }
});

test("dnd5e magical properties and rarity always exclude durability", () => {
  const magicalItems = [
    { type: "weapon", system: { properties: new Set(["mgc"]), rarity: "" } },
    { type: "weapon", system: { properties: ["magical"], rarity: "" } },
    { type: "equipment", system: { properties: { mgc: true }, rarity: "" } },
    { type: "equipment", system: { properties: { value: ["magic"] }, rarity: "" } },
    { type: "weapon", system: { properties: [], rarity: "uncommon" } },
    { type: "weapon", system: { properties: [], rarity: { value: "rare" } } }
  ];

  for (const itemData of magicalItems) {
    assert.equal(isDurabilityEligible(itemData), false);
  }
});

test("every Rebreya magic-item marker excludes durability", () => {
  const flagVariants = [
    { magical: true },
    { sourceType: "magicItem" },
    { itemType: "magicItem" },
    { magicItemType: "magicItem" },
    { magicItemId: "magic-1" },
    { magicId: "magic-2" },
    { durability: { eligible: false } }
  ];

  for (const flags of flagVariants) {
    assert.equal(isDurabilityEligible({
      type: "weapon",
      system: { properties: [], rarity: "" },
      flags: { "rebreya-main": flags }
    }), false);
  }
});

test("initial durability is intact at maximum HP", () => {
  const profile = resolveFromMaterialName("Сталь");

  assert.deepEqual(buildInitialDurability(profile), {
    version: 1,
    eligible: true,
    state: "intact",
    breakStage: 0,
    materialProfile: "steel",
    construction: "sturdy",
    size: "small",
    hp: { value: 15, max: 15 },
    ac: 17,
    damageThreshold: 6
  });
});

test("poison and psychic damage are immune regardless of case", () => {
  const flag = buildInitialDurability(resolveFromMaterialName("Сталь"));

  for (const damageType of ["poison", "Poison", "psychic", "PSYCHIC"]) {
    const transition = applyDurabilityDamage(flag, { amount: 100, damageType });
    assert.equal(transition.outcome, "ignored");
    assert.equal(transition.appliedDamage, 0);
    assert.deepEqual(transition.nextFlag, flag);
  }
});

test("damage at the threshold is ignored and damage above it is applied in full", () => {
  const flag = buildInitialDurability(resolveFromMaterialName("Сталь"));
  const boundary = applyDurabilityDamage(flag, { amount: 6, damageType: "slashing" });
  const above = applyDurabilityDamage(flag, { amount: 7, damageType: "slashing" });

  assert.equal(boundary.outcome, "ignored");
  assert.equal(boundary.appliedDamage, 0);
  assert.equal(above.outcome, "damaged");
  assert.equal(above.appliedDamage, 7);
  assert.equal(above.nextFlag.hp.value, 8);
});

test("damage stops an intact item at zero without changing its state", () => {
  const flag = buildInitialDurability(resolveFromMaterialName("Сталь"));
  const transition = applyDurabilityDamage(flag, { amount: 15, damageType: "slashing" });

  assert.equal(transition.outcome, "depleted");
  assert.equal(transition.appliedDamage, 15);
  assert.equal(transition.nextFlag.state, "intact");
  assert.equal(transition.nextFlag.breakStage, 0);
  assert.deepEqual(transition.nextFlag.hp, { value: 0, max: 15 });
});

test("further damage at zero is ignored instead of opening another outcome", () => {
  const flag = buildInitialDurability(resolveFromMaterialName("Сталь"));
  const depleted = applyDurabilityDamage(flag, { amount: 15, damageType: "slashing" }).nextFlag;

  const repeated = applyDurabilityDamage(depleted, { amount: 5, damageType: "slashing" });

  assert.equal(repeated.outcome, "ignored");
  assert.equal(repeated.appliedDamage, 0);
  assert.deepEqual(repeated.nextFlag.hp, { value: 0, max: 15 });
});

test("explicit break and destroy transitions keep zero HP without a second pool", () => {
  const intact = buildInitialDurability(resolveFromMaterialName("Сталь"));
  const depleted = applyDurabilityDamage(intact, { amount: 15, damageType: "slashing" }).nextFlag;
  const broken = markDurabilityBroken(depleted);
  const destroyed = markDurabilityDestroyed(depleted);

  assert.equal(broken.outcome, "broken");
  assert.equal(broken.nextFlag.state, "broken");
  assert.equal(broken.nextFlag.breakStage, 1);
  assert.deepEqual(broken.nextFlag.hp, { value: 0, max: 15 });
  assert.equal(destroyed.outcome, "destroyed");
  assert.equal(destroyed.nextFlag.state, "destroyed");
  assert.equal(destroyed.nextFlag.breakStage, 2);
  assert.deepEqual(destroyed.nextFlag.hp, { value: 0, max: 15 });
});

test("damage transitions never mutate their input flag", () => {
  const flag = {
    ...buildInitialDurability(resolveFromMaterialName("Дерево")),
    initializedFrom: { sourceType: "gear", sourceId: "shield" }
  };
  const snapshot = structuredClone(flag);
  const transition = applyDurabilityDamage(flag, { amount: 3, damageType: "bludgeoning" });

  assert.deepEqual(flag, snapshot);
  assert.notEqual(transition.nextFlag, flag);
  assert.notEqual(transition.nextFlag.hp, flag.hp);
});

test("durability signatures are stable and change with stack-relevant state", () => {
  const first = {
    version: 1,
    eligible: true,
    state: "intact",
    breakStage: 0,
    materialProfile: "steel",
    construction: "sturdy",
    size: "small",
    hp: { value: 15, max: 15 },
    ac: 17,
    damageThreshold: 6,
    initializedFrom: { sourceType: "gear", sourceId: "sword" },
    updatedAt: "2026-07-16T10:00:00.000Z"
  };
  const reordered = {
    updatedAt: "2027-01-01T00:00:00.000Z",
    damageThreshold: 6,
    ac: 17,
    hp: { max: 15, value: 15 },
    size: "small",
    construction: "sturdy",
    materialProfile: "steel",
    breakStage: 0,
    state: "intact",
    eligible: true,
    version: 1,
    initializedFrom: { sourceType: "other", sourceId: "other" }
  };

  const signature = buildDurabilitySignature(first);
  assert.equal(typeof signature, "string");
  assert.equal(buildDurabilitySignature(reordered), signature);
  assert.notEqual(buildDurabilitySignature({ ...first, state: "broken", breakStage: 1 }), signature);
  assert.notEqual(buildDurabilitySignature({ ...first, hp: { value: 14, max: 15 } }), signature);
});
