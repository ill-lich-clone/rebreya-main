import test from "node:test";
import assert from "node:assert/strict";

const {
  applyBg3HotbarAutoAddSuppression,
  registerSceneControlsHook,
  shouldSuppressBg3HotbarAutoAdd
} = await import("../scripts/hooks.js");

function withSceneControlsHandler(callback) {
  const previousHooks = globalThis.Hooks;
  const previousGame = globalThis.game;
  const previousUi = globalThis.ui;
  const handlers = [];

  globalThis.Hooks = {
    on: (hookName, handler) => {
      if (hookName === "getSceneControlButtons") {
        handlers.push(handler);
      }
    }
  };
  globalThis.game = {
    i18n: { localize: (key) => key },
    settings: { get: () => true },
    user: { isGM: true }
  };
  globalThis.ui = {
    controls: { render: () => undefined }
  };

  try {
    registerSceneControlsHook();
    assert.equal(handlers.length, 1);
    callback(handlers[0]);
  }
  finally {
    globalThis.Hooks = previousHooks;
    globalThis.game = previousGame;
    globalThis.ui = previousUi;
  }
}

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

test("scene controls create a separate Rebreya group for record controls", () => {
  withSceneControlsHandler((handler) => {
    const controls = {
      tokens: {
        name: "tokens",
        order: 20,
        tools: {}
      }
    };

    handler(controls);

    assert.deepEqual(controls.tokens.tools, {});
    assert.ok(controls["rebreya-main-rebreya"]);
    assert.equal(controls["rebreya-main-rebreya"].activeTool, "rebreya-main-panel");
    assert.equal(controls["rebreya-main-rebreya"].tools["rebreya-main-panel"].onChange, undefined);
    assert.equal(controls["rebreya-main-rebreya"].tools["rebreya-main-panel"].button, undefined);
    assert.deepEqual(Object.keys(controls["rebreya-main-rebreya"].tools), [
      "rebreya-main-panel",
      "rebreya-main-economy",
      "rebreya-main-inventory",
      "rebreya-main-calendar",
      "rebreya-main-lootgen"
    ]);
  });
});

test("scene controls create a separate Rebreya group for array controls", () => {
  withSceneControlsHandler((handler) => {
    const tokenControl = {
      name: "tokens",
      order: 20,
      tools: []
    };
    const controls = [
      { name: "measure", order: 10, tools: [] },
      tokenControl,
      { name: "tiles", order: 30, tools: [] }
    ];

    handler(controls);

    assert.deepEqual(tokenControl.tools, []);
    const rebreyaIndex = controls.findIndex((control) => control?.name === "rebreya-main-rebreya");
    assert.equal(rebreyaIndex, 2);
    assert.equal(controls[rebreyaIndex].activeTool, "rebreya-main-panel");
    assert.equal(controls[rebreyaIndex].tools.find((tool) => tool.name === "rebreya-main-panel").onChange, undefined);
    assert.equal(controls[rebreyaIndex].tools.find((tool) => tool.name === "rebreya-main-panel").button, undefined);
    assert.deepEqual(controls[rebreyaIndex].tools.map((tool) => tool.name), [
      "rebreya-main-panel",
      "rebreya-main-economy",
      "rebreya-main-inventory",
      "rebreya-main-calendar",
      "rebreya-main-lootgen"
    ]);
  });
});
