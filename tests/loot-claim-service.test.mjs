import test from "node:test";
import assert from "node:assert/strict";

import { LootClaimService } from "../scripts/application/loot-claim-service.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createFixture({ failWrite } = {}) {
  let state = {
    lootId: "loot-1",
    rows: [{ rowId: "row-1", name: "Relic", claimed: false }],
    coins: { gp: 3, totalCopper: 300 },
    coinsClaimed: false,
    claims: []
  };
  let writes = 0;
  const rowGrants = new Set();
  const coinGrants = new Set();
  const effects = { rows: 0, coins: 0 };
  const message = { id: "message-1" };
  const service = new LootClaimService({
    getMessage: ({ messageId, lootId }) => (
      messageId === message.id || lootId === state.lootId ? message : null
    ),
    readState: () => clone(state),
    async writeState(_message, nextState) {
      writes += 1;
      if (failWrite) {
        const outcome = failWrite({ writes, nextState: clone(nextState) });
        if (outcome === "before") throw new Error("message update failed before persistence");
        state = clone(nextState);
        if (outcome === "after") throw new Error("message update failed after persistence");
        return;
      }
      state = clone(nextState);
    },
    async grantRow({ claimId }) {
      if (!rowGrants.has(claimId)) {
        rowGrants.add(claimId);
        effects.rows += 1;
      }
      return { receiptId: claimId };
    },
    async grantCoins({ claimId }) {
      if (!coinGrants.has(claimId)) {
        coinGrants.add(claimId);
        effects.coins += 1;
      }
      return { receiptId: claimId };
    }
  });
  return {
    effects,
    get state() {
      return clone(state);
    },
    service
  };
}

test("loot row retry resumes a prepared claim without granting the item twice", async () => {
  let failed = false;
  const fixture = createFixture({
    failWrite({ nextState }) {
      const phase = nextState.claims?.find((claim) => claim.id === "claim-row-1")?.phase;
      if (!failed && phase === "granted") {
        failed = true;
        return "before";
      }
      return "none";
    }
  });
  const request = {
    messageId: "message-1",
    lootId: "loot-1",
    rowId: "row-1",
    claimId: "claim-row-1"
  };

  await assert.rejects(fixture.service.claimRow(request), /message update failed/u);
  assert.equal(fixture.state.claims[0].phase, "prepared");
  assert.equal(fixture.effects.rows, 1);

  assert.equal(await fixture.service.claimRow(request), true);
  assert.equal(await fixture.service.claimRow(request), true);
  assert.equal(fixture.effects.rows, 1);
  assert.equal(fixture.state.rows[0].claimed, true);
  assert.equal(fixture.state.claims[0].phase, "committed");
});

test("loot claim accepts a lost ChatMessage acknowledgement by rereading durable state", async () => {
  let failed = false;
  const fixture = createFixture({
    failWrite({ nextState }) {
      const phase = nextState.claims?.find((claim) => claim.id === "claim-coins-1")?.phase;
      if (!failed && phase === "granted") {
        failed = true;
        return "after";
      }
      return "none";
    }
  });

  assert.equal(await fixture.service.claimCoins({
    messageId: "message-1",
    lootId: "loot-1",
    claimId: "claim-coins-1"
  }), true);
  assert.equal(fixture.effects.coins, 1);
  assert.equal(fixture.state.coinsClaimed, true);
  assert.equal(fixture.state.claims[0].phase, "committed");
});

test("a new claim id cannot grant an already claimed row again", async () => {
  const fixture = createFixture();
  assert.equal(await fixture.service.claimRow({
    messageId: "message-1",
    lootId: "loot-1",
    rowId: "row-1",
    claimId: "claim-row-first"
  }), true);
  assert.equal(await fixture.service.claimRow({
    messageId: "message-1",
    lootId: "loot-1",
    rowId: "row-1",
    claimId: "claim-row-second"
  }), false);
  assert.equal(fixture.effects.rows, 1);
});

test("loot batch reads once, grants once, and commits only accepted filtered rows plus coins", async () => {
  let state = {
    lootId: "loot-batch",
    rows: [
      { rowId: "folder", name: "Sword", claimed: false },
      { rowId: "skip", name: "Journal", claimed: false },
      { rowId: "dismantle", name: "Axe", claimed: false }
    ],
    coins: { gp: 2, totalCopper: 200 },
    coinsClaimed: false,
    claims: []
  };
  const calls = { read: 0, write: 0, grantBatch: 0 };
  const service = new LootClaimService({
    getMessage: async () => ({ id: "message-batch" }),
    readState: async () => {
      calls.read += 1;
      return clone(state);
    },
    writeState: async (_message, nextState) => {
      calls.write += 1;
      state = clone(nextState);
    },
    grantRow: async () => { throw new Error("per-row grant must not run"); },
    grantCoins: async () => { throw new Error("separate coin grant must not run"); },
    grantBatch: async ({ rows, coins, ingressPlan }) => {
      calls.grantBatch += 1;
      assert.deepEqual(rows.map((row) => row.rowId), ["folder", "skip", "dismantle"]);
      assert.equal(coins.gp, 2);
      assert.deepEqual(ingressPlan, { version: 1 });
      return {
        acceptedRowIds: ["folder", "dismantle"],
        coinsGranted: true,
        receipt: { batchMutationId: "batch-1" }
      };
    }
  });

  const result = await service.claimBatch({
    messageId: "message-batch",
    lootId: "loot-batch",
    claimId: "batch-1",
    rowIds: ["folder", "skip", "dismantle"],
    includeCoins: true,
    ingressPlan: { version: 1 }
  });

  assert.deepEqual(result, {
    changed: true,
    claimedRowIds: ["folder", "dismantle"],
    claimedCoins: true,
    receipt: { batchMutationId: "batch-1" }
  });
  assert.deepEqual(calls, { read: 1, write: 3, grantBatch: 1 });
  assert.deepEqual(state.rows.map((row) => row.claimed), [true, false, true]);
  assert.equal(state.coinsClaimed, true);
});

test("loot batch retry reuses its receipt and conflicting request fingerprint is rejected", async () => {
  let state = {
    lootId: "loot-retry",
    rows: [{ rowId: "row-1", claimed: false }],
    coins: {},
    coinsClaimed: true,
    claims: []
  };
  let failGrantedWrite = true;
  let grantCalls = 0;
  const service = new LootClaimService({
    getMessage: async () => ({ id: "message-retry" }),
    readState: async () => clone(state),
    writeState: async (_message, nextState) => {
      const claim = nextState.claims.find((entry) => entry.id === "batch-retry");
      if (failGrantedWrite && claim?.phase === "granted") {
        failGrantedWrite = false;
        throw new Error("batch receipt write failed");
      }
      state = clone(nextState);
    },
    grantRow: async () => {},
    grantCoins: async () => {},
    grantBatch: async () => {
      grantCalls += 1;
      return {
        acceptedRowIds: ["row-1"],
        coinsGranted: false,
        receipt: { stable: true }
      };
    }
  });
  const request = {
    messageId: "message-retry",
    lootId: "loot-retry",
    claimId: "batch-retry",
    rowIds: ["row-1"],
    includeCoins: false,
    ingressPlan: { version: 1 }
  };

  await assert.rejects(service.claimBatch(request), /batch receipt write failed/u);
  const result = await service.claimBatch(request);
  const terminal = await service.claimBatch(request);

  assert.deepEqual(terminal, result);
  assert.equal(grantCalls, 2);
  assert.equal(state.rows[0].claimed, true);
  await assert.rejects(
    service.claimBatch({ ...request, rowIds: [] }),
    /conflicts/u
  );
});
