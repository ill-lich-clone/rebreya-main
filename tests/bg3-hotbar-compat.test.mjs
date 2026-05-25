import test from "node:test";
import assert from "node:assert/strict";

const {
  applyBg3HotbarAutoAddSuppression,
  shouldSuppressBg3HotbarAutoAdd
} = await import("../scripts/hooks.js");

function makeItem({ type = "feat", rebreyaFlags = {}, teyvankalFlags = null } = {}) {
  return {
    type,
    flags: {
      ...(Object.keys(rebreyaFlags).length ? { "rebreya-main": rebreyaFlags } : {}),
      ...(teyvankalFlags ? { teyvankal: teyvankalFlags } : {})
    },
    getFlag: (scope, key) => scope === "rebreya-main" ? rebreyaFlags[key] : undefined
  };
}

test("BG3 hotbar auto-add suppression marks Rebreya feat creations", () => {
  const options = {};
  const item = makeItem({ rebreyaFlags: { automation: { status: "partial" } } });

  assert.equal(shouldSuppressBg3HotbarAutoAdd(item), true);
  assert.equal(applyBg3HotbarAutoAddSuppression(item, options), true);
  assert.equal(options.noBG3AutoAdd, true);
});

test("BG3 hotbar auto-add suppression covers Teyvankal feat data", () => {
  const options = {};
  const item = makeItem({ teyvankalFlags: { section: "Младшие черты" } });

  assert.equal(shouldSuppressBg3HotbarAutoAdd(item), true);
  assert.equal(applyBg3HotbarAutoAddSuppression(item, options), true);
  assert.equal(options.noBG3AutoAdd, true);
});

test("BG3 hotbar auto-add suppression leaves unrelated items alone", () => {
  const options = {};

  assert.equal(shouldSuppressBg3HotbarAutoAdd(makeItem({ type: "weapon", rebreyaFlags: { managed: true } })), false);
  assert.equal(shouldSuppressBg3HotbarAutoAdd(makeItem({ type: "feat" })), false);
  assert.equal(applyBg3HotbarAutoAddSuppression(makeItem({ type: "feat" }), options), false);
  assert.equal(options.noBG3AutoAdd, undefined);
});
