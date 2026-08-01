import { isStorageActor, readStorageState } from "./storage-service.js";

const STORAGE_DESTINATIONS = new Set(["self", "party"]);
const MAX_STORAGE_DISTANCE_FEET = 5;

function clean(value) {
  return String(value ?? "").trim();
}

function hasExactKeys(value, expectedKeys) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actualKeys = Object.keys(value).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index]);
}

function isTrimmedString(value, { required = false, max = 512 } = {}) {
  return typeof value === "string"
    && value === value.trim()
    && value.length <= max
    && (!required || value.length > 0);
}

export function isValidStorageOpenPayload(payload) {
  return hasExactKeys(payload, ["characterTokenUuid", "tokenUuid"])
    && isTrimmedString(payload.tokenUuid, { required: true })
    && isTrimmedString(payload.characterTokenUuid);
}

export function isValidStorageClaimRowPayload(payload) {
  return hasExactKeys(payload, [
    "characterTokenUuid", "destination", "mutationId", "rowId", "tokenUuid"
  ])
    && isTrimmedString(payload.tokenUuid, { required: true })
    && isTrimmedString(payload.characterTokenUuid, { required: payload.destination === "self" })
    && isTrimmedString(payload.rowId, { required: true, max: 160 })
    && STORAGE_DESTINATIONS.has(payload.destination)
    && isTrimmedString(payload.mutationId, { required: true, max: 160 });
}

export function isValidStorageClaimCoinsPayload(payload) {
  return hasExactKeys(payload, ["characterTokenUuid", "destination", "mutationId", "tokenUuid"])
    && isTrimmedString(payload.tokenUuid, { required: true })
    && isTrimmedString(payload.characterTokenUuid, { required: payload.destination === "self" })
    && STORAGE_DESTINATIONS.has(payload.destination)
    && isTrimmedString(payload.mutationId, { required: true, max: 160 });
}

export function storageCharacterTokenUuidForClaim({
  controlledCharacterTokenUuid = "",
  storageTokenUuid = "",
  destination = "",
  isGM = false
} = {}) {
  const controlledUuid = clean(controlledCharacterTokenUuid);
  if (controlledUuid) return controlledUuid;
  return isGM === true && clean(destination) === "party"
    ? clean(storageTokenUuid)
    : "";
}

function tokenDocument(token) {
  return token?.document ?? token ?? null;
}

function sceneId(token) {
  const document = tokenDocument(token);
  return clean(document?.parent?.id ?? document?.scene?.id);
}

function requireMutationId(value) {
  const mutationId = clean(value);
  if (!mutationId) {
    throw new Error("Для выдачи из хранилища нужен стабильный mutationId.");
  }
  return mutationId;
}

function requireDestination(value) {
  const destination = clean(value);
  if (!STORAGE_DESTINATIONS.has(destination)) {
    throw new Error("Получатель лута должен быть self или party.");
  }
  return destination;
}

function storageMutationId({ tokenUuid, kind, identity = "", destination, mutationId }) {
  return ["storage", clean(tokenUuid), clean(kind), clean(identity), clean(destination), requireMutationId(mutationId)].join(":");
}

function rowIdentity(row, index) {
  return clean(row?.rowId ?? index);
}

export class StorageCommandService {
  constructor({
    storageService,
    inventoryService,
    resolveToken,
    measureDistance,
    isVisibleTo
  } = {}) {
    if (!storageService || !inventoryService) {
      throw new TypeError("StorageCommandService requires storage and inventory services.");
    }
    if (typeof resolveToken !== "function" || typeof measureDistance !== "function" || typeof isVisibleTo !== "function") {
      throw new TypeError("StorageCommandService requires token access dependencies.");
    }
    this.storageService = storageService;
    this.inventoryService = inventoryService;
    this.resolveToken = resolveToken;
    this.measureDistance = measureDistance;
    this.isVisibleTo = isVisibleTo;
    this.claimTasks = new Map();
  }

  async #resolveAccess(payload, sender) {
    const tokenUuid = clean(payload?.tokenUuid);
    const storageToken = tokenDocument(await this.resolveToken(tokenUuid));
    if (!storageToken || !isStorageActor(storageToken.actor)) {
      throw new Error("Токен не является хранилищем Rebreya.");
    }

    const characterTokenUuid = clean(payload?.characterTokenUuid);
    const characterToken = characterTokenUuid
      ? tokenDocument(await this.resolveToken(characterTokenUuid))
      : null;
    const character = characterToken?.actor ?? null;

    if (sender?.isGM !== true) {
      if (!characterToken || character?.type !== "character"
        || character.testUserPermission?.(sender, "OWNER") !== true) {
        throw new Error("Выберите принадлежащего вам персонажа для открытия хранилища.");
      }
      if (!sceneId(storageToken) || sceneId(storageToken) !== sceneId(characterToken)) {
        throw new Error("Персонаж и хранилище должны находиться на одной сцене.");
      }
      if (await this.isVisibleTo(storageToken, characterToken, sender) !== true) {
        throw new Error("Персонаж не видит это хранилище.");
      }
      const distance = Number(await this.measureDistance(characterToken, storageToken));
      if (!Number.isFinite(distance) || distance > MAX_STORAGE_DISTANCE_FEET) {
        throw new Error("Хранилище можно открыть только в пределах 5 футов.");
      }
    }

    return { storageToken, characterToken, character };
  }

  async #runClaim(key, operation) {
    const existing = this.claimTasks.get(key);
    if (existing) return existing;
    const task = Promise.resolve().then(operation).finally(() => this.claimTasks.delete(key));
    this.claimTasks.set(key, task);
    return task;
  }

  async open(payload = {}, { sender } = {}) {
    const access = await this.#resolveAccess(payload, sender);
    return this.storageService.open(access.storageToken, {
      senderId: clean(sender?.id),
      characterTokenUuid: clean(payload.characterTokenUuid)
    });
  }

  async claimRow(payload = {}, { sender } = {}) {
    const destination = requireDestination(payload.destination);
    const mutationId = requireMutationId(payload.mutationId);
    const rowId = clean(payload.rowId);
    if (!rowId) throw new Error("Не указан предмет хранилища.");
    const tokenUuid = clean(payload.tokenUuid);
    return this.#runClaim(`${tokenUuid}:row:${rowId}`, async () => {
      const access = await this.#resolveAccess(payload, sender);
      if (destination === "self" && access.character?.type !== "character") {
        throw new Error("Для получения лута себе выберите персонажа.");
      }
      const state = readStorageState(access.storageToken);
      if (state.state === "unopened") throw new Error("Сначала откройте хранилище.");
      const rows = [...state.manualRows, ...state.generatedRows];
      const row = rows.find((entry, index) => rowIdentity(entry, index) === rowId) ?? null;
      if (!row || state.claimedRowIds.includes(rowId)) {
        return { changed: false, row: null, state };
      }
      const grantId = storageMutationId({ tokenUuid, kind: "row", identity: rowId, destination, mutationId });
      if (destination === "self") {
        await this.inventoryService.addLootgenRowToCharacterOnce(row, access.character, grantId);
      }
      else {
        await this.inventoryService.addLootgenRowToInventoryOnce(row, grantId);
      }
      return this.storageService.claim(access.storageToken, { kind: "row", rowId });
    });
  }

  async claimCoins(payload = {}, { sender } = {}) {
    const destination = requireDestination(payload.destination);
    const mutationId = requireMutationId(payload.mutationId);
    const tokenUuid = clean(payload.tokenUuid);
    return this.#runClaim(`${tokenUuid}:coins`, async () => {
      const access = await this.#resolveAccess(payload, sender);
      if (destination === "self" && access.character?.type !== "character") {
        throw new Error("Для получения монет себе выберите персонажа.");
      }
      const state = readStorageState(access.storageToken);
      if (state.state === "unopened") throw new Error("Сначала откройте хранилище.");
      const keys = ["pp", "gp", "sp", "cp"];
      const coins = Object.fromEntries(keys.map((key) => [
        key,
        Math.max(0, Math.trunc(Number(state.manualCoins?.[key] ?? 0) + Number(state.generatedCoins?.[key] ?? 0)))
      ]));
      if (state.coinsClaimed || !keys.some((key) => coins[key] > 0)) {
        return { changed: false, coins, state };
      }
      const grantId = storageMutationId({ tokenUuid, kind: "coins", destination, mutationId });
      if (destination === "self") {
        await this.inventoryService.addCurrencyToCharacterOnce(coins, access.character, grantId);
      }
      else {
        await this.inventoryService.addCurrencyToInventoryOnce(coins, grantId);
      }
      return this.storageService.claim(access.storageToken, { kind: "coins" });
    });
  }
}
