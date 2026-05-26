import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDnd5eItemData } from "../scripts/data/gear-compendium.js";
import { normalizeEconomyDataset } from "../scripts/data/normalizer.js";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const DAMAGE_TYPE_BY_LABEL = new Map([
  ["Дробящий", "bludgeoning"],
  ["Колющий", "piercing"],
  ["Рубящий", "slashing"]
]);

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => JSON.parse(JSON.stringify(value)),
    escapeHTML: (value) => String(value ?? "")
      .replace(/&/gu, "&amp;")
      .replace(/</gu, "&lt;")
      .replace(/>/gu, "&gt;")
      .replace(/"/gu, "&quot;")
      .replace(/'/gu, "&#39;")
  }
};

globalThis.CONST ??= {
  DOCUMENT_OWNERSHIP_LEVELS: {
    OBSERVER: 2
  }
};

test("creates weapon compendium data with damage and Rebreya attack properties", () => {
  const item = {
    id: "test-spear",
    name: "Test Spear",
    equipmentType: "Оружие",
    priceGoldEquivalent: 1,
    weight: 3,
    weapon: {
      damageFormula: "1d6",
      damageType: "piercing",
      versatileDamageFormula: "1d8",
      properties: ["ver", "thr", "lchDash", "lchMku", "lchRku"],
      range: {
        value: 20,
        long: 60,
        reach: 5,
        units: "ft"
      },
      attackTraitsText: "Наскок 2d2; МКУ 1; РКУ 1",
      attackTraits: {
        mku: 1,
        rku: 1
      },
      lichWeaponPropertyValues: {
        dashDice: "2d2",
        mku: 1,
        rku: 1
      }
    }
  };

  const created = createDnd5eItemData(item, new Map());

  assert.equal(created.type, "weapon");
  assert.equal(created.system.damage.base.number, 1);
  assert.equal(created.system.damage.base.denomination, 6);
  assert.deepEqual(created.system.damage.base.custom, {
    enabled: false,
    formula: ""
  });
  assert.deepEqual(created.system.damage.base.types, ["piercing"]);
  assert.equal(created.system.damage.versatile.number, 1);
  assert.equal(created.system.damage.versatile.denomination, 8);
  assert.deepEqual(created.system.damage.versatile.custom, {
    enabled: false,
    formula: ""
  });
  assert.deepEqual(created.system.properties, ["ver", "thr", "lchDash", "lchMku", "lchRku"]);
  assert.deepEqual(created.system.range, {
    value: 20,
    long: 60,
    reach: 5,
    units: "ft"
  });
  assert.deepEqual(created.flags["rebreya-main"].attackTraits, {
    mku: 1,
    rku: 1
  });
  assert.deepEqual(created.flags["rebreya-main"].lichWeaponPropertyValues, {
    dashDice: "2d2",
    mku: 1,
    rku: 1
  });
  assert.equal(created.flags["rebreya-main"].attackTraitsText, "Наскок 2d2; МКУ 1; РКУ 1");
});

test("real gear weapon data maps spreadsheet damage and properties to system keys", () => {
  const gear = JSON.parse(readFileSync(join(TESTS_DIR, "..", "data", "gear.json"), "utf8").replace(/^\uFEFF/u, ""));
  const byId = new Map(gear.map((item) => [item.id, item]));

  for (const item of gear) {
    const weapon = item.weapon;
    if (!weapon?.damageFormula) {
      continue;
    }

    const expectedDamageType = DAMAGE_TYPE_BY_LABEL.get(weapon.damageTypeLabel);
    assert.ok(expectedDamageType, `${item.id} has unsupported damage type label ${weapon.damageTypeLabel}`);
    assert.equal(weapon.damageType, expectedDamageType, `${item.id} maps ${weapon.damageTypeLabel} to dnd5e damage type`);
  }

  assert.ok(byId.get("kinzhal").weapon.properties.includes("lchDeadly"));
  assert.equal(byId.get("kinzhal").weapon.attackTraits.deadly, 1);
  assert.ok(byId.get("ruchnoy-topor").weapon.properties.includes("lchRku"));
  assert.equal(byId.get("ruchnoy-topor").weapon.attackTraits.rku, 1);
  assert.ok(byId.get("set").weapon.properties.includes("spc"));
  assert.ok(byId.get("arbalet-legkiy").weapon.properties.includes("lod"));
  assert.ok(byId.get("arbalet-legkiy").weapon.properties.includes("lchAim"));
  assert.ok(byId.get("dlinnyy-luk").weapon.properties.includes("lchArcShot"));
  assert.ok(byId.get("molot").weapon.properties.includes("lchPowerStrike"));
  assert.ok(byId.get("molot").weapon.properties.includes("lchPush"));
  assert.ok(byId.get("kavaleriyskaya-pika").weapon.properties.includes("lchMounted"));
});

test("gear stock icons avoid missing Foundry core asset paths", () => {
  const gear = JSON.parse(readFileSync(join(TESTS_DIR, "..", "data", "gear.json"), "utf8").replace(/^\uFEFF/u, ""));
  const byId = new Map(gear.map((item) => [item.id, item]));
  const knownMissingStockIcons = new Set([
    "icons/consumables/potions/potion-bottle-corked-red.webp",
    "icons/containers/bags/pack-simple-brown.webp",
    "icons/equipment/shield/heater-steel-blue.webp",
    "icons/tools/hand/wrench-double-headed.webp",
    "icons/weapons/ammunition/arrows-war-quiver-brown.webp",
    "icons/weapons/guns/gun-pistol-flintlock-blue.webp"
  ]);

  for (const item of gear) {
    const created = createDnd5eItemData(item, new Map());
    assert.ok(
      !knownMissingStockIcons.has(created.img),
      `${item.id} uses missing stock icon path ${created.img}`
    );
  }

  assert.equal(createDnd5eItemData(byId.get("dlinnyy-luk"), new Map()).img, "icons/weapons/bows/longbow-recurve-brown.webp");
  assert.equal(createDnd5eItemData(byId.get("arbalet-legkiy"), new Map()).img, "icons/weapons/crossbows/crossbow-simple-brown.webp");
  assert.equal(createDnd5eItemData(byId.get("prashcha"), new Map()).img, "icons/weapons/slings/slingshot-wood.webp");
  assert.equal(createDnd5eItemData(byId.get("mushket"), new Map()).img, "icons/weapons/guns/gun-pistol-flintlock-metal.webp");
  assert.equal(createDnd5eItemData(byId.get("shchit"), new Map()).img, "icons/equipment/shield/heater-steel-grey.webp");
  assert.equal(createDnd5eItemData(byId.get("ryukzak"), new Map()).img, "icons/containers/bags/pack-simple-leather-brown.webp");
  assert.equal(createDnd5eItemData(byId.get("zel-e-lecheniya-1-go-urovnya"), new Map()).img, "icons/consumables/potions/potion-bottle-corked-labeled-red.webp");
  assert.equal(createDnd5eItemData(byId.get("kollimatornyy-pritsel"), new Map()).img, "icons/tools/hand/wrench-steel-grey.webp");
});

test("normalizes gear without dropping weapon data before compendium sync", () => {
  const weapon = {
    damageFormula: "1d8",
    damageType: "slashing",
    properties: ["ver", "lchGrip"],
    range: {
      value: 0,
      long: 0,
      reach: 5,
      units: "ft"
    },
    lichWeaponPropertyValues: {
      gripModes: "Смена хвата"
    }
  };

  const normalized = normalizeEconomyDataset({
    goods: [],
    regions: [],
    cities: [],
    materials: [],
    reference: {},
    gear: [{
      id: "dlinnyy-mech",
      name: "Длинный меч",
      equipmentType: "Оружие",
      weapon
    }]
  });

  assert.deepEqual(normalized.gear[0].weapon, weapon);
});
