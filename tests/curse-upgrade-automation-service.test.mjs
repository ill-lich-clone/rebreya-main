import test from "node:test";
import assert from "node:assert/strict";
import { collectCurseUpgradeSources, buildCurseUpgradeEffect, CurseUpgradeAutomationService } from "../scripts/combat/curse-upgrade-automation-service.js";

const ns = "rebreya-main";
function fixture(key = "voli-k-zhizni") {
  const actor = { id: "actor", type: "character", flags: { [ns]: { heroDoll: { slots: { rightHand: { itemId: "host" } } } } },
    statuses: new Set(), system: { attributes: { hp: { value: 10, temp: 0 }, death: { failure: 0 } } }, effects: new Map(), items: new Map() };
  const host = { id: "host", uuid: "Actor.actor.Item.host", type: "weapon", actor, flags: { [ns]: { itemUpgrades: { installed: [{ itemId: "curse", slotIndex: 1 }] } } } };
  const upgrade = { id: "curse", uuid: "Actor.actor.Item.curse", name: "Проклятье", actor,
    flags: { [ns]: { gearId: `proklyat-e-${key}`, upgrade: { type: "Проклятье", effect: "Правильный текст" } } } };
  actor.items.set("host", host); actor.items.set("curse", upgrade);
  actor.createEmbeddedDocuments = async (kind, rows) => rows.map((row, i) => { const e = { ...structuredClone(row), id: `effect${i}`, toObject() { const { id, toObject, ...data } = this; return structuredClone(data); } }; actor.effects.set(e.id, e); return e; });
  actor.deleteEmbeddedDocuments = async (kind, ids) => { for (const id of ids) actor.effects.delete(id); };
  actor.updateEmbeddedDocuments = async (kind, rows) => { for (const row of rows) Object.assign(actor.effects.get(row._id), row); };
  return { actor, host, upgrade };
}

test("only installed curses on the hero doll activate and source identity is stable", () => {
  const { actor, upgrade } = fixture();
  assert.equal(collectCurseUpgradeSources(actor)[0].key, "will");
  upgrade.name = "renamed";
  assert.equal(collectCurseUpgradeSources(actor).length, 1);
  actor.flags[ns].heroDoll.slots = {};
  assert.equal(collectCurseUpgradeSources(actor).length, 0);
});

test("legacy profile fallback uses catalog id but respects a local non-curse type", () => {
  const { actor, upgrade } = fixture(); const id = upgrade.flags[ns].gearId;
  const catalog = new Map([[id, { upgrade: upgrade.flags[ns].upgrade }]]);
  delete upgrade.flags[ns].upgrade;
  assert.equal(collectCurseUpgradeSources(actor, catalog).length, 1);
  upgrade.flags[ns].upgrade = { type: "Материал" };
  assert.equal(collectCurseUpgradeSources(actor, catalog).length, 0);
});

test("will changes branch without modifying base AC and preserves source description", () => {
  const { actor } = fixture(); const source = collectCurseUpgradeSources(actor)[0];
  assert.equal(buildCurseUpgradeEffect(source, actor).changes[0].value, "-2");
  actor.statuses.add("rebreya-bloodied");
  const e = buildCurseUpgradeEffect(source, actor);
  assert.equal(e.changes[0].value, "2");
  assert.match(e.description, /Правильный текст/);
});

test("sync is idempotent, removes only owned curse effects and handles deleted host", async () => {
  const { actor } = fixture(); const service = new CurseUpgradeAutomationService({}, { isAuthority: () => true });
  actor.effects.set("foreign", { id: "foreign", flags: {}, changes: [] });
  await service.syncActor(actor); assert.equal(actor.effects.size, 2);
  let writes = 0; actor.updateEmbeddedDocuments = async () => { writes++; };
  await service.syncActor(actor); assert.equal(writes, 0);
  actor.items.delete("host"); await service.syncActor(actor);
  assert.deepEqual([...actor.effects.keys()], ["foreign"]);
});

test("life/death adds one failed death save only on positive HP to zero", () => {
  const { actor } = fixture("zhizni-i-smerti");
  const service = new CurseUpgradeAutomationService();
  const patch = { "system.attributes.hp.value": 0 };
  service.preUpdateActor(actor, patch, {});
  assert.equal(patch["system.attributes.death.failure"], 1);
  actor.system.attributes.hp.value = 0;
  const again = { "system.attributes.hp.value": 0 };
  service.preUpdateActor(actor, again, {});
  assert.equal(again["system.attributes.death.failure"], undefined);
});

test("lightning reaction is blocked in round one only, without consuming resource", () => {
  const { actor } = fixture("molnienosnoy-reaktsii");
  const service = new CurseUpgradeAutomationService();
  const combat = { started: true, round: 1, combatants: [{ actor }] };
  assert.equal(service.blocksReaction(actor, combat), true);
  combat.round = 2; assert.equal(service.blocksReaction(actor, combat), false);
});
