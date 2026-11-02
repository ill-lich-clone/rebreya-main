import test from "node:test";
import assert from "node:assert/strict";
import {
  registerWorldCardTransport,
  socket,
  sockets
} from "../scripts/integrations/world-card-automations/selected/lib/sockets.js";
import { loadInstalledClass } from "./helpers/installed-combat-providers.mjs";

function fixture() {
  const player = { id: "p", name: "Player", active: true },
    gm = { id: "g", name: "GM", active: true, isGM: true };
  const users = new Map([
    [player.id, player],
    [gm.id, gm]
  ]);
  users.activeGM = gm;
  const game = { user: gm, users },
    handlers = new Map(),
    calls = [];
  const provider = {
    register: (name, fn) => handlers.set(name, fn),
    executeAsUser: (...args) => {
      calls.push(args);
    }
  };
  const cards = new Map();
  let yes = true;
  registerWorldCardTransport({
    socketlib: { registerModule: () => provider },
    game,
    resolve: (uuid) => cards.get(uuid),
    confirm: async () => yes,
    moveCardToken: async (p, { sender }) => sender.id
  });
  const request = (op, payload, senderId = player.id) =>
    handlers.get("worldCard." + op).call({ socketdata: { userId: senderId } }, payload);
  return {
    game,
    player,
    gm,
    cards,
    calls,
    request,
    handlers,
    decline: () => {
      yes = false;
    }
  };
}
test("authority authenticates the socketlib sender and only runs the named GM action on the active GM", async () => {
  const e = fixture();
  assert.equal(await e.request("moveCardToken", {}), "p");
  await assert.rejects(e.request("moveCardToken", { senderId: "g" }, "forged"));
  e.game.user = e.player;
  await assert.rejects(e.request("moveCardToken", {}));
  assert.equal(e.handlers.has("worldCard.syntheticItemDataRoll"), false);
  assert.equal(e.handlers.has("worldCard.updateEntity"), false);
});
test("arbitrary synthetic items and remote document updates never reach a GM", async () => {
  const e = fixture();
  e.game.user = e.player;
  await assert.rejects(socket.executeAsGM(sockets.syntheticItemDataRoll.name, { name: "x" }, "Actor.other", []));
  await assert.rejects(socket.executeAsGM(sockets.updateEntity.name, "Actor.other", { ownership: { p: 3 } }));
  assert.deepEqual(e.calls, []);
});
test("the installed socketlib request implementation supplies the authenticated transport sender", async () => {
  const e = fixture(),
    result = [];
  const Socket = await loadInstalledClass("socketlib/src/socketlib.js", "SocketlibSocket", {
    Array,
    game: { userId: "g" },
    MESSAGE_TYPES: { REQUEST: 1, COMMAND: 2 }
  });
  await Socket.prototype._handleRequest.call(
    {
      _resolveFunction: () => ["worldCard.moveCardToken", e.handlers.get("worldCard.moveCardToken")],
      _sendResult: (_, value) => result.push(value)
    },
    {
      type: 1,
      id: "r",
      recipient: ["g"],
      userId: "g",
      handlerName: "worldCard.moveCardToken",
      args: [{ userId: "g" }]
    },
    "p"
  );
  assert.deepEqual(result, ["p"]);
});
test("a verified card effect uses the local recipe after consent and never executes client data", async () => {
  const e = fixture(),
    caster = { id: "pc", uuid: "Actor.pc", documentName: "Actor", testUserPermission: (u) => u.id === "p" };
  const item = {
    uuid: "Actor.pc.Item.sp",
    documentName: "Item",
    name: "Chill Touch",
    actor: caster,
    img: "",
    system: {},
    flags: { "chris-premades": { info: { identifier: "chillTouch" } } }
  };
  let made;
  const target = {
    uuid: "Actor.npc",
    name: "NPC",
    documentName: "Actor",
    system: {},
    createEmbeddedDocuments: async (_, docs) => {
      [made] = docs;
      return [{ uuid: "Actor.npc.ActiveEffect.a" }];
    }
  };
  for (const d of [caster, item, target]) e.cards.set(d.uuid, d);
  const payload = { source: item.uuid, target: target.uuid, recipe: "chillTouchChilled", requestId: "samplecast" };
  assert.equal(await e.request("applyEffect", payload), "Actor.npc.ActiveEffect.a");
  assert.equal(made.system.changes[0].key, "system.traits.di.value");
  await assert.rejects(e.request("applyEffect", { ...payload, changes: [{ key: "macro.execute" }] }));
  item.actor.testUserPermission = () => false;
  await assert.rejects(e.request("applyEffect", payload));
  item.actor.testUserPermission = () => true;
  e.decline();
  await assert.rejects(e.request("applyEffect", payload));
});

test("cross-owner creation sends IDs to the online target owner and discards the caller's raw effect", async () => {
  const e = fixture(),
    owner = { id: "owner", active: true, isGM: false };
  e.game.users.set(owner.id, owner);
  e.game.user = e.player;
  const source = {
    uuid: "Actor.pc.Item.sp",
    documentName: "Item",
    flags: { "chris-premades": { info: { identifier: "chillTouch" } } }
  };
  const target = { uuid: "Actor.enemy", documentName: "Actor", testUserPermission: (user) => user === owner };
  e.cards.set(source.uuid, source);
  e.cards.set(target.uuid, target);
  await socket.executeAsGM(
    "createEffect",
    target.uuid,
    {
      origin: source.uuid,
      flags: { "chris-premades": { info: { identifier: "chillTouchChilled" }, macros: { effect: ["evil"] } } },
      system: { changes: [{ key: "macro.execute", value: "evil" }] }
    },
    {}
  );
  const [[op, id, payload]] = e.calls;
  assert.equal(op, "worldCard.applyEffect");
  assert.equal(id, "owner");
  assert.ok(payload.requestId);
  assert.deepEqual(
    { ...payload, requestId: null },
    { target: target.uuid, source: source.uuid, recipe: "chillTouchChilled", requestId: null }
  );
});

test("attempts to delete or link a player-edited effect cannot borrow GM authority", async () => {
  const e = fixture(),
    source = { uuid: "Actor.pc.Item.sp", documentName: "Item", actor: { testUserPermission: (u) => u === e.player } };
  const target = { documentName: "Actor", name: "NPC", uuid: "Actor.npc" };
  const effect = {
    uuid: "Actor.npc.ActiveEffect.e",
    documentName: "ActiveEffect",
    parent: target,
    _stats: { lastModifiedBy: e.player.id },
    flags: { "rebreya-main": { worldCardAuthority: { source: source.uuid } } },
    delete: () => assert.fail("unauthorized deletion")
  };
  e.cards.set(effect.uuid, effect);
  e.cards.set(source.uuid, source);
  await assert.rejects(e.request("endEffect", { effect: effect.uuid }));
});

test("a confirmed grapple grants the exact shipped Escape action on the target and anchors it to its own effect", async () => {
  const e = fixture(),
    caster = { uuid: "Actor.pc", documentName: "Actor", testUserPermission: (u) => u === e.player };
  const item = {
    uuid: "Actor.pc.Item.gr",
    name: "Grapple",
    documentName: "Item",
    actor: caster,
    system: {},
    flags: { "chris-premades": { info: { identifier: "grapple" } } }
  };
  const target = { name: "NPC", uuid: "Actor.npc", documentName: "Actor", items: [], system: {}, effects: [] };
  const sourceToken = {
    uuid: "Scene.s.Token.pc",
    id: "pc",
    name: "Grappler",
    actor: caster,
    parent: { tokens: new Map([["npc", { actor: target }]]) }
  };
  const parent = {
    uuid: "Actor.pc.ActiveEffect.gr",
    documentName: "ActiveEffect",
    parent: caster,
    origin: caster.uuid,
    flags: { "chris-premades": { info: { identifier: "grappling" }, grapple: { tokenId: "npc" } } }
  };
  for (const d of [item, target, parent, sourceToken, caster]) e.cards.set(d.uuid, d);
  target.createEmbeddedDocuments = async (type, [document]) => {
    const d = { ...document, documentName: type, uuid: target.uuid + "." + type + ".result", parent: target };
    e.cards.set(d.uuid, d);
    (type === "Item" ? target.items : target.effects).push(d);
    return [d];
  };
  const params = {
    source: item.uuid,
    parent: parent.uuid,
    target: target.uuid,
    sourceToken: sourceToken.uuid,
    recipe: "grappled",
    requestId: "castnumberone"
  };
  const [effect, duplicate] = await Promise.all([
    e.request("applyEffect", params),
    e.request("applyEffect", { ...params, requestId: "castnumbertwo" })
  ]);
  assert.equal(effect, duplicate);
  assert.equal(await e.request("applyEffect", params), effect);
  assert.equal(target.effects.length, 1);
  const [escape] = await e.request("escapeAction", { target: target.uuid, effect });
  assert.equal(e.cards.get(escape).flags.dnd5e.dependentOn, effect);
  assert.equal(e.cards.get(escape).flags["chris-premades"].info.identifier, "grappleEscape");
  assert.deepEqual(await e.request("escapeAction", { target: target.uuid, effect }), [escape]);
  assert.equal(target.items.length, 1);
});
