import test from "node:test";
import assert from "node:assert/strict";

import {
  adaptBaseGear,
  buildEquipmentReferenceIndex,
  mergeGearFragments
} from "../tools/equipment-import/adapters/base-gear.mjs";
import { validateEquipmentOverrides } from "../tools/equipment-import/overrides.mjs";

const referenceSnapshot = Object.freeze({
  layout: "raw",
  range: "'_СПРАВОЧНИК_СНАРЯЖЕНИЯ'!A1:Q20",
  values: [
    ["Ключ", "Тип", "Каноническое название", "Цена", "Ранг", "Вес", "Источник", "Строка источника", "Статус", "ID источника", "Тип (сырой)", "Название (сырое)", "Цена (сырая)", "Ранг (сырой)", "Вес (сырой)", "Лист", "Строка", "", "ID для подмены", "Каноническое название", "Ключ ручной позиции", "ID ручной позиции", "Тип", "Название", "Цена", "Ранг", "Вес", "Источник", "Строка каталога"],
    ["оружие|дротик", "Оружие", "Дротик", "5 мм", "0", "1/4 фнт", "Оружие V0.36", "17", "OK", "Оружие V0.36!A17", "Оружие", "Дротик", "5 мм", "0", "1/4 фнт", "Оружие V0.36", "17"],
    ["обвес|коллиматорный прицел", "Обвес", "Коллиматорный прицел", "500 зм", "3", "1 фнт", "Улучшения и обвесы V0.2", "10", "OK", "Улучшения и обвесы V0.2!B10", "Обвес", "Коллиматорный прицел", "500 зм", "3", "1 фнт", "Улучшения и обвесы V0.2", "10"],
    [...Array(20).fill(""), "снаряжение|сундук", "Немагическое снаряжение V0.1!A200", "Снаряжение", "Сундук", "5 зм", "1", "25 фнт", "Каталог (ручное)", "200"]
  ]
});

const baseSnapshot = Object.freeze({
  sheetKey: "baseGear",
  sheetTitle: "Общий компендиум снаряжения V0.1",
  range: "'Общий компендиум снаряжения V0.1'!A1:M806",
  rows: [
    {
      rowNumber: 112,
      sourceIdentity: "Дротик",
      cells: {
        Название: "Дротик",
        "Тип снаряжения": "Оружие",
        "Подтип (магазин)": "Оружейная лавка",
        Цена: "5 мм",
        Ранг: "0",
        Вес: "1/4 фнт",
        Объем: "",
        Вместимость: "",
        Описание: "Деревянное метательное оружие.",
        "Преобладающий материал (источник)": "Железо",
        "Связанный инструмент": "Кузнеца",
        Value: "5",
        "Множественное появление": "1"
      }
    },
    {
      rowNumber: 200,
      sourceIdentity: "Сундук",
      cells: {
        Название: "Сундук",
        "Тип снаряжения": "Снаряжение",
        "Подтип (магазин)": "Общие товары",
        Цена: "5 зм",
        Ранг: "1",
        Вес: "25 фнт",
        Объем: "10 фнт",
        Вместимость: "300 фнт",
        Описание: "Прочный деревянный сундук.",
        "Преобладающий материал (источник)": "Дерево",
        "Связанный инструмент": "Плотника",
        Value: "12",
        "Множественное появление": "1"
      }
    },
    {
      rowNumber: 300,
      sourceIdentity: "Телега",
      cells: {
        Название: "Телега",
        "Тип снаряжения": "Транспорт",
        Цена: "15 зм",
        Ранг: "1",
        Вес: "—",
        Описание: "Маршрутизируется в transport catalog."
      }
    }
  ]
});

function overrides() {
  return validateEquipmentOverrides({
    schemaVersion: 1,
    identities: {
      gear: {
        "оружие|дротик": "dart",
        "снаряжение|сундук": "chest"
      },
      materials: {
        Железо: "zhelezo",
        Дерево: "derevo"
      }
    },
    enrichment: {
      gear: {
        chest: {
          foundryType: "container",
          containerCapacity: 300
        }
      }
    }
  }, {
    allowedEnrichmentFields: {
      gear: ["foundryType", "containerCapacity"],
      materials: []
    }
  });
}

test("reference index resolves only exact canonical source keys and source coordinates", () => {
  const index = buildEquipmentReferenceIndex({
    snapshots: { equipmentReferences: referenceSnapshot },
    overrides: overrides()
  });

  assert.deepEqual(index.gearByKey.get("оружие|дротик"), {
    sourceKey: "оружие|дротик",
    canonicalName: "Дротик",
    equipmentType: "Оружие",
    sourceRef: "Оружие V0.36!A17",
    sheetTitle: "Оружие V0.36",
    rowNumber: 17
  });
  assert.equal(index.gearByKey.has("Дротик"), false);
  assert.equal(
    index.gearByKey.get("обвес|коллиматорный прицел").sourceRef,
    "Улучшения и обвесы V0.2!B10"
  );
  assert.equal(
    index.gearByKey.get("снаряжение|сундук").sourceRef,
    "Общий компендиум снаряжения V0.1!A200"
  );
});

test("base gear adapter maps formatted strings to the current runtime contract", () => {
  const referenceIndex = buildEquipmentReferenceIndex({
    snapshots: { equipmentReferences: referenceSnapshot },
    overrides: overrides()
  });
  const result = adaptBaseGear({
    snapshot: baseSnapshot,
    referenceIndex,
    overrides: overrides(),
    diagnostics: []
  });

  assert.equal(result.items.length, 2);
  assert.equal(result.transportRows.length, 1);
  assert.deepEqual(result.items[0], {
    id: "dart",
    name: "Дротик",
    equipmentType: "Оружие",
    shopSubtype: "Оружейная лавка",
    priceText: "5 мм",
    priceValue: 5,
    priceDenomination: "cp",
    priceGoldEquivalent: 0.05,
    rank: 0,
    weight: 0.25,
    volume: "",
    capacity: "",
    description: "Деревянное метательное оружие.",
    predominantMaterialId: "zhelezo",
    predominantMaterialName: "Железо",
    linkedTool: "Кузнеца",
    value: "5",
    multipleAppearance: "1",
    source: "equipment-google-sheet",
    sourceIdentity: "оружие|дротик",
    sourceRef: "Оружие V0.36!A17",
    itemSlot: "",
    heroDollSlots: ""
  });
  assert.equal(result.items[1].id, "chest");
  assert.equal(result.items[1].foundryType, "container");
  assert.equal(result.items[1].containerCapacity, 300);
});

test("base adapter rejects a row without an exact reference join", () => {
  const referenceIndex = buildEquipmentReferenceIndex({
    snapshots: { equipmentReferences: referenceSnapshot },
    overrides: overrides()
  });
  const invalid = {
    ...baseSnapshot,
    rows: [{
      ...baseSnapshot.rows[0],
      cells: { ...baseSnapshot.rows[0].cells, Название: "Дротик переименованный" }
    }]
  };

  assert.throws(
    () => adaptBaseGear({ snapshot: invalid, referenceIndex, overrides: overrides(), diagnostics: [] }),
    (error) => {
      assert.equal(error.diagnostics[0].code, "missing-equipment-reference");
      assert.match(error.diagnostics[0].message, /missing exact equipment reference/i);
      return true;
    }
  );
});

test("gear fragment merge rejects two adapters owning the same field", () => {
  assert.throws(
    () => mergeGearFragments({
      baseItems: [{ id: "dart", name: "Дротик" }],
      fragmentsByAdapter: {
        weapons: new Map([["dart", { weapon: { damage: "1d4" } }]]),
        explosives: new Map([["dart", { weapon: { damage: "2d4" } }]])
      },
      diagnostics: []
    }),
    (error) => {
      assert.equal(error.diagnostics[0].code, "gear-field-ownership-conflict");
      assert.match(error.diagnostics[0].message, /field ownership conflict/i);
      return true;
    }
  );
});
