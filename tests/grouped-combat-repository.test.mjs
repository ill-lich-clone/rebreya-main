import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { GroupedCombatRepository } from "../scripts/infrastructure/foundry/grouped-combat-repository.js";
import { buildPhaseStepKey } from "../scripts/combat/turn-group-rules.js";

const appRoot = process.env.REBREYA_FOUNDRY_APP_ROOT ?? "D:/FoundryVTT/Foundry Virtual Tabletop/resources/app";
const { expandObject, mergeObject } = await import(pathToFileURL(join(appRoot, "common/utils/helpers.mjs")).href);

test("combat state survives native Foundry expansion/merge and removes completed transient fields", async () => {
  const combat = { id: "fight", flags: {}, async update(data) { mergeObject(this, expandObject(data), { performDeletions: true }); } };
  const repository = new GroupedCombatRepository();
  const key = buildPhaseStepKey("fight", { kind: "turn-start", round: 1, groupId: "g" }, "a", "dae", "Actor.a.ActiveEffect.effect");
  const state = { version: 1, revision: 0, receipts: { [key]: { status: "running" } }, executionPosition: { round: 1, groupId: "g" }, pendingTransition: { operationId: "op" } };
  await repository.writeState(combat, state);
  assert.deepEqual(repository.readState(combat), state, "UUID-bearing receipt keys must stay intact through expandObject");
  state.receipts[key].status = "done"; delete state.executionPosition; delete state.pendingTransition;
  await repository.writeState(combat, state, { expectedRevision: state.revision });
  assert.deepEqual(repository.readState(combat), state, "finished transition fields must be removed, rather than merged back");
  delete state.receipts[key];
  await repository.writeState(combat, state, { expectedRevision: state.revision });
  assert.equal(Object.keys(repository.readState(combat).receipts).length, 0, "explicit retry removes the old receipt");
});

test("persistent step keys cannot become dotted Foundry paths or special update directives", () => {
  const key = buildPhaseStepKey("fight", { kind: "turn-start", round: 1, groupId: "g" }, "a", "midi-qol", "Actor.a.Item.spell.ActiveEffect.effect");
  assert.equal(key.includes("."), false); assert.equal(key.startsWith("==") || key.startsWith("-="), false);
});

test("receipt patches preserve native flags/CAS and their size does not grow with completed history", async () => {
  const updates = [], combat = { id: "fight", flags: {}, async update(data, options) { updates.push({ data, options }); mergeObject(this, expandObject(data), { performDeletions: true }); } };
  const repository = new GroupedCombatRepository(), key = buildPhaseStepKey("fight", { round: 1, groupId: "g", kind: "turn-start" }, "a", "dae", "Actor.a.ActiveEffect.active");
  const state = { version: 1, mode: "active", revision: 0, groups: [], receipts: {}, pendingTransition: { operationId: "op" }, durationAnchors: { old: { round: 1 } } };
  for (let i = 0; i < 1000; i++) state.receipts[`old${i}`] = { status: "done", operationId: `old-operation-${i}` };
  await repository.writeState(combat, state);
  const fullBytes = Buffer.byteLength(JSON.stringify(updates[0].data));
  state.receipts[key] = { status: "running", provider: "dae", effectUuid: "Actor.a.ActiveEffect.active" };
  await repository.writeReceipt(combat, state, key, { expectedRevision: state.revision });
  const patch = updates.at(-1);
  assert.ok(Buffer.byteLength(JSON.stringify(patch.data)) < 1000);
  assert.ok(Buffer.byteLength(JSON.stringify(patch.data)) < fullBytes / 50);
  assert.equal(patch.options["rebreya-main"].groupedCombatProgress, true);
  assert.equal(repository.readState(combat).receipts.old999.status, "done");
  assert.deepEqual(repository.readState(combat).durationAnchors, state.durationAnchors);
  state.receipts[key].status = "done";
  await repository.writeReceipt(combat, state, key, { expectedRevision: state.revision });
  assert.equal(repository.readState(combat).receipts[key].status, "done");
  state.receipts[key] = { status: "done", reason: "member-unavailable" };
  await repository.writeReceipt(combat, state, key, { expectedRevision: state.revision });
  assert.deepEqual(repository.readState(combat).receipts[key], state.receipts[key], "replacement must not retain stale effect metadata");
  await assert.rejects(repository.writeReceipt(combat, state, key, { expectedRevision: state.revision - 1 }), /stale-combat/);
  delete state.pendingTransition;
  await repository.writeState(combat, state, { expectedRevision: state.revision });
  assert.equal(repository.readState(combat).pendingTransition, undefined);
});
