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
