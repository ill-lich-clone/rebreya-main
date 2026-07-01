import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceTravelProgress,
  buildTravelPlan,
  normalizeTravelState
} from "../scripts/data/travel-service.js";

const network = Object.freeze({
  cities: [
    { id: "a", name: "Альфа", state: "Север", regionName: "Луг" },
    { id: "b", name: "Бета", state: "Север", regionName: "Луг" },
    { id: "c", name: "Гамма", state: "Юг", regionName: "Берег" },
    { id: "d", name: "Дельта", state: "Юг", regionName: "Берег" }
  ],
  routes: [
    { id: "ab", sourceId: "a", targetId: "b", mode: "land", type: "Земля", miles: 12 },
    { id: "bc", sourceId: "b", targetId: "c", mode: "land", type: "Земля", miles: 15 },
    { id: "ac-sea", sourceId: "a", targetId: "c", mode: "water", type: "Море", miles: 8 },
    { id: "cd", sourceId: "c", targetId: "d", mode: "rail", type: "ЖД", miles: 6 }
  ]
});

test("buildTravelPlan chooses the shortest land path and computes 3 mph timing", () => {
  const plan = buildTravelPlan(network, {
    originCityId: "a",
    destinationCityId: "c",
    mode: "land"
  });

  assert.equal(plan.available, true);
  assert.equal(plan.mode, "land");
  assert.equal(plan.totalMiles, 27);
  assert.equal(plan.totalHours, 9);
  assert.deepEqual(plan.cityIds, ["a", "b", "c"]);
  assert.deepEqual(plan.legs.map((leg) => leg.routeId), ["ab", "bc"]);
});

test("buildTravelPlan keeps non-land modes out of the first travel mode", () => {
  const plan = buildTravelPlan(network, {
    originCityId: "a",
    destinationCityId: "c",
    mode: "water"
  });

  assert.equal(plan.available, true);
  assert.equal(plan.totalMiles, 8);
  assert.deepEqual(plan.cityIds, ["a", "c"]);
});

test("advanceTravelProgress adds three miles per hour and clamps at destination", () => {
  const current = normalizeTravelState({
    originCityId: "a",
    destinationCityId: "c",
    mode: "land",
    traveledMiles: 24
  });
  const next = advanceTravelProgress(current, { totalMiles: 27 }, 8);

  assert.equal(next.traveledMiles, 27);
  assert.equal(next.completed, true);
  assert.equal(next.addedMiles, 3);
});
