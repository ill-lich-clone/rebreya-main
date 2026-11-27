import test from "node:test";
import assert from "node:assert/strict";
import { SAND_CHILD_FEATURE_IDS, SAND_MANIFESTATION_ACTIVITY_ID } from "../scripts/data/sand-child-features.js";
import { SandChildService } from "../scripts/combat/sand-child-service.js";

const namespace = "rebreya-main";

function applyUpdate(document, patch) {
  for (const [path, value] of Object.entries(patch)) {
    const keys = path.split(".");
    const field = keys.pop();
    const target = keys.reduce((result, key) => (result[key] ??= {}), document);
    target[field] = structuredClone(value);
  }
  return document;
}

function fixture() {
  const owner = { id: "owner", viewedScene: "test" };
  const gm = { id: "gm", isGM: true, viewedScene: "test" };
  const scene = { id: "test", uuid: "Scene.test", tokens: new Map(), tiles: new Map(),
    grid: { type: 1, size: 100, distance: 5 }, dimensions: { sceneX: 0, sceneY: 0, sceneWidth: 800, sceneHeight: 800 },
    async createEmbeddedDocuments(type, entries) {
      assert.equal(type, "Tile");
      return entries.map(data => {
        const tile = { ...structuredClone(data), id: data._id, parent: this,
          async update(patch) { return applyUpdate(this, patch); }, async delete() { return scene.tiles.delete(this.id); } };
        this.tiles.set(tile.id, tile);
        return tile;
      });
    } };
  const effects = new Map();
  const actor = {
    uuid: "Actor.mage", flags: {}, items: new Map(), effects, statuses: new Set(),
    system: { attributes: { hp: { temp: 4 }, prof: 3 }, abilities: { cha: { mod: 2 } } },
    testUserPermission: user => user.id === owner.id || user.isGM,
    async update(patch) { return applyUpdate(this, patch); },
    async createEmbeddedDocuments(type, entries) {
      assert.equal(type, "ActiveEffect");
      return entries.map(data => {
        const effect = { ...structuredClone(data), id: `effect${effects.size + 1}`, parent: actor,
          async delete() { return effects.delete(this.id); } };
        effects.set(effect.id, effect);
        return effect;
      });
    }
  };
  const token = { id: "mage", uuid: "Scene.test.Token.mage", parent: scene, actor, x: 100, y: 100, width: 1, height: 1 };
  scene.tokens.set(token.id, token);
  const item = {
    id: "manifest", uuid: "Actor.mage.Item.manifest", name: "Проявление духов", actor, parent: actor, img: "sand.webp",
    flags: { [namespace]: { featureId: SAND_CHILD_FEATURE_IDS.manifestation } }, system: { uses: { spent: 1 } },
    async update(patch) { return applyUpdate(this, patch); }
  };
  actor.items.set(item.id, item);
  const activityUuid = `${item.uuid}.Activity.${SAND_MANIFESTATION_ACTIVITY_ID}`;
  const message = { id: "message", author: owner, timestamp: 50, flags: { dnd5e: { activity: { uuid: activityUuid } } },
    speaker: { scene: scene.id, token: token.id, actor: "mage" } };
  const game = { time: { worldTime: 120 }, user: gm, messages: new Map([[message.id, message]]), scenes: new Map([[scene.id, scene]]), system: { id: "dnd5e" } };
  let rolls = 0;
  const service = new SandChildService({ game: () => game, resolve: async uuid => [token, item].find(document => document.uuid === uuid),
    isActiveGM: () => true, now: () => 50, roll: async () => { rolls += 1; return 9; },
    halfCover: async () => ({ name: "Half Cover", statuses: ["coverHalf"] }) });
  const payload = { tokenUuid: token.uuid, itemUuid: item.uuid, messageId: message.id };
  return { actor, item, scene, token, effects, game, gm, owner, service, payload, rolls: () => rolls };
}

test("spends and grants manifestation exactly once", async () => {
  const f = fixture();
  assert.equal((await f.service.activate(f.payload, { sender: f.owner })).applied, true);
  assert.equal(f.item.system.uses.spent, 2);
  assert.equal(f.actor.system.attributes.hp.temp, 9);
  assert.equal(f.service.getManifestation(f.token).duration.seconds, 60);
  await f.service.activate(f.payload, { sender: f.owner });
  assert.equal(f.item.system.uses.spent, 2);
  assert.equal(f.rolls(), 1);
  const high = fixture();
  high.actor.system.attributes.hp.temp = 12;
  await high.service.activate(high.payload, { sender: high.owner });
  assert.equal(high.actor.system.attributes.hp.temp, 12);
});

test("invalid manifestation requests do not roll or spend", async () => {
  for (const kind of ["medium", "heavy", "incapacitated", "empty", "foreign", "card"]) {
    const f = fixture();
    const sender = kind === "foreign" ? { id: "other", viewedScene: f.scene.id } : f.owner;
    if (kind === "medium" || kind === "heavy") f.actor.items.set("armor", { type: "equipment", system: { equipped: true, type: { value: kind } } });
    if (kind === "incapacitated") f.actor.statuses.add(kind);
    if (kind === "empty") f.item.system.uses.spent = 3;
    if (kind === "card") f.game.messages.clear();
    assert.equal((await f.service.activate(f.payload, { sender })).applied, false, kind);
    assert.equal(f.rolls(), 0, kind);
    assert.equal(f.effects.size, 0, kind);
  }
});

test("ends only for actual two-handed weapon attack, incapacitation, armour, expiration, or owner request", async () => {
  const f = fixture();
  await f.service.activate(f.payload, { sender: f.owner });
  const armour = { type: "equipment", system: { equipped: false, type: { value: "heavy" } } };
  f.actor.items.set("armor", armour);
  const weapon = { type: "weapon", actor: f.actor, flags: { [namespace]: { heldHands: ["left"] } }, system: {} };
  await f.service.reconcileActor(f.actor);
  await f.service.attackCompleted({ token: f.token, item: weapon, attackId: "one" });
  assert.ok(f.service.getManifestation(f.token));
  weapon.flags[namespace].heldHands.push("right");
  assert.ok(f.service.getManifestation(f.token));
  await f.service.attackCompleted({ token: f.token, item: weapon, attackId: "two" });
  await f.service.attackCompleted({ token: f.token, item: weapon, attackId: "two" });
  assert.equal(f.effects.size, 0);
  assert.equal(f.actor.system.attributes.hp.temp, 9);

  for (const cause of ["armor", "incapacitated", "expiry", "owner"]) {
    const next = fixture();
    await next.service.activate(next.payload, { sender: next.owner });
    if (cause === "armor") next.actor.items.set("armor", { type: "equipment", system: { equipped: true, type: { value: "heavy" } } });
    if (cause === "incapacitated") next.actor.statuses.add(cause);
    if (cause === "expiry") next.game.time.worldTime += 60;
    if (cause === "owner") await next.service.endManifestation({ tokenUuid: next.token.uuid, effectId: next.service.getManifestation(next.token).id }, { sender: next.owner });
    else await next.service.reconcileActor(next.actor);
    assert.equal(next.effects.size, 0, cause);
    assert.equal(next.item.system.uses.spent, 2, cause);
  }
});

test("replays a partially applied manifestation without rolling or spending twice", async () => {
  const f = fixture();
  const update = f.actor.update;
  f.actor.update = async () => { throw new Error("Interrupted HP update"); };
  await assert.rejects(f.service.activate(f.payload, { sender: f.owner }), /Interrupted HP/);
  f.actor.update = update;
  await f.service.reconcileActor(f.actor);
  assert.equal(f.effects.size, 1);
  assert.equal(f.actor.system.attributes.hp.temp, 9);
  assert.equal(f.item.system.uses.spent, 2);
  assert.equal(f.rolls(), 1);
});

test("an explicit attack mode overrides the displayed grip", async () => {
  const f = fixture();
  await f.service.activate(f.payload, { sender: f.owner });
  const weapon = { type: "weapon", actor: f.actor, system: {}, flags: { [namespace]: { heldHands: ["left", "right"] } } };
  for (const mode of ["oneHanded", "offhand", "thrown", "thrown-offhand"]) {
    await f.service.attackCompleted({ token: f.token, item: weapon, attackId: mode, attackMode: mode });
    assert.ok(f.service.getManifestation(f.token), mode);
  }
  weapon.flags = {};
  await f.service.attackCompleted({ token: f.token, item: weapon, attackId: "strike-2", attackMode: "twoHanded" });
  assert.equal(f.service.getManifestation(f.token), null);
});

test("repairs issued features using their canonical ID in an older pack", async () => {
  const f = fixture();
  let indexReads = 0;
  const source = { _id: "differently-assigned", flags: structuredClone(f.item.flags),
    system: { description: { value: "Current" }, activities: { [SAND_MANIFESTATION_ACTIVITY_ID]: { name: "Current" } },
      uses: { max: "@prof", recovery: [{ period: "lr", type: "recoverAll" }] } } };
  f.game.packs = new Map([["world.rebreya-class-features", {
    async getIndex() { indexReads += 1; return [source]; },
    async getDocument(id) { return id === source._id ? source : null; }
  }]]);
  await f.service.repairItem(f.item);
  await f.service.repairItem(f.item);
  assert.equal(indexReads, 1);
  assert.equal(f.item.system.uses.spent, 1);
  assert.equal(f.item.system.uses.max, "@prof");
  assert.equal(f.item.system.description.value, "Current");
});

test("a pending activation with an older applied receipt never restores spent temporary HP", async () => {
  const f = fixture();
  const update = f.item.update;
  f.item.update = async function (patch) {
    if (patch[`flags.${namespace}.sandChildActivation`] === null) throw new Error("Interrupted receipt cleanup");
    return update.call(this, patch);
  };
  await assert.rejects(f.service.activate(f.payload, { sender: f.owner }), /Interrupted receipt cleanup/);
  assert.equal(f.actor.system.attributes.hp.temp, 9);
  f.item.update = update;
  f.actor.system.attributes.hp.temp = 1;
  f.service.now = () => 123000;
  await f.service.reconcileActor(f.actor);
  assert.equal(f.actor.system.attributes.hp.temp, 1);
  assert.equal(f.item.system.uses.spent, 2);
});

function movement(f, id, x, { finished = true, distance = 5, chain = [], action = "walk" } = {}) {
  const origin = { x: f.token.x, y: f.token.y };
  f.token.x = x;
  const destination = { x, y: f.token.y };
  return f.service.observeMovement(f.token, { id, origin, destination, chain, finished: Promise.resolve(finished),
    passed: { distance, cost: distance, waypoints: [{ ...destination, action, cost: distance }] } }, f.owner);
}

test("offers one placement per completed voluntary movement", async () => {
  const f = fixture();
  await f.service.activate(f.payload, { sender: f.owner });
  assert.equal(await movement(f, "stopped", 200, { finished: false }), null);
  assert.equal(await movement(f, "forced", 300, { action: "displace" }), null);
  assert.equal(await movement(f, "short", 350, { distance: 2.5 }), null);
  const opportunity = await movement(f, "done", 500, { distance: 10 });
  assert.equal(opportunity.movementId, "done");
  assert.equal(opportunity.cells.length, 9);
  assert.deepEqual(f.service.getPlacementOpportunity(f.token), opportunity);
  const context = { sender: f.owner, operationId: "first" };
  const request = { tokenUuid: f.token.uuid, movementId: "done", row: 2, col: 6 };
  const first = await f.service.placeSand(request, context);
  assert.equal(first.applied, true);
  const tile = f.scene.tiles.get(first.tileId);
  assert.deepEqual([tile.x, tile.y, tile.texture.anchorX, tile.texture.anchorY], [600, 200, 0, 0]);
  assert.equal((await f.service.placeSand({ ...request, col: 5 }, { ...context, operationId: "different" })).applied, false);
  assert.equal((await f.service.placeSand(request, context)).tileId, first.tileId);
  assert.equal(f.scene.tiles.size, 1);
  assert.equal(f.service.getPlacementOpportunity(f.token), null);
  await movement(f, "stale", 400);
  await movement(f, "later", 300);
  assert.equal((await f.service.placeSand({ ...request, movementId: "stale" }, context)).applied, false);
});

test("placement can arrive before the GM's movement cover update finishes", async () => {
  const f = fixture();
  await f.service.activate(f.payload, { sender: f.owner });
  const cover = Promise.withResolvers();
  f.service.reconcileCover = () => cover.promise;
  const moved = movement(f, "fast", 200);
  try {
    const result = await f.service.placeSand({ tokenUuid: f.token.uuid, movementId: "fast", row: 2, col: 3 },
      { sender: f.owner, operationId: "fast-click" });
    assert.equal(result.applied, true);
  } finally {
    cover.resolve();
    await moved;
  }
});

test("a non-representative combatant regains placements at their own group start", async () => {
  const f = fixture();
  f.item.system.uses.spent = 0;
  f.actor.system.attributes.prof = 1;
  const turns = ["prior", "leader", "mage"].map(id => ({ id, tokenId: id, sceneId: f.scene.id }));
  const groupedCombat = { mode: "active", current: { round: 1, groupId: "prior" },
    groups: [{ id: "prior", memberIds: ["prior"] }, { id: "team", memberIds: ["leader", "mage"] }] };
  const combat = { id: "grouped", active: true, started: true, scene: null, round: 1, turn: 0, turns,
    flags: { [namespace]: { groupedCombat } } };
  f.game.combats = new Map([[combat.id, combat]]);
  await f.service.activate(f.payload, { sender: f.owner });
  await movement(f, "before", 200);
  const result = await f.service.placeSand({ tokenUuid: f.token.uuid, movementId: "before", row: 1, col: 2 },
    { sender: f.owner, operationId: "before" });
  assert.equal(result.applied, true);
  combat.turn = 1;
  groupedCombat.current.groupId = "team";
  assert.ok(await movement(f, "after", 300));
});

test("a global combat resets absorption between turns even when the world clock is unchanged", async () => {
  const f = fixture();
  f.actor.items.set("art", { flags: { [namespace]: { featureId: SAND_CHILD_FEATURE_IDS.ancestralArt } } });
  const turns = ["mage", "other"].map(id => ({ id, tokenId: id, sceneId: f.scene.id }));
  const combat = { id: "global", active: true, started: true, scene: null, round: 1, turn: 0, turns };
  f.game.combats = new Map([[combat.id, combat]]);
  await f.service.activate(f.payload, { sender: f.owner });
  for (const [id, col] of [["first", 2], ["second", 3]]) {
    await movement(f, id, col * 100);
    assert.equal((await f.service.placeSand({ tokenUuid: f.token.uuid, movementId: id, row: 1, col },
      { sender: f.owner, operationId: id })).applied, true);
  }
  const absorb = async id => {
    const [tile] = f.service.getAbsorbableSand(f.token);
    return f.service.absorbSand({ tokenUuid: f.token.uuid, tileId: tile.id }, { sender: f.owner, operationId: id });
  };
  assert.equal((await absorb("a1")).applied, true);
  combat.turn = 1;
  await movement(f, "back", 200);
  assert.equal((await absorb("a2")).applied, true);
});

test("deleting a token leaves its actor without sand's half cover", async () => {
  const f = fixture();
  await f.service.activate(f.payload, { sender: f.owner });
  await movement(f, "step", 200);
  await f.service.placeSand({ tokenUuid: f.token.uuid, movementId: "step", row: 1, col: 2 },
    { sender: f.owner, operationId: "place" });
  const other = { id: "other", statuses: new Set(["coverHalf"]) };
  f.actor.effects.set(other.id, other);
  f.scene.tokens.delete(f.token.id);
  await f.service.forgetToken(f.token, { removed: true });
  assert.deepEqual([...f.actor.effects.values()], [other]);
  assert.equal(f.scene.tiles.size, 1);
});

test("reconciles sand placement, cover and absorption on active GM", async () => {
  const f = fixture();
  f.actor.system.attributes.prof = 2;
  f.actor.items.set("art", { flags: { [namespace]: { featureId: SAND_CHILD_FEATURE_IDS.ancestralArt } } });
  await f.service.activate(f.payload, { sender: f.owner });
  const otherCover = { id: "otherCover", statuses: new Set(["coverHalf"]) };
  f.effects.set(otherCover.id, otherCover);
  const context = { sender: f.owner };
  const request = { tokenUuid: f.token.uuid, row: 1, col: 2 };
  await movement(f, "first", 200);
  const first = await f.service.placeSand({ ...request, movementId: "first" }, { ...context, operationId: "p1" });
  assert.equal(first.applied, true);
  assert.equal(f.effects.size, 3);
  await movement(f, "second", 300);
  const second = await f.service.placeSand({ ...request, col: 3, movementId: "second" }, { ...context, operationId: "p2" });
  assert.equal(second.applied, true);
  assert.equal(await movement(f, "third", 400), null);
  assert.equal(f.scene.tiles.size, 2);
  f.game.time.worldTime = 126;
  assert.ok(await movement(f, "next", 300));
  const effectId = f.service.getManifestation(f.token).id;
  await f.service.endManifestation({ tokenUuid: f.token.uuid, effectId }, context);
  f.actor.system.attributes.hp.temp = 1;
  assert.equal((await f.service.absorbSand({ tokenUuid: f.token.uuid, tileId: second.tileId }, { ...context, operationId: "a1" })).applied, true);
  assert.equal(f.actor.system.attributes.hp.temp, 2);
  f.token.x = 200;
  assert.equal((await f.service.absorbSand({ tokenUuid: f.token.uuid, tileId: first.tileId }, { ...context, operationId: "a2" })).applied, false);
  assert.equal(f.scene.tiles.has(first.tileId), true);
  await f.service.expireSand(180);
  assert.equal(f.scene.tiles.size, 0);
  assert.equal(f.effects.get(otherCover.id), otherCover);
});

test("a retry completes the recorded sand operation without another spend", async () => {
  const f = fixture();
  f.actor.items.set("art", { flags: { [namespace]: { featureId: SAND_CHILD_FEATURE_IDS.ancestralArt } } });
  await f.service.activate(f.payload, { sender: f.owner });
  await movement(f, "one", 200);
  const request = { tokenUuid: f.token.uuid, row: 1, col: 2, movementId: "one" };
  const context = { sender: f.owner, operationId: "p1" };
  const [first, duplicate] = await Promise.all([f.service.placeSand(request, context), f.service.placeSand(request, context)]);
  assert.equal(first.tileId, duplicate.tileId);
  assert.equal(f.scene.tiles.size, 1);
  const tile = f.scene.tiles.get(first.tileId);
  const deleteTile = tile.delete;
  tile.delete = async () => { throw new Error("Interrupted tile delete"); };
  f.actor.system.attributes.hp.temp = 1;
  const absorb = { tokenUuid: f.token.uuid, tileId: first.tileId };
  const absorbContext = { sender: f.owner, operationId: "a1" };
  await assert.rejects(f.service.absorbSand(absorb, absorbContext), /Interrupted tile delete/);
  assert.equal(f.actor.system.attributes.hp.temp, 3);
  assert.deepEqual(f.service.getAbsorbableSand(f.token), []);
  tile.delete = deleteTile;
  f.actor.system.attributes.hp.temp = 1;
  assert.equal((await f.service.absorbSand(absorb, { ...absorbContext, operationId: "fresh-retry" })).applied, true);
  assert.equal(f.actor.system.attributes.hp.temp, 1);
  assert.equal(f.scene.tiles.size, 0);
});

test("the HUD can retry the chosen cell when the placement budget is reserved", async () => {
  const f = fixture();
  f.item.system.uses.spent = 0;
  f.actor.system.attributes.prof = 1;
  await f.service.activate(f.payload, { sender: f.owner });
  await movement(f, "one", 200);
  const update = f.actor.update;
  f.actor.update = async function (patch) {
    if (patch[`flags.${namespace}.sandChildPlacements`]?.entries?.some(entry => !entry.pending)) throw new Error("Interrupted placement");
    return update.call(this, patch);
  };
  const request = { tokenUuid: f.token.uuid, row: 1, col: 2, movementId: "one" };
  await assert.rejects(f.service.placeSand(request, { sender: f.owner, operationId: "initial" }), /Interrupted placement/);
  assert.equal(f.scene.tiles.size, 1);
  const [placedId] = f.scene.tiles.keys();
  assert.deepEqual(f.service.getPlacementOpportunity(f.token), { movementId: "one", cells: [{ row: 1, col: 2, underToken: true }] });
  f.actor.update = update;
  assert.equal((await f.service.placeSand(request, { sender: f.owner, operationId: "retry" })).tileId, placedId);
  assert.equal(f.service.getPlacementOpportunity(f.token), null);
  assert.equal(f.scene.tiles.size, 1);
});

test("cover update failure before the absorption award permits a fresh retry", async () => {
  const f = fixture();
  f.actor.items.set("art", { flags: { [namespace]: { featureId: SAND_CHILD_FEATURE_IDS.ancestralArt } } });
  await f.service.activate(f.payload, { sender: f.owner });
  await movement(f, "one", 200);
  const { tileId } = await f.service.placeSand({ tokenUuid: f.token.uuid, row: 1, col: 2, movementId: "one" },
    { sender: f.owner, operationId: "place" });
  const updateCover = f.service.observeTile.bind(f.service);
  let interrupted = false;
  f.service.observeTile = async (...args) => {
    if (!interrupted) { interrupted = true; throw new Error("Interrupted cover update"); }
    return updateCover(...args);
  };
  f.actor.system.attributes.hp.temp = 1;
  const absorb = { tokenUuid: f.token.uuid, tileId };
  await assert.rejects(f.service.absorbSand(absorb, { sender: f.owner, operationId: "first" }), /Interrupted cover update/);
  assert.equal(f.actor.system.attributes.hp.temp, 1);
  assert.ok(f.scene.tiles.has(tileId));
  assert.equal((await f.service.absorbSand(absorb, { sender: f.owner, operationId: "retry" })).applied, true);
  assert.equal(f.actor.system.attributes.hp.temp, 3);
  assert.equal(f.scene.tiles.size, 0);
});
