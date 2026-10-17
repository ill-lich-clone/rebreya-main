import test from "node:test";
import assert from "node:assert/strict";
import { EquipmentSizeService } from "../scripts/application/equipment-size-service.js";
import { buildEquipmentSizeUpdate, getHeldEquipmentWeapons, readEquipmentItemData } from "../scripts/integrations/equipment-size.js";
import { makeEquipment, applyUpdate } from "./helpers/equipment-size-fixture.mjs";

function fixture() {
  const sword = makeEquipment({ flags: { heldHands: ["left", "right"] }, system: { equipped: true } });
  const spare = makeEquipment({ id: "spare", system: { equipped: true } });
  const user = { id: "owner", active: true, isGM: false };
  const actor = { uuid: "Actor.hero", system: { traits: { size: "med" }, attributes: { hp: { value: 20 } } },
    prototypeToken: { width: 1.4, height: 1.2 }, flags: {}, items: new Map([[sword.id, sword], [spare.id, spare]]),
    isOwner: true, writes: [], testUserPermission: () => true,
    async update(patch) { this.writes.push(patch); applyUpdate(this, patch); },
    async updateEmbeddedDocuments(type, patches, options) { this.batches = (this.batches ?? 0) + 1; for (const patch of patches) await this.items.get(patch._id).update(patch, options); }
  };
  const token = { uuid: "Scene.scene.Token.hero", actor, parent: { grid: { size: 100 } },
    x: 100, y: 200, width: 1, height: 1, isOwner: true, testUserPermission: () => true, writes: [],
    async update(patch) { this.writes.push(patch); applyUpdate(this, patch); } };
  const game = { user, users: [user] };
  const api = {};
  const service = new EquipmentSizeService(api, { buildItemUpdate: buildEquipmentSizeUpdate, getHeldWeapons: getHeldEquipmentWeapons,
    readItemData: readEquipmentItemData, gameProvider: () => game, resolveUuid: async id => id === token.uuid ? token : id === actor.uuid ? actor : null });
  const payload = () => { const p = service.getCreatureResizePreview(token, "lg"); return { actorUuid: p.actorUuid, tokenUuid: p.tokenUuid, size: p.size, expected: p.expected, weaponIds: [sword.id] }; };
  return { service, api, actor, token, sword, spare, game, payload };
}

test("preview deduplicates actual held weapons; coordinated resize preserves center, quantity and prototype roundtrip", async () => {
  const f = fixture(), p = f.payload();
  assert.deepEqual(f.service.getCreatureResizePreview(f.token, "lg").weaponRows.map(w => w.id), [f.sword.id]);
  assert.equal(f.actor.writes.length, 0);
  await f.service.requestCreatureResize(p);
  assert.equal(f.actor.system.traits.size, "lg");
  assert.deepEqual([f.token.x, f.token.y, f.token.width, f.token.height], [50, 150, 2, 2]);
  assert.equal(f.sword.system.damage.base.denomination, 10);
  assert.equal(f.sword.system.quantity, 3);
  assert.equal(f.spare.updates.length, 0);
  assert.equal(f.actor.batches, 1);
  const preview = f.service.getCreatureResizePreview(f.token, "lg");
  await f.service.requestCreatureResize({ ...p, expected: preview.expected });
  assert.equal(f.actor.writes.length, 1);
  assert.equal(f.token.writes.length, 1);
  assert.equal(f.actor.batches, 1);
});

test("stale geometry, weapon, held state, deleted token, permission and effect override fail before writes", async () => {
  for (const change of [f => f.token.x++, f => f.actor.system.traits.size = "sm", f => f.sword.system.quantity++,
    f => f.sword.flags["rebreya-main"].heldHands = [], f => f.token.uuid = "deleted",
    f => f.actor.testUserPermission = () => false, f => f.token.testUserPermission = () => false,
    f => f.actor.overrides = { system: { traits: { size: "huge" } } }]) {
    const f = fixture(), p = f.payload(); change(f);
    await assert.rejects(() => f.service.requestCreatureResize(p));
    assert.equal(f.actor.writes.length, 0);
    assert.equal(f.token.writes.length, 0);
    assert.equal(f.sword.updates.length, 0);
  }
});

test("Actor, Token, partially applied Item batch errors restore owned fields including native prototype dimensions", async () => {
  for (const stage of ["actor", "token", "items"]) {
    const f = fixture(), p = f.payload();
    if (stage === "actor") { const update = f.actor.update; let first = true; f.actor.update = async patch => { await update.call(f.actor, patch); if (first) { first = false; throw Error("actor fail"); } }; }
    if (stage === "token") { const update = f.token.update; let first = true; f.token.update = async patch => { await update.call(f.token, patch); if (first) { first = false; throw Error("token fail"); } }; }
    if (stage === "items") { let first = true; f.actor.updateEmbeddedDocuments = async (_, patches, options) => { for (const patch of patches) await f.sword.update(patch, options); if (first) { first = false; f.sword.system.quantity = 7; f.actor.system.attributes.hp.value = 18; throw Error("item fail"); } }; }
    await assert.rejects(() => f.service.requestCreatureResize(p), /fail/);
    assert.equal(f.actor.system.traits.size, "med");
    assert.deepEqual(f.actor.prototypeToken, { width: 1.4, height: 1.2 });
    assert.deepEqual([f.token.x, f.token.y, f.token.width, f.token.height], [100, 200, 1, 1]);
    assert.equal(f.sword.system.damage.base.denomination, 8);
    assert.equal(f.sword.flags["rebreya-main"].equipmentSize, undefined);
    if (stage === "items") { assert.equal(f.sword.system.quantity, 7); assert.equal(f.actor.system.attributes.hp.value, 18); }
  }
});

test("rollback does not overwrite subsequent owned-field edits and reports partial restoration", async () => {
  const f = fixture();
  f.actor.updateEmbeddedDocuments = async () => { f.token.width = 4; throw Error("item fail"); };
  await assert.rejects(() => f.service.requestCreatureResize(f.payload()), error => error.code === "resize-failed" && error.unrestored.includes(f.token.uuid));
  assert.equal(f.token.width, 4);
  assert.equal(f.actor.system.traits.size, "med");
});

test("active GM gateway receives strict intent; no-GM owner path validates both documents", async () => {
  const f = fixture(), p = f.payload(), calls = [];
  f.game.users.push({ id: "gm", active: true, isGM: true });
  f.api.privilegedMutationGateway = { mutate: async (...args) => calls.push(args) };
  await f.service.requestCreatureResize(p);
  assert.equal(calls[0][0], "equipment.resize-creature");
  assert.deepEqual(calls[0][1], p);
  assert.equal(f.actor.writes.length, 0);
});

test("synthetic Actor is the resize target; assigned active owner wins deterministic prompt routing", async () => {
  const f = fixture(), base = { system: { traits: { size: "med" } } };
  f.actor.uuid = `${f.token.uuid}.Actor.hero`;
  f.actor.baseActor = base;
  f.game.users.push({ id: "z-assigned", active: true, character: f.actor }, { id: "a-owner", active: true }, { id: "offline", active: false });
  assert.deepEqual(f.service.getResizePromptOwnerIds(f.actor), ["z-assigned", "owner", "a-owner"]);
  await f.service.requestCreatureResize(f.payload());
  assert.equal(f.actor.system.traits.size, "lg"); assert.equal(base.system.traits.size, "med");
});

test("Token permission uses native canUserModify rather than Scene-inherited ownership", async () => {
  const f = fixture();
  f.token.testUserPermission = () => false;
  f.token.canUserModify = (user, action) => user.id === "owner" && action === "update";
  await f.service.requestCreatureResize(f.payload());
  assert.equal(f.actor.system.traits.size, "lg");
});

test("trusted Rune path revalidates live Token and current writer permissions", async () => {
  for (const change of [f => f.token.testUserPermission = () => false, f => f.actor.testUserPermission = () => false,
    f => f.token.actor = { uuid: "Actor.other" }]) {
    const f = fixture(); change(f);
    await assert.rejects(() => f.service.applyPreparedCreatureResize({ actor: f.actor, token: f.token, size: "lg", weaponIds: [f.sword.id] }));
    assert.equal(f.actor.writes.length, 0);
  }
});

test("weapon consent rejects stale held weapons and decline; native Token changes never prompt", async () => {
  const f = fixture(); let prompts = 0;
  f.api.reactionQueueService = { promptDecision: async context => { prompts++; assert.deepEqual(context.candidate.ownerUserIds, ["owner"]); return { accepted: false }; } };
  await f.token.update({ width: 2 });
  assert.equal(prompts, 0);
  assert.deepEqual(await f.service.chooseHeldWeaponResize(f.actor, f.token, "lg"), []);
  f.api.reactionQueueService.promptDecision = async () => { f.sword.flags["rebreya-main"].heldHands = []; return { accepted: true }; };
  assert.deepEqual(await f.service.chooseHeldWeaponResize(f.actor, f.token, "lg"), []);
});

test("partial two-weapon Item batch restores only its applied Item; rollback failures are explicit", async () => {
  const f = fixture(); f.spare.flags["rebreya-main"].heldHands = ["right"]; f.sword.flags["rebreya-main"].heldHands = ["left"];
  const p = f.payload(); p.weaponIds.push(f.spare.id);
  f.actor.updateEmbeddedDocuments = async (_, patches, options) => { await f.sword.update(patches[0], options); throw Error("second item failed"); };
  await assert.rejects(() => f.service.requestCreatureResize(p));
  assert.equal(f.sword.system.damage.base.denomination, 8); assert.equal(f.spare.updates.length, 0);
  const g = fixture(); let tokenWrites = 0;
  g.token.update = async patch => { tokenWrites++; if (tokenWrites > 1) throw Error("rollback unavailable"); applyUpdate(g.token, patch); };
  g.actor.updateEmbeddedDocuments = async () => { throw Error("batch failed"); };
  await assert.rejects(() => g.service.requestCreatureResize(g.payload()), error => error.unrestored.includes(g.token.uuid));
});

test("GM execution rejects a remote owner's consent after that owner's rights are revoked", async () => {
  const f = fixture(), owner = f.game.user;
  const gm = { id: "gm", isGM: true, active: true }; f.game.user = gm; f.game.users.push(gm);
  f.actor.testUserPermission = user => user.id === owner.id;
  f.api.reactionQueueService = { promptDecision: async context => {
    assert.equal(context.forUserId, owner.id);
    f.actor.testUserPermission = () => false;
    return { accepted: true };
  } };
  await assert.rejects(() => f.service.chooseHeldWeaponResize(f.actor, f.token, "lg"), /утратил права/);
  assert.equal(f.actor.writes.length, 0); assert.equal(f.token.writes.length, 0);
});
