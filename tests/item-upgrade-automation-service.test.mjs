import test from "node:test";
import assert from "node:assert/strict";
import { ItemUpgradeAutomationService } from "../scripts/automation/item-upgrade-automation-service.js";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { CombatAttackService } from "../scripts/combat/attack-service.js";
import { registerCombatHooks } from "../scripts/combat/hooks.js";

test("one ordinary turn with five participants leaves equipment and world lighting alone", async (t) => {
  const previous = { game: globalThis.game, Hooks: globalThis.Hooks, Actor: globalThis.Actor, Combat: globalThis.Combat, foundry: globalThis.foundry };
  t.after(() => Object.assign(globalThis, previous));
  const hooks = new Map();
  globalThis.Hooks = { on(name, fn) { (hooks.get(name) ?? hooks.set(name, []).get(name)).push(fn); } };
  const fire = (name, ...args) => Promise.all((hooks.get(name) ?? []).map(fn => fn(...args)));
  const counts = { syncs: 0, items: 0, lights: 0 };
  const scenes = Array.from({ length: 20 }, () => ({
    lights: Array.from({ length: 50 }, () => ({ getFlag() { counts.lights++; } }))
  }));
  const ns = "rebreya-main", gm = { id: "gm", isGM: true, active: true };
  globalThis.game = { user: gm, release: { generation: 14 }, scenes };
  globalThis.foundry = { utils: { deepClone: structuredClone } };
  globalThis.Combat = class Combat {};
  globalThis.Actor = class Actor {
    documentName = "Actor";
    constructor(i) {
      this.id = `a${i}`; this.uuid = `Actor.${this.id}`; this.type = "npc";
      this.flags = {}; this.effects = new Map();
      this.items = Array.from({ length: 20 }, () => ({ toObject() { counts.items++; return {}; } }));
      this.items.contents = [...this.items];
    }
    getFlag(module, key) { return this.flags[module]?.[key]; }
    async update(patch) {
      const path = `flags.${ns}.==weaponModMovement`;
      if (path in patch) (this.flags[ns] ??= {}).weaponModMovement = patch[path];
      return fire("updateActor", this, { _id: this.id, _stats: { modifiedTime: 1 }, flags: { [ns]: { weaponModMovement: patch[path] } } }, {});
    }
    async setFlag(module, key, value) {
      (this.flags[module] ??= {})[key] = value;
      return fire("updateActor", this, { _id: this.id, flags: { [module]: { [key]: value } } }, {});
    }
    async createEmbeddedDocuments() {}
  };
  const actors = Array.from({ length: 5 }, (_, i) => new Actor(i));
  const coordinator = new WorldMutationCoordinator();
  const api = { worldMutationCoordinator: coordinator, inventoryService: { mutationCoordinator: coordinator } };
  api.combatAttackService = new CombatAttackService(api);
  api.itemUpgradeAutomationService = new ItemUpgradeAutomationService(api, { readActor(uuid) {
    counts.syncs++;
    return actors.find(actor => actor.uuid === uuid);
  } });
  registerCombatHooks(api);
  const combat = Object.assign(new Combat(), { id: "fight", round: 1, turn: 1, combatants: actors.map(actor => ({ actor })) });
  combat.combatant = combat.combatants[1];
  game.combat = combat;
  await api.combatAttackService.handleCombatTurnChange(combat, { round: 1, turn: 1 });
  assert.equal(actors[1].getFlag(ns, "weaponModMovement").feet, 0);
  assert.equal(actors[1].getFlag(ns, "reactionState").usesRemaining, 1);
  assert.deepEqual(counts, { syncs: 0, items: 0, lights: 0 });
  await fire("updateActor", actors[1], { flags: { [ns]: { "==weaponModMovement": { feet: 0 } } } }, {});
  assert.equal(counts.syncs, 0, "legacy replacement syntax is also a turn-only update");
  await fire("updateActor", actors[1], { flags: { [ns]: { reactionState: {} } }, system: { attributes: { hp: { max: 7 } } } }, {});
  assert.equal(counts.syncs, 1, "a mixed Actor update still refreshes equipment");
});

function fixture() {
  const effects = new Map(); let writes = 0, authority = true;
  const actor = { uuid: "Actor.a", effects, items: { contents: [] },
    async createEmbeddedDocuments(_type, rows) { for (const row of rows) { const id = `e${++writes}`; effects.set(id, { ...structuredClone(row), id, toObject() { const { toObject, ...data } = this; return structuredClone(data); } }); } },
    async updateEmbeddedDocuments(_type, rows) { for (const row of rows) { Object.assign(effects.get(row._id), structuredClone(row)); writes++; } },
    async deleteEmbeddedDocuments(_type, ids) { for (const id of ids) { effects.delete(id); writes++; } }
  };
  let contributions = [{ key: "one", scope: "actor", path: "system.attributes.ac.bonus", value: 1, hostItemId: "host", upgradeItemId: "upgrade", sourceId: "maloe-zacharovanie-zashchity" }];
  const service = new ItemUpgradeAutomationService({ worldMutationCoordinator: new WorldMutationCoordinator() }, {
    readActor: async () => actor, isAuthority: () => authority,
    project: () => ({ contributions, unavailable: [] })
  });
  return { actor, effects, service, writes: () => writes, setContributions: value => { contributions = value; }, setAuthority: value => { authority = value; } };
}
test("sync is idempotent; remove preserves unrelated and curse effects", async () => {
  const f = fixture();
  f.effects.set("user", { id: "user", flags: {} });
  f.effects.set("curse", { id: "curse", flags: { "rebreya-main": { curseUpgrade: { managed: true } } } });
  await f.service.requestSync(f.actor.uuid, "install");
  assert.equal(f.effects.size, 3); const writes = f.writes();
  await f.service.requestSync(f.actor.uuid, "repeat"); assert.equal(f.writes(), writes);
  f.setContributions([]); await f.service.requestSync(f.actor.uuid, "remove");
  assert.deepEqual([...f.effects.keys()], ["user", "curse"]);
});

test("expired aim clears only its movement effects without a full equipment sync", async (t) => {
  const previous = globalThis.game;
  t.after(() => { globalThis.game = previous; });
  globalThis.game = { user: { id: "gm", isGM: true, active: true } };
  const f = fixture(), ns = "rebreya-main";
  f.actor.id = "a";
  const host = { id: "host", aim: { combatId: "fight", round: 1, turn: 0 },
    getFlag(_module, key) { return key === "weaponModAim" ? this.aim : undefined; },
    async update(_patch, options) { this.aim = undefined; await f.service.handleChanged(this, options); },
    actor: f.actor
  };
  f.actor.items = new Map([[host.id, host]]);
  f.actor.items.contents = [host];
  const managed = (id, key, hostItemId) => ({ id, flags: { [ns]: { simpleItemUpgrade: { managed: true, key, hostItemId } } } });
  f.effects.set("aim", managed("aim", "weapon:aim-movement:walk", host.id));
  f.effects.set("armor", managed("armor", "armor:passive", host.id));
  f.actor.items.set("other", { aim: true, getFlag() { return this.aim; } });
  f.effects.set("other", managed("other", "other:aim-movement:walk", "other"));
  f.service.syncActor = async () => { throw new Error("full equipment sync"); };
  const api = { inventoryService: { mutationCoordinator: new WorldMutationCoordinator() }, itemUpgradeAutomationService: f.service };
  const attack = new CombatAttackService(api);
  const combat = { id: "fight", round: 1, turn: 1, combatants: [{ actor: f.actor }] };
  const deleteEffects = f.actor.deleteEmbeddedDocuments;
  f.actor.deleteEmbeddedDocuments = async () => { throw new Error("temporary delete failure"); };
  await assert.rejects(attack.handleWeaponModTurnChange(combat), /temporary delete failure/);
  assert.equal(host.aim, undefined);
  assert.ok(f.effects.has("aim"));
  f.actor.deleteEmbeddedDocuments = deleteEffects;
  await attack.handleWeaponModTurnChange(combat);
  assert.deepEqual([...f.effects.keys()], ["armor", "other"]);
});
test("identical item contributions remain separate and loss of authority prevents writes", async () => {
  const f = fixture();
  f.setContributions([1,2].map(i => ({ key: `key${i}`, scope: "actor", path: "system.bonuses.abilities.save", value: 1, hostItemId: `h${i}`, upgradeItemId: `u${i}`, sourceId: "maloe-zacharovanie-stoykosti" })));
  await Promise.all([f.service.requestSync(f.actor.uuid, "one"), f.service.requestSync(f.actor.uuid, "two")]);
  assert.equal(f.effects.size, 2); assert.equal(f.writes(), 2);
  f.setAuthority(false); f.setContributions([]);
  await f.service.requestSync(f.actor.uuid, "nonGM"); assert.equal(f.effects.size, 2);
});

test("historical upgrades on forbidden hosts do not contribute automation", () => {
  const host = {
    id: "painting",
    type: "loot",
    system: { type: { value: "gear" }, quantity: 1 },
    flags: { "rebreya-main": { equipmentType: "Снаряжение", itemUpgrades: { capacity: 1, installed: [{ itemId: "upgrade", slotIndex: 1 }] } } },
    toObject() { return structuredClone({ id: this.id, type: this.type, system: this.system, flags: this.flags }); }
  };
  const upgrade = {
    id: "upgrade",
    system: { quantity: 1, container: "painting" },
    flags: { "rebreya-main": { gearId: "universal", installedUpgrade: { hostItemId: "painting", slotIndex: 1 } } }
  };
  const items = new Map([[host.id, host], [upgrade.id, upgrade]]);
  items.contents = [...items.values()];
  const actor = { items };
  const service = new ItemUpgradeAutomationService({});
  service.manifest = [{ productId: "universal", decision: "simple-implemented", profile: { compatibility: ["any"] } }];

  assert.equal(service.readHosts(actor)[0].upgrades[0].valid, false);
});

test("native preparation repeats without accumulating weight and honors a source edit equal to the old result", () => {
  const previous = globalThis.CONFIG;
  class Item {
    constructor() { this.actor = {}; this.source = { weight: { value: 25, units: "lb" } }; this.system = structuredClone(this.source); this.flags = { "rebreya-main": { itemUpgrades: { installed: [{}] } } }; }
    toObject() { return { system: structuredClone(this.source) }; }
    applyActiveEffects() {}
  }
  const service = new ItemUpgradeAutomationService({}, { project: () => ({ contributions: [{ scope: "host", operation: "reduce-weight-lb", value: 10 }] }) });
  service.manifest = [{}];
  try {
    globalThis.CONFIG = { Item: { documentClass: Item } };
    service.registerItemDataPatch();
    const item = new Item();
    item.applyActiveEffects(); assert.equal(item.system.weight.value, 15);
    item.applyActiveEffects(); assert.equal(item.system.weight.value, 15);
    item.source.weight.value = 15; item.system = structuredClone(item.source);
    item.applyActiveEffects(); assert.equal(item.system.weight.value, 5);
    item.applyActiveEffects(); assert.equal(item.system.weight.value, 5);
    service.options.project = () => ({ contributions: [] });
    item.applyActiveEffects(); assert.equal(item.system.weight.value, 15);
  } finally { globalThis.CONFIG = previous; }
});

test("initialize resets native actor models before preparing existing activities", async () => {
  const previous = globalThis.game;
  let resets = 0;
  const actor = { uuid: "Actor.ready", reset() { resets++; }, prepareData() { assert.fail("Direct prepareData duplicates native base damage parts"); } };
  const service = new ItemUpgradeAutomationService({}, { getManifest: async () => [], getWeaponModCatalog:async()=>({rows:[],hosts:[]}), isAuthority: () => false });
  service.registerItemDataPatch = () => false;
  try {
    globalThis.game = { system: { id: "dnd5e" }, actors: { contents: [actor] } };
    await service.initialize();
    assert.equal(resets, 1);
  } finally { globalThis.game = previous; }
});

test("holy steel restores only its own base dice and respects source edits and removal", () => {
  const previous = globalThis.CONFIG;
  class Item {
    constructor() {
      this.actor = {}; this.source = { damage: { base: { number: 1, types: ["slashing"] } } };
      this.system = { damage: { base: { number: 1, types: new Set(["slashing"]) } } };
      this.flags = { "rebreya-main": { itemUpgrades: { installed: [{}] } } };
    }
    toObject() { return { system: structuredClone(this.source) }; }
    applyActiveEffects() {}
  }
  const service = new ItemUpgradeAutomationService({}, { project: () => ({ contributions: [{ scope: "host", operation: "radiant-double-base", value: true }] }) });
  service.manifest = [{}];
  try {
    globalThis.CONFIG = { Item: { documentClass: Item } }; service.registerItemDataPatch();
    const item = new Item(); item.applyActiveEffects(); item.applyActiveEffects();
    assert.equal(item.system.damage.base.number, 2);
    assert.deepEqual([...item.system.damage.base.types], ["radiant"]);
    item.source.damage.base.number = 2;
    item.system = { damage: { base: { number: 2, types: new Set(["slashing"]) } } };
    item.applyActiveEffects(); assert.equal(item.system.damage.base.number, 4);
    service.options.project = () => ({ contributions: [] });
    item.applyActiveEffects(); assert.equal(item.system.damage.base.number, 2);
    assert.deepEqual([...item.system.damage.base.types], ["slashing"]);
  } finally { globalThis.CONFIG = previous; }
});
