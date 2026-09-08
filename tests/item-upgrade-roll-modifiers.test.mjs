import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSimpleUpgradeRoll, SIMPLE_UPGRADE_ROLL_PROFILES } from "../scripts/automation/item-upgrade-roll-modifiers.js";

function roll(ids, { target = { type: "humanoid", passivePerception: 10 }, attack = {} } = {}) {
  return evaluateSimpleUpgradeRoll({ host: { id: "a" }, target, attack: { primary: true, advantage: false, ...attack },
    contributions: ids.flatMap((id, i) => SIMPLE_UPGRADE_ROLL_PROFILES[id].map(effect => ({ ...effect, key: `${id}:${i}`, sourceId: id, hostItemId: "a" }))) });
}
test("flat and typed additions belong to the exact weapon and primary damage packet", () => {
  const result = roll(["zacharovanie-ostroty", "maloe-zacharovanie-ostroty", "sukhozhilie-chudovishcha", "ognennaya-maz", "ledyanaya-maz", "zacharovanie-nekromantii"]);
  assert.equal(result.attackBonus, 1);
  assert.deepEqual(result.damageParts.map(p => [p.formula, p.type]), [["1", null], ["1", null], ["1", null], ["1d6", "fire"], ["1d6", "cold"], ["1d3", "necrotic"]]);
  assert.equal(roll(["ognennaya-maz"], { attack: { primary: false } }).damageParts.length, 0);
  assert.equal(evaluateSimpleUpgradeRoll({ host: { id: "b" }, attack: { primary: true }, contributions: [{ ...SIMPLE_UPGRADE_ROLL_PROFILES["ognennaya-maz"][0], hostItemId: "a" }] }).damageParts.length, 0);
});
for (const [id, types] of [["dyavolskoe-zhelezo",["celestial"]],["elfiyskaya-stal",["undead"]],["iskazhayushchaya-stal",["elemental"]],["kristally-zabytykh-titanov",["giant","fiend"]]]) {
  test(`${id} adds two damage only against its declared creature types`, () => {
    for (const type of types) assert.deepEqual(roll([id], { target: { type } }).damageParts.map(p => p.formula), ["2"]);
    assert.deepEqual(roll([id], { target: { type: "beast" } }).damageParts, []);
    assert.equal(roll([id], { target: null }).diagnostics.length, 1);
  });
}
test("humanoid attack and poison bonuses do not leak to other target types", () => {
  const result = roll(["korichnevaya-stal", "kosti-mantikory"]);
  assert.equal(result.attackBonus, 2); assert.deepEqual(result.damageParts.map(p => [p.formula, p.type]), [["1d4","poison"]]);
  assert.equal(roll(["korichnevaya-stal"], { target: { type: "beast" } }).attackBonus, 0);
});
test("night steel uses known passive perception; meteor shards require the resolved attack advantage", () => {
  assert.equal(roll(["nochnaya-stal"]).advantage, true);
  assert.equal(roll(["nochnaya-stal"], { target: { passivePerception: 12 } }).advantage, false);
  assert.equal(roll(["nochnaya-stal"], { target: {} }).diagnostics.length, 1);
  assert.equal(roll(["oskolki-meteoritnykh-zvyozd"], { attack: { advantage: false } }).damageParts.length, 0);
  assert.deepEqual(roll(["oskolki-meteoritnykh-zvyozd"], { attack: { advantage: true } }).damageParts.map(p => p.formula), ["2"]);
  assert.equal(roll(["oskolki-meteoritnykh-zvyozd"], { attack: { advantage: null } }).diagnostics.length, 1);
});
