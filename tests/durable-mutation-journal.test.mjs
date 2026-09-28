import test from "node:test";
import assert from "node:assert/strict";

import { DurableMutationJournal } from "../scripts/application/durable-mutation-journal.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createStore({ write } = {}) {
  let state = { version: 1, records: [] };
  let writes = 0;
  return {
    journal(options = {}) {
      return new DurableMutationJournal({
        readState: async () => clone(state),
        writeState: async (nextState) => {
          writes += 1;
          if (write) {
            return write(nextState, {
              persist(value) {
                state = clone(value);
              }
            });
          }
          state = clone(nextState);
          return clone(state);
        },
        normalizeState: (value) => ({
          version: 1,
          records: Array.isArray(value?.records) ? clone(value.records) : []
        }),
        ...options
      });
    },
    get state() {
      return clone(state);
    },
    get writes() {
      return writes;
    }
  };
}

test("DurableMutationJournal makes duplicate start idempotent and clones returned records", async () => {
  const store = createStore();
  const journal = store.journal();
  const first = await journal.start({
    id: "craft-1",
    phase: "prepared",
    request: { actorId: "actor-1" }
  });
  first.request.actorId = "tampered";
  const duplicate = await journal.start({
    id: "craft-1",
    phase: "different",
    request: { actorId: "actor-2" }
  });

  assert.equal(store.writes, 1);
  assert.deepEqual(duplicate, {
    id: "craft-1",
    phase: "prepared",
    request: { actorId: "actor-1" },
    terminal: false
  });
  assert.deepEqual(await journal.find("craft-1"), duplicate);
});

test("DurableMutationJournal rejects a checkpoint from an unexpected phase", async () => {
  const store = createStore();
  const journal = store.journal();
  await journal.start({ id: "inventory-1", phase: "prepared" });

  await assert.rejects(
    journal.checkpoint("inventory-1", "target-created", "source-debited", {}),
    (error) => error?.code === "phase-conflict"
      && error?.currentPhase === "prepared"
      && error?.expectedPhase === "target-created"
  );
  assert.equal(store.writes, 1);
});

test("DurableMutationJournal rereads durable state after an ambiguous write failure", async () => {
  const store = createStore({
    write(nextState, { persist }) {
      persist(nextState);
      throw new Error("transport failed after persistence");
    }
  });
  const journal = store.journal();

  const record = await journal.start({ id: "loot-1", phase: "prepared" });

  assert.deepEqual(record, {
    id: "loot-1",
    phase: "prepared",
    terminal: false
  });
  assert.deepEqual(await journal.find("loot-1"), record);
});

test("DurableMutationJournal rethrows a write failure when durable state did not advance", async () => {
  const store = createStore({
    write() {
      throw new Error("write rejected");
    }
  });
  const journal = store.journal();

  await assert.rejects(journal.start({ id: "loot-2", phase: "prepared" }), /write rejected/u);
  assert.equal(await journal.find("loot-2"), null);
});

test("DurableMutationJournal retains all nonterminal rows and only the latest terminal rows", async () => {
  const store = createStore();
  const journal = store.journal({ limit: 2 });

  await journal.start({ id: "done-1", phase: "prepared" });
  await journal.finish("done-1", { value: 1 });
  await journal.start({ id: "pending", phase: "prepared" });
  await journal.start({ id: "done-2", phase: "prepared" });
  await journal.finish("done-2", { value: 2 });
  await journal.start({ id: "done-3", phase: "prepared" });
  const finished = await journal.finish("done-3", { value: 3 });
  finished.result.value = 99;

  assert.deepEqual(store.state.records.map((record) => record.id), ["pending", "done-2", "done-3"]);
  assert.deepEqual((await journal.find("done-3")).result, { value: 3 });
});

test("DurableMutationJournal checkpoints merge patches without allowing identity changes", async () => {
  const store = createStore();
  const journal = store.journal();
  await journal.start({ id: "craft-2", phase: "prepared", receipt: { debit: false } });

  const checkpoint = await journal.checkpoint(
    "craft-2",
    "prepared",
    "materials-debited",
    { id: "forged", receipt: { debit: true } }
  );

  assert.deepEqual(checkpoint, {
    id: "craft-2",
    phase: "materials-debited",
    receipt: { debit: true },
    terminal: false
  });
});

test("DurableMutationJournal records a terminal outcome with one write", async () => {
  const store = createStore();
  const journal = store.journal();

  const record = await journal.recordTerminal({
    id: "inventory-simple:take-1",
    kind: "inventory-simple-v1",
    phase: "committed",
    fingerprint: "take\u0000group-a\u0000item-a\u0000actor-a\u00001"
  }, {
    ok: true,
    value: { itemId: "created-a", quantity: 1 }
  });

  assert.equal(store.writes, 1);
  assert.deepEqual(record, {
    id: "inventory-simple:take-1",
    kind: "inventory-simple-v1",
    phase: "committed",
    fingerprint: "take\u0000group-a\u0000item-a\u0000actor-a\u00001",
    terminal: true,
    result: {
      ok: true,
      value: { itemId: "created-a", quantity: 1 }
    }
  });
});

test("DurableMutationJournal replays the same terminal fingerprint without another write", async () => {
  const store = createStore();
  const journal = store.journal();
  const input = {
    id: "inventory-simple:take-2",
    kind: "inventory-simple-v1",
    phase: "committed",
    fingerprint: "take-2-fingerprint"
  };

  const first = await journal.recordTerminal(input, { ok: true, value: { itemId: "created-a" } });
  const replay = await journal.recordTerminal(input, { ok: true, value: { itemId: "different" } });

  assert.equal(store.writes, 1);
  assert.deepEqual(replay, first);
});

test("DurableMutationJournal rejects terminal fingerprint and nonterminal conflicts without writing", async () => {
  const terminalStore = createStore();
  const terminalJournal = terminalStore.journal();
  await terminalJournal.recordTerminal({
    id: "inventory-simple:take-3",
    phase: "committed",
    fingerprint: "fingerprint-a"
  }, { ok: true });

  await assert.rejects(
    terminalJournal.recordTerminal({
      id: "inventory-simple:take-3",
      phase: "committed",
      fingerprint: "fingerprint-b"
    }, { ok: true }),
    (error) => error?.code === "record-conflict"
      && error?.mutationId === "inventory-simple:take-3"
  );
  assert.equal(terminalStore.writes, 1);

  const nonterminalStore = createStore();
  const nonterminalJournal = nonterminalStore.journal();
  await nonterminalJournal.start({
    id: "inventory-simple:legacy-take",
    phase: "prepared",
    fingerprint: "legacy-fingerprint"
  });
  await assert.rejects(
    nonterminalJournal.recordTerminal({
      id: "inventory-simple:legacy-take",
      phase: "committed",
      fingerprint: "legacy-fingerprint"
    }, { ok: true }),
    (error) => error?.code === "record-conflict"
      && error?.currentPhase === "prepared"
  );
  assert.equal(nonterminalStore.writes, 1);
});

test("DurableMutationJournal confirms recordTerminal after a write-then-throw", async () => {
  const store = createStore({
    write(nextState, { persist }) {
      persist(nextState);
      throw new Error("terminal acknowledgment lost");
    }
  });
  const journal = store.journal();

  const record = await journal.recordTerminal({
    id: "inventory-simple:take-4",
    phase: "committed",
    fingerprint: "take-4-fingerprint"
  }, { ok: false, code: "transfer-failed-compensated" });

  assert.equal(store.writes, 1);
  assert.equal(record.terminal, true);
  assert.equal(record.result.code, "transfer-failed-compensated");
});
