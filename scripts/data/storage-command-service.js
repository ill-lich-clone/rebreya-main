import {
  isStorageActor,
  readStorageCoinDenomination,
  readStorageState,
  readStorageStateAtPath
} from "./storage-service.js?v=1.4.146-storage-persisted-items";
import { resolveStorageDepositSource } from "./storage-deposit-source.js?v=1.4.144-spreadsheet-coins-ground-repair";
import { isStorageContainerRow, isStorageJournalRow } from "./storage-container-snapshot.js";
import { MODULE_ID } from "../constants.js";
import { escapeFoundryHtml } from "../shared/foundry-values.js";

const STORAGE_ROW_DESTINATIONS = new Set(["self", "party", "character", "scene"]);
const STORAGE_COIN_DESTINATIONS = new Set(["self", "party"]);
const STORAGE_COIN_DENOMINATIONS = new Set(["pp", "gp", "sp", "cp"]);
const STORAGE_COIN_LABELS = Object.freeze({ pp: "пм", gp: "зм", sp: "см", cp: "мм" });
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

function isValidStoragePath(value) {
  return Array.isArray(value)
    && value.length <= 8
    && value.every((rowId) => isTrimmedString(rowId, { required: true, max: 160 }));
}

function hasLegacyOrPathKeys(value, legacyKeys) {
  return hasExactKeys(value, legacyKeys)
    || (hasExactKeys(value, [...legacyKeys, "path"].sort()) && isValidStoragePath(value.path));
}

function storagePath(value) {
  return (Array.isArray(value) ? value : []).map(clean).filter(Boolean);
}

function storagePathKey(value) {
  return storagePath(value).join("/");
}

function isValidStorageDepositSource(source) {
  if (hasExactKeys(source, ["journalUuid", "kind"])) {
    return source.kind === "journal"
      && isTrimmedString(source.journalUuid, { required: true });
  }
  if (hasExactKeys(source, ["itemUuid", "kind"])) {
    return source.kind === "item"
      && isTrimmedString(source.itemUuid, { required: true });
  }
  if (hasExactKeys(source, ["kind", "tokenUuid"])) {
    return source.kind === "storage-token"
      && isTrimmedString(source.tokenUuid, { required: true });
  }
  const validRowKeys = hasExactKeys(source, ["kind", "quantity", "rowId", "tokenUuid"])
    || hasExactKeys(source, ["kind", "path", "quantity", "rowId", "tokenUuid"]);
  return validRowKeys
    && source.kind === "storage-row"
    && isTrimmedString(source.tokenUuid, { required: true })
    && isTrimmedString(source.rowId, { required: true, max: 160 })
    && (source.path === undefined || isValidStoragePath(source.path))
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
  return hasLegacyOrPathKeys(payload, ["characterTokenUuid", "tokenUuid"])
    && isTrimmedString(payload.tokenUuid, { required: true })
    && isTrimmedString(payload.characterTokenUuid);
}

export function isValidStorageJournalReadPayload(payload) {
  return hasLegacyOrPathKeys(payload, ["characterTokenUuid", "rowId", "tokenUuid"])
    && isTrimmedString(payload.tokenUuid, { required: true })
    && isTrimmedString(payload.characterTokenUuid)
    && isTrimmedString(payload.rowId, { required: true, max: 160 });
}

export function isValidStorageClaimRowPayload(payload) {
  return hasLegacyOrPathKeys(payload, [
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
  return hasLegacyOrPathKeys(payload, ["characterTokenUuid", "destination", "mutationId", "tokenUuid"])
    && isTrimmedString(payload.tokenUuid, { required: true })
    && isTrimmedString(payload.characterTokenUuid, { required: payload.destination === "self" })
    && STORAGE_COIN_DESTINATIONS.has(payload.destination)
    && isTrimmedString(payload.mutationId, { required: true, max: 160 });
}

export function isValidStorageDepositPayload(payload) {
  return hasLegacyOrPathKeys(payload, [
    "characterTokenUuid", "mutationId", "quantity", "source", "tokenUuid"
  ])
    && isTrimmedString(payload.tokenUuid, { required: true })
    && isTrimmedString(payload.characterTokenUuid)
    && isValidStorageDepositSource(payload.source)
    && Number.isSafeInteger(payload.quantity)
    && payload.quantity >= 1
    && isTrimmedString(payload.mutationId, { required: true, max: 160 });
}

export function isValidStorageRestorePortablePayload(payload) {
  return hasExactKeys(payload, [
    "characterTokenUuid", "itemUuid", "mutationId", "sceneId", "x", "y"
  ])
    && isTrimmedString(payload.characterTokenUuid)
    && isTrimmedString(payload.itemUuid, { required: true })
    && isTrimmedString(payload.sceneId, { required: true, max: 160 })
    && Number.isFinite(payload.x)
    && Number.isFinite(payload.y)
    && isTrimmedString(payload.mutationId, { required: true, max: 160 });
}

export function isValidStorageDropItemPayload(payload) {
  return hasExactKeys(payload, [
    "characterTokenUuid", "itemUuid", "mutationId", "quantity", "sceneId", "x", "y"
  ])
    && isTrimmedString(payload.characterTokenUuid)
    && isTrimmedString(payload.itemUuid, { required: true })
    && isTrimmedString(payload.sceneId, { required: true, max: 160 })
    && Number.isFinite(payload.x)
    && Number.isFinite(payload.y)
    && Number.isSafeInteger(payload.quantity)
    && payload.quantity >= 1
    && isTrimmedString(payload.mutationId, { required: true, max: 160 });
}

export function isValidStorageCoinDropPayload(payload) {
  return hasExactKeys(payload, [
    "characterTokenUuid", "denomination", "itemUuid", "mutationId", "quantity", "sceneId", "x", "y"
  ])
    && isTrimmedString(payload.characterTokenUuid)
    && isTrimmedString(payload.itemUuid, { required: true })
    && STORAGE_COIN_DENOMINATIONS.has(payload.denomination)
    && isTrimmedString(payload.sceneId, { required: true, max: 160 })
    && Number.isFinite(payload.x)
    && Number.isFinite(payload.y)
    && Number.isSafeInteger(payload.quantity)
    && payload.quantity >= 1
    && isTrimmedString(payload.mutationId, { required: true, max: 160 });
}

export function isValidStorageTokenCharacterPayload(payload) {
  return hasExactKeys(payload, ["actorUuid", "characterTokenUuid", "mutationId", "tokenUuid"])
    && isTrimmedString(payload.tokenUuid, { required: true })
    && isTrimmedString(payload.characterTokenUuid)
    && isTrimmedString(payload.actorUuid, { required: true })
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

function storageMutationId({ tokenUuid, path = [], kind, identity = "", destination, mutationId }) {
  return [
    "storage",
    clean(tokenUuid),
    storagePathKey(path),
    clean(kind),
    clean(identity),
    clean(destination),
    requireMutationId(mutationId)
  ].join(":");
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
    containerItemService = null,
    durabilityService = null,
    journalReader,
    isVisibleTo,
    resolveDocument = (...args) => globalThis.fromUuid?.(...args),
    resolveDepositSource = resolveStorageDepositSource,
    createChatMessage = (data) => globalThis.ChatMessage?.create?.(data),
    logger = console
  } = {}) {
    if (!storageService || !inventoryService) {
      throw new TypeError("StorageCommandService requires storage and inventory services.");
    }
    if (typeof resolveToken !== "function" || typeof measureDistance !== "function" || typeof isVisibleTo !== "function") {
      throw new TypeError("StorageCommandService requires token access dependencies.");
    }
    if (typeof journalReader?.read !== "function") {
      throw new TypeError("StorageCommandService requires a storage Journal reader.");
    }
    if (durabilityService != null && typeof durabilityService.getOrBuildDurability !== "function") {
      throw new TypeError("StorageCommandService durabilityService requires getOrBuildDurability().");
    }
    this.storageService = storageService;
    this.inventoryService = inventoryService;
    this.resolveToken = resolveToken;
    this.measureDistance = measureDistance;
    this.measurePointDistance = measurePointDistance;
    this.groundPileService = groundPileService;
    this.containerItemService = containerItemService;
    this.durabilityService = durabilityService;
    this.journalReader = journalReader;
    this.isVisibleTo = isVisibleTo;
    this.resolveDocument = resolveDocument;
    this.resolveDepositSource = resolveDepositSource;
    this.createChatMessage = typeof createChatMessage === "function" ? createChatMessage : null;
    this.logger = logger;
    this.claimTasks = new Map();
    this.claimQueues = new Map();
    this.claimResults = new Map();
  }

  async #prepareGroundRow(row, { sourceItem = null, sourceKind = "" } = {}) {
    const prepared = clone(row);
    const coinDenomination = readStorageCoinDenomination(prepared?.itemData);
    if (!this.durabilityService
      || isStorageContainerRow(prepared)
      || isStorageJournalRow(prepared)
      || sourceKind === "storage-item"
      || sourceKind === "coin-template"
      || sourceKind === "journal"
      || prepared?.rowKind === "coin"
      || coinDenomination) {
      return prepared;
    }
    const durability = await this.durabilityService.getOrBuildDurability(
      sourceItem ?? prepared?.itemData
    );
    if (durability == null) {
      const moduleFlags = prepared?.itemData?.flags?.[MODULE_ID];
      if (moduleFlags && typeof moduleFlags === "object" && !Array.isArray(moduleFlags)) {
        delete moduleFlags.durability;
      }
      return prepared;
    }
    prepared.itemData ??= {};
    prepared.itemData.flags ??= {};
    prepared.itemData.flags[MODULE_ID] ??= {};
    prepared.itemData.flags[MODULE_ID].durability = clone(durability);
    return prepared;
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

  async #publishClaimMessage({ sender, destination, actor = null, row = null, quantity = null, coins = null } = {}) {
    if (!this.createChatMessage || !["self", "party"].includes(destination)) return false;
    const initiator = escapeFoundryHtml(clean(sender?.name) || "Игрок");
    const destinationLabel = destination === "party"
      ? "групповой инвентарь"
      : `инвентарь ${escapeFoundryHtml(clean(actor?.name) || "персонажа")}`;
    let subject = "";
    if (row) {
      const amount = Number(quantity);
      const safeQuantity = Number.isSafeInteger(amount) && amount > 0 ? amount : 1;
      const rowName = escapeFoundryHtml(clean(row?.name ?? row?.itemData?.name) || "Предмет");
      subject = `${safeQuantity} × ${rowName}`;
    }
    else {
      subject = Object.entries(STORAGE_COIN_LABELS)
        .map(([denomination, label]) => [denomination, label, Number(coins?.[denomination] ?? 0)])
        .filter(([, , amount]) => Number.isSafeInteger(amount) && amount > 0)
        .map(([, label, amount]) => `${amount} ${label}`)
        .join(", ");
    }
    if (!subject) return false;
    try {
      await this.createChatMessage({
        content: `<p><strong>${initiator}</strong> перемещает <strong>${subject}</strong> в ${destinationLabel}.</p>`
      });
      return true;
    }
    catch (error) {
      this.logger?.warn?.(`${MODULE_ID} | Storage claim ChatMessage creation failed.`, error);
      return false;
    }
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
    const result = await this.storageService.open(access.storageToken, {
      senderId: clean(sender?.id),
      characterTokenUuid: clean(payload.characterTokenUuid),
      path: storagePath(payload.path)
    });
    return {
      generatedNow: result?.generatedNow === true,
      state: clean(result?.state?.state) || "opened",
      displayMode: clean(result?.state?.displayMode) || "opened"
    };
  }

  async readJournal(payload = {}, { sender } = {}) {
    const access = await this.#resolveAccess(payload, sender);
    const path = storagePath(payload.path);
    const state = readStorageStateAtPath(access.storageToken, path);
    if (state.state !== "opened") throw new Error("Сначала откройте хранилище.");

    const rowId = clean(payload.rowId);
    const rows = [...state.manualRows, ...state.generatedRows];
    const row = rows.find((entry, index) => rowIdentity(entry, index) === rowId) ?? null;
    if (!row || state.claimedRowIds.includes(rowId)
      || row.rowKind !== "journal" || !isStorageJournalRow(row)) {
      throw new Error("Запись журнала недоступна.");
    }
    return this.journalReader.read(row.sourceId);
  }

  async claimRow(payload = {}, { sender } = {}) {
    const destination = requireDestination(payload.destination);
    const mutationId = requireMutationId(payload.mutationId);
    const rowId = clean(payload.rowId);
    if (!rowId) throw new Error("Не указан предмет хранилища.");
    const tokenUuid = clean(payload.tokenUuid);
    const path = storagePath(payload.path);
    const mutationKey = storageMutationId({
      tokenUuid,
      path,
      kind: "row",
      identity: rowId,
      destination,
      mutationId
    });
    return this.#runClaim(`${tokenUuid}:${storagePathKey(path)}:storage`, mutationKey, async () => {
      const access = await this.#resolveAccess(payload, sender);
      if (destination === "self" && access.character?.type !== "character") {
        throw new Error("Для получения лута себе выберите персонажа.");
      }
      const state = readStorageStateAtPath(access.storageToken, path);
      if (state.state === "unopened") throw new Error("Сначала откройте хранилище.");
      const rows = [...state.manualRows, ...state.generatedRows];
      const row = rows.find((entry, index) => rowIdentity(entry, index) === rowId) ?? null;
      if (!row || state.claimedRowIds.includes(rowId)) {
        return { changed: false, row: null, state };
      }
      if (isStorageJournalRow(row)) {
        throw new Error("Ссылку на журнал нельзя забрать из хранилища.");
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
      if (isStorageContainerRow(transferRow)) {
        if (!this.containerItemService) {
          throw new Error("Сервис переносимых контейнеров Rebreya недоступен.");
        }
        if (quantity !== 1) throw new Error("Контейнер можно переносить только целиком.");
        if (destination === "self") {
          await this.containerItemService.materializeToActorOnce(access.character, transferRow.container, grantId);
        }
        else if (destination === "party") {
          const inventoryActor = await this.inventoryService.getInventoryActor({ create: true });
          if (!inventoryActor) throw new Error("Не удалось получить партийный инвентарь.");
          await this.containerItemService.materializeToActorOnce(inventoryActor, transferRow.container, grantId);
        }
        else if (destination === "character") {
          const targetActor = await this.#resolveCharacterTarget(payload.target, sender);
          await this.containerItemService.materializeToActorOnce(targetActor, transferRow.container, grantId);
        }
        else {
          await this.#validateSceneTarget(payload.target, access, sender);
          if (typeof this.containerItemService.restoreSnapshotToScene !== "function") {
            throw new Error("Сервис восстановления контейнеров на сцене недоступен.");
          }
          await this.containerItemService.restoreSnapshotToScene(transferRow.container, {
            sceneId: clean(payload.target.sceneId),
            x: Number(payload.target.x),
            y: Number(payload.target.y),
            mutationId: grantId
          });
        }
      }
      else if (destination === "self") {
        await this.inventoryService.addLootgenRowToCharacterOnce(transferRow, access.character, grantId);
      }
      else if (destination === "party") {
        await this.inventoryService.addLootgenRowToInventoryOnce(
          transferRow,
          grantId,
          { allowPersistedItemData: true }
        );
      }
      else if (destination === "character") {
        const targetActor = await this.#resolveCharacterTarget(payload.target, sender);
        await this.inventoryService.addLootgenRowToCharacterOnce(transferRow, targetActor, grantId);
      }
      else {
        await this.#validateSceneTarget(payload.target, access, sender);
        const groundRow = await this.#prepareGroundRow(transferRow);
        await this.groundPileService.transferToScene({
          row: groundRow,
          quantity,
          sceneId: clean(payload.target.sceneId),
          x: Number(payload.target.x),
          y: Number(payload.target.y),
          mutationId: grantId,
          ownerUserId: clean(sender?.id)
        });
      }
      const result = await this.storageService.claim(access.storageToken, { kind: "row", rowId, quantity, path });
      await this.#refreshSource(access.storageToken, readStorageState(access.storageToken));
      if (result.changed === true) {
        await this.#publishClaimMessage({
          sender,
          destination,
          actor: access.character,
          row: transferRow,
          quantity
        });
      }
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
    const path = storagePath(payload.path);
    const mutationKey = storageMutationId({ tokenUuid, path, kind: "coins", destination, mutationId });
    return this.#runClaim(`${tokenUuid}:${storagePathKey(path)}:storage`, mutationKey, async () => {
      const access = await this.#resolveAccess(payload, sender);
      if (destination === "self" && access.character?.type !== "character") {
        throw new Error("Для получения монет себе выберите персонажа.");
      }
      const state = readStorageStateAtPath(access.storageToken, path);
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
      const result = await this.storageService.claim(access.storageToken, { kind: "coins", path });
      await this.#refreshSource(access.storageToken, readStorageState(access.storageToken));
      if (result.changed === true) {
        await this.#publishClaimMessage({
          sender,
          destination,
          actor: access.character,
          coins
        });
      }
      return result;
    });
  }

  async deposit(payload = {}, { sender } = {}) {
    const tokenUuid = clean(payload.tokenUuid);
    const path = storagePath(payload.path);
    const mutationId = requireMutationId(payload.mutationId);
    const sourceRef = clone(payload.source);
    if (!isValidStorageDepositSource(sourceRef)) {
      throw new Error("Неподдерживаемый источник предмета для хранилища.");
    }
    const quantity = Number(payload.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      throw new Error("Количество должно быть целым числом не меньше 1.");
    }
    if (sourceRef.kind === "journal" && sender?.isGM !== true) {
      throw new Error("Добавлять ссылки на журнал может только мастер.");
    }
    if (sourceRef.kind === "journal" && quantity !== 1) {
      throw new Error("Ссылку на журнал можно добавить только в количестве 1.");
    }
    if (["storage-row", "storage-token"].includes(sourceRef.kind) && clean(sourceRef.tokenUuid) === tokenUuid) {
      throw new Error("Нельзя перенести предмет из хранилища в то же самое хранилище.");
    }

    const sourceIdentity = sourceRef.kind === "storage-row"
      ? `${clean(sourceRef.tokenUuid)}:${storagePathKey(sourceRef.path)}:${clean(sourceRef.rowId)}`
      : sourceRef.kind === "storage-token"
        ? clean(sourceRef.tokenUuid)
        : sourceRef.kind === "journal"
          ? clean(sourceRef.journalUuid)
          : clean(sourceRef.itemUuid);
    const mutationKey = storageMutationId({
      tokenUuid,
      path,
      kind: "deposit",
      identity: sourceIdentity,
      destination: "storage",
      mutationId
    });
    const queueKeys = [
      `${tokenUuid}:${storagePathKey(path)}:storage`,
      ["storage-row", "storage-token"].includes(sourceRef.kind)
        ? `${clean(sourceRef.tokenUuid)}:storage`
        : sourceRef.kind === "journal"
          ? `${clean(sourceRef.journalUuid)}:journal`
          : `${clean(sourceRef.itemUuid)}:item`
    ];

    return this.#runMutation(queueKeys, mutationKey, async () => {
      const access = await this.#resolveAccess(payload, sender);
      const source = await this.resolveDepositSource(sourceRef, {
        fromUuid: this.resolveDocument,
        resolveToken: this.resolveToken,
        storageService: this.storageService,
        containerItemService: this.containerItemService
      });
      if (!source || typeof source.consume !== "function" || typeof source.restore !== "function") {
        throw new Error("Источник предмета для хранилища недоступен.");
      }
      if (source.kind === "coin-template") {
        throw new Error("Managed Item монет можно переносить только в физическую кучу монет на сцене.");
      }
      if (quantity > Number(source.available)) {
        throw new Error(`Количество должно быть целым числом от 1 до ${source.available}.`);
      }
      if (source.mode === "move" && source.canUserMove?.(sender) !== true) {
        throw new Error("У вас нет прав владельца на перемещение этого предмета.");
      }
      if (["storage-row", "storage-token"].includes(source.kind)) {
        await this.#resolveAccess({
          tokenUuid: clean(sourceRef.tokenUuid),
          characterTokenUuid: clean(payload.characterTokenUuid)
        }, sender);
      }

      const beforeTarget = readStorageStateAtPath(access.storageToken, path);
      let deposited = null;
      let sourceReceipt = null;
      try {
        deposited = await this.storageService.depositRow(access.storageToken, source.row, { quantity, path });
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
            await this.storageService.configure(access.storageToken, beforeTarget, { path });
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

      const refreshes = [this.#refreshSource(access.storageToken, readStorageState(access.storageToken))];
      if (source.storageToken && sourceReceipt?.kind !== "storage-token") {
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

  async restorePortableItem(payload = {}, { sender } = {}) {
    return this.dropItemToScene({ ...payload, quantity: 1 }, { sender });
  }

  async moveStorageTokenToCharacter(payload = {}, { sender } = {}) {
    const tokenUuid = clean(payload.tokenUuid);
    const actorUuid = clean(payload.actorUuid);
    const mutationId = requireMutationId(payload.mutationId);
    const mutationKey = storageMutationId({
      tokenUuid,
      kind: "token-character",
      identity: actorUuid,
      destination: "character",
      mutationId
    });
    return this.#runMutation([`${tokenUuid}:storage`, `${actorUuid}:actor`], mutationKey, async () => {
      const access = await this.#resolveAccess({
        tokenUuid,
        characterTokenUuid: clean(payload.characterTokenUuid)
      }, sender);
      const actor = await this.#resolveCharacterTarget({ actorUuid }, sender);
      const source = await this.resolveDepositSource({ kind: "storage-token", tokenUuid }, {
        fromUuid: this.resolveDocument,
        resolveToken: this.resolveToken,
        storageService: this.storageService,
        containerItemService: this.containerItemService
      });
      if (!source?.row || typeof source.consume !== "function" || typeof source.restore !== "function") {
        throw new Error("Переносимое хранилище недоступно.");
      }
      if (source.canUserMove?.(sender) !== true) {
        throw new Error("У вас нет прав владельца на перемещение этого хранилища.");
      }
      if (source.row.container && !this.containerItemService?.materializeToActorOnce) {
        throw new Error("Сервис переносимых контейнеров Rebreya недоступен.");
      }
      let receipt = null;
      try {
        const transferQuantity = Number(source.available);
        if (!Number.isSafeInteger(transferQuantity) || transferQuantity < 1) {
          throw new Error("Переносимый предмет уже недоступен.");
        }
        receipt = await source.consume(transferQuantity);
        const item = source.row.container
          ? await this.containerItemService.materializeToActorOnce(
              actor,
              source.row.container,
              mutationKey
            )
          : await this.inventoryService.addLootgenRowToCharacterOnce(
              source.row,
              actor,
              mutationKey
            );
        return {
          changed: true,
          actorUuid: clean(actor.uuid),
          itemUuid: clean(
            item?.uuid
            ?? actor?.items?.get?.(clean(item?.itemId))?.uuid
            ?? item?.itemId
            ?? item?.id
          ),
          containerId: clean(source.row.container?.containerId)
        };
      }
      catch (error) {
        if (receipt) {
          try { await source.restore(receipt); }
          catch (rollbackError) {
            throw new AggregateError([error, rollbackError], "Не удалось откатить перенос хранилища персонажу.");
          }
        }
        throw error;
      }
    });
  }

  async dropItemToScene(payload = {}, { sender } = {}) {
    const itemUuid = clean(payload.itemUuid);
    const mutationId = requireMutationId(payload.mutationId);
    const sceneIdValue = clean(payload.sceneId);
    const mutationKey = storageMutationId({
      tokenUuid: itemUuid,
      kind: "item-scene",
      destination: sceneIdValue,
      mutationId
    });
    return this.#runMutation([`${itemUuid}:item`, `${sceneIdValue}:scene`], mutationKey, async () => {
      const source = await this.resolveDepositSource({ kind: "item", itemUuid }, {
        fromUuid: this.resolveDocument,
        resolveToken: this.resolveToken,
        storageService: this.storageService,
        containerItemService: this.containerItemService
      });
      if (!source || typeof source.consume !== "function" || typeof source.restore !== "function") {
        throw new Error("Источник предмета для сцены недоступен.");
      }
      if (source.kind === "coin-template") {
        throw new Error("Managed Item монет нельзя выгружать как обычную строку наземной кучи.");
      }
      const quantity = Number(payload.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > Number(source.available)) {
        throw new Error(`Количество должно быть целым числом от 1 до ${source.available}.`);
      }
      if (source.mode === "move" && source.canUserMove?.(sender) !== true) {
        throw new Error("У вас нет прав владельца на перемещение этого предмета.");
      }
      if (sender?.isGM !== true) {
        const characterToken = tokenDocument(await this.resolveToken(clean(payload.characterTokenUuid)));
        if (!characterToken || sceneId(characterToken) !== sceneIdValue) {
          throw new Error("Персонаж и место выгрузки предмета должны находиться на одной сцене.");
        }
        const distance = Number(await this.measurePointDistance(characterToken, {
          sceneId: sceneIdValue,
          x: Number(payload.x),
          y: Number(payload.y)
        }));
        if (!Number.isFinite(distance) || distance > MAX_STORAGE_DISTANCE_FEET) {
          throw new Error("Предмет можно положить на землю только в пределах 5 футов от персонажа.");
        }
      }

      const groundRow = clone(source.row);
      if (groundRow) {
        groundRow.quantity = quantity;
        groundRow.itemData ??= {};
        groundRow.itemData.system ??= {};
        groundRow.itemData.system.quantity = quantity;
      }
      const preparedGroundRow = await this.#prepareGroundRow(groundRow, {
        sourceItem: source.item,
        sourceKind: source.kind
      });
      let receipt = null;
      try {
        receipt = await source.consume(quantity);
        if (source.kind === "storage-item") {
          if (!this.containerItemService?.restoreSnapshotToScene) {
            throw new Error("Сервис контейнеров Rebreya недоступен.");
          }
          const snapshot = source.row?.container;
          const created = await this.containerItemService.restoreSnapshotToScene(snapshot, {
            sceneId: sceneIdValue,
            x: Number(payload.x),
            y: Number(payload.y),
            mutationId: mutationKey,
            ownerUserId: clean(sender?.id)
          });
          return {
            changed: true,
            tokenUuid: clean(created?.uuid ?? created?.id),
            containerId: clean(snapshot?.containerId)
          };
        }
        if (!this.groundPileService?.transferToScene) {
          throw new Error("Сервис наземных куч Rebreya недоступен.");
        }
        const created = await this.groundPileService.transferToScene({
          row: preparedGroundRow,
          quantity,
          sceneId: sceneIdValue,
          x: Number(payload.x),
          y: Number(payload.y),
          mutationId: mutationKey,
          ownerUserId: clean(sender?.id)
        });
        return { changed: true, ...created };
      }
      catch (error) {
        if (receipt) {
          try {
            await source.restore(receipt);
          }
          catch (rollbackError) {
            throw new AggregateError([error, rollbackError], "Не удалось откатить выгрузку предмета на сцену.");
          }
        }
        throw error;
      }
    });
  }

  async dropCoinsToScene(payload = {}, { sender } = {}) {
    if (!isValidStorageCoinDropPayload(payload)) {
      throw new Error("Некорректная команда переноса монет на сцену.");
    }
    if (typeof this.groundPileService?.findProcessedMutationAtPoint !== "function"
      || typeof this.groundPileService?.transferCoinsToScene !== "function") {
      throw new Error("Сервис наземных куч Rebreya недоступен.");
    }

    const itemUuid = payload.itemUuid;
    const denomination = payload.denomination;
    const sceneIdValue = payload.sceneId;
    const quantity = payload.quantity;
    const mutationKey = storageMutationId({
      tokenUuid: itemUuid,
      kind: "coin-scene",
      identity: denomination,
      destination: sceneIdValue,
      mutationId: payload.mutationId
    });
    const pointRequest = {
      sceneId: sceneIdValue,
      x: payload.x,
      y: payload.y,
      mutationId: mutationKey
    };
    const alreadyProcessed = this.groundPileService.findProcessedMutationAtPoint(pointRequest);
    if (alreadyProcessed) return { changed: false, ...alreadyProcessed };

    return this.#runMutation([`${itemUuid}:item`, `${sceneIdValue}:scene`], mutationKey, async () => {
      const queuedDuplicate = this.groundPileService.findProcessedMutationAtPoint(pointRequest);
      if (queuedDuplicate) return { changed: false, ...queuedDuplicate };

      const source = await this.resolveDepositSource({ kind: "item", itemUuid }, {
        fromUuid: this.resolveDocument,
        resolveToken: this.resolveToken,
        storageService: this.storageService,
        containerItemService: this.containerItemService
      });
      if (!source || source.kind !== "coin-template"
        || typeof source.consume !== "function" || typeof source.restore !== "function") {
        throw new Error("Источник не является managed Item монет Rebreya.");
      }
      if (source.denomination !== denomination) {
        throw new Error("Номинал managed Item монет изменился; повторите перенос.");
      }
      if (source.mode === "move") {
        if (!Number.isSafeInteger(source.available) || source.available < 1 || quantity > source.available) {
          throw new Error(`Количество должно быть целым числом от 1 до ${source.available}.`);
        }
        if (source.canUserMove?.(sender) !== true) {
          throw new Error("У вас нет прав владельца на перемещение этих монет.");
        }
      }
      else if (source.mode !== "copy" || source.available !== null) {
        throw new Error("Источник managed Item монет имеет недопустимый режим.");
      }

      if (sender?.isGM !== true) {
        const characterToken = tokenDocument(await this.resolveToken(payload.characterTokenUuid));
        const character = characterToken?.actor ?? null;
        if (!characterToken || character?.type !== "character"
          || character.testUserPermission?.(sender, "OWNER") !== true) {
          throw new Error("Выберите принадлежащего вам персонажа для переноса монет.");
        }
        if (sceneId(characterToken) !== sceneIdValue) {
          throw new Error("Персонаж и место выгрузки монет должны находиться на одной сцене.");
        }
        const distance = Number(await this.measurePointDistance(characterToken, {
          sceneId: sceneIdValue,
          x: payload.x,
          y: payload.y
        }));
        if (!Number.isFinite(distance) || distance > MAX_STORAGE_DISTANCE_FEET) {
          throw new Error("Монеты можно положить на землю только в пределах 5 футов от персонажа.");
        }
      }

      let receipt = null;
      try {
        if (source.mode === "move") receipt = await source.consume(quantity);
        const created = await this.groundPileService.transferCoinsToScene({
          coins: { [denomination]: quantity },
          sceneId: sceneIdValue,
          x: payload.x,
          y: payload.y,
          mutationId: mutationKey,
          ownerUserId: clean(sender?.id)
        });
        if (created?.duplicate === true && receipt) {
          await source.restore(receipt);
          receipt = null;
        }
        return { changed: created?.duplicate !== true, ...created };
      }
      catch (error) {
        if (receipt) {
          try {
            await source.restore(receipt);
          }
          catch (rollbackError) {
            throw new AggregateError([error, rollbackError], "Не удалось откатить выгрузку монет на сцену.");
          }
        }
        throw error;
      }
    });
  }
}
