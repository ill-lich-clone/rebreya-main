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

test("race data keeps ironborn parser-sensitive fields intact", () => {
  const data = loadRacesData();
  const ironborn = getRace(data, "железорождённые");

  assert.ok(ironborn, "Ironborn must exist");
  assert.equal(ironborn.name, "Железорождённые");
  assert.equal(ironborn.group, "Общие");
  assert.equal(ironborn.size, "med");
  assert.equal(ironborn.speed, 30);
  assert.equal(ironborn.darkvision, 0);

  assert.match(ironborn.fields.raceFeat, /Улучшенное тело/u);
  assert.match(ironborn.fields.raceFeat, /Иллюзия жизни/u);
  assert.deepEqual(ironborn.raceFeatNames, ["Улучшенное тело", "Иллюзия жизни"]);

  assert.deepEqual(abilityNames(ironborn), [
    "Модифицируемая жизнь",
    "Охранный отдых",
    "Природа конструкта",
    "Спроектированная устойчивость"
  ]);
  assert.match(ironborn.abilities.find((ability) => ability.name === "Природа конструкта").description, /Истинный механизм/u);

  const resilience = ironborn.abilities.find((ability) => ability.name === "Спроектированная устойчивость");
  assert.equal(
    resilience.description,
    "Вы получаете сопротивление к урону ядом, а также совершаете с преимуществом спасброски и проверки против Отравления и Тошноты."
  );
  assert.doesNotMatch(resilience.description, /Модификации Железорождённых/u);
  assert.doesNotMatch(resilience.description, /Гении/u);
});

test("race darkvision abilities do not absorb following race text", () => {
  const data = loadRacesData();
  const standardDarkvision =
    "На расстоянии в 60 футов Вы при тусклом освещении можете видеть так, как будто это яркое освещение, и в темноте так, как будто это тусклое освещение. В темноте Вы не можете различать цвета, только оттенки серого.";
  const standardDarkvisionLowercase =
    "На расстоянии в 60 футов вы при тусклом освещении можете видеть так, как будто это яркое освещение, и в темноте так, как будто это тусклое освещение. В темноте вы не можете различать цвета, только оттенки серого.";

  const expectedDescriptions = new Map([
    ["орки", standardDarkvision],
    [
      "морские-эльфы",
      `Привыкнув к сумраку леса и ночному небу, Вы обладаете превосходным зрением в темноте и при тусклом освещении. ${standardDarkvision}`
    ],
    [
      "гномы",
      `Вы обладаете превосходным зрением в темноте и при тусклом освещении. ${standardDarkvision}`
    ],
    ["табакси", standardDarkvision],
    ["леониды", standardDarkvisionLowercase]
  ]);

  for (const [raceId, expectedDescription] of expectedDescriptions) {
    const race = getRace(data, raceId);
    assert.ok(race, `${raceId} must exist`);

    const darkvision = race.abilities.find((ability) => ability.name === "Тёмное зрение");
    assert.ok(darkvision, `${race.name} must have Darkvision ability`);
    assert.equal(darkvision.description, expectedDescription);
  }
});
