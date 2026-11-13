import { MODULE_ID } from "../constants.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";
import {
  BUILTIN_STORAGE_PRESETS,
  GROUND_PILE_STORAGE_PRESET
} from "./builtin-storage-presets.js?v=1.5.48";
import {
  CHEST_OBJECT_DURABILITY,
  normalizeStorageObjectDurability,
  STORAGE_OBJECT_DURABILITY_FLAG
} from "./native-object-durability-service.js?v=1.5.48";
import { storageObjectKind } from "./storage-object-kind.js?v=1.5.19";
import { buildStorageTokenState } from "./storage-service.js?v=1.5.74";
import { DND5E_STORAGE_SIZE_LOCKS, supportsDnd5eStorageSizeLocks } from "./storage-token-dimensions.js?v=1.5.68";

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

function neutralTokenDisposition() {
  const disposition = Number(globalThis.CONST?.TOKEN_DISPOSITIONS?.NEUTRAL ?? 0);
  return Number.isFinite(disposition) ? disposition : 0;
}

function readProperty(target, path) {
  return String(path ?? "").split(".").reduce((value, key) => value?.[key], target);
}

function equalValue(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => equalValue(value, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index]
      && equalValue(left[key], right[key])
    ));
}

function setChangedProperty(patch, target, path, value) {
  if (!equalValue(readProperty(target, path), value)) patch[path] = value;
}

function setDnd5eStorageSizeLocks(patch, token, prefix = "") {
  for (const [key, value] of Object.entries(DND5E_STORAGE_SIZE_LOCKS)) {
    const path = `flags.dnd5e.${key}`;
    if (readProperty(token, path) !== value) patch[prefix + path] = value;
  }
}

function overwrittenGroundPileFootprint(token, actorSizes) {
  const pile = token.flags?.[MODULE_ID]?.groundPile;
  const actorSystem = token.actor?.system;
  const size = actorSizes?.[actorSystem?.traits?.size];
  if (pile?.enabled !== true || pile.customFootprint !== false || token.flags?.dnd5e?.lockSize === true
    || !actorSystem?.isCreature || !size) return {};

  const { width, height } = pile.autoLayout ?? {};
  const source = token.toObject?.() ?? token;
  const nativeSize = size.token ?? 1;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0
    || source.width !== nativeSize || source.height !== nativeSize
    || (source.width === width && source.height === height)) return {};
  return { width, height };
}

function readPresetId(actor) {
  const flag = typeof actor?.getFlag === "function"
    ? actor.getFlag(MODULE_ID, BUILTIN_STORAGE_PRESET_FLAG)
    : actor?.flags?.[MODULE_ID]?.[BUILTIN_STORAGE_PRESET_FLAG];
  return String(flag?.id ?? "").trim();
}

function compareBuiltinStorageFolders(left, right) {
  const leftCreated = left?._stats?.createdTime;
  const rightCreated = right?._stats?.createdTime;
  const leftHasCreated = Number.isFinite(leftCreated);
  const rightHasCreated = Number.isFinite(rightCreated);
  if (leftHasCreated && rightHasCreated && leftCreated !== rightCreated) {
    return leftCreated - rightCreated;
  }
  if (leftHasCreated !== rightHasCreated) return leftHasCreated ? -1 : 1;
  const leftId = String(left?.id ?? "");
  const rightId = String(right?.id ?? "");
  if (leftId < rightId) return -1;
  if (leftId > rightId) return 1;
  return 0;
}

function initialStorageState(preset) {
  return buildStorageTokenState({
    baseName: preset.prototypeToken.name,
    storageKind: preset.groundPile === true ? "pile" : "chest",
    state: preset.groundPile === true ? "opened" : "unopened",
    textures: clone(preset.textures),
    displayMode: preset.groundPile === true ? "opened" : "unopened"
  });
}

export function buildBuiltinStorageActorData(preset, folderId, { lockDnd5eSize = false } = {}) {
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
      disposition: neutralTokenDisposition(),
      sight: {
        ...(clone(preset.prototypeToken.sight) ?? {}),
        enabled: false
      },
      flags: {
        ...(lockDnd5eSize ? { dnd5e: { ...preset.prototypeToken.flags?.dnd5e, ...DND5E_STORAGE_SIZE_LOCKS } } : {}),
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

    const lockDnd5eSize = supportsDnd5eStorageSizeLocks(game);
    const folder = await this.#ensureFolder(game);
    const actors = [];
    const existingPresets = [];
    for (const preset of ALL_BUILTIN_STORAGE_PRESETS) {
      const existing = collectionValues(game?.actors)
        .find((actor) => readPresetId(actor) === preset.id);
      if (existing) {
        existingPresets.push([existing, preset]);
        actors.push(existing);
        continue;
      }

      try {
        const Actor = this.actorProvider();
        if (typeof Actor?.create !== "function") {
          throw new TypeError("Actor.create is required to restore built-in storage Actors.");
        }
        const actor = await Actor.create(
          buildBuiltinStorageActorData(preset, folder.id, { lockDnd5eSize }),
          { renderSheet: false }
        );
        if (actor) actors.push(actor);
      }
      catch (error) {
        this.logger?.error?.(`${MODULE_ID} | Failed to restore storage preset ${preset.id}.`, error);
      }
    }
    const storageActors = collectionValues(game?.actors)
      .filter((actor) => storageObjectKind(actor) !== null);
    await this.#migrateSceneTokens(game, actors, storageActors, lockDnd5eSize);
    for (const [actor, preset] of existingPresets) {
      await this.#syncExistingActor(actor, preset, folder.id, lockDnd5eSize);
    }
    const builtInActorIds = new Set(actors.map((actor) => actor?.id).filter(Boolean));
    for (const actor of storageActors) {
      if (builtInActorIds.has(actor?.id)) continue;
      await this.#syncStorageActorPrototype(actor, lockDnd5eSize);
    }
    return { folder, actors };
  }

  async #syncExistingActor(actor, preset, folderId, lockDnd5eSize) {
    if (typeof actor?.update !== "function") return;
    const currentFolderId = typeof actor?.folder === "string"
      ? actor.folder
      : actor?.folder?.id ?? null;
    const current = actor.prototypeToken?.flags?.[MODULE_ID]?.storage ?? {};
    const initial = initialStorageState(preset);
    const currentDurability = actor.prototypeToken?.flags?.[MODULE_ID]?.[STORAGE_OBJECT_DURABILITY_FLAG];
    const durability = preset.groundPile === true
      ? null
      : normalizeStorageObjectDurability(currentDurability ?? CHEST_OBJECT_DURABILITY);
    const patch = {};
    if (String(currentFolderId ?? "") !== String(folderId ?? "")) patch.folder = folderId;
    setChangedProperty(patch, actor, "prototypeToken.name", preset.prototypeToken.name);
    setChangedProperty(patch, actor, "prototypeToken.disposition", neutralTokenDisposition());
    setChangedProperty(patch, actor, "prototypeToken.sight.enabled", false);
    if (lockDnd5eSize) setDnd5eStorageSizeLocks(patch, actor.prototypeToken, "prototypeToken.");
    setChangedProperty(
      patch,
      actor,
      `prototypeToken.flags.${MODULE_ID}.storage`,
      buildStorageTokenState({
        ...initial,
        ...current,
        baseName: preset.prototypeToken.name,
        textures: current.textures ?? preset.textures
      })
    );
    if (durability) {
      setChangedProperty(
        patch,
        actor,
        `prototypeToken.flags.${MODULE_ID}.${STORAGE_OBJECT_DURABILITY_FLAG}`,
        durability
      );
      setChangedProperty(patch, actor, "prototypeToken.delta.system.attributes.hp", {
        value: durability.hp.value,
        max: durability.hp.max,
        dt: durability.damageThreshold
      });
      setChangedProperty(
        patch,
        actor,
        "prototypeToken.delta.system.attributes.ac",
        { calc: "flat", flat: durability.ac }
      );
      setChangedProperty(patch, actor, "prototypeToken.bar1.attribute", "attributes.hp");
    }
    if (preset.groundPile === true) {
      setChangedProperty(patch, actor, `flags.${MODULE_ID}.groundPilePrototype`, { enabled: true });
      setChangedProperty(patch, actor, `prototypeToken.flags.${MODULE_ID}.groundPile`, { enabled: true });
    }
    if (Object.keys(patch).length > 0) await actor.update(patch);
  }

  async #syncStorageActorPrototype(actor, lockDnd5eSize) {
    if (typeof actor?.update !== "function") return;
    const patch = {};
    setChangedProperty(patch, actor, "prototypeToken.sight.enabled", false);
    if (lockDnd5eSize) setDnd5eStorageSizeLocks(patch, actor.prototypeToken, "prototypeToken.");
    if (Object.keys(patch).length > 0) await actor.update(patch);
  }

  async #migrateSceneTokens(game, actors, storageActors, lockDnd5eSize) {
    const actorPresets = new Map(actors.map((actor) => [
      actor.id,
      ALL_BUILTIN_STORAGE_PRESETS.find((preset) => preset.id === readPresetId(actor))
    ]));
    const storageActorIds = new Set(storageActors.map((actor) => actor?.id).filter(Boolean));
    const actorSizes = lockDnd5eSize && game.settings?.get?.("dnd5e", "tokenSizeSync") === true
      ? game.dnd5e?.config?.actorSizes
      : null;
    for (const scene of collectionValues(game?.scenes)) {
      for (const token of collectionValues(scene?.tokens)) {
        const preset = actorPresets.get(token?.actorId);
        const isStorageToken = storageActorIds.has(token?.actorId)
          || storageObjectKind(token) !== null;
        if (!isStorageToken || typeof token?.update !== "function") continue;
        const inheritedName = preset?.groundPile !== true
          && Boolean(preset)
          && String(token?.name ?? "").trim() === preset.name;
        const patch = {};
        if (lockDnd5eSize) {
          setDnd5eStorageSizeLocks(patch, token);
          Object.assign(patch, overwrittenGroundPileFootprint(token, actorSizes));
        }
        if (preset && Number(token?.disposition) !== neutralTokenDisposition()) {
          patch.disposition = neutralTokenDisposition();
        }
        if (token?.sight?.enabled !== false) patch["sight.enabled"] = false;
        const current = token?.flags?.[MODULE_ID]?.storage ?? {};
        if (inheritedName) {
          patch.name = preset.prototypeToken.name;
          patch[`flags.${MODULE_ID}.storage`] = buildStorageTokenState({
            ...current,
            baseName: preset.prototypeToken.name
          });
        }
        if (Object.keys(patch).length > 0) await token.update(patch);
      }
    }
  }

  async #ensureFolder(game) {
    const existing = collectionValues(game?.folders)
      .filter((folder) => (
        folder?.type === "Actor"
        && String(folder?.name ?? "").trim() === BUILTIN_STORAGE_FOLDER_NAME
      ))
      .sort(compareBuiltinStorageFolders)[0];
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
