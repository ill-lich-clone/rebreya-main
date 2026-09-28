import { MODULE_ID } from "../constants.js";

const TRAVEL_TOKEN_GRID_UNITS = 0.33;
const DEFAULT_GRID_SIZE = 100;

function cleanText(value) {
  return String(value ?? "").trim();
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((toNumber(value, 0) + Number.EPSILON) * factor) / factor;
}

function asArrayFromCollection(collection) {
  if (!collection) {
    return [];
  }
  if (Array.isArray(collection)) {
    return collection;
  }
  if (Array.isArray(collection.contents)) {
    return collection.contents;
  }
  if (typeof collection.values === "function") {
    return Array.from(collection.values());
  }
  if (typeof collection[Symbol.iterator] === "function") {
    return Array.from(collection);
  }
  return [];
}

function findSceneByName(scenes, sceneName) {
  const safeName = cleanText(sceneName);
  if (!safeName || !scenes) {
    return null;
  }

  return scenes.getName?.(safeName)
    ?? scenes.find?.((scene) => scene?.name === safeName)
    ?? asArrayFromCollection(scenes).find((scene) => scene?.name === safeName)
    ?? null;
}

function getTokenFlag(token, key) {
  return token?.getFlag?.(MODULE_ID, key)
    ?? token?.flags?.[MODULE_ID]?.[key]
    ?? token?._source?.flags?.[MODULE_ID]?.[key]
    ?? "";
}

function findGroupToken(scene, groupActorId) {
  const safeGroupActorId = cleanText(groupActorId);
  if (!safeGroupActorId) {
    return null;
  }

  return asArrayFromCollection(scene?.tokens).find((token) => (
    cleanText(token?.actorId) === safeGroupActorId
    || cleanText(token?.actor?.id) === safeGroupActorId
    || cleanText(getTokenFlag(token, "travelGroupActorId")) === safeGroupActorId
  )) ?? null;
}

function buildTravelTokenFlags(groupActorId, baseFlags = {}) {
  return {
    ...baseFlags,
    [MODULE_ID]: {
      ...(baseFlags?.[MODULE_ID] ?? {}),
      travelGroupActorId: groupActorId
    }
  };
}

function getSceneGridSize(scene) {
  return Math.max(1, toNumber(
    scene?.grid?.size
      ?? scene?.dimensions?.size
      ?? scene?.gridSize,
    DEFAULT_GRID_SIZE
  ));
}

function buildTravelTokenPlacement(scene, position) {
  const width = TRAVEL_TOKEN_GRID_UNITS;
  const height = TRAVEL_TOKEN_GRID_UNITS;
  const gridSize = getSceneGridSize(scene);
  return {
    x: roundNumber(toNumber(position?.sceneX, 0) - ((gridSize * width) / 2), 2),
    y: roundNumber(toNumber(position?.sceneY, 0) - ((gridSize * height) / 2), 2),
    width,
    height
  };
}

function buildCreateTokenData(groupActor, position, scene) {
  const prototype = groupActor?.prototypeToken?.toObject?.() ?? {};
  const texture = prototype.texture ?? (groupActor?.img ? { src: groupActor.img } : undefined);
  const placement = buildTravelTokenPlacement(scene, position);
  const tokenData = {
    ...prototype,
    actorId: groupActor.id,
    name: groupActor.name ?? "Группа",
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    flags: buildTravelTokenFlags(groupActor.id, prototype.flags ?? {})
  };

  if (texture) {
    tokenData.texture = texture;
  }
  if (groupActor?.img && !tokenData.img) {
    tokenData.img = groupActor.img;
  }

  return tokenData;
}

export class TravelMapService {
  constructor({
    gameProvider = () => globalThis.game,
    canvasProvider = () => globalThis.canvas
  } = {}) {
    this.gameProvider = gameProvider;
    this.canvasProvider = canvasProvider;
  }

  async syncGroupToken({ groupActor = null, position = null } = {}) {
    if (!groupActor?.id) {
      return {
        synced: false,
        reason: "Группа для токена путешествия не найдена."
      };
    }

    if (!position?.available) {
      return {
        synced: false,
        reason: position?.reason || "Координаты путешествия для карты недоступны."
      };
    }

    const game = this.gameProvider?.() ?? globalThis.game;
    const scene = findSceneByName(game?.scenes, position.sceneName || "Карта мира");
    if (!scene) {
      throw new Error(`Сцена «${position.sceneName || "Карта мира"}» не найдена.`);
    }

    const canvas = this.canvasProvider?.();
    const activeScene = canvas?.scene ?? null;
    const sceneId = cleanText(scene.id ?? scene._id);
    const activeSceneId = cleanText(activeScene?.id ?? activeScene?._id);
    const isRenderedScene = !canvas || (
      activeScene
      && (
        activeScene === scene
        || (sceneId && activeSceneId && sceneId === activeSceneId)
      )
    );
    if (!isRenderedScene) {
      return {
        synced: false,
        deferred: true,
        sceneName: scene.name
      };
    }

    const placement = buildTravelTokenPlacement(scene, position);
    const existingToken = findGroupToken(scene, groupActor.id);
    if (canvas && existingToken?.object === null) {
      return {
        synced: false,
        deferred: true,
        sceneName: scene.name
      };
    }
    if (existingToken) {
      const tokenId = cleanText(existingToken.id ?? existingToken._id);
      if (!tokenId) {
        throw new Error("Токен группы на карте найден, но у него нет id.");
      }

      await scene.updateEmbeddedDocuments?.("Token", [{
        _id: tokenId,
        x: placement.x,
        y: placement.y,
        width: placement.width,
        height: placement.height,
        flags: buildTravelTokenFlags(groupActor.id, existingToken.flags ?? {})
      }]);
      return {
        synced: true,
        action: "updated",
        sceneName: scene.name,
        tokenId,
        x: placement.x,
        y: placement.y
      };
    }

    const [createdToken] = await scene.createEmbeddedDocuments?.("Token", [buildCreateTokenData(groupActor, position, scene)]) ?? [];
    return {
      synced: true,
      action: "created",
      sceneName: scene.name,
      tokenId: cleanText(createdToken?.id ?? createdToken?._id),
      x: placement.x,
      y: placement.y
    };
  }
}
