import test from "node:test";
import assert from "node:assert/strict";
import { normalizeReputation, applyReputationChange } from "../scripts/data/reputation-rules.js";
const context = { gmId: "gm", timestamp: 100 };
const request = (expectedRevision = 0, operationId = "o1") => ({ expectedRevision, operationId, change: { delta: { fame: 2, infamy: 0 } }, reason: "Помощь городу" });
test("detached defaults, independent counters and signed deltas", () => {
  const s = normalizeReputation({ fame: 4, infamy: 3, revision: 0 });
  const next = applyReputationChange(s, request(), context);
  assert.deepEqual([next.fame, next.infamy, next.revision], [6, 3, 1]);
  assert.equal(s.fame, 4);
  assert.equal(applyReputationChange(next, { ...request(1, "o2"), change: { delta: { fame: -2, infamy: 1 } } }, context).fame, 4);
  assert.deepEqual(normalizeReputation(null), { version: 1, fame: 0, infamy: 0, revision: 0, recentChanges: [] });
});
test("invalid, stale and overflowing updates never apply", () => {
  for (const patch of [{ expectedRevision: 1 }, { reason: " " }, { reason: "a".repeat(241) }, { operationId: "" },
    { change: { delta: { fame: -1, infamy: 0 } } }, { change: { set: { fame: "1", infamy: 0 } } },
    { change: { set: { fame: NaN, infamy: 0 } } }, { change: { set: { fame: 1, infamy: 0 }, delta: { fame: 1, infamy: 0 } } },
    { change: { delta: { fame: 1.5, infamy: 0 } } }, { senderId: "forged" }]) {
    assert.throws(() => applyReputationChange(normalizeReputation(null), { ...request(), ...patch }, context));
  }
  assert.throws(() => applyReputationChange(normalizeReputation({ fame: Number.MAX_SAFE_INTEGER }), request(), context), e => e.code === "invalid-value");
});
test("durable replay precedes revision check and altered operation conflicts", () => {
  const a = applyReputationChange(normalizeReputation(null), request(), context);
  const b = applyReputationChange(a, request(1, "o2"), context);
  assert.deepEqual(applyReputationChange(b, request(), context), a);
  assert.throws(() => applyReputationChange(b, { ...request(), reason: "changed" }, context), e => e.code === "operation-conflict");
  assert.throws(() => applyReputationChange(b, request(), { ...context, gmId: "other" }), e => e.code === "operation-conflict");
});
test("bounded history retains receipts for no-op sets; expired stale retry fails", () => {
  let s = normalizeReputation(null);
  for (let i = 0; i < 61; i++) s = applyReputationChange(s, { ...request(i, `o${i}`), change: { set: { fame: 4, infamy: 3 } } }, context);
  assert.equal(s.recentChanges.length, 50);
  assert.deepEqual([s.fame, s.infamy, s.revision], [4, 3, 61]);
  assert.throws(() => applyReputationChange(s, { ...request(0, "o0"), change: { set: { fame: 4, infamy: 3 } } }, context), e => e.code === "stale-revision");
});
