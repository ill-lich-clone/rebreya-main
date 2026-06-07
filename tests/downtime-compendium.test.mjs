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

test("research downtime keeps the rank costs and structured result thresholds", () => {
  const research = normalizeDowntimeActivity(
    DOWNTIME_DATA.activities.find((activity) => activity.id === "research")
  );
  const itemData = createDowntimeItemData(research, new Map());
  const downtime = itemData.flags[MODULE_ID].downtime;
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
  assert.equal(resultAction.actionType, "downtimeResult");
  assert.equal(resultAction.outcomeMode, "thresholds");
  assert.deepEqual(resultAction.thresholds.map((threshold) => threshold.label), [
    "Безрезультатно",
    "Один фрагмент сведений",
    "Два фрагмента сведений",
    "Три фрагмента сведений"
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
  assert.equal(craft.targetActions.find((action) => action.id === "craft-item")?.actionType, "itemChoice");
  assert.equal(craft.targetActions.find((action) => action.id === "craft-days")?.input?.unit, "дн.");

  const firearmCrafting = byId.get("firearm-crafting");
  assert.equal(firearmCrafting.targetActions.find((action) => action.id === "firearm-crafting-item")?.itemChoice?.subtype, "firearm");
  assert.equal(firearmCrafting.targetActions.find((action) => action.id === "firearm-crafting-blueprint")?.itemChoice?.role, "blueprint");

  const firearmDevelopment = byId.get("firearm-development");
  assert.equal(firearmDevelopment.targetActions.find((action) => action.id === "firearm-development-item")?.resources?.cost?.formula, "2x цена оружия единоразово + 200 зм за неделю");

  const profession = byId.get("profession-work");
  assert.equal(profession.targetActions.find((action) => action.id === "profession-modifiers")?.actionType, "optionChoice");
  assert.equal(profession.targetActions.find((action) => action.id === "profession-result")?.outcomeMode, "thresholds");

  const research = byId.get("research");
  assert.equal(research.targetActions.find((action) => action.id === "research-rank")?.actionType, "optionChoice");
  assert.equal(research.targetActions.find((action) => action.id === "research-extra-steps")?.actionType, "numericInput");

  const training = byId.get("training");
  assert.equal(training.targetActions.find((action) => action.id === "training-type")?.options?.length, 7);

  const gambling = byId.get("gambling");
  assert.equal(gambling.targetActions.find((action) => action.id === "gambling-stake")?.actionType, "numericInput");
  assert.equal(gambling.targetActions.find((action) => action.id === "gambling-insight")?.dcFormulaBySelection?.actionId, "gambling-stake");

  const tournament = byId.get("fighting-tournament");
  assert.equal(tournament.targetActions.find((action) => action.id === "tournament-large-city")?.actionType, "optionChoice");
  assert.equal(tournament.targetActions.find((action) => action.id === "tournament-athletics")?.dcFormulaBySelection?.actionId, "tournament-large-city");

  const magicItemPurchase = byId.get("magic-item-purchase");
  assert.equal(magicItemPurchase.targetActions.find((action) => action.id === "magic-item-purchase-item")?.itemChoice?.sourceType, "magicItem");
  assert.equal(magicItemPurchase.targetActions.find((action) => action.id === "magic-item-purchase-trade-step")?.actionType, "optionChoice");
  assert.equal(magicItemPurchase.targetActions.find((action) => action.id === "magic-item-purchase-price")?.actionType, "formulaRoll");
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
