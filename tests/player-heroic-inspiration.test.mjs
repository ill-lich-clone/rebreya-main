import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { updateHeroicInspirationButton, toggleHeroicInspiration, registerPlayerHeroicInspirationHooks } from "../scripts/integrations/player-heroic-inspiration.js";

function fixture({ gm = false, viewerId = "player", ownerId = "player", enabled = false, allowed = true } = {}) {
  const actor = { uuid: "Actor.hero", system: { attributes: { inspiration: enabled } },
    testUserPermission: () => allowed,
    async update(patch) { this.system.attributes.inspiration = patch["system.attributes.inspiration"]; } };
  const viewer = { id: viewerId, isGM: gm };
  const owner = { id: ownerId, active: true, character: actor };
  const button = { dataset: {}, setAttribute(name, value) { this[name] = value; }, disabled: false };
  return { actor, viewer, owner, button };
}

test("player toggles own canonical inspiration and the button reflects it", async () => {
  const { actor, viewer, owner, button } = fixture();
  updateHeroicInspirationButton(button, owner, viewer);
  assert.equal(button["aria-pressed"], "false");
  assert.equal(button.disabled, false);
  assert.equal(await toggleHeroicInspiration(owner, viewer), true);
  updateHeroicInspirationButton(button, owner, viewer);
  assert.equal(actor.system.attributes.inspiration, true);
  assert.equal(button["aria-pressed"], "true");
});

test("GM can toggle any player; a player cannot toggle another or lack ownership", async () => {
  const gm = fixture({ gm: true, ownerId: "other" });
  assert.equal(await toggleHeroicInspiration(gm.owner, gm.viewer), true);
  const other = fixture({ ownerId: "other" });
  updateHeroicInspirationButton(other.button, other.owner, other.viewer);
  assert.equal(other.button.disabled, true);
  assert.equal(await toggleHeroicInspiration(other.owner, other.viewer), false);
  const denied = fixture({ allowed: false });
  assert.equal(await toggleHeroicInspiration(denied.owner, denied.viewer), false);
});

test("inactive players and players without characters have no actionable button", async () => {
  const { viewer, owner, button } = fixture();
  owner.active = false;
  assert.equal(updateHeroicInspirationButton(button, owner, viewer), false);
  assert.equal(await toggleHeroicInspiration(owner, viewer), false);
  owner.active = true; owner.character = null;
  assert.equal(updateHeroicInspirationButton(button, owner, viewer), false);
});

test("GM without a character can toggle their own persistent inspiration", async () => {
  const { button } = fixture();
  const gm = { id: "gm", isGM: true, active: true, character: null, flags: {},
    getFlag(scope, key) { return this.flags[scope]?.[key]; },
    async setFlag(scope, key, value) { (this.flags[scope] ??= {})[key] = value; } };
  assert.equal(updateHeroicInspirationButton(button, gm, gm), true);
  assert.equal(button["aria-pressed"], "false");
  assert.equal(await toggleHeroicInspiration(gm, gm), true);
  updateHeroicInspirationButton(button, gm, gm);
  assert.equal(button["aria-pressed"], "true");
  assert.equal(await toggleHeroicInspiration(gm, { id: "other", isGM: false }), false);
  const classes = new Set(); let circle;
  const row = { dataset: { userId: gm.id }, classList: { add(name) { classes.add(name); } },
    ownerDocument: { createElement() { return { dataset: {}, setAttribute() {}, addEventListener() {} }; } },
    querySelector() { return null; }, prepend(value) { circle = value; } };
  const hooks = { on(name, fn) { if (name === "renderPlayers") this.render = fn; } };
  registerPlayerHeroicInspirationHooks(hooks, { system: { id: "dnd5e" }, user: gm, users: new Map([[gm.id, gm]]) });
  hooks.render({ element: { querySelectorAll() { return [row]; } } });
  assert.ok(circle); assert.ok(classes.has("rm-has-heroic-inspiration"));
});

test("inspiration control replaces the native circle and has yellow active glow", async () => {
  const css = await readFile(new URL("../styles/main.css", import.meta.url), "utf8");
  assert.match(css, /\.rm-has-heroic-inspiration::before\s*\{\s*display:\s*none/u);
  assert.match(css, /\.rm-player-heroic-inspiration\s*\{[^}]*min-height:\s*12px/u);
  assert.match(css, /\.rm-player-heroic-inspiration\[aria-pressed="true"\][^{]*\{[^}]*box-shadow:[^}]*#/u);
  const { actor, viewer, owner } = fixture();
  let appended;
  const row = { dataset: { userId: owner.id }, classList: { add() {} },
    ownerDocument: { createElement() { return { dataset: {}, setAttribute() {}, addEventListener() {} }; } },
    querySelector() { return null; }, prepend(button) { appended = button; } };
  const hooks = { on(name, fn) { if (name === "renderPlayers") this.render = fn; } };
  registerPlayerHeroicInspirationHooks(hooks, { system: { id: "dnd5e" }, user: viewer, users: new Map([[owner.id, owner]]) });
  hooks.render({ element: { querySelectorAll() { return [row]; } } });
  assert.equal(appended.className, "rm-player-heroic-inspiration");
  assert.equal(actor.system.attributes.inspiration, false);
});

test("player list renders one button and only inspiration updates refresh it", async () => {
  const { actor, viewer, owner } = fixture();
  const listeners = new Map(), hooks = { on(name, fn) { const list = listeners.get(name) ?? []; list.push(fn); listeners.set(name, list); } };
  const game = { system: { id: "dnd5e" }, user: viewer, users: new Map([[owner.id, owner]]) };
  let refreshes = 0, click;
  const row = { dataset: { userId: owner.id }, child: null,
    ownerDocument: { createElement() { return { dataset: {}, setAttribute() { refreshes++; }, addEventListener(_name, fn) { click = fn; } }; } },
    querySelector() { return this.child; }, prepend(button) { this.child = button; } };
  const root = { querySelectorAll() { return [row]; } };
  const oldUi = globalThis.ui; globalThis.ui = { players: { element: root } };
  try {
    registerPlayerHeroicInspirationHooks(hooks, game);
    registerPlayerHeroicInspirationHooks(hooks, game);
    assert.equal(listeners.get("renderPlayers").length, 1);
    listeners.get("renderPlayers")[0]({ element: root });
    const initial = refreshes;
    listeners.get("updateActor")[0](actor, { system: { attributes: { hp: { value: 1 } } } });
    assert.equal(refreshes, initial);
    listeners.get("updateActor")[0](actor, { system: { attributes: { inspiration: true } } });
    assert.ok(refreshes > initial);
    await click({ preventDefault() {}, stopPropagation() {} });
    assert.equal(actor.system.attributes.inspiration, true);
  } finally { globalThis.ui = oldUi; }
});
