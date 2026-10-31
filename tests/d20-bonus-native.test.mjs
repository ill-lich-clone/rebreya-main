import test from "node:test";
import assert from "node:assert/strict";
import { CurseUpgradeAutomationService } from "../scripts/combat/curse-upgrade-automation-service.js";
import { PerformerAutomationService } from "../scripts/combat/performer-automation-service.js";
import { AttackRollBoostService } from "../scripts/combat/attack-roll-boost-service.js";

test("native boundary awaits bonus before curse outcome and saved message, and registers once", async () => {
  globalThis.libWrapper = undefined;
  const order = [];
  class NativeRoll { static async buildPost(rolls) { order.push(`message:${rolls[0].total}`); } }
  globalThis.CONFIG = { Dice: { D20Roll: NativeRoll } };
  const service = new CurseUpgradeAutomationService({});
  service.saves.applyNativeBuildPost = async rolls => { order.push(`curse:${rolls[0].total}`); rolls[0].options.target = 99; };
  const beforePost = async rolls => { await Promise.resolve(); rolls[0].total += 4; order.push("bonus"); };
  service.registerNativeSaveWrapper(beforePost);
  service.registerNativeSaveWrapper(beforePost);
  const roll = { total: 15, options: { target: 18 } };
  await NativeRoll.buildPost([roll], {}, { create: false });
  assert.deepEqual(order, ["bonus", "curse:19", "message:19"]);
  assert.equal(roll.options.target, 99, "a curse's explicit forced result is preserved");
});

test("native skill/save resolves choice before returning and ignores later generic hook", async () => {
  globalThis.Actor = class Actor {};
  globalThis.game = { user: { isGM: true }, time: { worldTime: 10 } };
  for (const kind of ["skill", "savingThrow", "toolCheck", "abilityCheck"]) {
    const actor = new Actor();
    actor.uuid = "Actor.native";
    const effect = { flags: { "rebreya-main": { d20Bonus: { formula: "1d6" } } }, async delete() { this.deleted = true; } };
    actor.effects = [effect];
    let count = 0;
    let resolvePrompt;
    const service = new PerformerAutomationService({}, {
      promptD20Bonus: async () => { count++; return new Promise(resolve => { resolvePrompt = resolve; }); },
      rollFactory: () => ({ total: 4 })
    });
    const roll = { total: 15, options: {} };
    const pending = service.applyNativeBuildPost([roll], { subject: actor, hookNames: [kind], evaluate: true }, { create: false });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(roll.total, 15);
    resolvePrompt(true);
    await pending;
    assert.equal(roll.total, 19);
    await service.applyDnd5eD20Roll([roll], { subject: actor }, kind);
    assert.equal(count, 1);
    assert.equal(effect.deleted, true);
  }
});

test("MIDI native attack carries workflow identity so late native fallback cannot race", async () => {
  const service = new AttackRollBoostService({});
  const roll = { total: 15, options: {} };
  const workflow = { id: "midi" };
  await service.applyNativeBuildPost([roll], { workflow, subject: { hasAttack: true } });
  assert.equal(roll.options.workflow, undefined, "workflow Documents are not written into serializable roll options");
  assert.equal(await service.applyDnd5eRollAttack([roll], { subject: { hasAttack: true } }), true);
});

test("ordinary checks and MIDI attacks serialize consumption of the same Actor die", async () => {
  globalThis.Actor = class Actor {};
  globalThis.game = { user: { isGM: true }, time: { worldTime: 10 } };
  const actor = new Actor(); actor.uuid = "Actor.shared"; actor.items = []; actor.effects = [];
  const effect = { id: "die", uuid: "Actor.shared.ActiveEffect.die", flags: { "rebreya-main": { d20Bonus: { formula: "4", mode: "add" } } },
    async delete() { actor.effects.splice(actor.effects.indexOf(this), 1); } };
  actor.effects.push(effect);
  let opened, resolveChoice, attackPrompts = 0;
  const opening = new Promise(resolve => { opened = resolve; });
  const ordinary = new PerformerAutomationService({}, { promptD20Bonus: () => { opened(); return new Promise(resolve => { resolveChoice = resolve; }); } });
  const attack = new AttackRollBoostService({}, { promptAttackRollBoosts: async details => { attackPrompts++; return details.options.map(option => option.id); }, rollFactory: () => ({ total: 4 }) });
  const target = { uuid: "Scene.test.Token.target", actor: { system: { attributes: { ac: { value: 18 } } } } };
  const workflow = { actor, item: { type: "weapon" }, activity: { hasAttack: true }, attackRoll: { total: 15 }, attackTotal: 15, targets: new Set([target]), hitTargets: new Set(), hitTargetsEC: new Set() };
  const skill = ordinary.applyDnd5eD20Roll([{ total: 10 }], { subject: actor }, "skill");
  await opening;
  const midi = attack.applyMidiHitsChecked(workflow);
  await new Promise(resolve => setImmediate(resolve));
  const before = attackPrompts;
  resolveChoice(false);
  await Promise.all([skill, midi]);
  assert.equal(before, 0, "attack cannot offer the die while the skill decision owns it");
  assert.equal(attackPrompts, 1);
  assert.equal(workflow.attackTotal, 19);
  assert.equal(workflow.hitTargets.has(target), true);
  assert.equal(actor.effects.length, 0);
});
