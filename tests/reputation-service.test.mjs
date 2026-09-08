import test from "node:test";
import assert from "node:assert/strict";
import { ReputationService } from "../scripts/application/reputation-service.js";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
const gm = { id: "gm", isGM: true }, player = { id: "p", isGM: false };
export function fixture() {
  const coordinator = new WorldMutationCoordinator();
  const actor = { uuid: "Actor.abcdefghijklmnop", type: "character", name: "A", flag: undefined, writes: 0,
    getFlag() { return this.flag; }, testUserPermission: user => user.id === "p",
    async update(patch) { this.writes++; if (this.failBefore) throw new Error("network"); this.flag = structuredClone(patch["flags.rebreya-main.reputation"]); if (this.failAfter) throw new Error("network"); } };
  const game = { user: gm, users: new Map([[gm.id, gm], [player.id, player]]) };
  const refreshes = [];
  const service = new ReputationService({ resolveActor: async uuid => uuid === actor.uuid ? actor : null,
    coordinator, mutationGateway: { commit: (key, operation) => coordinator.run(key, () => operation({ assertActiveGm() {} })) },
    gameProvider: () => game, refresh: uuid => refreshes.push(uuid), timestamp: () => 100 });
  const request = { actorUuid: actor.uuid, expectedRevision: 0, operationId: "o1", change: { delta: { fame: 2, infamy: 3 } }, reason: "Причина" };
  return { service, actor, request, game, refreshes, context: { sender: gm, assertActiveGm() {} } };
}
test("reads are detached, permission checked and never write", async () => {
  const f = fixture(); assert.equal((await f.service.read(f.actor.uuid)).fame, 0); assert.equal(f.actor.writes, 0);
  f.game.user = player; assert.equal((await f.service.read(f.actor.uuid)).infamy, 0);
  f.actor.testUserPermission = () => false;
  await assert.rejects(f.service.read(f.actor.uuid), e => e.code === "unauthorized");
});
test("one atomic flag update; fresh concurrent revisions; replay does not write", async () => {
  const f = fixture();
  const secondGm = { id: "gm-b", isGM: true }; f.game.users.set(secondGm.id, secondGm);
  const outcomes = await Promise.allSettled([f.service.update(f.request, f.context), f.service.update({ ...f.request, operationId: "o2" }, { ...f.context, sender: secondGm })]);
  assert.equal(outcomes[0].status, "fulfilled"); assert.equal(outcomes[1].reason.code, "stale-revision");
  await f.service.update(f.request, f.context);
  assert.equal(f.actor.writes, 1); assert.equal(f.actor.flag.fame, 2); assert.equal(f.actor.flag.infamy, 3);
  assert.ok(f.refreshes.every(uuid => uuid === f.actor.uuid));
});
test("throw after write recovers receipt; missing receipt is ambiguous without retry", async () => {
  const f = fixture(); f.actor.failAfter = true;
  assert.equal((await f.service.update(f.request, f.context)).fame, 2); assert.equal(f.actor.writes, 1);
  const g = fixture(); g.actor.failBefore = true;
  await assert.rejects(g.service.update(g.request, g.context), e => e.code === "ambiguous-outcome"); assert.equal(g.actor.writes, 1);
});
test("player, forged GM, noncharacter and authority loss cannot write", async () => {
  for (const sender of [player, { id: "unknown", isGM: true }, { ...gm }]) {
    const f = fixture(); await assert.rejects(f.service.update(f.request, { ...f.context, sender }), e => e.code === "unauthorized"); assert.equal(f.actor.writes, 0);
  }
  const f = fixture(); f.actor.type = "npc";
  await assert.rejects(f.service.update(f.request, f.context), e => e.code === "invalid-actor"); assert.equal(f.actor.writes, 0);
  const g = fixture(); await assert.rejects(g.service.update(g.request, { ...g.context, assertActiveGm() { throw new Error("lost"); } }), /lost/); assert.equal(g.actor.writes, 0);
});

test("long bounded history remains on Actor; socket outcome stays small", async () => {
  const f = fixture(); let result;
  for (let i = 0; i < 51; i++) result = await f.service.update({ ...f.request, expectedRevision: i, operationId: `o${i}`, reason: "🙂".repeat(120) }, f.context);
  assert.equal(f.actor.flag.recentChanges.length, 50);
  assert.equal(result.revision, 51); assert.ok(JSON.stringify(result).length < 200);
  assert.equal(result.recentChanges, undefined);
});
