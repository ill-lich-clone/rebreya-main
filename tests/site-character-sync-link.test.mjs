import test from "node:test";
import assert from "node:assert/strict";

import { RebreyaCharacterSync } from "../scripts/integrations/rebreya-character-sync.js";
import { LinkRevoked } from "../scripts/integrations/rebreya-site-api.js";

// RebreyaCharacterSync with a fake site service + Actor: verifies the link-token
// path is used for state push/pull and re-import, and that a revoked token is
// dropped from this browser.

globalThis.game = { user: { id: "player1" }, modules: { get: () => ({ version: "1.4.84" }) }, actors: [] };

function makeActor() {
  const flags = { "rebreya-main": { siteCharacter: { id: 7, lastStateHash: "" } } };
  return {
    id: "A1",
    uuid: "Actor.A1",
    system: { attributes: { hp: { value: 5, max: 20 } }, spells: {}, currency: {} },
    statuses: new Set(),
    getFlag: (scope, key) => flags[scope]?.[key],
    async update(data) {
      for (const [path, value] of Object.entries(data)) {
        if (path === "flags.rebreya-main.siteCharacter") flags["rebreya-main"].siteCharacter = value;
      }
    },
  };
}

function makeSite({ token = "TOK", authed = false, api = {} } = {}) {
  const tokens = token ? { A1: { token } } : {};
  const calls = [];
  const wrap = (name, fn) => async (...args) => { calls.push([name, ...args]); return fn(...args); };
  return {
    calls,
    tokens,
    isAuthenticated: () => authed,
    getLinkToken: (id) => tokens[id] ?? null,
    clearLinkToken: async (id) => { delete tokens[id]; },
    api: {
      baseUrl: "https://rebreya.com",
      getLinkedState: wrap("getLinkedState", api.getLinkedState ?? (async () => ({ stateHash: "" }))),
      patchLinkedState: wrap("patchLinkedState", api.patchLinkedState ?? (async () => ({ stateHash: "sha256:new" }))),
      getLinkedCharacter: wrap("getLinkedCharacter", api.getLinkedCharacter ?? (async () => ({ id: 7, name: "Тайрен" }))),
      getCharacterState: wrap("getCharacterState", async () => { throw new Error("JWT path must not be used"); }),
      patchCharacterState: wrap("patchCharacterState", async () => { throw new Error("JWT path must not be used"); }),
    },
  };
}

test("pushState with a link token uses /characters/linked/state/ and needs no login", async () => {
  const site = makeSite();
  const sync = new RebreyaCharacterSync({ site });
  const actor = makeActor();
  const res = await sync.pushState(actor);
  assert.equal(res.ok, true);
  assert.deepEqual(site.calls.map((c) => c[0]), ["getLinkedState", "patchLinkedState"]);
  assert.equal(site.calls[1][1], "TOK");
  assert.equal(site.calls[1][2].currentHp, 5);
  assert.equal(actor.getFlag("rebreya-main", "siteCharacter").lastStateHash, "sha256:new");
});

test("a revoked link token is dropped from this browser and the error surfaces", async () => {
  const site = makeSite({ api: { getLinkedState: async () => { throw new LinkRevoked("revoked", { status: 401 }); } } });
  const sync = new RebreyaCharacterSync({ site });
  await assert.rejects(() => sync.pushState(makeActor()), LinkRevoked);
  assert.equal(site.getLinkToken("A1"), null);
});

test("no token and no login → clear error instead of a request", async () => {
  const site = makeSite({ token: null });
  const sync = new RebreyaCharacterSync({ site });
  await assert.rejects(() => sync.pushState(makeActor()), /свяжите персонажа по коду/);
  assert.equal(site.calls.length, 0);
});

test("fetchLinkedCharacter (re-import) uses the link token", async () => {
  const site = makeSite();
  const sync = new RebreyaCharacterSync({ site });
  const character = await sync.fetchLinkedCharacter(makeActor());
  assert.equal(character.name, "Тайрен");
  assert.deepEqual(site.calls.map((c) => c[0]), ["getLinkedCharacter"]);
});
