import { MODULE_ID } from "../constants.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import { BUILTIN_STORAGE_PRESETS } from "./builtin-storage-presets.js";

export const BUILTIN_STORAGE_FOLDER_NAME = "Хранилища";
export const BUILTIN_STORAGE_PRESET_FLAG = "builtinStoragePreset";

const EMPTY_COINS = Object.freeze({ pp: 0, gp: 0, sp: 0, cp: 0 });

function clone(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function collectionValues(collection) {
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (Array.isArray(collection)) return collection;
  if (typeof collection?.values === "function") return Array.from(collection.values());
  return [];
}

function readPresetId(actor) {
  const flag = typeof actor?.getFlag === "function"
    ? actor.getFlag(MODULE_ID, BUILTIN_STORAGE_PRESET_FLAG)
    : actor?.flags?.[MODULE_ID]?.[BUILTIN_STORAGE_PRESET_FLAG];
  return String(flag?.id ?? "").trim();
}

function initialStorageState(preset) {
  return {
    version: 1,
    baseName: preset.name,
    template: null,
    manualRows: [],
    manualCoins: clone(EMPTY_COINS),
    generatedRows: [],
    generatedCoins: clone(EMPTY_COINS),
    claimedRowIds: [],
    coinsClaimed: false,
    state: "unopened",
    textures: clone(preset.textures),
    displayMode: "unopened"
  };
}

export function buildBuiltinStorageActorData(preset, folderId) {
  if (!preset?.id || !preset?.name || !preset?.textures || !preset?.prototypeToken) {
    throw new TypeError("A complete built-in storage preset is required.");
  }
  return {
    name: preset.name,
    type: "npc",
    img: preset.textures.unopened,
    folder: folderId,
    flags: {
      [MODULE_ID]: {
        storage: { enabled: true },
        [BUILTIN_STORAGE_PRESET_FLAG]: { id: preset.id }
      }
    },
    prototypeToken: {
      ...clone(preset.prototypeToken),
      flags: {
        [MODULE_ID]: {
          storage: initialStorageState(preset)
        }
      }
    }
  };
}

export class BuiltinStorageActorService {
  constructor({
    gameProvider = () => globalThis.game,
    folderProvider = () => globalThis.Folder,
    actorProvider = () => globalThis.Actor,
    isActiveGm = isActiveGmClient,
    logger = console
  } = {}) {
    this.gameProvider = gameProvider;
    this.folderProvider = folderProvider;
    this.actorProvider = actorProvider;
    this.isActiveGm = isActiveGm;
    this.logger = logger;
  }

  async sync() {
    const game = this.gameProvider();
    if (this.isActiveGm(game) !== true) return null;

    const folder = await this.#ensureFolder(game);
    const actors = [];
    for (const preset of BUILTIN_STORAGE_PRESETS) {
      const existing = collectionValues(game?.actors)
        .find((actor) => readPresetId(actor) === preset.id);
      if (existing) {
        actors.push(existing);
        continue;
      }

      try {
        const Actor = this.actorProvider();
        if (typeof Actor?.create !== "function") {
          throw new TypeError("Actor.create is required to restore built-in storage Actors.");
        }
        const actor = await Actor.create(
          buildBuiltinStorageActorData(preset, folder.id),
          { renderSheet: false }
        );
        if (actor) actors.push(actor);
      }
      catch (error) {
        this.logger?.error?.(`${MODULE_ID} | Failed to restore storage preset ${preset.id}.`, error);
      }
    }
    return { folder, actors };
  }

  async #ensureFolder(game) {
    const existing = collectionValues(game?.folders).find((folder) => (
      folder?.type === "Actor"
      && folder?.folder == null
      && String(folder?.name ?? "").trim() === BUILTIN_STORAGE_FOLDER_NAME
    ));
    if (existing) return existing;

    const Folder = this.folderProvider();
    if (typeof Folder?.create !== "function") {
      throw new TypeError("Folder.create is required to restore built-in storage Actors.");
    }
    return Folder.create({
      name: BUILTIN_STORAGE_FOLDER_NAME,
      type: "Actor",
      folder: null
    });
  }
}
