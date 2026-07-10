import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getClassStartingEquipmentConfig } from "../scripts/data/class-starting-equipment.js";

globalThis.foundry ??= {
  utils: {
    deepClone: (value) => JSON.parse(JSON.stringify(value)),
    getProperty: (object, path) => String(path ?? "").split(".").reduce((value, key) => value?.[key], object)
  }
};

globalThis.CONST ??= {
  DOCUMENT_OWNERSHIP_LEVELS: {
    OBSERVER: 2
  }
};

const {
  buildMinorFeatPool,
  buildClassAdvancement,
  buildFeatureDefinitions,
  buildFeatureUuidMap,
  buildSubclassAdvancements,
  createClassSystem,
  createFeatureEntryData,
  getManagedDocumentCreateOptions,
  createPackMetadata,
  createSubclassSystem,
  normalizeClassCompendiumData
} = await import("../scripts/data/classes-compendium.js");

function loadJson(path) {
  return JSON.parse(readFileSync(join(process.cwd(), path), "utf8").replace(/^\uFEFF/u, ""));
}

function makeUuidMap(definitions) {
  return new Map(definitions.map((definition) => [definition.featureId, `Compendium.world.rebreya-class-features.Item.${definition.documentId ?? definition.identifier}`]));
}

function makeFeatIndexPack(rows) {
  return {
    collection: "world.rebreya-feats",
    getIndex: async () => rows
  };
}

function makeFeatureDocument(definition, uuid) {
  return {
    uuid,
    getFlag: (scope, key) => {
      if (scope !== "rebreya-main") return undefined;
      if (key === "managed") return true;
      if (key === "featureId") return definition.featureId;
      return undefined;
    }
  };
}

function withGamePacks(pack, callback) {
  const previousGame = globalThis.game;
  globalThis.game = {
    packs: {
      get: () => pack
    }
  };

  return Promise.resolve(callback()).finally(() => {
    globalThis.game = previousGame;
  });
}

test("class descriptions render escaped Markdown tables", () => {
  const system = createClassSystem({
    name: "Тест",
    identifier: "table-test",
    hitDie: "d6",
    description: "| A | B |\n| :--- | ---: |\n| <x> | 2 |"
  });

  assert.match(system.description.value, /<table>/u);
  assert.match(system.description.value, /<th>A<\/th>/u);
  assert.match(system.description.value, /&lt;x&gt;/u);
});

test("class data exposes independent cantrip and spell selections", () => {
  const normalized = normalizeClassCompendiumData({
    class: {
      name: "Тестовый кастер",
      identifier: "test-caster",
      hitDie: "d6",
      spellChoices: [
        {
          title: "Заговоры",
          level: 1,
          choices: { 1: { count: 2 } },
          restriction: { level: "0", list: ["class:sorcerer"] },
          spell: { ability: ["cha"], uses: { requireSlot: false } }
        },
        {
          title: "Заклинания",
          level: 1,
          choices: { 1: { count: 2 } },
          restriction: { level: "available", list: ["class:sorcerer"] },
          spell: { ability: ["cha"] }
        }
      ]
    }
  });
  const choices = buildClassAdvancement(normalized.classData, {})
    .filter((entry) => entry.type === "ItemChoice" && entry.configuration.type === "spell");

  assert.equal(choices.length, 2);
  assert.equal(choices[0].configuration.restriction.level, "0");
  assert.deepEqual(choices[1].configuration.restriction.list, ["class:sorcerer"]);
});

test("Sorcerer known-spell choice includes the Rebreya Counterspell UUID", () => {
  const sorcerer = normalizeClassCompendiumData(loadJson("data/sorcerer-rework-v011.json"));
  const choices = buildClassAdvancement(sorcerer.classData, {
    spellUuidById: new Map([["counterspell-rebreya", "Compendium.world.rebreya-spells.Item.counterspell0001"]])
  });
  const knownSpells = choices.find((entry) => (
    entry.type === "ItemChoice" && entry.title === "Известные заклинания"
  ));

  assert.ok(knownSpells);
  assert.equal(knownSpells.configuration.pool.length, 1);
  assert.deepEqual(knownSpells.configuration.pool, [{ uuid: "Compendium.world.rebreya-spells.Item.counterspell0001" }]);
  assert.equal(knownSpells.configuration.choices["5"].count, 1);
});

test("sorcerer packages expose both updated starting-equipment choices", () => {
  const config = getClassStartingEquipmentConfig("sorcerer-rework-v011");

  assert.ok(config);
  assert.deepEqual(config.getPackage("a").items.map((item) => [item.gearId, item.quantity ?? 1]), [
    ["kop-e", 1],
    ["kinzhal", 2],
    ["kristall-fokusirovka", 1],
    ["nabor-issledovatelya-podzemeliy", 1]
  ]);
  assert.deepEqual(config.getPackage("a").currency, { gp: 28 });
  assert.deepEqual(config.getPackage("b").currency, { gp: 50 });
});

test("sorcerer V0.11 is a full Charisma caster with source-table progressions", () => {
  const sorcerer = normalizeClassCompendiumData(loadJson("data/sorcerer-rework-v011.json"));
  const featureDefinitions = buildFeatureDefinitions(sorcerer);
  const featureUuidById = makeUuidMap(featureDefinitions);
  const advancement = buildClassAdvancement(sorcerer.classData, {
    featureUuidById,
    classFeatureEntries: sorcerer.classData.features,
    minorFeatUuids: ["Compendium.world.rebreya-feats.Item.minor"]
  });
  const system = createClassSystem(sorcerer.classData, advancement, sorcerer.sourceLabel);
  const sorceryPoints = sorcerer.classData.scaleAdvancements
    .find((scale) => scale.identifier === "sorcery-points");
  const levelOneGrant = advancement.find((entry) => entry.type === "ItemGrant" && entry.level === 1);
  const subclassChoice = advancement.find((entry) => entry.type === "Subclass");
  const equipmentChoice = advancement.find((entry) => entry.type === "ItemChoice" && entry.title === "Стартовое снаряжение");
  const sandShift = featureDefinitions.find((definition) => definition.name === "Смена диска");
  const sandShiftEntry = createFeatureEntryData(sandShift, new Map(), null, {
    featureUuidById,
    featureDefinitions
  });

  assert.equal(sorcerer.sourceLabel, "ЗоЗТ");
  assert.equal(sorcerer.classData.identifier, "sorcerer-rework-v011");
  assert.equal(system.spellcasting.progression, "full");
  assert.equal(system.spellcasting.ability, "cha");
  assert.equal(sorcerer.classData.spellChoices.length, 2);
  assert.equal(sorceryPoints.progression[20], 153);
  assert.equal(sorcerer.subclasses.length, 10);
  assert.equal(sorcerer.subclasses.some((entry) => entry.name === "Отмеченный феями"), false);
  assert.match(system.description.value, /<table>/u);
  assert.equal(subclassChoice.level, 1);
  assert.equal(levelOneGrant.configuration.items.some((item) => item.uuid === featureUuidById.get("sorcerer-rework-v011::class::sorcerer-origin")), true);
  assert.equal(levelOneGrant.configuration.items.some((item) => item.uuid === featureUuidById.get("sorcerer-rework-v011::class::sorcerer-spellcasting")), true);
  assert.equal(equipmentChoice.configuration.pool.length, 2);
  assert.match(sandShiftEntry.system.description.value, /@UUID\[.*\]\{Проявление духов\}/u);
});

test("barbarian and fighter reworks use the ZoZT source label", () => {
  const barbarian = normalizeClassCompendiumData(loadJson("data/barbarian-rework-v012.json"));
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));

  assert.equal(barbarian.sourceLabel, "ЗоЗТ");
  assert.equal(fighter.sourceLabel, "ЗоЗТ");
  assert.equal(barbarian.runes.length, 0);
  assert.equal(createClassSystem(barbarian.classData, [], barbarian.sourceLabel).source.custom, "ЗоЗТ");
  assert.equal(createClassSystem(barbarian.classData, [], barbarian.sourceLabel).source.book, "ЗоЗТ");
  assert.equal(createClassSystem(fighter.classData, [], fighter.sourceLabel).source.custom, "ЗоЗТ");
  assert.equal(createClassSystem(fighter.classData, [], fighter.sourceLabel).source.book, "ЗоЗТ");
});

test("fighter class-related items carry ZoZT as source book instead of relying on pack root", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const definitions = buildFeatureDefinitions(fighter);
  const feature = definitions.find((definition) => definition.sourceType === "classFeature" && definition.name === "Второе дыхание");
  const featureEntry = createFeatureEntryData(feature, new Map());
  const subclass = fighter.subclasses.find((entry) => entry.name === "Рунный рыцарь");
  const subclassSystem = createSubclassSystem(subclass, fighter.classData.identifier, [], fighter.sourceLabel);

  assert.equal(featureEntry.system.source.book, "ЗоЗТ");
  assert.equal(featureEntry.system.source.custom, "ЗоЗТ");
  assert.equal(subclassSystem.source.book, "ЗоЗТ");
  assert.equal(subclassSystem.source.custom, "ЗоЗТ");
});

test("class compendium pack metadata uses the ZoZT source book", () => {
  const previousGame = globalThis.game;
  globalThis.game = {
    system: {
      id: "dnd5e"
    }
  };

  try {
    const metadata = createPackMetadata({
      name: "rebreya-classes",
      label: "Классы Rebreya",
      itemTypes: ["class"]
    });

    assert.equal(metadata.flags.dnd5e.sourceBook, "ЗоЗТ");
  }
  finally {
    globalThis.game = previousGame;
  }
});

test("fighter data defines dominance dice, fighting styles, maneuvers, and subclasses", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));

  assert.equal(fighter.classData.identifier, "fighter-rework-v028");
  assert.equal(fighter.classData.hitDie, "d10");
  assert.equal(fighter.classData.features.some((feature) => feature.name === "Стиль доминирования"), true);
  assert.equal(fighter.classData.features.some((feature) => feature.name === "Воинская мультиатака"), false);
  assert.deepEqual(
    fighter.classData.features
      .filter((feature) => feature.name.startsWith("Воинская мультиатака:"))
      .map((feature) => feature.name),
    [
      "Воинская мультиатака: Всплеск действий",
      "Воинская мультиатака: Разрушитель орд",
      "Воинская мультиатака: Стойкий защитник"
    ]
  );
  assert.equal(fighter.fightingStyles.length, 12);
  assert.equal(fighter.maneuvers.length, 24);
  assert.equal(fighter.runes.length, 6);
  assert.equal(fighter.maneuvers.some((maneuver) => maneuver.name === "Активное уклонение"), true);
  assert.equal(fighter.maneuvers.some((maneuver) => maneuver.name === "Отвлекающий удар"), true);
  assert.equal(fighter.subclasses.length, 9);
  assert.deepEqual(fighter.dominanceProgression, {
    dice: { "1": 2, "5": 3, "9": 4, "13": 5, "17": 6 },
    die: { "1": "d4", "9": "d6", "16": "d8" }
  });
});

test("fighter class suppresses PDF starting equipment in favor of preset package choices", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const system = createClassSystem(fighter.classData, [], fighter.sourceLabel);

  assert.equal(system.wealth, "5d4*10");
  assert.deepEqual(system.startingEquipment, []);
});

test("fighter advancements grant armor and weapon proficiencies natively", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const advancement = buildClassAdvancement(fighter.classData, {});
  const grants = new Set(
    advancement
      .filter((entry) => entry.type === "Trait")
      .flatMap((entry) => entry.configuration?.grants ?? [])
  );

  for (const grant of ["armor:lgt", "armor:med", "armor:hvy", "armor:shl", "weapon:sim", "weapon:mar"]) {
    assert.ok(grants.has(grant), `${grant} should be granted by the fighter class`);
  }
});

test("fighter feature definitions include three preset starting equipment packages", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const packageDefinitions = buildFeatureDefinitions(fighter)
    .filter((definition) => definition.sourceType === "fighterStartingEquipmentPackage");

  assert.deepEqual(packageDefinitions.map((definition) => definition.name), [
    "А) Кольчуга, двуручный меч, цеп, 8 метательных копий, набор исследователя подземелий и 4 зм",
    "Б) Проклёпанная кожана, скимитар, короткий меч, длинный лук, 20 стрел, колчан, набор исследователя подземелий и 11 зм",
    "В) 155 зм"
  ]);
  assert.deepEqual(
    packageDefinitions[0].startingEquipmentPackage.items.map((item) => [item.gearId, item.quantity ?? 1]),
    [
      ["kol-chuga", 1],
      ["dvuruchnyy-mech", 1],
      ["tsep", 1],
      ["kop-e", 8],
      ["nabor-issledovatelya-podzemeliy", 1]
    ]
  );
  assert.deepEqual(packageDefinitions[0].startingEquipmentPackage.currency, { gp: 4 });
  assert.deepEqual(
    packageDefinitions[1].startingEquipmentPackage.items.map((item) => [item.gearId, item.quantity ?? 1]),
    [
      ["proklyopannyy-kozhanyy-dospekh", 1],
      ["skimitar", 1],
      ["korotkiy-mech", 1],
      ["dlinnyy-luk", 1],
      ["strely-20", 1],
      ["kolchan", 1],
      ["nabor-issledovatelya-podzemeliy", 1]
    ]
  );
  assert.deepEqual(packageDefinitions[1].startingEquipmentPackage.currency, { gp: 11 });
  assert.deepEqual(packageDefinitions[2].startingEquipmentPackage.items, []);
  assert.deepEqual(packageDefinitions[2].startingEquipmentPackage.currency, { gp: 155 });
});

test("fighter advancements expose one native item choice for preset starting equipment packages", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const featureDefinitions = buildFeatureDefinitions(fighter);
  const packageDefinitions = featureDefinitions
    .filter((definition) => definition.sourceType === "fighterStartingEquipmentPackage");
  const featureUuidById = makeUuidMap(featureDefinitions);
  const advancement = buildClassAdvancement(fighter.classData, {
    featureUuidById
  });
  const equipmentChoices = advancement.filter((entry) => entry.type === "ItemChoice" && entry.configuration?.type === null);

  assert.equal(equipmentChoices.length, 1);
  assert.equal(equipmentChoices[0].title, "Стартовое снаряжение");
  assert.equal(equipmentChoices[0].level, 1);
  assert.equal(equipmentChoices[0].configuration.allowDrops, false);
  assert.match(equipmentChoices[0].hint, /Выберите А, Б или В:/u);
  assert.match(equipmentChoices[0].hint, /А\) Кольчуга/u);
  assert.match(equipmentChoices[0].hint, /Б\) Проклёпанная кожана/u);
  assert.match(equipmentChoices[0].hint, /В\) 155 зм/u);
  assert.deepEqual(equipmentChoices[0].value, { added: { "1": {} }, replaced: {} });

  assert.deepEqual(
    equipmentChoices[0].configuration.pool.map((poolEntry) => poolEntry.uuid),
    packageDefinitions.map((definition) => featureUuidById.get(definition.featureId))
  );
});

test("fighter advancements expose dominance scales and a fighting style choice", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const featureDefinitions = buildFeatureDefinitions(fighter);
  const advancement = buildClassAdvancement(fighter.classData, {
    featureUuidById: makeUuidMap(featureDefinitions),
    classFeatureEntries: fighter.classData.features,
    minorFeatUuids: ["Compendium.world.rebreya-feats.Item.minor"],
    maneuverEntries: fighter.maneuvers,
    fightingStyleEntries: fighter.fightingStyles,
    dominanceProgression: fighter.dominanceProgression
  });

  const dominanceDice = advancement.find((entry) => entry.type === "ScaleValue" && entry.configuration.identifier === "dominance-dice");
  const dominanceDie = advancement.find((entry) => entry.type === "ScaleValue" && entry.configuration.identifier === "dominance-die");
  const styleChoice = advancement.find((entry) => entry.type === "ItemChoice" && entry.title === "Боевой стиль");

  assert.equal(dominanceDice.configuration.type, "number");
  assert.deepEqual(dominanceDice.configuration.scale["17"], { value: 6 });
  assert.equal(dominanceDie.configuration.type, "dice");
  assert.deepEqual(dominanceDie.configuration.scale["16"], { number: null, faces: 8, modifiers: [] });
  assert.equal(styleChoice.level, 1);
  assert.equal(styleChoice.configuration.choices["1"].count, 1);
  assert.equal(styleChoice.configuration.pool.length, 12);
});

test("barbarian advancements grant armor and one simple plus one martial weapon choice", () => {
  const barbarian = normalizeClassCompendiumData(loadJson("data/barbarian-rework-v012.json"));
  const advancement = buildClassAdvancement(barbarian.classData, {});
  const armor = advancement.find((entry) => (
    entry.type === "Trait"
      && entry.configuration?.grants?.includes("armor:lgt")
  ));
  const weaponChoices = advancement.filter((entry) => (
    entry.type === "Trait"
      && (entry.configuration?.choices ?? []).some((choice) => (
        (choice.pool ?? []).some((grant) => String(grant).startsWith("weapon:"))
      ))
  ));
  const simpleWeapons = weaponChoices.find((entry) => (
    entry.configuration.choices[0].pool.every((grant) => String(grant).startsWith("weapon:sim:"))
  ));
  const martialWeapons = weaponChoices.find((entry) => (
    entry.configuration.choices[0].pool.every((grant) => String(grant).startsWith("weapon:mar:"))
  ));

  assert.deepEqual(armor.configuration.grants, ["armor:lgt", "armor:med", "armor:shl"]);
  assert.equal(weaponChoices.length, 2);
  assert.equal(simpleWeapons.configuration.choices.length, 1);
  assert.equal(simpleWeapons.configuration.choices[0].count, 1);
  assert.ok(simpleWeapons.configuration.choices[0].pool.includes("weapon:sim:handaxe"));
  assert.ok(simpleWeapons.configuration.choices[0].pool.includes("weapon:sim:spear"));
  assert.equal(martialWeapons.configuration.choices.length, 1);
  assert.equal(martialWeapons.configuration.choices[0].count, 1);
  assert.ok(martialWeapons.configuration.choices[0].pool.includes("weapon:mar:greataxe"));
  assert.ok(martialWeapons.configuration.choices[0].pool.includes("weapon:mar:longsword"));
});

test("barbarian feature definitions include two preset starting equipment packages", () => {
  const barbarian = normalizeClassCompendiumData(loadJson("data/barbarian-rework-v012.json"));
  const system = createClassSystem(barbarian.classData, [], barbarian.sourceLabel);
  const packageDefinitions = buildFeatureDefinitions(barbarian)
    .filter((definition) => definition.sourceType === "barbarianStartingEquipmentPackage");

  assert.deepEqual(system.startingEquipment, []);
  assert.deepEqual(
    packageDefinitions.map((definition) => definition.startingEquipmentPackage.items.map((item) => [item.gearId, item.quantity ?? 1])),
    [
      [
        ["sekira", 1],
        ["ruchnoy-topor", 4],
        ["nabor-puteshestvennika", 1]
      ],
      []
    ]
  );
  assert.deepEqual(packageDefinitions[0].startingEquipmentPackage.currency, { gp: 15 });
  assert.deepEqual(packageDefinitions[1].startingEquipmentPackage.currency, { gp: 75 });
});

test("barbarian advancement exposes one native item choice for preset starting equipment packages", () => {
  const barbarian = normalizeClassCompendiumData(loadJson("data/barbarian-rework-v012.json"));
  const featureDefinitions = buildFeatureDefinitions(barbarian);
  const packageDefinitions = featureDefinitions
    .filter((definition) => definition.sourceType === "barbarianStartingEquipmentPackage");
  const featureUuidById = makeUuidMap(featureDefinitions);
  const advancement = buildClassAdvancement(barbarian.classData, {
    featureUuidById
  });
  const equipmentChoices = advancement.filter((entry) => entry.type === "ItemChoice" && entry.configuration?.type === null);

  assert.equal(packageDefinitions.length, 2);
  assert.equal(equipmentChoices.length, 1);
  assert.equal(equipmentChoices[0].level, 1);
  assert.equal(equipmentChoices[0].configuration.allowDrops, false);
  assert.deepEqual(
    equipmentChoices[0].configuration.pool.map((entry) => entry.uuid),
    packageDefinitions.map((definition) => featureUuidById.get(definition.featureId))
  );
});

test("rogue rework data defines ZoZT class basics and the thief subclass", () => {
  const rogue = normalizeClassCompendiumData(loadJson("data/rogue-rework-v00.json"));
  const system = createClassSystem(rogue.classData, [], rogue.sourceLabel);

  assert.equal(rogue.sourceLabel, "ЗоЗТ");
  assert.equal(rogue.classData.identifier, "rogue-rework-v00");
  assert.equal(rogue.classData.hitDie, "d8");
  assert.deepEqual(rogue.classData.primaryAbility, ["dex"]);
  assert.deepEqual(rogue.classData.saveProficiencies, ["dex", "int"]);
  assert.equal(rogue.classData.skillChoiceCount, 4);
  assert.equal(rogue.classData.skillPool.length, 18);
  assert.equal(rogue.classData.subclassTitle, "Специализация плута");
  assert.equal(rogue.classData.features.some((feature) => feature.name === "Компетентность"), true);
  assert.equal(rogue.classData.features.some((feature) => feature.name === "Скрытая атака"), true);
  assert.equal(rogue.classData.features.some((feature) => feature.name === "Хитрое действие"), true);
  assert.equal(rogue.subclasses.length, 1);
  assert.equal(rogue.subclasses[0].name, "Вор");
  assert.equal(rogue.subclasses[0].features.some((feature) => feature.name === "Мастер взлома"), true);
  assert.equal(rogue.subclasses[0].features.some((feature) => feature.name === "Украсть невозможное"), true);
  assert.equal(system.source.book, "ЗоЗТ");
  assert.equal(system.wealth, "100");
  assert.deepEqual(system.startingEquipment, []);
});

test("rogue advancements expose proficiencies, scales, class grants, and equipment package choice", () => {
  const rogue = normalizeClassCompendiumData(loadJson("data/rogue-rework-v00.json"));
  const featureDefinitions = buildFeatureDefinitions(rogue);
  const packageDefinitions = featureDefinitions
    .filter((definition) => definition.sourceType === "rogueStartingEquipmentPackage");
  const featureUuidById = makeUuidMap(featureDefinitions);
  const advancement = buildClassAdvancement(rogue.classData, {
    featureUuidById,
    classFeatureEntries: rogue.classData.features,
    minorFeatUuids: ["Compendium.world.rebreya-feats.Item.minor"]
  });

  const skills = advancement.find((entry) => entry.type === "Trait" && entry.title === "Навыки: Плут (реворк V0.0)");
  const armor = advancement.find((entry) => entry.type === "Trait" && entry.title === "Владение доспехами");
  const tools = advancement.find((entry) => entry.type === "Trait" && entry.title === "Владение инструментами");
  const simpleWeapons = advancement.find((entry) => entry.type === "Trait" && entry.title === "Владение простым оружием");
  const martialWeapons = advancement.find((entry) => entry.type === "Trait" && entry.title === "Владение воинским оружием");
  const sneakAttack = advancement.find((entry) => entry.type === "ScaleValue" && entry.configuration.identifier === "sneak-attack");
  const breakingBoundaries = advancement.find((entry) => entry.type === "ScaleValue" && entry.configuration.identifier === "breaking-boundaries");
  const subclass = advancement.find((entry) => entry.type === "Subclass");
  const equipmentChoice = advancement.find((entry) => entry.type === "ItemChoice" && entry.title === "Стартовое снаряжение");
  const minorFeatChoices = advancement.filter((entry) => entry.type === "ItemChoice" && entry.title.startsWith("Младшая черта"));
  const levelOneGrant = advancement.find((entry) => entry.type === "ItemGrant" && entry.level === 1);
  const levelOneExpertise = advancement.find((entry) => entry.type === "Trait" && entry.title === "Компетентность");
  const levelFiveExpertise = advancement.find((entry) => entry.type === "Trait" && entry.title === "Улучшенная компетентность");

  assert.equal(skills.configuration.choices[0].count, 4);
  assert.ok(skills.configuration.choices[0].pool.includes("skills:ste"));
  assert.ok(skills.configuration.choices[0].pool.includes("skills:slt"));
  assert.equal(levelOneExpertise.level, 1);
  assert.equal(levelOneExpertise.configuration.mode, "expertise");
  assert.equal(levelOneExpertise.configuration.choices[0].count, 2);
  assert.ok(levelOneExpertise.configuration.choices[0].pool.includes("skills:ste"));
  assert.equal(levelFiveExpertise.level, 5);
  assert.equal(levelFiveExpertise.configuration.mode, "expertise");
  assert.equal(levelFiveExpertise.configuration.choices[0].count, 2);
  assert.deepEqual(armor.configuration.grants, ["armor:lgt"]);
  assert.deepEqual(tools.configuration.grants, ["tool:thief"]);
  assert.equal(simpleWeapons.configuration.choices[0].count, 1);
  assert.ok(simpleWeapons.configuration.choices[0].pool.includes("weapon:sim:dagger"));
  assert.equal(martialWeapons.configuration.choices[0].count, 1);
  assert.ok(martialWeapons.configuration.choices[0].pool.includes("weapon:mar:rapier"));
  assert.ok(martialWeapons.configuration.choices[0].pool.includes("weapon:mar:shortsword"));
  assert.deepEqual(sneakAttack.configuration.scale["17"], { number: 9, faces: 6, modifiers: [] });
  assert.deepEqual(breakingBoundaries.configuration.scale["3"], { value: 2 });
  assert.deepEqual(breakingBoundaries.configuration.scale["17"], { value: 6 });
  assert.equal(subclass.level, 3);
  assert.equal(subclass.title, "Специализация плута");
  assert.equal(equipmentChoice.level, 1);
  assert.match(equipmentChoice.hint, /Выберите А или Б:/u);
  assert.deepEqual(equipmentChoice.configuration.pool.map((entry) => entry.uuid), packageDefinitions.map((definition) => featureUuidById.get(definition.featureId)));
  assert.equal(minorFeatChoices.length, 6);
  assert.equal(levelOneGrant.configuration.items.some((item) => item.uuid === featureUuidById.get("rogue-rework-v00::class::rogue-sneak-attack")), true);
});

test("rogue feature definitions include two preset starting equipment packages", () => {
  const rogue = normalizeClassCompendiumData(loadJson("data/rogue-rework-v00.json"));
  const packageDefinitions = buildFeatureDefinitions(rogue)
    .filter((definition) => definition.sourceType === "rogueStartingEquipmentPackage");

  assert.deepEqual(packageDefinitions.map((definition) => definition.name), [
    "А) Кожаный доспех, 2 кинжала, короткий меч, короткий лук, 20 стрел, колчан, воровские инструменты, набор взломщика и 8 зм",
    "Б) 100 зм"
  ]);
  assert.deepEqual(
    packageDefinitions[0].startingEquipmentPackage.items.map((item) => [item.gearId, item.quantity ?? 1]),
    [
      ["kozhanyy-dospekh", 1],
      ["kinzhal", 2],
      ["korotkiy-mech", 1],
      ["korotkiy-luk", 1],
      ["strely-20", 1],
      ["kolchan", 1],
      ["instrumenty-vorovskie-0-y-rang", 1],
      ["nabor-vzlomshchika", 1]
    ]
  );
  assert.deepEqual(packageDefinitions[0].startingEquipmentPackage.currency, { gp: 8 });
  assert.deepEqual(packageDefinitions[1].startingEquipmentPackage.items, []);
  assert.deepEqual(packageDefinitions[1].startingEquipmentPackage.currency, { gp: 100 });
});

test("rogue cunning strike options are separate feature items in their sheet section", () => {
  const rogue = normalizeClassCompendiumData(loadJson("data/rogue-rework-v00.json"));
  const definitions = buildFeatureDefinitions(rogue);
  const featureUuidById = makeUuidMap(definitions);
  const cunningStrikes = definitions.filter((definition) => definition.sourceType === "rogueCunningStrike");
  const hamstring = cunningStrikes.find((definition) => definition.name === "Подрезать");
  const spillSupplies = cunningStrikes.find((definition) => definition.name === "Рассыпать припасы");
  const entry = createFeatureEntryData(hamstring, new Map());
  const classAdvancement = buildClassAdvancement(rogue.classData, {
    featureUuidById,
    classFeatureEntries: rogue.classData.features
  });
  const thief = rogue.subclasses.find((subclass) => subclass.name === "Вор");
  const thiefAdvancement = buildSubclassAdvancements(thief, { featureUuidById });
  const hamstringUuid = featureUuidById.get(hamstring.featureId);
  const spillSuppliesUuid = featureUuidById.get(spillSupplies.featureId);
  const levelTwoCunningStrikeGrant = classAdvancement.find((advancement) =>
    advancement.type === "ItemGrant"
    && advancement.level === 2
    && advancement.configuration.items.some((item) => item.uuid === hamstringUuid)
  );
  const thiefLevelThreeCunningStrikeGrant = thiefAdvancement.find((advancement) =>
    advancement.type === "ItemGrant"
    && advancement.level === 3
    && advancement.configuration.items.some((item) => item.uuid === spillSuppliesUuid)
  );

  assert.deepEqual(cunningStrikes.map((definition) => definition.name), [
    "Подрезать",
    "Сорвать план",
    "Открыть позицию",
    "Сбить прицел",
    "Подсечка",
    "Обезоружить",
    "Вызвать клин",
    "Оглушить",
    "Сорвать концентрацию",
    "Сломать темп",
    "Пробить защиту",
    "Заткнуть рот",
    "Ослепить",
    "Сорвать ремень",
    "Рассыпать припасы",
    "Сорвать снаряжение"
  ]);
  assert.equal(hamstring.cunningStrikeCost, 1);
  assert.equal(spillSupplies.cunningStrikeCost, 2);
  assert.equal(entry.flags["rebreya-main"].sourceType, "rogueCunningStrike");
  assert.equal(entry.flags["rebreya-main"].section, "Хитрые удары");
  assert.equal(entry.flags["rebreya-main"].cunningStrikeCost, 1);
  assert.equal(entry.flags.teyvankal.section, "Хитрые удары");
  assert.equal(levelTwoCunningStrikeGrant.configuration.items.length, 13);
  assert.equal(levelTwoCunningStrikeGrant.configuration.items.some((item) => item.uuid === hamstringUuid), true);
  assert.equal(thiefLevelThreeCunningStrikeGrant.configuration.items.length, 3);
  assert.equal(thiefLevelThreeCunningStrikeGrant.configuration.items.some((item) => item.uuid === spillSuppliesUuid), true);
});

test("paladin rework data defines ZoZT class basics, spellcasting, and subclasses", () => {
  const paladin = normalizeClassCompendiumData(loadJson("data/paladin-rework-v01.json"));
  const system = createClassSystem(paladin.classData, [], paladin.sourceLabel);

  assert.equal(paladin.sourceLabel, "ЗоЗТ");
  assert.equal(paladin.classData.identifier, "paladin-rework-v01");
  assert.equal(paladin.classData.hitDie, "d10");
  assert.deepEqual(paladin.classData.saveProficiencies, ["wis", "cha"]);
  assert.deepEqual(paladin.classData.skillPool, ["ath", "ins", "itm", "med", "per", "rel"]);
  assert.equal(paladin.classData.features.some((feature) => feature.name === "Божественная кара"), true);
  assert.equal(paladin.classData.features.some((feature) => feature.name === "Аура защиты"), true);
  assert.equal(paladin.subclasses.length, 7);
  assert.equal(system.source.book, "ЗоЗТ");
  assert.equal(system.spellcasting.progression, "half");
  assert.equal(system.spellcasting.ability, "cha");
  assert.equal(system.spellcasting.preparation.formula, "@abilities.cha.mod + floor(@classes.paladin-rework-v01.levels / 2)");
});

test("paladin advancements grant armor and strict weapon proficiency choices", () => {
  const paladin = normalizeClassCompendiumData(loadJson("data/paladin-rework-v01.json"));
  const advancement = buildClassAdvancement(paladin.classData, {});
  const armor = advancement.find((entry) => entry.type === "Trait" && entry.title === "Владение доспехами");
  const simpleWeapons = advancement.find((entry) => entry.type === "Trait" && entry.title === "Владение простым оружием");
  const martialWeapons = advancement.find((entry) => entry.type === "Trait" && entry.title === "Владение воинским оружием");

  assert.deepEqual(armor.configuration.grants, ["armor:lgt", "armor:med", "armor:hvy", "armor:shl"]);
  assert.deepEqual(simpleWeapons.configuration.grants, []);
  assert.deepEqual(martialWeapons.configuration.grants, []);
  assert.equal(simpleWeapons.configuration.choices.length, 1);
  assert.equal(simpleWeapons.configuration.choices[0].count, 1);
  assert.ok(simpleWeapons.configuration.choices[0].pool.includes("weapon:sim:dagger"));
  assert.ok(simpleWeapons.configuration.choices[0].pool.includes("weapon:sim:spear"));
  assert.ok(simpleWeapons.configuration.choices[0].pool.includes("weapon:sim:kosa"));
  assert.ok(simpleWeapons.configuration.choices[0].pool.includes("weapon:sim:kastet"));
  assert.equal(martialWeapons.configuration.choices.length, 1);
  assert.equal(martialWeapons.configuration.choices[0].count, 3);
  assert.ok(martialWeapons.configuration.choices[0].pool.includes("weapon:mar:longsword"));
  assert.ok(martialWeapons.configuration.choices[0].pool.includes("weapon:mar:longbow"));
  assert.ok(martialWeapons.configuration.choices[0].pool.includes("weapon:mar:katana"));
  assert.ok(martialWeapons.configuration.choices[0].pool.includes("weapon:mar:kompozitnyy-luk"));
  assert.ok(martialWeapons.configuration.choices[0].pool.includes("weapon:mar:set"));
  assert.equal(simpleWeapons.configuration.choices[0].pool.includes("weapon:sim"), false);
  assert.equal(martialWeapons.configuration.choices[0].pool.includes("weapon:mar"), false);
});

test("paladin feature definitions include two preset starting equipment packages", () => {
  const paladin = normalizeClassCompendiumData(loadJson("data/paladin-rework-v01.json"));
  const packageDefinitions = buildFeatureDefinitions(paladin)
    .filter((definition) => definition.sourceType === "paladinStartingEquipmentPackage");

  assert.deepEqual(packageDefinitions.map((definition) => definition.name), [
    "А) Кольчуга, щит, длинный меч, 6 метательных копий, священный символ, набор священника и 9 зм",
    "Б) 150 зм"
  ]);
  assert.deepEqual(
    packageDefinitions[0].startingEquipmentPackage.items.map((item) => [item.gearId, item.quantity ?? 1]),
    [
      ["kol-chuga", 1],
      ["shchit", 1],
      ["dlinnyy-mech", 1],
      ["kop-e", 6],
      ["amulet-svyashchennyy-simvol", 1],
      ["nabor-svyashchennika", 1]
    ]
  );
  assert.deepEqual(packageDefinitions[0].startingEquipmentPackage.currency, { gp: 9 });
  assert.deepEqual(packageDefinitions[1].startingEquipmentPackage.items, []);
  assert.deepEqual(packageDefinitions[1].startingEquipmentPackage.currency, { gp: 150 });
});

test("paladin advancement exposes class grants, fighting style, minor feats, and equipment package choice", () => {
  const paladin = normalizeClassCompendiumData(loadJson("data/paladin-rework-v01.json"));
  const featureDefinitions = buildFeatureDefinitions(paladin);
  const featureUuidById = makeUuidMap(featureDefinitions);
  const advancement = buildClassAdvancement(paladin.classData, {
    featureUuidById,
    classFeatureEntries: paladin.classData.features,
    minorFeatUuids: ["Compendium.world.rebreya-feats.Item.minor"],
    fightingStyleEntries: paladin.fightingStyles,
    fightingStyleFeatUuids: [
      "Compendium.world.rebreya-feats.Item.defense",
      "Compendium.world.rebreya-feats.Item.dueling"
    ]
  });

  const subclass = advancement.find((entry) => entry.type === "Subclass");
  const styleChoice = advancement.find((entry) => entry.type === "ItemChoice" && entry.title === "Боевой стиль");
  const spellChoice = advancement.find((entry) => entry.type === "ItemChoice" && entry.configuration.type === "spell");
  const equipmentChoice = advancement.find((entry) => entry.type === "ItemChoice" && entry.title === "Стартовое снаряжение");
  const minorFeatChoices = advancement.filter((entry) => entry.type === "ItemChoice" && entry.title.startsWith("Младшая черта"));
  const levelOneGrant = advancement.find((entry) => entry.type === "ItemGrant" && entry.level === 1);
  const levelTwoGrant = advancement.find((entry) => entry.type === "ItemGrant" && entry.level === 2);

  assert.equal(subclass.level, 3);
  assert.equal(subclass.title, "Священная клятва");
  assert.deepEqual(subclass.configuration, {});
  assert.deepEqual(subclass.value, { document: null, uuid: null });
  assert.equal(styleChoice.level, 2);
  assert.equal(styleChoice.configuration.choices["2"].count, 1);
  assert.deepEqual(
    styleChoice.configuration.pool.map((entry) => entry.uuid),
    [
      "Compendium.world.rebreya-feats.Item.defense",
      "Compendium.world.rebreya-feats.Item.dueling",
      featureUuidById.get("paladin-rework-v01::fightingStyle::paladin-blessed-warrior")
    ]
  );
  assert.equal(spellChoice, undefined);
  assert.equal(equipmentChoice.level, 1);
  assert.match(equipmentChoice.hint, /Выберите А или Б:/u);
  assert.deepEqual(equipmentChoice.value, { added: { "1": {} }, replaced: {} });
  assert.equal(minorFeatChoices.length, 6);
  assert.equal(levelOneGrant.configuration.items.some((item) => item.uuid === featureUuidById.get("paladin-rework-v01::class::paladin-divine-sense")), true);
  assert.equal(levelTwoGrant.configuration.items.some((item) => item.uuid === featureUuidById.get("paladin-rework-v01::class::paladin-divine-smite")), true);
});

test("managed class compendium documents preserve stable ids when created", () => {
  assert.deepEqual(
    getManagedDocumentCreateOptions({ collection: "world.rebreya-class-features" }),
    { pack: "world.rebreya-class-features", keepId: true }
  );
});

test("paladin fighting style choice is a flat list of style feats plus paladin style", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const paladin = normalizeClassCompendiumData(loadJson("data/paladin-rework-v01.json"));
  const featureDefinitions = [
    ...buildFeatureDefinitions(fighter),
    ...buildFeatureDefinitions(paladin)
  ];
  const featureUuidById = makeUuidMap(featureDefinitions);
  const paladinStyle = featureDefinitions.find((definition) => (
    definition.sourceType === "fightingStyle"
    && definition.classIdentifier === "paladin-rework-v01"
    && definition.styleName === "Стиль паладина"
  ));
  const paladinStyleEntry = createFeatureEntryData(paladinStyle, new Map(), null, {
    featureDefinitions,
    featureUuidById
  });
  const fighterStyleUuids = buildFeatureDefinitions(fighter)
    .filter((definition) => definition.sourceType === "fightingStyle")
    .map((definition) => featureUuidById.get(definition.featureId));
  const fightingStyleFeatUuids = [
    "Compendium.world.rebreya-feats.Item.defense",
    "Compendium.world.rebreya-feats.Item.dueling",
    "Compendium.world.rebreya-feats.Item.blind-fighting"
  ];
  const advancement = buildClassAdvancement(paladin.classData, {
    featureUuidById,
    classFeatureEntries: paladin.classData.features,
    fightingStyleEntries: paladin.fightingStyles,
    fightingStyleFeatUuids
  });
  const styleChoice = advancement.find((entry) => entry.type === "ItemChoice" && entry.title === "Боевой стиль");

  assert.deepEqual(
    featureDefinitions
      .filter((definition) => (
        definition.sourceType === "fightingStyle"
        && definition.classIdentifier === "paladin-rework-v01"
      ))
      .map((definition) => definition.styleName),
    ["Стиль паладина"]
  );
  assert.equal(styleChoice.level, 2);
  assert.deepEqual(styleChoice.configuration.pool.map((entry) => entry.uuid), [
    ...fightingStyleFeatUuids,
    featureUuidById.get("paladin-rework-v01::fightingStyle::paladin-blessed-warrior")
  ]);
  assert.equal(
    styleChoice.configuration.pool.some((entry) => fighterStyleUuids.includes(entry.uuid)),
    false
  );
  for (const fighterStyle of buildFeatureDefinitions(fighter).filter((definition) => definition.sourceType === "fightingStyle")) {
    const fighterStyleEntry = createFeatureEntryData(fighterStyle, new Map(), null, {
      featureDefinitions,
      featureUuidById
    });
    assert.equal(fighterStyleEntry.system.prerequisites.level, 0);
  }
  assert.equal(
    paladinStyleEntry.system.advancement.some((advancement) => advancement.type === "ItemChoice"),
    false
  );
  assert.match(paladinStyleEntry.system.description.value, /Благословенный воин/u);
});

test("paladin divine smite variants are separate class and oath feature items", () => {
  const paladin = normalizeClassCompendiumData(loadJson("data/paladin-rework-v01.json"));
  const featureDefinitions = buildFeatureDefinitions(paladin);
  const featureUuidById = makeUuidMap(featureDefinitions);
  const classAdvancement = buildClassAdvancement(paladin.classData, {
    featureUuidById,
    classFeatureEntries: paladin.classData.features
  });
  const devotion = paladin.subclasses.find((subclass) => subclass.subclassId === "paladin-oath-devotion");
  const devotionAdvancement = buildSubclassAdvancements(devotion, { featureUuidById });

  const smiteNames = [
    "Священная божественная кара",
    "Защитная кара",
    "Клеймящая кара",
    "Останавливающая кара",
    "Толкающая кара",
    "Опрокидывающая кара",
    "Гнилая божественная кара",
    "Гневная кара",
    "Дальнобойная божественная кара",
    "Скрытная божественная кара",
    "Разрушающая кара",
    "Созидающая кара",
    "Кара обвинения",
    "Кара задержания",
    "Небесная кара",
    "Оглушающая кара",
    "Запечатывающая кара",
    "Изгоняющая кара"
  ];
  const definitionNames = new Set(featureDefinitions.map((definition) => definition.name));
  for (const name of smiteNames) {
    assert.equal(definitionNames.has(name), true, `${name} должен быть отдельным умением`);
  }

  const levelElevenGrant = classAdvancement.find((entry) => entry.type === "ItemGrant" && entry.level === 11);
  const levelSeventeenGrant = classAdvancement.find((entry) => entry.type === "ItemGrant" && entry.level === 17);
  const devotionGrant = devotionAdvancement.find((entry) => entry.type === "ItemGrant" && entry.level === 3);

  assert.deepEqual(
    ["paladin-heavenly-smite", "paladin-stunning-smite"].map((id) => (
      levelElevenGrant.configuration.items.some((item) => item.uuid === featureUuidById.get(`paladin-rework-v01::class::${id}`))
    )),
    [true, true]
  );
  assert.deepEqual(
    ["paladin-sealing-smite", "paladin-banishing-smite"].map((id) => (
      levelSeventeenGrant.configuration.items.some((item) => item.uuid === featureUuidById.get(`paladin-rework-v01::class::${id}`))
    )),
    [true, true]
  );
  assert.deepEqual(
    ["devotion-sacred-divine-smite", "devotion-protective-smite"].map((id) => (
      devotionGrant.configuration.items.some((item) => item.uuid === featureUuidById.get(`paladin-oath-devotion::subclass::${id}`))
    )),
    [true, true]
  );
});

test("paladin divine sense and lay on hands expose item resources and automation activities", () => {
  const paladin = normalizeClassCompendiumData(loadJson("data/paladin-rework-v01.json"));
  const definitions = buildFeatureDefinitions(paladin);
  const divineSense = definitions.find((definition) => (
    definition.sourceType === "classFeature" && definition.name === "Божественное чувство"
  ));
  const layOnHands = definitions.find((definition) => (
    definition.sourceType === "classFeature" && definition.name === "Наложение рук"
  ));

  const divineSenseEntry = createFeatureEntryData(divineSense, new Map());
  const divineSenseActivity = Object.values(divineSenseEntry.system.activities)[0];
  const layOnHandsEntry = createFeatureEntryData(layOnHands, new Map());
  const layOnHandsActivity = Object.values(layOnHandsEntry.system.activities)[0];

  assert.equal(divineSenseEntry.system.uses.max, "@abilities.cha.mod + 1");
  assert.deepEqual(divineSenseEntry.system.uses.recovery, [{
    period: "lr",
    type: "recoverAll",
    formula: ""
  }]);
  assert.equal(divineSenseActivity.type, "utility");
  assert.equal(divineSenseActivity.activation.type, "action");
  assert.deepEqual(divineSenseActivity.consumption.targets, [{
    type: "itemUses",
    target: "",
    value: "1",
    scaling: {
      mode: "",
      formula: ""
    }
  }]);

  assert.equal(layOnHandsEntry.system.uses.max, "@details.level * 5");
  assert.deepEqual(layOnHandsEntry.system.uses.recovery, [{
    period: "lr",
    type: "recoverAll",
    formula: ""
  }]);
  assert.equal(layOnHandsActivity.type, "utility");
  assert.equal(layOnHandsActivity.activation.type, "bonus");
  assert.equal(layOnHandsActivity.target.prompt, true);
  assert.equal(layOnHandsActivity.target.affects.type, "creature");
  assert.equal(layOnHandsActivity.flags["rebreya-main"].automation, "paladin-lay-on-hands");
  assert.deepEqual(layOnHandsActivity.consumption.targets, []);
  assert.equal(JSON.parse(layOnHandsEntry.flags["rebreya-main"].signature).templateVersion, 15);
});

test("paladin aura of protection exposes a DAE Active Auras saving throw bonus", () => {
  const paladin = normalizeClassCompendiumData(loadJson("data/paladin-rework-v01.json"));
  const definitions = buildFeatureDefinitions(paladin);
  const aura = definitions.find((definition) => (
    definition.sourceType === "classFeature" && definition.name === "Аура защиты"
  ));
  const auraEntry = createFeatureEntryData(aura, new Map());
  const [effect] = auraEntry.effects;

  assert.equal(effect.name, "Аура защиты");
  assert.equal(effect.transfer, true);
  assert.deepEqual(effect.changes, [{
    key: "system.bonuses.abilities.save",
    mode: 2,
    value: "+@abilities.cha.mod",
    priority: 20
  }]);
  assert.equal(effect.flags.ActiveAuras.isAura, true);
  assert.equal(effect.flags.ActiveAuras.aura, "Allies");
  assert.equal(effect.flags.ActiveAuras.radius, "10");
  assert.equal(effect.flags.ActiveAuras.ignoreSelf, false);
  assert.equal(effect.flags["rebreya-main"].automation, "paladin-aura-of-protection");
});

test("shared class feature icons resolve from common icon names", () => {
  const barbarian = normalizeClassCompendiumData(loadJson("data/barbarian-rework-v012.json"));
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const iconLookup = new Map([
    ["младшая черта", "modules/rebreya-main/templates/icons/%D0%9C%D0%BB%D0%B0%D0%B4%D1%88%D0%B0%D1%8F%20%D1%87%D0%B5%D1%80%D1%82%D0%B0.png"],
    ["повышение характеристик", "modules/rebreya-main/templates/icons/%D0%9F%D0%BE%D0%B2%D1%8B%D1%88%D0%B5%D0%BD%D0%B8%D0%B5%20%D1%85%D0%B0%D1%80%D0%B0%D0%BA%D1%82%D0%B5%D1%80%D0%B8%D1%81%D1%82%D0%B8%D0%BA.png"]
  ]);
  const barbarianDefinitions = buildFeatureDefinitions(barbarian);
  const fighterDefinitions = buildFeatureDefinitions(fighter);

  assert.equal(
    createFeatureEntryData(barbarianDefinitions.find((definition) => definition.name === "Младшая черта"), new Map(), iconLookup).img,
    iconLookup.get("младшая черта")
  );
  assert.equal(
    createFeatureEntryData(barbarianDefinitions.find((definition) => definition.name === "Увеличение Характеристик"), new Map(), iconLookup).img,
    iconLookup.get("повышение характеристик")
  );
  assert.equal(
    createFeatureEntryData(fighterDefinitions.find((definition) => definition.name === "Дополнительная черта"), new Map(), iconLookup).img,
    iconLookup.get("младшая черта")
  );
});

test("fighter feature icons resolve from class-specific short and qualified names", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const fighterDefinitions = buildFeatureDefinitions(fighter);
  const iconLookup = new Map([
    ["всплеск действий", "modules/rebreya-main/templates/icons/Classes/Fighter/%D0%92%D1%81%D0%BF%D0%BB%D0%B5%D1%81%D0%BA%20%D0%B4%D0%B5%D0%B9%D1%81%D1%82%D0%B2%D0%B8%D0%B9.webp"],
    ["дуэлянт", "modules/rebreya-main/templates/icons/Classes/Fighter/%D0%94%D1%83%D1%8D%D0%BB%D1%8F%D0%BD%D1%82.webp"],
    ["ответный удар прием", "modules/rebreya-main/templates/icons/Classes/Fighter/%D0%9E%D1%82%D0%B2%D0%B5%D1%82%D0%BD%D1%8B%D0%B9%20%D1%83%D0%B4%D0%B0%D1%80%20%E2%80%94%20%D0%BF%D1%80%D0%B8%D1%91%D0%BC.webp"],
    ["ответный удар самурай", "modules/rebreya-main/templates/icons/Classes/Fighter/%D0%9E%D1%82%D0%B2%D0%B5%D1%82%D0%BD%D1%8B%D0%B9%20%D1%83%D0%B4%D0%B0%D1%80%20%E2%80%94%20%D0%A1%D0%B0%D0%BC%D1%83%D1%80%D0%B0%D0%B9.webp"],
    ["дополнительные владения самурай", "modules/rebreya-main/templates/icons/Classes/Fighter/%D0%94%D0%BE%D0%BF%D0%BE%D0%BB%D0%BD%D0%B8%D1%82%D0%B5%D0%BB%D1%8C%D0%BD%D1%8B%D0%B5%20%D0%B2%D0%BB%D0%B0%D0%B4%D0%B5%D0%BD%D0%B8%D1%8F%20%E2%80%94%20%D0%A1%D0%B0%D0%BC%D1%83%D1%80%D0%B0%D0%B9.webp"],
    ["использование заклинаний лесной страж", "modules/rebreya-main/templates/icons/Classes/Fighter/%D0%98%D1%81%D0%BF%D0%BE%D0%BB%D1%8C%D0%B7%D0%BE%D0%B2%D0%B0%D0%BD%D0%B8%D0%B5%20%D0%B7%D0%B0%D0%BA%D0%BB%D0%B8%D0%BD%D0%B0%D0%BD%D0%B8%D0%B9%20%E2%80%94%20%D0%9B%D0%B5%D1%81%D0%BD%D0%BE%D0%B9%20%D1%81%D1%82%D1%80%D0%B0%D0%B6.webp"],
    ["резчик рун", "modules/rebreya-main/templates/icons/Classes/Fighter/%D0%A0%D0%B5%D0%B7%D1%87%D0%B8%D0%BA%20%D1%80%D1%83%D0%BD.webp"]
  ]);

  const actionSurge = fighterDefinitions.find((definition) => definition.name === "Воинская мультиатака: Всплеск действий");
  const duelistStyle = fighterDefinitions.find((definition) => definition.sourceType === "fightingStyle" && definition.styleName === "Дуэлянт");
  const riposteManeuver = fighterDefinitions.find((definition) => definition.sourceType === "fighterManeuver" && definition.name === "Ответный удар");
  const samuraiProficiencies = fighterDefinitions.find((definition) => definition.subclassName === "Самурай" && definition.name === "Дополнительные Владения");
  const samuraiRetaliation = fighterDefinitions.find((definition) => definition.subclassName === "Самурай" && definition.name === "Ответный удар");
  const woodlandSpellcasting = fighterDefinitions.find((definition) => definition.subclassName === "Лесной страж" && definition.name === "Использование заклинаний");
  const stoneRune = fighterDefinitions.find((definition) => definition.sourceType === "runeKnightRune" && definition.name === "Каменная руна");

  assert.equal(createFeatureEntryData(actionSurge, new Map(), iconLookup).img, iconLookup.get("всплеск действий"));
  assert.equal(createFeatureEntryData(duelistStyle, new Map(), iconLookup).img, iconLookup.get("дуэлянт"));
  assert.equal(createFeatureEntryData(riposteManeuver, new Map(), iconLookup).img, iconLookup.get("ответный удар прием"));
  assert.equal(createFeatureEntryData(samuraiProficiencies, new Map(), iconLookup).img, iconLookup.get("дополнительные владения самурай"));
  assert.equal(createFeatureEntryData(samuraiRetaliation, new Map(), iconLookup).img, iconLookup.get("ответный удар самурай"));
  assert.equal(createFeatureEntryData(woodlandSpellcasting, new Map(), iconLookup).img, iconLookup.get("использование заклинаний лесной страж"));
  assert.equal(createFeatureEntryData(stoneRune, new Map(), iconLookup).img, iconLookup.get("резчик рун"));
});

test("fighter class and subclass icons live under Classes/Fighter", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const requiredIconNames = ["Fighter", ...fighter.subclasses.map((subclass) => subclass.name)];

  for (const iconName of requiredIconNames) {
    const iconPath = join(process.cwd(), "templates/icons/Classes/Fighter", `${iconName}.webp`);
    assert.ok(existsSync(iconPath), `${iconName} icon should exist at ${iconPath}`);
  }
});

test("class icon search prioritizes icons under the Classes directory", () => {
  const source = readFileSync(join(process.cwd(), "scripts/data/classes-compendium.js"), "utf8");
  const fighterClassPathIndex = source.indexOf("${MODULE_ICONS_BASE_PATH}/Classes/Fighter");
  const oldFighterPathIndex = source.indexOf("${MODULE_ICONS_BASE_PATH}/Fighter");
  const featsPathIndex = source.indexOf("${MODULE_ICONS_BASE_PATH}/Feats");

  assert.notEqual(fighterClassPathIndex, -1);
  assert.ok(fighterClassPathIndex < featsPathIndex);
  assert.ok(fighterClassPathIndex < oldFighterPathIndex);
});

test("fighter class advancement grants every non-special base feature", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const featureDefinitions = buildFeatureDefinitions(fighter);
  const featureUuidById = makeUuidMap(featureDefinitions);
  const advancement = buildClassAdvancement(fighter.classData, {
    featureUuidById,
    classFeatureEntries: fighter.classData.features,
    minorFeatUuids: ["Compendium.world.rebreya-feats.Item.minor"],
    maneuverEntries: fighter.maneuvers,
    fightingStyleEntries: fighter.fightingStyles,
    dominanceProgression: fighter.dominanceProgression
  });
  const specialFeatureNames = new Set(["Младшая черта", "Повышение характеристики", "Увеличение характеристик"]);
  const expectedFeatureUuids = fighter.classData.features
    .filter((feature) => !specialFeatureNames.has(feature.name))
    .map((feature) => featureUuidById.get(`${fighter.classData.identifier}::class::${feature.featureId}`));
  const grantedFeatureUuids = advancement
    .filter((entry) => entry.type === "ItemGrant" && entry.title.startsWith("Классовые умения"))
    .flatMap((entry) => entry.configuration.items.map((item) => item.uuid));

  assert.deepEqual(new Set(grantedFeatureUuids), new Set(expectedFeatureUuids));
});

test("fighter maneuvers consume the shared dominance dice item by identifier", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const maneuver = buildFeatureDefinitions(fighter)
    .find((definition) => definition.sourceType === "fighterManeuver" && definition.name === "Ответный удар");
  const entry = createFeatureEntryData(maneuver, new Map());
  const activity = Object.values(entry.system.activities)[0];

  assert.equal(entry.flags["rebreya-main"].sourceType, "fighterManeuver");
  assert.equal(entry.flags["rebreya-main"].section, "Воинские приёмы");
  assert.equal(entry.flags.teyvankal.section, "Воинские приёмы");
  assert.equal(entry.system.type.value, "feat");
  assert.equal(entry.system.type.subtype, "fighterManeuver");
  assert.deepEqual(activity.consumption.targets, [{
    type: "itemUses",
    target: "fighter-dominance",
    value: "1",
    scaling: {
      mode: "",
      formula: ""
    }
  }]);
  assert.equal(activity.target.affects.type, "creature");
  assert.equal(activity.target.prompt, true);
  assert.equal(activity.range.units, "");
  assert.match(activity.description.chatFlavor, /@scale\.fighter-rework-v028\.dominance-die/u);
});

test("all fighter maneuvers have an activity that spends dominance dice", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const maneuvers = buildFeatureDefinitions(fighter).filter((definition) => definition.sourceType === "fighterManeuver");

  for (const maneuver of maneuvers) {
    const entry = createFeatureEntryData(maneuver, new Map());
    const activities = Object.values(entry.system.activities);

    assert.equal(activities.length, 1, `${maneuver.name} должен иметь одну активность`);
    assert.equal(entry.flags["rebreya-main"].automation.type, "fighterManeuver");
    assert.deepEqual(activities[0].consumption.targets, [{
      type: "itemUses",
      target: "fighter-dominance",
      value: "1",
      scaling: {
        mode: "",
        formula: ""
      }
    }]);
    const fighterAutomation = activities[0].flags["rebreya-main"].fighterAutomation;
    if (fighterAutomation.extraDamage || fighterAutomation.status) {
      assert.equal(activities[0].target.affects.type, "creature", `${maneuver.name} не должен целиться в себя`);
      assert.equal(activities[0].target.prompt, true, `${maneuver.name} должен брать выбранную цель`);
    }
    assert.match(activities[0].description.chatFlavor, /@scale\.fighter-rework-v028\.dominance-die/u);
  }
});

test("fighter maneuver activities expose editable runtime automation metadata", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const definitions = buildFeatureDefinitions(fighter);
  const provocation = definitions.find((definition) => definition.sourceType === "fighterManeuver" && definition.name === "Провоцирующая атака");
  const brutalStrike = definitions.find((definition) => definition.sourceType === "fighterManeuver" && definition.name === "Жестокий удар");
  const preciseAttack = definitions.find((definition) => definition.sourceType === "fighterManeuver" && definition.name === "Точная атака");

  const provocationActivity = Object.values(createFeatureEntryData(provocation, new Map()).system.activities)[0];
  const brutalStrikeActivity = Object.values(createFeatureEntryData(brutalStrike, new Map()).system.activities)[0];
  const preciseAttackEntry = createFeatureEntryData(preciseAttack, new Map());
  const preciseAttackActivity = Object.values(preciseAttackEntry.system.activities)[0];

  assert.equal(provocationActivity.flags["rebreya-main"].automation, "fighter-dominance-maneuver");
  assert.deepEqual(provocationActivity.flags["rebreya-main"].fighterAutomation.extraDamage, {
    formula: "@scale.fighter-rework-v028.dominance-die"
  });
  assert.deepEqual(provocationActivity.flags["rebreya-main"].fighterAutomation.status, {
    id: "rebreya-provoked",
    value: 1,
    durationRounds: 1,
    expires: "sourceTurnEnd"
  });
  assert.match(provocationActivity.description.chatFlavor, /Спровоцированной/u);

  assert.deepEqual(brutalStrikeActivity.flags["rebreya-main"].fighterAutomation.extraDamage, {
    formula: "@scale.fighter-rework-v028.dominance-die"
  });
  assert.equal(brutalStrikeActivity.flags["rebreya-main"].fighterAutomation.status, undefined);
  assert.deepEqual(preciseAttackActivity.flags["rebreya-main"].fighterAutomation.attackRollBoost, {
    id: "fighter-precise-attack",
    formula: "@scale.fighter-rework-v028.dominance-die",
    label: "Точная атака",
    weaponOnly: true,
    consumption: {
      type: "itemUses",
      target: "fighter-dominance",
      value: "1"
    }
  });
  assert.deepEqual(preciseAttackEntry.flags["rebreya-main"].attackRollBoosts, [{
    id: "fighter-precise-attack",
    formula: "@scale.fighter-rework-v028.dominance-die",
    label: "Точная атака",
    weaponOnly: true,
    consumption: {
      type: "itemUses",
      target: "fighter-dominance",
      value: "1"
    }
  }]);
});

test("fighter second wind uses its item uses as the healing dice pool", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const definitions = buildFeatureDefinitions(fighter);
  const secondWind = definitions.find((definition) => definition.sourceType === "classFeature" && definition.name === "Второе дыхание");
  const entry = createFeatureEntryData(secondWind, new Map());
  const activity = Object.values(entry.system.activities)[0];

  assert.equal(entry.system.uses.max, "@details.level");
  assert.deepEqual(entry.system.uses.recovery, [{
    period: "lr",
    type: "recoverAll",
    formula: ""
  }]);
  assert.equal(activity.type, "utility");
  assert.equal(activity.activation.type, "bonus");
  assert.equal(activity.flags["rebreya-main"].automation, "fighter-second-wind");
  assert.deepEqual(activity.flags["rebreya-main"].fighterAutomation, {
    kind: "secondWind",
    die: "d6",
    maxDiceAbility: "con",
    minDice: 1
  });
});

test("fighter iron will has a passive runtime marker for combat automation", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const definitions = buildFeatureDefinitions(fighter);
  const ironWill = definitions.find((definition) => definition.sourceType === "classFeature" && definition.name === "Железная воля");
  const entry = createFeatureEntryData(ironWill, new Map());

  assert.deepEqual(Object.values(entry.system.activities), []);
  assert.equal(entry.effects.length, 1);
  assert.equal(entry.effects[0].flags["rebreya-main"].automation, "fighter-iron-will");
  assert.deepEqual(entry.effects[0].flags.dae.specialDuration, ["combatEnd"]);
});

test("fighter fighting style items grant the real feat and their fixed maneuvers", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const definitions = buildFeatureDefinitions(fighter);
  const featureUuidById = makeUuidMap(definitions);
  const style = definitions.find((definition) => definition.sourceType === "fightingStyle" && definition.styleName === "Стрельба");
  const styleFeatUuid = "Compendium.world.rebreya-feats.Item.aaaaaaaaaaaaaaaa";
  const entry = createFeatureEntryData(style, new Map(), null, {
    featureUuidById,
    featLookupByName: new Map([
      ["стрельба", [{
        uuid: styleFeatUuid,
        section: "черты боевых стилей"
      }]]
    ])
  });

  const featGrant = entry.system.advancement.find((advancement) => advancement.title === "Черта боевого стиля");
  const maneuverGrant = entry.system.advancement.find((advancement) => advancement.title === "Приёмы боевого стиля");

  assert.equal(entry.name, "Боевой стиль: Стрельба");
  assert.deepEqual(featGrant.configuration.items.map((item) => item.uuid), [styleFeatUuid]);
  assert.equal(maneuverGrant.configuration.items.length, 3);
  assert.deepEqual(
    maneuverGrant.configuration.items.map((item) => item.uuid),
    ["Засада", "Точная атака", "Тактическая оценка"].map((maneuverName) => {
      const maneuver = definitions.find((definition) => definition.sourceType === "fighterManeuver" && definition.name === maneuverName);
      return featureUuidById.get(maneuver.featureId);
    })
  );
});

test("all fixed fighter fighting styles grant the maneuvers named in data", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const definitions = buildFeatureDefinitions(fighter);
  const featureUuidById = makeUuidMap(definitions);
  const maneuverNameByUuid = new Map(
    definitions
      .filter((definition) => definition.sourceType === "fighterManeuver")
      .map((definition) => [featureUuidById.get(definition.featureId), definition.name])
  );

  for (const styleData of fighter.fightingStyles.filter((style) => style.maneuvers.length)) {
    const style = definitions.find((definition) => definition.sourceType === "fightingStyle" && definition.styleName === styleData.name);
    const entry = createFeatureEntryData(style, new Map(), null, { featureUuidById });
    const maneuverGrant = entry.system.advancement.find((advancement) => advancement.title === "Приёмы боевого стиля");

    assert.deepEqual(
      maneuverGrant.configuration.items.map((item) => maneuverNameByUuid.get(item.uuid)),
      styleData.maneuvers,
      `Боевой стиль ${styleData.name} должен выдавать свои приёмы`
    );
  }
});

test("fighter fighting style maneuver grants use actual class-feature document UUIDs", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const definitions = buildFeatureDefinitions(fighter);
  const style = definitions.find((definition) => definition.sourceType === "fightingStyle" && definition.styleName === "Дуэлянт");
  const styleManeuvers = style.maneuverFeatureIds.map((featureId, index) => {
    const definition = definitions.find((entry) => entry.featureId === featureId);
    return {
      definition,
      uuid: `Compendium.world.rebreya-class-features.Item.actualManeuver${index}`
    };
  });
  const featureUuidById = buildFeatureUuidMap(
    definitions,
    "world.rebreya-class-features",
    styleManeuvers.map(({ definition, uuid }) => makeFeatureDocument(definition, uuid))
  );
  const entry = createFeatureEntryData(style, new Map(), null, { featureUuidById });
  const maneuverGrant = entry.system.advancement.find((advancement) => advancement.title === "Приёмы боевого стиля");

  assert.deepEqual(
    maneuverGrant.configuration.items.map((item) => item.uuid),
    styleManeuvers.map(({ uuid }) => uuid)
  );
});

test("fighter fighting style descriptions link their fixed maneuvers", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const definitions = buildFeatureDefinitions(fighter);
  const featureUuidById = makeUuidMap(definitions);
  const style = definitions.find((definition) => definition.sourceType === "fightingStyle" && definition.styleName === "Сражение вслепую");
  const entry = createFeatureEntryData(style, new Map(), null, { featureUuidById });

  for (const maneuverName of ["Готовность", "Атака с финтом", "Точная атака"]) {
    const maneuver = definitions.find((definition) => definition.sourceType === "fighterManeuver" && definition.name === maneuverName);
    assert.match(
      entry.system.description.value,
      new RegExp(`@UUID\\[${featureUuidById.get(maneuver.featureId).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\]\\{[^}]+\\}`, "u"),
      `Описание боевого стиля должно ссылаться на ${maneuverName}`
    );
  }
});

test("fighter fighting style description links preserve actual maneuver UUIDs and tolerate е/ё spelling", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const definitions = buildFeatureDefinitions(fighter);
  const style = definitions.find((definition) => definition.sourceType === "fightingStyle" && definition.styleName === "Перехват");
  const styleManeuvers = style.maneuverFeatureIds.map((featureId, index) => {
    const definition = definitions.find((entry) => entry.featureId === featureId);
    return {
      definition,
      uuid: `Compendium.world.rebreya-class-features.Item.actualLinkedManeuver${index}`
    };
  });
  const featureUuidById = buildFeatureUuidMap(
    definitions,
    "world.rebreya-class-features",
    styleManeuvers.map(({ definition, uuid }) => makeFeatureDocument(definition, uuid))
  );
  const entry = createFeatureEntryData(style, new Map(), null, { featureUuidById });

  assert.match(entry.system.description.value, /@UUID\[Compendium\.world\.rebreya-class-features\.Item\.actualLinkedManeuver0\]\{Подмена\}/u);
  assert.match(entry.system.description.value, /@UUID\[Compendium\.world\.rebreya-class-features\.Item\.actualLinkedManeuver1\]\{Атака с Маневром\}/u);
  assert.match(entry.system.description.value, /@UUID\[Compendium\.world\.rebreya-class-features\.Item\.actualLinkedManeuver2\]\{Провоцирующая Атака\}/u);
});

test("superior technique description does not link every maneuver in the choice pool", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const definitions = buildFeatureDefinitions(fighter);
  const featureUuidById = makeUuidMap(definitions);
  const style = definitions.find((definition) => definition.sourceType === "fightingStyle" && definition.styleName === "Превосходная техника");
  const entry = createFeatureEntryData(style, new Map(), null, { featureUuidById });

  assert.equal((entry.system.description.value.match(/@UUID\[/gu) ?? []).length, 0);
});

test("superior technique fighting style chooses any three maneuvers", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const definitions = buildFeatureDefinitions(fighter);
  const featureUuidById = makeUuidMap(definitions);
  const style = definitions.find((definition) => definition.sourceType === "fightingStyle" && definition.styleName === "Превосходная техника");
  const entry = createFeatureEntryData(style, new Map(), null, { featureUuidById });
  const choice = entry.system.advancement.find((advancement) => advancement.type === "ItemChoice");

  assert.equal(entry.name, "Боевой стиль: Превосходная техника");
  assert.equal(choice.title, "Приёмы боевого стиля");
  assert.equal(choice.configuration.choices["0"].count, 3);
  assert.equal(choice.configuration.pool.length, 24);
});

test("battle master subclass offers maneuver choices at its progression levels", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const definitions = buildFeatureDefinitions(fighter);
  const featureUuidById = makeUuidMap(definitions);
  const subclass = fighter.subclasses.find((entry) => entry.name === "Мастер боевых искусств");
  const advancement = buildSubclassAdvancements(subclass, {
    featureUuidById,
    maneuverEntries: fighter.maneuvers,
    classIdentifier: fighter.classData.identifier
  });
  const maneuverChoices = advancement.filter((entry) => entry.type === "ItemChoice" && entry.title.startsWith("Приёмы"));

  assert.deepEqual(maneuverChoices.map((entry) => entry.level), [3, 7, 10, 15, 18]);
  assert.deepEqual(maneuverChoices.map((entry) => entry.configuration.choices[String(entry.level)].count), [2, 2, 2, 2, 2]);
  assert.equal(maneuverChoices[0].configuration.pool.length, 24);
});

test("rune knight subclass offers rune choices at its progression levels", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const definitions = buildFeatureDefinitions(fighter);
  const featureUuidById = makeUuidMap(definitions);
  const subclass = fighter.subclasses.find((entry) => entry.name === "Рунный рыцарь");
  const advancement = buildSubclassAdvancements(subclass, {
    featureUuidById,
    runeEntries: fighter.runes,
    classIdentifier: fighter.classData.identifier
  });
  const runeChoices = advancement.filter((entry) => entry.type === "ItemChoice" && entry.title.startsWith("Руны"));
  const runeDefinitions = definitions.filter((definition) => definition.sourceType === "runeKnightRune");
  const runeUuidByName = new Map(runeDefinitions.map((definition) => [definition.name, featureUuidById.get(definition.featureId)]));
  const poolUuidsByLevel = new Map(runeChoices.map((entry) => [
    entry.level,
    entry.configuration.pool.map((poolEntry) => poolEntry.uuid)
  ]));

  assert.deepEqual(runeChoices.map((entry) => entry.level), [3, 7, 10, 15]);
  assert.deepEqual(runeChoices.map((entry) => entry.configuration.choices[String(entry.level)].count), [2, 1, 1, 1]);
  assert.deepEqual(runeChoices.map((entry) => entry.configuration.pool.length), [4, 6, 6, 6]);
  assert.ok(poolUuidsByLevel.get(3).includes(runeUuidByName.get("Каменная руна")));
  assert.equal(poolUuidsByLevel.get(3).includes(runeUuidByName.get("Холмовая руна")), false);
  assert.ok(poolUuidsByLevel.get(7).includes(runeUuidByName.get("Холмовая руна")));
  assert.ok(poolUuidsByLevel.get(7).includes(runeUuidByName.get("Штормовая руна")));
});

test("fighter multiattack variants are activatable feature items", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const definitions = buildFeatureDefinitions(fighter);
  const actionSurge = definitions.find((definition) => definition.name === "Воинская мультиатака: Всплеск действий");
  const entry = createFeatureEntryData(actionSurge, new Map());
  const activity = Object.values(entry.system.activities)[0];

  assert.equal(entry.effects.length, 1);
  assert.equal(entry.system.uses.max, "@prof");
  assert.equal(entry.system.uses.recovery[0].period, "lr");
  assert.equal(activity.activation.type, "special");
  assert.deepEqual(activity.consumption.targets.map((target) => target.value), ["1"]);
});

test("fighter descriptions fold PDF hard wraps but keep heading breaks", () => {
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));
  const definitions = buildFeatureDefinitions(fighter);
  const actionSurge = definitions.find((definition) => definition.name === "Воинская мультиатака: Всплеск действий");
  const entry = createFeatureEntryData(actionSurge, new Map());
  const html = entry.system.description.value;

  assert.match(html, /Воинская мультиатака: Всплеск действий<br>2-й уровень, умение воина<br>Вы на мгновение/u);
  assert.match(html, /можете стать Заряженным/u);
  assert.doesNotMatch(html, /стать<br>Заряженным/u);
  assert.doesNotMatch(html, /текущего<br>хода/u);
});

test("minor feat pool excludes choice option items", async () => {
  const rows = [
    {
      _id: "aaaaaaaaaaaaaaaa",
      name: "Аристократичность",
      flags: { teyvankal: { section: "Младшие черты" } }
    },
    {
      _id: "bbbbbbbbbbbbbbbb",
      name: "Аристократические интриги",
      flags: {
        teyvankal: { section: "Младшие черты" },
        "rebreya-main": { choiceOption: { parentIdentifier: "aristokratichnost", value: "aristocratic-intrigue" } }
      }
    },
    {
      _id: "cccccccccccccccc",
      name: "Знаток доспехов",
      flags: { teyvankal: { section: "Младшие черты" } }
    },
    {
      _id: "dddddddddddddddd",
      name: "Лёгкие доспехи",
      flags: {
        teyvankal: { section: "Младшие черты" },
        "rebreya-main": { choiceOption: { parentIdentifier: "znatok-dospehov", value: "lgt" } }
      }
    }
  ];

  const pool = await withGamePacks(makeFeatIndexPack(rows), () => buildMinorFeatPool());

  assert.deepEqual(pool, [
    "Compendium.world.rebreya-feats.Item.aaaaaaaaaaaaaaaa",
    "Compendium.world.rebreya-feats.Item.cccccccccccccccc"
  ]);
});
