import { MODULE_ID } from "../constants.js";
import { isActiveGmClient as defaultIsActiveGmClient } from "../infrastructure/foundry/active-gm.js";

export const GRAPPLE_FOLDER_NAME = "Ребрея";
export const GRAPPLE_FOLDER_SOURCE_ID = "grapple-macro-folder";
export const GRAPPLE_MACRO_SOURCE_ID = "grapple-macro";
export const MOVE_GRAPPLED_MACRO_SOURCE_ID = "move-grappled-macro";

const MANAGED_FLAG = "managed";
const SOURCE_ID_FLAG = "sourceId";

function documents(collection) {
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (Array.isArray(collection)) return collection;
  if (typeof collection?.values === "function") return Array.from(collection.values());
  if (collection && typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  return [];
}

function documentId(document) {
  return String(document?.id ?? document?._id ?? "").trim();
}

function documentFlag(document, key) {
  if (typeof document?.getFlag === "function") return document.getFlag(MODULE_ID, key);
  return document?.flags?.[MODULE_ID]?.[key];
}

function managedFlags(sourceId) {
  return { [MODULE_ID]: { [MANAGED_FLAG]: true, [SOURCE_ID_FLAG]: sourceId } };
}

function managedFlagsSnapshot(document) {
  return {
    [MODULE_ID]: {
      [MANAGED_FLAG]: documentFlag(document, MANAGED_FLAG),
      [SOURCE_ID_FLAG]: documentFlag(document, SOURCE_ID_FLAG)
    }
  };
}

function findManaged(collection, sourceId) {
  return documents(collection).find((document) => (
    String(documentFlag(document, SOURCE_ID_FLAG) ?? "").trim() === sourceId
  )) ?? null;
}

function equalData(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function observerLevel() {
  return globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 1;
}

function macroData({ name, command, sourceId, folderId, observerOwnershipLevel }) {
  return {
    name,
    type: "script",
    scope: "global",
    command,
    folder: String(folderId ?? "").trim(),
    ownership: { default: observerOwnershipLevel ?? observerLevel() },
    flags: managedFlags(sourceId)
  };
}

export function buildGrappleMacroData(folderId, options = {}) {
  return macroData({
    name: "Захват",
    command: "await game.rebreyaMain?.toggleGrapple?.();",
    sourceId: GRAPPLE_MACRO_SOURCE_ID,
    folderId,
    observerOwnershipLevel: options.observerOwnershipLevel
  });
}

export function buildMoveGrappledMacroData(folderId, options = {}) {
  return macroData({
    name: "Переместить схваченного",
    command: "await game.rebreyaMain?.moveGrappled?.();",
    sourceId: MOVE_GRAPPLED_MACRO_SOURCE_ID,
    folderId,
    observerOwnershipLevel: options.observerOwnershipLevel
  });
}

function buildManagedFolderData() {
  return {
    name: GRAPPLE_FOLDER_NAME,
    type: "Macro",
    flags: managedFlags(GRAPPLE_FOLDER_SOURCE_ID)
  };
}

function folderSnapshot(folder) {
  return {
    name: folder?.name,
    type: folder?.type,
    flags: managedFlagsSnapshot(folder)
  };
}

function macroSnapshot(macro) {
  return {
    name: macro?.name,
    type: macro?.type,
    scope: macro?.scope,
    command: macro?.command,
    folder: String(macro?.folder?.id ?? macro?.folder ?? "").trim(),
    ownership: { default: macro?.ownership?.default },
    flags: managedFlagsSnapshot(macro)
  };
}

function reusableFolderSort(left, right) {
  const leftTime = Number(left?._stats?.createdTime);
  const rightTime = Number(right?._stats?.createdTime);
  const normalizedLeft = Number.isFinite(leftTime) ? leftTime : Number.POSITIVE_INFINITY;
  const normalizedRight = Number.isFinite(rightTime) ? rightTime : Number.POSITIVE_INFINITY;
  return normalizedLeft - normalizedRight || documentId(left).localeCompare(documentId(right));
}

export class GrappleMacroService {
  #folderProvider;
  #gameProvider;
  #isActiveGmClient;
  #macroProvider;
  #observerOwnershipLevel;

  constructor({
    gameProvider = () => globalThis.game,
    folderProvider = () => globalThis.Folder,
    macroProvider = () => globalThis.Macro,
    isActiveGmClient = defaultIsActiveGmClient,
    observerOwnershipLevel = observerLevel()
  } = {}) {
    this.#gameProvider = gameProvider;
    this.#folderProvider = folderProvider;
    this.#macroProvider = macroProvider;
    this.#isActiveGmClient = isActiveGmClient;
    this.#observerOwnershipLevel = observerOwnershipLevel;
  }

  async syncManagedDocuments() {
    const game = this.#gameProvider();
    if (!this.#isActiveGmClient(game)) {
      return { skipped: true, folder: null, macros: [] };
    }

    const folder = await this.#syncFolder(game);
    const folderId = documentId(folder);
    if (!folderId) throw new Error("Grapple macro folder has no id");
    const macros = [
      await this.#syncMacro(game, GRAPPLE_MACRO_SOURCE_ID, buildGrappleMacroData(folderId, {
        observerOwnershipLevel: this.#observerOwnershipLevel
      })),
      await this.#syncMacro(game, MOVE_GRAPPLED_MACRO_SOURCE_ID, buildMoveGrappledMacroData(folderId, {
        observerOwnershipLevel: this.#observerOwnershipLevel
      }))
    ];
    return { skipped: false, folder, macros };
  }

  async #syncFolder(game) {
    const update = buildManagedFolderData();
    const managed = findManaged(game?.folders, GRAPPLE_FOLDER_SOURCE_ID);
    if (managed) {
      if (!equalData(folderSnapshot(managed), update)) {
        if (typeof managed.update !== "function") throw new TypeError("Managed grapple macro folder cannot be updated");
        await managed.update(update);
      }
      return managed;
    }

    const reusable = documents(game?.folders)
      .filter((folder) => folder?.type === "Macro" && folder?.name === GRAPPLE_FOLDER_NAME)
      .sort(reusableFolderSort)[0];
    if (reusable) return reusable;

    const Folder = this.#folderProvider();
    if (typeof Folder?.create !== "function") throw new TypeError("Folder.create is required to create grapple macros");
    return Folder.create(update);
  }

  async #syncMacro(game, sourceId, update) {
    const managed = findManaged(game?.macros, sourceId);
    if (!managed) {
      const Macro = this.#macroProvider();
      if (typeof Macro?.create !== "function") throw new TypeError("Macro.create is required to create grapple macros");
      return Macro.create(update);
    }
    if (!equalData(macroSnapshot(managed), update)) {
      if (typeof managed.update !== "function") throw new TypeError("Managed grapple macro cannot be updated");
      await managed.update(update);
    }
    return managed;
  }
}
