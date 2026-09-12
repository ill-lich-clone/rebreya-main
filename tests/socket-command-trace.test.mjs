import assert from "node:assert/strict";
import test from "node:test";

import { createSocketCommandTraceSink } from "../scripts/infrastructure/foundry/socket-command-trace.js";

function traceEvent(phase, {
  command = "inventory.item.take",
  requestId = "request-1",
  senderId = "player-1",
  at = 0,
  ...rest
} = {}) {
  return { phase, command, requestId, senderId, at, ...rest };
}

test("socket command trace reports slow queue and total duration without private fields", () => {
  const records = [];
  const warnings = [];
  const trace = createSocketCommandTraceSink({
    onRecord: (record) => records.push(record),
    warn: (record) => warnings.push(record),
    slowTotalMs: 1_000,
    slowQueueMs: 250
  });

  trace(traceEvent("received", { at: 0, payload: { itemName: "Secret" } }));
  trace(traceEvent("queue-start", { at: 300, actorName: "Hidden" }));
  trace(traceEvent("authorized", { at: 350 }));
  trace(traceEvent("execute-end", { at: 1_100 }));
  trace(traceEvent("completed", {
    at: 1_200,
    outcome: "ok",
    mode: "keyed-mutation",
    keys: ["actor:a"]
  }));

  assert.equal(records.length, 1);
  assert.equal(warnings.length, 1);
  assert.equal(records[0].queueMs, 300);
  assert.equal(records[0].totalMs, 1_200);
  assert.equal(records[0].executionMs, 750);
  assert.equal(records[0].payload, undefined);
  assert.equal(records[0].actorName, undefined);
  assert.deepEqual(records[0].keys, ["actor:a"]);
  assert.equal(Object.isFrozen(records[0]), true);
  assert.equal(Object.isFrozen(records[0].keys), true);
});

test("socket command trace counts writes and does not warn for a fast success", () => {
  const records = [];
  const warnings = [];
  const trace = createSocketCommandTraceSink({
    onRecord: (record) => records.push(record),
    warn: (record) => warnings.push(record)
  });

  trace(traceEvent("received", { at: 100 }));
  trace(traceEvent("queue-start", { at: 110 }));
  trace(traceEvent("journal-write", { at: 120, count: 2 }));
  trace(traceEvent("document-write", { at: 130 }));
  trace(traceEvent("refresh-scheduled", { at: 140 }));
  trace(traceEvent("completed", { at: 200, outcome: "ok", mode: "query" }));

  assert.equal(records.length, 1);
  assert.equal(warnings.length, 0);
  assert.equal(records[0].journalWrites, 2);
  assert.equal(records[0].documentWrites, 1);
  assert.equal(records[0].refreshScheduledAt, 140);
});

test("socket command trace warns for failed commands even when they are fast", () => {
  const warnings = [];
  const trace = createSocketCommandTraceSink({ warn: (record) => warnings.push(record) });

  trace(traceEvent("received", { at: 10 }));
  trace(traceEvent("completed", { at: 20, outcome: "failed", mode: "exclusive-mutation" }));

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].outcome, "failed");
});

test("socket command trace bounds unfinished spans and ignores orphan completion", () => {
  const records = [];
  const trace = createSocketCommandTraceSink({
    maxOpenSpans: 1,
    onRecord: (record) => records.push(record)
  });

  trace(traceEvent("received", { requestId: "old", at: 0 }));
  trace(traceEvent("received", { requestId: "new", at: 1 }));
  trace(traceEvent("completed", { requestId: "old", at: 2, outcome: "ok" }));
  trace(traceEvent("completed", { requestId: "new", at: 3, outcome: "ok" }));

  assert.deepEqual(records.map((record) => record.requestId), ["new"]);
});
