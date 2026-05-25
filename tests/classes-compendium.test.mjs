import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

test("barbarian and fighter reworks use the ZoZT source label", () => {
  const barbarian = normalizeClassCompendiumData(loadJson("data/barbarian-rework-v012.json"));
  const fighter = normalizeClassCompendiumData(loadJson("data/fighter-rework-v028.json"));

  assert.equal(barbarian.sourceLabel, "ЗоЗТ");
  assert.equal(fighter.sourceLabel, "ЗоЗТ");
  assert.equal(barbarian.runes.length, 0);
  assert.equal(createClassSystem(barbarian.classData, [], barbarian.sourceLabel).source.custom, "ЗоЗТ");
  assert.equal(createClassSystem(fighter.classData, [], fighter.sourceLabel).source.custom, "ЗоЗТ");
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
  const maneuver = buildFeatureDefinitions(fighter).find((definition) => definition.sourceType === "fighterManeuver");
  const entry = createFeatureEntryData(maneuver, new Map());
  const activity = Object.values(entry.system.activities)[0];

  assert.equal(entry.flags["rebreya-main"].sourceType, "fighterManeuver");
  assert.deepEqual(activity.consumption.targets, [{
    type: "itemUses",
    target: "fighter-dominance",
    value: "1",
    scaling: {
      mode: "",
      formula: ""
    }
  }]);
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
    assert.match(activities[0].description.chatFlavor, /@scale\.fighter-rework-v028\.dominance-die/u);
  }
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
