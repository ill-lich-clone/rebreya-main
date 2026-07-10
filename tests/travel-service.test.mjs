import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  advanceTravelProgress,
  buildTravelMapPosition,
  buildTravelPlan,
  buildTravelSnapshot,
  normalizeLocationName,
  normalizeTravelNetwork,
  normalizeTravelState,
  TravelService
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

test("normalizeTravelNetwork derives travel routes from canonical city connections", () => {
  const canonicalNetwork = normalizeTravelNetwork({
    cities: network.cities,
    routes: [
      { id: "ab-old", sourceId: "a", targetId: "b", mode: "land", type: "Земля", miles: 99, points: [[0, 0], [5, 0], [10, 0]] }
    ],
    economyCities: [
      {
        id: "economy-a",
        name: "Альфа",
        connections: [
          { targetName: "Бета", targetCityId: "economy-b", connectionType: "ЖД", distance: 10, broken: false }
        ]
      },
      {
        id: "economy-b",
        name: "Бета",
        connections: [
          { targetName: "Альфа", targetCityId: "economy-a", connectionType: "ЖД", distance: 10, broken: false },
          { targetName: "Гамма", targetCityId: "economy-c", connectionType: "Земля", distance: 20, broken: false }
        ]
      },
      {
        id: "economy-c",
        name: "Гамма",
        connections: [
          { targetName: "Бета", targetCityId: "economy-b", connectionType: "Земля", distance: 20, broken: false }
        ]
      }
    ]
  });

  const ab = canonicalNetwork.routes.find((route) => route.sourceId === "a" && route.targetId === "b");
  const bc = canonicalNetwork.routes.find((route) => route.sourceId === "b" && route.targetId === "c");

  assert.ok(ab);
  assert.equal(ab.mode, "rail");
  assert.equal(ab.type, "ЖД");
  assert.equal(ab.miles, 10);
  assert.deepEqual(ab.points, [[0, 0], [5, 0], [10, 0]]);
  assert.ok(bc);
  assert.equal(bc.mode, "land");
  assert.equal(bc.type, "Земля");
  assert.equal(bc.miles, 20);
});

test("buildTravelPlan keeps fallback points in the requested travel direction", () => {
  const plan = buildTravelPlan({
    cities: [
      { id: "a", name: "Альфа", x: 0, y: 0 },
      { id: "b", name: "Бета", x: 10, y: 0 }
    ],
    routes: [],
    economyCities: [
      {
        id: "economy-b",
        name: "Бета",
        connections: [
          { targetName: "Альфа", targetCityId: "economy-a", connectionType: "ЖД", distance: 10, broken: false }
        ]
      },
      {
        id: "economy-a",
        name: "Альфа",
        connections: [
          { targetName: "Бета", targetCityId: "economy-b", connectionType: "ЖД", distance: 10, broken: false }
        ]
      }
    ]
  }, {
    originCityId: "a",
    destinationCityId: "b",
    mode: "land"
  });

  assert.equal(plan.available, true);
  assert.deepEqual(plan.legs[0].points, [[0, 0], [10, 0]]);
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

test("advanceTravelProgress can rewind travel progress", () => {
  const current = normalizeTravelState({
    originCityId: "a",
    destinationCityId: "c",
    mode: "land",
    traveledMiles: 12
  });
  const next = advanceTravelProgress(current, { totalMiles: 27 }, -8);

  assert.equal(next.traveledMiles, 0);
  assert.equal(next.completed, false);
  assert.equal(next.addedMiles, -12);
  assert.equal(next.addedHours, -4);
});

test("buildTravelSnapshot exposes travel days and rewind availability", () => {
  const snapshot = buildTravelSnapshot(network, {
    originCityId: "a",
    destinationCityId: "c",
    mode: "land",
    traveledMiles: 3
  });

  assert.equal(snapshot.plan.totalHours, 9);
  assert.equal(snapshot.plan.totalTravelDays, 1.13);
  assert.equal(snapshot.progress.remainingHours, 8);
  assert.equal(snapshot.progress.remainingTravelDays, 1);
  assert.equal(snapshot.canAdvance, true);
  assert.equal(snapshot.canRewind, true);
});

test("actual travel network does not use the conflicting Orlanis-Freh land bridge", async () => {
  const actualNetwork = JSON.parse(await readFile(new URL("../data/travel-network.json", import.meta.url), "utf8"));
  const economyCities = JSON.parse(await readFile(new URL("../data/cities.json", import.meta.url), "utf8"));
  const networkWithEconomy = { ...actualNetwork, economyCities };
  const normalizedNetwork = normalizeTravelNetwork(networkWithEconomy);
  const orlanis = normalizedNetwork.cityByName.get(normalizeLocationName("Орланис"));
  const freh = normalizedNetwork.cityByName.get(normalizeLocationName("Фрех"));
  const tsugengrim = normalizedNetwork.cityByName.get(normalizeLocationName("Цугенгрим"));
  const velgard = normalizedNetwork.cityByName.get(normalizeLocationName("Вельгард"));
  const orlanisFrehRoutes = normalizedNetwork.routes.filter((route) => (
    new Set([route.sourceId, route.targetId]).size === 2
    && route.sourceId && route.targetId
    && [route.sourceId, route.targetId].includes(orlanis?.id)
    && [route.sourceId, route.targetId].includes(freh?.id)
  ));

  assert.equal(orlanisFrehRoutes.some((route) => route.mode === "land"), false);

  const plan = buildTravelPlan(networkWithEconomy, {
    originCityId: tsugengrim?.id,
    destinationCityId: velgard?.id,
    mode: "land"
  });

  assert.equal(plan.available, true);
  assert.equal(plan.legs.some((leg) => [leg.sourceCityId, leg.targetCityId].includes(freh?.id)), false);
});

test("actual canonical city connections bridge Veldoran into land travel", async () => {
  const actualNetwork = JSON.parse(await readFile(new URL("../data/travel-network.json", import.meta.url), "utf8"));
  const economyCities = JSON.parse(await readFile(new URL("../data/cities.json", import.meta.url), "utf8"));
  const networkWithEconomy = { ...actualNetwork, economyCities };
  const normalizedNetwork = normalizeTravelNetwork(networkWithEconomy);
  const dom = normalizedNetwork.cityByName.get(normalizeLocationName("Дом переговоров"));
  const veldoran = normalizedNetwork.cityByName.get(normalizeLocationName("Велдоран"));
  const alKazar = normalizedNetwork.cityByName.get(normalizeLocationName("Аль-Казар"));
  const tsugengrim = normalizedNetwork.cityByName.get(normalizeLocationName("Цугенгрим"));
  const velgard = normalizedNetwork.cityByName.get(normalizeLocationName("Вельгард"));

  const localPlan = buildTravelPlan(networkWithEconomy, {
    originCityId: dom?.id,
    destinationCityId: alKazar?.id,
    mode: "land"
  });
  const fullPlan = buildTravelPlan(networkWithEconomy, {
    originCityId: tsugengrim?.id,
    destinationCityId: velgard?.id,
    mode: "land"
  });

  assert.equal(localPlan.available, true);
  assert.deepEqual(localPlan.cityIds, [dom?.id, veldoran?.id, alKazar?.id]);
  assert.deepEqual(localPlan.legs.map((leg) => [leg.mode, leg.miles]), [["rail", 164], ["land", 260]]);
  assert.equal(fullPlan.available, true);
  assert.equal(fullPlan.cityIds.includes(veldoran?.id), true);
});

test("actual Veldoran bridge follows the nearby road geometry instead of a direct lake line", async () => {
  const actualNetwork = JSON.parse(await readFile(new URL("../data/travel-network.json", import.meta.url), "utf8"));
  const economyCities = JSON.parse(await readFile(new URL("../data/cities.json", import.meta.url), "utf8"));
  const networkWithEconomy = { ...actualNetwork, economyCities };
  const normalizedNetwork = normalizeTravelNetwork(networkWithEconomy);
  const dom = normalizedNetwork.cityByName.get(normalizeLocationName("Дом переговоров"));
  const veldoran = normalizedNetwork.cityByName.get(normalizeLocationName("Велдоран"));

  const plan = buildTravelPlan(networkWithEconomy, {
    originCityId: dom?.id,
    destinationCityId: veldoran?.id,
    mode: "land"
  });

  assert.equal(plan.available, true);
  assert.equal(plan.legs.length, 1);
  assert.equal(plan.legs[0].sourceCityId, dom?.id);
  assert.equal(plan.legs[0].targetCityId, veldoran?.id);
  assert.ok(plan.legs[0].points.length > 2);
  assert.deepEqual(plan.legs[0].points.slice(0, 3), [[6509, 8836], [6516, 8855], [6495, 8876]]);
  assert.deepEqual(plan.legs[0].points.at(-1), [6682, 9078]);
});

test("actual walkable canonical routes have geometry anchored to their cities", async () => {
  const actualNetwork = JSON.parse(await readFile(new URL("../data/travel-network.json", import.meta.url), "utf8"));
  const economyCities = JSON.parse(await readFile(new URL("../data/cities.json", import.meta.url), "utf8"));
  const normalizedNetwork = normalizeTravelNetwork({ ...actualNetwork, economyCities });
  const walkableModes = new Set(["land", "land_plus_gray", "rail"]);
  const errors = [];
  const distance = (point, city) => Math.hypot(point[0] - city.x, point[1] - city.y);

  for (const route of normalizedNetwork.routes) {
    if (!walkableModes.has(route.mode)) {
      continue;
    }

    const source = normalizedNetwork.cityById.get(route.sourceId);
    const target = normalizedNetwork.cityById.get(route.targetId);
    if (!source || !target) {
      errors.push(`${route.sourceName} -> ${route.targetName}: missing city`);
      continue;
    }

    if (route.points.length < 2) {
      errors.push(`${source.name} -> ${target.name} (${route.type}): no geometry`);
      continue;
    }

    const first = route.points[0];
    const last = route.points.at(-1);
    const forwardDistance = distance(first, source) + distance(last, target);
    const backwardDistance = distance(first, target) + distance(last, source);
    if (Math.min(forwardDistance, backwardDistance) > 600) {
      errors.push(`${source.name} -> ${target.name} (${route.type}): endpoints mismatch`);
    }
  }

  assert.deepEqual(errors, []);
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

test("TravelService sends normalized replacement and builds its snapshot from the command result", async () => {
  const previousGame = globalThis.game;
  const player = { id: "player", isGM: false, active: true };
  const gm = { id: "gm", isGM: true, active: true };
  const users = new Map([[player.id, player], [gm.id, gm]]);
  users.contents = [player, gm];
  users.activeGM = gm;
  globalThis.game = { user: player, users };
  const requests = [];
  const committedState = normalizeTravelState({
    originCityId: "a",
    destinationCityId: "c",
    mode: "land",
    traveledMiles: 0
  });
  const groupContextService = {
    resolveForCurrentUser() {
      return {
        groupId: "group-a",
        canManage: true,
        groupState: { travelState: normalizeTravelState({}) }
      };
    }
  };
  const commandBus = {
    async request(command, payload) {
      requests.push({ command, payload });
      return committedState;
    }
  };

  try {
    const service = new TravelService({ groupContextService, commandBus });
    service.networkPromise = Promise.resolve(normalizeTravelNetwork(network));
    const snapshot = await service.setRoute({ originCityId: "a", destinationCityId: "c", mode: "land" });

    assert.deepEqual(requests, [{
      command: "group.travel.replaceState",
      payload: { groupActorId: "group-a", travelState: committedState }
    }]);
    assert.equal(snapshot.originCityId, "a");
    assert.equal(snapshot.destinationCityId, "c");
    assert.equal(snapshot.plan.available, true);
  }
  finally {
    globalThis.game = previousGame;
  }
});
