import assert from "node:assert/strict";
import test from "node:test";
import { registerCreatureHarvestingHooks } from "../scripts/integrations/creature-harvesting-hooks.js";

function repository(tokens) {
  const byUuid = new Map(tokens.map((token, index) => [token.uuid = `token-${index}`, token]));
  return {
    read: uuid => byUuid.has(uuid) ? { diedAt: byUuid.get(uuid).diedAt } : null,
    async patch(uuid, { diedAt }) {
      const token = byUuid.get(uuid);
      if (diedAt === null) delete token.diedAt;
      else token.diedAt = diedAt;
    },
    async remove(uuid) { byUuid.delete(uuid); }
  };
}

test("old bodies stay undated and new deaths are stamped only on the relevant tokens", async () => {
  const listeners = new Map();
  const makeToken = hp => ({ actor: { type: "npc", isToken: true, system: { attributes: { hp: { value: hp } } } },
    getFlag() { return this.diedAt; }, async setFlag(_module, _key, value) { this.diedAt = value; },
    async unsetFlag() { delete this.diedAt; }
  });
  const old = makeToken(0), living = makeToken(2);
  for (const token of [old, living]) token.actor.token = token;
  const game = { user: { isGM: true, active: true, id: "gm" }, system: { id: "dnd5e" },
    time: { worldTime: 3000 }, scenes: [{ tokens: [old, living] }] };
  globalThis.foundry = { utils: { hasProperty: (data, key) => Object.hasOwn(data, key) } };
  registerCreatureHarvestingHooks({ gameProvider: () => game, records: repository([old, living]),
    hooks: { on: (name, handler) => listeners.set(name, handler) } });
  const update = async (token, value) => {
    token.actor.system.attributes.hp.value = value;
    listeners.get("updateActor")(token.actor, { "system.attributes.hp.value": value });
    await new Promise(setImmediate);
  };
  await update(old, 0);
  assert.equal(old.diedAt, undefined);
  await update(living, 0);
  assert.equal(living.diedAt, 3000);
  game.time.worldTime = 3100;
  await update(living, 0);
  assert.equal(living.diedAt, 3000);
  await update(living, 2);
  assert.equal(living.diedAt, undefined);
  await update(living, 0);
  assert.equal(living.diedAt, 3100);
});

test("base actor and effect updates track concrete tokens by their effective state", async () => {
  const listeners = new Map();
  const base = { type: "npc" };
  const token = { actor: { type: "npc", statuses: new Set(), system: { attributes: { hp: { value: 5 } } } },
    getFlag() { return this.diedAt; }, async setFlag(_module, _key, value) { this.diedAt = value; },
    async unsetFlag() { delete this.diedAt; } };
  base.getDependentTokens = ({ linked }) => linked ? [] : [token];
  const game = { user: { isGM: true, active: true, id: "gm" }, system: { id: "dnd5e" },
    time: { worldTime: 200 }, scenes: [{ tokens: [token] }] };
  globalThis.foundry = { utils: { hasProperty: (data, key) => Object.hasOwn(data, key) } };
  registerCreatureHarvestingHooks({ gameProvider: () => game, records: repository([token]),
    hooks: { on: (name, handler) => listeners.set(name, handler) } });
  token.actor.system.attributes.hp.value = 0;
  listeners.get("updateActor")(base, { "system.attributes.hp.value": 0 });
  await new Promise(setImmediate);
  assert.equal(token.diedAt, 200);
  token.actor.system.attributes.hp.value = 5;
  listeners.get("updateActor")(base, { "system.attributes.hp.value": 5 });
  await new Promise(setImmediate);
  game.time.worldTime = 240;
  listeners.get("updateActiveEffect")({ parent: base }, { disabled: false });
  token.actor.statuses.add("dead");
  await new Promise(setImmediate);
  assert.equal(token.diedAt, 240);
});

test("deleting a token waits for its queued death write before removing the record", async () => {
  const listeners = new Map();
  const actor = { type: "npc", isToken: true, system: { attributes: { hp: { value: 1 } } } };
  const token = { uuid: "body", actor };
  actor.token = token;
  const game = { user: { isGM: true, active: true, id: "gm" }, system: { id: "dnd5e" },
    time: { worldTime: 200 }, scenes: [{ tokens: [token] }] };
  let current = null;
  let allowWrite;
  const gate = new Promise(resolve => { allowWrite = resolve; });
  registerCreatureHarvestingHooks({ gameProvider: () => game, hooks: { on: (name, handler) => listeners.set(name, handler) },
    records: { read: () => current, async patch(_uuid, fields) { await gate; current = fields; },
      async remove() { current = null; } } });
  actor.system.attributes.hp.value = 0;
  listeners.get("updateActor")(actor, { "system.attributes.hp.value": 0 });
  listeners.get("deleteToken")(token);
  allowWrite();
  await new Promise(setImmediate);
  assert.equal(current, null);
});
