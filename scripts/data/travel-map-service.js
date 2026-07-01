import { MODULE_ID } from "../constants.js";

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

function buildCreateTokenData(groupActor, position) {
  const prototype = groupActor?.prototypeToken?.toObject?.() ?? {};
  const texture = prototype.texture ?? (groupActor?.img ? { src: groupActor.img } : undefined);
  const tokenData = {
    ...prototype,
    actorId: groupActor.id,
    name: groupActor.name ?? "Группа",
    x: roundNumber(position.sceneX, 2),
    y: roundNumber(position.sceneY, 2),
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
  constructor({ gameProvider = () => globalThis.game } = {}) {
    this.gameProvider = gameProvider;
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

    const x = roundNumber(position.sceneX, 2);
    const y = roundNumber(position.sceneY, 2);
    const existingToken = findGroupToken(scene, groupActor.id);
    if (existingToken) {
      const tokenId = cleanText(existingToken.id ?? existingToken._id);
      if (!tokenId) {
        throw new Error("Токен группы на карте найден, но у него нет id.");
      }

      await scene.updateEmbeddedDocuments?.("Token", [{
        _id: tokenId,
        x,
        y,
        flags: buildTravelTokenFlags(groupActor.id, existingToken.flags ?? {})
      }]);
      return {
        synced: true,
        action: "updated",
        sceneName: scene.name,
        tokenId,
        x,
        y
      };
    }

    const [createdToken] = await scene.createEmbeddedDocuments?.("Token", [buildCreateTokenData(groupActor, { ...position, sceneX: x, sceneY: y })]) ?? [];
    return {
      synced: true,
      action: "created",
      sceneName: scene.name,
      tokenId: cleanText(createdToken?.id ?? createdToken?._id),
      x,
      y
    };
  }
}
