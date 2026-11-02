import test from "node:test";
import assert from "node:assert/strict";
import { CombatAttackService } from "../scripts/combat/attack-service.js";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { BardicInspirationCompatService } from "../scripts/combat/bardic-inspiration-compat-service.js";

function setup() {
  const gm = { id: "gm", isGM: true, active: true }, user = { id: "player", isGM: false };
  const scene = { id: "scene", grid: { size: 100, distance: 5, units: "ft" }, tokens: new Map() };
  const actor = { uuid: "Actor.a", flags: { "rebreya-main": {} }, system: { traits: { size: "med" } }, items: [],
    testUserPermission: x => x.id === "player", getRollData: () => ({}),
    async update(patch) { this.flags["rebreya-main"].weaponCharge = patch["flags.rebreya-main.==weaponCharge"]; } };
  const weapon = { id: "weapon", uuid: "Actor.a.Item.weapon", actor, type: "weapon", system: { properties: new Set(["lchDash", "lchMounted"]) }, flags: { "rebreya-main": { lichWeaponPropertyValues: { dashDice: "2d2" } } } };
  actor.items.push(weapon);
  const rider = { id: "rider", uuid: "Scene.scene.Token.rider", parent: scene, actor, x: 200, y: 0, width: 1, height: 1,
    flags: { "rebreya-main": { mountedOn: "Scene.scene.Token.mount" } }, movement: { id: "move1" },
    movementHistory: [{ x: 0, y: 0, elevation: 0, action: "walk", movementId: "move1" }, { x: 200, y: 0, elevation: 0, action: "walk", movementId: "move1" }],
    measureMovementPath: () => ({ distance: 10 }) };
  const mount = { id: "mount", uuid: "Scene.scene.Token.mount", parent: scene, actor: { system: { traits: { size: "lg" } } } };
  const target = { id: "target", uuid: "Scene.scene.Token.target", parent: scene, x: 400, y: 0, width: 1, height: 1,
    actor: { uuid: "Actor.target", system: { traits: { size: "med" } } } };
  for (const token of [rider, mount, target]) scene.tokens.set(token.id, token);
  const card = { id: "attack", author: user, speaker: { scene: "scene", token: "rider" }, flags: { dnd5e: { messageType: "usage", item: { uuid: weapon.uuid }, activity: { type: "attack" } }, "midi-qol": { hitTargetUuids: [target.uuid], damageRolls: [{ options: { type: "piercing", properties: ["mgc"] } }] } } };
  globalThis.game = { user: gm, users: { activeGM: gm }, combat: { id: "combat", started: true, round: 1, turn: 0 }, messages: new Map([[card.id, card]]) };
  globalThis.fromUuid = async uuid => [rider, mount, target, weapon].find(value => value.uuid === uuid);
  let rolls = 0;
  globalThis.CONFIG = { Dice: { DamageRoll: class { constructor(formula, data, options) { this.formula = formula; this.data = data; this.options = options; } async evaluate() { rolls++; this.total = 5; return this; } toJSON() { return { formula: this.formula, data: this.data, total: this.total, options: this.options }; } } } };
  const service = new CombatAttackService({ worldMutationCoordinator: new WorldMutationCoordinator() });
  service.noteChargeMovement(rider, { x: 200 });
  const payload = { operationId: "attack", riderTokenUuid: rider.uuid, targetTokenUuid: target.uuid, weaponItemUuid: weapon.uuid, combatId: "combat", round: 1, turn: 0 };
  return { service, rider, target, actor, weapon, card, payload, user, get rolls() { return rolls; } };
}

test("mounted charge adds authored die and mounted bonus once, with exact retry", async () => {
  const f = setup();
  const first = await f.service.reserveMountedChargeDamage(f.payload, { sender: f.user });
  const repeat = await f.service.reserveMountedChargeDamage(f.payload, { sender: f.user });
  assert.equal(first.roll.total, 5); assert.match(first.roll.formula, /2d2/u); assert.match(first.roll.formula, /2/u);
  assert.deepEqual(repeat.roll, first.roll); assert.equal(f.rolls, 1);
});

test("a lost charge write response reuses the saved die without rolling again", async () => {
  const f = setup(), update = f.actor.update.bind(f.actor); let first = true;
  f.actor.update = async patch => { await update(patch); if (first) { first = false; throw new Error("lost response"); } };
  await assert.rejects(f.service.reserveMountedChargeDamage(f.payload, { sender: f.user }), /lost response/u);
  const result = await f.service.reserveMountedChargeDamage(f.payload, { sender: f.user });
  assert.equal(result.replayed, true); assert.equal(result.roll.total, 5); assert.equal(f.rolls, 1);
});

test("charge uses the original weapon roll data for authored references", async () => {
  const f = setup();
  f.weapon.flags["rebreya-main"].lichWeaponPropertyValues.dashDice = "@item.test + 1d2";
  f.weapon.getRollData = () => ({ item: { test: 2 } });
  const result = await f.service.reserveMountedChargeDamage(f.payload, { sender: f.user });
  assert.equal(result.roll.data.item.test, 2); assert.match(result.roll.formula, /@item\.test/u);
});

test("miss, foreign owner, or mismatched card cannot spend charge", async () => {
  const f = setup();
  await assert.rejects(f.service.reserveMountedChargeDamage(f.payload, { sender: { id: "other" } }), /прав|влад/u);
  f.card.flags["midi-qol"].hitTargetUuids = [];
  await assert.rejects(f.service.reserveMountedChargeDamage(f.payload, { sender: f.user }), /попад/u);
  assert.equal(f.rolls, 0); assert.equal(f.actor.flags["rebreya-main"].weaponCharge, undefined);
});

test("a second hit in the same turn keeps mounted damage but does not repeat charge", async () => {
  const f = setup();
  await f.service.reserveMountedChargeDamage(f.payload, { sender: f.user });
  const second = { ...f.card, id: "attack2" }; game.messages.set(second.id, second);
  const result = await f.service.reserveMountedChargeDamage({ ...f.payload, operationId: "attack2" }, { sender: f.user });
  assert.doesNotMatch(result.roll.formula, /d2/u);
  assert.match(result.roll.formula, /2/u);
});

test("a replay cannot redirect a saved charge to a replacement actor", async () => {
  const f = setup(); await f.service.reserveMountedChargeDamage(f.payload, { sender: f.user });
  f.target.actor = { uuid: "Actor.replacement", system: { traits: { size: "med" } } };
  await assert.rejects(f.service.reserveMountedChargeDamage(f.payload, { sender: f.user }), /уже использован/u);
  assert.equal(f.rolls, 1);
});

test("a saved charge cannot be reused after the original weapon damage changes", async () => {
  const f = setup(); await f.service.reserveMountedChargeDamage(f.payload, { sender: f.user });
  f.card.flags["midi-qol"].damageRolls[0].options.type = "fire";
  await assert.rejects(f.service.reserveMountedChargeDamage(f.payload, { sender: f.user }), /урон|измен/u);
  assert.equal(f.rolls, 1);
});

test("turn changes or teleport cannot produce a new charge without qualifying movement", async () => {
  const f = setup();
  f.rider.flags["rebreya-main"].mountedOn = undefined;
  game.combat.turn = 1;
  const result = await f.service.reserveMountedChargeDamage({ ...f.payload, turn: 1 }, { sender: f.user });
  assert.equal(result.applied, false); assert.equal(f.rolls, 0);
  f.rider.movement = { id: "teleport" }; f.rider.movementHistory = [{ x: 0, y: 0, elevation: 0, action: "walk", movementId: "teleport" }, { x: 200, y: 0, elevation: 0, action: "teleport", movementId: "teleport" }];
  f.service.noteChargeMovement(f.rider, { x: 200 });
  assert.equal((await f.service.reserveMountedChargeDamage({ ...f.payload, turn: 1 }, { sender: f.user })).applied, false);
});

test("lost movement observations require manual charge instead of silently inventing or discarding it", async () => {
  const f = setup(); f.rider.flags["rebreya-main"].mountedOn = undefined;
  f.service.chargeMovementRecords.clear();
  const result = await f.service.reserveMountedChargeDamage(f.payload, { sender: f.user });
  assert.equal(result.applied, false); assert.equal(result.manualCharge, true); assert.equal(f.rolls, 0);
});

test("movement before the target moved is not counted towards charging its new position", async () => {
  const f = setup(); f.rider.flags["rebreya-main"].mountedOn = undefined;
  f.target.x = 600; f.target.movement = { id: "target-move" };
  f.service.noteChargeMovement(f.target, { x: 600 });
  assert.equal((await f.service.reserveMountedChargeDamage(f.payload, { sender: f.user })).applied, false);
  f.rider.x = 400; f.rider.movement = { id: "move2" };
  f.rider.movementHistory.push({ x: 400, y: 0, elevation: 0, action: "walk", movementId: "move2" });
  f.service.noteChargeMovement(f.rider, { x: 400 });
  assert.ok((await f.service.reserveMountedChargeDamage(f.payload, { sender: f.user })).roll);
});

test("weapon-property damage joins primary Midi damage once without replacing earlier bonuses", async () => {
  const f = setup(), oldRoll = globalThis.Roll, calls = []; game.user = f.user;
  const serialized = { total: 5, options: { type: "piercing" } };
  globalThis.Roll = { fromJSON(raw) { return { ...JSON.parse(raw), _evaluated: true }; } };
  f.service.moduleApi.socketCommandBus = { async request(_command, payload) { calls.push(payload); return { roll: serialized, targetActorUuid: f.target.actor.uuid }; } };
  const prior = { total: 3, options: {} };
  const workflow = { actor: f.actor, item: f.weapon, token: { document: f.rider }, chatCard: f.card,
    hitTargets: new Set([{ document: f.target }]), damageRolls: [{ options: { type: "piercing", properties: ["mgc"] } }], bonusDamageRolls: [prior],
    async performThrottledUpdate() {}, async setDamageRolls(rolls) { this.damageRolls = rolls; } };
  try {
    await f.service.applyMidiMountedChargeDamage(workflow);
    await f.service.applyMidiMountedChargeDamage(workflow);
    assert.equal(calls.length, 1); assert.equal(workflow.bonusDamageRolls.length, 1);
    assert.equal(workflow.bonusDamageRolls[0], prior);
    assert.equal(workflow.damageRolls.length, 2); assert.equal(workflow.damageRolls[1].total, 5);
  } finally { globalThis.Roll = oldRoll; }
});

test("ordinary attack without mount or active combat never needs a GM command", async () => {
  const f = setup(); f.rider.flags["rebreya-main"].mountedOn = undefined; game.combat = null;
  f.service.moduleApi.socketCommandBus = { async request() { assert.fail("ordinary attack must not request a bonus"); } };
  const workflow = { actor: f.actor, item: f.weapon, token: { document: f.rider }, chatCard: f.card,
    hitTargets: new Set([{ document: f.target }]), damageRolls: [{ options: { type: "piercing", properties: ["mgc"] } }],
    async performThrottledUpdate() {}, async setDamageRolls() {} };
  await f.service.applyMidiMountedChargeDamage(workflow);
  assert.equal(workflow.aborted, undefined);
});

test("an unconfirmed critical die is not silently rolled as ordinary damage", async () => {
  const f = setup(); let requested = false;
  f.service.moduleApi.socketCommandBus = { async request() { requested = true; } };
  const workflow = { actor: f.actor, item: f.weapon, token: { document: f.rider }, chatCard: f.card, isCritical: true,
    hitTargets: new Set([{ document: f.target }]), damageRolls: [{ options: { type: "piercing", properties: ["mgc"] } }],
    async performThrottledUpdate() {}, async setDamageRolls() {} };
  await f.service.applyMidiMountedChargeDamage(workflow);
  assert.equal(requested, false); assert.equal(workflow.aborted, undefined);
});

test("uncertain bonus attachment stops Midi rather than spending charge without its damage", async () => {
  const f = setup(), oldRoll = globalThis.Roll; game.user = f.user;
  globalThis.Roll = { fromJSON(raw) { return { ...JSON.parse(raw), _evaluated: true }; } };
  f.service.moduleApi.socketCommandBus = { async request() { return { roll: { total: 5, options: { type: "piercing" } }, targetActorUuid: f.target.actor.uuid }; } };
  const workflow = { actor: f.actor, item: f.weapon, token: { document: f.rider }, chatCard: f.card,
    hitTargets: new Set([{ document: f.target }]), damageRolls: [{ options: { type: "piercing", properties: ["mgc"] } }],
    async performThrottledUpdate() {}, async setDamageRolls() { throw new Error("write failed"); } };
  try { await assert.rejects(f.service.applyMidiMountedChargeDamage(workflow), /write failed/u); assert.equal(workflow.aborted, true); }
  finally { globalThis.Roll = oldRoll; }
});

test("targeted weapon bonus joins matching damage before flat mitigation and excludes other targets", () => {
  const f = setup(), marker = `rebreya-weapon:attack:${f.target.uuid}:${f.target.actor.uuid}`;
  const base = { type: "piercing", value: 8, properties: new Set(["mgc"]) };
  const bonus = { type: "piercing", value: 5, properties: new Set(["mgc", marker]) };
  const other = [structuredClone(base), structuredClone(bonus)];
  f.service.applyMountedChargePreCalculateDamage({ uuid: "Actor.other" }, other, { midi: { targetUuid: "Scene.scene.Token.other" } });
  assert.equal(other.length, 1); assert.equal(other[0].value, 8);
  const chosen = [structuredClone(base), structuredClone(bonus)];
  f.service.applyMountedChargePreCalculateDamage(f.target.actor, chosen, { midi: { targetUuid: f.target.uuid } });
  assert.equal(chosen.length, 1); assert.equal(chosen[0].value, 13);
});

test("charge is not recorded if weapon, permission or target changes while the die rolls", async () => {
  for (const change of ["weapon", "permission", "target"]) {
    const f = setup(), RollClass = CONFIG.Dice.DamageRoll;
    CONFIG.Dice.DamageRoll = class extends RollClass { async evaluate() {
      await super.evaluate();
      if (change === "weapon") f.weapon.flags["rebreya-main"].lichWeaponPropertyValues.dashDice = "4d2";
      if (change === "permission") f.actor.testUserPermission = () => false;
      if (change === "target") f.target.x += 100;
      return this;
    } };
    await assert.rejects(f.service.reserveMountedChargeDamage(f.payload, { sender: f.user }), /измен/u);
    assert.equal(f.actor.flags["rebreya-main"].weaponCharge, undefined);
  }
});

test("linked tokens of one actor cannot consume the same turn's charge concurrently", async () => {
  const f = setup(), rider2 = { ...f.rider, id: "rider2", uuid: "Scene.scene.Token.rider2", flags: { "rebreya-main": {} } };
  f.rider.flags["rebreya-main"].mountedOn = undefined;
  f.rider.parent.tokens.set(rider2.id, rider2);
  const original = globalThis.fromUuid;
  globalThis.fromUuid = async uuid => uuid === rider2.uuid ? rider2 : original(uuid);
  const card2 = { ...f.card, id: "attack2", speaker: { scene: "scene", token: "rider2" } }; game.messages.set(card2.id, card2);
  f.service.noteChargeMovement(rider2, { x: 200 });
  try {
    const results = await Promise.all([
      f.service.reserveMountedChargeDamage(f.payload, { sender: f.user }),
      f.service.reserveMountedChargeDamage({ ...f.payload, operationId: "attack2", riderTokenUuid: rider2.uuid }, { sender: f.user })
    ]);
    assert.equal(results.filter(result => result.roll).length, 1); assert.equal(f.rolls, 1);
  } finally { globalThis.fromUuid = original; }
});

test("mounted charge and defensive flourish merge once with the same weapon damage", async () => {
  const f = setup(), oldRoll = globalThis.Roll; game.user = f.user;
  globalThis.Roll = { fromJSON(raw) { return { ...JSON.parse(raw), _evaluated: true }; } };
  f.service.moduleApi.socketCommandBus = { async request() { return { roll: { total: 5, options: { type: "piercing" } }, targetActorUuid: f.target.actor.uuid }; } };
  const bard = new BardicInspirationCompatService({}, { deserializeBladeFlourish: async data => ({ ...data, _evaluated: true }) });
  const first = { total: 3, options: { type: "piercing", properties: ["mgc"] } };
  const workflow = { actor: f.actor, item: f.weapon, token: { document: f.rider }, chatCard: f.card,
    hitTargets: new Set([{ document: f.target }]), damageRolls: [first], bonusDamageRolls: [], async performThrottledUpdate() {},
    async setDamageRolls(rolls) { for (let i = 1; i < rolls.length; i++) rolls[i].options.properties = (rolls[i].options.properties ?? []).concat(rolls[0].options.properties); this.damageRolls = rolls; } };
  try {
    await f.service.applyMidiMountedChargeDamage(workflow);
    await bard.attachBladeFlourishRoll(workflow, { total: 1, options: { type: "piercing" } }, "attack", { targetTokenUuid: f.target.uuid, targetActorUuid: f.target.actor.uuid });
    const damage = workflow.damageRolls.map(roll => ({ type: roll.options.type, value: roll.total, properties: new Set(roll.options.properties) }));
    f.service.applyMountedChargePreCalculateDamage(f.target.actor, damage, { midi: { targetUuid: f.target.uuid } });
    bard.applyBladeFlourishPreCalculateDamage(f.target.actor, damage, { midi: { targetUuid: f.target.uuid } });
    assert.equal(damage.length, 1); assert.equal(damage[0].value, 9);
  } finally { globalThis.Roll = oldRoll; }
});

test("an active GM resolves weapon bonuses locally without relying on socket echo", async () => {
  const f = setup(), oldRoll = globalThis.Roll; let local = 0;
  globalThis.Roll = { fromJSON(raw) { return { ...JSON.parse(raw), _evaluated: true }; } };
  f.service.reserveMountedChargeDamage = async () => { local++; return { roll: { total: 5, options: { type: "piercing" } }, targetActorUuid: f.target.actor.uuid }; };
  f.service.moduleApi.socketCommandBus = { async request() { assert.fail("GM should use the local service"); } };
  const workflow = { actor: f.actor, item: f.weapon, token: { document: f.rider }, chatCard: f.card,
    hitTargets: new Set([{ document: f.target }]), damageRolls: [{ options: { type: "piercing", properties: ["mgc"] } }],
    async performThrottledUpdate() {}, async setDamageRolls(rolls) { this.damageRolls = rolls; } };
  try { await f.service.applyMidiMountedChargeDamage(workflow); assert.equal(local, 1); }
  finally { globalThis.Roll = oldRoll; }
});

test("v14 usage card proves the primary damage and exact hit independently of legacy flags", async () => {
  const f=setup(), {card,target,weapon}=f;
  const damage={class:"DamageRoll",options:{type:"piercing",properties:["mgc"],rollType:"damage","midi-qol":{rollType:"defaultDamage"}}};
  card.type="usage";card.flags={};card.system={item:{uuid:weapon.uuid},activity:{type:"attack"},midi:{sections:{hits:{data:{hits:[{uuid:target.uuid,hitClass:"success"}]}}}}};
  card.rolls=[{class:"D20Roll",options:{rollType:"attack"}},damage];
  card.system.midi.sections.hits.data.hits[0].hitClass="failure";
  await assert.rejects(f.service.reserveMountedChargeDamage(f.payload,{sender:f.user}),/попад/u);
  card.system.midi.sections.hits.data.hits[0].hitClass="success";
  assert.ok((await f.service.reserveMountedChargeDamage(f.payload,{sender:f.user})).roll);
});

test("Midi 14 DamageRollComplete flushes primary rolls before GM validation and ignores stale miss markers", async () => {
  const f=setup(), primary={total:8,options:{type:"piercing",properties:["mgc"],"midi-qol":{rollType:"defaultDamage"}}};
  f.card.type="usage";
  f.card.system={item:{uuid:f.weapon.uuid},activity:{type:"attack"},midi:{sections:{hits:{data:{hits:[{uuid:f.target.uuid,hitClass:"success"}]}}}}};
  f.card.flags={"rebreya-main":{weaponPropertyHit:{riderTokenUuid:f.rider.uuid,targetTokenUuid:f.target.uuid}}};
  const workflow={actor:f.actor,item:f.weapon,token:{document:f.rider},chatCard:f.card,hitTargets:new Set([{document:f.target}]),
    damageRolls:[primary],chatRolls:[primary],async performThrottledUpdate(message,patch,immediate){assert.equal(immediate,true);Object.assign(message,patch);},
    async setDamageRolls(rolls){this.damageRolls=rolls;}};
  const previous=globalThis.Roll;
  globalThis.Roll={fromJSON:json=>({...JSON.parse(json),_evaluated:true})};
  try {
    await f.service.applyMidiMountedChargeDamage(workflow);
    assert.equal(workflow.damageRolls.length,2);
    assert.equal(f.rolls,1);
    f.card.system.midi.sections.hits.data.hits[0].hitClass="failure";
    await assert.rejects(f.service.reserveMountedChargeDamage(f.payload,{sender:f.user}),/попад/u);
  } finally {globalThis.Roll=previous;}
});
