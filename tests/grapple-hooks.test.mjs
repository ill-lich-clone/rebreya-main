import assert from "node:assert/strict";
import test from "node:test";

import { MODULE_ID } from "../scripts/constants.js";
import { GRAPPLE_LINK_FLAG } from "../scripts/combat/grapple-automation-service.js";
import { registerGrappleHooks } from "../scripts/combat/grapple-hooks.js";

function hooksRegistry() {
  const entries = new Map();
  return {
    on(event, callback) {
      const list = entries.get(event) ?? [];
      list.push(callback);
      entries.set(event, list);
      return callback;
    },
    call(event, ...args) {
      return (entries.get(event) ?? []).map((callback) => callback(...args));
    },
    count(event) { return (entries.get(event) ?? []).length; }
  };
}

function sourceToken() {
  const uuid = "Scene.scene.Token.source";
  return {
    id: "source",
    uuid,
    x: 10,
    y: 20,
    flags: {},
    actor: {
      flags: { [MODULE_ID]: { handReservations: [{
        linkId: "link-1", kind: "grapple", handSlot: "left",
        sourceTokenUuid: uuid, targetTokenUuid: "Scene.scene.Token.target"
      }] } },
      items: { contents: [] },
      effects: { contents: [] },
      getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
    },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  };
}

function targetToken() {
  const link = {
    linkId: "link-1", kind: "grapple", handSlot: "left",
    sourceTokenUuid: "Scene.scene.Token.source", targetTokenUuid: "Scene.scene.Token.target"
  };
  return {
    id: "target",
    uuid: link.targetTokenUuid,
    x: 100,
    y: 200,
    flags: { [MODULE_ID]: { [GRAPPLE_LINK_FLAG]: link } },
    actor: { flags: {}, items: { contents: [] }, effects: { contents: [] } },
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function environment({ dialogChoice = "cancel", showMoveDialog = null, dragError = null, TokenClass = undefined } = {}) {
  const Hooks = hooksRegistry();
  const calls = { drag: [], releaseMove: [], effects: [], tokens: [], scenes: [], dialogs: [], errors: [] };
  const moduleApi = {
    async requestDragFromTokenUpdate(payload) {
      calls.drag.push(payload);
      if (dragError) throw dragError;
    },
    async requestReleaseAndMove(payload) { calls.releaseMove.push(payload); },
    async handleManagedEffectDeleted(effect) { calls.effects.push(effect); },
    async handleTokenDeleted(token) { calls.tokens.push(token); },
    async reconcileScene(scene) { calls.scenes.push(scene); }
  };
  registerGrappleHooks(moduleApi, {
    Hooks,
    showMoveDialog: showMoveDialog ?? (async (config) => {
      calls.dialogs.push(config);
      return dialogChoice;
    }),
    randomId: () => `operation-${calls.drag.length + calls.releaseMove.length + 1}`,
    isActiveGmClient: () => true,
    gameProvider: () => ({ user: { id: "player-a" } }),
    notifyError: (message) => calls.errors.push(message),
    TokenClass
  });
  return { Hooks, calls, moduleApi };
}

test("registers one hook for each grapple lifecycle surface", () => {
  const env = environment();
  for (const event of ["preUpdateToken", "deleteActiveEffect", "deleteToken", "canvasReady", "ready"]) {
    assert.equal(env.Hooks.count(event), 1, event);
  }
});

test("source UI drag ignores token footprints during dnd5e preview pathfinding", () => {
  class TokenPlaceable {
    constructor(document) {
      this.document = document;
      this.actor = document.actor;
    }

    _getDragConstrainOptions() {
      return { ignoreWalls: false, ignoreCost: false };
    }
  }

  environment({ TokenClass: TokenPlaceable });

  const source = new TokenPlaceable(sourceToken());
  assert.deepEqual(source._getDragConstrainOptions(), {
    ignoreWalls: false,
    ignoreCost: false,
    ignoreTokens: true
  });

  const ordinaryDocument = sourceToken();
  ordinaryDocument.actor.flags[MODULE_ID].handReservations = [];
  const ordinary = new TokenPlaceable(ordinaryDocument);
  assert.deepEqual(ordinary._getDragConstrainOptions(), {
    ignoreWalls: false,
    ignoreCost: false
  });
});

test("source movement removes only coordinates and schedules one authoritative grouped drag", async () => {
  const env = environment();
  const token = sourceToken();
  const changed = { x: 500, y: 600, alpha: 0.5 };
  assert.deepEqual(env.Hooks.call("preUpdateToken", token, changed, {}, "player-a"), [undefined]);
  assert.deepEqual(changed, { alpha: 0.5 });
  await flush();
  assert.deepEqual(env.calls.drag, [{
    sourceTokenUuid: token.uuid,
    x: 500,
    y: 600,
    operationId: "grapple-drag-operation-1",
    requesterUserId: "player-a"
  }]);

  const onlyPosition = { x: 700 };
  assert.deepEqual(env.Hooks.call("preUpdateToken", token, onlyPosition, {}, "player-a"), [false]);
  assert.deepEqual(onlyPosition, {});
});

test("source drag recovers the requested waypoint after dnd5e removes blocked coordinates", async () => {
  const env = environment();
  const token = sourceToken();
  const changed = {};
  const options = {
    movement: {
      [token.id]: {
        method: "dragging",
        waypoints: [{ x: 110, y: 20, action: "walk" }],
        constrainOptions: {}
      }
    }
  };

  assert.deepEqual(env.Hooks.call("preUpdateToken", token, changed, options, "player-a"), [false]);
  await flush();

  assert.deepEqual(env.calls.drag.map(({ x, y }) => [x, y]), [[110, 20]]);
});

test("source drag prefers the requested waypoint over coordinates clipped by dnd5e", async () => {
  const env = environment();
  const token = sourceToken();
  const changed = { x: 10, y: 20, _movementHistory: [{ x: 10, y: 20 }] };
  const options = {
    movement: {
      [token.id]: {
        method: "dragging",
        waypoints: [{ x: 110, y: 20, action: "walk" }],
        constrainOptions: {}
      }
    }
  };

  assert.deepEqual(env.Hooks.call("preUpdateToken", token, changed, options, "player-a"), [false]);
  assert.deepEqual(changed, {});
  await flush();

  assert.deepEqual(env.calls.drag.map(({ x, y }) => [x, y]), [[110, 20]]);
});

test("source movement reports a localized grapple error instead of an internal code", async () => {
  const error = new Error("outside-reach");
  error.code = "outside-reach";
  const env = environment({ dragError: error });

  env.Hooks.call("preUpdateToken", sourceToken(), { x: 500, y: 600 }, {}, "player-a");
  await flush();

  assert.deepEqual(env.calls.errors, ["Автоматика захвата: схваченное существо нельзя переместить в эту точку"]);
});

test("grapple bypass preserves the original movement patch", async () => {
  const env = environment();
  const changed = { x: 500, y: 600 };
  env.Hooks.call("preUpdateToken", sourceToken(), changed, {
    [MODULE_ID]: { grappleBypass: true }
  }, "player-a");
  await flush();
  assert.deepEqual(changed, { x: 500, y: 600 });
  assert.equal(env.calls.drag.length, 0);
});

test("target movement shows the Russian choice and release button clears the link before moving", async () => {
  const env = environment({ dialogChoice: "release" });
  const token = targetToken();
  const changed = { x: 500, y: 600, alpha: 0.5 };
  env.Hooks.call("preUpdateToken", token, changed, {}, "player-a");
  assert.deepEqual(changed, { alpha: 0.5 });
  await flush();

  assert.equal(env.calls.dialogs[0].title, "Существо было схвачено");
  assert.deepEqual(env.calls.dialogs[0].buttons.map((button) => button.label), [
    "Отменить захват",
    "Отменить перемещение"
  ]);
  assert.deepEqual(env.calls.releaseMove, [{
    targetTokenUuid: token.uuid,
    linkId: "link-1",
    x: 500,
    y: 600,
    operationId: "grapple-release-move-operation-1",
    requesterUserId: "player-a"
  }]);
});

test("cancel, close, and duplicate target updates do not move or open parallel dialogs", async () => {
  const pending = deferred();
  let dialogCount = 0;
  const env = environment({ showMoveDialog: async () => {
    dialogCount += 1;
    return pending.promise;
  } });
  const token = targetToken();
  env.Hooks.call("preUpdateToken", token, { x: 300 }, {}, "player-a");
  env.Hooks.call("preUpdateToken", token, { y: 400 }, {}, "player-a");
  await flush();
  assert.equal(dialogCount, 1);
  pending.resolve(null);
  await flush();
  assert.equal(env.calls.releaseMove.length, 0);
});

test("ordinary token movement is left byte-for-byte unchanged", () => {
  const env = environment();
  const token = targetToken();
  token.flags = {};
  const changed = { x: 500, alpha: 0.25 };
  assert.deepEqual(env.Hooks.call("preUpdateToken", token, changed, {}, "player-a"), [undefined]);
  assert.deepEqual(changed, { x: 500, alpha: 0.25 });
});

test("effect/token cleanup and active-GM scene reconciliation route through the service", async () => {
  const env = environment();
  const effect = { id: "effect" };
  const token = targetToken();
  const scene = { id: "scene" };
  env.Hooks.call("deleteActiveEffect", effect, {}, "player-a");
  env.Hooks.call("deleteToken", token, {}, "player-a");
  env.Hooks.call("canvasReady", { scene });
  env.Hooks.call("ready");
  await flush();
  assert.deepEqual(env.calls.effects, [effect]);
  assert.deepEqual(env.calls.tokens, [token]);
  assert.deepEqual(env.calls.scenes, [scene]);
});
