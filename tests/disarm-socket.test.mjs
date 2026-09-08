import test from "node:test";
import assert from "node:assert/strict";
import { isValidDisarmPayload, authorizeDisarmSender } from "../scripts/infrastructure/foundry/disarm-command-contract.js";
import { PrivilegedMutationGateway } from "../scripts/application/privileged-mutation-gateway.js";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";
import { SocketCommandBus } from "../scripts/infrastructure/foundry/socket-command-bus.js";
import { getActiveGm, isActiveGmClient } from "../scripts/infrastructure/foundry/active-gm.js";
const base={operationId:"one",sourceTokenUuid:"Scene.abcdefghijklmnop.Token.ponmlkjihgfedcba",targetTokenUuid:"Scene.abcdefghijklmnop.Token.abcdefghijklmnop",weaponItemUuid:"Actor.abcdefghijklmnop.Item.ponmlkjihgfedcba",targetItemUuid:"Scene.abcdefghijklmnop.Token.abcdefghijklmnop.Actor.abcdefghijklmnop.Item.ponmlkjihgfedcba",weaponMode:"melee"};
test("bounded exact disarm commands never accept client totals, formulas or capability",()=>{
  assert.equal(isValidDisarmPayload("start",base),true);
  for(const extra of [{total:20},{formula:"100"},{senderId:"gm"},{capability:{}},{weaponMode:"any"}])assert.equal(isValidDisarmPayload("start",{...base,...extra}),false);
  assert.equal(isValidDisarmPayload("resolve-save",{operationId:"one",saveAbility:"dex"}),true);
  assert.equal(isValidDisarmPayload("resolve-save",{operationId:"one",saveAbility:"wis"}),false);
  assert.equal(isValidDisarmPayload("set-baseline",{operationId:"one",abilityScore:16,proficiencyContribution:3,reason:"Постоянная характеристика"}),true);
  assert.equal(isValidDisarmPayload("resume",{operationId:""}),false);
});
test("sender must be authenticated; baseline requires GM, ownership belongs to live service",()=>{
  const gm={id:"gm",isGM:true},p={id:"p",isGM:false};const game={users:new Map([[gm.id,gm],[p.id,p]])};
  assert.equal(authorizeDisarmSender("start",{sender:p,game}),true);
  assert.equal(authorizeDisarmSender("set-baseline",{sender:p,game}),false);
  assert.equal(authorizeDisarmSender("set-baseline",{sender:gm,game}),true);
  assert.equal(authorizeDisarmSender("start",{sender:{...gm},game}),false);
});

test("real gateway forwards disarm from player and second GM only to active GM; rejects forged formula and player baseline", async () => {
  const users = [{ id: "a", isGM: true, active: true }, { id: "b", isGM: true, active: true }, { id: "p", isGM: false, active: true }];
  const clients = [], calls = []; let requestId = 0;
  for (const user of users) {
    const map = new Map(users.map(u => [u.id, u])); map.contents = users; map.activeGM = users[0];
    const game = { user, users: map, socket: { emit(_channel, message) { for (const c of clients) void c.bus.handleMessage(message, { transportSenderId: user.id }); } } };
    const coordinator = new WorldMutationCoordinator();
    const bus = new SocketCommandBus({ coordinator, gameProvider: () => game });
    const gateway = new PrivilegedMutationGateway({ commandBus: bus, coordinator, gameProvider: () => game, getActiveGm, isActiveGmClient, operationIdFactory: () => `disarm-test-${++requestId}` });
    for (const action of ["start", "set-baseline"]) gateway.registerCommand(`disarm.${action}`, {
      validate: p => isValidDisarmPayload(action, p),
      authorize: (_p, { sender }) => authorizeDisarmSender(action, { sender, game }),
      execute: async (_p, context) => { await context.assertActiveGm(); calls.push([user.id, context.sender.id, action]); return { ok: true }; }
    });
    clients.push({ game, bus, gateway });
  }
  await clients[0].gateway.mutate("disarm.start", base);
  await clients[1].gateway.mutate("disarm.start", base);
  await clients[2].gateway.mutate("disarm.start", base);
  assert.deepEqual(calls, [["a", "a", "start"], ["a", "b", "start"], ["a", "p", "start"]]);
  await assert.rejects(clients[2].gateway.mutate("disarm.start", { ...base, formula: "100" }));
  await assert.rejects(clients[2].gateway.mutate("disarm.set-baseline", { operationId: "one", abilityScore: 16, proficiencyContribution: 2, reason: "manual" }), e => e.code === "unauthorized");
  for (const c of clients) c.game.users.activeGM = null;
  for (const u of users) u.active = false;
  await assert.rejects(clients[1].gateway.mutate("disarm.start", base), e => e.code === "active-gm-unavailable");
  assert.equal(calls.length, 3);
});
