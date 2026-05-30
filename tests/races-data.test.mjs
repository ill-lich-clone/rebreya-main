import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadRacesData() {
  return JSON.parse(readFileSync(join(process.cwd(), "data/races-teyvankal-v01.json"), "utf8").replace(/^\uFEFF/u, ""));
}

function getRace(data, id) {
  return data.races.find((race) => race.id === id);
}

function abilityNames(race) {
  return race.abilities.map((ability) => ability.name);
}

test("race data keeps goblins separate from gnomes", () => {
  const data = loadRacesData();
  const gnomes = getRace(data, "гномы");
  const goblins = getRace(data, "гоблины");

  assert.equal(data.raceCount, data.races.length);
  assert.ok(gnomes, "Gnomes must exist");
  assert.ok(goblins, "Goblins must exist");

  assert.equal(gnomes.name, "Гномы");
  assert.equal(goblins.name, "Гоблины");
  assert.equal(gnomes.speed, 25);
  assert.equal(goblins.speed, 30);
  assert.equal(gnomes.size, "sm");
  assert.equal(goblins.size, "sm");
  assert.equal(gnomes.darkvision, 60);
  assert.equal(goblins.darkvision, 60);

  assert.match(gnomes.fields.languages, /гномьем/u);
  assert.match(goblins.fields.languages, /гоблинском/u);
  assert.match(gnomes.fields.raceFeat, /Исчезновение/u);
  assert.match(goblins.fields.raceFeat, /Гоблинская маскировка/u);

  assert.deepEqual(abilityNames(gnomes), ["Боевая смекалка", "Тяга к знанию", "Тёмное зрение"]);
  assert.deepEqual(abilityNames(goblins), ["Ярость мелкого", "Тёмное зрение", "Шустрый побег"]);
});
