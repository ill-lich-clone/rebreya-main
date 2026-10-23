import assert from "node:assert/strict";
import test from "node:test";
import { ReactionQueueService } from "../scripts/combat/reaction-queue-service.js";

function harness({ choice = { accepted: true }, payment = true, applied = true, consumed = true, throws = false, chatThrows = false } = {}) {
  const events = [];
  const actor = { uuid: "Actor.npc", name: "<Страж>" };
  const messages = [];
  const ChatMessage = {
    async create(data) {
      events.push(["create", data.content]);
      if (chatThrows) throw Error("chat unavailable");
      const message = { ...data, async update(patch) { events.push(["update", patch.content]); Object.assign(this, patch); }, async delete() { events.push(["delete"]); } };
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
