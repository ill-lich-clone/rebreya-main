import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDnd5eItemData } from "../scripts/data/gear-compendium.js";
import { buildNamedIconLookup } from "../scripts/data/compendium-utils.js";
import { normalizeEconomyDataset } from "../scripts/data/normalizer.js";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const EQUIPMENT_PACK_CONTENTS = {
  "nabor-artista": [
    ["spal-nik", 1],
    ["odezhda-kostyum", 2],
    ["svecha", 5],
    ["ratsiony-1-den", 5],
    ["burdyuk", 1],
    ["instrumenty-grimyora-0-y-rang", 1]
  ],
  "nabor-vzlomshchika": [
    ["metallicheskie-shariki-1-000-sht-v-sumke", 1],
    ["leska-10-futov", 1],
    ["kolokol-chik", 1],
    ["svecha", 5],
    ["lomik", 1],
    ["molotok", 1],
    ["shlyambur", 10],
    ["fonar-zakrytyy", 1],
    ["maslo-flyaga", 2],
    ["ratsiony-1-den", 5],
    ["trutnitsa", 1],
    ["burdyuk", 1],
    ["veryovka-pen-kovaya-50-futov", 1]
  ],
  "nabor-diplomata": [
    ["konteyner-dlya-kart-i-svitkov", 2],
    ["odezhda-otlichnaya", 1],
    ["chernila-butylochka-30-gramm", 1],
    ["pischee-pero", 1],
    ["lampa", 1],
    ["maslo-flyaga", 2],
    ["bumaga-odin-list", 5],
    ["dukhi-flakon", 1],
    ["vosk", 1],
    ["mylo", 1]
  ],
  "nabor-issledovatelya-podzemeliy": [
    ["lomik", 1],
    ["molotok", 1],
    ["shlyambur", 10],
    ["fakel", 10],
    ["trutnitsa", 1],
    ["ratsiony-1-den", 10],
    ["burdyuk", 1],
    ["veryovka-pen-kovaya-50-futov", 1]
  ],
  "nabor-puteshestvennika": [
    ["spal-nik", 1],
    ["stolovyy-nabor", 1],
    ["trutnitsa", 1],
    ["fakel", 10],
    ["ratsiony-1-den", 10],
    ["burdyuk", 1],
    ["veryovka-pen-kovaya-50-futov", 1]
  ],
  "nabor-svyashchennika": [
    ["odeyalo", 1],
    ["svecha", 10],
    ["trutnitsa", 1],
    ["korobka-dlya-pozhertvovaniy", 1],
    ["blagovoniya-upakovka", 2],
    ["kadilo", 1],
    ["oblachenie", 1],
    ["ratsiony-1-den", 2],
    ["burdyuk", 1]
  ],
  "nabor-uchyonogo": [
    ["nauchnaya-kniga", 1],
    ["chernila-butylochka-30-gramm", 1],
    ["pischee-pero", 1],
    ["pergament-odin-list", 10],
    ["sumochka-s-peskom", 1],
    ["nozh-nebolshoy", 1]
  ]
};
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

test("gear custom icons override stock fallbacks by item name", () => {
  const gear = JSON.parse(readFileSync(join(TESTS_DIR, "..", "data", "gear.json"), "utf8").replace(/^\uFEFF/u, ""));
  const byId = new Map(gear.map((item) => [item.id, item]));
  const iconLookup = new Map([
    ["абак", "modules/rebreya-main/templates/icons/Goods/%D0%90%D0%B1%D0%B0%D0%BA.webp"],
    ["мушкет", "modules/rebreya-main/templates/icons/weapons/%D0%9C%D1%83%D1%88%D0%BA%D0%B5%D1%82.webp"]
  ]);

  assert.equal(
    createDnd5eItemData(byId.get("abak"), new Map(), iconLookup).img,
    "modules/rebreya-main/templates/icons/Goods/%D0%90%D0%B1%D0%B0%D0%BA.webp"
  );
  assert.equal(
    createDnd5eItemData(byId.get("mushket"), new Map(), iconLookup).img,
    "modules/rebreya-main/templates/icons/weapons/%D0%9C%D1%83%D1%88%D0%BA%D0%B5%D1%82.webp"
  );
});

test("gear custom icons can match shortened and type-qualified item names", () => {
  const gear = JSON.parse(readFileSync(join(TESTS_DIR, "..", "data", "gear.json"), "utf8").replace(/^\uFEFF/u, ""));
  const byId = new Map(gear.map((item) => [item.id, item]));
  const iconLookup = new Map([
    ["алхимический огонь", "modules/rebreya-main/templates/icons/Goods/%D0%90%D0%BB%D1%85%D0%B8%D0%BC%D0%B8%D1%87%D0%B5%D1%81%D0%BA%D0%B8%D0%B9%20%D0%BE%D0%B3%D0%BE%D0%BD%D1%8C.webp"],
    ["коготь чудовища имплант", "modules/rebreya-main/templates/icons/Goods/%D0%9A%D0%BE%D0%B3%D0%BE%D1%82%D1%8C%20%D1%87%D1%83%D0%B4%D0%BE%D0%B2%D0%B8%D1%89%D0%B0%20(%D0%B8%D0%BC%D0%BF%D0%BB%D0%B0%D0%BD%D1%82).webp"],
    ["коготь чудовища усовершенствование", "modules/rebreya-main/templates/icons/Goods/%D0%9A%D0%BE%D0%B3%D0%BE%D1%82%D1%8C%20%D1%87%D1%83%D0%B4%D0%BE%D0%B2%D0%B8%D1%89%D0%B0%20(%D1%83%D1%81%D0%BE%D0%B2%D0%B5%D1%80%D1%88%D0%B5%D0%BD%D1%81%D1%82%D0%B2%D0%BE%D0%B2%D0%B0%D0%BD%D0%B8%D0%B5).webp"]
  ]);

  assert.equal(
    createDnd5eItemData(byId.get("alkhimicheskiy-ogon-flyaga"), new Map(), iconLookup).img,
    "modules/rebreya-main/templates/icons/Goods/%D0%90%D0%BB%D1%85%D0%B8%D0%BC%D0%B8%D1%87%D0%B5%D1%81%D0%BA%D0%B8%D0%B9%20%D0%BE%D0%B3%D0%BE%D0%BD%D1%8C.webp"
  );
  assert.equal(
    createDnd5eItemData(byId.get("kogot-chudovishcha"), new Map(), iconLookup).img,
    "modules/rebreya-main/templates/icons/Goods/%D0%9A%D0%BE%D0%B3%D0%BE%D1%82%D1%8C%20%D1%87%D1%83%D0%B4%D0%BE%D0%B2%D0%B8%D1%89%D0%B0%20(%D0%B8%D0%BC%D0%BF%D0%BB%D0%B0%D0%BD%D1%82).webp"
  );
  assert.equal(
    createDnd5eItemData(byId.get("kogot-chudovishcha-2"), new Map(), iconLookup).img,
    "modules/rebreya-main/templates/icons/Goods/%D0%9A%D0%BE%D0%B3%D0%BE%D1%82%D1%8C%20%D1%87%D1%83%D0%B4%D0%BE%D0%B2%D0%B8%D1%89%D0%B0%20(%D1%83%D1%81%D0%BE%D0%B2%D0%B5%D1%80%D1%88%D0%B5%D0%BD%D1%81%D1%82%D0%B2%D0%BE%D0%B2%D0%B0%D0%BD%D0%B8%D0%B5).webp"
  );
});

test("nested Goods icon paths stay URL encoded in named icon lookup", async () => {
  const originalFilePicker = globalThis.FilePicker;
  globalThis.FilePicker = function MockFilePicker() {
  };
  globalThis.FilePicker.browse = async (_source, path) => {
    assert.equal(path, "modules/rebreya-main/templates/icons/Goods");
    return {
      files: ["modules/rebreya-main/templates/icons/Goods/Абак.webp"],
      dirs: []
    };
  };

  try {
    const iconLookup = await buildNamedIconLookup(["modules/rebreya-main/templates/icons/Goods"], { forceRefresh: true });
    assert.equal(
      iconLookup.get("абак"),
      "modules/rebreya-main/templates/icons/Goods/%D0%90%D0%B1%D0%B0%D0%BA.webp"
    );
  }
  finally {
    globalThis.FilePicker = originalFilePicker;
  }
});

test("gear data defines D&D equipment packs as Rebreya containers", () => {
  const gear = JSON.parse(readFileSync(join(TESTS_DIR, "..", "data", "gear.json"), "utf8").replace(/^\uFEFF/u, ""));
  const byId = new Map(gear.map((item) => [item.id, item]));

  for (const [packId, expectedContents] of Object.entries(EQUIPMENT_PACK_CONTENTS)) {
    const pack = byId.get(packId);
    assert.ok(pack, `${packId} exists`);
    assert.equal(pack.foundryType, "container", `${packId} is a dnd5e container`);
    assert.equal(pack.foundrySubtype, packId === "nabor-diplomata" ? "chest" : "backpack");
    assert.ok(pack.containerCapacity?.weight > 0, `${packId} has weight capacity`);
    assert.deepEqual(
      pack.containerContents.map((entry) => [entry.gearId, entry.quantity ?? 1]),
      expectedContents,
      `${packId} contains the expected Rebreya item ids`
    );

    for (const [gearId] of expectedContents) {
      assert.ok(byId.has(gearId), `${packId} references existing Rebreya gear ${gearId}`);
    }
  }
});

test("creates container compendium data with dnd5e capacity and Rebreya contents flag", () => {
  const created = createDnd5eItemData({
    id: "test-pack",
    name: "Test Pack",
    equipmentType: "Наборы снаряжения",
    foundryType: "container",
    foundrySubtype: "backpack",
    priceGoldEquivalent: 12,
    weight: 5,
    containerCapacity: {
      weight: 30,
      units: "lb"
    },
    containerContents: [
      { gearId: "svecha", quantity: 5 }
    ]
  }, new Map());

  assert.equal(created.type, "container");
  assert.equal(created.img, "icons/containers/bags/pack-simple-leather-brown.webp");
  assert.equal(created.system.type.value, "backpack");
  assert.equal(created.system.capacity.weight.value, 30);
  assert.equal(created.system.capacity.weight.units, "lb");
  assert.deepEqual(created.flags["rebreya-main"].containerContents, [
    { gearId: "svecha", quantity: 5 }
  ]);
});

test("creates contained compendium documents linked to their parent container", async () => {
  const module = await import("../scripts/data/gear-compendium.js");

  assert.equal(typeof module.createDnd5eContainerContentData, "function");

  const docs = module.createDnd5eContainerContentData(
    {
      id: "test-pack",
      name: "Test Pack",
      containerContents: [
        { gearId: "svecha", quantity: 5 }
      ]
    },
    new Map([[
      "svecha",
      {
        id: "svecha",
        name: "Свеча",
        equipmentType: "Снаряжение",
        priceGoldEquivalent: 0.01,
        weight: 0
      }
    ]]),
    "parentContainerId",
    new Map()
  );

  assert.equal(docs.length, 1);
  assert.equal(docs[0].name, "Свеча");
  assert.equal(docs[0].system.quantity, 5);
  assert.equal(docs[0].system.container, "parentContainerId");
  assert.equal(docs[0].flags["rebreya-main"].sourceType, "gearContainerContent");
  assert.equal(docs[0].flags["rebreya-main"].containerGearId, "test-pack");
  assert.equal(docs[0].flags["rebreya-main"].containerContentGearId, "svecha");
  assert.equal(docs[0].flags["rebreya-main"].gearId, undefined);
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
