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
