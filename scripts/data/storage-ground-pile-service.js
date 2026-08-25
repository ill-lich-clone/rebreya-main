import { MODULE_ID } from "../constants.js";
import { GROUND_PILE_PRESET_ID } from "./builtin-storage-presets.js";
import {
  buildStorageTokenState,
  readStorageCoinDenomination,
  readStorageState
} from "./storage-service.js?v=1.4.152-dead-npc-looting";
import { isStorageJournalRow } from "./storage-container-snapshot.js";
import {
  deriveGroundPilePresentation,
  isGroundPileToken
} from "./storage-pile-presentation.js?v=1.4.161-journal-scene-items";

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

function collectionContains(collection, document) {
  const id = clean(document?.id);
  if (!id) return null;
  if (typeof collection?.get === "function") return collection.get(id) != null;
  const inspectable = Array.isArray(collection?.contents)
    || Array.isArray(collection)
    || typeof collection?.values === "function";
  if (!inspectable) return null;
  return collectionValues(collection).some((entry) => (
    entry === document || clean(entry?.id) === id
  ));
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

function normalizedCoins(coins) {
  return buildStorageTokenState({ manualCoins: coins }).manualCoins;
}

function ownedSyntheticActorDelta(delta, ownerUserId) {
  const userId = clean(ownerUserId);
  const next = clone(delta) ?? {};
  if (!userId) return next;
  next.ownership = { ...(next.ownership ?? {}), [userId]: 3 };
  return next;
}

function addCoins(left, right) {
  const first = normalizedCoins(left);
  const second = normalizedCoins(right);
  return Object.fromEntries(Object.keys(first).map((key) => [key, first[key] + second[key]]));
}

function addManualCoinsChecked(left, right) {
  const first = normalizedCoins(left);
  const second = normalizedCoins(right);
  return Object.fromEntries(Object.keys(first).map((key) => {
    const amount = first[key] + second[key];
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error(`Сумма монет ${key} должна оставаться неотрицательным безопасным целым числом.`);
    }
    return [key, amount];
  }));
}

function hasPositiveCoins(coins) {
  return Object.values(normalizedCoins(coins)).some((amount) => amount > 0);
}

function unclaimedCoins(state) {
  if (state?.coinsClaimed === true) return normalizedCoins({});
  return addCoins(state?.manualCoins, state?.generatedCoins);
}

function visibleRows(state) {
  const claimed = new Set(state?.claimedRowIds ?? []);
  return [...(state?.manualRows ?? []), ...(state?.generatedRows ?? [])]
    .filter((row) => !claimed.has(clean(row?.rowId)));
}

function coinRowDenomination(row) {
  return readStorageCoinDenomination(row?.itemData ?? row);
}

function splitLegacyCoinRows(rows, claimedRowIds) {
  const claimed = new Set(claimedRowIds ?? []);
  const keptRows = [];
  let convertedCoins = normalizedCoins({});
  let convertedRows = 0;
  const removedRowIds = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const denomination = coinRowDenomination(row);
    if (!denomination) {
      keptRows.push(clone(row));
      continue;
    }
    const rowId = clean(row?.rowId);
    removedRowIds.push(rowId);
    convertedRows += 1;
    if (claimed.has(rowId)) continue;
    const quantity = Number(row?.quantity ?? row?.itemData?.system?.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      throw new Error("Количество managed Coin Item в наземной куче должно быть положительным безопасным целым числом.");
    }
    convertedCoins = addManualCoinsChecked(convertedCoins, { [denomination]: quantity });
  }
  return { rows: keptRows, convertedCoins, convertedRows, removedRowIds };
}

function migrateLegacyCoinRowsInState(state) {
  const claimedRowIds = state?.claimedRowIds ?? [];
  const manual = splitLegacyCoinRows(state?.manualRows, claimedRowIds);
  const generated = splitLegacyCoinRows(state?.generatedRows, claimedRowIds);
  const convertedRows = manual.convertedRows + generated.convertedRows;
  if (convertedRows === 0) return null;
  const convertedCoins = addManualCoinsChecked(manual.convertedCoins, generated.convertedCoins);
  const hasConvertedCoins = hasPositiveCoins(convertedCoins);
  const discardClaimedBalances = hasConvertedCoins && state?.coinsClaimed === true;
  const removed = new Set([...manual.removedRowIds, ...generated.removedRowIds].filter(Boolean));
  return {
    state: {
      ...state,
      manualRows: manual.rows,
      generatedRows: generated.rows,
      claimedRowIds: claimedRowIds.filter((rowId) => !removed.has(clean(rowId))),
      manualCoins: addManualCoinsChecked(discardClaimedBalances ? {} : state?.manualCoins, convertedCoins),
      generatedCoins: discardClaimedBalances ? normalizedCoins({}) : state?.generatedCoins,
      coinsClaimed: hasConvertedCoins ? false : state?.coinsClaimed
    },
    convertedRows
  };
}

function tokenContainsPoint(token, scene, x, y) {
  const gridSize = Math.max(1, Number(scene?.grid?.size ?? scene?.grid?.sizeX ?? 100) || 100);
  const left = Number(token?.x ?? 0);
  const top = Number(token?.y ?? 0);
  const width = Math.max(0.5, Number(token?.width ?? 1)) * gridSize;
  const height = Math.max(0.5, Number(token?.height ?? 1)) * gridSize;
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
    this.sceneMutationTasks = new Map();
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
    if (isStorageJournalRow(prepared)) {
      if (amount !== 1) throw new Error("Ссылку на журнал можно положить только в количестве 1.");
      prepared.quantity = 1;
      prepared.stackKey = "";
      delete prepared.itemData;
      return prepared;
    }
    prepared.quantity = amount;
    prepared.itemData ??= {};
    prepared.itemData.system ??= {};
    prepared.itemData.system.quantity = amount;
    return prepared;
  }

  async #writePile(token, state, presentation, mutationIds, ownerUserId = "") {
    const textures = {
      unopened: presentation.img,
      opened: presentation.img,
      empty: presentation.img
    };
    const emptyCoinPile = presentation.categoryKey === "coins"
      && visibleRows(state).length === 0
      && !hasPositiveCoins(unclaimedCoins(state));
    const normalized = buildStorageTokenState({
      ...state,
      baseName: presentation.name,
      state: emptyCoinPile ? "empty" : "opened",
      textures,
      displayMode: emptyCoinPile ? "empty" : "opened"
    });
    const groundPile = {
      ...(clone(readFlag(token, "groundPile")) ?? {}),
      enabled: true,
      coinPile: presentation.categoryKey === "coins",
      mutationIds: Array.from(new Set(mutationIds.map(clean).filter(Boolean))).slice(-100)
    };
    const resize = {};
    if (presentation.categoryKey === "coins") {
      const gridSize = Math.max(1, Number(token?.parent?.grid?.size ?? token?.parent?.grid?.sizeX ?? 100) || 100);
      const currentWidth = Math.max(0.5, Number(token?.width ?? 1));
      const currentHeight = Math.max(0.5, Number(token?.height ?? 1));
      const centerX = Number(token?.x ?? 0) + currentWidth * gridSize / 2;
      const centerY = Number(token?.y ?? 0) + currentHeight * gridSize / 2;
      resize.width = 0.5;
      resize.height = 0.5;
      resize.x = centerX - gridSize / 4;
      resize.y = centerY - gridSize / 4;
    }
    await token.update({
      [`flags.${MODULE_ID}.storage`]: normalized,
      [`flags.${MODULE_ID}.groundPile`]: groundPile,
      name: presentation.name,
      "texture.src": presentation.img,
      ...resize,
      ...(clean(ownerUserId) ? { delta: ownedSyntheticActorDelta(token?.delta, ownerUserId) } : {})
    });
    return normalized;
  }

  async transferToScene({ row, quantity, sceneId, x, y, mutationId, ownerUserId = "" } = {}) {
    const incoming = this.#prepareRow(row, quantity);
    const denomination = coinRowDenomination(incoming);
    return this.#transferPreparedSnapshot({
      rows: denomination ? [] : [incoming],
      coins: denomination ? { [denomination]: incoming.quantity } : {},
      sceneId,
      x,
      y,
      mutationId,
      ownerUserId
    });
  }

  async transferSnapshotToScene({ rows = [], coins = {}, sceneId, x, y, mutationId, ownerUserId = "" } = {}) {
    const incomingRows = (Array.isArray(rows) ? rows : [])
      .filter((row) => row && typeof row === "object")
      .map((row) => this.#prepareRow(row, rowQuantity(row)));
    const split = splitLegacyCoinRows(incomingRows, []);
    return this.#transferPreparedSnapshot({
      rows: split.rows,
      coins: addManualCoinsChecked(coins, split.convertedCoins),
      sceneId,
      x,
      y,
      mutationId,
      ownerUserId
    });
  }

  async transferCoinsToScene({ coins = {}, sceneId, x, y, mutationId, ownerUserId = "" } = {}) {
    const incomingCoins = normalizedCoins(coins);
    if (!hasPositiveCoins(incomingCoins)) {
      throw new Error("Для наземной кучи нужно передать хотя бы одну монету.");
    }
    return this.#transferPreparedSnapshot({
      rows: [],
      coins: incomingCoins,
      sceneId,
      x,
      y,
      mutationId,
      ownerUserId
    });
  }

  findProcessedMutationAtPoint({ sceneId, x, y, mutationId } = {}) {
    const game = this.#requireActiveGm();
    const scene = this.#resolveScene(game, sceneId);
    const pointX = Number(x);
    const pointY = Number(y);
    const stableMutationId = clean(mutationId);
    if (!scene || !Number.isFinite(pointX) || !Number.isFinite(pointY) || !stableMutationId) return null;
    const token = findGroundPileAtPoint(scene, pointX, pointY);
    if (!token) return null;
    const mutationIds = readFlag(token, "groundPile")?.mutationIds ?? [];
    if (!mutationIds.includes(stableMutationId)) return null;
    return { created: false, merged: false, duplicate: true, token, state: readStorageState(token) };
  }

  async #runSceneMutation(sceneId, operation) {
    const key = clean(sceneId);
    const previous = this.sceneMutationTasks.get(key) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(operation);
    this.sceneMutationTasks.set(key, task);
    try {
      return await task;
    }
    finally {
      if (this.sceneMutationTasks.get(key) === task) this.sceneMutationTasks.delete(key);
    }
  }

  async #transferPreparedSnapshot(request) {
    return this.#runSceneMutation(request.sceneId, () => this.#transferPreparedSnapshotNow(request));
  }

  async #transferPreparedSnapshotNow({ rows, coins, sceneId, x, y, mutationId, ownerUserId = "" }) {
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
      const claimed = new Set(state.claimedRowIds);
      const manualRows = state.manualRows.map(clone);
      for (const incoming of rows) {
        if (isStorageJournalRow(incoming)) {
          manualRows.push(clone(incoming));
          continue;
        }
        const identity = rowIdentity(incoming);
        const stackIndex = manualRows.findIndex((entry) => (
          !claimed.has(clean(entry?.rowId)) && rowIdentity(entry) === identity
        ));
        if (stackIndex < 0) {
          manualRows.push(clone(incoming));
          continue;
        }
        const next = clone(manualRows[stackIndex]);
        next.quantity = rowQuantity(next) + rowQuantity(incoming);
        next.itemData ??= {};
        next.itemData.system ??= {};
        next.itemData.system.quantity = next.quantity;
        manualRows[stackIndex] = next;
      }
      const incomingCoins = normalizedCoins(coins);
      const hasIncomingCoins = hasPositiveCoins(incomingCoins);
      const discardClaimedBalances = hasIncomingCoins && state.coinsClaimed === true;
      const candidate = {
        ...state,
        manualRows,
        manualCoins: addManualCoinsChecked(discardClaimedBalances ? {} : state.manualCoins, incomingCoins),
        generatedCoins: discardClaimedBalances ? normalizedCoins({}) : state.generatedCoins,
        coinsClaimed: hasIncomingCoins ? false : state.coinsClaimed,
        state: "opened",
        displayMode: "opened"
      };
      const presentation = deriveGroundPilePresentation(visibleRows(candidate), {
        coins: unclaimedCoins(candidate),
        preserveEmptyCoinPile: groundFlag.coinPile === true,
        readJournalRowIds: candidate.readJournalRowIds
      });
      const next = await this.#writePile(existing, candidate, presentation, [
        ...(groundFlag.mutationIds ?? []),
        stableMutationId
      ], ownerUserId);
      return { created: false, merged: true, duplicate: false, token: existing, state: next };
    }

    const actor = this.#resolvePileActor(game);
    if (!actor) throw new Error("Служебный актёр наземной кучи не восстановлен.");
    const incomingCoins = normalizedCoins(coins);
    const presentation = deriveGroundPilePresentation(rows, {
      coins: incomingCoins,
      readJournalRowIds: []
    });
    const textures = {
      unopened: presentation.img,
      opened: presentation.img,
      empty: presentation.img
    };
    const storage = buildStorageTokenState({
      baseName: presentation.name,
      state: "opened",
      manualRows: rows,
      manualCoins: coins,
      textures,
      displayMode: "opened"
    });
    const prototype = clone(actor?.prototypeToken?.toObject?.() ?? actor?.prototypeToken ?? {});
    const hasCoins = hasPositiveCoins(incomingCoins);
    const tinyGroundItem = presentation.categoryKey === "coins" || (rows.length === 1
      && rows[0]?.rowKind !== "container"
      && !rows[0]?.container
      && !hasCoins);
    const tokenWidth = tinyGroundItem ? 0.5 : Math.max(1, Number(prototype.width ?? 1));
    const tokenHeight = tinyGroundItem ? 0.5 : Math.max(1, Number(prototype.height ?? 1));
    const gridSize = Math.max(1, Number(scene?.grid?.size ?? scene?.grid?.sizeX ?? 100) || 100);
    const data = {
      ...prototype,
      actorId: actor.id,
      actorLink: false,
      sight: {
        ...(clone(prototype.sight) ?? {}),
        enabled: false
      },
      delta: ownedSyntheticActorDelta(prototype.delta, ownerUserId),
      name: presentation.name,
      x: pointX - tokenWidth * gridSize / 2,
      y: pointY - tokenHeight * gridSize / 2,
      width: tokenWidth,
      height: tokenHeight,
      texture: { ...(clone(prototype.texture) ?? {}), src: presentation.img },
      flags: {
        ...(clone(prototype.flags) ?? {}),
        [MODULE_ID]: {
          ...(clone(prototype.flags?.[MODULE_ID]) ?? {}),
          storage,
          groundPile: {
            enabled: true,
            coinPile: presentation.categoryKey === "coins",
            mutationIds: [stableMutationId]
          }
        }
      }
    };
    const [token] = await scene.createEmbeddedDocuments("Token", [data]);
    if (!token) throw new Error("Foundry не создал токен наземной кучи.");
    return { created: true, merged: false, duplicate: false, token, state: storage };
  }

  async refreshAfterStorageMutation(token, state = readStorageState(token)) {
    if (!isGroundPileToken(token)) return { deleted: false, state };
    const groundFlag = clone(readFlag(token, "groundPile")) ?? {};
    const rows = visibleRows(state);
    const coins = unclaimedCoins(state);
    const hasCoins = hasPositiveCoins(coins);
    if (!rows.length && !hasCoins && groundFlag.coinPile !== true) {
      const scene = token?.parent;
      try {
        if (typeof token?.delete === "function") await token.delete();
        else await scene?.deleteEmbeddedDocuments?.("Token", [token.id]);
      }
      catch (error) {
        const stillPresent = collectionContains(scene?.tokens, token);
        if (token?.deleted !== true && token?._destroyed !== true && stillPresent !== false) throw error;
      }
      return { deleted: true, state };
    }
    const presentation = deriveGroundPilePresentation(rows, {
      coins,
      preserveEmptyCoinPile: groundFlag.coinPile === true,
      readJournalRowIds: state.readJournalRowIds
    });
    const next = await this.#writePile(token, state, presentation, groundFlag.mutationIds ?? []);
    return { deleted: false, state: next };
  }

  async repairLegacyCoinRows() {
    const game = this.#requireActiveGm();
    let repairedTokens = 0;
    let convertedRows = 0;
    for (const scene of collectionValues(game?.scenes)) {
      await this.#runSceneMutation(scene?.id, async () => {
        for (const token of collectionValues(scene?.tokens)) {
          if (!isGroundPileToken(token)) continue;
          const migration = migrateLegacyCoinRowsInState(readStorageState(token));
          if (!migration) continue;
          const groundFlag = clone(readFlag(token, "groundPile")) ?? {};
          const presentation = deriveGroundPilePresentation(visibleRows(migration.state), {
            coins: unclaimedCoins(migration.state),
            preserveEmptyCoinPile: groundFlag.coinPile === true,
            readJournalRowIds: migration.state.readJournalRowIds
          });
          await this.#writePile(token, migration.state, presentation, groundFlag.mutationIds ?? []);
          repairedTokens += 1;
          convertedRows += migration.convertedRows;
        }
      });
    }
    return { repairedTokens, convertedRows };
  }
}
