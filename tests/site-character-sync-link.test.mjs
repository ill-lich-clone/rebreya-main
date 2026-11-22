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

// --- Full state mapping through applySiteState / localStatePatch ---------------------

function makeRichActor() {
  const flags = { "rebreya-main": { siteCharacter: { id: 7, lastStateHash: "" } } };
  const statuses = new Set(["prone", "dead"]);
  const classes = [
    { id: "wiz", type: "class", system: { levels: 5, hd: { denomination: "d6", spent: 0 } } },
    { id: "ftr", type: "class", system: { levels: 2, hd: { denomination: "d10", spent: 0 } } },
  ];
  const actor = {
    id: "A1", uuid: "Actor.A1", statuses, items: classes,
    system: { attributes: { hp: { value: 20, max: 30 }, death: { success: 0, failure: 0 } }, spells: { spell1: { value: 4, max: 4 } }, currency: { gp: 10 } },
    getFlag: (scope, key) => flags[scope]?.[key],
    updates: [],
    async update(data, options) {
      this.updates.push({ data, options });
      for (const [path, value] of Object.entries(data)) {
        if (path === "flags.rebreya-main.siteCharacter") flags["rebreya-main"].siteCharacter = value;
      }
      if (data.system?.attributes?.hp?.value != null) this.system.attributes.hp.value = data.system.attributes.hp.value;
    },
    async updateEmbeddedDocuments(_type, updates, options) {
      this.embedded = { updates, options };
      for (const u of updates) classes.find((c) => c.id === u._id).system.hd.spent = u["system.hd.spent"];
    },
    async toggleStatusEffect(id, { active }) { if (active) statuses.add(id); else statuses.delete(id); return true; },
  };
  return actor;
}

test("applySiteState: conditions follow the site, hit dice spread, site-only condition kept, baseline set", async () => {
  globalThis.CONFIG = { statusEffects: ["prone", "poisoned", "invisible", "dead", "exhaustion"].map((id) => ({ id })) };
  const site = makeSite();
  const sync = new RebreyaCharacterSync({ site });
  const actor = makeRichActor();
  await sync.applySiteState(actor, {
    currentHp: 11, usedHitDice: 3, conditions: ["otravlennyy", "nevidimyy", "bless-homebrew"], stateHash: "sha256:site",
  });
  assert.deepEqual([...actor.statuses].sort(), ["dead", "invisible", "poisoned"]); // prone removed, dead kept
  assert.equal(actor.items.find((c) => c.id === "ftr").system.hd.spent, 2); // d10 first
  assert.equal(actor.items.find((c) => c.id === "wiz").system.hd.spent, 1);
  assert.equal(actor.embedded.options.rebreyaSiteSync, true, "pull updates are tagged (no echo push)");
  const link = actor.getFlag("rebreya-main", "siteCharacter");
  assert.equal(link.lastStateHash, "sha256:site");
  assert.deepEqual(link.extraConditions, ["bless-homebrew"]);
  assert.equal(link.lastSyncedSignature, sync.localSignature(actor));
  assert.equal(sync.isLocallyDirty(actor), false);

  const patch = sync.localStatePatch(actor);
  assert.equal(patch.usedHitDice, 3);
  assert.deepEqual(patch.conditions, ["bless-homebrew", "dead", "nevidimyy", "otravlennyy"]);
  assert.equal("exhaustion" in patch.conditions, false);
  actor.statuses.add("prone");
  assert.equal(sync.isLocallyDirty(actor), true);
  delete globalThis.CONFIG;
});
