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

test("downtime item data stores automation status and a stable Rebreya template flag", () => {
  const rest = normalizeDowntimeActivity(
    DOWNTIME_DATA.activities.find((activity) => activity.id === "rest")
  );
  const itemData = createDowntimeItemData(rest, new Map([["Простой", "folder-id"]]));

  assert.equal(itemData.folder, "folder-id");
  assert.equal(itemData.ownership.default, 2);
  assert.equal(itemData.flags[MODULE_ID].managed, true);
  assert.equal(itemData.flags[MODULE_ID].sourceType, "downtimeTemplate");
  assert.equal(itemData.flags[MODULE_ID].downtimeId, "rest");
  assert.equal(itemData.flags[MODULE_ID].downtime.automationStatus, "partial");
  assert.equal(itemData.flags[MODULE_ID].downtime.defaultWeeks, 1);
  assert.match(itemData.flags[MODULE_ID].signature, /"downtimeId":"rest"/u);
  assert.match(itemData.system.description.value, /Отдых/u);
});
