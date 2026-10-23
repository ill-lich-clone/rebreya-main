import test from "node:test";
import assert from "node:assert/strict";

const NS = "rebreya-main";
const rules = await import("../scripts/combat/whirlwind-attack.js").catch(() => ({}));
const base = () => ({ _id: "normalAttack0001", type: "attack", name: "Удар", attack: { type: { value: "melee", classification: "weapon" }, bonus: "2" }, damage: { includeBase: true, parts: [{ custom: { enabled: true, formula: "2d6 + @mod" } }] }, consumption: { targets: [{ type: "itemUses", target: "resource" }] } });
const weapon = (properties = ["lchWhirl"]) => ({ type: "weapon", system: { properties } });

test("whirlwind clones the ordinary melee attack without changing authored formula or consumption", () => {
  assert.equal(typeof rules.buildWhirlwindActivity, "function");
  const source = base(), before = structuredClone(source);
  const activity = rules.buildWhirlwindActivity(weapon(), source);
  assert.deepEqual(source, before);
  assert.equal(activity.name, "Круговая атака");
  assert.equal(activity._id, "lchWhirlAttack01");
  assert.deepEqual(activity.damage, source.damage);
  assert.deepEqual(activity.consumption, source.consumption);
  assert.equal(activity.flags[NS].whirlwindAttack.sourceActivityId, source._id);
  assert.equal(activity.uses?.max ?? "", "");
});

test("whirlwind is available only for property-bearing melee weapons", () => {
  assert.equal(typeof rules.buildWhirlwindActivity, "function");
  assert.equal(rules.buildWhirlwindActivity(weapon([]), base()), null);
  assert.equal(rules.buildWhirlwindActivity({ type: "equipment", system: { properties: ["lchWhirl"] } }, base()), null);
  const ranged = base(); ranged.attack.type.value = "ranged";
  assert.equal(rules.buildWhirlwindActivity(weapon(), ranged), null);
  assert.ok(rules.buildWhirlwindActivity(weapon(new Set(["lchWhirl"])), base()));
});

test("repair preserves author activities, is idempotent, and removes only its managed activity", () => {
  assert.equal(typeof rules.whirlwindActivityUpdates, "function");
  const normal = base(), custom = { ...base(), _id: "customAttack0001" };
  const item = weapon(); item.system.activities = { [normal._id]: normal, [custom._id]: custom };
  const before = structuredClone(item);
  const updates = rules.whirlwindActivityUpdates(item);
  assert.deepEqual(item, before);
  assert.equal(Object.keys(updates).length, 1);
  item.system.activities.lchWhirlAttack01 = updates["system.activities.lchWhirlAttack01"];
  assert.deepEqual(rules.whirlwindActivityUpdates(item), {});
  item.system.properties = [];
  assert.deepEqual(rules.whirlwindActivityUpdates(item), { "system.activities.-=lchWhirlAttack01": null });
  assert.deepEqual(item.system.activities[normal._id], normal);
  assert.deepEqual(item.system.activities[custom._id], custom);
});

test("a collision with an authored activity ID is never overwritten", () => {
  assert.equal(typeof rules.whirlwindActivityUpdates, "function");
  const item = weapon(); item.system.activities = { normal: base(), lchWhirlAttack01: { _id: "lchWhirlAttack01", name: "Авторская", type: "utility" } };
  assert.deepEqual(rules.whirlwindActivityUpdates(item), {});
});

test("property-bearing catalog weapons without explicit activities receive a base-damage attack", () => {
  assert.equal(typeof rules.buildWhirlwindActivity, "function");
  const activity = rules.buildWhirlwindActivity(weapon());
  assert.equal(activity.damage.includeBase, true);
  assert.equal(activity.attack.type.value, "melee");
  assert.equal(activity.activation.type, "action");
  assert.equal(activity.activation.value, 1);
});

test("native prepared melee defaults are not lost when toObject returns empty authored attack type", () => {
  const authored = base(); authored.attack.type.value = ""; authored.attack.type.classification = "";
  const prepared = { ...base(), toObject: () => structuredClone(authored) };
  const activity = rules.buildWhirlwindActivity(weapon(), prepared);
  assert.ok(activity);
  assert.equal(activity.attack.type.value, "melee");
  assert.equal(activity.attack.type.classification, "weapon");
  const item = weapon(); item.system.activities = { [authored._id]: authored };
  assert.ok(rules.whirlwindActivityUpdates(item)["system.activities.lchWhirlAttack01"]);
});

test("all creature dispositions in reach are selected, excluding source and remote tokens", () => {
  assert.equal(typeof rules.collectWhirlwindTargets, "function");
  const source = { id: "source", actor: {} };
  const tokens = [source, ...[-1, 0, 1].map(disposition => ({ id: String(disposition), actor: {}, disposition, distance: 10 })), { id: "remote", actor: {}, distance: 15 }, { id: "object", distance: 0 }];
  const targets = rules.collectWhirlwindTargets(source, tokens, 10, (_source, target) => target.distance);
  assert.deepEqual(targets.map(t => t.id), ["-1", "0", "1"]);
  assert.equal(rules.collectWhirlwindTargets(source, [tokens[1]], 10, () => -1).length, 0);
  assert.equal(rules.collectWhirlwindTargets(source, tokens, 5, (_s, t) => t.distance).length, 0);
});

test("one attack result is compared with each AC, preserving natural fumbles and critical hits", () => {
  assert.equal(typeof rules.whirlwindHitTargets, "function");
  const targets = [12, 18].map(ac => ({ actor: { system: { attributes: { ac: { value: ac } } } } }));
  assert.deepEqual(rules.whirlwindHitTargets(targets, { total: 15 }), [targets[0]]);
  assert.deepEqual(rules.whirlwindHitTargets(targets, { total: 30, isFumble: true }), []);
  assert.deepEqual(rules.whirlwindHitTargets(targets, { total: 5, isCritical: true }), targets);
});

globalThis.foundry ??= { utils: {
  getProperty: (object, path) => path.split(".").reduce((value, key) => value?.[key], object),
  setProperty(object, path, value) { const keys = path.split("."); let cursor = object; for (const key of keys.slice(0, -1)) cursor = cursor[key] ??= {}; cursor[keys.at(-1)] = value; },
  deepClone: value => structuredClone(value)
} };
globalThis.Actor ??= class Actor {};
globalThis.Item ??= class Item {};
globalThis.game ??= { user: { id: "test", isGM: true } };
const { CombatAttackService } = await import("../scripts/combat/attack-service.js");

function useFixture() {
  const actor = { system: { traits: { size: "med" } }, flags: {} };
  const item = { ...weapon(), actor, parent: actor, system: { properties: ["lchWhirl"], range: { reach: 5, units: "ft" } } };
  item.getFlag = function(namespace, key) { return this.flags?.[namespace]?.[key]; };
  const activity = { ...rules.buildWhirlwindActivity?.(item, base()), item, actor };
  const scene = { grid: { size: 100, distance: 5, units: "ft", type: 1 } };
  const source = { id: "source", uuid: "Scene.test.Token.source", x: 0, y: 0, width: 1, height: 1, actor, parent: scene };
  const ally = { id: "ally", uuid: "Scene.test.Token.ally", x: 100, y: 0, width: 1, height: 1, actor: { system: { attributes: { ac: { value: 12 } } } }, parent: scene, disposition: 1 };
  ally.actor.uuid = "Actor.ally";
  scene.tokens = [source, ally]; actor.token = source;
  return { actor, item, activity, scene, source, ally, service: new CombatAttackService({}) };
}

test("use populates workflow targets without changing user targets, permits repeats in same turn", () => {
  const f = useFixture();
  assert.equal(typeof f.service.prepareWhirlwindUse, "function");
  globalThis.canvas = { scene: f.scene };
  globalThis.game.user.targets = new Set(["manual target"]);
  const workflow = { token: f.source, setTargets(targets) { this.targets = new Set(targets); } };
  const usage = { workflow }, message = {};
  assert.equal(f.service.prepareWhirlwindUse(f.activity, usage, message), true);
  assert.deepEqual([...workflow.targets], [f.ally]);
  assert.deepEqual([...globalThis.game.user.targets], ["manual target"]);
  assert.equal(message.data.flags.dnd5e.targets[0].uuid, f.ally.actor.uuid);
  assert.equal(message.data.flags.dnd5e.targets[0].tokenUuid, f.ally.uuid);
  assert.equal(f.service.prepareWhirlwindUse(f.activity, { workflow }, {}), true);
  assert.equal(f.service.getMeleeReachFeet(f.item), 5);
  f.item.system.properties.push("lchReach");
  f.item.flags = { [NS]: { lichWeaponPropertyValues: { reachBonus: 5 } } };
  assert.equal(f.service.getMeleeReachFeet(f.item), 10);
});

test("empty area aborts before consumption and leaves no usage context", () => {
  const f = useFixture();
  assert.equal(typeof f.service.prepareWhirlwindUse, "function");
  f.scene.tokens = [f.source]; globalThis.canvas = { scene: f.scene };
  const usage = {}, message = {};
  assert.equal(f.service.prepareWhirlwindUse(f.activity, usage, message), false);
  assert.deepEqual(usage, {});
  assert.deepEqual(message, {});
});

test("typed packets halve base damage for all hits and extra damage only for the selected token", () => {
  assert.equal(typeof rules.buildWhirlwindDamagePackets, "function");
  const baseDamage = [{ type: "slashing", value: 10, properties: new Set(["mgc"]) }];
  const extraDamage = [{ type: "slashing", value: 6 }];
  const context = { baseDamage, extraDamage, selectedTargetUuid: "Token.A" };
  assert.deepEqual(rules.buildWhirlwindDamagePackets({ ...context, targetUuid: "Token.A" }).map(d => d.value), [5, 3]);
  assert.deepEqual(rules.buildWhirlwindDamagePackets({ ...context, targetUuid: "Token.B" }).map(d => d.value), [5]);
  assert.equal(baseDamage[0].value, 10);
  assert.equal(extraDamage[0].value, 6);
});

test("serialized roll properties survive packet aggregation and address a token, never its shared Actor", () => {
  assert.equal(typeof rules.markWhirlwindDamageRolls, "function");
  assert.equal(typeof rules.applyWhirlwindDamage, "function");
  const config = { rolls: [{ parts: ["3d6"], options: { properties: ["mgc"] } }] };
  rules.markWhirlwindDamageRolls(config, "Token.A");
  const serialized = JSON.parse(JSON.stringify(config));
  const packet = { type: "slashing", value: 12, properties: new Set(serialized.rolls[0].options.properties) };
  const actor = { uuid: "Actor.shared" };
  const first = [structuredClone(packet)], second = [structuredClone(packet)];
  rules.applyWhirlwindDamage(actor, first, { midi: { targetUuid: "Token.A" } });
  rules.applyWhirlwindDamage(actor, first, { midi: { targetUuid: "Token.A" } });
  rules.applyWhirlwindDamage(actor, second, { midi: { targetUuid: "Token.B" } });
  assert.equal(first[0].value, 6);
  assert.equal(second[0].value, 0);
  const unrelated = [{ type: "slashing", value: 12, properties: new Set() }];
  rules.applyWhirlwindDamage(actor, unrelated, {});
  assert.equal(unrelated[0].value, 12);
});

test("effect target selection is restricted to a hit and leaves all damage hit targets intact", async () => {
  const f = useFixture();
  assert.equal(typeof f.service.chooseWhirlwindEffectTarget, "function");
  const second = { ...f.ally, uuid: "Scene.test.Token.other" };
  const workflow = { activity: f.activity, hitTargets: new Set([f.ally, second]), hitTargetsEC: new Set() };
  f.service.moduleApi.promptWhirlwindTarget = async () => second.uuid;
  await f.service.chooseWhirlwindEffectTarget(workflow);
  assert.equal(workflow.rebreyaWhirlwind.selectedTargetUuid, second.uuid);
  assert.equal(workflow.hitTargets.size, 2);
  assert.deepEqual(rules.whirlwindEffectTargets(workflow), [second]);
  workflow.rebreyaWhirlwind.selectedTargetUuid = "Scene.test.Token.miss";
  assert.deepEqual(rules.whirlwindEffectTargets(workflow), []);
});

test("dynamic effects are scoped temporarily while damage continues to use all hit targets", () => {
  const f = useFixture();
  const other = { ...f.ally, uuid: "Scene.test.Token.other" };
  const workflow = { activity: f.activity, rebreyaWhirlwind: { selectedTargetUuid: other.uuid }, hitTargets: new Set([f.ally, other]), hitTargetsEC: new Set() };
  f.service.scopeWhirlwindEffects(workflow);
  assert.deepEqual([...workflow.hitTargets], [other]);
  f.service.scopeWhirlwindEffects(workflow, true);
  assert.equal(workflow.hitTargets.size, 2);
});

test("native attack report compares one result with all snapshotted ACs and escapes target names", async () => {
  const f = useFixture();
  assert.equal(typeof f.service.reportWhirlwindAttack, "function");
  const updates = [];
  const message = { content: "<p>Бросок</p>", async update(data) { updates.push(data); } };
  const roll = { total: 15, options: { rebreyaWhirlwindTargets: [{ uuid: "Token.A", name: "<A>", ac: 12 }, { uuid: "Token.B", name: "B", ac: 18 }] }, parent: message };
  await f.service.reportWhirlwindAttack([roll], { subject: f.activity });
  assert.equal(updates.length, 1);
  assert.match(updates[0].content, /&lt;A&gt;: попадание/);
  assert.match(updates[0].content, /B: промах/);
  assert.doesNotMatch(updates[0].content, /КД 12/);
});

test("MIDI hit results including effective AC misses and EC hits are preserved", async () => {
  const f = useFixture();
  const ec = { uuid: "Token.ec", actor: {} };
  const workflow = { activity: f.activity, attackRoll: { total: 20 }, targets: new Set([f.ally, ec]), hitTargets: new Set(), hitTargetsEC: new Set([ec]) };
  await f.service.resolveWhirlwindHits(workflow);
  assert.equal(workflow.hitTargets.size, 0);
  assert.deepEqual([...workflow.hitTargetsEC], [ec]);
});

test("MIDI manual hit setting uses its own checkHits before damage instead of raw AC", async () => {
  const f = useFixture();
  const before = globalThis.MidiQOL;
  globalThis.MidiQOL = { configSettings: () => ({ autoCheckHit: "none" }) };
  let checks = 0;
  const wf = { activity: f.activity, targets: new Set([f.ally]), hitTargets: new Set(), hitTargetsEC: new Set(), attackRoll: { total: 15 }, async checkHits() { checks++; this.hitTargets = new Set([f.ally]); } };
  try {
    await f.service.resolveWhirlwindHits(wf);
    await f.service.chooseWhirlwindEffectTarget(wf);
    assert.equal(checks, 1);
    assert.equal(wf.rebreyaWhirlwind.selectedTargetUuid, f.ally.uuid);
  } finally { globalThis.MidiQOL = before; }
});

test("activity resource consumption stays on original activity and repair cannot refund it", () => {
  assert.equal(typeof rules.routeWhirlwindConsumption, "function");
  const item = weapon(); item.id = "weapon";
  const ordinary = { ...base(), uses: { max: "3", spent: 0, recovery: [] }, consumption: { targets: [{ type: "activityUses", value: "1" }] } };
  item.system.activities = { [ordinary._id]: ordinary };
  const whirlwind = { ...rules.buildWhirlwindActivity(item, ordinary), item };
  item.system.activities[whirlwind._id] = whirlwind;
  const updates = { activity: { "uses.spent": 1 }, item: [] };
  rules.routeWhirlwindConsumption(whirlwind, updates);
  assert.deepEqual(updates.activity, {});
  assert.deepEqual(updates.item, [{ _id: item.id, [`system.activities.${ordinary._id}.uses.spent`]: 1 }]);
  ordinary.uses.spent = 1;
  const repair = rules.whirlwindActivityUpdates(item);
  assert.equal(repair[`system.activities.${whirlwind._id}`].uses.spent, 1);
});

test("native tray resolves Actors while keeping separate options for two tokens of the same Actor", async () => {
  const calls = [];
  const actor = { uuid: "Actor.shared", isOwner: true, calculateDamage() { return { amount: 1 }; }, async applyDamage(_damages, options) { calls.push(options.rebreyaWhirlwindTargetUuid); } };
  const docs = { "Actor.shared": actor, "Token.A": { uuid: "Token.A", actor }, "Token.B": { uuid: "Token.B", actor } };
  globalThis.fromUuidSync = uuid => docs[uuid];
  class NativeTray {
    constructor() { this.options = new Map(); this.entries = []; this.damages = []; this.shouldBuildTargetList = true; this.targetList = { replaceChildren: (...entries) => { this.entries = entries; }, querySelectorAll: () => this.entries }; }
    getTargetOptions(uuid) { if (!this.options.has(uuid)) this.options.set(uuid, { multiplier: 1 }); return this.options.get(uuid); }
    buildTargetsList() { this.entries = this.chatMessage.getFlag("dnd5e", "targets").map(t => this.buildTargetListEntry(t)); }
    buildTargetListEntry({ uuid }) { this.calculateDamage(globalThis.fromUuidSync(uuid), this.getTargetOptions(uuid)); return { dataset: { targetUuid: uuid } }; }
    calculateDamage(document) { return document.calculateDamage(this.damages); }
    async _onApplyDamage() { for (const entry of this.entries) await globalThis.fromUuidSync(entry.dataset.targetUuid).applyDamage(this.damages, this.getTargetOptions(entry.dataset.targetUuid)); }
  }
  rules.registerWhirlwindNativeTargetOptions(NativeTray);
  const tray = new NativeTray();
  const descriptors = ["Token.A", "Token.B"].map(tokenUuid => ({ uuid: actor.uuid, tokenUuid, name: tokenUuid }));
  tray.chatMessage = { getFlag: (namespace, key) => namespace === NS ? { targetUuids: ["Token.A", "Token.B"] } : descriptors };
  tray.buildTargetsList();
  assert.deepEqual(tray.entries.map(e => e.dataset.targetUuid), ["Token.A", "Token.B"]);
  assert.notEqual(tray.getTargetOptions("Token.A"), tray.getTargetOptions("Token.B"));
  await tray._onApplyDamage({ preventDefault() {} });
  assert.deepEqual(calls, ["Token.A", "Token.B"]);
  assert.doesNotThrow(() => tray.calculateDamage(docs["Token.A"], {}));
});

test("native damage card inherits snapshotted hit targets instead of current manual targets", () => {
  const f = useFixture();
  assert.equal(typeof f.service.prepareWhirlwindDamageCard, "function");
  globalThis.fromUuidSync = uuid => uuid === f.ally.uuid ? f.ally : null;
  globalThis.game.messages = { get: () => ({ getFlag: (namespace, key) => namespace === NS ? { targetUuids: [f.ally.uuid], hitTokenUuids: [f.ally.uuid] } : null }) };
  const config = { subject: f.activity }, message = { data: { flags: { dnd5e: { originatingMessage: "original" } } } };
  f.service.prepareWhirlwindDamageCard(config, message);
  assert.equal(message.data.flags.dnd5e.targets[0].uuid, f.ally.actor.uuid);
  assert.equal(message.data.flags.dnd5e.targets[0].tokenUuid, f.ally.uuid);
});

test("damage-card metadata never resets an existing MIDI workflow's checked hit sets", () => {
  const f = useFixture(); globalThis.canvas = { scene: f.scene }; globalThis.game.messages = { get: () => null };
  const workflow = { token: f.source, hitTargets: new Set([f.ally]), hitTargetsEC: new Set(), rebreyaWhirlwind: { selectedTargetUuid: f.ally.uuid }, setTargets() { throw new Error("checked hits must not be reset"); } };
  assert.doesNotThrow(() => f.service.prepareWhirlwindDamageCard({ subject: f.activity, workflow }, {}));
  assert.equal(workflow.hitTargets.size, 1);
});
