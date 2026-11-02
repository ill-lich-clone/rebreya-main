import assert from "node:assert/strict";
import test from "node:test";
import {
  configureDarknessRegion,
  registerDarknessRegionHooks
} from "../scripts/integrations/world-card-automations/selected/lib/darkness-region.js";

function fixture(t) {
  const old = Object.fromEntries(
    ["game", "canvas", "foundry", "fromUuid", "MidiQOL", "CONFIG"].map((k) => [k, globalThis[k]])
  );
  t.after(() => Object.assign(globalThis, old));
  const sender = { id: "player", active: true, name: "Player" };
  const gm = { id: "gm", isGM: true, active: true };
  const scene = {
    uuid: "Scene.room",
    id: "room",
    grid: { size: 100, distance: 5 },
    dimensions: { distancePixels: 20 },
    lights: new Map(),
    regions: new Map()
  };
  const actor = {
    uuid: "Actor.cast",
    testUserPermission: (user) => user === sender,
    system: { attributes: { senses: {} } },
    flags: {}
  };
  const token = {
    uuid: "Scene.room.Token.caster",
    documentName: "Token",
    id: "caster",
    parent: scene,
    actor,
    object: { center: { x: 450, y: 550 }, actor },
    _source: { level: "ground" },
    getCenterPoint: () => ({ x: 450, y: 550 })
  };
  token.object.document = token;
  token.object.scene = scene;
  const item = {
    uuid: "Actor.cast.Item.dark",
    actor,
    type: "spell",
    name: "Darkness",
    system: { identifier: "darkness" },
    flags: { "chris-premades": { info: { identifier: "darkness" }, config: {} } }
  };
  const activity = { uuid: item.uuid + ".Activity.cast", item };
  const msg = {
    uuid: "ChatMessage.cast",
    documentName: "ChatMessage",
    timestamp: Date.now(),
    author: sender,
    getAssociatedItem: () => item,
    getAssociatedActivity: () => activity,
    getAssociatedToken: () => token
  };
  const shape = {
    type: "circle",
    origin: { x: 150, y: 250 },
    clone: () => ({
      origin: { x: 150, y: 250 },
      move(p) {
        this.origin = p;
      },
      toObject() {
        return { type: "circle", ...this.origin, radius: 300 };
      }
    })
  };
  const region = {
    id: "dark",
    uuid: "Scene.room.Region.dark",
    documentName: "Region",
    parent: scene,
    levels: new Set(["ground"]),
    name: "Darkness",
    shapes: [shape],
    bounds: { x: -150, y: -50, width: 600, height: 600 },
    flags: { dnd5e: { origin: token.uuid, item: item.uuid, activity: activity.uuid } }
  };
  scene.regions.set(region.id, region);
  globalThis.game = {
    user: gm,
    users: { activeGM: gm },
    rebreyaMain: { worldMutationCoordinator: { run: (_key, fn) => fn() } }
  };
  globalThis.canvas = { scene };
  const docs = new Map([token, item, msg, region, activity].map((doc) => [doc.uuid, doc]));
  globalThis.fromUuid = async (uuid) => docs.get(uuid);
  globalThis.MidiQOL = {
    Workflow: { getWorkflow: () => ({ templateUuid: region.uuid, itemCardUuid: msg.uuid, item }) },
    computeDistance: () => 20
  };
  globalThis.CONFIG = { Canvas: { darknessAnimations: {} } };
  const batches = [],
    hooks = new Map();
  let yes = true,
    confirmations = 0;
  globalThis.foundry = {
    utils: { randomID: () => "light" },
    applications: {
      api: {
        DialogV2: {
          confirm: async () => {
            confirmations++;
            return yes;
          }
        }
      }
    },
    documents: {
      modifyBatch: async (ops) => {
        batches.push(ops);
      }
    }
  };
  const payload = {
    sourceTokenUuid: token.uuid,
    originItemUuid: item.uuid,
    itemCardUuid: msg.uuid,
    regionUuid: region.uuid,
    attach: false
  };
  return {
    sender,
    item,
    region,
    msg,
    actor,
    scene,
    token,
    docs,
    payload,
    batches,
    hooks,
    get confirmations() {
      return confirmations;
    },
    decline: () => {
      yes = false;
    }
  };
}

test("default Darkness projects obscuration without light; forged region, old cast and cancellation cannot write", async (t) => {
  const h = fixture(t);
  assert.equal(await configureDarknessRegion({ ...h.payload, unexpected: "value" }, { sender: h.sender }), false);
  const old = h.region.flags.dnd5e.item;
  h.region.flags.dnd5e.item = "Item.other";
  assert.equal(await configureDarknessRegion(h.payload, { sender: h.sender }), false);
  h.region.flags.dnd5e.item = old;
  const get = MidiQOL.Workflow.getWorkflow;
  MidiQOL.Workflow.getWorkflow = () => ({ templateUuid: "Scene.room.Region.different", itemCardUuid: h.msg.uuid });
  assert.equal(await configureDarknessRegion(h.payload, { sender: h.sender }), false);
  MidiQOL.Workflow.getWorkflow = get;
  assert.equal(h.confirmations, 0);
  assert.equal(await configureDarknessRegion(h.payload, { sender: h.sender }), true);
  assert.equal(h.batches[0].length, 1);
  const update = h.batches[0][0].updates[0];
  assert.equal(update["flags.chris-premades.template"].visibility.magicalDarkness, true);
  h.decline();
  assert.equal(await configureDarknessRegion(h.payload, { sender: h.sender }), false);
  assert.equal(h.batches.length, 1);
});

test("GM derives darkness light radius and attached shapes; updates and deletion require reciprocal identities", async (t) => {
  const h = fixture(t);
  h.item.flags["chris-premades"].config.useRealDarkness = true;
  h.item.flags.dnd5e = { cachedFor: "Actor.cast.Item.eyes.Activity.cast" };
  h.docs.set(h.item.flags.dnd5e.cachedFor, {
    item: { actor: h.actor, flags: { "chris-premades": { info: { identifier: "eyesOfTheDark" } } } }
  });
  await configureDarknessRegion({ ...h.payload, attach: true }, { sender: h.sender });
  const regionEdit = h.batches[0].find((op) => op.documentName === "Region").updates[0];
  const light = h.batches[0].find((op) => op.documentName === "AmbientLight").data[0];
  assert.equal(light.config.negative, true);
  assert.equal(light.flags["midi-qol"].regionLight, h.region.uuid);
  assert.equal(light.config.dim, 15);
  assert.deepEqual([light.x, light.y], [450, 550]);
  assert.equal(regionEdit["attachment.token"], "caster");
  assert.deepEqual(regionEdit.shapes, [{ type: "circle", x: 450, y: 550, radius: 300 }]);
  assert.deepEqual(regionEdit["flags.chris-premades.template"].visibility.canSeeTokens, [h.token.uuid]);
  h.region.flags["rebreya-main"] = { darkness: regionEdit["flags.rebreya-main.darkness"] };
  const updates = [],
    deletions = [];
  const actual = {
    ...light,
    id: light._id,
    documentName: "AmbientLight",
    parent: h.scene,
    update: async (d) => updates.push(d),
    delete: async () => deletions.push(true)
  };
  h.scene.lights.set(light._id, actual);
  h.region.bounds = { x: 100, y: 300, width: 800, height: 800 };
  registerDarknessRegionHooks({ game, Hooks: { on: (name, fn) => h.hooks.set(name, fn) } });
  await h.hooks.get("updateRegion")(h.region, { shapes: [] });
  assert.deepEqual([updates[0].x, updates[0].y, updates[0]["config.dim"]], [500, 700, 20]);
  const marker = actual.flags["rebreya-main"].darkness;
  actual.flags["rebreya-main"].darkness = { ...marker, regionUuid: "forged" };
  await h.hooks.get("deleteRegion")(h.region);
  assert.deepEqual(deletions, []);
  actual.flags["rebreya-main"].darkness = marker;
  await h.hooks.get("deleteRegion")(h.region);
  assert.deepEqual(deletions, [true]);
});

test("Darkness checks region intersections, each observer's senses and the exact Eyes of the Dark token", (t) => {
  const h = fixture(t);
  h.region.flags["rebreya-main"] = { darkness: { originItemUuid: h.item.uuid } };
  const visibility = { obscured: true, magicalDarkness: true, canSeeTokens: [h.token.uuid] };
  h.region.flags["chris-premades"] = { template: { visibility } };
  h.region.testPoint = () => false;
  let intersects = true;
  h.region.segmentizeMovementPath = () => (intersects ? [{ type: 1 }] : []);
  const enemy = {
    uuid: "Scene.room.Token.enemy",
    actor: { system: { attributes: { senses: { ranges: { blindsight: 0 } } } } },
    center: { x: 600, y: 400 },
    document: { uuid: "Scene.room.Token.enemy", parent: h.scene }
  };
  const modifiers = [];
  const workflow = {
    token: h.token.object,
    activity: { attack: {} },
    targets: new Set([enemy]),
    tracker: {
      advantage: { add: (key) => modifiers.push(["adv", key]) },
      disadvantage: { add: (key) => modifiers.push(["dis", key]) }
    }
  };
  registerDarknessRegionHooks({ game, Hooks: { on: (name, fn) => h.hooks.set(name, fn) } });
  const roll = h.hooks.get("midi-qol.preAttackRollConfig");
  roll(workflow);
  assert.deepEqual(modifiers, [["adv", h.region.uuid]]);
  modifiers.length = 0;
  enemy.actor.system.attributes.senses.ranges.blindsight = 30;
  visibility.canSeeTokens = ["Scene.room.Token.different"];
  roll(workflow);
  assert.deepEqual(modifiers, [["dis", h.region.uuid]]);
  modifiers.length = 0;
  intersects = false;
  roll(workflow);
  assert.deepEqual(modifiers, []);
});

test("client stamps only a Darkness region from the matching native cast; persisted proof works on the active GM", async (t) => {
  const h = fixture(t);
  globalThis.MidiQOL.Workflow.getWorkflow = () => ({ item: h.item, itemCardUuid: h.msg.uuid, token: h.token.object });
  h.region.updateSource = (changes) => {
    h.region.flags["rebreya-main"] = { darknessItemCard: changes["flags.rebreya-main.darknessItemCard"] };
  };
  registerDarknessRegionHooks({ game, Hooks: { on: (name, fn) => h.hooks.set(name, fn) } });
  h.hooks.get("preCreateRegion")(h.region);
  assert.equal(h.region.flags["rebreya-main"].darknessItemCard, h.msg.uuid);
  globalThis.MidiQOL.Workflow.getWorkflow = () => undefined;
  assert.equal(await configureDarknessRegion(h.payload, { sender: h.sender }), true);
  h.region.flags["rebreya-main"].darknessItemCard = "ChatMessage.other";
  assert.equal(await configureDarknessRegion(h.payload, { sender: h.sender }), false);
});

test("owner confirms placement before attesting their exact usage card; a remote GM can recover the cast without the player's workflow", async (t) => {
  const h = fixture(t);
  const { requestDarknessRegion } =
    await import("../scripts/integrations/world-card-automations/selected/lib/darkness-region.js");
  const gm = game.user;
  game.user = h.sender;
  h.actor.isOwner = true;
  const workflow = {
    item: h.item,
    template: h.region,
    templateUuid: h.region.uuid,
    token: h.token.object,
    itemCardUuid: h.msg.uuid
  };
  h.msg.setFlag = async (scope, key, value) => {
    h.msg.flags = { [scope]: { [key]: value } };
  };
  let choice = null,
    writes = 0;
  foundry.applications.api.DialogV2.wait = async () => choice;
  const request = async (command, payload) => {
    writes++;
    assert.equal(command, "configureDarknessRegion");
    assert.equal(payload.attach, false);
    game.user = gm;
    MidiQOL.Workflow.getWorkflow = () => undefined;
    return configureDarknessRegion(payload, { sender: h.sender });
  };
  assert.equal(await requestDarknessRegion(workflow, request), false);
  assert.equal(h.msg.flags, undefined);
  assert.equal(writes, 0);
  choice = "stationary";
  assert.equal(await requestDarknessRegion(workflow, request), true);
  assert.equal(writes, 1);
  assert.equal(h.msg.flags["rebreya-main"].darknessRegion, h.region.uuid);
});
