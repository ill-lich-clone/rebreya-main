import assert from "node:assert/strict";
import test from "node:test";
import { ReactionQueueService } from "../scripts/combat/reaction-queue-service.js";

function reactionText(content) {
  return /<p class="rm-reaction-chat__text">([^]*?)<\/p>/u.exec(content)?.[1] ?? content;
}

function harness({ choice = { accepted: true }, payment = true, applied = true, consumed = true, throws = false, chatThrows = false } = {}) {
  const events = [];
  const actor = { uuid: "Actor.npc", name: "<Страж>" };
  const messages = [];
  const ChatMessage = {
    async create(data) {
      events.push(["create", reactionText(data.content)]);
      if (chatThrows) throw Error("chat unavailable");
      const message = { ...data, async update(patch) { events.push(["update", reactionText(patch.content)]); Object.assign(this, patch); }, async delete() { events.push(["delete"]); } };
      messages.push(message);
      return message;
    }
  };
  const queue = new ReactionQueueService({ combatAttackService: { async consumeReaction() { events.push(["consume"]); return { consumed }; } } }, {
    isCoordinator: () => true,
    gameProvider: () => ({ messages }),
    chatMessageClass: ChatMessage,
    actorResolver: () => actor,
    promptCandidate: async () => { events.push(["prompt"]); return choice; }
  });
  queue.registerType("reaction", {
    listCandidates: () => [{ actorUuid: actor.uuid, actor }],
    pay: () => ({ paid: payment }),
    apply: async () => { events.push(["apply"]); if (throws) throw Error("provider failed"); return { applied }; }
  });
  return { queue, events, messages, run: () => queue.resolve({ kind: "reaction", triggerId: "attack:1" }) };
}

test("chat shows choosing before prompt and deletes only after successful payment, application and reaction", async () => {
  const h = harness();
  await h.run();
  assert.deepEqual(h.events, [["create", "&lt;Страж&gt; выбирает реакцию"], ["prompt"], ["apply"], ["consume"], ["delete"]]);
  const flag = h.messages[0].flags["rebreya-main"].reactionChoice;
  assert.equal(flag.triggerId, "attack:1");
  assert.equal(flag.candidateActorUuid, "Actor.npc");
});

test("choosing and declined cards have scoped styling and retain the escaped exact sentence", async () => {
  for (const [applied, state, sentence] of [[true, "choosing", "выбирает реакцию"], [false, "declined", "не применил реакцию"]]) {
    const h = harness({ applied });
    await h.run();
    const content = h.messages[0].content;
    assert.match(content, new RegExp(`class="rm-reaction-chat rm-reaction-chat--${state}"`, "u"));
    assert.match(content, /<span class="rm-reaction-chat__label">Реакция<\/span>/u);
    assert.match(content, /aria-hidden="true"/u);
    assert.equal(reactionText(content), `&lt;Страж&gt; ${sentence}`);
    assert.doesNotMatch(content, /<Страж>/u);
  }
});

for (const [name, options] of [
  ["decline", { choice: { accepted: false, reason: "declined" } }],
  ["close", { choice: { accepted: false, reason: "closed" } }],
  ["timeout", { choice: { accepted: false, reason: "timeout" } }],
  ["failed payment", { payment: false }],
  ["failed application", { applied: false }],
  ["failed reaction payment", { consumed: false }],
  ["provider error", { throws: true }]
]) test(`${name} replaces the same choosing message with did not use reaction`, async () => {
  const h = harness(options);
  await h.run();
  assert.equal(h.messages.length, 1);
  assert.deepEqual(h.events.at(-1), ["update", "&lt;Страж&gt; не применил реакцию"]);
  assert.equal(h.messages[0].flags["rebreya-main"].reactionChoice.state, "declined");
});

test("duplicate triggers do not duplicate chat or reaction payments", async () => {
  const h = harness();
  await Promise.all([h.run(), h.run()]);
  await h.run();
  assert.equal(h.events.filter(([type]) => type === "create").length, 1);
  assert.equal(h.events.filter(([type]) => type === "consume").length, 1);
});

test("chat failure cannot prevent a successful reaction", async () => {
  const h = harness({ chatThrows: true });
  assert.equal((await h.run()).accepted.length, 1);
  assert.equal(h.events.filter(([type]) => type === "consume").length, 1);
});

test("only expired module-owned choosing messages recover, never applying or unrelated chat", async () => {
  const h = harness({ choice: { accepted: false } });
  await h.run();
  const message = h.messages[0];
  message.flags["rebreya-main"].reactionChoice.state = "choosing";
  message.flags["rebreya-main"].reactionChoice.expiresAt = 1;
  h.messages.push({ flags: {}, update() { assert.fail("unrelated message updated"); } });
  h.messages.push({ flags: { "rebreya-main": { reactionChoice: { state: "applying", expiresAt: 1 } } }, update() { assert.fail("active transaction updated"); } });
  const before = h.events.length;
  await h.queue.recoverExpiredReactionMessages();
  assert.equal(h.events.length, before + 1);
  assert.equal(message.flags["rebreya-main"].reactionChoice.state, "declined");
  await h.queue.recoverExpiredReactionMessages();
  assert.equal(h.events.length, before + 1);
});

test("late choice after ten seconds cannot apply and keeps a declined message", async () => {
  const h = harness();
  let timeout;
  let answer;
  h.queue._options.setTimeoutFn = (fn, delay) => { assert.equal(delay, 10000); timeout = fn; return 1; };
  h.queue._options.clearTimeoutFn = () => {};
  h.queue._options.promptCandidate = () => new Promise(resolve => { answer = resolve; });
  const pending = h.run();
  while (!timeout) await Promise.resolve();
  timeout();
  await pending;
  answer({ accepted: true });
  await Promise.resolve();
  assert.equal(h.events.some(([type]) => type === "apply"), false);
  assert.deepEqual(h.events.at(-1), ["update", "&lt;Страж&gt; не применил реакцию"]);
});

test("no candidate and standalone non-reaction decisions never create chat", async () => {
  const h = harness();
  h.queue.registerType("reaction", { listCandidates: () => [] });
  await h.run();
  h.queue._options.promptRenderer = () => ({ accepted: false });
  await h.queue.promptDecision({ candidate: {}, prompt: {} });
  assert.equal(h.events.length, 0);
});

for (const actorUuid of ["Actor.player", "Scene.battle.Token.npc.Actor.base"]) {
  test(`UUID-only reaction resolves ${actorUuid} before spending and deleting its message`, async t => {
    const h = harness();
    const actor = { uuid: actorUuid, name: "Реагирующий" };
    const original = Object.getOwnPropertyDescriptor(globalThis, "fromUuid");
    t.after(() => original ? Object.defineProperty(globalThis, "fromUuid", original) : delete globalThis.fromUuid);
    globalThis.fromUuid = async uuid => uuid === actorUuid ? actor : null;
    delete h.queue._options.actorResolver;
    h.queue.registerType("reaction", {
      listCandidates: () => [{ actorUuid }],
      pay: () => { h.events.push(["pay"]); return { paid: true }; },
      apply: () => { h.events.push(["apply"]); return { applied: true }; }
    });
    h.queue.moduleApi.combatAttackService.consumeReaction = async resolved => {
      h.events.push(["consume", resolved?.uuid]);
      return { consumed: resolved === actor };
    };
    const result = await h.run();
    assert.equal(result.accepted.length, 1);
    assert.deepEqual(h.events.slice(1), [["prompt"], ["pay"], ["apply"], ["consume", actorUuid], ["delete"]]);
  });
}

test("a failed UUID-only reaction spend still rolls back application and keeps the declined message", async t => {
  const h = harness();
  const actor = { uuid: "Actor.player", name: "Игрок" };
  const original = Object.getOwnPropertyDescriptor(globalThis, "fromUuid");
  t.after(() => original ? Object.defineProperty(globalThis, "fromUuid", original) : delete globalThis.fromUuid);
  globalThis.fromUuid = async () => actor;
  delete h.queue._options.actorResolver;
  h.queue.registerType("reaction", {
    listCandidates: () => [{ actorUuid: actor.uuid }],
    apply: () => ({ applied: true }),
    rollback: () => h.events.push(["rollback"])
  });
  let spentActor;
  h.queue.moduleApi.combatAttackService.consumeReaction = async resolved => {
    spentActor = resolved;
    return { consumed: false };
  };
  assert.equal((await h.run()).accepted.length, 0);
  assert.equal(spentActor, actor);
  assert.equal(h.events.filter(([type]) => type === "rollback").length, 1);
  assert.equal(h.events.some(([type]) => type === "delete"), false);
  assert.equal(h.messages[0].flags["rebreya-main"].reactionChoice.state, "declined");
});

test("a candidate's ready Actor is used before attempting UUID lookup", async () => {
  const h = harness();
  h.queue._options.actorResolver = () => { assert.fail("ready Actor must not be resolved again"); };
  let spentActor;
  h.queue.moduleApi.combatAttackService.consumeReaction = async actor => { spentActor = actor; return { consumed: true }; };
  assert.equal((await h.run()).accepted.length, 1);
  assert.equal(spentActor.uuid, "Actor.npc");
  assert.equal(h.events.at(-1)[0], "delete");
});
