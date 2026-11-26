import test from "node:test";
import assert from "node:assert/strict";
import { ItemUpgradeAutomationService } from "../scripts/automation/item-upgrade-automation-service.js";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { CombatAttackService } from "../scripts/combat/attack-service.js";
import { registerCombatHooks } from "../scripts/combat/hooks.js";
import { isCombatActorActive } from "../scripts/combat/turn-group-rules.js";
import { createStableGearDocumentId } from "../scripts/data/gear-document-ids.js";

test("one ordinary turn with five participants leaves equipment and world lighting alone", async (t) => {
  const previous = { game: globalThis.game, Hooks: globalThis.Hooks, Actor: globalThis.Actor, Combat: globalThis.Combat, foundry: globalThis.foundry };
  t.after(() => Object.assign(globalThis, previous));
  const hooks = new Map();
  globalThis.Hooks = { on(name, fn) { (hooks.get(name) ?? hooks.set(name, []).get(name)).push(fn); } };
  const fire = (name, ...args) => Promise.all((hooks.get(name) ?? []).map(fn => fn(...args)));
  const counts = { syncs: 0, items: 0, lights: 0 };
  const actorWrites = [];
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
      actorWrites.push([this.id, Object.keys(patch)]);
      if (path in patch) (this.flags[ns] ??= {}).weaponModMovement = patch[path];
      return fire("updateActor", this, { _id: this.id, _stats: { modifiedTime: 1 }, flags: { [ns]: { weaponModMovement: patch[path] } } }, {});
    }
    async setFlag(module, key, value) {
      actorWrites.push([this.id, [key]]);
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
  api.itemUpgradeAutomationService.manifest = [];
  registerCombatHooks(api);
  const combat = Object.assign(new Combat(), { id: "fight", started: true, round: 1, turn: 1,
    combatants: actors.map(actor => ({ id: actor.id, actor })) });
  combat.combatant = combat.combatants[1];
  game.combat = combat;
  await api.combatAttackService.handleCombatTurnChange(combat, { round: 1, turn: 1 });
  assert.deepEqual(actorWrites, [], "a full reaction counter must not rebuild the actor at NEXT");
  await api.combatAttackService.consumeReaction(actors[1], { idempotencyKey: "spent-before-turn" });
  assert.equal(api.combatAttackService.getReactionState(actors[1]).usesRemaining, 0);
  actorWrites.length = 0;
  await api.combatAttackService.handleCombatTurnChange(combat, { round: 2, turn: 1 });
  assert.deepEqual(actorWrites, [[actors[1].id, ["reactionState"]]]);
  assert.equal(actors[1].getFlag(ns, "reactionState").usesRemaining, 1);
  assert.equal(actors[1].getFlag(ns, "reactionState").lastRefreshRound, 2);
  assert.equal((await api.combatAttackService.consumeReaction(actors[1], { idempotencyKey: "spent-before-turn" })).replayed, true);
  assert.equal(api.combatAttackService.getReactionState(actors[1]).usesRemaining, 1);
  assert.deepEqual(counts, { syncs: 0, items: 0, lights: 0 });
  actorWrites.length = 0;
  const memberIds = [actors[2].id, actors[3].id];
  combat.flags = { [ns]: { groupedCombat: { mode: "active", current: { round: 1, groupId: "group" },
    groups: [{ id: "group", memberIds }] } } };
  combat.turn = 2;
  combat.combatant = combat.combatants[2];
  const phase = { round: 1, groupId: "group", memberIds };
  await api.combatAttackService.handleGroupedCombatPhase(combat, { ...phase, kind: "each-turn" });
  assert.deepEqual(actorWrites, []);
  await api.combatAttackService.handleGroupedCombatPhase(combat, { ...phase, kind: "turn-start" });
  assert.deepEqual(actorWrites, memberIds.map(id => [id, ["reactionState"]]));
  for (const i of [2, 3]) {
    assert.equal(actors[i].getFlag(ns, "reactionState").usesRemaining, 1);
    assert.equal(actors[i].getFlag(ns, "reactionState").lastRefreshTurn, 2);
  }
  game.rebreyaMain = api;
  api.groupedCombatService = { groupedEnabled: false };
  for (const actor of actors) {
    Object.defineProperty(actor.items, "contents", { get() { assert.fail("diagnostic scanned an inventory on NEXT"); } });
  }
  assert.equal(isCombatActorActive(combat, actors[2]), true);
  assert.equal(isCombatActorActive(combat, actors[3]), false, "stored group does not grant another actor an active turn");
  actorWrites.length = 0;
  await fire("combatTurnChange", combat, { round: 1, turn: 1 }, { round: 1, turn: 2 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(actorWrites, [], "ordinary NEXT skips the already-full counter even when a legacy group exists");
  await fire("updateActor", actors[1], { flags: { [ns]: { "==weaponModMovement": { feet: 0 } } } }, {});
  assert.equal(counts.syncs, 0, "legacy replacement syntax is also a turn-only update");
  await fire("updateActor", actors[1], { flags: { [ns]: { reactionState: {} } }, system: { attributes: { hp: { max: 7 } } } }, {});
  assert.equal(counts.syncs, 1, "a mixed Actor update still refreshes equipment");
});

function fixture({ ready = true } = {}) {
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
  if (ready) service.manifest = [];
  return { actor, effects, service, writes: () => writes, setContributions: value => { contributions = value; }, setAuthority: value => { authority = value; } };
}

test("startup preserves existing griffon and soul enchantment effects until both catalogs are ready", async (t) => {
  const previous = globalThis.game;
  t.after(() => { globalThis.game = previous; });
  const { actor, effects, service, writes } = fixture({ ready: false });
  actor.uuid = "Scene.s.Token.t.Actor.a";
  actor.items = new Map();
  const ns = "rebreya-main", manifest = [];
  let reads = 0;
  globalThis.game = { system: { id: "dnd5e" }, release: { generation: 14 }, actors: [] };
  service.options.project = undefined;
  service.options.readActor = async uuid => { reads++; return uuid === actor.uuid ? actor : null; };
  service.options.getManifest = async () => manifest;
  const catalog = Promise.withResolvers();
  service.options.getWeaponModCatalog = () => catalog.promise;
  const makeItem = (id, name, type, system, flags) => ({
    id, name, type, system, flags: { [ns]: flags },
    toObject() { const { toObject, ...source } = this; return structuredClone(source); }
  });
  const cases = [
    { id: "griffon", name: "Шерсть гриффона", type: "clothing", sourceId: "sherst-griffona", compatibility: "outerwear",
      bonuses: [["system.attributes.movement.walk", 5]] },
    { id: "soul", name: "Душевное зачарование", type: "wondrous", sourceId: "dushevnoe-zacharovanie", compatibility: "wondrous-item",
      bonuses: [["system.skills.per.bonuses.check", 1], ["system.skills.prf.bonuses.check", 1]] }
  ];
  for (const { id, name, type, sourceId, compatibility, bonuses } of cases) {
    const hostItemId = `host-${id}`;
    const profile = { compatibility: [compatibility] };
    manifest.push({ productId: sourceId, decision: "simple-implemented", profile });
    actor.items.set(hostItemId, makeItem(hostItemId, type, "equipment", { equipped: true, quantity: 1, type: { value: type } },
      { itemUpgrades: { capacity: 1, installed: [{ itemId: id, slotIndex: 1 }] } }));
    actor.items.set(id, makeItem(id, name, "loot", { quantity: 1, container: hostItemId },
      { gearId: sourceId, installedUpgrade: { hostItemId, slotIndex: 1 } }));
    for (const [index, [key, value]] of bonuses.entries()) {
      const effectId = `${id}-${index}`;
      effects.set(effectId, {
        id: effectId, name, type: "base", transfer: false, disabled: false,
        system: { changes: [{ _id: effectId, key, type: "add", value, priority: 20, phase: "initial", conditions: {} }] },
        flags: { [ns]: { simpleItemUpgrade: { managed: true, hostItemId, upgradeItemId: id,
          key: JSON.stringify([actor.uuid, hostItemId, id, String(index), 1]) } } },
        toObject() { const { toObject, ...data } = this; return structuredClone(data); }
      });
    }
  }

  const expectedIds = ["griffon-0", "soul-0", "soul-1"];
  await service.handleChanged({ uuid: "Compendium.rebreya-main.gear.Item.template", documentName: "Item" });
  await service.handleChanged({ actor });
  assert.deepEqual([...effects.keys()], expectedIds);
  const initializing = service.initialize();
  try {
    await service.handleChanged({ actor });
    assert.equal(writes(), 0);
  } finally {
    catalog.resolve({ rows: [], hosts: [] });
    await initializing;
  }
  assert.deepEqual([...effects.keys()], expectedIds);
  assert.equal(reads, 1, "repeated early hooks coalesce into one sync for the synthetic actor");
  assert.equal(writes(), 0, "an equivalent native change must not be rewritten");

  effects.get("griffon-0").system.changes[0].value = 2;
  await service.handleChanged({ actor });
  assert.equal(writes(), 1);
  assert.deepEqual(effects.get("griffon-0").system.changes, [
    { _id: "griffon-0", key: "system.attributes.movement.walk", type: "add", value: 5, priority: 20 }
  ]);

  actor.items.get("host-griffon").system.equipped = false;
  await service.handleChanged({ actor });
  assert.deepEqual([...effects.keys()], ["soul-0", "soul-1"]);
  actor.items.get("host-griffon").system.equipped = true;
  await service.handleChanged({ actor });
  const created = [...effects.values()].find(effect => effect.name === "Шерсть гриффона");
  assert.deepEqual(created.system.changes, [{ key: "system.attributes.movement.walk", type: "add", value: 5, priority: 20 }]);
});
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

test("turn end and token movement clear only expired aim effects without a full equipment sync", async (t) => {
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
  combat.combatant = combat.combatants[0];
  globalThis.game.combat = combat;
  const deleteEffects = f.actor.deleteEmbeddedDocuments;
  f.actor.deleteEmbeddedDocuments = async () => { throw new Error("temporary delete failure"); };
  await assert.rejects(attack.handleWeaponModTurnChange(combat), /temporary delete failure/);
  assert.equal(host.aim, undefined);
  assert.ok(f.effects.has("aim"));
  f.actor.deleteEmbeddedDocuments = deleteEffects;
  await attack.handleWeaponModTurnChange(combat);
  assert.deepEqual([...f.effects.keys()], ["armor", "other"]);

  host.aim = { combatId: "fight", round: 1, turn: 1 };
  f.effects.set("aim", managed("aim", "weapon:aim-movement:walk", host.id));
  await attack.handleWeaponModTokenMove({ actor: f.actor }, { x: 100 });
  assert.equal(host.aim, undefined);
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
  const actor = { uuid: "Actor.ready", items: [{ flags: { "rebreya-main": { itemUpgrades: { installed: [{}] } } } }],
    reset() { resets++; }, prepareData() { assert.fail("Direct prepareData duplicates native base damage parts"); } };
  const service = new ItemUpgradeAutomationService({}, { getManifest: async () => [], getWeaponModCatalog:async()=>({rows:[],hosts:[]}), isAuthority: () => false });
  service.registerItemDataPatch = () => false;
  try {
    globalThis.game = { system: { id: "dnd5e" }, actors: { contents: [actor] } };
    await service.initialize();
    assert.equal(resets, 1);
  } finally { globalThis.game = previous; }
});

test("upgrade startup visits world lights once and resets only affected actors", async (t) => {
  const restore = { game: globalThis.game, fromUuid: globalThis.fromUuid };
  t.after(() => Object.assign(globalThis, restore));
  const ns = "rebreya-main";
  const counts = { resets: 0, actorReads: 0, lightReads: 0 };
  const removed = [];
  const actors = Array.from({ length: 30 }, (_, i) => ({
    uuid: `Actor.${i}`, items: [], effects: [], reset() { counts.resets++; }, async createEmbeddedDocuments() {},
    async deleteEmbeddedDocuments(kind, ids) { removed.push([kind, ...ids]); }
  }));
  actors[0].items = [{ flags: { [ns]: { itemUpgrades: { installed: [{}] } } }, toObject() { return {}; } }];
  actors[1].effects = [{ id: "orphan-effect", flags: { [ns]: { simpleItemUpgrade: { managed: true } } } }];
  const scenes = Array.from({ length: 12 }, () => ({
    lights: Array.from({ length: 20 }, () => ({ getFlag() { counts.lightReads++; } }))
  }));
  const marker = { actorUuid: "Actor.gone", hostItemId: "host", childItemId: "mod", tokenUuid: "Scene.a.Token.gone" };
  const id = createStableGearDocumentId(`weapon-mod-light:${marker.actorUuid}:${marker.hostItemId}:${marker.childItemId}:${marker.tokenUuid}`);
  scenes[0].lights.push({ id, getFlag() { counts.lightReads++; return marker; }, async delete() {
    removed.push(["AmbientLight", id]); scenes[0].lights.pop();
  } });
  globalThis.game = { system: { id: "dnd5e" }, actors, scenes };
  globalThis.fromUuid = async () => null;
  let authority = true;
  const service = new ItemUpgradeAutomationService({ worldMutationCoordinator: new WorldMutationCoordinator() }, {
    isAuthority: () => authority, getManifest: async () => [], getWeaponModCatalog: async () => ({ rows: [], hosts: [] }),
    readActor(uuid) { counts.actorReads++; return actors.find(actor => actor.uuid === uuid); }, project: () => ({ contributions: [] })
  });
  await service.initialize();
  assert.deepEqual(counts, { resets: 2, actorReads: 2, lightReads: 241 });
  assert.deepEqual(removed, [["AmbientLight", id], ["ActiveEffect", "orphan-effect"]]);

  const hooks = new Map();
  const previousHooks = globalThis.Hooks;
  t.after(() => { globalThis.Hooks = previousHooks; });
  globalThis.Hooks = { on: (event, handler) => hooks.set(event, handler) };
  registerCombatHooks({ itemUpgradeAutomationService: service });
  await hooks.get("updateItem")({ actor: actors[0] }, { "flags.rebreya-main.itemUpgrades": {} }, {});
  await hooks.get("updateItem")({ actor: actors[0] }, { "system.quantity": 2 }, {});
  assert.deepEqual(counts, { resets: 2, actorReads: 4, lightReads: 241 });

  authority = false;
  hooks.get("userConnected")();
  const takeoverMarker = { ...marker, actorUuid: actors[2].uuid };
  const takeoverId = createStableGearDocumentId(`weapon-mod-light:${takeoverMarker.actorUuid}:${takeoverMarker.hostItemId}:${takeoverMarker.childItemId}:${takeoverMarker.tokenUuid}`);
  scenes[0].lights.push({ id: takeoverId, getFlag() { counts.lightReads++; return takeoverMarker; }, async delete() {
    removed.push(["AmbientLight", takeoverId]); scenes[0].lights.pop();
  } });
  authority = true;
  await service.requestSync(actors[2]);
  await service.requestSync(actors[2]);
  assert.deepEqual(counts, { resets: 2, actorReads: 6, lightReads: 483 });
  assert.deepEqual(removed.at(-1), ["AmbientLight", takeoverId]);
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
