import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DOWNTIME_ITEM_TYPE, MODULE_ID } from "../scripts/constants.js";
import {
  createDowntimeItemData,
  normalizeDowntimeActivity,
  normalizeDowntimeActivities
} from "../scripts/data/downtime-compendium.js";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const MODULE_ROOT = dirname(TESTS_DIR);
const DOWNTIME_DATA = JSON.parse(readFileSync(
  join(MODULE_ROOT, "data", "downtime-activities-teyvankal-v01.json"),
  "utf8"
));
const DOWNTIME_V2_SOURCE = readFileSync(
  join(MODULE_ROOT, "docs", "Простой V2.txt"),
  "utf8"
);

const V2_ACTIVITY_HEADINGS = [
  ["craft", "Ремесло [0+] / Создание / Крафт"],
  ["firearm-crafting", "Создание огнестрельного оружия [3+]"],
  ["firearm-development", "Разработка огнестрельного оружия [3+]"],
  ["magic-item-crafting", "Создание магического предмета [3+]"],
  ["profession-work", "Работа по профессии [2]"],
  ["rest", "Отдых [1]"],
  ["research", "Исследование [1+]"],
  ["training", "Обучение [1+]"],
  ["gambling", "Азартные игры [4+]"],
  ["fighting-tournament", "Бойцовский турнир [4+]"],
  ["carousing", "Кутёж [3+]"],
  ["magic-item-purchase", "Покупка магического предмета [2+]"],
  ["crime", "Преступная деятельность"],
  ["spread-rumors", "Распространение слухов"],
  ["change-subclass", "Смена подкласса"],
  ["change-class", "Смена класса"],
  ["buy-magic-components", "Покупка магических компонентов"],
  ["search-magic-components", "Поиск магических компонентов"],
  ["gather-rumors", "Сбор слухов"],
  ["laboratory-alchemy", "Лабораторная алхимия [Lich]"],
  ["scientific-lectures", "Участие в научных лекциях и семинарах"],
  ["invention-exhibition", "Участие в выставках изобретений"],
  ["charity", "Благотворительность"],
  ["racing", "Участие в гонках"],
  ["long-project", "Работа над длительным проектом [1–9] [Lich]"],
  ["construct-crafting", "Создание конструкта [0–9]"]
];

function getV2SectionLines(activityId) {
  const sourceLines = DOWNTIME_V2_SOURCE.replace(/\r\n/gu, "\n").split("\n");
  const headingIndex = V2_ACTIVITY_HEADINGS.findIndex(([id]) => id === activityId);
  const heading = V2_ACTIVITY_HEADINGS[headingIndex]?.[1];
  const start = sourceLines.findIndex((line) => line.trim() === heading);
  assert.notEqual(start, -1, `Не найден заголовок V2 для ${activityId}: ${heading}`);

  const nextHeadings = new Set(V2_ACTIVITY_HEADINGS.slice(headingIndex + 1).map(([, value]) => value));
  const end = sourceLines.findIndex((line, index) => index > start && nextHeadings.has(line.trim()));
  return sourceLines
    .slice(start + 1, end === -1 ? sourceLines.length : end)
    .map((line) => line.trim())
    .filter(Boolean);
}

function htmlToPlainText(value = "") {
  return String(value)
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<[^>]+>/gu, "\n")
    .replace(/&quot;/gu, "\"")
    .replace(/&#39;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&")
    .replace(/\n{2,}/gu, "\n")
    .trim();
}

const DOWNTIME_TABLE_EXPECTATIONS = [
  {
    activityId: "craft",
    captions: ["Экстренная работа"],
    brokenPattern: /Экстренная работа<br>Дополнительные часы работы<br>Монет в день/u
  },
  {
    activityId: "profession-work",
    captions: ["Модификаторы работы", "Таблица работы"],
    brokenPattern: /Модификаторы работы<br>Модификатор<br>Бонус к броску|Таблица работы<br>Уровень<br>Провал/u
  },
  {
    activityId: "research",
    captions: ["Стоимость Исследования", "Результаты исследования"],
    brokenPattern: /Стоимость Исследования<br>Ранг деятельности<br>Базовая сумму|Результаты исследования<br>Результат проверки<br>Итог/u
  },
  {
    activityId: "gambling",
    captions: ["Результаты игр"],
    brokenPattern: /Результаты игр<br>Результат<br>Итог/u
  },
  {
    activityId: "fighting-tournament",
    captions: ["Результат турнира"],
    brokenPattern: /Результат турнира<br>Результат<br>Итог/u
  },
  {
    activityId: "laboratory-alchemy",
    captions: ["Лабораторный способ"],
    brokenPattern: /Лабораторный способ<br>Уровень зелия<br>Лабораторный способ<br>Золото/u
  }
];

test("downtime activity data covers every base downtime heading from chapter 9", () => {
  const activities = normalizeDowntimeActivities(DOWNTIME_DATA.activities);
  const activityIds = activities.map((activity) => activity.id);

  assert.deepEqual(activityIds, [
    "craft",
    "firearm-crafting",
    "firearm-development",
    "magic-item-crafting",
    "profession-work",
    "rest",
    "research",
    "training",
    "gambling",
    "fighting-tournament",
    "carousing",
    "magic-item-purchase",
    "crime",
    "spread-rumors",
    "change-subclass",
    "change-class",
    "buy-magic-components",
    "search-magic-components",
    "gather-rumors",
    "laboratory-alchemy",
    "scientific-lectures",
    "invention-exhibition",
    "charity",
    "racing",
    "long-project",
    "construct-crafting"
  ]);
});

test("research downtime keeps rank costs and maps check thresholds into fragments", () => {
  const research = normalizeDowntimeActivity(
    DOWNTIME_DATA.activities.find((activity) => activity.id === "research")
  );
  const itemData = createDowntimeItemData(research, new Map());
  const downtime = itemData.flags[MODULE_ID].downtime;
  const rankAction = downtime.targetActions.find((action) => action.id === "research-rank");
  const resourceAction = downtime.targetActions.find((action) => action.id === "research-resources");
  const checkAction = downtime.targetActions.find((action) => action.id === "research-check");
  const resultAction = downtime.targetActions.find((action) => action.id === "research-result");

  assert.equal(itemData.type, DOWNTIME_ITEM_TYPE);
  assert.equal(itemData.name, "Исследование");
  assert.equal(downtime.rank, "1+");
  assert.deepEqual(downtime.rankTable.map((row) => [row.rank, row.baseCost, row.stepCost]), [
    [1, 10, 5],
    [2, 20, 10],
    [3, 50, 50],
    [4, 120, 100],
    [5, 200, 200],
    [6, 500, 400],
    [7, 1000, 800],
    [8, 2500, 2000],
    [9, 5000, 3000]
  ]);
  assert.equal(checkAction.actionType, "check");
  assert.equal(checkAction.sourceType, "ability");
  assert.equal(checkAction.ability, "int");
  assert.equal(checkAction.recordMode, "pass-thresholds");
  assert.deepEqual(checkAction.thresholds.map((threshold) => threshold.outcome), [
    "failure",
    "partial",
    "success",
    "great-success"
  ]);
  assert.equal(rankAction.actionType, "rankChoice");
  assert.equal(rankAction.rankChoice.rows[3].label, "Ранг 4");
  assert.equal(resourceAction.actionType, "resources");
  assert.equal(resourceAction.resources.dependsOnRank, true);
  assert.equal(resourceAction.resources.rankSourceActionId, "research-rank");
  assert.equal(resourceAction.resources.quantity.max, 5);
  assert.equal(resourceAction.resources.rankCosts[3].baseCost, 120);
  assert.equal(resourceAction.resources.rankCosts[3].unitCost, 100);
  assert.equal(resultAction.actionType, "downtimeResult");
  assert.equal(resultAction.outcomeMode, "pass-thresholds");
  assert.equal(resultAction.recordMode, "single-result");
  assert.equal(resultAction.resultMapping.sourceActionId, "research-check");
  assert.equal(resultAction.resultMapping.sourceField, "thresholdOutcome");
  assert.equal(resultAction.resultMapping.outputField, "fragments");
  assert.deepEqual(resultAction.resultMapping.rows.map((row) => [row.sourceOutcome, row.value, row.outcome]), [
    ["failure", 0, "no-fragments"],
    ["partial", 1, "one-fragment"],
    ["success", 2, "two-fragments"],
    ["great-success", 3, "three-fragments"]
  ]);
});

test("long project downtime defines rank-based counters and configurable weekly progress", () => {
  const longProject = normalizeDowntimeActivity(
    DOWNTIME_DATA.activities.find((activity) => activity.id === "long-project")
  );
  const itemData = createDowntimeItemData(longProject, new Map());
  const downtime = itemData.flags[MODULE_ID].downtime;
  const rankAction = downtime.targetActions.find((action) => action.id === "long-project-rank");
  const descriptionAction = downtime.targetActions.find((action) => action.id === "long-project-description");
  const counterAction = downtime.targetActions.find((action) => action.id === "long-project-counter");
  const resourceAction = downtime.targetActions.find((action) => action.id === "long-project-resources");
  const checkAction = downtime.targetActions.find((action) => action.id === "long-project-check");
  const resultAction = downtime.targetActions.find((action) => action.id === "long-project-result");

  assert.equal(descriptionAction.actionType, "descriptionBlock");
  assert.equal(descriptionAction.descriptionBlock.title, "");
  assert.equal(descriptionAction.descriptionBlock.description, "");
  assert.equal(rankAction.actionType, "rankChoice");
  assert.deepEqual(rankAction.rankChoice.rows.map((row) => [row.rank, row.counterMax]), [
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 6],
    [5, 6],
    [6, 6],
    [7, 8],
    [8, 8],
    [9, 8]
  ]);
  assert.equal(counterAction.actionType, "projectCounter");
  assert.equal(counterAction.projectCounter.rankSourceActionId, "long-project-rank");
  assert.deepEqual(counterAction.projectCounter.maxByRank.map((row) => [row.from, row.to, row.max]), [
    [1, 3, 4],
    [4, 6, 6],
    [7, 9, 8]
  ]);
  assert.equal(resourceAction.actionType, "resources");
  assert.equal(resourceAction.resources.quantity.unit, "gp");
  assert.equal(resourceAction.resources.quantity.unitCost, 1);
  assert.equal(checkAction.actionType, "check");
  assert.equal(checkAction.configurable, true);
  assert.equal(checkAction.outcomeMode, "dc-sum");
  assert.equal(checkAction.dcByRank.rankSourceActionId, "long-project-rank");
  assert.equal(checkAction.dcByRank.locked, true);
  assert.deepEqual(checkAction.dcByRank.rows.map((row) => [row.rank, row.dc]), [
    [1, 12],
    [2, 14],
    [3, 16],
    [4, 18],
    [5, 20],
    [6, 22],
    [7, 25],
    [8, 30],
    [9, 35]
  ]);
  assert.equal(resultAction.actionType, "downtimeResult");
  assert.equal(resultAction.resultFormula.outputField, "progressSteps");
  assert.deepEqual(resultAction.resultFormula.terms.map((term) => [term.actionId, term.field]), [
    ["long-project-check", "dcProgressSteps"]
  ]);
});

test("carousing downtime stores social class resource choices", () => {
  const carousing = normalizeDowntimeActivity(
    DOWNTIME_DATA.activities.find((activity) => activity.id === "carousing")
  );
  const itemData = createDowntimeItemData(carousing, new Map());
  const downtime = itemData.flags[MODULE_ID].downtime;
  const resourceAction = downtime.targetActions.find((action) => action.id === "carousing-resources");

  assert.equal(resourceAction.actionType, "resources");
  assert.deepEqual(resourceAction.resources.choices.map((choice) => [
    choice.id,
    choice.label,
    choice.cost.amount,
    choice.cost.currency
  ]), [
    ["commoners", "Простонародье", 10, "gp"],
    ["wealthy", "Зажиточные люди", 50, "gp"],
    ["nobility", "Знать", 250, "gp"]
  ]);
  assert.equal(resourceAction.resources.choices[2].requirement, "Доступ в местный высший свет или успешная маскировка.");
});

test("core automated downtimes expose structured player inputs", () => {
  const activities = normalizeDowntimeActivities(DOWNTIME_DATA.activities);
  const byId = new Map(activities.map((activity) => [activity.id, createDowntimeItemData(activity, new Map()).flags[MODULE_ID].downtime]));

  const craft = byId.get("craft");
  const craftItem = craft.targetActions.find((action) => action.id === "craft-item");
  const craftQuantity = craft.targetActions.find((action) => action.id === "craft-quantity");
  const craftHours = craft.targetActions.find((action) => action.id === "craft-hours");
  const craftWorkshop = craft.targetActions.find((action) => action.id === "craft-workshop");
  assert.equal(craftItem?.actionType, "itemChoice");
  assert.equal(craftItem?.itemChoice?.sourceType, "gear");
  assert.equal(craftItem?.itemChoice?.managedOnly, true);
  assert.equal(craftItem?.itemChoice?.allowMagic, false);
  assert.deepEqual(craftQuantity?.input, {
    min: 1,
    step: 1,
    default: 1,
    unit: "шт."
  });
  assert.deepEqual(craftHours?.input, {
    min: 8,
    max: 16,
    step: 1,
    default: 8,
    unit: "ч."
  });
  assert.equal(craftWorkshop?.actionType, "optionChoice");
  assert.equal(craftWorkshop?.selectionMode, "multiple");
  assert.deepEqual(craftWorkshop?.options, [{
    id: "owned",
    label: "Своя мастерская",
    value: true
  }]);
  assert.equal(craft.targetActions.some((action) => ["craft-resources", "craft-days", "craft-progress"].includes(action.id)), false);

  const firearmCrafting = byId.get("firearm-crafting");
  assert.equal(firearmCrafting.targetActions.find((action) => action.id === "firearm-crafting-item")?.itemChoice?.subtype, "firearm");
  assert.equal(firearmCrafting.targetActions.find((action) => action.id === "firearm-crafting-blueprint")?.itemChoice?.role, "blueprint");

  const firearmDevelopment = byId.get("firearm-development");
  assert.equal(firearmDevelopment.targetActions.find((action) => action.id === "firearm-development-item")?.resources?.cost?.formula, "2x цена оружия единоразово + 200 зм за неделю");

  const profession = byId.get("profession-work");
  assert.equal(profession.targetActions.find((action) => action.id === "profession-modifiers")?.actionType, "optionChoice");
  assert.equal(profession.targetActions.find((action) => action.id === "profession-result")?.outcomeMode, "thresholds");

  const research = byId.get("research");
  assert.equal(research.targetActions.find((action) => action.id === "research-rank")?.actionType, "rankChoice");
  assert.equal(research.targetActions.find((action) => action.id === "research-resources")?.resources?.quantity?.max, 5);

  const training = byId.get("training");
  assert.equal(training.targetActions.find((action) => action.id === "training-type")?.options?.length, 7);

  const gambling = byId.get("gambling");
  assert.equal(gambling.targetActions.find((action) => action.id === "gambling-stake")?.actionType, "numericInput");
  assert.equal(gambling.targetActions.find((action) => action.id === "gambling-insight")?.dcFormulaBySelection?.actionId, "gambling-stake");
  assert.equal(gambling.targetActions.find((action) => action.id === "gambling-result")?.recordMode, "single-result");
  assert.deepEqual(
    gambling.targetActions.find((action) => action.id === "gambling-result")?.resultFormula?.terms.map((term) => [term.actionId, term.field]),
    [
      ["gambling-insight", "success"],
      ["gambling-deception", "success"],
      ["gambling-intimidation", "success"]
    ]
  );

  const tournament = byId.get("fighting-tournament");
  assert.equal(tournament.targetActions.find((action) => action.id === "tournament-large-city")?.actionType, "optionChoice");
  assert.equal(tournament.targetActions.find((action) => action.id === "tournament-athletics")?.dcFormulaBySelection?.actionId, "tournament-large-city");
  assert.equal(tournament.targetActions.find((action) => action.id === "tournament-result")?.recordMode, "single-result");
  assert.deepEqual(
    tournament.targetActions.find((action) => action.id === "tournament-result")?.resultFormula?.terms.map((term) => [term.actionId, term.field]),
    [
      ["tournament-athletics", "success"],
      ["tournament-acrobatics", "success"],
      ["tournament-endurance", "success"]
    ]
  );

  const magicItemPurchase = byId.get("magic-item-purchase");
  assert.equal(magicItemPurchase.targetActions.find((action) => action.id === "magic-item-purchase-item")?.itemChoice?.sourceType, "magicItem");
  assert.equal(magicItemPurchase.targetActions.find((action) => action.id === "magic-item-purchase-trade-step")?.actionType, "optionChoice");
  assert.equal(magicItemPurchase.targetActions.find((action) => action.id === "magic-item-purchase-price")?.actionType, "formulaRoll");
});

test("downtime item descriptions preserve every V2 source rule line", () => {
  const activities = normalizeDowntimeActivities(DOWNTIME_DATA.activities);

  for (const activity of activities) {
    const expectedLines = getV2SectionLines(activity.id);
    if (!expectedLines.length) {
      continue;
    }

    const itemData = createDowntimeItemData(activity, new Map());
    const description = htmlToPlainText(itemData.system.description.value);
    for (const expectedLine of expectedLines) {
      assert.ok(
        description.includes(expectedLine),
        `${activity.id} description is missing V2 text line: ${expectedLine}`
      );
    }
  }
});

test("downtime item descriptions render V2 rules text in named blocks", () => {
  const craft = normalizeDowntimeActivity(
    DOWNTIME_DATA.activities.find((activity) => activity.id === "craft")
  );
  const itemData = createDowntimeItemData(craft, new Map());
  const description = itemData.system.description.value;

  assert.match(description, /<h3>Нарративная заявка<\/h3><p>Персонаж может создавать/u);
  assert.match(description, /<h3>Ресурсы<\/h3><p>Ресурсы\. Чтобы заниматься Ремеслом/u);
  assert.match(description, /<h3>Определение последствий<\/h3><p>Определение результата\. За каждый день/u);
  assert.equal(itemData.flags[MODULE_ID].downtime.descriptionHtml, description);
});

test("downtime item descriptions render V2 tabular blocks as HTML tables", () => {
  const expectedTableCount = DOWNTIME_TABLE_EXPECTATIONS
    .reduce((total, expectation) => total + expectation.captions.length, 0);
  let actualTableCount = 0;

  for (const expectation of DOWNTIME_TABLE_EXPECTATIONS) {
    const activity = normalizeDowntimeActivity(
      DOWNTIME_DATA.activities.find((entry) => entry.id === expectation.activityId)
    );
    const itemData = createDowntimeItemData(activity, new Map());
    const description = itemData.system.description.value;
    actualTableCount += description.match(/<table\b/giu)?.length ?? 0;

    assert.doesNotMatch(description, expectation.brokenPattern);
    for (const caption of expectation.captions) {
      assert.match(
        description,
        new RegExp(`<table\\b[\\s\\S]*?<caption>${caption}</caption>[\\s\\S]*?</table>`, "u"),
        `${expectation.activityId} must render "${caption}" as an HTML table`
      );
    }
  }

  assert.equal(actualTableCount, expectedTableCount);
});

test("downtime item descriptions are copied directly from activity data", () => {
  for (const rawActivity of DOWNTIME_DATA.activities) {
    assert.equal(
      typeof rawActivity.descriptionHtml,
      "string",
      `${rawActivity.id} must store direct item descriptionHtml`
    );
    assert.ok(rawActivity.descriptionHtml.includes("<h2>"), `${rawActivity.id} direct description must be item HTML`);

    const activity = normalizeDowntimeActivity(rawActivity);
    const itemData = createDowntimeItemData(activity, new Map());
    const downtimeFlag = itemData.flags[MODULE_ID].downtime;

    assert.equal(itemData.system.description.value, rawActivity.descriptionHtml);
    assert.equal(downtimeFlag.descriptionHtml, rawActivity.descriptionHtml);
    assert.equal(Object.hasOwn(downtimeFlag, "rulesText"), false);
  }
});

test("downtime item descriptions survive parser round trips", () => {
  for (const rawActivity of DOWNTIME_DATA.activities) {
    const activity = normalizeDowntimeActivity(rawActivity);
    const itemData = createDowntimeItemData(activity, new Map());
    const encodedItem = JSON.stringify(itemData);
    const decodedItem = JSON.parse(encodedItem);
    const description = decodedItem.system.description.value;

    assert.equal(description, rawActivity.descriptionHtml);
    assert.doesNotMatch(description, /<script\b|on[a-z]+\s*=/iu);
    assert.doesNotMatch(description, /&lt;h[23]&gt;/iu);
  }
});

test("downtime item data stores automation status and a stable Rebreya template flag", () => {
  const rest = normalizeDowntimeActivity(
    DOWNTIME_DATA.activities.find((activity) => activity.id === "rest")
  );
  const itemData = createDowntimeItemData(rest, new Map([["Простой", "folder-id"]]));

  assert.equal(itemData.folder, "folder-id");
  assert.equal(itemData.img, "systems/dnd5e/icons/svg/activity/utility.svg");
  assert.equal(itemData.ownership.default, 2);
  assert.equal(itemData.flags[MODULE_ID].managed, true);
  assert.equal(itemData.flags[MODULE_ID].sourceType, "downtimeTemplate");
  assert.equal(itemData.flags[MODULE_ID].downtimeId, "rest");
  assert.equal(itemData.flags[MODULE_ID].downtime.automationStatus, "partial");
  assert.equal(itemData.flags[MODULE_ID].downtime.defaultWeeks, 1);
  assert.match(itemData.flags[MODULE_ID].signature, /"downtimeId":"rest"/u);
  assert.match(itemData.system.description.value, /Отдых/u);
});

test("downtime item data prefers a module-owned icon matched by activity name", () => {
  const rest = normalizeDowntimeActivity(
    DOWNTIME_DATA.activities.find((activity) => activity.id === "rest")
  );
  const iconPath = "modules/rebreya-main/templates/icons/Downtime/%D0%9E%D1%82%D0%B4%D1%8B%D1%85.webp";
  const itemData = createDowntimeItemData(
    rest,
    new Map(),
    new Map([["отдых", iconPath]])
  );

  assert.equal(itemData.img, iconPath);
  assert.ok(itemData.flags[MODULE_ID].signature.includes(iconPath));
});
