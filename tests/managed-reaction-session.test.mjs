import assert from "node:assert/strict";
import test from "node:test";
import { ReactionQueueService } from "../scripts/combat/reaction-queue-service.js";

function reactionText(content) {
  return /<p class="rm-reaction-chat__text">([^]*?)<\/p>/u.exec(content)?.[1] ?? content;
}

function harness({uses = 1} = {}) {
  const user = { id: "gm", active: true, isGM: true };
  const users = [user]; users.activeGM = user;
  const events = [];
  const actor = { uuid: "Actor.guard", name: "Страж", flags: {}, testUserPermission: u => u.id === "owner" };
  const game = { user, users, messages: [] };
  let remaining = uses;
  let now = 100;
  const timers = new Map(); let sequence = 0;
  const queue = new ReactionQueueService({ combatAttackService: {
    canUseReaction: (_actor, uses = 1) => ({ canUse: remaining >= uses }),
    getReactionState: () => ({ usesRemaining: remaining }),
    consumeReaction: async () => { events.push("consume"); remaining--; return { consumed: true }; }
  } }, {
    gameProvider: () => game, actorResolver: () => actor, now: () => now,
    setTimeoutFn: (fn, ms) => { timers.set(++sequence, { fn, ms }); return sequence; },
    clearTimeoutFn: id => timers.delete(id),
    chatMessageClass: { async create(data) { events.push(reactionText(data.content)); const message = { ...data, author: {isGM: true}, async update(patch) { if (patch['flags.rebreya-main.reactionChoice.state']) this.flags['rebreya-main'].reactionChoice.state = patch['flags.rebreya-main.reactionChoice.state']; Object.assign(this, patch); events.push(reactionText(patch.content) ?? "applying"); }, async delete() { events.push("deleted"); } }; game.messages.push(message); return message; } }
  });
  const request = { kind: "midi-native", triggerId: "attack:1:guard", candidate: { actorUuid: actor.uuid } };
  return { queue, game, actor, events, timers, request, expire() { now += 10001; for (const { fn } of [...timers.values()]) fn(); } };
}

test("managed native success passes through service, commits before execution and preserves exact result", async () => {
  const h = harness();
  const result = { name: "Shield", uuid: "Actor.guard.Item.shield.Activity.a", ac: 17, itemUuid: "Actor.guard.Item.shield" };
  const actual = await h.queue.resolveManagedReaction(h.request, async ({ commit }) => {
    assert.equal(h.events[0], "Страж выбирает реакцию");
    assert.equal(await commit(), true);
    h.actor.flags["midi-qol"] = { actions: { reaction: true, reactionsUsed: 1 } };
    return result;
  });
  assert.deepEqual(actual, result);
  assert.equal(h.events.at(-1), "deleted");
  assert.equal(h.events.filter(x => x === "consume").length, 1);
  assert.equal(h.timers.size, 0);
});

test("managed decline and unsuccessful native payment leave did-not-use chat", async () => {
  const h = harness();
  await h.queue.resolveManagedReaction(h.request, async ({ commit }) => { await commit(); return { name: "None" }; });
  assert.equal(h.events.at(-1), "Страж не применил реакцию");
  assert.equal(h.events.includes("consume"), false);
});

test("managed timeout aborts native choice and prohibits a late callback", async () => {
  const h = harness();
  let commit;
  let signal;
  const operation = h.queue.resolveManagedReaction(h.request, async controls => {
    ({ commit, signal } = controls);
    return new Promise(() => {});
  });
  while (!commit) await Promise.resolve();
  h.expire();
  assert.deepEqual(await operation, { name: "None" });
  assert.equal(signal.aborted, true);
  assert.equal(await commit(), false);
  assert.equal(h.events.at(-1), "Страж не применил реакцию");
});

test("confirmed managed application survives the selection deadline and duplicate request is not replayed", async () => {
  const h = harness();
  let finish;
  let runs = 0;
  const execute = async ({ commit }) => {
    runs++;
    assert.equal(await commit(), true);
    h.expire();
    return new Promise(resolve => { finish = resolve; });
  };
  const first = h.queue.resolveManagedReaction(h.request, execute);
  const duplicate = h.queue.resolveManagedReaction(h.request, execute);
  while (!finish) await Promise.resolve();
  finish({ name: "Shield", uuid: "Activity.shield" });
  assert.deepEqual(await first, await duplicate);
  assert.equal(runs, 1);
  await h.queue.resolveManagedReaction(h.request, execute);
  assert.equal(runs, 1);
});

test("managed sessions reject ownership forgery and foreign transport sender before chat or execution", async () => {
  const h = harness();
  h.game.users.push({ id: "stranger", active: true, isGM: false });
  const handled = await h.queue.handleSocketMessage({ type: "rebreya-main.reaction.managed", op: "begin", sessionId: "forgery", requestId: "x", forUserId: "gm", senderId: "stranger", request: h.request }, "forged");
  assert.equal(handled, true);
  assert.equal(h.events.length, 0);
  await h.queue.handleSocketMessage({ type: "rebreya-main.reaction.managed", op: "begin", sessionId: "forgery", requestId: "x", forUserId: "gm", senderId: "stranger", request: h.request }, "stranger");
  assert.equal(h.events.length, 0);
});

test("managed native errors finalize chat and nested requests never deadlock", async () => {
  const h = harness();
  await assert.rejects(h.queue.resolveManagedReaction(h.request, async ({ commit }) => {
    await commit();
    const child = { ...h.request, triggerId: "nested" };
    assert.deepEqual(await h.queue.resolveManagedReaction(child, async () => ({ name: "None" })), { name: "None" });
    throw Error("native error");
  }), /native error/);
  assert.equal(h.events.at(-1), "Страж не применил реакцию");
});

test("a native result without committed permission cannot finalize as applied", async () => {
  const h = harness();
  await h.queue.resolveManagedReaction(h.request, async () => ({ name: "Shield", uuid: "Activity.shield" }));
  assert.equal(h.events.at(-1), "Страж не применил реакцию");
});

test("player native session uses authenticated GM begin, commit and finish and returns AC unchanged", async () => {
  const h = harness();
  const owner = { id: "owner", active: true, isGM: false };
  h.game.users.push(owner);
  const ownerGame = { user: owner, users: h.game.users };
  const player = new ReactionQueueService({}, { gameProvider: () => ownerGame });
  const route = (message, senderId) => queueMicrotask(() => {
    void Promise.all([h.queue.handleSocketMessage(message, senderId), player.handleSocketMessage(message, senderId)]);
  });
  h.game.socket = { emit: (_channel, message) => route(message, "gm") };
  ownerGame.socket = { emit: (_channel, message) => route(message, "owner") };
  const actual = await player.resolveManagedReaction(h.request, async ({ commit }) => {
    assert.equal(await commit(), true);
    return { name: "Guard", uuid: h.actor.uuid, ac: 18 };
  });
  assert.equal(actual.ac, 18);
  assert.equal(h.events.at(-1), "deleted");
  assert.equal(player._managed.pending.size, 0);
});

test("new GM can finalize an applying native session from its durable message after coordinator reconnect", async () => {
  const h = harness();
  let finish;
  const pending = h.queue.resolveManagedReaction(h.request, async ({ commit }) => {
    assert.equal(await commit(), true);
    return new Promise(resolve => { finish = resolve; });
  });
  while (!finish) await Promise.resolve();
  const message = h.game.messages[0];
  const replacement = new ReactionQueueService(h.queue.moduleApi, h.queue._options);
  const state = message.flags['rebreya-main'].reactionChoice;
  const answer = await replacement._managed.command('finish', {sessionId: state.managed.sessionId, result: {name: 'Shield', uuid: 'Activity.shield'}}, 'gm');
  assert.equal(answer.allowed, true);
  assert.equal(h.events.at(-1), 'deleted');
  finish({name: 'None'}); await pending;
});

test("authenticated actor owner cannot overwrite another managed session ID", async () => {
  const h = harness();
  h.game.users.push({id: 'stranger', active: true, isGM: false});
  const other = {uuid: 'Actor.other', testUserPermission: user => user.id === 'stranger'};
  h.queue._options.actorResolver = uuid => uuid === other.uuid ? other : h.actor;
  const service = h.queue._managed;
  await service.command('begin', {sessionId: 'victim', request: h.request}, 'gm');
  await service.command('commit', {sessionId: 'victim'}, 'gm');
  const attack = {...h.request, triggerId: 'other-trigger', candidate: {actorUuid: other.uuid}};
  assert.equal((await service.command('begin', {sessionId: 'victim', request: attack}, 'stranger')).allowed, false);
  assert.equal(service.entries.get('victim').actor.uuid, h.actor.uuid);
  assert.equal((await service.command('begin', {sessionId: {}, request: attack}, 'stranger')).allowed, false);
  h.queue.destroy();
});

test("native zero-cost reaction remains usable when paid reaction ledger is empty", async () => {
  const h = harness();
  const uuid = 'Actor.guard.Item.free.Activity.a';
  h.queue.moduleApi.combatAttackService.canUseReaction = () => ({canUse: false});
  h.queue.moduleApi.combatAttackService.getReactionState = () => ({usesRemaining: 0});
  h.queue._options.documentResolver = () => ({uuid, actor: h.actor, activation: {type: 'reaction', value: 0}});
  const request = {...h.request, candidate: {...h.request.candidate, activityUuids: [uuid]}};
  const result = await h.queue.resolveManagedReaction(request, async ({commit}) => {
    assert.equal(await commit({activityUuid: uuid}), true);
    return {name: 'Free reaction', uuid};
  });
  assert.equal(result.uuid, uuid);
  assert.equal(h.events.includes('consume'), false);
});

test("inactive owner releases applying reservation and finalizes an abandoned message", async () => {
  const h = harness();
  await h.queue._managed.command('begin', {sessionId: 'abandoned', request: h.request}, 'gm');
  await h.queue._managed.command('commit', {sessionId: 'abandoned'}, 'gm');
  h.game.users[0].active = false;
  h.queue._options.isCoordinator = () => true;
  await h.queue.recoverExpiredReactionMessages();
  assert.equal(h.queue._managed.isActorReserved(h.actor.uuid), false);
  assert.equal(h.events.at(-1), 'Страж не применил реакцию');
  h.queue.destroy();
});

test("permission revoked after prompt denies commit before native application", async () => {
  const h = harness();
  h.game.users.push({id: 'owner', active: true, isGM: false});
  assert.equal((await h.queue._managed.command('begin', {sessionId: 'revoked', request: h.request}, 'owner')).allowed, true);
  h.actor.testUserPermission = () => false;
  assert.equal((await h.queue._managed.command('commit', {sessionId: 'revoked'}, 'owner')).allowed, false);
  h.queue.destroy();
});

test("free nested native choice is allowed while the same actor applies a paid reaction", async () => {
  const h = harness();
  const uuid = 'Actor.guard.Item.free.Activity.a';
  h.queue._options.documentResolver = () => ({uuid, actor: h.actor, activation: {type: 'reaction', value: 0}});
  const service = h.queue._managed;
  await service.command('begin', {sessionId: 'paid', request: h.request}, 'gm');
  await service.command('commit', {sessionId: 'paid'}, 'gm');
  const request = {...h.request, triggerId: 'nested-free', candidate: {...h.request.candidate, activityUuids: [uuid]}};
  await service.command('begin', {sessionId: 'free', request}, 'gm');
  assert.equal((await service.command('commit', {sessionId: 'free', activityUuid: uuid}, 'gm')).allowed, true);
  h.queue.destroy();
});

test("actor with two reaction uses can reserve two paid reactions but never a third", async () => {
  const h = harness({uses: 2});
  const service = h.queue._managed;
  for (const id of ['first', 'second', 'third']) {
    await service.command('begin', {sessionId: id, request: {...h.request, triggerId: id}}, 'gm');
    assert.equal((await service.command('commit', {sessionId: id}, 'gm')).allowed, id !== 'third');
  }
  h.queue.destroy();
});

test("both successful native applications settle their own module reaction use", async () => {
  const h = harness({uses: 2});
  const service = h.queue._managed;
  for (const id of ['first', 'second']) {
    await service.command('begin', {sessionId: id, request: {...h.request, triggerId: id}}, 'gm');
    await service.command('commit', {sessionId: id}, 'gm');
  }
  h.actor.flags['midi-qol'] = {actions: {reactionsUsed: 1}};
  await service.command('finish', {sessionId: 'first', result: {name: 'Reaction', uuid: 'Activity.a'}}, 'gm');
  h.actor.flags['midi-qol'].actions.reactionsUsed = 2;
  await service.command('finish', {sessionId: 'second', result: {name: 'Reaction', uuid: 'Activity.b'}}, 'gm');
  assert.equal(h.events.filter(event => event === 'consume').length, 2);
  assert.equal(h.queue.moduleApi.combatAttackService.getReactionState().usesRemaining, 0);
  h.queue.destroy();
});
