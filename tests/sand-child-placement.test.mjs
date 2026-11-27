import test from "node:test";
import assert from "node:assert/strict";
import { SandChildPlacement } from "../scripts/ui/sand-child-placement.js";

class Element extends EventTarget {
  constructor() {
    super();
    this.children = [];
    this.dataset = {};
    this.style = {};
  }
  append(...children) {
    for (const child of children) child.parentNode = this;
    this.children.push(...children);
  }
  remove() {
    this.parentNode.children = this.parentNode.children.filter(child => child !== this);
  }
  setAttribute() {}
  focus() {}
  querySelector(selector) {
    if (selector === ".col.right") return this.children.find(child => child.className === "col right");
    const action = /data-rm-sand-hud="(.*)"/u.exec(selector)?.[1];
    return this.children.find(child => child.dataset.rmSandHud === action);
  }
}

test("a single owner HUD control reopens the exact movement selection", async () => {
  const globalEvents = new EventTarget();
  const document = { body: new Element(), createElement: () => new Element() };
  const parent = { id: "scene", grid: { size: 100 } };
  const actor = { testUserPermission: user => user.id === "player" };
  const token = { id: "token", uuid: "Scene.scene.Token.token", parent, actor };
  const user = { id: "player" };
  const buttons = new Element();
  buttons.className = "col right";
  const hud = new Element();
  hud.append(buttons);
  const app = { object: { document: token } };
  const cells = Array.from({ length: 16 }, (_, index) => ({ row: Math.floor(index / 4), col: index % 4, underToken: false }));
  const opportunity = { movementId: "movement", cells };
  const requests = [];
  const service = {
    getManifestation: () => ({ id: "effect" }),
    getPlacementOpportunity: () => opportunity,
    request: async (...args) => requests.push(args)
  };
  const placement = new SandChildPlacement(service, {
    document: () => document, win: () => globalEvents,
    canvas: () => ({ scene: parent, clientCoordinatesFromCanvas: point => point }),
    game: () => ({ user }), hooks: () => ({ on: () => 1, off() {} })
  });
  placement.bindTokenHud(app, hud);
  placement.bindTokenHud(app, hud);
  assert.equal(buttons.children.filter(button => button.dataset.rmSandHud === "place").length, 1);
  const open = placement.open(token, opportunity);
  assert.equal(document.body.children.length, 1);
  assert.equal(document.body.children[0].children.filter(entry => entry.className.startsWith("rm-sand-cell")).length, 16);
  const esc = new Event("keydown");
  Object.defineProperty(esc, "key", { value: "Escape" });
  globalEvents.dispatchEvent(esc);
  await open;
  assert.equal(document.body.children.length, 0);
  assert.deepEqual(requests, []);
  const reopen = placement.open(token, opportunity);
  document.body.children[0].children.find(entry => entry.dataset.row === "3" && entry.dataset.col === "2").dispatchEvent(new Event("click"));
  await reopen;
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].slice(0, 2), ["place", { tokenUuid: token.uuid, movementId: "movement", row: 3, col: 2 }]);
  user.id = "other";
  await placement.open(token, opportunity);
  assert.equal(document.body.children.length, 0);
});

test("two intentional macro invocations on the same tile let the gateway assign fresh request IDs", async () => {
  const token = { id: "token", uuid: "Scene.scene.Token.token", actor: {} };
  const requests = [];
  const placement = new SandChildPlacement({
    getAbsorbableSand: () => [{ id: "tile" }],
    request: async (...args) => requests.push(args)
  }, {
    canvas: () => ({ tokens: { controlled: [{ document: token }] } }),
    game: () => ({ user: { isGM: true } }),
    chooseBenefit: async () => "reach"
  });
  await placement.absorbFromSelection();
  await placement.absorbFromSelection();
  assert.deepEqual(requests, Array(2).fill(["absorb", { tokenUuid: token.uuid, tileId: "tile", benefit: "reach" }]));
});

test("closing the Ancestral Art dialog consumes nothing", async () => {
  const token = { id: "token", uuid: "Scene.scene.Token.token", actor: {} };
  const requests = [];
  const placement = new SandChildPlacement({
    getAbsorbableSand: () => [{ id: "tile" }],
    request: async (...args) => requests.push(args)
  }, {
    canvas: () => ({ tokens: { controlled: [{ document: token }] } }),
    game: () => ({ user: { isGM: true } }),
    chooseBenefit: async () => null
  });
  await placement.absorbFromSelection();
  assert.deepEqual(requests, []);
});

test("the native dialog offers all three Ancestral Art choices", async () => {
  const previous = globalThis.foundry;
  const token = { id: "token", uuid: "Scene.scene.Token.token", actor: {} };
  const requests = [];
  globalThis.foundry = { applications: { api: { DialogV2: { async wait(options) {
    assert.equal(options.rejectClose, false);
    assert.deepEqual(options.buttons.map(button => button.action), ["tempHp", "reach", "safeMove"]);
    return options.buttons[2].callback();
  } } } } };
  try {
    const placement = new SandChildPlacement({
      getAbsorbableSand: () => [{ id: "tile" }],
      request: async (...args) => requests.push(args)
    }, {
      canvas: () => ({ tokens: { controlled: [{ document: token }] } }),
      game: () => ({ user: { isGM: true } })
    });
    await placement.absorbFromSelection();
    assert.deepEqual(requests, [["absorb", { tokenUuid: token.uuid, tileId: "tile", benefit: "safeMove" }]]);
  } finally {
    globalThis.foundry = previous;
  }
});

test("the GM HUD button opens a manual cell picker without a stored movement", async () => {
  const doc = { body: new Element(), createElement: () => new Element() };
  const user = { id: "gm", isGM: true };
  const scene = { id: "scene", grid: { size: 100 } };
  const token = { id: "token", uuid: "Scene.scene.Token.token", parent: scene, actor: {} };
  const requests = [];
  const service = {
    getManifestation: () => ({ id: "manifest" }),
    getPlacementOpportunity: () => null,
    getManualPlacementOpportunity: () => ({ effectId: "manifest", cells: [{ row: 3, col: 2, underToken: true }] }),
    request: async (...args) => requests.push(args), report: () => {}
  };
  const placement = new SandChildPlacement(service, {
    document: () => doc, win: () => new EventTarget(),
    canvas: () => ({ scene, clientCoordinatesFromCanvas: point => point }),
    game: () => ({ user }), hooks: () => ({ on: () => 1, off() {} })
  });
  const bar = new Element();
  bar.className = "col right";
  const root = new Element();
  root.append(bar);
  placement.bindTokenHud({ object: { document: token } }, root);
  bar.children.find(button => button.dataset.rmSandHud === "place").dispatchEvent(new Event("click"));
  assert.equal(doc.body.children.length, 1);
  doc.body.children[0].children.find(entry => entry.dataset.row === "3").dispatchEvent(new Event("click"));
  await Promise.resolve();
  assert.deepEqual(requests, [["placeManual", { tokenUuid: token.uuid, effectId: "manifest", row: 3, col: 2 }]]);
});

test("the shield shows only on the token with the manual sand cover marker", () => {
  const user = { id: "gm", isGM: true };
  const document = { createElement: () => new Element() };
  const actor = {};
  const token = { id: "token", actor };
  const copy = { id: "copy", actor };
  const placement = new SandChildPlacement({
    getManifestation: () => ({ id: "effect" }),
    hasManualSandCover: current => current === token
  }, { document: () => document, game: () => ({ user }) });
  const bar = new Element();
  bar.className = "col right";
  const root = new Element();
  root.append(bar);
  placement.bindTokenHud({ object: { document: token } }, root);
  assert.ok(bar.children.some(button => button.dataset.rmSandHud === "cover"));
  placement.bindTokenHud({ object: { document: copy } }, root);
  assert.equal(bar.children.some(button => button.dataset.rmSandHud === "cover"), false);
});
