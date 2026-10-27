import test from "node:test";
import assert from "node:assert/strict";
import { DecayingRecoveryService } from "../scripts/combat/decaying-recovery-service.js";

function fixture({ total = 15, gm = false, owned = true } = {}) {
  const sender = { id: "p1", isGM: gm };
  const source = { uuid: "Scene.s.Token.healer", parent: { id: "s" }, actor: { uuid: "Actor.healer", testUserPermission: () => owned } };
  const effect = { id: "e", statuses: new Set(["rebreya-decaying-damage"]), flags: { "rebreya-main": { statusValue: 20, statusMeta: { step: 5, damageType: "fire", sourceActorId: "source" } } } };
  const target = { uuid: "Scene.s.Token.patient", parent: { id: "s" }, actor: { uuid: "Actor.patient", effects: { contents: [effect] }, testUserPermission: () => false } };
  const records = new Map();
  const journal = {
    async find(id) { return records.get(id); },
    async start(record) { records.set(record.id, record); return record; },
    async checkpoint(id, expected, phase, patch) { const record = records.get(id); assert.equal(record.phase, expected); const next = { ...record, ...patch, phase }; records.set(id, next); return next; },
    async finish(id, patch) { const next = { ...records.get(id), ...patch, terminal: true }; records.set(id, next); return next; }
  };
  let reductions = 0, rolls = 0;
  const service = new DecayingRecoveryService({ journal, resolve: async uuid => [source, target].find(x => x.uuid === uuid),
    sourceActor: () => ({ system: { attributes: { prof: 3 } } }), sceneId: () => "s", user: id => id === sender.id ? sender : null,
    roll: async () => { rolls++; return { total, toJSON: () => "{}" }; },
    reduce: async (_actor, _id, amount) => { reductions++; effect.flags["rebreya-main"].statusValue -= amount; }, publish: async () => {} });
  const intent = { operationId: "one", sourceTokenUuid: source.uuid, targetTokenUuid: target.uuid, effectId: "e", action: "action", amount: 0, dc: 0 };
  return { service, intent, sender, effect, counts: () => ({ reductions, rolls }) };
}

test("an owner can help an ally and duplicate delivery never rolls or reduces twice", async () => {
  const f = fixture(); const ctx = { sender: f.sender, assertAuthority: async () => {} };
  await f.service.start(f.intent, ctx); await f.service.start(f.intent, ctx);
  assert.equal(f.effect.flags["rebreya-main"].statusValue, 10);
  assert.deepEqual(f.counts(), { reductions: 1, rolls: 1 });
});

test("a failed check leaves the effect untouched", async () => {
  const f = fixture({ total: 12 }); await f.service.start(f.intent, { sender: f.sender, assertAuthority: async () => {} });
  assert.equal(f.effect.flags["rebreya-main"].statusValue, 20);
});

test("a player cannot use another person's healer", async () => {
  const f = fixture({ owned: false }); await assert.rejects(f.service.start(f.intent, { sender: f.sender, assertAuthority: async () => {} }), /доступ/iu);
  assert.deepEqual(f.counts(), { reductions: 0, rolls: 0 });
});

test("a bonus action removes one step and missing source requires an explicit DC", async () => {
  const f = fixture(); f.service.sourceActor = () => null; f.intent.action = "bonus";
  await assert.rejects(f.service.start(f.intent, { sender: f.sender, assertAuthority: async () => {} }), /Сл/u);
  f.intent.dc = 10;
  await f.service.start(f.intent, { sender: f.sender, assertAuthority: async () => {} });
  assert.equal(f.effect.flags["rebreya-main"].statusValue, 15);
});

test("manual reduction of an ally requires ownership of that patient", async () => {
  const f = fixture(); f.intent.action = "manual"; f.intent.amount = 5;
  await assert.rejects(f.service.start(f.intent, { sender: f.sender, assertAuthority: async () => {} }), /доступ/iu);
  assert.deepEqual(f.counts(), { reductions: 0, rolls: 0 });
});

test("a duplicate operation after an uncertain mutation requires review, never repeating it", async () => {
  const f = fixture(); const ctx = { sender: f.sender, assertAuthority: async () => {} };
  f.service.reduce = async () => { throw new Error("write failed"); };
  await assert.rejects(f.service.start(f.intent, ctx), /write failed/u);
  await assert.rejects(f.service.start(f.intent, ctx), /провери/u);
  assert.deepEqual(f.counts(), { reductions: 0, rolls: 1 });
});

test("a missing proficiency value is not silently treated as zero", async () => {
  const f = fixture(); f.service.sourceActor = () => ({ system: { attributes: { prof: null } } });
  await assert.rejects(f.service.start(f.intent, { sender: f.sender, assertAuthority: async () => {} }), /Сл/u);
});
