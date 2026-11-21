import test from "node:test";
import assert from "node:assert/strict";

import { SiteShareImport, SHARE_IMPORT_REQUEST, SOCKET_CHANNEL } from "../scripts/integrations/site-share-import.js";

// --- Fakes ------------------------------------------------------------------------
// A socket bus like Foundry's module sockets: emit reaches every OTHER client.

function makeBus() {
  const clients = [];
  return {
    clients,
    socketFor(client) {
      return {
        on: (channel, fn) => { client.listeners.push({ channel, fn }); },
        emit: (channel, message) => {
          for (const other of clients) {
            if (other === client) continue;
            for (const l of other.listeners) if (l.channel === channel) l.fn(structuredClone(message));
          }
          client.sent.push(structuredClone(message));
        },
      };
    },
  };
}

function makeWorld() {
  const actors = new Map();
  let n = 0;
  const ActorClass = {
    async create(data) {
      const actor = { id: `actor${++n}`, isOwner: true, ...structuredClone(data) };
      actors.set(actor.id, actor);
      return actor;
    },
  };
  return { actors, ActorClass };
}

function makeClient({ bus, world, user, users, claim, linkTokens = {} }) {
  const client = { listeners: [], sent: [], imports: [], claims: [], linkTokens };
  const game = {
    user,
    users: Object.assign(new Map(users.map((u) => [u.id, u])), {
      get activeGM() { return users.find((u) => u.isGM && u.active) ?? null; },
    }),
    world: { id: "testovyj3", title: "Ребрея мейн" },
    actors: { get: (id) => world.actors.get(id) ?? null },
    socket: null,
  };
  bus.clients.push(client);
  game.socket = bus.socketFor(client);
  const moduleApi = {
    site: {
      isEnabled: () => true,
      api: {
        claimShareCode: async (code, label) => {
          client.claims.push({ code, label });
          if (claim instanceof Error) throw claim;
          return structuredClone(claim);
        },
      },
      setLinkToken: async (actorId, data) => { client.linkTokens[actorId] = data; },
    },
    characterSync: {
      importBuild: async (actor, character, opts) => {
        client.imports.push({ actorId: actor.id, name: character.name, opts });
        return { itemsCreated: 3, spellsAdded: 1, classes: ["Воин 5"], warnings: [] };
      },
    },
  };
  const service = new SiteShareImport(moduleApi, { gameRef: () => game, actorClass: () => world.ActorClass, timeoutMs: 500 });
  service.registerSocket();
  return { client, game, service };
}

const PLAYER = { id: "player1", isGM: false, active: true, can: () => false };
const PLAYER_TRUSTED = { id: "player2", isGM: false, active: true, can: (p) => p === "ACTOR_CREATE" };
const GM = { id: "gm1", isGM: true, active: true, can: () => true };
const CLAIM = { linkToken: "T".repeat(43), character: { id: 7, name: "Тайрен" } };

// --- Tests ------------------------------------------------------------------------

test("player who may create Actors: created locally, owned by them, token stored locally", async () => {
  const bus = makeBus();
  const world = makeWorld();
  const { client, service } = makeClient({ bus, world, user: PLAYER_TRUSTED, users: [PLAYER_TRUSTED], claim: CLAIM });
  const { actor, route } = await service.importByCode("k7qm-2xpa");
  assert.equal(route, "local");
  assert.equal(actor.ownership.player2, 3);
  assert.equal(actor.ownership.default, 0);
  assert.equal(client.claims[0].label, "Foundry: Ребрея мейн");
  assert.equal(client.imports[0].opts.syncMode, "link-token");
  assert.equal(client.linkTokens[actor.id].token, CLAIM.linkToken);
  assert.equal(client.sent.length, 0, "nothing on the socket");
});

test("player without ACTOR_CREATE: relayed to the active GM; the token never leaves the player", async () => {
  const bus = makeBus();
  const world = makeWorld();
  const users = [PLAYER, GM];
  const gm = makeClient({ bus, world, user: GM, users, claim: new Error("GM must not claim") });
  const player = makeClient({ bus, world, user: PLAYER, users, claim: CLAIM });

  const { actor, route, result } = await player.service.importByCode("K7QM2XPA");
  assert.equal(route, "gm");
  assert.equal(actor.ownership.player1, 3, "owned by the requesting player");
  assert.equal(gm.client.imports.length, 1, "GM client imported the build");
  assert.equal(gm.client.imports[0].opts.ownerUserId, "player1");
  assert.equal(gm.client.claims.length, 0, "GM never claims the code");
  assert.deepEqual(result.classes, ["Воин 5"]);
  assert.equal(player.client.linkTokens[actor.id].token, CLAIM.linkToken);
  assert.equal(Object.keys(gm.client.linkTokens).length, 0, "GM has no token");
  const everything = JSON.stringify([...player.client.sent, ...gm.client.sent]);
  assert.equal(everything.includes(CLAIM.linkToken), false, "token absent from all socket traffic");
});

test("no GM online: refuses BEFORE claiming, so the single-use code is not burnt", async () => {
  const bus = makeBus();
  const world = makeWorld();
  const { client, service } = makeClient({ bus, world, user: PLAYER, users: [PLAYER, { ...GM, active: false }], claim: CLAIM });
  await assert.rejects(() => service.importByCode("K7QM2XPA"), /ГМа сейчас нет/);
  assert.equal(client.claims.length, 0);
});

test("GM failure is reported to the player; non-GM clients ignore requests", async () => {
  const bus = makeBus();
  const world = makeWorld();
  const users = [PLAYER, GM, PLAYER_TRUSTED];
  const gm = makeClient({ bus, world, user: GM, users, claim: CLAIM });
  gm.service.moduleApi.characterSync.importBuild = async () => { throw new Error("компендий сломан"); };
  const bystander = makeClient({ bus, world, user: PLAYER_TRUSTED, users, claim: CLAIM });
  const player = makeClient({ bus, world, user: PLAYER, users, claim: CLAIM });
  await assert.rejects(() => player.service.importByCode("K7QM2XPA"), /компендий сломан/);
  assert.equal(bystander.client.imports.length, 0);
  assert.equal(bystander.client.sent.length, 0);
});

test("GM that never answers → timeout with a clear message", async () => {
  const bus = makeBus();
  const world = makeWorld();
  // GM is "online" per users list but has no client on the bus.
  const player = makeClient({ bus, world, user: PLAYER, users: [PLAYER, GM], claim: CLAIM });
  await assert.rejects(() => player.service.importByCode("K7QM2XPA"), /не ответил/);
  assert.equal(player.client.sent[0].type, SHARE_IMPORT_REQUEST);
});

test("existing Actor (sheet panel): imports into it and stores the token, no socket", async () => {
  const bus = makeBus();
  const world = makeWorld();
  const { client, service } = makeClient({ bus, world, user: PLAYER, users: [PLAYER], claim: CLAIM });
  const actor = { id: "sheetActor", isOwner: true };
  const res = await service.importByCode("K7QM2XPA", { actor });
  assert.equal(res.route, "existing");
  assert.equal(client.imports[0].actorId, "sheetActor");
  assert.equal(client.linkTokens.sheetActor.token, CLAIM.linkToken);
  await assert.rejects(() => service.importByCode("K7QM2XPA", { actor: { id: "x", isOwner: false } }), /не владелец/);
});

test("invalid code from the site is surfaced and nothing is created or stored", async () => {
  const bus = makeBus();
  const world = makeWorld();
  const { client, service } = makeClient({ bus, world, user: PLAYER_TRUSTED, users: [PLAYER_TRUSTED], claim: new Error("Код недействителен или устарел") });
  await assert.rejects(() => service.importByCode("AAAA-BBBB"), /недействителен/);
  assert.equal(world.actors.size, 0);
  assert.deepEqual(client.linkTokens, {});
  assert.equal(SOCKET_CHANNEL, "module.rebreya-main");
});
