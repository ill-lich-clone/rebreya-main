import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function loadCities() {
  return JSON.parse(await readFile(new URL("../data/cities.json", import.meta.url), "utf8"));
}

test("economy city connections have distances and same-type reverse links", async () => {
  const cities = await loadCities();
  const cityById = new Map(cities.map((city) => [city.id, city]));
  const missingDistance = [];
  const missingTarget = [];
  const missingReverse = [];
  const selfConnections = [];

  for (const city of cities) {
    for (const connection of city.connections ?? []) {
      if (connection.targetCityId === city.id) {
        selfConnections.push(`${city.name} -> ${connection.targetName}`);
      }

      if (connection.broken || !connection.targetCityId) {
        continue;
      }

      const target = cityById.get(connection.targetCityId);
      if (!target) {
        missingTarget.push(`${city.name} -> ${connection.targetCityId}`);
        continue;
      }

      const distance = Number(connection.distance);
      if (!Number.isFinite(distance) || distance <= 0) {
        missingDistance.push(`${city.name} -> ${target.name} (${connection.connectionType})`);
      }

      const hasReverse = (target.connections ?? []).some((reverse) => (
        !reverse.broken
        && reverse.targetCityId === city.id
        && reverse.connectionType === connection.connectionType
      ));
      if (!hasReverse) {
        missingReverse.push(`${city.name} -> ${target.name} (${connection.connectionType})`);
      }
    }
  }

  assert.deepEqual(selfConnections, []);
  assert.deepEqual(missingTarget, []);
  assert.deepEqual(missingDistance, []);
  assert.deepEqual(missingReverse, []);
});

test("Orlanis to Freh is not imported as a land bridge", async () => {
  const cities = await loadCities();
  const cityById = new Map(cities.map((city) => [city.id, city]));
  const orlanis = cityById.get("orlanis");
  const freh = cityById.get("frekh");

  assert.ok(orlanis);
  assert.ok(freh);

  const orlanisToFreh = (orlanis.connections ?? []).filter((connection) => (
    !connection.broken && connection.targetCityId === freh.id
  ));
  const frehToOrlanis = (freh.connections ?? []).filter((connection) => (
    !connection.broken && connection.targetCityId === orlanis.id
  ));

  assert.equal(orlanisToFreh.some((connection) => connection.connectionType === "Земля"), false);
  assert.equal(orlanisToFreh.some((connection) => connection.connectionType === "Море"), true);
  assert.equal(frehToOrlanis.some((connection) => connection.connectionType === "Море"), true);
});

test("economy cities keep large-map geometry from spreadsheet bounds", async () => {
  const cities = await loadCities();
  const cityById = new Map(cities.map((city) => [city.id, city]));
  const urul = cityById.get("urul");
  const vurul = cityById.get("vurul");
  const veldoran = cityById.get("veldoran");

  assert.ok(urul);
  assert.ok(vurul);
  assert.ok(veldoran);
  assert.equal(urul.state, "Республика Зомар");
  assert.equal(vurul.state, "Азадранская империя");
  assert.notEqual(urul.id, vurul.id);
  assert.deepEqual(
    [urul.x, urul.y, urul.mapBounds],
    [8655, 4372, { left: 8630, right: 8680, top: 4347, bottom: 4397 }]
  );
  assert.deepEqual(
    [vurul.x, vurul.y, vurul.mapBounds],
    [15019, 2637, { left: 14994, right: 15044, top: 2612, bottom: 2662 }]
  );
  assert.deepEqual(
    [veldoran.x, veldoran.y, veldoran.mapBounds],
    [6696, 9075, { left: 6671, right: 6721, top: 9055, bottom: 9095 }]
  );
});

test("Ksay land road targets Vurul, not the Zomar Urul", async () => {
  const cities = await loadCities();
  const cityById = new Map(cities.map((city) => [city.id, city]));
  const ksay = cityById.get("ksay");
  const urul = cityById.get("urul");
  const vurul = cityById.get("vurul");

  assert.ok(ksay);
  assert.ok(urul);
  assert.ok(vurul);

  const ksayLandTargets = (ksay.connections ?? [])
    .filter((connection) => !connection.broken && connection.connectionType === "Земля")
    .map((connection) => connection.targetCityId);

  assert.equal(ksayLandTargets.includes(vurul.id), true);
  assert.equal(ksayLandTargets.includes(urul.id), false);
});
