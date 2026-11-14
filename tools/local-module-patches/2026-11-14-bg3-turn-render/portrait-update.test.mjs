import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = process.env.REBREYA_BG3_TEST_ROOT ?? new URL("../../../../bg3-inspired-hotbar/", import.meta.url);
const source = await readFile(new URL("scripts/bg3-hotbar.js", root), "utf8");
const start = source.indexOf("    async _onUpdateActor(");
const end = source.indexOf("    async _onUpdateActive(", start);
assert.ok(start >= 0 && end > start);
const construct = new Function("game", "BG3CONFIG", `return class {${source.slice(start, end)}};`);

test("BG3 renders the current portrait once per update and preserves other actor updates", async () => {
  const ActorUpdates = construct({user: {id: "local"}}, {MODULE_NAME: "bg3-inspired-hotbar"});
  const actor = {id: "a"}, ui = new ActorUpdates(), calls = [];
  Object.assign(ui, {element: [{}], manager: {actor, socketUpdateData: () => calls.push("socket")}, components: {
    portrait: {_renderInner: () => calls.push("portrait")}, container: {components: {
      passiveContainer: {render: () => calls.push("passives")}, filterContainer: {render: () => calls.push("slots")}
    }}
  }, itemUpdateManager: {cleanupInvalidItems: () => calls.push("cleanup")}});
  for (const key of ["weaponModMovement", "reactionState"]) {
    await ui._onUpdateActor(actor, {flags: {"rebreya-main": {[key]: {}}}}, {}, "local");
  }
  assert.deepEqual(calls.splice(0), ["portrait", "portrait"]);
  await ui._onUpdateActor(actor, {flags: {other: {}}, system: {spells: {}}, items: []}, {}, "local");
  assert.deepEqual(calls.splice(0), ["portrait", "slots", "passives", "cleanup"]);
  await ui._onUpdateActor(actor, {name: "New name"}, {}, "local");
  await ui._onUpdateActor({id: "other"}, {flags: {foo: {}}}, {}, "local");
  await ui._onUpdateActor(actor, {flags: {"bg3-inspired-hotbar": {}}}, {}, "remote");
  assert.deepEqual(calls, ["portrait", "socket"]);
});
