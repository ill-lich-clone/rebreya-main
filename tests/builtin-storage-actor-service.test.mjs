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
import { CHEST_OBJECT_DURABILITY } from "../scripts/data/native-object-durability-service.js";

const EXPECTED_SYNC_IDS = [
  "wood-dark-copper",
  "wood-dark-silver",
  "wood-dark-gold",
  "barrel",
  "wicker-basket",
  "provision-sack",
  "ceramic-storage-jar",
  "wardrobe",
  "kitchen-hutch",
  "dresser",
  "bedside-cabinet",
  "ground-pile"
];

function createHarness({ active = true, failPresetId = "" } = {}) {
  const currentUser = { id: "gm-primary", isGM: true, active };
  const folders = [];
  const actors = [];
  const scenes = [];
  const folderCreates = [];
  const actorCreates = [];
  const game = {
    user: currentUser,
    users: { activeGM: active ? currentUser : null, contents: [currentUser] },
    folders: { contents: folders },
    actors: { contents: actors },
    scenes: { contents: scenes }
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
  return { service, game, folders, actors, scenes, folderCreates, actorCreates };
}

function makeActorUpdatable(actor) {
  actor.updates = [];
  actor.update = async function update(patch) {
    this.updates.push(structuredClone(patch));
  };
  return actor;
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
  assert.equal(data.prototypeToken.sight.enabled, false);
  assert.equal(data.prototypeToken.name, "Сундук");
  assert.equal(data.prototypeToken.texture.src, preset.textures.unopened);
  assert.deepEqual(data.prototypeToken.flags[MODULE_ID].objectDurability, CHEST_OBJECT_DURABILITY);
  assert.deepEqual(data.prototypeToken.delta.system.attributes.hp, { value: 18, max: 18, dt: 0 });
  assert.equal(data.prototypeToken.delta.system.attributes.ac.flat, 15);
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
  assert.equal(storage.storageKind, "pile");
  assert.equal(storage.state, "opened");
  assert.equal(storage.displayMode, "opened");
});

test("built-in furniture Actor data uses its preset token name and storage base name", () => {
  const preset = BUILTIN_STORAGE_PRESETS.find(({ id }) => id === "barrel");
  assert.ok(preset);

  const data = buildBuiltinStorageActorData(preset, "storage-folder");
  const storage = data.prototypeToken.flags[MODULE_ID].storage;

  assert.equal(data.name, "Бочка");
  assert.equal(data.prototypeToken.name, "Бочка");
  assert.equal(storage.baseName, "Бочка");
  assert.equal(storage.storageKind, "chest");
  assert.deepEqual(storage.textures, preset.textures);
  assert.deepEqual(data.prototypeToken.flags[MODULE_ID].objectDurability, CHEST_OBJECT_DURABILITY);
});

test("inactive GM clients do not read or create built-in storage documents", async () => {
  const harness = createHarness({ active: false });

  assert.equal(await harness.service.sync(), null);
  assert.equal(harness.folderCreates.length, 0);
  assert.equal(harness.actorCreates.length, 0);
});

test("active GM creates the root folder and every built-in storage Actor exactly once", async () => {
  const harness = createHarness();

  const first = await harness.service.sync();
  const second = await harness.service.sync();

  assert.equal(harness.folderCreates.length, 1);
  assert.deepEqual(harness.folderCreates[0], {
    name: BUILTIN_STORAGE_FOLDER_NAME,
    type: "Actor",
    folder: null
  });
  assert.equal(harness.actorCreates.length, 12);
  assert.deepEqual(
    first.actors.map((actor) => actor.getFlag(MODULE_ID, BUILTIN_STORAGE_PRESET_FLAG).id),
    EXPECTED_SYNC_IDS
  );
  assert.deepEqual(second.actors, first.actors);
});

test("sync reuses the deterministic oldest storage folder at any nesting level", async () => {
  const cases = [
    {
      name: "oldest known creation time",
      folders: [
        { id: "newer-root", name: BUILTIN_STORAGE_FOLDER_NAME, type: "Actor", folder: null, _stats: { createdTime: 200 } },
        { id: "oldest-nested", name: ` ${BUILTIN_STORAGE_FOLDER_NAME} `, type: "Actor", folder: "parent-folder", _stats: { createdTime: 100 } }
      ],
      expectedId: "oldest-nested"
    },
    {
      name: "known time before missing time",
      folders: [
        { id: "missing-time", name: BUILTIN_STORAGE_FOLDER_NAME, type: "Actor", folder: "parent-folder" },
        { id: "known-time", name: BUILTIN_STORAGE_FOLDER_NAME, type: "Actor", folder: null, _stats: { createdTime: 300 } }
      ],
      expectedId: "known-time"
    },
    {
      name: "stable ID tie break for equal known times",
      folders: [
        { id: "known-z", name: BUILTIN_STORAGE_FOLDER_NAME, type: "Actor", folder: null, _stats: { createdTime: 400 } },
        { id: "known-a", name: BUILTIN_STORAGE_FOLDER_NAME, type: "Actor", folder: "parent-folder", _stats: { createdTime: 400 } }
      ],
      expectedId: "known-a"
    },
    {
      name: "stable ID tie break",
      folders: [
        { id: "folder-z", name: BUILTIN_STORAGE_FOLDER_NAME, type: "Actor", folder: null },
        { id: "folder-a", name: BUILTIN_STORAGE_FOLDER_NAME, type: "Actor", folder: "parent-folder" }
      ],
      expectedId: "folder-a"
    }
  ];

  for (const fixture of cases) {
    const harness = createHarness();
    harness.folders.push(
      { id: `ignored-${fixture.name}`, name: "Другая папка", type: "Actor", folder: null },
      ...structuredClone(fixture.folders)
    );

    const result = await harness.service.sync();

    assert.equal(result.folder.id, fixture.expectedId, fixture.name);
    assert.equal(harness.folderCreates.length, 0, fixture.name);
    assert.equal(harness.actorCreates.length, EXPECTED_SYNC_IDS.length, fixture.name);
    assert.equal(harness.actorCreates.every(({ data }) => data.folder === fixture.expectedId), true, fixture.name);
  }
});

test("sync reconciles existing built-in Actors into the oldest storage folder without deleting duplicates", async () => {
  const harness = createHarness();
  await harness.service.sync();
  const initialFolderCreates = harness.folderCreates.length;
  const canonical = {
    id: "storage-oldest",
    name: BUILTIN_STORAGE_FOLDER_NAME,
    type: "Actor",
    folder: "under-hand-folder",
    _stats: { createdTime: 100 }
  };
  const duplicate = {
    id: "storage-newer",
    name: BUILTIN_STORAGE_FOLDER_NAME,
    type: "Actor",
    folder: null,
    _stats: { createdTime: 200 }
  };
  harness.folders.splice(0, harness.folders.length, duplicate, canonical);

  for (const actor of harness.actors) {
    actor.folder = duplicate.id;
    actor.name = `Пользовательское имя ${actor.id}`;
    makeActorUpdatable(actor);
  }
  const preservedName = harness.actors[0].name;
  const preservedRows = [{ rowId: "kept-row", name: "Содержимое", quantity: 1 }];
  harness.actors[0].prototypeToken.flags[MODULE_ID].storage.manualRows = structuredClone(preservedRows);

  const result = await harness.service.sync();

  assert.equal(result.folder, canonical);
  assert.equal(harness.folderCreates.length, initialFolderCreates);
  assert.deepEqual(harness.folders, [duplicate, canonical]);
  assert.equal(harness.actors[0].name, preservedName);
  for (const actor of harness.actors) {
    assert.equal(actor.updates.length, 1);
    assert.equal(actor.updates[0].folder, canonical.id);
    assert.equal(actor.updates[0]["prototypeToken.sight.enabled"], false);
  }
  assert.deepEqual(
    harness.actors[0].updates[0][`prototypeToken.flags.${MODULE_ID}.storage`].manualRows,
    preservedRows
  );
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
  assert.equal(harness.actorCreates.length, 13);
  assert.equal(copper.name, "Мой медный сундук");
  assert.equal(result.actors.length, 12);
  assert.equal(result.actors.filter((actor) => (
    actor.getFlag(MODULE_ID, BUILTIN_STORAGE_PRESET_FLAG).id === "wood-dark-silver"
  )).length, 1);
});

test("one rejected preset does not prevent the other built-in Actors from being restored", async () => {
  const harness = createHarness({ failPresetId: "wood-dark-silver" });

  const result = await harness.service.sync();

  assert.deepEqual(
    result.actors.map((actor) => actor.getFlag(MODULE_ID, BUILTIN_STORAGE_PRESET_FLAG).id),
    EXPECTED_SYNC_IDS.filter((id) => id !== "wood-dark-silver")
  );
  assert.equal(harness.actorCreates.length, 12);
});

test("sync migrates only automatically inherited scene token names to the preset token name", async () => {
  const harness = createHarness();
  await harness.service.sync();
  const copper = harness.actors.find((actor) => (
    actor.getFlag(MODULE_ID, BUILTIN_STORAGE_PRESET_FLAG).id === "wood-dark-copper"
  ));
  const createToken = (name) => ({
    actorId: copper.id,
    name,
    flags: { [MODULE_ID]: { storage: { baseName: name } } },
    updates: [],
    async update(patch) {
      this.updates.push(structuredClone(patch));
    }
  });
  const automatic = createToken("Сундук — медные монеты");
  const custom = createToken("Мой сундук");
  harness.scenes.push({ tokens: { contents: [automatic, custom] } });

  await harness.service.sync();

  assert.equal(automatic.updates.length, 1);
  assert.equal(automatic.updates[0].name, "Сундук");
  assert.equal(automatic.updates[0][`flags.${MODULE_ID}.storage`].baseName, "Сундук");
  assert.equal(custom.updates.length, 0);
});
