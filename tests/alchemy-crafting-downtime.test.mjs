import test from "node:test";
import assert from "node:assert/strict";
import { AlchemyCraftingService } from "../scripts/data/alchemy-crafting-service.js";

test("laboratory uses the existing schedule, defers output until the end and confirms it once", async () => {
  const state = {};
  const requests = [];
  const snapshots = { requests, scheduleSlots: [], balance: { availableWeeks: 5 } };
  let outputs = 0;
  let reserves = 0;
  let failApproval = false;
  const moduleApi = {
    getDowntimeActionCatalog: async () => [{ id: "lab-item", downtimeId: "laboratory-alchemy" }],
    downtimeService: {
      getSnapshot: () => snapshots,
      async createRequest(input) {
        const row = { ...input, id: "downtime-1", status: "pending" };
        requests.push(row);
        return row;
      },
      async setRequestStatus(_id, status) {
        if (failApproval) { failApproval = false; throw new Error("schedule write failed"); }
        requests[0].status = status;
        return requests[0];
      },
      async recordAlchemyCraftOutput({ itemId }) { requests[0].alchemyCraft.itemId = itemId; return requests[0]; }
    }
  };
  const service = new AlchemyCraftingService({
    moduleApi,
    repository: { readObject: () => state, async mutateObject(_key, fn) { return fn(state); } }
  });
  service.quote = async () => ({ errors: [], weeks: 3, goldGp: 42, output: { productId: "alchemy-78" } });
  service.applyCraft = async (input) => {
    reserves++;
    assert.equal(input.quote.goldGp, 42);
    return service.save({ ...input, output: input.quote.output, phase: "committed", receipts: [] });
  };
  service.createCraftedPotionOnce = async () => { outputs++; return "result-id"; };
  service.unlockCraftedPotion = async () => {};
  const gm = { sender: { id: "gm", isGM: true }, assertActiveGm() {} };
  const intent = { actorId: "hero", groupId: "party", operationId: "operation", productId: "alchemy-78", selection: {} };
  const request = await service.submitLaboratory(intent, gm);
  assert.equal(request.weeks, 3);
  assert.equal(request.actionId, "lab-item");
  const route = { groupId: "party", actorId: "hero", requestId: request.id };
  failApproval = true;
  await assert.rejects(service.laboratoryStatus({ ...route, status: "approved" }, gm), /schedule write failed/);
  assert.equal(state["lab:operation"].phase, "compensated");
  await service.laboratoryStatus({ ...route, status: "approved" }, gm);
  await service.laboratoryStatus({ ...route, status: "approved" }, gm);
  assert.equal(reserves, 2);
  assert.equal(outputs, 0);
  await assert.rejects(service.laboratoryStatus({ ...route, status: "completed" }, gm), /календар/i);
  request.status = "completed";
  await service.laboratoryStatus({ ...route, status: "completed" }, gm);
  await service.laboratoryStatus({ ...route, status: "completed" }, gm);
  assert.equal(outputs, 1);
});

test("laboratory cancellation closes the schedule before any resource refund", async () => {
  const request = { id: "downtime-2", actorId: "hero", status: "approved", weeks: 1, workdays: 5,
    alchemyCraft: { operationId: "cancelled", productId: "alchemy-78" } };
  const state = { "lab:cancelled": { phase: "committed", operationId: "lab:cancelled", receipts: [] } };
  let fail = true;
  let refunds = 0;
  const service = new AlchemyCraftingService({
    moduleApi: { downtimeService: {
      getSnapshot: () => ({ requests: [request], scheduleSlots: [] }),
      async setRequestStatus(_id, status, options) {
        if (fail) { fail = false; throw new Error("schedule write failed"); }
        request.status = status;
        request.alchemyCraft.refundPending = options.alchemyCraftRefundPending;
        return request;
      },
      async recordAlchemyCraftRefund() { request.alchemyCraft.refundPending = false; return request; }
    } },
    repository: { readObject: () => state, async mutateObject(_key, fn) { return fn(state); } }
  });
  service.refundLaboratory = async () => {
    assert.equal(request.status, "rejected");
    assert.equal(request.alchemyCraft.refundPending, true);
    refunds++;
  };
  const gm = { sender: { isGM: true }, assertActiveGm() {} };
  const command = { groupId: "party", actorId: "hero", requestId: request.id, status: "rejected" };
  await assert.rejects(service.laboratoryStatus(command, gm), /schedule write failed/);
  assert.equal(refunds, 0);
  assert.equal(request.status, "approved");
  await service.laboratoryStatus(command, gm);
  assert.equal(refunds, 1);
  assert.equal(request.alchemyCraft.refundPending, false);
});
