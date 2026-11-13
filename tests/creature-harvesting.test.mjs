import assert from "node:assert/strict";
import test from "node:test";
import { harvestDc, harvestAvailability, matchHarvestMonster, harvestRewards, harvestItem } from "../scripts/data/creature-harvesting.js";

const monster = { id: "tick1", name: "Клещ", rank: 1, typeLoot: "Яд", common: ["Хитин"], unique: null };
const blood = { id: "material-4", name: "Кровь чудовища", rank: 1 };

test("table, inclusive hour and the actual body determine eligibility", () => {
  assert.deepEqual(Array.from({ length: 11 }, (_, rank) => harvestDc(rank)), [20,21,22,23,25,26,27,28,30,35,null]);
  assert.equal(harvestDc(10, 37), 37);
  assert.equal(harvestAvailability({ type: "beast", diedAt: 0, now: 3600 }), null);
  assert.equal(harvestAvailability({ type: "beast", diedAt: 0, now: 3601 }), "expired");
  assert.equal(harvestAvailability({ type: "custom", custom: "Гуманоид", diedAt: 0, now: 1 }), "humanoid");
  assert.equal(harvestAvailability({ type: "custom", custom: "Гуманоид (эльф)", diedAt: 0, now: 1 }), "humanoid");
  assert.equal(harvestAvailability({ type: "humanoid", overrideType: "beast", diedAt: 0, now: 1 }), "humanoid");
});

test("matches full names, keeps ambiguous ranks and resolves an explicit analogue", () => {
  const rows = [monster, { ...monster, id: "tick8", rank: 8 }];
  assert.deepEqual(matchHarvestMonster(rows, ["Клещ 1", " КЛЕЩ "]).map(row => row.rank), [1,8]);
  assert.deepEqual(matchHarvestMonster(rows, ["Кле" ]), []);
  assert.deepEqual(matchHarvestMonster(rows, ["Клещ"], "tick8").map(row => row.rank), [8]);
});

test("degree of success controls loot, including one portion of blood and a unique placeholder", () => {
  globalThis.CONST ??= { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
  const rewards = (total, type = "beast", data = monster) => harvestRewards(data, { total, dc: 21, type, random: () => 0.99 });
  assert.deepEqual(rewards(16).loot, []);
  assert.deepEqual(rewards(17).loot.map(x => x.name), [blood.name]);
  assert.deepEqual(rewards(21).loot.map(x => x.name), ["Яд", "Хитин", blood.name]);
  assert.deepEqual(rewards(26).loot.at(-1), { name: "Уникальный компонент — Клещ", unique: true });
  assert.deepEqual(rewards(21, "construct").loot.map(x => x.name), ["Яд", "Хитин"]);
  const ranked = { ...blood, id: "blood7", name: "Кровь чудовища 7-й ранг", rank: 7 };
  const rankedReward = rewards(21, "undead", { ...monster, common: [ranked.name, blood.name] }).loot.at(-1);
  assert.equal(harvestItem(rankedReward, [blood, ranked], monster).flags["rebreya-main"].materialId, ranked.id);
  assert.equal(harvestItem({ name: "Уникальный компонент — Клещ", unique: true }, [], monster).system.description.value, "");
});
