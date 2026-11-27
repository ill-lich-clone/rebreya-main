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
    game: () => ({ user: { isGM: true } })
  });
  await placement.absorbFromSelection();
  await placement.absorbFromSelection();
  assert.deepEqual(requests, Array(2).fill(["absorb", { tokenUuid: token.uuid, tileId: "tile" }]));
});
