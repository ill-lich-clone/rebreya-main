import test from "node:test";
import assert from "node:assert/strict";

import * as importer from "../scripts/data/importer.js";
import { DATA_SOURCE_MODES, MODULE_ID, SETTINGS_KEYS } from "../scripts/constants.js";
import { normalizeEconomyDataset } from "../scripts/data/normalizer.js";

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => JSON.parse(JSON.stringify(value))
  }
};

test("upgrade profile enriches one canonical base product without replacing its base fields", () => {
  const baseProduct = {
    id: "serebrenie-oruzhiya",
    name: "Серебрение оружия",
    equipmentType: "Усовершенствование",
    priceText: "125 зм",
    priceGoldEquivalent: 125,
    description: "Базовое описание готового продукта.",
    predominantMaterialId: "serebro",
    predominantMaterialName: "Серебро"
  };
  const upgrade = {
    name: "Серебро",
    canonicalName: "Серебрение оружия",
    upgrade: {
      rank: 2,
      appliesTo: "Оружие",
      effect: "Оружие считается магическим против нежити и исчадий.",
      priceGold: 125,
      sourceMaterialName: "Серебро",
      type: "Материал"
    }
  };

  const merged = importer.mergeGearCatalogExtensions?.(
    [baseProduct],
    { upgrades: [upgrade] }
  );

  assert.deepEqual(merged, [{
    ...baseProduct,
    upgrade: upgrade.upgrade
  }]);
});

test("orphan upgrade profile stops catalog generation with a structured issue", () => {
  const orphan = {
    name: "Неизвестный материал",
    canonicalName: "Отсутствующий продукт",
    upgrade: {
      effect: "Эта механика не должна потеряться молча."
    }
  };

  assert.throws(
    () => importer.mergeGearCatalogExtensions([], { upgrades: [orphan] }),
    (error) => {
      assert.equal(error.name, "GearCatalogIntegrityError");
      assert.deepEqual(error.issues, [{
        kind: "orphan",
        profile: "upgrade",
        sourceName: "Неизвестный материал",
        canonicalName: "Отсутствующий продукт"
      }]);
      return true;
    }
  );
});

test("ambiguous canonical product match reports every candidate instead of choosing one", () => {
  const duplicateProducts = [
    { id: "silvering-a", name: "Серебрение оружия" },
    { id: "silvering-b", name: "  серебрение   ОРУЖИЯ " }
  ];
  const upgrade = {
    name: "Серебро",
    canonicalName: "Серебрение оружия",
    upgrade: { effect: "Механика серебрения." }
  };

  assert.throws(
    () => importer.mergeGearCatalogExtensions(duplicateProducts, { upgrades: [upgrade] }),
    (error) => {
      assert.equal(error.name, "GearCatalogIntegrityError");
      assert.deepEqual(error.issues, [{
        kind: "ambiguous",
        profile: "upgrade",
        sourceName: "Серебро",
        canonicalName: "Серебрение оружия",
        candidateIds: ["silvering-a", "silvering-b"]
      }]);
      return true;
    }
  );
});

test("unified catalog extension merge keeps the existing implant enrichment behavior", () => {
  const baseImplant = {
    id: "implant-eye",
    name: "Искусственный глаз",
    equipmentType: "Имплант",
    description: "Базовое описание импланта."
  };
  const implantProfile = {
    id: "implant-eye",
    name: "Искусственный глаз",
    foundryType: "equipment",
    itemSlot: "eye",
    implant: {
      effect: "Позволяет видеть в темноте."
    }
  };

  const merged = importer.mergeGearCatalogExtensions(
    [baseImplant],
    { implants: [implantProfile] }
  );

  assert.deepEqual(merged, [{
    ...baseImplant,
    foundryType: "equipment",
    itemSlot: "eye",
    implant: implantProfile.implant
  }]);
});

test("economy normalization preserves the merged upgrade mechanics", () => {
  const upgrade = {
    rank: 2,
    appliesTo: "Оружие",
    effect: "Оружие считается магическим против нежити и исчадий.",
    priceGold: 125,
    sourceMaterialName: "Серебро",
    type: "Материал"
  };

  const dataset = normalizeEconomyDataset({
    goods: [],
    regions: [],
    cities: [],
    reference: {},
    materials: [],
    gear: [{
      id: "serebrenie-oruzhiya",
      name: "Серебрение оружия",
      equipmentType: "Усовершенствование",
      upgrade
    }]
  });

  assert.deepEqual(dataset.gear[0].upgrade, upgrade);
});

test("builtin dataset loader reads upgrade profiles and merges them into base gear", async () => {
  const baseProduct = {
    id: "serebrenie-oruzhiya",
    name: "Серебрение оружия",
    equipmentType: "Усовершенствование",
    description: "Базовое описание.",
    priceGoldEquivalent: 125
  };
  const upgradeProfile = {
    name: "Серебро",
    canonicalName: "Серебрение оружия",
    upgrade: {
      effect: "Оружие считается магическим против нежити и исчадий."
    }
  };
  const payloadByFile = new Map([
    ["goods.json", []],
    ["regions.json", []],
    ["cities.json", []],
    ["reference.json", {}],
    ["materials.json", []],
    ["gear.json", [baseProduct]],
    ["implants.json", []],
    ["upgrades.json", [upgradeProfile]]
  ]);
  const originalGame = globalThis.game;
  const originalFetch = globalThis.fetch;
  globalThis.game = {
    settings: {
      get(moduleId, key) {
        assert.equal(moduleId, MODULE_ID);
        if (key === SETTINGS_KEYS.DATA_SOURCE_MODE) return DATA_SOURCE_MODES.BUILTIN;
        if (key === SETTINGS_KEYS.CUSTOM_DATA_PATH) return "";
        return undefined;
      }
    }
  };
  globalThis.fetch = async (path) => {
    const fileName = String(path).split("/").at(-1);
    if (!payloadByFile.has(fileName)) {
      throw new Error(`Unexpected data request: ${path}`);
    }
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => JSON.parse(JSON.stringify(payloadByFile.get(fileName)))
    };
  };

  try {
    const dataset = await importer.loadEconomyDataset();
    assert.deepEqual(dataset.gear, [{
      id: baseProduct.id,
      name: baseProduct.name,
      equipmentType: baseProduct.equipmentType,
      shopSubtype: "",
      priceText: "",
      priceValue: 0,
      priceDenomination: "",
      priceGoldEquivalent: 125,
      rank: 0,
      weight: 0,
      volume: "",
      capacity: "",
      containerCapacity: null,
      containerContents: [],
      description: baseProduct.description,
      predominantMaterialId: null,
      predominantMaterialName: "",
      linkedTool: "",
      value: "",
      foundryType: "",
      foundrySubtype: "",
      foundrySubtypeExtra: "",
      foundryBaseItem: "",
      foundryFolder: "",
      itemSlot: "",
      heroDollSlots: [],
      firearmClass: "",
      weapon: null,
      armor: null,
      implant: null,
      upgrade: upgradeProfile.upgrade,
      source: "gear-workbook"
    }]);
  }
  finally {
    globalThis.game = originalGame;
    globalThis.fetch = originalFetch;
  }
});
