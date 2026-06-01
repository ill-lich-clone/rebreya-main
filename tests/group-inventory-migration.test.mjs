import test from "node:test";
import assert from "node:assert/strict";

import { InventoryService } from "../scripts/data/inventory-service.js";

function installFoundryUtils() {
  const previousFoundry = globalThis.foundry;
  globalThis.foundry = {
    utils: {
      deepClone: (value) => JSON.parse(JSON.stringify(value)),
      getProperty: (source, path) => String(path ?? "").split(".").reduce((current, part) => current?.[part], source),
      mergeObject: (target, source) => ({ ...target, ...source }),
      setProperty: (source, path, value) => {
        const parts = String(path ?? "").split(".");
        let cursor = source;
        for (const [index, part] of parts.entries()) {
          if (index === parts.length - 1) {
            cursor[part] = value;
            return;
          }

          cursor[part] ??= {};
          cursor = cursor[part];
        }
      }
    }
  };
  return () => {
    globalThis.foundry = previousFoundry;
  };
}

function createActor({ id, name = "Actor", type = "npc", isOwner = false } = {}) {
  return {
    id,
    name,
    type,
    img: "icons/svg/mystery-man.svg",
    isOwner,
    system: {
      currency: {}
    },
    items: {
      contents: [],
      get: () => null
    },
    getFlag: () => false
  };
}

function installInventoryFixture({
  actors = [],
  user = { id: "gm", isGM: true },
  partyState = {}
} = {}) {
  const restoreFoundry = installFoundryUtils();
  const previousGame = globalThis.game;
  const previousActor = globalThis.Actor;
  const previousConst = globalThis.CONST;
  let state = partyState;
  let actorCreateCalls = 0;
  let createdActor = null;

  globalThis.Actor = class TestActor {
    static async create(data) {
      actorCreateCalls += 1;
      createdActor = createActor({
        id: "legacy-party",
        name: data.name,
        type: data.type,
        isOwner: true
      });
      createdActor.img = data.img;
      createdActor.flags = data.flags;
      actors.push(createdActor);
      return createdActor;
    }
  };
  globalThis.CONST = {
    DOCUMENT_OWNERSHIP_LEVELS: {
      OWNER: 3,
      OBSERVER: 2
    }
  };
  globalThis.game = {
    user,
    actors: {
      contents: actors,
      get: (actorId) => actors.find((actor) => actor.id === actorId) ?? null
    },
    settings: {
      get: () => state,
      set: async (_moduleId, _key, nextState) => {
        state = nextState;
        return nextState;
      }
    }
  };

  return {
    get actorCreateCalls() {
      return actorCreateCalls;
    },
    get createdActor() {
      return createdActor;
    },
    get state() {
      return state;
    },
    restore() {
      globalThis.game = previousGame;
      globalThis.Actor = previousActor;
      globalThis.CONST = previousConst;
      restoreFoundry();
    }
  };
}

test("getInventoryActor returns resolved dnd5e group actor when group context exists", async () => {
  const groupActor = createActor({ id: "group-1", name: "Party", type: "group", isOwner: true });
  const fixture = installInventoryFixture({
    actors: [groupActor],
    partyState: { inventoryActorId: "legacy-party" }
  });
  const legacyActor = createActor({ id: "legacy-party", name: "Инвентарь группы Rebreya", type: "npc", isOwner: true });
  game.actors.contents.push(legacyActor);
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({ groupActor })
    }
  });

  try {
    const actor = await service.getInventoryActor({ create: true });

    assert.equal(actor, groupActor);
  }
  finally {
    fixture.restore();
  }
});

test("getInventoryActor does not create legacy actor when group context resolves", async () => {
  const groupActor = createActor({ id: "group-1", name: "Party", type: "group", isOwner: true });
  const fixture = installInventoryFixture({ actors: [groupActor] });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({ groupActor })
    }
  });

  try {
    const actor = await service.getInventoryActor({ create: true });

    assert.equal(actor, groupActor);
    assert.equal(fixture.actorCreateCalls, 0);
  }
  finally {
    fixture.restore();
  }
});

test("getInventoryActor preserves legacy actor creation without group context service", async () => {
  const fixture = installInventoryFixture();
  const service = new InventoryService({});

  try {
    const actor = await service.getInventoryActor({ create: true });

    assert.equal(actor, fixture.createdActor);
    assert.equal(actor.name, "Инвентарь группы Rebreya");
    assert.equal(actor.type, "npc");
    assert.equal(fixture.state.inventoryActorId, "legacy-party");

    const foundActor = await service.getInventoryActor({ create: true });
    assert.equal(foundActor, actor);
    assert.equal(fixture.actorCreateCalls, 1);
  }
  finally {
    fixture.restore();
  }
});

test("canManagePartyInventory allows GMs and resolved group actor owners only", () => {
  const groupActor = createActor({ id: "group-1", name: "Party", type: "group", isOwner: true });
  const fixture = installInventoryFixture({
    actors: [groupActor],
    user: { id: "player-1", isGM: false }
  });
  const service = new InventoryService({
    groupContextService: {
      resolveForCurrentUser: () => ({ groupActor })
    }
  });

  try {
    assert.equal(service.canManagePartyInventory(), true);

    groupActor.isOwner = false;
    assert.equal(service.canManagePartyInventory(), false);

    game.user = { id: "gm", isGM: true };
    assert.equal(service.canManagePartyInventory(), true);
  }
  finally {
    fixture.restore();
  }
});
