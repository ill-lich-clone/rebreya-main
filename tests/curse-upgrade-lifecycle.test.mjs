import test from "node:test";
import assert from "node:assert/strict";
import { CurseUpgradeAutomationService } from "../scripts/combat/curse-upgrade-automation-service.js";

const NS = "rebreya-main";
test("chain recovery preserves persisted expiry and does not restart an already applied event", async () => {
  const f = fixture("tsepey");
  const previousGame = globalThis.game;
  const previousFromUuid = globalThis.fromUuid;
  try {
    globalThis.game = { time: { worldTime: 10 } };
    globalThis.fromUuid = async () => f.actor;
    const source = f.service.sources(f.actor, "chains")[0];
    await f.service.writeState(source, { chainsPending: { targetActorUuid: f.actor.uuid, eventId: "recovery", expiresAt: 15 } });
    await f.service.restrain(f.actor, source);
    const effect = [...f.actor.effects.values()][0];
    effect.flags[NS].curseUpgrade.waitingForTurn = false;
    await f.service.recoverPendingChains(source);
    assert.equal(f.actor.effects.size, 1);
    assert.equal(effect.flags[NS].curseUpgrade.expiresAt, 15);
    assert.equal(effect.flags[NS].curseUpgrade.waitingForTurn, false);
    assert.equal(f.state().chainsPending, null);
    await f.service.writeState(source, { chainsPending: { targetActorUuid: f.actor.uuid, eventId: "expired", expiresAt: 9 } });
    await f.service.recoverPendingChains(source);
    assert.equal(f.actor.effects.size, 1);
    assert.equal(f.state().chainsPending, null);
  } finally { globalThis.game = previousGame; globalThis.fromUuid = previousFromUuid; }
});
function assign(document, patch) {
  for (const [key, value] of Object.entries(patch)) {
    const path = key.split(".");
    let cursor = document;
    while (path.length > 1) { const segment = path.shift(); cursor = cursor[segment] ??= {}; }
    cursor[path[0]] = structuredClone(value);
  }
}

function fixture(key = "tyazhesti-zhizni", id = "owner") {
  const actor = {
    id, uuid: `Actor.${id}`, items: new Map(), effects: new Map(), statuses: new Set(),
    flags: { [NS]: { heroDoll: { slots: { rightHand: { itemId: "host" } } } } },
    system: { attributes: { hp: { value: 10, temp: 0 }, prof: 3, movement: { walk: 30 }, death: { failure: 0 } }, abilities: { con: { mod: 2 } } }
  };
  const host = { id: "host", uuid: `${actor.uuid}.Item.host`, type: "weapon", actor,
    flags: { [NS]: { itemUpgrades: { installed: [{ itemId: "curse", slotIndex: 1 }] } } } };
  const upgrade = { id: "curse", uuid: `${actor.uuid}.Item.curse`, name: "Проклятье", actor,
    flags: { [NS]: { gearId: `proklyat-e-${key}`, upgrade: { type: "Проклятье", effect: "Описание" } } } };
  let effectId = 0;
  actor.update = async patch => assign(actor, patch);
  upgrade.update = async patch => assign(upgrade, patch);
  actor.createEmbeddedDocuments = async (_kind, rows) => rows.map(data => {
    const effect = { ...structuredClone(data), id: `effect-${++effectId}` };
    effect.toObject = () => { const { toObject, id, ...data } = effect; return structuredClone(data); };
    actor.effects.set(effect.id, effect);
    return effect;
  });
  actor.updateEmbeddedDocuments = async (_kind, rows) => rows.forEach(({ _id, ...patch }) => assign(actor.effects.get(_id), patch));
  actor.deleteEmbeddedDocuments = async (_kind, ids) => ids.forEach(id => actor.effects.delete(id));
  actor.items.set(host.id, host); actor.items.set(upgrade.id, upgrade);
  const service = new CurseUpgradeAutomationService({}, { isAuthority: () => true });
  const state = () => upgrade.flags[NS].curseUpgradeState ?? {};
  return { actor, host, upgrade, service, state };
}

test("initiative grants curse temporary HP once per actual initiative result, preserving larger foreign THP", async () => {
  const f = fixture();
  const combatant = { uuid: "Combat.c.Combatant.owner", initiative: 14 };
  await Promise.all([f.service.initiative(f.actor, [combatant]), f.service.initiative(f.actor, [combatant])]);
  assert.equal(f.actor.system.attributes.hp.temp, 5);
  assert.equal(f.state().burdenActive, true);
  f.actor.system.attributes.hp.temp = 0;
  await f.service.initiative(f.actor, [combatant]);
  assert.equal(f.actor.system.attributes.hp.temp, 0);
  const other = fixture();
  other.actor.system.attributes.hp.temp = 8;
  await other.service.initiative(other.actor, [combatant]);
  assert.equal(other.actor.system.attributes.hp.temp, 8);
  assert.equal(other.state().burdenActive, undefined);
});

test("burden movement penalty persists during damage and clears when other THP replace it", async () => {
  const f = fixture();
  await f.service.initiative(f.actor, [{ uuid: "Combat.c.Combatant.owner", initiative: 14 }]);
  for (const amount of [3, 9]) {
    const options = {};
    const changed = { "system.attributes.hp.temp": amount };
    if (amount === 3) f.service.preApplyDamage(f.actor, 2, changed, options);
    f.service.preUpdateActor(f.actor, changed, options);
    await f.actor.update(changed);
    await f.service.actorUpdated(f.actor, changed, options);
    assert.equal(f.state().burdenActive, amount === 3);
  }
});

test("burden cannot revive old temporary-HP provenance after unequip and replacement", async () => {
  const f = fixture();
  await f.service.initiative(f.actor, [{ uuid: "Combat.c.Combatant.owner", initiative: 14 }]);
  f.actor.flags[NS].heroDoll.slots = {};
  const changed = { "system.attributes.hp.temp": 9 };
  const options = {};
  f.service.preUpdateActor(f.actor, changed, options);
  await f.actor.update(changed);
  await f.service.actorUpdated(f.actor, changed, options);
  f.actor.flags[NS].heroDoll.slots = { rightHand: { itemId: "host" } };
  await f.service.syncActor(f.actor);
  assert.equal(f.state().burdenActive, false);
  assert.equal([...f.actor.effects.values()].flatMap(e => e.changes).some(c => c.key === "system.attributes.movement.walk"), false);
});

test("life/death zero-HP transition preserves an existing failure and does not retrigger at zero", () => {
  const f = fixture("zhizni-i-smerti");
  f.actor.system.attributes.death.failure = 1;
  const changed = { system: { attributes: { hp: { value: 0 } } } };
  f.service.preUpdateActor(f.actor, changed, {});
  assert.equal(changed["system.attributes.death.failure"], 2);
  f.actor.system.attributes.hp.value = 0;
  const again = { "system.attributes.hp.value": 0 };
  f.service.preUpdateActor(f.actor, again, {});
  assert.equal(again["system.attributes.death.failure"], undefined);
});

function combatFor(owner, other) {
  const combatants = [{ actor: owner }, { actor: other }];
  return { id: "combat", started: true, round: 1, turn: 0, combatants, turns: combatants, combatant: combatants[0] };
}

test("chains survive current turn and expire at the end of target's next turn", async () => {
  const f = fixture("tsepey");
  const other = fixture("tsepey", "other").actor;
  const combat = combatFor(f.actor, other);
  const previousGame = globalThis.game;
  globalThis.game = { combat, time: { worldTime: 0 } };
  try {
    await f.service.restrain(f.actor, f.service.sources(f.actor, "chains")[0]);
    const countChains = () => [...f.actor.effects.values()].filter(e => e.flags[NS]?.curseUpgrade?.kind === "chains").length;
    assert.equal(countChains(), 1);
    for (const [round, turn, expected] of [[1, 1, 1], [2, 0, 1], [2, 1, 0]]) {
      const previous = { round: combat.round, turn: combat.turn };
      Object.assign(combat, { round, turn, combatant: combat.combatants[turn] });
      await f.service.combatChanged(combat, previous, { round, turn });
      assert.equal(countChains(), expected);
    }
  } finally { globalThis.game = previousGame; }
});

test("obsidian end-of-turn notification is idempotent and penalty clears on own next turn", async () => {
  const f = fixture("obsidiana");
  const other = fixture("tsepey", "other").actor;
  const combat = combatFor(f.actor, other);
  combat.turn = 1; combat.combatant = combat.combatants[1];
  let prompts = 0;
  f.service.prompt = async () => { prompts++; return false; };
  await f.service.combatChanged(combat, { round: 1, turn: 0 }, { round: 1, turn: 1 });
  await f.service.combatChanged(combat, { round: 1, turn: 0 }, { round: 1, turn: 1 });
  assert.equal(prompts, 1);
  assert.equal(f.state().ac, -1);
  combat.round = 2; combat.turn = 0; combat.combatant = combat.combatants[0];
  await f.service.combatChanged(combat, { round: 1, turn: 1 }, { round: 2, turn: 0 });
  assert.equal(f.state().ac, 0);
});

test("obsidian concurrent duplicate turn notifications prompt only once", async () => {
  const f = fixture("obsidiana");
  const other = fixture("tsepey", "other").actor;
  const combat = combatFor(f.actor, other);
  combat.turn = 1; combat.combatant = combat.combatants[1];
  let prompts = 0;
  f.service.prompt = async () => { prompts++; await Promise.resolve(); return false; };
  await Promise.all([1, 2].map(() => f.service.combatChanged(combat, { round: 1, turn: 0 }, { round: 1, turn: 1 })));
  assert.equal(prompts, 1);
});

test("native roll wrapper awaits save resolution and registers once", async () => {
  const f = fixture();
  const calls = [];
  class RollClass {
    static async buildPost() { calls.push(this === RollClass ? "post" : "wrong receiver"); return "message"; }
  }
  const previousConfig = globalThis.CONFIG;
  const previousWrapper = globalThis.libWrapper;
  globalThis.CONFIG = { Dice: { D20Roll: RollClass } };
  globalThis.libWrapper = undefined;
  f.service.saves.applyNativeBuildPost = async () => { await Promise.resolve(); calls.push("resolve"); };
  try {
    f.service.registerNativeSaveWrapper();
    f.service.registerNativeSaveWrapper();
    assert.equal(await RollClass.buildPost([], {}, {}), "message");
    assert.deepEqual(calls, ["resolve", "post"]);
  } finally { globalThis.CONFIG = previousConfig; globalThis.libWrapper = previousWrapper; }
});

test("curse owner prompt routes only to active player owners before GM fallback", async () => {
  const f = fixture();
  const previousGame = globalThis.game;
  globalThis.game = { users: [{ id: "owner", active: true }, { id: "offline", active: false }, { id: "other", active: true }, { id: "gm", isGM: true, active: true }] };
  f.actor.testUserPermission = user => ["owner", "offline", "gm"].includes(user.id);
  let candidate;
  f.service.moduleApi.reactionQueueService = { promptDecision: async input => { candidate = input.candidate; return { accepted: true }; } };
  try {
    assert.equal(await f.service.prompt(f.service.sources(f.actor)[0], { title: "test", body: "test" }), true);
    assert.deepEqual(candidate.ownerUserIds, ["owner"]);
    assert.equal(candidate.actorUuid, f.actor.uuid);
  } finally { globalThis.game = previousGame; }
});

test("embedded document options mutated by Foundry never leak parent into actor or item writes", async () => {
  const f = fixture();
  const originalCreate = f.actor.createEmbeddedDocuments;
  f.actor.createEmbeddedDocuments = async (kind, rows, options) => {
    options.parent = f.actor;
    return originalCreate(kind, rows, options);
  };
  const actorOptions = [];
  const itemOptions = [];
  f.actor.update = async (patch, options) => {
    actorOptions.push(options);
    assert.equal(Object.hasOwn(options, "parent"), false);
    assign(f.actor, patch);
  };
  f.upgrade.update = async (patch, options) => {
    itemOptions.push(options);
    assert.equal(Object.hasOwn(options, "parent"), false);
    assign(f.upgrade, patch);
  };
  await f.service.syncActor(f.actor);
  await f.service.initiative(f.actor, [{ uuid: "Combat.c.Combatant.owner", initiative: 14 }]);
  assert.equal(actorOptions.length, 1);
  assert.equal(itemOptions.length, 1);
  assert.notEqual(actorOptions[0], itemOptions[0]);
  assert.equal(f.actor.system.attributes.hp.temp, 5);
});

test("blood self-damage and actor receipt commit together, preventing replay after source flag write failure", async () => {
  const f = fixture("krovopuskaniya");
  const source = f.service.sources(f.actor, "blood")[0];
  const atomicUpdates = [];
  let damageCalls = 0;
  f.actor.applyDamage = async (damages, options) => {
    damageCalls++;
    const amount = damages.reduce((total, part) => total + part.value, 0);
    const patch = { "system.attributes.hp.value": f.actor.system.attributes.hp.value - amount };
    f.service.preApplyDamage(f.actor, amount, patch, options);
    atomicUpdates.push(structuredClone(patch));
    await f.actor.update(patch);
  };
  f.upgrade.update = async () => { throw new Error("source write failed"); };
  const request = { eventId: "first-hit", turn: "combat:1:0", amount: 2 };
  await assert.rejects(f.service.applyBloodDamage(source, request), /source write failed/);
  assert.equal(f.actor.system.attributes.hp.value, 8);
  assert.equal(atomicUpdates[0][`flags.${NS}.curseBloodReceipts.curse`].eventId, "first-hit");
  assert.equal(atomicUpdates[0]["system.attributes.hp.value"], 8);
  assert.equal(f.state().bloodEvent, undefined);

  const replacement = new CurseUpgradeAutomationService({}, { isAuthority: () => true });
  await replacement.applyBloodDamage(source, request);
  await replacement.applyBloodDamage(source, { ...request, eventId: "second-hit" });
  assert.equal(damageCalls, 1);
  assert.equal(f.actor.system.attributes.hp.value, 8);

  f.upgrade.update = async patch => assign(f.upgrade, patch);
  await replacement.applyBloodDamage(source, { ...request, eventId: "third-hit", turn: "combat:1:1" });
  assert.equal(damageCalls, 2);
  assert.equal(f.actor.system.attributes.hp.value, 6);
  assert.equal(f.state().bloodEvent, "third-hit");
});
