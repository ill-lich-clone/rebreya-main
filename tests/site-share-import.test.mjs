import test from "node:test";
import assert from "node:assert/strict";

import {
  SiteShareImport,
  SHARE_IMPORT_COMMAND,
  MAX_SHARED_CHARACTER_BYTES,
  isValidShareImportPayload,
  authorizeShareImport,
  registerShareImportCommand,
} from "../scripts/integrations/site-share-import.js";
import { SocketCommandBus, COMMAND_REQUEST_TYPE } from "../scripts/infrastructure/foundry/socket-command-bus.js";
import { WorldMutationCoordinator } from "../scripts/application/world-mutation-coordinator.js";

// --- Harness -----------------------------------------------------------------------
// Every client runs the module's real SocketCommandBus. Like Foundry module
// sockets, emit reaches every OTHER client, and the transport sender id is the
// emitting user (what main.js passes as transportSenderId).

function makeWorld(users) {
  const actors = new Map();
  let n = 0;
  const ActorClass = {
    async create(data) {
      const actor = { id: `actor${++n}`, isOwner: true, ...structuredClone(data) };
      actors.set(actor.id, actor);
      return actor;
    },
  };
  return { actors, ActorClass, users, clients: [], traffic: [] };
}

function makeClient(world, user, { claim, requestTimeoutMs = 2000 } = {}) {
  const client = { user, imports: [], claims: [], linkTokens: {} };
  const map = new Map(world.users.map((u) => [u.id, u]));
  map.contents = world.users;
  Object.defineProperty(map, "activeGM", { get: () => world.users.find((u) => u.isGM && u.active) ?? null });
  const game = {
    user,
    users: map,
    world: { id: "testovyj3", title: "Ребрея мейн" },
    actors: { get: (id) => world.actors.get(id) ?? null },
    socket: {
      emit(_channel, message) {
        world.traffic.push(structuredClone(message));
        for (const other of world.clients) {
          if (other === client) continue;
          void other.bus.handleMessage(structuredClone(message), { transportSenderId: user.id });
        }
      },
    },
  };
  client.game = game;
  client.bus = new SocketCommandBus({
    coordinator: new WorldMutationCoordinator(),
    gameProvider: () => game,
    requireExplicitScheduling: true,
    requestTimeoutMs,
    completionTimeoutMs: requestTimeoutMs,
  });
  const moduleApi = {
    socketCommandBus: client.bus,
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
  client.service = new SiteShareImport(moduleApi, { gameRef: () => game, actorClass: () => world.ActorClass });
  registerShareImportCommand(client.bus, client.service);
  world.clients.push(client);
  return client;
}

const PLAYER = { id: "player1", isGM: false, active: true, can: () => false };
const PLAYER_TRUSTED = { id: "player2", isGM: false, active: true, can: (p) => p === "ACTOR_CREATE" };
const GM = { id: "gm1", isGM: true, active: true, can: () => true };
const CLAIM = { linkToken: "T".repeat(43), character: { id: 7, name: "Тайрен" } };

// --- Payload contract --------------------------------------------------------------

test("relay payload is exact: operationId + a site character, size-capped", () => {
  const ok = { operationId: "share-1", character: { id: 7, name: "Тайрен", data: { a: 1 } } };
  assert.equal(isValidShareImportPayload(ok), true);
  for (const bad of [
    null, [], { operationId: "share-1" },
    { ...ok, ownerUserId: "player2" },
    { ...ok, operationId: "bad id!" },
    { ...ok, character: { name: "без id" } },
    { ...ok, character: { id: -1 } },
    { ...ok, character: { id: 7, name: "x".repeat(201) } },
    { ...ok, character: { id: 7, data: "x".repeat(MAX_SHARED_CHARACTER_BYTES) } },
  ]) assert.equal(isValidShareImportPayload(bad), false, JSON.stringify(bad)?.slice(0, 60));
});

test("only a current non-GM user may ask the GM to create their character", () => {
  const users = new Map([[PLAYER.id, PLAYER], [GM.id, GM]]);
  const game = { users };
  assert.equal(authorizeShareImport({}, { sender: PLAYER, game }), true);
  assert.equal(authorizeShareImport({}, { sender: GM, game }), false);
  assert.equal(authorizeShareImport({}, { sender: { ...PLAYER }, game }), false, "not the live User document");
  assert.equal(authorizeShareImport({}, { sender: null, game }), false);
});

// --- Flows -------------------------------------------------------------------------

test("player who may create Actors: created locally, owned by them, nothing on the socket", async () => {
  const world = makeWorld([PLAYER_TRUSTED]);
  const client = makeClient(world, PLAYER_TRUSTED, { claim: CLAIM });
  const { actor, route } = await client.service.importByCode("k7qm-2xpa");
  assert.equal(route, "local");
  assert.equal(actor.ownership.player2, 3);
  assert.equal(actor.ownership.default, 0);
  assert.equal(client.claims[0].label, "Foundry: Ребрея мейн");
  assert.equal(client.imports[0].opts.syncMode, "link-token");
  assert.equal(client.linkTokens[actor.id].token, CLAIM.linkToken);
  assert.equal(world.traffic.length, 0);
});

test("player without ACTOR_CREATE: typed command to the active GM; the token never leaves the player", async () => {
  const world = makeWorld([PLAYER, GM]);
  const gm = makeClient(world, GM, { claim: new Error("GM must not claim") });
  const player = makeClient(world, PLAYER, { claim: CLAIM });

  const { actor, route, result } = await player.service.importByCode("K7QM2XPA");
  assert.equal(route, "gm");
  assert.equal(actor.ownership.player1, 3, "owned by the requesting player");
  assert.equal(gm.imports.length, 1, "GM client imported the build");
  assert.equal(gm.imports[0].opts.ownerUserId, "player1");
  assert.equal(gm.claims.length, 0, "GM never claims the code");
  assert.deepEqual(result.classes, ["Воин 5"]);
  assert.equal(player.linkTokens[actor.id].token, CLAIM.linkToken);
  assert.deepEqual(gm.linkTokens, {}, "GM has no token");
  assert.ok(world.traffic.some((m) => m.type === COMMAND_REQUEST_TYPE && m.command === SHARE_IMPORT_COMMAND));
  assert.equal(JSON.stringify(world.traffic).includes(CLAIM.linkToken), false, "token absent from all socket traffic");
});

test("a forged sender id is rejected by the bus: no Actor is created for someone else", async () => {
  const world = makeWorld([PLAYER, PLAYER_TRUSTED, GM]);
  const gm = makeClient(world, GM, { claim: CLAIM });
  makeClient(world, PLAYER, { claim: CLAIM });
  // player1 hand-crafts a request claiming to be player2.
  gm.bus.handleMessage({
    type: COMMAND_REQUEST_TYPE,
    command: SHARE_IMPORT_COMMAND,
    requestId: "forged-1",
    senderId: "player2",
    payload: { operationId: "forged-1", character: { id: 9, name: "Подделка" } },
  }, { transportSenderId: "player1" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(world.actors.size, 0);
  assert.equal(gm.imports.length, 0);
});

test("no GM online: refuses BEFORE claiming, so the single-use code is not burnt", async () => {
  const world = makeWorld([PLAYER, { ...GM, active: false }]);
  const client = makeClient(world, PLAYER, { claim: CLAIM });
  await assert.rejects(() => client.service.importByCode("K7QM2XPA"), /ГМа сейчас нет/);
  assert.equal(client.claims.length, 0);
});

test("GM failure is reported to the player; other players do not execute it", async () => {
  const world = makeWorld([PLAYER, GM, PLAYER_TRUSTED]);
  const gm = makeClient(world, GM, { claim: CLAIM });
  gm.service.moduleApi.characterSync.importBuild = async () => { throw new Error("компендий сломан"); };
  const bystander = makeClient(world, PLAYER_TRUSTED, { claim: CLAIM });
  const player = makeClient(world, PLAYER, { claim: CLAIM });
  await assert.rejects(() => player.service.importByCode("K7QM2XPA"), /компендий сломан.*Код уже использован/s);
  assert.equal(bystander.imports.length, 0);
});

test("GM that never answers → a clear message that the code is spent", async () => {
  const world = makeWorld([PLAYER, GM]); // GM listed as active, but no GM client
  const player = makeClient(world, PLAYER, { claim: CLAIM, requestTimeoutMs: 100 });
  await assert.rejects(() => player.service.importByCode("K7QM2XPA"), /Код уже использован/);
  assert.equal(world.traffic[0].command, SHARE_IMPORT_COMMAND);
});

test("existing Actor (sheet panel): imports into it and stores the token, no socket", async () => {
  const world = makeWorld([PLAYER]);
  const client = makeClient(world, PLAYER, { claim: CLAIM });
  const actor = { id: "sheetActor", isOwner: true };
  const res = await client.service.importByCode("K7QM2XPA", { actor });
  assert.equal(res.route, "existing");
  assert.equal(client.imports[0].actorId, "sheetActor");
  assert.equal(client.linkTokens.sheetActor.token, CLAIM.linkToken);
  await assert.rejects(() => client.service.importByCode("K7QM2XPA", { actor: { id: "x", isOwner: false } }), /не владелец/);
  assert.equal(world.traffic.length, 0);
});

test("invalid code from the site is surfaced and nothing is created or stored", async () => {
  const world = makeWorld([PLAYER_TRUSTED]);
  const client = makeClient(world, PLAYER_TRUSTED, { claim: new Error("Код недействителен или устарел") });
  await assert.rejects(() => client.service.importByCode("AAAA-BBBB"), /недействителен/);
  assert.equal(world.actors.size, 0);
  assert.deepEqual(client.linkTokens, {});
});
