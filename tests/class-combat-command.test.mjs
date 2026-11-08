import test from "node:test";
import assert from "node:assert/strict";
import { reserveClassCombatOperation, resolveClassCombatHit } from "../scripts/infrastructure/foundry/class-combat-command.js";

test("class combat authority binds a recent owned weapon card to the exact hit token", async () => {
  const sender = { id: "player" };
  const actor = { uuid: "Actor.fighter", testUserPermission: (user, level) => user === sender && level === "OWNER" };
  const item = { uuid: "Actor.fighter.Item.sword", type: "weapon", actor };
  const scene = { id: "scene", tokens: new Map() };
  const makeToken = (id, owner) => {
    const token = { id, uuid: `Scene.scene.Token.${id}`, actor: owner, parent: scene };
    scene.tokens.set(id, token);
    return token;
  };
  makeToken("fighter", actor);
  const hit = makeToken("hit", { uuid: "Actor.hit" });
  const miss = makeToken("miss", { uuid: "Actor.miss" });
  const attack = {
    type: "usage", id: "attack", author: sender, timestamp: 1000, speaker: { scene: "scene", token: "fighter" },
    getAssociatedItem: () => item,
    system: { item: { uuid: item.uuid }, activity: { type: "attack" }, midi: {
      sections: { hits: { data: { hits: [{ uuid: hit.uuid, hitClass: "success" }] } } }
    } }
  };
  const options = { sender, game: { messages: new Map([["attack", attack]]), scenes: new Map([["scene", scene]]) },
    resolve: async uuid => [...scene.tokens.values()].find(token => token.uuid === uuid), now: 2000 };
  const payload = { attackId: "attack", targetTokenUuid: hit.uuid };
  assert.equal((await resolveClassCombatHit(payload, options))?.target, hit.actor);
  assert.equal(await resolveClassCombatHit({ ...payload, targetTokenUuid: miss.uuid }, options), null);
  assert.equal(await resolveClassCombatHit(payload, { ...options, sender: { id: "other" } }), null);
  assert.equal(await resolveClassCombatHit(payload, { ...options, now: 130000 }), null);
});

test("class combat authority writes a GM receipt only after independent approval", async () => {
  const hit = { attack: { id: "attack" }, actor: { name: "Fighter" }, target: { name: "Enemy" } };
  const item = { name: "Fire Rune" };
  const messages = [];
  const options = { game: { user: { id: "gm", isGM: true }, messages },
    create: async data => { messages.push({ ...data, author: { id: "gm", isGM: true } }); return messages.at(-1); } };
  assert.equal((await reserveClassCombatOperation("fire", hit, item, "", { ...options, confirm: async () => false })).receipt, null);
  assert.equal(messages.length, 0);
  const first = await reserveClassCombatOperation("fire", hit, item, "", { ...options, confirm: async () => true });
  assert.ok(first.receipt);
  assert.equal(messages.length, 1);
  const repeat = await reserveClassCombatOperation("fire", hit, item, "", { ...options, confirm: async () => assert.fail("prompted twice") });
  assert.equal(repeat.existing, first.receipt);
});
