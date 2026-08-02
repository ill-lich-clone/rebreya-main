import { MODULE_ID } from "../constants.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import {
  BUILTIN_STORAGE_PRESETS,
  BUILTIN_STORAGE_TOKEN_NAME,
  GROUND_PILE_STORAGE_PRESET
} from "./builtin-storage-presets.js";
import {
  CHEST_OBJECT_DURABILITY,
  normalizeStorageObjectDurability,
  STORAGE_OBJECT_DURABILITY_FLAG
} from "./native-object-durability-service.js";
import { buildStorageTokenState } from "./storage-service.js";

export const BUILTIN_STORAGE_FOLDER_NAME = "Хранилища";
export const BUILTIN_STORAGE_PRESET_FLAG = "builtinStoragePreset";
const ALL_BUILTIN_STORAGE_PRESETS = Object.freeze([
  ...BUILTIN_STORAGE_PRESETS,
  GROUND_PILE_STORAGE_PRESET
]);

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
  return buildStorageTokenState({
    baseName: preset.groundPile === true ? preset.prototypeToken.name : BUILTIN_STORAGE_TOKEN_NAME,
    state: preset.groundPile === true ? "opened" : "unopened",
    textures: clone(preset.textures),
    displayMode: preset.groundPile === true ? "opened" : "unopened"
  });
}

export function buildBuiltinStorageActorData(preset, folderId) {
  if (!preset?.id || !preset?.name || !preset?.textures || !preset?.prototypeToken) {
    throw new TypeError("A complete built-in storage preset is required.");
  }
  return {
    name: preset.name,
    type: "npc",
    img: preset.groundPile === true ? preset.textures.opened : preset.textures.unopened,
    folder: folderId,
    flags: {
      [MODULE_ID]: {
        storage: { enabled: true },
        [BUILTIN_STORAGE_PRESET_FLAG]: { id: preset.id },
        ...(preset.groundPile === true ? { groundPilePrototype: { enabled: true } } : {})
      }
    },
    prototypeToken: {
      ...clone(preset.prototypeToken),
      flags: {
        [MODULE_ID]: {
          storage: initialStorageState(preset),
          ...(preset.groundPile === true ? {} : {
            [STORAGE_OBJECT_DURABILITY_FLAG]: clone(CHEST_OBJECT_DURABILITY)
          }),
          ...(preset.groundPile === true ? { groundPile: { enabled: true } } : {})
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
    for (const preset of ALL_BUILTIN_STORAGE_PRESETS) {
      const existing = collectionValues(game?.actors)
        .find((actor) => readPresetId(actor) === preset.id);
      if (existing) {
        await this.#syncExistingActor(existing, preset);
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
    await this.#migrateSceneTokens(game, actors);
    return { folder, actors };
  }

  async #syncExistingActor(actor, preset) {
    if (typeof actor?.update !== "function") return;
    const current = actor.prototypeToken?.flags?.[MODULE_ID]?.storage ?? {};
    const initial = initialStorageState(preset);
    const currentDurability = actor.prototypeToken?.flags?.[MODULE_ID]?.[STORAGE_OBJECT_DURABILITY_FLAG];
    const durability = preset.groundPile === true
      ? null
      : normalizeStorageObjectDurability(currentDurability ?? CHEST_OBJECT_DURABILITY);
    await actor.update({
      "prototypeToken.name": preset.prototypeToken.name,
      [`prototypeToken.flags.${MODULE_ID}.storage`]: buildStorageTokenState({
        ...initial,
        ...current,
        baseName: preset.prototypeToken.name,
        textures: current.textures ?? preset.textures
      }),
      ...(durability ? {
        [`prototypeToken.flags.${MODULE_ID}.${STORAGE_OBJECT_DURABILITY_FLAG}`]: durability,
        "prototypeToken.delta.system.attributes.hp": {
          value: durability.hp.value,
          max: durability.hp.max,
          dt: durability.damageThreshold
        },
        "prototypeToken.delta.system.attributes.ac": { calc: "flat", flat: durability.ac },
        "prototypeToken.bar1.attribute": "attributes.hp"
      } : {}),
      ...(preset.groundPile === true ? {
        [`flags.${MODULE_ID}.groundPilePrototype`]: { enabled: true },
        [`prototypeToken.flags.${MODULE_ID}.groundPile`]: { enabled: true }
      } : {})
    });
  }

  async #migrateSceneTokens(game, actors) {
    const actorPresets = new Map(actors.map((actor) => [
      actor.id,
      ALL_BUILTIN_STORAGE_PRESETS.find((preset) => preset.id === readPresetId(actor))
    ]));
    for (const scene of collectionValues(game?.scenes)) {
      for (const token of collectionValues(scene?.tokens)) {
        const preset = actorPresets.get(token?.actorId);
        if (!preset || preset.groundPile === true || String(token?.name ?? "").trim() !== preset.name || typeof token?.update !== "function") continue;
        const current = token?.flags?.[MODULE_ID]?.storage ?? {};
        await token.update({
          name: BUILTIN_STORAGE_TOKEN_NAME,
          [`flags.${MODULE_ID}.storage`]: buildStorageTokenState({ ...current, baseName: BUILTIN_STORAGE_TOKEN_NAME })
        });
      }
    }
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
