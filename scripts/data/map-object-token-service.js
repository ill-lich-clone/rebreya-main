import { MODULE_ID } from "../constants.js";
import { isActiveGmClient as defaultIsActiveGmClient } from "../infrastructure/foundry/active-gm.js";

const DEFAULT_INPUT = Object.freeze({
  name: "Объект",
  hp: 10,
  ac: 10,
  damageThreshold: 0,
  size: 1
});

const FALLBACK_TOKEN_DISPLAY_ALWAYS = 50;
const FALLBACK_OWNERSHIP_NONE = 0;
const MODULE_FLAGS = Object.freeze({
  MANAGED: "managed",
  SOURCE_ID: "sourceId",
  MAP_OBJECT_TOKEN: "mapObjectToken"
});

export const MAP_OBJECT_ACTOR_SOURCE_ID = "map-object-token-template-actor";
export const MAP_OBJECT_MACRO_SOURCE_ID = "map-object-token-macro";
export const MAP_OBJECT_MACRO_NAME = "Создать объект на карте";
export const MAP_OBJECT_TEMPLATE_ACTOR_NAME = "Rebreya: Объект карты";
export const TRANSPARENT_OBJECT_TOKEN_PATH = `modules/${MODULE_ID}/assets/transparent-object-token.svg`;

function requireInteger(value, { name, minimum, maximum }) {
  const parsed = typeof value === "string" && value.trim() ? Number(value.trim()) : value;
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function requireQuarterCellSize(value) {
  const parsed = typeof value === "string" && value.trim() ? Number(value.trim()) : value;
  const scaled = parsed * 4;
  if (
    !Number.isFinite(parsed)
    || parsed < 0.25
    || parsed > 20
    || Math.abs(scaled - Math.round(scaled)) > 1e-9
  ) {
    throw new RangeError("size must be from 0.25 to 20 in 0.25 increments");
  }
  return parsed;
}

function managedFlags(sourceId, extra = {}) {
  return {
    [MODULE_ID]: {
      [MODULE_FLAGS.MANAGED]: true,
      [MODULE_FLAGS.SOURCE_ID]: sourceId,
      ...extra
    }
  };
}

function foundryConstant(group, key, fallback) {
  const value = globalThis.CONST?.[group]?.[key];
  return Number.isFinite(value) ? value : fallback;
}

function defaultOwnership() {
  return { default: foundryConstant("DOCUMENT_OWNERSHIP_LEVELS", "NONE", FALLBACK_OWNERSHIP_NONE) };
}

function transparentTokenDefaults() {
  const displayAlways = foundryConstant("TOKEN_DISPLAY_MODES", "ALWAYS", FALLBACK_TOKEN_DISPLAY_ALWAYS);
  return {
    actorLink: false,
    disposition: 0,
    texture: { src: TRANSPARENT_OBJECT_TOKEN_PATH },
    displayName: displayAlways,
    displayBars: displayAlways,
    bar1: { attribute: "attributes.hp" },
    sight: { enabled: false },
    width: 1,
    height: 1
  };
}

function requireActorId(actor) {
  const actorId = String(actor?.id ?? actor?._id ?? "").trim();
  if (!actorId) {
    throw new TypeError("actor with an id is required");
  }
  return actorId;
}

function requirePoint(point) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError("point with finite x and y coordinates is required");
  }
  return { x, y };
}

function requireGridSize(gridSize) {
  const parsed = Number(gridSize);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RangeError("gridSize must be a positive number");
  }
  return parsed;
}

function documentFlag(document, key) {
  if (typeof document?.getFlag === "function") {
    return document.getFlag(MODULE_ID, key);
  }
  return document?.flags?.[MODULE_ID]?.[key];
}

function collectionDocuments(collection) {
  if (Array.isArray(collection?.contents)) {
    return collection.contents;
  }
  if (Array.isArray(collection)) {
    return collection;
  }
  if (typeof collection?.values === "function") {
    return Array.from(collection.values());
  }
  if (collection && typeof collection[Symbol.iterator] === "function") {
    return Array.from(collection);
  }
  return [];
}

function findManagedDocument(collection, sourceId) {
  return collectionDocuments(collection).find((document) => (
    String(documentFlag(document, MODULE_FLAGS.SOURCE_ID) ?? "").trim() === sourceId
  )) ?? null;
}

function equalData(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function managedFlagsSnapshot(document) {
  return {
    [MODULE_ID]: {
      [MODULE_FLAGS.MANAGED]: documentFlag(document, MODULE_FLAGS.MANAGED),
      [MODULE_FLAGS.SOURCE_ID]: documentFlag(document, MODULE_FLAGS.SOURCE_ID)
    }
  };
}

function ownershipSnapshot(document) {
  return { default: document?.ownership?.default };
}

function prototypeTokenSnapshot(prototypeToken) {
  return {
    actorLink: prototypeToken?.actorLink,
    disposition: prototypeToken?.disposition,
    texture: { src: prototypeToken?.texture?.src },
    displayName: prototypeToken?.displayName,
    displayBars: prototypeToken?.displayBars,
    bar1: { attribute: prototypeToken?.bar1?.attribute },
    sight: { enabled: prototypeToken?.sight?.enabled },
    width: prototypeToken?.width,
    height: prototypeToken?.height
  };
}

function actorUpdateData() {
  const data = buildMapObjectTemplateActorData();
  return {
    name: data.name,
    ownership: data.ownership,
    flags: data.flags,
    prototypeToken: data.prototypeToken
  };
}

function macroUpdateData() {
  const data = buildMapObjectMacroData();
  return {
    name: data.name,
    type: data.type,
    scope: data.scope,
    command: data.command,
    ownership: data.ownership,
    flags: data.flags
  };
}

function actorMatchesManagedData(actor, data) {
  return equalData({
    name: actor?.name,
    ownership: ownershipSnapshot(actor),
    flags: managedFlagsSnapshot(actor),
    prototypeToken: prototypeTokenSnapshot(actor?.prototypeToken)
  }, data);
}

function macroMatchesManagedData(macro, data) {
  return equalData({
    name: macro?.name,
    type: macro?.type,
    scope: macro?.scope,
    command: macro?.command,
    ownership: ownershipSnapshot(macro),
    flags: managedFlagsSnapshot(macro)
  }, data);
}

export function normalizeMapObjectInput(raw = {}) {
  const input = raw && typeof raw === "object" ? raw : {};
  const rawName = input.name ?? DEFAULT_INPUT.name;
  const name = String(rawName).trim();
  if (!name) {
    throw new TypeError("name is required");
  }

  return {
    name,
    hp: requireInteger(input.hp ?? DEFAULT_INPUT.hp, { name: "hp", minimum: 1, maximum: 1000000 }),
    ac: requireInteger(input.ac ?? DEFAULT_INPUT.ac, { name: "ac", minimum: 0, maximum: 100 }),
    damageThreshold: requireInteger(input.damageThreshold ?? DEFAULT_INPUT.damageThreshold, {
      name: "damageThreshold",
      minimum: 0,
      maximum: 1000000
    }),
    size: requireQuarterCellSize(input.size ?? DEFAULT_INPUT.size)
  };
}

export function buildMapObjectTemplateActorData() {
  return {
    name: MAP_OBJECT_TEMPLATE_ACTOR_NAME,
    type: "npc",
    ownership: defaultOwnership(),
    flags: managedFlags(MAP_OBJECT_ACTOR_SOURCE_ID),
    prototypeToken: transparentTokenDefaults()
  };
}

export function buildMapObjectMacroData() {
  return {
    name: MAP_OBJECT_MACRO_NAME,
    type: "script",
    scope: "global",
    command: "await game.rebreyaMain?.createMapObjectToken?.();",
    ownership: defaultOwnership(),
    flags: managedFlags(MAP_OBJECT_MACRO_SOURCE_ID)
  };
}

export function buildMapObjectTokenData({ actor, input, point, gridSize } = {}) {
  const normalized = normalizeMapObjectInput(input);
  const actorId = requireActorId(actor);
  const snappedPoint = requirePoint(point);
  const cellSize = requireGridSize(gridSize);
  const dimensions = normalized.size * cellSize;

  return {
    ...transparentTokenDefaults(),
    actorId,
    actorLink: false,
    name: normalized.name,
    width: normalized.size,
    height: normalized.size,
    x: snappedPoint.x - (dimensions / 2),
    y: snappedPoint.y - (dimensions / 2),
    delta: {
      name: normalized.name,
      system: {
        attributes: {
          hp: {
            value: normalized.hp,
            max: normalized.hp,
            temp: 0,
            tempmax: 0,
            dt: normalized.damageThreshold
          },
          ac: {
            calc: "flat",
            flat: normalized.ac
          }
        }
      }
    },
    flags: managedFlags(MAP_OBJECT_ACTOR_SOURCE_ID, { [MODULE_FLAGS.MAP_OBJECT_TOKEN]: true })
  };
}

export class MapObjectTokenService {
  #actorProvider;
  #gameProvider;
  #isActiveGmClient;
  #macroProvider;

  constructor({
    gameProvider = () => globalThis.game,
    actorProvider = () => globalThis.Actor,
    macroProvider = () => globalThis.Macro,
    isActiveGmClient = defaultIsActiveGmClient
  } = {}) {
    this.#gameProvider = gameProvider;
    this.#actorProvider = actorProvider;
    this.#macroProvider = macroProvider;
    this.#isActiveGmClient = isActiveGmClient;
  }

  getManagedTemplateActor() {
    return findManagedDocument(this.#gameProvider()?.actors, MAP_OBJECT_ACTOR_SOURCE_ID);
  }

  async syncManagedDocuments() {
    const game = this.#gameProvider();
    if (!this.#isActiveGmClient(game)) {
      return { skipped: true, actor: null, macro: null };
    }

    const actor = await this.#syncActor(game);
    const macro = await this.#syncMacro(game);
    return { skipped: false, actor, macro };
  }

  async createToken(rawInput, { scene, point, gridSize } = {}) {
    if (typeof scene?.createEmbeddedDocuments !== "function") {
      throw new TypeError("scene.createEmbeddedDocuments is required");
    }

    const actor = this.getManagedTemplateActor();
    if (!actor) {
      throw new Error("Managed map object template actor was not found");
    }

    const data = buildMapObjectTokenData({
      actor,
      input: rawInput,
      point,
      gridSize
    });
    const created = await scene.createEmbeddedDocuments("Token", [data]);
    return Array.isArray(created) ? created[0] ?? null : created;
  }

  async #syncActor(game) {
    const existing = findManagedDocument(game?.actors, MAP_OBJECT_ACTOR_SOURCE_ID);
    if (!existing) {
      const Actor = this.#actorProvider();
      if (typeof Actor?.create !== "function") {
        throw new TypeError("Actor.create is required to create the managed map object template");
      }
      return Actor.create(buildMapObjectTemplateActorData());
    }

    const update = actorUpdateData();
    if (!actorMatchesManagedData(existing, update)) {
      if (typeof existing.update !== "function") {
        throw new TypeError("Managed map object template actor cannot be updated");
      }
      await existing.update(update);
    }
    return existing;
  }

  async #syncMacro(game) {
    const existing = findManagedDocument(game?.macros, MAP_OBJECT_MACRO_SOURCE_ID);
    if (!existing) {
      const Macro = this.#macroProvider();
      if (typeof Macro?.create !== "function") {
        throw new TypeError("Macro.create is required to create the managed map object macro");
      }
      return Macro.create(buildMapObjectMacroData());
    }

    const update = macroUpdateData();
    if (!macroMatchesManagedData(existing, update)) {
      if (typeof existing.update !== "function") {
        throw new TypeError("Managed map object macro cannot be updated");
      }
      await existing.update(update);
    }
    return existing;
  }
}
