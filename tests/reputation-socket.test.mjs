import test from "node:test";
import assert from "node:assert/strict";
import { isValidReputationPayload, authorizeReputationUpdate, reputationTransportId } from "../scripts/infrastructure/foundry/reputation-command-contract.js";
import { ReputationService } from "../scripts/application/reputation-service.js";
import { PrivilegedMutationGateway } from "../scripts/application/privileged-mutation-gateway.js";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { SocketCommandBus } from "../scripts/infrastructure/foundry/socket-command-bus.js";
import { getActiveGm, isActiveGmClient } from "../scripts/infrastructure/foundry/active-gm.js";
const payload = { actorUuid: "Actor.abcdefghijklmnop", expectedRevision: 0, operationId: "o1", change: { set: { fame: 1, infamy: 2 } }, reason: "Причина" };
test("exact socket payload rejects extra fields and token actors", () => {
  assert.equal(isValidReputationPayload(payload), true);
  for (const patch of [{ senderId: "gm" }, { itemData: {} }, { actorUuid: "Scene.a.Token.b.Actor.c" }, { change: { set: { fame: 1, infamy: 2, extra: 1 } } }]) assert.equal(isValidReputationPayload({ ...payload, ...patch }), false);
});
test("only authenticated GM User can authorize", () => {
  const gm = { id: "gm", isGM: true }, player = { id: "p", isGM: false };
  const game = { users: new Map([[gm.id, gm], [player.id, player]]) };
  assert.equal(authorizeReputationUpdate(payload, { sender: gm, game }), true);
  for (const sender of [player, { id: "unknown", isGM: true }, { ...gm }, null]) assert.equal(authorizeReputationUpdate(payload, { sender, game }), false);
});
test("transport cache cannot hide altered operation payload; exact retry uses same ID", async () => {
  const a = await reputationTransportId(payload, "gm");
  assert.equal(await reputationTransportId(structuredClone(payload), "gm"), a);
  assert.notEqual(await reputationTransportId({ ...payload, reason: "altered" }, "gm"), a);
  assert.notEqual(await reputationTransportId({ ...payload, actorUuid: "Actor.ponmlkjihgfedcba" }, "gm"), a);
});

test("real gateway routes both GMs to one executor, preserves conflict and denies player/no GM", async () => {
  const users = [{ id: "gm-a", isGM: true, active: true }, { id: "gm-b", isGM: true, active: true }, { id: "p", isGM: false, active: true }];
  const clients = [];
  const actor = { uuid: payload.actorUuid, type: "character", writes: 0, flag: null, getFlag() { return this.flag; },
    async update(patch) { this.writes++; this.flag = structuredClone(patch["flags.rebreya-main.reputation"]); } };
  for (const user of users) {
    const map = new Map(users.map(u => [u.id, u])); map.contents = users; map.activeGM = users[0];
    const game = { user, users: map, socket: { emit(_channel, message) { for (const c of clients) void c.bus.handleMessage(message, { transportSenderId: user.id }); } } };
    const coordinator = new WorldMutationCoordinator();
    const bus = new SocketCommandBus({ coordinator, gameProvider: () => game });
    const gateway = new PrivilegedMutationGateway({ commandBus: bus, coordinator, gameProvider: () => game, getActiveGm, isActiveGmClient, operationIdFactory: () => "test" });
    const service = new ReputationService({ resolveActor: async () => actor, coordinator, mutationGateway: gateway, gameProvider: () => game });
    gateway.registerCommand("reputation.update", { validate: isValidReputationPayload,
      authorize: (p, { sender }) => authorizeReputationUpdate(p, { sender, game }), execute: (p, ctx) => service.update(p, ctx) });
    clients.push({ game, bus, service });
  }
  assert.equal((await clients[0].service.requestUpdate(payload)).fame, 1);
  await clients[0].service.requestUpdate(payload); assert.equal(actor.writes, 1);
  await assert.rejects(clients[0].service.requestUpdate({ ...payload, reason: "altered" }), e => e.code === "operation-conflict");
  const next = { ...payload, expectedRevision: 1, operationId: "o2", change: { delta: { fame: 3, infamy: 0 } } };
  assert.equal((await clients[1].service.requestUpdate(next)).fame, 4); assert.equal(actor.writes, 2);
  await assert.rejects(clients[2].service.requestUpdate({ ...next, operationId: "p" }), e => e.code === "unauthorized");
  for (const c of clients) { c.game.users.activeGM = null; for (const u of c.game.users.values()) u.active = false; }
  await assert.rejects(clients[1].service.requestUpdate({ ...next, operationId: "absent" }), e => e.code === "active-gm-unavailable");
  assert.equal(actor.writes, 2);
});
