import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";

import {
  CRAFTSMAN_CONSTRUCT_DOCUMENT_ID,
  CRAFTSMAN_CONSTRUCT_TOKEN_PATH,
  CRAFTSMAN_CONSTRUCT_UUID
} from "../scripts/constants.js";
import {
  CraftsmanConstructCompendiumService,
  buildCraftsmanConstructActorData
} from "../scripts/data/craftsman-construct-compendium.js";

test("construct actor has the exact base stat block and unlinked token", () => {
  const actor = buildCraftsmanConstructActorData();
  assert.equal(actor._id, CRAFTSMAN_CONSTRUCT_DOCUMENT_ID);
  assert.equal(actor.type, "npc");
  assert.equal(actor.prototypeToken.actorLink, false);
  assert.equal(actor.prototypeToken.texture.src, CRAFTSMAN_CONSTRUCT_TOKEN_PATH);
  assert.deepEqual(Object.fromEntries(Object.entries(actor.system.abilities).map(([id, ability]) => [id, ability.value])), {
    str: 16, dex: 12, con: 15, int: 8, wis: 10, cha: 7
  });
  assert.equal(actor.system.abilities.dex.proficient, 1);
  assert.equal(actor.system.abilities.wis.proficient, 1);
  assert.deepEqual(actor.system.attributes.hp, { value: 5, max: 5, temp: 0, tempmax: 0, formula: "0d10" });
  assert.equal(actor.system.attributes.ac.flat, 14);
  assert.equal(actor.system.attributes.movement.walk, 30);
  assert.equal(actor.system.attributes.senses.darkvision, 60);
  assert.deepEqual(actor.system.traits.di.value, ["poison"]);
  assert.deepEqual(actor.system.traits.ci.value, ["poisoned", "charmed", "exhaustion"]);
  assert.equal(actor.flags["rebreya-main"].sourceId, "craftsman-construct-template");
  assert.match(CRAFTSMAN_CONSTRUCT_UUID, /\.Actor\.lchconstruct0001$/u);
});

test("construct token asset exists in the module and is non-empty", () => {
  const url = new URL("../templates/icons/Classes/Craftsman/construct-token.webp", import.meta.url);
  assert.equal(existsSync(url), true);
  assert.ok(statSync(url).size > 10000);
});

test("construct compendium sync skips non-active GM clients", async () => {
  const service = new CraftsmanConstructCompendiumService({
    gameProvider: () => ({ system: { id: "dnd5e" } }),
    isActiveGmClient: () => false
  });
  assert.deepEqual(await service.sync(), { skipped: true, pack: null, worldActor: null });
});

test("construct compendium sync creates the stable Actor document and technical world Actor", async () => {
  const packDocuments = [];
  const worldActors = [];
  const pack = {
    collection: "world.rebreya-craftsman-constructs",
    documentName: "Actor",
    metadata: { system: "dnd5e" },
    documentClass: {
      async createDocuments(rows) {
        packDocuments.push(...rows.map((row) => ({
          ...structuredClone(row),
          id: row._id,
          getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
          async update(patch) { Object.assign(this, structuredClone(patch)); }
        })));
      },
      async deleteDocuments() {}
    },
    async getDocuments() { return packDocuments; }
  };
  const game = {
    system: { id: "dnd5e" },
    packs: { get: () => pack },
    actors: { contents: worldActors }
  };
  const Actor = {
    async create(data) {
      const actor = {
        ...structuredClone(data), id: "world-construct",
        getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
        async update(patch) { Object.assign(this, structuredClone(patch)); return this; }
      };
      worldActors.push(actor);
      return actor;
    }
  };
  const service = new CraftsmanConstructCompendiumService({
    gameProvider: () => game,
    actorProvider: () => Actor,
    isActiveGmClient: () => true
  });

  const first = await service.sync();
  const second = await service.sync();

  assert.equal(packDocuments.length, 1);
  assert.equal(packDocuments[0]._id, CRAFTSMAN_CONSTRUCT_DOCUMENT_ID);
  assert.equal(worldActors.length, 1);
  assert.equal(worldActors[0]._stats.compendiumSource, CRAFTSMAN_CONSTRUCT_UUID);
  assert.equal(worldActors[0].ownership.default, 3);
  assert.equal(first.pack, pack);
  assert.equal(second.worldActor, worldActors[0]);
});
