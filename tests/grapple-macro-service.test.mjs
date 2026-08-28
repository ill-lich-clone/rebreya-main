import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGrappleMacroData,
  buildMoveGrappledMacroData,
  GRAPPLE_FOLDER_SOURCE_ID,
  GRAPPLE_MACRO_SOURCE_ID,
  GrappleMacroService,
  MOVE_GRAPPLED_MACRO_SOURCE_ID
} from "../scripts/combat/grapple-macro-service.js";

function collection(contents = []) {
  return { contents };
}

function document(data, updates) {
  return {
    ...structuredClone(data),
    id: data.id ?? data._id,
    async update(patch) {
      updates.push(structuredClone(patch));
      Object.assign(this, structuredClone(patch));
      return this;
    },
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    }
  };
}

function environment({ active = true, folders = [], macros = [] } = {}) {
  const folderUpdates = [];
  const macroUpdates = [];
  const folderCreates = [];
  const macroCreates = [];
  const game = { folders: collection(folders), macros: collection(macros) };
  const Folder = {
    async create(data) {
      folderCreates.push(structuredClone(data));
      const created = document({ ...data, id: `folder-${folderCreates.length}` }, folderUpdates);
      game.folders.contents.push(created);
      return created;
    }
  };
  const Macro = {
    async create(data) {
      macroCreates.push(structuredClone(data));
      const created = document({ ...data, id: `macro-${macroCreates.length}` }, macroUpdates);
      game.macros.contents.push(created);
      return created;
    }
  };
  const service = new GrappleMacroService({
    gameProvider: () => game,
    folderProvider: () => Folder,
    macroProvider: () => Macro,
    isActiveGmClient: () => active,
    observerOwnershipLevel: 1
  });
  return { service, game, folderCreates, macroCreates, folderUpdates, macroUpdates };
}

test("grapple macro builders expose only stable module API calls", () => {
  assert.deepEqual(buildGrappleMacroData("folder-1", { observerOwnershipLevel: 1 }), {
    name: "Захват",
    type: "script",
    scope: "global",
    command: "await game.rebreyaMain?.toggleGrapple?.();",
    folder: "folder-1",
    ownership: { default: 1 },
    flags: { "rebreya-main": { managed: true, sourceId: GRAPPLE_MACRO_SOURCE_ID } }
  });
  assert.deepEqual(buildMoveGrappledMacroData("folder-1", { observerOwnershipLevel: 1 }), {
    name: "Переместить схваченного",
    type: "script",
    scope: "global",
    command: "await game.rebreyaMain?.moveGrappled?.();",
    folder: "folder-1",
    ownership: { default: 1 },
    flags: { "rebreya-main": { managed: true, sourceId: MOVE_GRAPPLED_MACRO_SOURCE_ID } }
  });
});

test("inactive client skips world document synchronization", async () => {
  const env = environment({ active: false });
  assert.deepEqual(await env.service.syncManagedDocuments(), {
    skipped: true,
    folder: null,
    macros: []
  });
  assert.equal(env.folderCreates.length, 0);
  assert.equal(env.macroCreates.length, 0);
});

test("service reuses the oldest exact user Macro folder and preserves unmanaged name collisions", async () => {
  const userCollision = document({ id: "user-macro", name: "Захват", type: "script", flags: {} }, []);
  const env = environment({
    folders: [
      document({ id: "actor-folder", name: "Ребрея", type: "Actor", _stats: { createdTime: 1 } }, []),
      document({ id: "z-folder", name: "Ребрея", type: "Macro", _stats: { createdTime: 20 } }, []),
      document({ id: "a-folder", name: "Ребрея", type: "Macro", _stats: { createdTime: 20 } }, []),
      document({ id: "old-folder", name: "Ребрея", type: "Macro", _stats: { createdTime: 10 } }, [])
    ],
    macros: [userCollision]
  });

  const result = await env.service.syncManagedDocuments();

  assert.equal(result.skipped, false);
  assert.equal(result.folder.id, "old-folder");
  assert.equal(env.folderCreates.length, 0);
  assert.equal(env.macroCreates.length, 2);
  assert.strictEqual(env.game.macros.contents[0], userCollision);
  assert.equal(userCollision.command, undefined);
  assert.deepEqual(result.macros.map((macro) => macro.folder), ["old-folder", "old-folder"]);
});

test("service creates a managed folder, repairs managed macros, and becomes write-free", async () => {
  const folderUpdates = [];
  const macroUpdates = [];
  const managedFolder = document({
    id: "managed-folder",
    name: "Старое имя",
    type: "Macro",
    flags: { "rebreya-main": { managed: true, sourceId: GRAPPLE_FOLDER_SOURCE_ID } }
  }, folderUpdates);
  const grapple = document({
    id: "grapple",
    ...buildGrappleMacroData("wrong-folder", { observerOwnershipLevel: 1 }),
    command: "old",
    flags: { "rebreya-main": { managed: true, sourceId: GRAPPLE_MACRO_SOURCE_ID } }
  }, macroUpdates);
  const env = environment({ folders: [managedFolder], macros: [grapple] });

  const first = await env.service.syncManagedDocuments();
  assert.equal(first.folder.name, "Ребрея");
  assert.equal(first.macros.length, 2);
  assert.equal(folderUpdates.length, 1);
  assert.equal(macroUpdates.length, 1);
  assert.equal(env.macroCreates.length, 1);
  assert.equal(grapple.folder, "managed-folder");

  await env.service.syncManagedDocuments();
  assert.equal(folderUpdates.length, 1);
  assert.equal(macroUpdates.length, 1);
  assert.equal(env.macroCreates.length, 1);
});

test("service creates the managed folder when no exact reusable folder exists", async () => {
  const env = environment({
    folders: [document({ id: "actor-folder", name: "Ребрея", type: "Actor" }, [])]
  });

  const result = await env.service.syncManagedDocuments();

  assert.equal(env.folderCreates.length, 1);
  assert.equal(result.folder.getFlag("rebreya-main", "sourceId"), GRAPPLE_FOLDER_SOURCE_ID);
  assert.equal(env.macroCreates.length, 2);
});
