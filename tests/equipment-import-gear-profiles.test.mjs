import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { adaptArmorProfiles } from "../tools/equipment-import/adapters/armor.mjs";
import { adaptAmmunitionProfiles } from "../tools/equipment-import/adapters/ammunition.mjs";
import { adaptExplosiveProfiles } from "../tools/equipment-import/adapters/explosives.mjs";
import { adaptAttachmentProfiles } from "../tools/equipment-import/adapters/attachments.mjs";
import { adaptUpgradeCatalog } from "../tools/equipment-import/adapters/upgrades.mjs";

const fixtureRoot = new URL("./fixtures/equipment-import/", import.meta.url);
const rawFixtures = JSON.parse(await readFile(new URL("gear-profiles-raw.json", fixtureRoot), "utf8"));
const expectedFixtures = JSON.parse(await readFile(new URL("gear-profiles-expected.json", fixtureRoot), "utf8"));

function referenceIndex() {
  const reference = {
    sourceRef: "Доспехи V0.1!A4",
    sourceKey: "доспех|стеганый доспех",
    canonicalName: "Стёганый доспех"
  };
  return {
    gearBySourceRef: new Map([[reference.sourceRef, reference]]),
    resolveStableGearId: () => "steganyy-dospekh"
  };
}

const paddedSnapshot = rawFixtures.paddedArmor;

test("armor adapter returns the exact current padded armor profile", () => {
  const fragments = adaptArmorProfiles({ snapshot: paddedSnapshot, referenceIndex: referenceIndex(), diagnostics: [] });
  assert.deepEqual(Object.fromEntries(fragments), expectedFixtures.paddedArmor);
});

test("armor adapter rejects unknown sections, malformed AC, and illegal dex caps", () => {
  for (const mutate of [
    (source) => { source.rows[0].cells.Название = "Сверхброня"; },
    (source) => { source.rows[1].cells["Класс доспеха (КД)"] = "примерно 11"; },
    (source) => { source.rows[1].cells["Класс доспеха (КД)"] = "11 + модификатор ЛОВ (макс. -2)"; }
  ]) {
    const invalid = structuredClone(paddedSnapshot);
    mutate(invalid);
    assert.throws(() => adaptArmorProfiles({ snapshot: invalid, referenceIndex: referenceIndex(), diagnostics: [] }));
  }
});

test("armor adapter rejects dangling source/base-item references", () => {
  const noSource = referenceIndex();
  noSource.gearBySourceRef.clear();
  assert.throws(
    () => adaptArmorProfiles({ snapshot: paddedSnapshot, referenceIndex: noSource, diagnostics: [] }),
    (error) => error.diagnostics?.[0]?.code === "missing-equipment-reference"
  );

  const unknownItem = structuredClone(paddedSnapshot);
  unknownItem.rows[1].cells.Название = "Неизвестный лёгкий доспех";
  assert.throws(
    () => adaptArmorProfiles({ snapshot: unknownItem, referenceIndex: referenceIndex(), diagnostics: [] }),
    (error) => error.diagnostics?.some((entry) => entry.code === "dangling-armor-base-item")
  );
});

function ammunitionReferenceIndex() {
  const entries = [
    ["Боеприпасы!B4", "mushketnyy-patron-20"],
    ["Боеприпасы!B20", "standartnyy-10"],
    ["Боеприпасы!H3", "broneboynyy-10"],
    ["Особые боеприпасы!B4", "obsolete-broneboynye-puli-10"],
    ["Боеприпасы!H4", "obsolete-broneboynye-puli-10"],
    ["Боеприпасы!H5", "obolochennye-puli-10"]
  ];
  const gearBySourceRef = new Map(entries.map(([sourceRef]) => [sourceRef, { sourceRef, sourceKey: sourceRef }]));
  const ids = new Map(entries);
  return {
    gearBySourceRef,
    gearByKey: new Map([["боеприпас|оболоченная (10)", gearBySourceRef.get("Боеприпасы!H5")]]),
    resolveStableGearId: (reference) => ids.get(reference.sourceRef)
  };
}

const ammunitionSnapshots = {
  ammunition: {
    sheetKey: "ammunition",
    sheetTitle: "Боеприпасы",
    range: "'Боеприпасы'!B1:G1005",
    layout: "raw",
    values: [
      [], [],
      ["Боеприпас", "Цена", "Ранг", "Используется", "Вес"],
      ["Мушкетный патрон (20) Колющий урон", "20 ЗМ", "1", "Мушкеты, кремнивые пистолеты, многоствольные кремнивые пистолеты, аркебузы, колесцовые оружия", "1 фнт"],
      ...Array.from({ length: 15 }, () => []),
      ["Стандартный (10)", "50 зм", "", "2d6 колющий, 1d6 разброс", "13 фнт", "Для ручницы все кости урона на одну категорию меньше"]
    ]
  },
  specialAmmunition: {
    sheetKey: "specialAmmunition",
    sheetTitle: "Особые боеприпасы",
    range: "'Особые боеприпасы'!B2:H1000",
    rows: [{
      rowNumber: 4,
      sourceIdentity: "Бронебойный (10)",
      cells: {
        Боеприпас: "Бронебойный (10)", Цена: "500 ЗМ", Ранг: "", Заменяет: "Мушкетный и Винтовочные",
        Вес: "1 фнт", Свойства: "Игнорируют 2 БУ и БС у доспеха цели", "Осечка при крафте": "3"
      }
    }]
  }
};

test("ammunition adapter types quantity, damage modifiers, and declared compatibility references", () => {
  const fragments = adaptAmmunitionProfiles({
    snapshot: ammunitionSnapshots,
    referenceIndex: ammunitionReferenceIndex(),
    diagnostics: []
  });
  assert.deepEqual(fragments.get("mushketnyy-patron-20"), { ammunition: {
    kind: "standard", quantity: 20, damageModifiers: [], damageType: "piercing",
    compatibility: ["musket", "flintlock-pistol", "multibarrel-flintlock-pistol", "arquebus", "wheellock"],
    replaces: [], propertiesText: "", craftMisfire: null, handCannonDamageDieStep: 0
  } });
  assert.deepEqual(fragments.get("standartnyy-10"), { ammunition: {
    kind: "handCannon", quantity: 10,
    damageModifiers: [{ formula: "2d6", type: "piercing" }, { formula: "1d6", type: "scatter" }],
    damageType: null, compatibility: ["hand-grenade-launcher", "hand-cannon"], replaces: [],
    propertiesText: "2d6 колющий, 1d6 разброс", craftMisfire: null, handCannonDamageDieStep: -1
  } });
  assert.deepEqual(fragments.get("broneboynyy-10"), { ammunition: {
    kind: "special", quantity: 10, damageModifiers: [], damageType: null, compatibility: [],
    replaces: ["musket", "rifle"], propertiesText: "Игнорируют 2 БУ и БС у доспеха цели",
    craftMisfire: 3, handCannonDamageDieStep: 0
  } });
});

test("special ammunition resolves its exact canonical name before stale legacy coordinates", () => {
  const referenceIndex = ammunitionReferenceIndex();
  const snapshot = {
    ammunition: { ...ammunitionSnapshots.ammunition, values: [] },
    specialAmmunition: {
      ...ammunitionSnapshots.specialAmmunition,
      rows: [{
        rowNumber: 5,
        sourceIdentity: "Оболоченная (10)",
        cells: {
          Боеприпас: "Оболоченная (10)", Цена: "500 ЗМ", Ранг: "", Заменяет: "Мушкетный и Винтовочные",
          Вес: "1 фнт", Свойства: "Универсальная оболоченная пуля", "Осечка при крафте": "2"
        }
      }]
    }
  };

  const fragments = adaptAmmunitionProfiles({ snapshot, referenceIndex, diagnostics: [] });
  assert.equal(fragments.get("obolochennye-puli-10").ammunition.kind, "special");
  assert.equal(fragments.has("obsolete-broneboynye-puli-10"), false);
});

test("ammunition adapter reads the unified V0.1 table from canonical A-column references", () => {
  const entries = [
    ["Боеприпасы V0.1!A3", "mushketnyy-patron-20"],
    ["Боеприпасы V0.1!A15", "raketnyy-vystrel-standartnyy-10"],
    ["Боеприпасы V0.1!A28", "dyavolskie-boepripasy-20"],
    ["Боеприпасы!H3", "broneboynyy-10"]
  ];
  const gearBySourceRef = new Map(entries.map(([sourceRef]) => [sourceRef, { sourceRef }]));
  const ids = new Map(entries);
  const fragments = adaptAmmunitionProfiles({
    snapshot: {
      ammunition: {
        sheetKey: "ammunition",
        sheetTitle: "Боеприпасы V0.1",
        range: "'Боеприпасы V0.1'!A1:K1000",
        rows: [
          { rowNumber: 3, cells: { Название: "Мушкетный патрон (20)", "Урон 1": "—", "Урон 2": "—", "Тип урона": "—", "Тип урона 2": "—", "Подходящее оружие": "Мушкеты, кремнивые пистолеты, многоствольные кремнивые пистолеты, аркебузы, колесцовые оружия", Эффект: "" } },
          { rowNumber: 15, cells: { Название: "Ракетный выстрел стандартный (10)", "Урон 1": "2к6", "Урон 2": "—", "Тип урона": "колющий", "Тип урона 2": "—", "Подходящее оружие": "Ручной гранатомёт, ручница", Эффект: "Разброс (1к6)." } },
          { rowNumber: 28, cells: { Название: "Дьявольские боеприпасы (20)", "Урон 1": "—", "Урон 2": "—", "Тип урона": "—", "Тип урона 2": "—", "Подходящее оружие": "Оружие, использующее физические боеприпасы", Эффект: "Дополнительный урон небожителям." } }
        ]
      },
      specialAmmunition: ammunitionSnapshots.specialAmmunition
    },
    referenceIndex: { gearBySourceRef, resolveStableGearId: (reference) => ids.get(reference.sourceRef) },
    diagnostics: []
  });

  assert.deepEqual(fragments.get("mushketnyy-patron-20").ammunition.compatibility, ["musket", "flintlock-pistol", "multibarrel-flintlock-pistol", "arquebus", "wheellock"]);
  assert.deepEqual(fragments.get("raketnyy-vystrel-standartnyy-10").ammunition.damageModifiers, [{ formula: "2d6", type: "piercing" }]);
  assert.equal(fragments.get("raketnyy-vystrel-standartnyy-10").ammunition.handCannonDamageDieStep, -1);
  assert.deepEqual(fragments.get("dyavolskie-boepripasy-20").ammunition.compatibility, ["all"]);
  assert.equal(fragments.get("broneboynyy-10").ammunition.kind, "special");
});

test("unified ammunition preserves an unsupported live damage expression as source mechanics", () => {
  const snapshot = {
    ammunition: {
      sheetKey: "ammunition",
      sheetTitle: "Боеприпасы V0.1",
      range: "'Боеприпасы V0.1'!A1:K1000",
      rows: [{
        rowNumber: 20,
        cells: {
          "Название": "Ракетный выстрел поджигающий (10)",
          "Урон 1": "2к6",
          "Урон 2": "6(-2)",
          "Тип урона": "огнём",
          "Тип урона 2": "Затухающий урон огнём",
          "Подходящее оружие": "Ручной гранатомёт, ручница",
          "Эффект": "Разброс."
        }
      }]
    },
    specialAmmunition: { rows: [] }
  };
  const reference = { id: "legacy-id" };
  const referenceIndex = {
    gearBySourceRef: new Map([["Боеприпасы V0.1!A20", reference]]),
    resolveStableGearId: () => "legacy-id"
  };

  const result = adaptAmmunitionProfiles({ snapshot, referenceIndex });
  assert.equal(result.get("legacy-id").ammunition.propertiesText, "Разброс. 6(-2) Затухающий урон огнём");
});

test("ammunition adapter rejects unknown compatibility and malformed damage modifiers", () => {
  const unknown = structuredClone(ammunitionSnapshots);
  unknown.ammunition.values[3][3] = "Неизвестное оружие";
  assert.throws(
    () => adaptAmmunitionProfiles({ snapshot: unknown, referenceIndex: ammunitionReferenceIndex(), diagnostics: [] }),
    (error) => error.diagnostics?.some((entry) => entry.code === "unknown-ammunition-compatibility")
  );
  const malformed = structuredClone(ammunitionSnapshots);
  malformed.ammunition.values[19][3] = "2d6 мусор";
  assert.throws(
    () => adaptAmmunitionProfiles({ snapshot: malformed, referenceIndex: ammunitionReferenceIndex(), diagnostics: [] }),
    (error) => error.diagnostics?.some((entry) => entry.code === "invalid-ammunition-effect")
  );
});

const explosiveSnapshot = {
  sheetKey: "explosives", sheetTitle: "Взрывчатка V0.0", range: "'Взрывчатка V0.0'!A1:N1000",
  rows: [{ rowNumber: 3, sourceIdentity: "Малая Осколочная граната", cells: {
    Название: "Малая Осколочная граната", Урон: "1к4+1к4", "Тип урона": "Колющий и Огонь",
    "Оружейная группа": "Ручная", "Сл взрывчатки": "13", "Радиус взрыва": "10 футов",
    "Время задержки": "Стандарт", "Механизм срабатывания": "—", Обезвреживание: "—",
    Дистанция: "60 футов", "Дополнительные свойства": "Спасбросок Ловкости"
  } }, { rowNumber: 4, sourceIdentity: "", cells: { Название: "", "Дополнительные свойства": "—" } }]
};

function singleReference(sourceRef, stableId) {
  const reference = { sourceRef, sourceKey: sourceRef };
  return { gearBySourceRef: new Map([[sourceRef, reference]]), resolveStableGearId: () => stableId };
}

test("explosive adapter types radius, save, damage, uses, and source properties", () => {
  const fragments = adaptExplosiveProfiles({
    snapshot: explosiveSnapshot,
    referenceIndex: singleReference("Взрывчатка V0.0!A3", "malaya-oskolochnaya-granata"), diagnostics: []
  });
  assert.deepEqual(fragments.get("malaya-oskolochnaya-granata"), { explosive: {
    damage: [{ formula: "1d4", type: "piercing" }, { formula: "1d4", type: "fire" }],
    saveDc: 13, saveAbility: "dex", radius: 10, range: 60, uses: 1,
    deployment: "hand", delay: "Стандарт", trigger: null, disarm: null,
    propertiesText: "Спасбросок Ловкости"
  } });
});

test("explosive adapter rejects mismatched damage terms and unknown deployment", () => {
  const mismatch = structuredClone(explosiveSnapshot);
  mismatch.rows[0].cells.Урон = "1d4";
  assert.throws(
    () => adaptExplosiveProfiles({ snapshot: mismatch, referenceIndex: singleReference("Взрывчатка V0.0!A3", "grenade"), diagnostics: [] }),
    (error) => error.diagnostics?.some((entry) => entry.code === "explosive-damage-arity")
  );
  const unknown = structuredClone(explosiveSnapshot);
  unknown.rows[0].cells["Оружейная группа"] = "Подводная";
  assert.throws(
    () => adaptExplosiveProfiles({ snapshot: unknown, referenceIndex: singleReference("Взрывчатка V0.0!A3", "grenade"), diagnostics: [] }),
    (error) => error.diagnostics?.some((entry) => entry.code === "unknown-explosive-deployment")
  );
});

const attachmentSnapshot = {
  sheetKey: "attachments", sheetTitle: "Улучшения и обвесы V0.2",
  range: "'Улучшения и обвесы V0.2'!A1:AA1010", layout: "raw",
  values: [
    ...Array.from({ length: 8 }, () => []),
    ["", "Коллиматорный прицел", "500 зм", "3", "1 фнт", "Верх", "Игнорирует половину укрытия"],
    ...Array.from({ length: 17 }, () => []),
    ["", "Приклад", "3000 зм", "5", "5 фнт", "Длиноствольное оружие", "", "Бонус +1 к атакам"]
  ]
};

function attachmentReferences() {
  const entries = [["Улучшения и обвесы V0.2!B9", "kollimatornyy-pritsel"], ["Улучшения и обвесы V0.2!B27", "priklad"]];
  const gearBySourceRef = new Map(entries.map(([sourceRef]) => [sourceRef, { sourceRef }]));
  const ids = new Map(entries);
  return { gearBySourceRef, resolveStableGearId: (reference) => ids.get(reference.sourceRef) };
}

test("attachment adapter types slot and compatibility declarations", () => {
  const fragments = adaptAttachmentProfiles({ snapshot: attachmentSnapshot, referenceIndex: attachmentReferences(), diagnostics: [] });
  assert.deepEqual(fragments.get("kollimatornyy-pritsel"), { attachment: {
    kind: "weaponAttachment", slots: { mode: "oneOf", values: ["top"] },
    compatibility: [], propertiesText: "Игнорирует половину укрытия"
  } });
  assert.deepEqual(fragments.get("priklad"), { attachment: {
    kind: "modernizedPart", slots: null, compatibility: ["long-firearm"], propertiesText: "Бонус +1 к атакам"
  } });
});

test("attachment adapter rejects unknown slots and dangling compatibility declarations", () => {
  const slot = structuredClone(attachmentSnapshot);
  slot.values[8][5] = "Приклад";
  assert.throws(
    () => adaptAttachmentProfiles({ snapshot: slot, referenceIndex: attachmentReferences(), diagnostics: [] }),
    (error) => error.diagnostics?.some((entry) => entry.code === "unknown-attachment-slot")
  );
  const compatibility = structuredClone(attachmentSnapshot);
  compatibility.values[26][5] = "Несуществующее оружие";
  assert.throws(
    () => adaptAttachmentProfiles({ snapshot: compatibility, referenceIndex: attachmentReferences(), diagnostics: [] }),
    (error) => error.diagnostics?.some((entry) => entry.code === "missing-attachment-compatibility")
  );
});

const upgradeSnapshot = {
  sheetKey: "upgrades", sheetTitle: "Усовершенствования V0.21", range: "'Усовершенствования V0.21'!A1:G1000",
  rows: [{ rowNumber: 6, sourceIdentity: "Серебро", cells: {
    Название: "Серебро", Ранг: "2", "Применимо к": "Оружие", Эффект: "Считается серебряным оружием.",
    "Цена (зм)": "125 зм", Источник: "Серебро", Тип: "Материал"
  } }]
};

test("upgrade adapter preserves stable product/material identities and typed compatibility", () => {
  const reference = { sourceRef: "Усовершенствования V0.21!A6", sourceKey: "усовершенствование|серебрение оружия", canonicalName: "Серебрение оружия" };
  const referenceIndex = { gearBySourceRef: new Map([[reference.sourceRef, reference]]), resolveStableGearId: () => "serebrenie-oruzhiya" };
  const overrides = { identities: { materials: { Серебро: { id: "serebro", aliases: [] } } }, enrichment: {} };
  assert.deepEqual(adaptUpgradeCatalog({
    snapshot: upgradeSnapshot,
    referenceIndex,
    overrides,
    materials: [{ id: "serebro", name: "Серебро" }],
    diagnostics: []
  }), [{
    name: "Серебро", productId: "serebrenie-oruzhiya", canonicalName: "Серебрение оружия",
    upgrade: {
      rank: 2, appliesTo: "Оружие", compatibility: ["weapon"], effect: "Считается серебряным оружием.",
      priceGold: 125, sourceWeight: null, sourceMaterialName: "Серебро", sourceMaterialId: "serebro",
      type: "Материал", sourceSheet: "Усовершенствования V0.21", sourceSheetRow: 6
    }
  }]);
});

test("upgrade adapter keeps a non-catalog source name without inventing a material id", () => {
  const snapshot = structuredClone(upgradeSnapshot);
  snapshot.rows[0].cells.Источник = "Оркус";
  const reference = { sourceRef: "Усовершенствования V0.21!A6", canonicalName: "Кость Оркуса" };
  const result = adaptUpgradeCatalog({
    snapshot,
    referenceIndex: { gearBySourceRef: new Map([[reference.sourceRef, reference]]), resolveStableGearId: () => "kost-orkusa" },
    overrides: {},
    materials: [{ id: "serebro", name: "Серебро" }],
    diagnostics: []
  });
  assert.equal(result[0].upgrade.sourceMaterialId, null);
  assert.equal(result[0].upgrade.sourceMaterialName, "Оркус");
});

test("upgrade adapter rejects unknown compatibility and missing product references", () => {
  const badCompatibility = structuredClone(upgradeSnapshot);
  badCompatibility.rows[0].cells["Применимо к"] = "Космический корабль";
  assert.throws(
    () => adaptUpgradeCatalog({ snapshot: badCompatibility, referenceIndex: { gearBySourceRef: new Map() }, overrides: {}, diagnostics: [] }),
    (error) => error.diagnostics?.some((entry) => entry.code === "unknown-upgrade-compatibility")
  );
  assert.throws(
    () => adaptUpgradeCatalog({ snapshot: upgradeSnapshot, referenceIndex: { gearBySourceRef: new Map() }, overrides: {}, diagnostics: [] }),
    (error) => error.diagnostics?.some((entry) => entry.code === "missing-equipment-reference")
  );
});

test("upgrade adapter preserves a deliberately blank source effect", () => {
  const blank = structuredClone(upgradeSnapshot);
  blank.rows[0].cells.Эффект = "";
  const reference = { sourceRef: "Усовершенствования V0.21!A6", canonicalName: "Серебрение оружия" };
  const result = adaptUpgradeCatalog({
    snapshot: blank,
    referenceIndex: { gearBySourceRef: new Map([[reference.sourceRef, reference]]), resolveStableGearId: () => "silver" },
    overrides: {}, diagnostics: []
  });
  assert.equal(result[0].upgrade.effect, "");
});
