import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../scripts/constants.js";
import {
  BUILTIN_STORAGE_PRESETS,
  GROUND_PILE_STORAGE_PRESET
} from "../scripts/data/builtin-storage-presets.js";
import {
  BUILTIN_STORAGE_FOLDER_NAME,
  BUILTIN_STORAGE_PRESET_FLAG,
  BuiltinStorageActorService,
  buildBuiltinStorageActorData
} from "../scripts/data/builtin-storage-actor-service.js";

function createHarness({ active = true, failPresetId = "" } = {}) {
  const currentUser = { id: "gm-primary", isGM: true, active };
  const folders = [];
  const actors = [];
  const folderCreates = [];
  const actorCreates = [];
  const game = {
    user: currentUser,
    users: { activeGM: active ? currentUser : null, contents: [currentUser] },
    folders: { contents: folders },
    actors: { contents: actors }
  };

  const Folder = {
    async create(data) {
      folderCreates.push(structuredClone(data));
      const folder = { ...structuredClone(data), id: `folder-${folderCreates.length}` };
      folders.push(folder);
      return folder;
    }
  };
  const Actor = {
    async create(data, options) {
      actorCreates.push({ data: structuredClone(data), options: structuredClone(options) });
      const presetId = data.flags[MODULE_ID][BUILTIN_STORAGE_PRESET_FLAG].id;
      if (presetId === failPresetId) {
        throw new Error(`rejected ${presetId}`);
      }
      const actor = {
        ...structuredClone(data),
        id: `actor-${actorCreates.length}`,
        getFlag(scope, key) {
          return this.flags?.[scope]?.[key];
        }
      };
      actors.push(actor);
      return actor;
    }
  };

  const service = new BuiltinStorageActorService({
    gameProvider: () => game,
    folderProvider: () => Folder,
    actorProvider: () => Actor,
    logger: { error() {} }
  });
  return { service, game, folders, actors, folderCreates, actorCreates };
}

test("built-in storage Actor data creates an unlinked closed NPC with independent token state", () => {
  const preset = BUILTIN_STORAGE_PRESETS[0];
  const data = buildBuiltinStorageActorData(preset, "storage-folder");
  const storage = data.prototypeToken.flags[MODULE_ID].storage;

  assert.equal(data.name, "Сундук — медные монеты");
  assert.equal(data.type, "npc");
  assert.equal(data.folder, "storage-folder");
  assert.equal(data.flags[MODULE_ID].storage.enabled, true);
  assert.equal(data.flags[MODULE_ID][BUILTIN_STORAGE_PRESET_FLAG].id, "wood-dark-copper");
  assert.equal(data.prototypeToken.actorLink, false);
  assert.equal(data.prototypeToken.name, "Сундук");
  assert.equal(data.prototypeToken.texture.src, preset.textures.unopened);
  assert.deepEqual(storage.textures, preset.textures);
  assert.equal(storage.baseName, "Сундук");
  assert.equal(storage.state, "unopened");
  assert.equal(storage.displayMode, "unopened");
  assert.deepEqual(storage.manualCoins, { pp: 0, gp: 0, sp: 0, cp: 0 });
  assert.deepEqual(storage.generatedCoins, { pp: 0, gp: 0, sp: 0, cp: 0 });

  data.prototypeToken.texture.src = "changed.webp";
  assert.equal(preset.prototypeToken.texture.src, preset.textures.unopened);
});

test("ground pile Actor data creates an unlinked already-open storage prototype", () => {
  const data = buildBuiltinStorageActorData(GROUND_PILE_STORAGE_PRESET, "storage-folder");
  const storage = data.prototypeToken.flags[MODULE_ID].storage;

  assert.equal(data.name, "Куча предметов");
  assert.equal(data.flags[MODULE_ID].storage.enabled, true);
  assert.equal(data.flags[MODULE_ID].groundPilePrototype.enabled, true);
  assert.equal(data.prototypeToken.actorLink, false);
  assert.equal(data.prototypeToken.flags[MODULE_ID].groundPile.enabled, true);
  assert.equal(storage.state, "opened");
  assert.equal(storage.displayMode, "opened");
});

test("inactive GM clients do not read or create built-in storage documents", async () => {
  const harness = createHarness({ active: false });

  assert.equal(await harness.service.sync(), null);
  assert.equal(harness.folderCreates.length, 0);
  assert.equal(harness.actorCreates.length, 0);
});

test("active GM creates the root folder, three chests, and one pile Actor exactly once", async () => {
  const harness = createHarness();

  const first = await harness.service.sync();
  const second = await harness.service.sync();

  assert.equal(harness.folderCreates.length, 1);
  assert.deepEqual(harness.folderCreates[0], {
    name: BUILTIN_STORAGE_FOLDER_NAME,
    type: "Actor",
    folder: null
  });
  assert.equal(harness.actorCreates.length, 4);
  assert.deepEqual(
    first.actors.map((actor) => actor.getFlag(MODULE_ID, BUILTIN_STORAGE_PRESET_FLAG).id),
    ["wood-dark-copper", "wood-dark-silver", "wood-dark-gold", "ground-pile"]
  );
  assert.deepEqual(second.actors, first.actors);
});

test("sync restores only a missing preset and preserves edits to existing Actors", async () => {
  const harness = createHarness();
  await harness.service.sync();
  const copper = harness.actors.find((actor) => (
    actor.getFlag(MODULE_ID, BUILTIN_STORAGE_PRESET_FLAG).id === "wood-dark-copper"
  ));
  copper.name = "Мой медный сундук";
  const silverIndex = harness.actors.findIndex((actor) => (
    actor.getFlag(MODULE_ID, BUILTIN_STORAGE_PRESET_FLAG).id === "wood-dark-silver"
  ));
  harness.actors.splice(silverIndex, 1);

  const result = await harness.service.sync();

  assert.equal(harness.folderCreates.length, 1);
  assert.equal(harness.actorCreates.length, 5);
  assert.equal(copper.name, "Мой медный сундук");
  assert.equal(result.actors.length, 4);
  assert.equal(result.actors.filter((actor) => (
    actor.getFlag(MODULE_ID, BUILTIN_STORAGE_PRESET_FLAG).id === "wood-dark-silver"
  )).length, 1);
});

test("one rejected preset does not prevent the other built-in Actors from being restored", async () => {
  const harness = createHarness({ failPresetId: "wood-dark-silver" });

  const result = await harness.service.sync();

  assert.deepEqual(
    result.actors.map((actor) => actor.getFlag(MODULE_ID, BUILTIN_STORAGE_PRESET_FLAG).id),
    ["wood-dark-copper", "wood-dark-gold", "ground-pile"]
  );
  assert.equal(harness.actorCreates.length, 4);
});
