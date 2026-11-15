import test from "node:test";
import assert from "node:assert/strict";
import { buildHolyWeaponRepair, syncHolyWeaponSpells } from "../scripts/data/holy-weapon-spell-item.js";
import { registerHolyWeaponHooks } from "../scripts/integrations/holy-weapon-hooks.js";

const identifier = "svyashennoe-oruzhie--holy-weapon";
const saveId = "originalBurst01";
const saveSource = {
  _id: saveId, type: "save", name: "Авторская вспышка", sort: 0,
  target: { override: true, template: { type: "radius", size: "30" } },
  save: { ability: ["con"], dc: { calculation: "spellcasting", formula: "" } },
  damage: { onSave: "half", parts: [
    { custom: { enabled: true, formula: "4d8+@abilities.cha.mod" }, types: ["radiant"] },
    { number: 1, denomination: 6, types: ["radiant"] }
  ] },
  description: { chatFlavor: "Авторское описание" }, flags: { custom: { preserved: true } }, effects: []
};

function sourceItem() {
  return { type: "spell", name: "Священное оружие", effects: [], system: {
    identifier, level: 5, activation: { type: "bonus", value: 1 },
    duration: { value: "1", units: "hour" }, properties: ["concentration"], activities: { [saveId]: structuredClone(saveSource) }
  } };
}

test("Holy Weapon builds a native, one-weapon enchant with a radiant part only on attack activities", () => {
  const source = sourceItem();
  const patch = buildHolyWeaponRepair(source);
  assert.deepEqual(source, sourceItem());
  const [cast, dismiss] = Object.values(patch.system.activities);
  assert.equal(cast.type, "enchant");
  assert.equal(cast.consumption.spellSlot, true);
  assert.deepEqual(cast.activation, { type: "bonus", value: 1 });
  assert.deepEqual(cast.duration, { value: "1", units: "hour", override: true, concentration: true });
  assert.equal(cast.target.affects.count, "1");
  assert.equal(cast.restrictions.type, "weapon");
  assert.equal(cast.restrictions.allowMagical, true);
  const [effect] = patch.effects;
  assert.equal(cast.effects[0]._id, effect._id);
  assert.equal(effect.type, "enchantment");
  assert.equal(effect.transfer, false);
  assert.deepEqual(effect.system.changes, [
    { key: "system.properties", type: "add", value: "mgc" },
    { key: "activities[attack].damage.parts", type: "add", value: { number: 2, denomination: 8, types: ["radiant"] } }
  ]);
  assert.equal(dismiss._id, saveId);
  assert.equal(dismiss.type, "save");
  assert.deepEqual(dismiss.damage, saveSource.damage);
  assert.deepEqual(dismiss.save, saveSource.save);
  assert.deepEqual(dismiss.target, saveSource.target);
  assert.deepEqual(dismiss.description, saveSource.description);
  assert.deepEqual(dismiss.flags.custom, saveSource.flags.custom);
  assert.equal(dismiss.consumption.spellSlot, false);
  assert.deepEqual(dismiss.duration, { units: "inst", override: true, concentration: false });
});

test("Holy Weapon repair skips a changed, unrelated, or already migrated item", () => {
  const source = sourceItem();
  assert.equal(buildHolyWeaponRepair({ ...source, system: { ...source.system, identifier: "holy-weapon" } }), null);
  assert.equal(buildHolyWeaponRepair({ ...source, effects: [{ _id: "someoneElse" }] }), null);
  assert.equal(buildHolyWeaponRepair({ ...source, system: { ...source.system, activities: {
    [saveId]: { ...saveSource, damage: { parts: saveSource.damage.parts.slice(0, 1) } }
  } } }), null);
  const patch = buildHolyWeaponRepair(source);
  assert.equal(buildHolyWeaponRepair({ ...source, system: { ...source.system, ...patch.system }, effects: patch.effects }), null);
});

function gameFixture() {
  const user = { id: "gm", active: true, isGM: true };
  return { release: { generation: 14 }, system: { id: "dnd5e", version: "6.0.6" }, user, users: { activeGM: user } };
}

test("startup repairs exact world and Actor copies only on the supported active GM", async () => {
  const game = gameFixture();
  const updated = [];
  const item = (id, data = sourceItem()) => ({ ...data, id, toObject: () => data,
    async update(patch) { updated.push(id); Object.assign(data.system, patch.system); data.effects = patch.effects; } });
  game.items = { contents: [item("world"), { type: "weapon", toObject: () => assert.fail("unrelated item serialized") }] };
  game.actors = { contents: [{ items: { contents: [item("actor")] } }] };
  await syncHolyWeaponSpells({ ...game, user: { id: "other", active: true, isGM: true } });
  await syncHolyWeaponSpells({ ...game, release: { generation: 13 } });
  assert.deepEqual(updated, []);
  await syncHolyWeaponSpells(game);
  await syncHolyWeaponSpells(game);
  assert.deepEqual(updated, ["world", "actor"]);
});

function runtimeFixture() {
  const patch = buildHolyWeaponRepair(sourceItem());
  const [cast, dismiss] = Object.values(patch.system.activities);
  const handlers = new Map();
  const warnings = [], ended = [];
  const item = { ...sourceItem(), id: "spell", uuid: "Actor.caster.Item.spell" };
  const effects = new Set();
  const actor = { concentration: { effects }, async endConcentration(id) { ended.push(id); } };
  Object.assign(cast, { id: cast._id, item, actor, appliedEnchantments: [] });
  Object.assign(dismiss, { id: dismiss._id, item, actor });
  item.system.activities = new Map([[cast.id, cast], [dismiss.id, dismiss]]);
  const effect = { id: "concentration", uuid: "Actor.caster.ActiveEffect.concentration", active: true,
    flags: { dnd5e: { item: { uuid: item.uuid }, activity: { id: cast.id } } } };
  const enchantment = { id: "enchantment", active: true, flags: { dnd5e: { dependentOn: effect.uuid } } };
  registerHolyWeaponHooks({ game: gameFixture(), Hooks: { on: (event, fn) => handlers.set(event, fn) },
    warn: (message) => warnings.push(message) });
  return { cast, dismiss, effect, enchantment, effects, handlers, ended, warnings };
}

test("dropped weapons must retain the native concentration link from the same cast", () => {
  const f = runtimeFixture();
  const apply = f.handlers.get("dnd5e.preApplyEnchantment");
  const data = { flags: { dnd5e: { dependentOn: f.effect.uuid } } };
  assert.equal(apply({ type: "weapon" }, data, { activity: f.cast }), false);
  f.effects.add(f.effect);
  assert.equal(apply({ type: "weapon" }, {}, { activity: f.cast }), false);
  assert.equal(apply({ type: "weapon" }, data, { activity: f.cast }), true);
  f.cast.appliedEnchantments.push(f.enchantment);
  assert.equal(apply({ type: "weapon" }, data, { activity: f.cast }), false);
  assert.equal(apply({ type: "equipment" }, data, { activity: f.cast }), false);
});

test("Holy Weapon concentration expires at the stated hour without a turn gate", () => {
  const f = runtimeFixture();
  const before = f.handlers.get("dnd5e.preBeginConcentrating");
  const duration = { value: 1, units: "hours", expiry: "turnStart" };
  before(f.cast.actor, f.cast.item, { duration }, f.cast);
  assert.deepEqual(duration, { value: 1, units: "hours", expiry: null });
  const unrelated = { ...duration, expiry: "turnStart" };
  before(f.cast.actor, f.cast.item, { duration: unrelated }, f.dismiss);
  assert.equal(unrelated.expiry, "turnStart");
});

test("dismissal requires a matching live enchantment and ends just its captured concentration", async () => {
  const f = runtimeFixture();
  const preUse = f.handlers.get("dnd5e.preUseActivity");
  const preConsume = f.handlers.get("dnd5e.preActivityConsumption");
  const postUse = f.handlers.get("dnd5e.postUseActivity");
  f.effects.add(f.effect);
  assert.equal(preUse(f.dismiss, {}), false);
  f.cast.appliedEnchantments.push(f.enchantment);
  const usage = {};
  assert.equal(preUse(f.dismiss, usage), true);
  assert.equal(preConsume(f.dismiss, usage), true);
  const other = { ...f.effect, id: "new", uuid: "Actor.caster.ActiveEffect.new" };
  f.effects.delete(f.effect);
  f.effects.add(other);
  assert.equal(preConsume(f.dismiss, usage), false);
  await postUse(f.dismiss, usage);
  assert.deepEqual(f.ended, []);
  f.effects.add(f.effect);
  const retry = {};
  assert.equal(preUse(f.dismiss, retry), true);
  await postUse(f.dismiss, retry);
  await postUse(f.dismiss, retry);
  assert.deepEqual(f.ended, [f.effect.id]);
});
