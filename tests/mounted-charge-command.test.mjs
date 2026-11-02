import test from "node:test";
import assert from "node:assert/strict";
import { isValidMountedToggle, registerMountedToggleCommand } from "../scripts/infrastructure/foundry/mounted-charge-command.js";
import { CombatAttackService } from "../scripts/combat/attack-service.js";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";

function fixture() {
  const gm = { id: "gm", isGM: true, active: true }, player = { id: "owner", isGM: false };
  globalThis.game = { user: gm, users: { activeGM: gm } };
  const scene = { id: "scene", tokens: new Map() };
  const actor = { testUserPermission: user => user.id === "owner" };
  const rider = { id: "rider", uuid: "Scene.scene.Token.rider", parent: scene, actor, flags: { "rebreya-main": {} },
    async update(patch) { const f = this.flags["rebreya-main"]; if (Object.hasOwn(patch, "flags.rebreya-main.mountedOn")) f.mountedOn = patch["flags.rebreya-main.mountedOn"]; if (Object.hasOwn(patch, "flags.rebreya-main.-=mountedOn")) delete f.mountedOn; f.mountedOperations = patch["flags.rebreya-main.mountedOperations"]; } };
  const mount = { id: "mount", uuid: "Scene.scene.Token.mount", parent: scene, actor: {} };
  scene.tokens.set(rider.id, rider); scene.tokens.set(mount.id, mount);
  globalThis.fromUuid = async uuid => scene.tokens.get(uuid.split(".").at(-1));
  const service = new CombatAttackService({ worldMutationCoordinator: new WorldMutationCoordinator() });
  const payload = { operationId: "mount-1", riderTokenUuid: rider.uuid, mountTokenUuid: mount.uuid, action: "mount" };
  return { rider, mount, scene, player, gm, service, payload };
}

test("mounted toggle validates exact UUIDs and action, no extra fields", () => {
  const { payload } = fixture();
  assert.equal(isValidMountedToggle(payload), true);
  assert.equal(isValidMountedToggle({ ...payload, action: "other" }), false);
  assert.equal(isValidMountedToggle({ ...payload, flag: "forged" }), false);
  assert.equal(isValidMountedToggle({ ...payload, mountTokenUuid: payload.riderTokenUuid }), false);
});

test("owner mounts and dismounts one live token without duplicate toggles", async () => {
  const { rider, player, service, payload } = fixture();
  await service.toggleMounted(payload, { sender: player });
  await service.toggleMounted(payload, { sender: player });
  assert.equal(rider.flags["rebreya-main"].mountedOn, payload.mountTokenUuid);
  await service.toggleMounted({ ...payload, operationId: "dismount-1", action: "dismount" }, { sender: player });
  assert.equal(rider.flags["rebreya-main"].mountedOn, undefined);
  await service.toggleMounted(payload, { sender: player });
  assert.equal(rider.flags["rebreya-main"].mountedOn, undefined, "late retry must not remount");
});

test("mounting refuses a foreign rider, missing mount or stale link", async () => {
  const { scene, rider, player, service, payload } = fixture();
  await assert.rejects(service.toggleMounted(payload, { sender: { id: "stranger" } }), /прав|влад/u);
  scene.tokens.delete("mount");
  await assert.rejects(service.toggleMounted(payload, { sender: player }), /скакун|токен/u);
  assert.equal(rider.flags["rebreya-main"].mountedOn, undefined);
});

test("mounted socket validates and authorizes the owner before applying", async () => {
  const { rider, player, service, payload } = fixture(); const commands = new Map();
  registerMountedToggleCommand({ register(name, descriptor) { commands.set(name, descriptor); } }, service);
  const command = commands.get("combat.mounted.toggle");
  assert.equal(command.validate(payload), true);
  assert.equal(await command.authorize(payload, { sender: player }), true);
  assert.equal(await command.authorize(payload, { sender: { id: "stranger" } }), false);
  await command.execute(payload, { sender: player });
  assert.equal(rider.flags["rebreya-main"].mountedOn, payload.mountTokenUuid);
});

test("lost acknowledgement never toggles the rider twice", async () => {
  const { rider, player, service, payload } = fixture(), update = rider.update.bind(rider); let first = true;
  rider.update = async patch => { const result = await update(patch); if (first) { first = false; throw new Error("lost response"); } return result; };
  await assert.rejects(service.toggleMounted(payload, { sender: player }), /lost response/u);
  assert.equal((await service.toggleMounted(payload, { sender: player })).replayed, true);
  assert.equal(rider.flags["rebreya-main"].mountedOn, payload.mountTokenUuid);
});

test("mounting stops if ownership changes while resolving the mount", async () => {
  const { rider, mount, player, service, payload } = fixture(), previous = globalThis.fromUuid;
  globalThis.fromUuid = async uuid => { if (uuid === mount.uuid) rider.actor.testUserPermission = () => false; return previous(uuid); };
  try {
    await assert.rejects(service.toggleMounted(payload, { sender: player }), /прав|влад|измен/u);
    assert.equal(rider.flags["rebreya-main"].mountedOn, undefined);
  } finally { globalThis.fromUuid = previous; }
});

test("charge movement recording stays local and is keyed by the current combat turn", () => {
  const { rider, service } = fixture();
  rider.actor.items = [{ type: "weapon", system: { properties: new Set(["lchDash"]) } }];
  rider.movement = { id: "movement-1" };
  rider.movementHistory = [{ movementId: "old" }, { movementId: "movement-1" }];
  game.combat = { id: "combat", round: 1, turn: 0, started: true };
  service.noteChargeMovement(rider, { x: 100 });
  assert.deepEqual(service.chargeMovementRecords.get(rider.uuid), { combatId: "combat", round: 1, turn: 0, firstMovementId: "movement-1" });
  game.combat.turn = 1; rider.movement = { id: "movement-2" };
  service.noteChargeMovement(rider, { x: 200 });
  assert.equal(service.chargeMovementRecords.get(rider.uuid).firstMovementId, "movement-2");
  assert.equal(rider.flags["rebreya-main"].mountedOn, undefined);
});
