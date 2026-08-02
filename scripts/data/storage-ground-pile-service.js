import { MODULE_ID } from "../constants.js";
import { GROUND_PILE_PRESET_ID } from "./builtin-storage-presets.js";
import { buildStorageTokenState, readStorageState } from "./storage-service.js";
import { deriveGroundPilePresentation, isGroundPileToken } from "./storage-pile-presentation.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value ?? "").trim();
}

function collectionValues(collection) {
  if (Array.isArray(collection?.contents)) return collection.contents;
  if (Array.isArray(collection)) return collection;
  if (typeof collection?.values === "function") return Array.from(collection.values());
  return [];
}

function readFlag(document, key) {
  return document?.getFlag?.(MODULE_ID, key) ?? document?.flags?.[MODULE_ID]?.[key];
}

function rowQuantity(row) {
  return Math.max(1, Math.trunc(Number(row?.quantity ?? row?.itemData?.system?.quantity ?? 1)) || 1);
}

function rowIdentity(row) {
  const sourceType = clean(row?.sourceType);
  const sourceId = clean(row?.sourceId);
  const broken = row?.isBroken === true ? "broken" : "intact";
  if (sourceType && sourceId) return `${sourceType}:${sourceId}:${broken}`;
  return [clean(row?.name ?? row?.itemData?.name), clean(row?.typeLabel ?? row?.itemData?.type), broken].join(":");
}

function visibleRows(state) {
  const claimed = new Set(state?.claimedRowIds ?? []);
  return [...(state?.manualRows ?? []), ...(state?.generatedRows ?? [])]
    .filter((row) => !claimed.has(clean(row?.rowId)));
}

function tokenContainsPoint(token, scene, x, y) {
  const gridSize = Math.max(1, Number(scene?.grid?.size ?? scene?.grid?.sizeX ?? 100) || 100);
  const left = Number(token?.x ?? 0);
  const top = Number(token?.y ?? 0);
  const width = Math.max(1, Number(token?.width ?? 1)) * gridSize;
  const height = Math.max(1, Number(token?.height ?? 1)) * gridSize;
  return x >= left && x <= left + width && y >= top && y <= top + height;
}

export function findGroundPileAtPoint(scene, x, y) {
  const tokens = collectionValues(scene?.tokens);
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (isGroundPileToken(token) && tokenContainsPoint(token, scene, x, y)) return token;
  }
  return null;
}

export class StorageGroundPileService {
  constructor({
    gameProvider = () => globalThis.game,
    isActiveGm = () => true,
    idFactory = () => globalThis.foundry?.utils?.randomID?.() ?? Math.random().toString(36).slice(2)
  } = {}) {
    this.gameProvider = gameProvider;
    this.isActiveGm = isActiveGm;
    this.idFactory = idFactory;
  }

  #requireActiveGm() {
    const game = this.gameProvider();
    if (this.isActiveGm(game) !== true) {
      throw new Error("Создавать наземные кучи может только активный мастер.");
    }
    return game;
  }

  #resolvePileActor(game) {
    return collectionValues(game?.actors).find((actor) => (
      clean(readFlag(actor, "builtinStoragePreset")?.id) === GROUND_PILE_PRESET_ID
    )) ?? null;
  }

  #resolveScene(game, sceneId) {
    return game?.scenes?.get?.(sceneId)
      ?? collectionValues(game?.scenes).find((scene) => clean(scene?.id) === clean(sceneId))
      ?? null;
  }

  #prepareRow(row, quantity) {
    const available = rowQuantity(row);
    const amount = Number(quantity);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > available) {
      throw new Error(`Количество должно быть целым числом от 1 до ${available}.`);
    }
    const prepared = clone(row);
    prepared.rowId = clean(this.idFactory()) || `pile-row-${Date.now()}`;
    prepared.quantity = amount;
    prepared.itemData ??= {};
    prepared.itemData.system ??= {};
    prepared.itemData.system.quantity = amount;
    return prepared;
  }

  async #writePile(token, state, presentation, mutationIds) {
    const textures = {
      unopened: presentation.img,
      opened: presentation.img,
      empty: presentation.img
    };
    const normalized = buildStorageTokenState({
      ...state,
      baseName: presentation.name,
      state: "opened",
      textures,
      displayMode: "opened"
    });
    const groundPile = {
      ...(clone(readFlag(token, "groundPile")) ?? {}),
      enabled: true,
      mutationIds: Array.from(new Set(mutationIds.map(clean).filter(Boolean))).slice(-100)
    };
    await token.update({
      [`flags.${MODULE_ID}.storage`]: normalized,
      [`flags.${MODULE_ID}.groundPile`]: groundPile,
      name: presentation.name,
      "texture.src": presentation.img
    });
    return normalized;
  }

  async transferToScene({ row, quantity, sceneId, x, y, mutationId } = {}) {
    const game = this.#requireActiveGm();
    const scene = this.#resolveScene(game, sceneId);
    if (!scene || typeof scene.createEmbeddedDocuments !== "function") {
      throw new Error("Активная сцена для наземной кучи не найдена.");
    }
    const pointX = Number(x);
    const pointY = Number(y);
    if (!Number.isFinite(pointX) || !Number.isFinite(pointY)) {
      throw new Error("Не указана точка для наземной кучи.");
    }
    const stableMutationId = clean(mutationId);
    if (!stableMutationId) throw new Error("Для наземной кучи нужен стабильный mutationId.");

    const existing = findGroundPileAtPoint(scene, pointX, pointY);
    if (existing) {
      const groundFlag = clone(readFlag(existing, "groundPile")) ?? {};
      if ((groundFlag.mutationIds ?? []).includes(stableMutationId)) {
        return { created: false, merged: false, duplicate: true, token: existing, state: readStorageState(existing) };
      }
      const state = readStorageState(existing);
      const incoming = this.#prepareRow(row, quantity);
      const claimed = new Set(state.claimedRowIds);
      const identity = rowIdentity(incoming);
      let stacked = false;
      const manualRows = state.manualRows.map((entry) => {
        if (stacked || claimed.has(clean(entry?.rowId)) || rowIdentity(entry) !== identity) return entry;
        stacked = true;
        const next = clone(entry);
        next.quantity = rowQuantity(entry) + incoming.quantity;
        next.itemData ??= {};
        next.itemData.system ??= {};
        next.itemData.system.quantity = next.quantity;
        return next;
      });
      if (!stacked) manualRows.push(incoming);
      const candidate = { ...state, manualRows };
      const presentation = deriveGroundPilePresentation(visibleRows(candidate));
      const next = await this.#writePile(existing, candidate, presentation, [
        ...(groundFlag.mutationIds ?? []),
        stableMutationId
      ]);
      return { created: false, merged: true, duplicate: false, token: existing, state: next };
    }

    const actor = this.#resolvePileActor(game);
    if (!actor) throw new Error("Служебный актёр наземной кучи не восстановлен.");
    const incoming = this.#prepareRow(row, quantity);
    const presentation = deriveGroundPilePresentation([incoming]);
    const textures = {
      unopened: presentation.img,
      opened: presentation.img,
      empty: presentation.img
    };
    const storage = buildStorageTokenState({
      baseName: presentation.name,
      state: "opened",
      manualRows: [incoming],
      textures,
      displayMode: "opened"
    });
    const prototype = clone(actor?.prototypeToken?.toObject?.() ?? actor?.prototypeToken ?? {});
    const data = {
      ...prototype,
      actorId: actor.id,
      actorLink: false,
      name: presentation.name,
      x: pointX,
      y: pointY,
      width: Math.max(1, Number(prototype.width ?? 1)),
      height: Math.max(1, Number(prototype.height ?? 1)),
      texture: { ...(clone(prototype.texture) ?? {}), src: presentation.img },
      flags: {
        ...(clone(prototype.flags) ?? {}),
        [MODULE_ID]: {
          ...(clone(prototype.flags?.[MODULE_ID]) ?? {}),
          storage,
          groundPile: { enabled: true, mutationIds: [stableMutationId] }
        }
      }
    };
    const [token] = await scene.createEmbeddedDocuments("Token", [data]);
    if (!token) throw new Error("Foundry не создал токен наземной кучи.");
    return { created: true, merged: false, duplicate: false, token, state: storage };
  }

  async refreshAfterStorageMutation(token, state = readStorageState(token)) {
    if (!isGroundPileToken(token)) return { deleted: false, state };
    const rows = visibleRows(state);
    const hasCoins = state.coinsClaimed !== true && ["pp", "gp", "sp", "cp"].some((key) => (
      Number(state.manualCoins?.[key] ?? 0) + Number(state.generatedCoins?.[key] ?? 0) > 0
    ));
    if (!rows.length && !hasCoins) {
      if (typeof token?.delete === "function") await token.delete();
      else await token?.parent?.deleteEmbeddedDocuments?.("Token", [token.id]);
      return { deleted: true, state };
    }
    const presentation = deriveGroundPilePresentation(rows);
    const groundFlag = clone(readFlag(token, "groundPile")) ?? {};
    const next = await this.#writePile(token, state, presentation, groundFlag.mutationIds ?? []);
    return { deleted: false, state: next };
  }
}
