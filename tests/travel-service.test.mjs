import test from "node:test";
import assert from "node:assert/strict";

import {
  advanceTravelProgress,
  buildTravelMapPosition,
  buildTravelPlan,
  normalizeTravelState
} from "../scripts/data/travel-service.js";

const network = Object.freeze({
  map: {
    sceneName: "Карта мира",
    sourceWidth: 100,
    sourceHeight: 100,
    sceneWidth: 200,
    sceneHeight: 100
  },
  cities: [
    { id: "a", name: "Альфа", state: "Север", regionName: "Луг", x: 0, y: 0 },
    { id: "b", name: "Бета", state: "Север", regionName: "Луг", x: 10, y: 0 },
    { id: "c", name: "Гамма", state: "Юг", regionName: "Берег", x: 10, y: 10 },
    { id: "d", name: "Дельта", state: "Юг", regionName: "Берег", x: 20, y: 10 }
  ],
  routes: [
    { id: "ab", sourceId: "a", targetId: "b", mode: "land", type: "Земля", miles: 12, points: [[0, 0], [10, 0]] },
    { id: "bc", sourceId: "b", targetId: "c", mode: "land", type: "Земля", miles: 15, points: [[10, 0], [10, 10]] },
    { id: "ac-sea", sourceId: "a", targetId: "c", mode: "water", type: "Море", miles: 8, points: [[0, 0], [10, 10]] },
    { id: "cd", sourceId: "c", targetId: "d", mode: "rail", type: "ЖД", miles: 6, points: [[10, 10], [20, 10]] }
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

test("buildTravelPlan lets land travel use rail segments as walkable connections", () => {
  const plan = buildTravelPlan(network, {
    originCityId: "b",
    destinationCityId: "d",
    mode: "land"
  });

  assert.equal(plan.available, true);
  assert.equal(plan.totalMiles, 21);
  assert.deepEqual(plan.cityIds, ["b", "c", "d"]);
  assert.deepEqual(plan.legs.map((leg) => leg.routeId), ["bc", "cd"]);
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

test("buildTravelMapPosition follows route points and scales them to the world map scene", () => {
  const state = normalizeTravelState({
    originCityId: "a",
    destinationCityId: "c",
    mode: "land",
    traveledMiles: 19.5
  });
  const plan = buildTravelPlan(network, state);
  const position = buildTravelMapPosition(network, plan, state);

  assert.equal(position.available, true);
  assert.equal(position.sceneName, "Карта мира");
  assert.equal(position.sourceX, 10);
  assert.equal(position.sourceY, 5);
  assert.equal(position.sceneX, 20);
  assert.equal(position.sceneY, 5);
  assert.equal(position.routeId, "bc");
});
