import test from "node:test";
import assert from "node:assert/strict";
import { bindDecayingRecoveryChat, runDecayingRecoveryMacro } from "../scripts/integrations/decaying-recovery-ui.js";

test("chat button calls the same macro entry with the message target and effect", async () => {
  let handler, call;
  const button = { addEventListener: (_event, fn) => { handler = fn; } };
  const root = { querySelector: () => button };
  const message = { getFlag: () => ({ targetTokenUuid: "Scene.s.Token.t", effectId: "effect" }) };
  bindDecayingRecoveryChat(message, root, { recoverDecayingDamage: async options => { call = options; } });
  await handler({ preventDefault() {} });
  assert.deepEqual(call, { targetTokenUuid: "Scene.s.Token.t", effectId: "effect" });
});

test("macro routes the controlled healer and targeted ally to the GM operation", async () => {
  const healer = { uuid: "Scene.s.Token.h", actor: { isOwner: true } };
  const effect = { id: "e", name: "Огонь", statuses: new Set(["rebreya-decaying-damage"]) };
  const ally = { uuid: "Scene.s.Token.a", actor: { effects: { contents: [effect] } } };
  let intent;
  const result = await runDecayingRecoveryMacro({ canvas: { tokens: { controlled: [{ document: healer }] } }, game: { user: { targets: new Set([{ document: ally }]) } },
    dialog: async () => ({ effectId: "e", action: "bonus", amount: 0, dc: 0 }), randomId: () => "id",
    request: async payload => { intent = payload; return "ok"; } });
  assert.equal(result, "ok");
  assert.equal(intent.sourceTokenUuid, healer.uuid);
  assert.equal(intent.targetTokenUuid, ally.uuid);
  assert.equal(intent.effectId, "e");
});

test("new damage effect posts a button tied to each visible active token", async () => {
  const sent = [];
  const { publishDecayingRecoveryPrompt } = await import("../scripts/integrations/decaying-recovery-ui.js");
  const visible = { uuid: "Scene.s.Token.a", name: "Ally" };
  const hidden = { uuid: "Scene.s.Token.h", hidden: true };
  const effect = { id: "e", statuses: new Set(["rebreya-decaying-damage"]), parent: { getActiveTokens: () => [{ document: visible }, { document: hidden }] } };
  await publishDecayingRecoveryPrompt(effect, { active: () => true, create: data => { sent.push(data); } });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].flags["rebreya-main"].decayingRecoveryTarget, { targetTokenUuid: visible.uuid, effectId: "e" });
  assert.match(sent[0].content, /data-action="decaying-recovery"/u);
});

test("an ambiguous socket reply retries the same operation instead of creating another roll", async () => {
  const { requestRecoveryOnce } = await import("../scripts/integrations/decaying-recovery-ui.js");
  const state = {}; const calls = []; const payload = { operationId: "first" };
  const request = async p => { calls.push(p); if (calls.length === 1) throw Object.assign(new Error("lost"), { code: "ambiguous-outcome" }); return "ok"; };
  await assert.rejects(requestRecoveryOnce(state, payload, request), /lost/u);
  assert.equal(await requestRecoveryOnce(state, { operationId: "second" }, request), "ok");
  assert.deepEqual(calls, [payload, payload]);
  assert.equal(state.pending, null);
});
