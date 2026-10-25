import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = process.env.BG3_TEST_ROOT ?? fileURLToPath(new URL("../../../../bg3-inspired-hotbar/", import.meta.url));
const read = path => readFileSync(`${root}/${path}`, "utf8");
function fixture({ loseContext = false, targeting = true, needsTargeting = true } = {}) {
  const calls = { resolve: [], use: [], targets: [], warnings: [], timers: [] };
  const actor = { id: "a", uuid: "Scene.new.Token.t.Actor.a", items: new Map() };
  const token = { id: "t", actor, document: { id: "t", uuid: "Scene.new.Token.t", parent: { id: "new" }, actor } };
  const activity = { id: "act", use: async () => calls.use.push("activity") };
  const item = { id: "i", actor, uuid: `${actor.uuid}.Item.i`, system: { activities: new Map([["act", activity]]) }, use: async () => calls.use.push("item") };
  actor.items.set("i", item);
  const manager = { token };
  const legacy = { old: true };
  class Component { constructor(data) { this.data = data; } }
  const context = {
    BG3Component: Component, Application: class {},
    ui: { BG3HOTBAR: { manager }, notifications: { warn: text => calls.warnings.push(text) } },
    canvas: { scene: { id: "new" }, tokens: { get: id => id === manager.token?.id ? manager.token : null, setTargets: (...args) => calls.targets.push(args) } },
    game: { settings: { get: () => targeting } },
    foundry: { utils: {} },
    fromUuid: async uuid => { calls.resolve.push(uuid); return legacy; },
    setTimeout: callback => { calls.timers.push(callback); return calls.timers.length; },
    async importModule(path) {
      if (path.includes("targetingRules")) return { needsActivityTargeting: () => needsTargeting, getActivityTargetRequirements: () => ({}) };
      if (path.includes("TargetSelector")) return { TargetSelector: class { async select() {
        if (loseContext) manager.token = { ...token, document: { ...token.document } };
        return [{ id: "target" }];
      } } };
      throw Error(`Unexpected import ${path}`);
    }
  };
  const originalResolver = context.fromUuid;
  const helpers = read("scripts/utils/foundryUtils.js").replace(/^export /gm, "");
  runInNewContext(`${helpers}\nglobalThis.helpers = { fromUuid, ...(typeof isItemUseContextCurrent === 'function' ? {isItemUseContextCurrent} : {}) };`, context);
  // The helper's global fallback must be the native resolver, not itself.
  context.fromUuid = originalResolver;
  function load(path, name) {
    const source = read(path).replace(/^import .*\r?$/gm, "").replace(`export class ${name}`, `class ${name}`).replace(/\bimport\s*\(/g, "importModule(");
    const injected = { ...context, fromUuid: context.helpers.fromUuid, isItemUseContextCurrent: context.helpers.isItemUseContextCurrent };
    runInNewContext(`${source}\nglobalThis.Result = ${name};`, injected);
    return injected.Result;
  }
  const Cell = load("scripts/components/containers/GridCell.js", "GridCell");
  const HUD = load("scripts/bg3-hotbar.js", "BG3Hotbar");
  const cell = new Cell({ item: { uuid: "Scene.old.Token.t.Actor.a.Item.i" } });
  cell._renderInner = () => {};
  return { context, calls, actor, token, manager, item, activity, legacy, cell, HUD };
}

test("own stored cross-scene Item UUID resolves to live current-token Item", async () => {
  const f = fixture();
  assert.equal(await f.context.helpers.fromUuid("Scene.old.Token.t.Actor.a.Item.i", { token: f.token }), f.item);
  assert.deepEqual(f.calls.resolve, []);
});

test("GridCell resolves through current token while leaving stored layout untouched", async () => {
  const f = fixture();
  assert.equal(await f.cell.item, f.item);
  assert.equal(f.cell.data.item.uuid, "Scene.old.Token.t.Actor.a.Item.i");
});

test("foreign token/actor, world Actor, Macro and Compendium references retain native resolution", async () => {
  const f = fixture();
  for (const uuid of ["Scene.old.Token.other.Actor.a.Item.i", "Scene.old.Token.t.Actor.other.Item.i", "Actor.a.Item.i", "Macro.m", "Compendium.pack.name.Item.i"]) {
    assert.equal(await f.context.helpers.fromUuid(uuid, { token: f.token }), f.legacy);
  }
  assert.equal(f.calls.resolve.length, 5);
});

test("a live foreign scene reference with matching actor and token IDs stays foreign", async () => {
  const f = fixture();
  f.context.game.scenes = new Map([["old", { tokens: new Map([["t", { id: "t" }]]) }]]);
  assert.equal(await f.context.helpers.fromUuid("Scene.old.Token.t.Actor.a.Item.i", { token: f.token }), f.legacy);
  assert.deepEqual(f.calls.resolve, ["Scene.old.Token.t.Actor.a.Item.i"]);
});

test("missing current own Item is not substituted by a similarly named or old Item", async () => {
  const f = fixture(); f.actor.items.delete("i");
  assert.equal(await f.context.helpers.fromUuid("Scene.old.Token.t.Actor.a.Item.i", { token: f.token }), null);
  assert.deepEqual(f.calls.resolve, []);
});

for (const loseContext of [false, true]) {
  test(`GridCell targeting ${loseContext ? "cancels lost context" : "uses stable context once"}`, async () => {
    const f = fixture({ loseContext });
    await f.cell.useItemDirectly(f.item, {});
    assert.equal(f.calls.use.length, loseContext ? 0 : 1);
    assert.equal(f.calls.targets.length, loseContext ? 0 : 1);
  });

  test(`activity dialog targeting ${loseContext ? "cancels lost context" : "uses stable context once"}`, async () => {
    const f = fixture({ loseContext }); let click;
    const button = { dataset: { activityId: "act" }, addEventListener(_type, handler) { click = handler; } };
    const app = { options: { classes: ["dnd5e2"] }, item: f.item, close: async () => {} };
    await f.HUD.prototype._onRenderActivityDialog.call({}, app, { querySelectorAll: () => [button] });
    f.calls.timers.shift()();
    await click({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
    assert.equal(f.calls.use.length, loseContext ? 0 : 1);
    assert.equal(f.calls.targets.length, loseContext ? 0 : 1);
  });
}

test("activity without targeting removes its exact capture listener and invokes native click once", async () => {
  const f = fixture({ needsTargeting: false }); let click, nativeClicks = 0, removals = 0;
  const button = {
    dataset: { activityId: "act" }, addEventListener(_type, handler) { click = handler; },
    removeEventListener(type, handler, capture) { assert.equal(type, "click"); assert.equal(handler, click); assert.equal(capture, true); removals++; },
    click() { nativeClicks++; }
  };
  await f.HUD.prototype._onRenderActivityDialog.call({}, { options: { classes: ["dnd5e2"] }, item: f.item }, { querySelectorAll: () => [button] });
  f.calls.timers.shift()();
  await click({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  assert.equal(removals, 1); assert.equal(nativeClicks, 1); assert.deepEqual(f.calls.use, []); assert.deepEqual(f.calls.targets, []);
});

test("activity targeting cancels safely if HUD or manager disappears before clicking", async () => {
  for (const missing of ["hud", "manager"]) {
    const f = fixture(); let click;
    const button = { dataset: { activityId: "act" }, addEventListener(_type, handler) { click = handler; } };
    await f.HUD.prototype._onRenderActivityDialog.call({}, { options: { classes: ["dnd5e2"] }, item: f.item }, { querySelectorAll: () => [button] });
    f.calls.timers.shift()();
    if (missing === "hud") delete f.context.ui.BG3HOTBAR; else delete f.context.ui.BG3HOTBAR.manager;
    await click({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
    assert.deepEqual(f.calls.use, []); assert.deepEqual(f.calls.targets, []); assert.equal(f.calls.warnings.length, 1);
  }
});

test("native activity click also cancels when its own Item has been replaced", async () => {
  const f = fixture({ needsTargeting: false }); let click, nativeClicks = 0;
  const button = { dataset: { activityId: "act" }, addEventListener(_type, handler) { click = handler; }, removeEventListener() {}, click() { nativeClicks++; } };
  await f.HUD.prototype._onRenderActivityDialog.call({}, { options: { classes: ["dnd5e2"] }, item: f.item }, { querySelectorAll: () => [button] });
  f.calls.timers.shift()();
  f.actor.items.set("i", { ...f.item });
  await click({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} });
  assert.equal(nativeClicks, 0); assert.deepEqual(f.calls.use, []); assert.deepEqual(f.calls.targets, []); assert.equal(f.calls.warnings.length, 1);
});

test("old own Item passed directly cannot start a use against the replaced Actor", async () => {
  const f = fixture({ targeting: false });
  await f.cell.useItemDirectly({ ...f.item, uuid: "Scene.old.Token.t.Actor.a.Item.i", actor: { ...f.actor } }, {});
  assert.deepEqual(f.calls.use, []);
});

test("delayed target cleanup does not clear the next token's targets", async () => {
  const f = fixture(); await f.cell.useItemDirectly(f.item, {});
  f.manager.token = { ...f.token };
  f.calls.timers.shift()();
  assert.equal(f.calls.targets.length, 1);
});
