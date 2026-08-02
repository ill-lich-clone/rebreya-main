import { isStorageActor, readStorageState } from "./storage-service.js";
import { resolveStorageDepositSource } from "./storage-deposit-source.js";

const STORAGE_ROW_DESTINATIONS = new Set(["self", "party", "character", "scene"]);
const STORAGE_COIN_DESTINATIONS = new Set(["self", "party"]);
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

function isOptionalQuantity(value) {
  return value === null || (Number.isSafeInteger(value) && value >= 1);
}

function isValidStorageDepositSource(source) {
  if (hasExactKeys(source, ["itemUuid", "kind"])) {
    return source.kind === "item"
      && isTrimmedString(source.itemUuid, { required: true });
  }
  return hasExactKeys(source, ["kind", "quantity", "rowId", "tokenUuid"])
    && source.kind === "storage-row"
    && isTrimmedString(source.tokenUuid, { required: true })
    && isTrimmedString(source.rowId, { required: true, max: 160 })
    && Number.isSafeInteger(source.quantity)
    && source.quantity >= 1;
}

function isValidStorageTarget(destination, target) {
  if (destination === "self" || destination === "party") return target === null;
  if (destination === "character") {
    return hasExactKeys(target, ["actorUuid"])
      && isTrimmedString(target.actorUuid, { required: true });
  }
  if (destination === "scene") {
    return hasExactKeys(target, ["sceneId", "x", "y"])
      && isTrimmedString(target.sceneId, { required: true, max: 160 })
      && Number.isFinite(target.x)
      && Number.isFinite(target.y);
  }
  return false;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function isValidStorageOpenPayload(payload) {
  return hasExactKeys(payload, ["characterTokenUuid", "tokenUuid"])
    && isTrimmedString(payload.tokenUuid, { required: true })
    && isTrimmedString(payload.characterTokenUuid);
}

export function isValidStorageClaimRowPayload(payload) {
  return hasExactKeys(payload, [
    "characterTokenUuid", "destination", "mutationId", "quantity", "rowId", "target", "tokenUuid"
  ])
    && isTrimmedString(payload.tokenUuid, { required: true })
    && isTrimmedString(payload.characterTokenUuid, { required: payload.destination === "self" })
    && isTrimmedString(payload.rowId, { required: true, max: 160 })
    && STORAGE_ROW_DESTINATIONS.has(payload.destination)
    && isValidStorageTarget(payload.destination, payload.target)
    && isOptionalQuantity(payload.quantity)
    && isTrimmedString(payload.mutationId, { required: true, max: 160 });
}

export function isValidStorageClaimCoinsPayload(payload) {
  return hasExactKeys(payload, ["characterTokenUuid", "destination", "mutationId", "tokenUuid"])
    && isTrimmedString(payload.tokenUuid, { required: true })
    && isTrimmedString(payload.characterTokenUuid, { required: payload.destination === "self" })
    && STORAGE_COIN_DESTINATIONS.has(payload.destination)
    && isTrimmedString(payload.mutationId, { required: true, max: 160 });
}

export function isValidStorageDepositPayload(payload) {
  return hasExactKeys(payload, [
    "characterTokenUuid", "mutationId", "quantity", "source", "tokenUuid"
  ])
    && isTrimmedString(payload.tokenUuid, { required: true })
    && isTrimmedString(payload.characterTokenUuid)
    && isValidStorageDepositSource(payload.source)
    && Number.isSafeInteger(payload.quantity)
    && payload.quantity >= 1
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
  if (!STORAGE_ROW_DESTINATIONS.has(destination)) {
    throw new Error("Неизвестное назначение предмета из хранилища.");
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
    measurePointDistance = () => Number.POSITIVE_INFINITY,
    groundPileService = null,
    isVisibleTo,
    resolveDocument = (...args) => globalThis.fromUuid?.(...args),
    resolveDepositSource = resolveStorageDepositSource
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
    this.measurePointDistance = measurePointDistance;
    this.groundPileService = groundPileService;
    this.isVisibleTo = isVisibleTo;
    this.resolveDocument = resolveDocument;
    this.resolveDepositSource = resolveDepositSource;
    this.claimTasks = new Map();
    this.claimQueues = new Map();
    this.claimResults = new Map();
  }

  async #resolveCharacterTarget(target, sender) {
    const document = tokenDocument(await this.resolveToken(clean(target?.actorUuid)));
    const actor = document?.actor ?? document;
    if (!actor || actor.type !== "character") {
      throw new Error("Предмет можно перенести только в инвентарь персонажа.");
    }
    if (sender?.isGM !== true && actor.testUserPermission?.(sender, "OWNER") !== true) {
      throw new Error("У вас нет прав владельца на этого персонажа.");
    }
    return actor;
  }

  async #validateSceneTarget(target, access, sender) {
    const targetSceneId = clean(target?.sceneId);
    if (!targetSceneId || targetSceneId !== sceneId(access.storageToken)) {
      throw new Error("Предмет можно положить только на сцену с открытым хранилищем.");
    }
    if (sender?.isGM !== true) {
      const distance = Number(await this.measurePointDistance(access.characterToken, target));
      if (!Number.isFinite(distance) || distance > MAX_STORAGE_DISTANCE_FEET) {
        throw new Error("Предмет можно положить на землю только в пределах 5 футов от персонажа.");
      }
    }
    if (!this.groundPileService?.transferToScene) {
      throw new Error("Сервис наземных куч Rebreya недоступен.");
    }
  }

  async #refreshSource(storageToken, state) {
    await this.groundPileService?.refreshAfterStorageMutation?.(storageToken, state);
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

  async #runMutation(queueKeys, mutationKey, operation) {
    if (this.claimResults.has(mutationKey)) return this.claimResults.get(mutationKey);
    const existing = this.claimTasks.get(mutationKey);
    if (existing) return existing;

    const keys = Array.from(new Set((Array.isArray(queueKeys) ? queueKeys : [queueKeys])
      .map(clean)
      .filter(Boolean))).sort();
    const previous = Promise.all(keys.map((key) => (
      this.claimQueues.get(key)?.catch(() => {}) ?? Promise.resolve()
    )));
    const queued = previous.then(operation);
    for (const key of keys) this.claimQueues.set(key, queued);
    const task = queued.then((result) => {
      this.claimResults.set(mutationKey, result);
      if (this.claimResults.size > 500) {
        this.claimResults.delete(this.claimResults.keys().next().value);
      }
      return result;
    }).finally(() => {
      this.claimTasks.delete(mutationKey);
      for (const key of keys) {
        if (this.claimQueues.get(key) === queued) this.claimQueues.delete(key);
      }
    });
    this.claimTasks.set(mutationKey, task);
    return task;
  }

  async #runClaim(sourceKey, mutationKey, operation) {
    return this.#runMutation([sourceKey], mutationKey, operation);
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
    const mutationKey = storageMutationId({
      tokenUuid,
      kind: "row",
      identity: rowId,
      destination,
      mutationId
    });
    return this.#runClaim(`${tokenUuid}:storage`, mutationKey, async () => {
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
      const available = Math.max(1, Math.trunc(Number(
        row.quantity ?? row.itemData?.system?.quantity ?? 1
      )) || 1);
      const quantity = payload.quantity === null || payload.quantity === undefined
        ? available
        : Number(payload.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > available) {
        throw new Error("Количество должно быть целым числом от 1 до доступного остатка.");
      }
      const transferRow = clone(row);
      transferRow.quantity = quantity;
      transferRow.itemData ??= {};
      transferRow.itemData.system ??= {};
      transferRow.itemData.system.quantity = quantity;
      const grantId = mutationKey;
      if (destination === "self") {
        await this.inventoryService.addLootgenRowToCharacterOnce(transferRow, access.character, grantId);
      }
      else if (destination === "party") {
        await this.inventoryService.addLootgenRowToInventoryOnce(transferRow, grantId);
      }
      else if (destination === "character") {
        const targetActor = await this.#resolveCharacterTarget(payload.target, sender);
        await this.inventoryService.addLootgenRowToCharacterOnce(transferRow, targetActor, grantId);
      }
      else {
        await this.#validateSceneTarget(payload.target, access, sender);
        await this.groundPileService.transferToScene({
          row: transferRow,
          quantity,
          sceneId: clean(payload.target.sceneId),
          x: Number(payload.target.x),
          y: Number(payload.target.y),
          mutationId: grantId
        });
      }
      const result = await this.storageService.claim(access.storageToken, { kind: "row", rowId, quantity });
      await this.#refreshSource(access.storageToken, result.state);
      return result;
    });
  }

  async claimCoins(payload = {}, { sender } = {}) {
    const destination = clean(payload.destination);
    if (!STORAGE_COIN_DESTINATIONS.has(destination)) {
      throw new Error("Монеты можно забрать себе или в инвентарь группы.");
    }
    const mutationId = requireMutationId(payload.mutationId);
    const tokenUuid = clean(payload.tokenUuid);
    const mutationKey = storageMutationId({ tokenUuid, kind: "coins", destination, mutationId });
    return this.#runClaim(`${tokenUuid}:storage`, mutationKey, async () => {
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
      const grantId = mutationKey;
      if (destination === "self") {
        await this.inventoryService.addCurrencyToCharacterOnce(coins, access.character, grantId);
      }
      else {
        await this.inventoryService.addCurrencyToInventoryOnce(coins, grantId);
      }
      const result = await this.storageService.claim(access.storageToken, { kind: "coins" });
      await this.#refreshSource(access.storageToken, result.state);
      return result;
    });
  }

  async deposit(payload = {}, { sender } = {}) {
    const tokenUuid = clean(payload.tokenUuid);
    const mutationId = requireMutationId(payload.mutationId);
    const sourceRef = clone(payload.source);
    if (!isValidStorageDepositSource(sourceRef)) {
      throw new Error("Неподдерживаемый источник предмета для хранилища.");
    }
    const quantity = Number(payload.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      throw new Error("Количество должно быть целым числом не меньше 1.");
    }
    if (sourceRef.kind === "storage-row" && clean(sourceRef.tokenUuid) === tokenUuid) {
      throw new Error("Нельзя перенести предмет из хранилища в то же самое хранилище.");
    }

    const sourceIdentity = sourceRef.kind === "storage-row"
      ? `${clean(sourceRef.tokenUuid)}:${clean(sourceRef.rowId)}`
      : clean(sourceRef.itemUuid);
    const mutationKey = storageMutationId({
      tokenUuid,
      kind: "deposit",
      identity: sourceIdentity,
      destination: "storage",
      mutationId
    });
    const queueKeys = [
      `${tokenUuid}:storage`,
      sourceRef.kind === "storage-row"
        ? `${clean(sourceRef.tokenUuid)}:storage`
        : `${clean(sourceRef.itemUuid)}:item`
    ];

    return this.#runMutation(queueKeys, mutationKey, async () => {
      const access = await this.#resolveAccess(payload, sender);
      const source = await this.resolveDepositSource(sourceRef, {
        fromUuid: this.resolveDocument,
        resolveToken: this.resolveToken,
        storageService: this.storageService
      });
      if (!source || typeof source.consume !== "function" || typeof source.restore !== "function") {
        throw new Error("Источник предмета для хранилища недоступен.");
      }
      if (quantity > Number(source.available)) {
        throw new Error(`Количество должно быть целым числом от 1 до ${source.available}.`);
      }
      if (source.mode === "move" && source.canUserMove?.(sender) !== true) {
        throw new Error("У вас нет прав владельца на перемещение этого предмета.");
      }
      if (source.kind === "storage-row") {
        await this.#resolveAccess({
          tokenUuid: clean(sourceRef.tokenUuid),
          characterTokenUuid: clean(payload.characterTokenUuid)
        }, sender);
      }

      const beforeTarget = readStorageState(access.storageToken);
      let deposited = null;
      let sourceReceipt = null;
      try {
        deposited = await this.storageService.depositRow(access.storageToken, source.row, { quantity });
        sourceReceipt = await source.consume(quantity);
      }
      catch (error) {
        const rollbackErrors = [];
        if (sourceReceipt) {
          try {
            await source.restore(sourceReceipt);
          }
          catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
        if (deposited) {
          try {
            await this.storageService.configure(access.storageToken, beforeTarget);
          }
          catch (rollbackError) {
            rollbackErrors.push(rollbackError);
          }
        }
        if (rollbackErrors.length) {
          throw new AggregateError([error, ...rollbackErrors], "Не удалось полностью откатить перенос предмета.");
        }
        throw error;
      }

      const refreshes = [this.#refreshSource(access.storageToken, deposited.state)];
      if (source.storageToken) {
        refreshes.push(this.#refreshSource(source.storageToken, sourceReceipt?.state));
      }
      const refreshResults = await Promise.allSettled(refreshes);
      for (const refresh of refreshResults) {
        if (refresh.status === "rejected") {
          console.warn("Rebreya storage refresh failed after a committed deposit.", refresh.reason);
        }
      }
      return { ...deposited, sourceMode: source.mode };
    });
  }
}
