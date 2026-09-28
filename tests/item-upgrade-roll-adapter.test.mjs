import test from "node:test";
import assert from "node:assert/strict";
import { SimpleUpgradeRollAdapter, resolveSimpleUpgradeAttackRoll } from "../scripts/integrations/item-upgrade-roll-adapter.js";
import { SIMPLE_UPGRADE_ROLL_PROFILES } from "../scripts/automation/item-upgrade-roll-modifiers.js";
const target = type => ({ actor: { system: { details: { type: { value: type } }, skills: { prc: { passive: 10 } } } } });
function fixture(ids) {
  const actor = {}, weapon = { id: "a", type: "weapon", actor }, activity = { item: weapon, actor, actionType: "mwak" };
  const contributions = ids.flatMap((id, i) => SIMPLE_UPGRADE_ROLL_PROFILES[id].map((c,j) => ({ ...c, key: `${i}:${j}`, hostItemId: "a", sourceId: id })));
  const warnings = [];
  const adapter = new SimpleUpgradeRollAdapter({ project: () => ({ contributions }) }, { targets: () => [target("humanoid")], warn: message => warnings.push(message) });
  return { adapter, warnings, actor, weapon, activity };
}
test("native damage appends each source once and preserves critical handling and extra packets", () => {
  const f = fixture(["ognennaya-maz", "maloe-zacharovanie-ostroty"]);
  const config = { subject: f.activity, rolls: [{ base: true, parts: ["1d8", "3"], options: { type: "slashing", isCritical: true, critical: { multiplier: 2 } } }, { parts: ["1d6"], options: { type: "cold" } }] };
  assert.equal(f.adapter.preRollDamage(config), true); f.adapter.preRollDamage(config);
  assert.deepEqual(config.rolls[0].parts, ["1d8", "3", "1"]);
  assert.deepEqual(config.rolls[1].parts, ["1d6"]);
  assert.deepEqual(config.rolls[2].parts, ["1d6"]);
  assert.equal(config.rolls[2].options.type, "fire"); assert.equal(config.rolls[2].options.isCritical, true);
  const noBase = { subject: f.activity, rolls: [{ parts: ["1d6"], options: { type: "cold" } }] };
  f.adapter.preRollDamage(noBase); assert.equal(noBase.rolls.length, 1);
});
test("attack bonus and advantage are deduplicated; mixed targets require separate rolls", () => {
  const f = fixture(["korichnevaya-stal", "nochnaya-stal"]);
  const config = { subject: f.activity, rolls: [{ parts: ["@mod"], options: { disadvantage: true } }] };
  assert.equal(f.adapter.preRollAttack(config), true); f.adapter.preRollAttack(config);
  assert.deepEqual(config.rolls[0].parts, ["@mod", "2"]);
  assert.equal(config.rolls[0].options.advantage, true); assert.equal(config.rolls[0].options.disadvantage, true);
  const mixed = { subject: f.activity, targets: [target("humanoid"), target("beast")], rolls: [{ parts: [] }] };
  assert.equal(f.adapter.preRollAttack(mixed), false); assert.deepEqual(mixed.rolls[0].parts, []);
});
test("meteor bonus reads this workflow's rolled advantage rather than an actor-wide or stale flag", () => {
  const f = fixture(["oskolki-meteoritnykh-zvyozd"]);
  for (const [advantageMode, expected] of [[1,1],[0,0],[-1,0]]) {
    const config = { subject: f.activity, workflow: { attackRoll: { options: { advantageMode } } }, rolls: [{ base: true, parts: ["1d8"], options: {} }] };
    f.adapter.preRollDamage(config); assert.equal(config.rolls[0].parts.length, 1 + expected);
  }
  const unknown = { subject: f.activity, rolls: [{ base: true, parts: ["1d8"], options: {} }] };
  f.adapter.preRollDamage(unknown); assert.equal(unknown.rolls[0].parts.length, 1); assert.ok(f.warnings.length);
});

test("native damage resolves one exact originating attack; multiple or unrelated rolls are ambiguous", () => {
  const roll = { options: { advantageMode: 1 } }, attack = { rolls: [roll], getFlag: (_scope, key) => key === "activity.uuid" ? "activity-a" : "attack" };
  let associated = [attack];
  const origin = { getFlag: () => null, getAssociatedRolls: () => associated };
  const game = { messages: new Map([["usage", origin]]) }, config = { subject: { uuid: "activity-a" } };
  const message = { data: { flags: { dnd5e: { originatingMessage: "usage" } } } };
  assert.equal(resolveSimpleUpgradeAttackRoll(config, message, game), roll);
  associated = [attack, attack]; assert.equal(resolveSimpleUpgradeAttackRoll(config, message, game), null);
  associated = [attack]; config.subject.uuid = "activity-b"; assert.equal(resolveSimpleUpgradeAttackRoll(config, message, game), null);
});
