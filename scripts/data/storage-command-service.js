import {
  isStorageActor,
  readStorageCoinDenomination,
  readStorageState,
  readStorageStateAtPath
} from "./storage-service.js?v=1.4.152-dead-npc-looting";
import { resolveStorageDepositSource } from "./storage-deposit-source.js?v=1.4.144-spreadsheet-coins-ground-repair";
import { isStorageContainerRow, isStorageJournalRow } from "./storage-container-snapshot.js";
import { MODULE_ID } from "../constants.js";
import { escapeFoundryHtml } from "../shared/foundry-values.js";
import { isCorpseStorageTarget } from "./storage-corpse-target.js?v=1.4.195-storage-corpse-target";
import {
  MAX_STORAGE_DISTANCE_FEET,
  STORAGE_ACCESS_DISTANCE_ERROR_CODE,
  STORAGE_ACCESS_DISTANCE_ERROR_MESSAGE
} from "./storage-access.js?v=1.4.158-storage-access-cache";
import { isValidSerializedInventoryIngressPlan } from "../application/inventory-ingress-planner.js";
import { STORAGE_TRIGGER_EVENTS } from "./storage-trigger-service.js";

const STORAGE_ROW_DESTINATIONS = new Set(["self", "party", "character", "scene"]);
const STORAGE_COIN_DESTINATIONS = new Set(["self", "party"]);
const STORAGE_COIN_DENOMINATIONS = new Set(["pp", "gp", "sp", "cp"]);
const STORAGE_COIN_LABELS = Object.freeze({ pp: "пм", gp: "зм", sp: "см", cp: "мм" });
const MAX_MUTATION_FINGERPRINTS = 1000;

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

function storageQueueKey(tokenUuid) {
  return `${clean(tokenUuid)}:storage`;
}

function canonicalRequestValue(value) {
  if (Array.isArray(value)) return value.map(canonicalRequestValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      canonicalRequestValue(value[key])
    ]));
  }
  return value;
}

function mutationRequestFingerprint(payload, sender) {
  const request = {
    ...(clone(payload) ?? {}),
    path: storagePath(payload?.path)
  };
  return JSON.stringify(canonicalRequestValue({
    request,
    senderId: clean(sender?.id)
  }));
}

function isValidStorageDepositSource(source) {
  if (hasExactKeys(source, ["documentName", "kind", "sourceUuid"])) {
    return source.kind === "journal"
      && ["JournalEntry", "JournalEntryPage"].includes(source.documentName)
      && isTrimmedString(source.sourceUuid, { required: true });
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
  if (destination === "self") return target === null;
  if (destination === "party") {
    return hasExactKeys(target, ["folderId", "groupActorId"])
      && isTrimmedString(target.groupActorId, { required: true, max: 160 })
      && (target.folderId === null
        || isTrimmedString(target.folderId, { required: true, max: 160 }));
  }
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

function isValidStorageIngressPlan(destination, target, ingressPlan, { rowId = "", quantity = null } = {}) {
  if (destination !== "party") return ingressPlan === null;
  if (!isValidSerializedInventoryIngressPlan(ingressPlan)
    || ingressPlan.groupActorId !== target?.groupActorId
    || ingressPlan.requestedFolderId !== target?.folderId) {
    return false;
  }
  if (!rowId) return true;
  return ingressPlan.rows.length === 1
    && ingressPlan.rows[0].sourceKey === rowId
    && (quantity === null || ingressPlan.rows[0].quantity === quantity);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function isValidStorageOpenPayload(payload) {
  return hasLegacyOrPathKeys(payload, ["characterTokenUuid", "mutationId", "tokenUuid"])
    && isTrimmedString(payload.tokenUuid, { required: true })
    && isTrimmedString(payload.characterTokenUuid)
    && isTrimmedString(payload.mutationId, { required: true, max: 160 });
}

function isValidStorageTriggerDefinitions(value) {
  if (!hasExactKeys(value, ["chainsByEvent"])
    || !hasExactKeys(value.chainsByEvent, [...STORAGE_TRIGGER_EVENTS].sort())) {
    return false;
  }
  if (!STORAGE_TRIGGER_EVENTS.every((event) => (
    Array.isArray(value.chainsByEvent[event]) && value.chainsByEvent[event].length <= 100
  ))) return false;
  try {
    return JSON.stringify(value).length <= 500_000;
  }
  catch (_error) {
    return false;
  }
}

export function isValidStorageTriggerReadPayload(payload) {
  return hasLegacyOrPathKeys(payload, ["tokenUuid"])
    && isTrimmedString(payload.tokenUuid, { required: true });
}

export function isValidStorageTriggerSavePayload(payload) {
  return hasLegacyOrPathKeys(payload, ["definitions", "expectedRevision", "operationId", "tokenUuid"])
    && isTrimmedString(payload.tokenUuid, { required: true })
    && isTrimmedString(payload.operationId, { required: true, max: 160 })
    && Number.isSafeInteger(payload.expectedRevision)
    && payload.expectedRevision >= 0
    && isValidStorageTriggerDefinitions(payload.definitions);
}

export function isValidStorageTriggerResetPayload(payload) {
  return hasLegacyOrPathKeys(payload, ["operationId", "tokenUuid"])
    && isTrimmedString(payload.tokenUuid, { required: true })
    && isTrimmedString(payload.operationId, { required: true, max: 160 });
}

export function isValidStorageJournalReadPayload(payload) {
  return hasLegacyOrPathKeys(payload, ["characterTokenUuid", "rowId", "tokenUuid"])
    && isTrimmedString(payload.tokenUuid, { required: true })
    && isTrimmedString(payload.characterTokenUuid)
    && isTrimmedString(payload.rowId, { required: true, max: 160 });
}

export function isValidStorageClaimRowPayload(payload) {
  return hasLegacyOrPathKeys(payload, [
    "characterTokenUuid", "destination", "ingressPlan", "mutationId", "quantity", "rowId", "target", "tokenUuid"
  ])
    && isTrimmedString(payload.tokenUuid, { required: true })
    && isTrimmedString(payload.characterTokenUuid, { required: payload.destination === "self" })
    && isTrimmedString(payload.rowId, { required: true, max: 160 })
    && STORAGE_ROW_DESTINATIONS.has(payload.destination)
    && isValidStorageTarget(payload.destination, payload.target)
    && isValidStorageIngressPlan(payload.destination, payload.target, payload.ingressPlan, {
      rowId: payload.rowId,
      quantity: payload.quantity
    })
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

export function isValidStorageClaimAllPayload(payload) {
  return hasLegacyOrPathKeys(payload, [
    "characterTokenUuid", "destination", "ingressPlan", "mutationId", "target", "tokenUuid"
  ])
    && isTrimmedString(payload.tokenUuid, { required: true })
    && isTrimmedString(payload.characterTokenUuid, { required: payload.destination === "self" })
    && STORAGE_COIN_DESTINATIONS.has(payload.destination)
    && isValidStorageTarget(payload.destination, payload.target)
    && isValidStorageIngressPlan(payload.destination, payload.target, payload.ingressPlan)
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

export function isValidStorageJournalDropPayload(payload) {
  return hasExactKeys(payload, ["documentName", "mutationId", "sceneId", "sourceUuid", "x", "y"])
    && ["JournalEntry", "JournalEntryPage"].includes(payload.documentName)
    && isTrimmedString(payload.sourceUuid, { required: true })
    && isTrimmedString(payload.mutationId, { required: true, max: 160 })
    && isTrimmedString(payload.sceneId, { required: true, max: 160 })
    && Number.isFinite(payload.x)
    && Number.isFinite(payload.y);
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

function journalSceneMutationKey(mutationId) {
  return ["storage", "journal-scene", requireMutationId(mutationId)].join(":");
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
    triggerService = null,
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
    this.triggerService = triggerService && typeof triggerService.execute === "function"
      ? triggerService
      : { async execute() { return { allowed: true, completedChainIds: [] }; } };
    this.journalReader = journalReader;
    this.isVisibleTo = isVisibleTo;
    this.resolveDocument = resolveDocument;
    this.resolveDepositSource = resolveDepositSource;
    this.createChatMessage = typeof createChatMessage === "function" ? createChatMessage : null;
    this.logger = logger;
    this.claimTasks = new Map();
    this.claimQueues = new Map();
    this.claimResults = new Map();
    this.claimFingerprints = new Map();
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

  async #resolvePartyTarget(target) {
    const partyTarget = Object.freeze({
      groupActorId: clean(target?.groupActorId),
      folderId: target?.folderId === null ? null : clean(target?.folderId)
    });
    if (!isValidStorageTarget("party", partyTarget)) {
      throw new Error("Некорректная цель переноса из хранилища.");
    }
    const actor = await this.inventoryService.getInventoryActor({
      create: false,
      groupActorId: partyTarget.groupActorId
    });
    if (!actor || clean(actor.id) !== partyTarget.groupActorId || actor.type !== "group") {
      throw new Error("Party inventory group target is unavailable.");
    }
    if (partyTarget.folderId !== null) {
      const snapshot = await this.inventoryService.getInventorySnapshot({
        createActor: false,
        groupActorId: partyTarget.groupActorId
      });
      if (!snapshot?.folders?.some((folder) => clean(folder?.id) === partyTarget.folderId)) {
        throw new Error("Party inventory folder is unavailable.");
      }
    }
    return { actor, target: partyTarget };
  }

  async #validateSceneTarget(target, access, sender) {
    const targetSceneId = clean(target?.sceneId);
    if (!targetSceneId || targetSceneId !== sceneId(access.storageToken)) {
      throw new Error("Предмет можно положить только на сцену с открытым хранилищем.");
    }
    if (sender?.isGM !== true) {
      const distance = Number(await this.measurePointDistance(access.characterToken, target));
      if (!Number.isFinite(distance) || distance > MAX_STORAGE_DISTANCE_FEET) {
        throw new Error("Предмет можно положить на землю только в пределах 10 футов от персонажа.");
      }
    }
    if (!this.groundPileService?.transferToScene) {
      throw new Error("Сервис наземных куч Rebreya недоступен.");
    }
  }

  async #refreshSource(storageToken, state) {
    return await this.groundPileService?.refreshAfterStorageMutation?.(storageToken, state)
      ?? { deleted: false, state };
  }

  #inventoryIngressRow(row, rowId, quantity, legacyFolderId) {
    return {
      sourceKey: clean(rowId),
      quantity,
      itemData: clone(row?.itemData ?? {}),
      legacyFolderId: legacyFolderId === null ? null : clean(legacyFolderId),
      container: isStorageContainerRow(row) ? clone(row.container) : null
    };
  }

  async #commitPartyIngress({
    actor,
    target,
    storageToken,
    path,
    mutationKey,
    ingressPlan,
    rows
  }) {
    const sourceClaims = new Map();
    const result = await this.inventoryService.commitInventoryIngressBatch({
      groupActorId: target.groupActorId,
      batchMutationId: mutationKey,
      sourceOrigin: "storage",
      serializedPlan: clone(ingressPlan)
    }, {
      resolveRows: async ({ recovering = false } = {}) => {
        const liveState = readStorageStateAtPath(storageToken, path);
        const liveRows = [...liveState.manualRows, ...liveState.generatedRows];
        const liveById = new Map(liveRows.map((row, index) => [rowIdentity(row, index), row]));
        for (const row of rows) {
          const liveRow = liveById.get(row.sourceKey);
          if (!liveRow) throw new Error(`Предмет хранилища '${row.sourceKey}' больше недоступен.`);
          const available = Math.max(1, Math.trunc(Number(
            liveRow.quantity ?? liveRow.itemData?.system?.quantity ?? 1
          )) || 1);
          if (!recovering && (liveState.claimedRowIds.includes(row.sourceKey) || available < row.quantity)) {
            throw new Error(`Предмет хранилища '${row.sourceKey}' больше недоступен.`);
          }
        }
        return clone(rows);
      },
      debitRow: async (row, receipt = {}) => {
        const claim = await this.storageService.claim(storageToken, {
          kind: "row",
          rowId: row.sourceKey,
          quantity: row.quantity,
          mutationId: `${mutationKey}:source:${clean(receipt.sourceKey) || row.sourceKey}`,
          path
        });
        sourceClaims.set(row.sourceKey, claim);
      },
      grantContainer: async ({ container, mutationId }) => {
        if (!this.containerItemService?.materializeToActorOnce) {
          throw new Error("Сервис переносимых контейнеров Rebreya недоступен.");
        }
        return this.containerItemService.materializeToActorOnce(actor, container, mutationId);
      }
    });
    return { result, sourceClaims };
  }

  #filterReceiptSuffix(filterOutcome) {
    if (filterOutcome?.type === "folder") {
      const folderName = escapeFoundryHtml(clean(filterOutcome.folderName) || "папка");
      return `Отфильтровано в папку «${folderName}».`;
    }
    if (filterOutcome?.type === "dismantle") {
      const outputs = (filterOutcome.outputs ?? [])
        .map((output) => {
          const name = escapeFoundryHtml(clean(output?.name) || clean(output?.sourceId) || "Материал");
          const quantity = Number(output?.quantity);
          return Number.isFinite(quantity) && quantity > 0 ? `${name} x${quantity}` : "";
        })
        .filter(Boolean)
        .join(", ");
      return outputs ? `Отфильтровано: разобрано на ${outputs}.` : "";
    }
    if (filterOutcome?.type === "root") {
      return "Фильтрация пропущена; добавлено в корень.";
    }
    return "";
  }

  async #publishClaimMessage({
    destination,
    actor = null,
    characterToken = null,
    row = null,
    quantity = null,
    coins = null,
    filterOutcome = null
  } = {}) {
    if (!this.createChatMessage || !["self", "party"].includes(destination)) return false;
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
    const suffix = this.#filterReceiptSuffix(filterOutcome);
    try {
      await this.createChatMessage({
        speaker: this.#characterSpeaker(actor, characterToken),
        content: `<p>Перемещает <strong>${subject}</strong> в ${destinationLabel}.${suffix ? `<br>${suffix}` : ""}</p>`
      });
      return true;
    }
    catch (error) {
      this.logger?.warn?.(`${MODULE_ID} | Storage claim ChatMessage creation failed.`, error);
      return false;
    }
  }

  #characterSpeaker(actor, token) {
    const speaker = { alias: clean(actor?.name) || "Персонаж" };
    const actorId = clean(actor?.id);
    const tokenId = clean(tokenDocument(token)?.id);
    const tokenSceneId = sceneId(token);
    if (actorId) speaker.actor = actorId;
    if (tokenSceneId) speaker.scene = tokenSceneId;
    if (tokenId) speaker.token = tokenId;
    return speaker;
  }

  async #publishOpenTriggerMessage({ actor, characterToken, storageToken, state, itemNames } = {}) {
    if (!this.createChatMessage) return false;
    const names = Array.from(new Set(
      (Array.isArray(itemNames) ? itemNames : []).map(clean).filter(Boolean)
    ));
    if (names.length === 0) return false;
    const itemLabel = names.map((name) => `«${escapeFoundryHtml(name)}»`).join(", ");
    const storageName = escapeFoundryHtml(
      clean(state?.baseName) || clean(storageToken?.name) || clean(storageToken?.actor?.name) || "хранилище"
    );
    try {
      await this.createChatMessage({
        speaker: this.#characterSpeaker(actor, characterToken),
        content: `<p>Использует <strong>${itemLabel}</strong> и открывает <strong>«${storageName}»</strong>.</p>`
      });
      return true;
    }
    catch (error) {
      this.logger?.warn?.(`${MODULE_ID} | Storage open ChatMessage creation failed.`, error);
      return false;
    }
  }

  async #publishJournalReadMessage({ sender, row } = {}) {
    if (!this.createChatMessage) return false;
    const readerName = escapeFoundryHtml(clean(sender?.name) || "Игрок");
    const journalName = escapeFoundryHtml(clean(row?.name) || "Запись");
    try {
      await this.createChatMessage({
        content: `<p><strong>${readerName}</strong> прочитал запись «<strong>${journalName}</strong>».</p>`
      });
      return true;
    }
    catch (error) {
      this.logger?.warn?.(`${MODULE_ID} | Storage Journal read ChatMessage creation failed.`, error);
      return false;
    }
  }

  async #resolveAccess(payload, sender) {
    const tokenUuid = clean(payload?.tokenUuid);
    const storageToken = tokenDocument(await this.resolveToken(tokenUuid));
    if (!storageToken || (!isStorageActor(storageToken.actor) && !isCorpseStorageTarget(storageToken))) {
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
        const error = new Error(STORAGE_ACCESS_DISTANCE_ERROR_MESSAGE);
        error.code = STORAGE_ACCESS_DISTANCE_ERROR_CODE;
        throw error;
      }
    }

    return { storageToken, characterToken, character };
  }

  #triggerContext(event, payload, sender, access, extra = {}) {
    const path = storagePath(payload?.path);
    const mutationId = clean(payload?.mutationId)
      || `open-${clean(payload?.tokenUuid)}-${clean(sender?.id)}-${Date.now()}-${Math.random()}`;
    const claimSummary = clone(extra.claimSummary ?? null);
    return {
      event,
      runId: `${mutationId}:${event}`,
      fingerprint: JSON.stringify(canonicalRequestValue({
        event,
        payload: clone(payload),
        senderId: clean(sender?.id),
        characterActorUuid: clean(access?.character?.uuid),
        claimSummary
      })),
      storageToken: access.storageToken,
      tokenUuid: clean(payload?.tokenUuid),
      path,
      senderId: clean(sender?.id),
      characterActorUuid: clean(access?.character?.uuid),
      claimSummary
    };
  }

  async #executeTrigger(event, payload, sender, access, extra = {}) {
    const path = storagePath(payload?.path);
    const state = readStorageStateAtPath(access.storageToken, path);
    return this.triggerService.execute(
      event,
      state.triggers,
      this.#triggerContext(event, payload, sender, access, extra)
    );
  }

  async #executePostTrigger(event, payload, sender, access, extra = {}) {
    try {
      return await this.#executeTrigger(event, payload, sender, access, extra);
    }
    catch (error) {
      this.logger?.warn?.(`${MODULE_ID} | Storage ${event} trigger failed after commit.`, error);
      return null;
    }
  }

  async #executeCommittedClaimTriggers(payload, sender, access, beforeState, claimSummary) {
    await this.#executePostTrigger("afterClaim", payload, sender, access, { claimSummary });
    const finalState = readStorageStateAtPath(access.storageToken, storagePath(payload.path));
    if (beforeState?.state !== "empty" && finalState.state === "empty") {
      await this.#executePostTrigger("emptied", payload, sender, access, { claimSummary });
    }
  }

  #assertMutationFingerprint(mutationKey, fingerprint) {
    if (!fingerprint) return;
    const existing = this.claimFingerprints.get(mutationKey);
    if (existing !== undefined && existing !== fingerprint) {
      throw new Error("Один mutationId нельзя повторно использовать с другими параметрами операции.");
    }
    if (existing === undefined) {
      this.claimFingerprints.set(mutationKey, fingerprint);
    }
  }

  #pruneMutationCaches() {
    while (this.claimFingerprints.size > MAX_MUTATION_FINGERPRINTS) {
      const evictableKey = Array.from(this.claimFingerprints.keys())
        .find((key) => !this.claimTasks.has(key));
      if (!evictableKey) return;
      this.claimFingerprints.delete(evictableKey);
      this.claimResults.delete(evictableKey);
    }
  }

  async #runMutation(queueKeys, mutationKey, operation, { fingerprint = "", authorize = null } = {}) {
    this.#assertMutationFingerprint(mutationKey, fingerprint);
    if (this.claimResults.has(mutationKey)) {
      const result = this.claimResults.get(mutationKey);
      await authorize?.({ cachedResult: result });
      return result;
    }
    const existing = this.claimTasks.get(mutationKey);
    if (existing) {
      await authorize?.({ inFlight: true });
      return existing;
    }

    let operationScheduled = false;
    const task = Promise.resolve()
      .then(() => authorize?.({}))
      .then(() => {
        operationScheduled = true;
        return this.#enqueue(queueKeys, operation);
      })
      .then((result) => {
        this.claimResults.set(mutationKey, result);
        if (this.claimResults.size > 500) {
          const oldestKey = this.claimResults.keys().next().value;
          this.claimResults.delete(oldestKey);
          if (!this.claimTasks.has(oldestKey)) this.claimFingerprints.delete(oldestKey);
        }
        return result;
      }).catch((error) => {
        if ((!operationScheduled || error?.code === "STORAGE_MUTATION_CONFLICT")
          && this.claimFingerprints.get(mutationKey) === fingerprint) {
          this.claimFingerprints.delete(mutationKey);
        }
        throw error;
      }).finally(() => {
        this.claimTasks.delete(mutationKey);
        this.#pruneMutationCaches();
      });
    this.claimTasks.set(mutationKey, task);
    this.#pruneMutationCaches();
    return task;
  }

  async #enqueue(queueKeys, operation) {
    const keys = Array.from(new Set((Array.isArray(queueKeys) ? queueKeys : [queueKeys])
      .map(clean)
      .filter(Boolean))).sort();
    const previous = Promise.all(keys.map((key) => (
      this.claimQueues.get(key)?.catch(() => {}) ?? Promise.resolve()
    )));
    const queued = previous.then(operation);
    for (const key of keys) this.claimQueues.set(key, queued);
    return queued.finally(() => {
      for (const key of keys) {
        if (this.claimQueues.get(key) === queued) this.claimQueues.delete(key);
      }
    });
  }

  async #runClaim(sourceKey, mutationKey, operation, options = {}) {
    return this.#runMutation([sourceKey], mutationKey, operation, options);
  }

  async #resolveTriggerAdmin(payload, sender) {
    if (sender?.isGM !== true) throw new Error("Настраивать триггеры может только мастер.");
    const tokenUuid = clean(payload?.tokenUuid);
    const storageToken = tokenDocument(await this.resolveToken(tokenUuid));
    if (!storageToken || (!isStorageActor(storageToken.actor) && !isDeadNpcStorageTarget(storageToken))) {
      throw new Error("Токен не является хранилищем Rebreya.");
    }
    const path = storagePath(payload?.path);
    readStorageStateAtPath(storageToken, path);
    return { storageToken, path };
  }

  async readTriggers(payload = {}, { sender } = {}) {
    const tokenUuid = clean(payload.tokenUuid);
    return this.#enqueue([storageQueueKey(tokenUuid)], async () => {
      const { storageToken, path } = await this.#resolveTriggerAdmin(payload, sender);
      return {
        tokenUuid,
        path: clone(path),
        triggers: clone(readStorageStateAtPath(storageToken, path).triggers)
      };
    });
  }

  async saveTriggers(payload = {}, { sender } = {}) {
    const tokenUuid = clean(payload.tokenUuid);
    const operationId = clean(payload.operationId);
    const mutationKey = `storage:triggers:save:${operationId}`;
    const fingerprint = mutationRequestFingerprint(payload, sender);
    return this.#runMutation([storageQueueKey(tokenUuid)], mutationKey, async () => {
      const { storageToken, path } = await this.#resolveTriggerAdmin(payload, sender);
      const state = await this.storageService.saveTriggerDefinitions(
        storageToken,
        payload.definitions,
        payload.expectedRevision,
        { path }
      );
      return { tokenUuid, path: clone(path), triggers: clone(state.triggers) };
    }, {
      fingerprint,
      authorize: () => this.#resolveTriggerAdmin(payload, sender)
    });
  }

  async resetTriggers(payload = {}, { sender } = {}) {
    const tokenUuid = clean(payload.tokenUuid);
    const operationId = clean(payload.operationId);
    const mutationKey = `storage:triggers:reset:${operationId}`;
    const fingerprint = mutationRequestFingerprint(payload, sender);
    return this.#runMutation([storageQueueKey(tokenUuid)], mutationKey, async () => {
      const { storageToken, path } = await this.#resolveTriggerAdmin(payload, sender);
      const state = await this.storageService.resetTriggerExecutions(storageToken, { path });
      return { tokenUuid, path: clone(path), triggers: clone(state.triggers) };
    }, {
      fingerprint,
      authorize: () => this.#resolveTriggerAdmin(payload, sender)
    });
  }

  async open(payload = {}, { sender } = {}) {
    const tokenUuid = clean(payload.tokenUuid);
    return this.#enqueue([storageQueueKey(tokenUuid)], async () => {
      const access = await this.#resolveAccess(payload, sender);
      const beforeState = readStorageStateAtPath(access.storageToken, storagePath(payload.path));
      const beforeOpenRunId = `${clean(payload.mutationId)}:beforeOpen`;
      const triggerRunWasComplete = beforeState.triggers?.executionState?.runs?.[beforeOpenRunId]?.status === "complete";
      const gate = await this.#executeTrigger("beforeOpen", payload, sender, access);
      if (gate?.allowed === false) {
        const error = new Error(clean(gate.message) || "Хранилище не удалось открыть.");
        error.code = "STORAGE_TRIGGER_DENIED";
        throw error;
      }
      const result = await this.storageService.open(access.storageToken, {
        senderId: clean(sender?.id),
        characterTokenUuid: clean(payload.characterTokenUuid),
        path: storagePath(payload.path)
      });
      if (beforeState.state === "unopened" && result?.state?.state !== "unopened") {
        await this.#executePostTrigger("afterOpen", payload, sender, access, {
          claimSummary: {
            generatedNow: result?.generatedNow === true,
            state: clean(result?.state?.state),
            displayMode: clean(result?.state?.displayMode)
          }
        });
      }
      if (!triggerRunWasComplete && Array.isArray(gate?.usedItemNames) && gate.usedItemNames.length > 0) {
        await this.#publishOpenTriggerMessage({
          actor: access.character,
          characterToken: access.characterToken,
          storageToken: access.storageToken,
          state: result?.state,
          itemNames: gate.usedItemNames
        });
      }
      return {
        generatedNow: result?.generatedNow === true,
        state: clean(result?.state?.state) || "opened",
        displayMode: clean(result?.state?.displayMode) || "opened"
      };
    });
  }

  async readJournal(payload = {}, { sender } = {}) {
    const tokenUuid = clean(payload.tokenUuid);
    const path = storagePath(payload.path);
    return this.#enqueue([storageQueueKey(tokenUuid)], async () => {
      const access = await this.#resolveAccess(payload, sender);
      const state = readStorageStateAtPath(access.storageToken, path);
      if (state.state !== "opened") throw new Error("Сначала откройте хранилище.");

      const rowId = clean(payload.rowId);
      const rows = [...state.manualRows, ...state.generatedRows];
      const row = rows.find((entry, index) => rowIdentity(entry, index) === rowId) ?? null;
      if (!row || state.claimedRowIds.includes(rowId)
        || row.rowKind !== "journal" || !isStorageJournalRow(row)) {
        throw new Error("Запись журнала недоступна.");
      }
      const snapshot = await this.journalReader.read(row.sourceId, {
        documentName: clean(row.sourceDocumentName) === "JournalEntryPage"
          ? "JournalEntryPage"
          : "JournalEntry"
      });
      if (sender?.isGM === true) return snapshot;
      const marked = await this.storageService.markJournalRead(access.storageToken, rowId, { path });
      if (marked.changed === true) {
        const rootState = readStorageState(access.storageToken);
        await this.groundPileService?.refreshAfterStorageMutation?.(access.storageToken, rootState);
        await this.#publishJournalReadMessage({ sender, row });
      }
      return snapshot;
    });
  }

  async claimRow(payload = {}, { sender } = {}) {
    const destination = requireDestination(payload.destination);
    const target = clone(payload.target);
    if (destination === "party" && !isValidStorageTarget(destination, target)) {
      throw new Error("Некорректная цель переноса из хранилища.");
    }
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
    const authorize = async ({ cachedResult = null } = {}) => {
      const access = cachedResult?.sourceDeleted === true
        ? null
        : await this.#resolveAccess(payload, sender);
      if (destination === "self" && access?.character?.type !== "character") {
        throw new Error("Для получения лута себе выберите персонажа.");
      }
      if (destination === "party") await this.#resolvePartyTarget(target);
      if (destination === "character") await this.#resolveCharacterTarget(payload.target, sender);
      if (destination === "scene" && access) await this.#validateSceneTarget(payload.target, access, sender);
    };
    return this.#runClaim(storageQueueKey(tokenUuid), mutationKey, async () => {
      const access = await this.#resolveAccess(payload, sender);
      if (destination === "self" && access.character?.type !== "character") {
        throw new Error("Для получения лута себе выберите персонажа.");
      }
      const state = readStorageStateAtPath(access.storageToken, path);
      if (state.state === "unopened") throw new Error("Сначала откройте хранилище.");
      const rows = [...state.manualRows, ...state.generatedRows];
      const row = rows.find((entry, index) => rowIdentity(entry, index) === rowId) ?? null;
      const plannedRow = payload.ingressPlan?.rows?.find((entry) => entry.sourceKey === rowId) ?? null;
      const claimedForRecovery = destination === "party"
        && state.claimedRowIds.includes(rowId)
        && plannedRow;
      if (!row || (state.claimedRowIds.includes(rowId) && !claimedForRecovery)) {
        const refresh = await this.#refreshSource(access.storageToken, readStorageState(access.storageToken));
        return { changed: false, row: null, state, sourceDeleted: refresh.deleted === true };
      }
      if (isStorageJournalRow(row)) {
        throw new Error("Ссылку на журнал нельзя забрать из хранилища.");
      }
      const available = Math.max(1, Math.trunc(Number(
        row.quantity ?? row.itemData?.system?.quantity ?? 1
      )) || 1);
      const quantity = claimedForRecovery
        ? Number(plannedRow.quantity)
        : payload.quantity === null || payload.quantity === undefined
          ? available
          : Number(payload.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || (!claimedForRecovery && quantity > available)) {
        throw new Error("Количество должно быть целым числом от 1 до доступного остатка.");
      }
      let partyActor = null;
      let partyTarget = null;
      if (destination === "party") {
        ({ actor: partyActor, target: partyTarget } = await this.#resolvePartyTarget(target));
      }
      const transferRow = clone(row);
      transferRow.quantity = quantity;
      transferRow.itemData ??= {};
      transferRow.itemData.system ??= {};
      transferRow.itemData.system.quantity = quantity;
      const preparedTransferRow = await this.#prepareGroundRow(transferRow);
      const grantId = mutationKey;
      let result = null;
      let filterResult = null;
      if (destination === "party") {
        if (isStorageContainerRow(preparedTransferRow) && quantity !== 1) {
          throw new Error("Контейнер можно переносить только целиком.");
        }
        const ingressRow = this.#inventoryIngressRow(
          preparedTransferRow,
          rowId,
          quantity,
          partyTarget.folderId
        );
        const committed = await this.#commitPartyIngress({
          actor: partyActor,
          target: partyTarget,
          storageToken: access.storageToken,
          path,
          mutationKey,
          ingressPlan: payload.ingressPlan,
          rows: [ingressRow]
        });
        filterResult = committed.result.rows[0] ?? null;
        result = committed.sourceClaims.get(rowId) ?? {
          changed: filterResult?.changed === true,
          row: filterResult?.changed === true ? transferRow : null,
          quantity: filterResult?.changed === true ? quantity : undefined,
          state: readStorageStateAtPath(access.storageToken, path)
        };
      }
      else if (isStorageContainerRow(preparedTransferRow)) {
        if (!this.containerItemService) {
          throw new Error("Сервис переносимых контейнеров Rebreya недоступен.");
        }
        if (quantity !== 1) throw new Error("Контейнер можно переносить только целиком.");
        if (destination === "self") {
          await this.containerItemService.materializeToActorOnce(access.character, preparedTransferRow.container, grantId);
        }
        else if (destination === "character") {
          const targetActor = await this.#resolveCharacterTarget(payload.target, sender);
          await this.containerItemService.materializeToActorOnce(targetActor, preparedTransferRow.container, grantId);
        }
        else {
          await this.#validateSceneTarget(payload.target, access, sender);
          if (typeof this.containerItemService.restoreSnapshotToScene !== "function") {
            throw new Error("Сервис восстановления контейнеров на сцене недоступен.");
          }
          await this.containerItemService.restoreSnapshotToScene(preparedTransferRow.container, {
            sceneId: clean(payload.target.sceneId),
            x: Number(payload.target.x),
            y: Number(payload.target.y),
            mutationId: grantId
          });
        }
      }
      else if (destination === "self") {
        await this.inventoryService.addLootgenRowToCharacterOnce(preparedTransferRow, access.character, grantId);
      }
      else if (destination === "character") {
        const targetActor = await this.#resolveCharacterTarget(payload.target, sender);
        await this.inventoryService.addLootgenRowToCharacterOnce(preparedTransferRow, targetActor, grantId);
      }
      else {
        await this.#validateSceneTarget(payload.target, access, sender);
        await this.groundPileService.transferToScene({
          row: preparedTransferRow,
          quantity,
          sceneId: clean(payload.target.sceneId),
          x: Number(payload.target.x),
          y: Number(payload.target.y),
          mutationId: grantId,
          ownerUserId: clean(sender?.id)
        });
      }
      if (destination !== "party") {
        result = await this.storageService.claim(access.storageToken, { kind: "row", rowId, quantity, path });
      }
      if (result.changed === true) {
        await this.#executeCommittedClaimTriggers(payload, sender, access, state, {
          kind: "row",
          rowId,
          quantity,
          destination,
          state: clean(result.state?.state)
        });
      }
      const refresh = await this.#refreshSource(access.storageToken, readStorageState(access.storageToken));
      if (result.changed === true) {
        await this.#publishClaimMessage({
          destination,
          actor: access.character,
          characterToken: access.characterToken,
          row: transferRow,
          quantity,
          filterOutcome: filterResult?.filterOutcome ?? null
        });
      }
      return { ...result, sourceDeleted: refresh.deleted === true };
    }, {
      fingerprint: mutationRequestFingerprint(payload, sender),
      authorize
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
    const authorize = async ({ cachedResult = null } = {}) => {
      const access = cachedResult?.sourceDeleted === true
        ? null
        : await this.#resolveAccess(payload, sender);
      if (destination === "self" && access?.character?.type !== "character") {
        throw new Error("Для получения монет себе выберите персонажа.");
      }
    };
    return this.#runClaim(storageQueueKey(tokenUuid), mutationKey, async () => {
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
        const refresh = await this.#refreshSource(access.storageToken, readStorageState(access.storageToken));
        return { changed: false, coins, state, sourceDeleted: refresh.deleted === true };
      }
      const grantId = mutationKey;
      if (destination === "self") {
        await this.inventoryService.addCurrencyToCharacterOnce(coins, access.character, grantId);
      }
      else {
        await this.inventoryService.addCurrencyToInventoryOnce(coins, grantId);
      }
      const result = await this.storageService.claim(access.storageToken, { kind: "coins", path });
      if (result.changed === true) {
        await this.#executeCommittedClaimTriggers(payload, sender, access, state, {
          kind: "coins",
          coins,
          destination,
          state: clean(result.state?.state)
        });
      }
      const refresh = await this.#refreshSource(access.storageToken, readStorageState(access.storageToken));
      if (result.changed === true) {
        await this.#publishClaimMessage({
          destination,
          actor: access.character,
          characterToken: access.characterToken,
          coins
        });
      }
      return { ...result, sourceDeleted: refresh.deleted === true };
    }, {
      fingerprint: mutationRequestFingerprint(payload, sender),
      authorize
    });
  }

  async claimAll(payload = {}, { sender } = {}) {
    const destination = clean(payload.destination);
    if (!STORAGE_COIN_DESTINATIONS.has(destination)) {
      throw new Error("Всё содержимое можно забрать себе или в инвентарь группы.");
    }
    const target = clone(payload.target);
    if (!isValidStorageTarget(destination, target)) {
      throw new Error("Некорректная цель массового переноса из хранилища.");
    }
    const mutationId = requireMutationId(payload.mutationId);
    const tokenUuid = clean(payload.tokenUuid);
    const path = storagePath(payload.path);
    const mutationKey = storageMutationId({
      tokenUuid,
      path,
      kind: "all",
      destination,
      mutationId
    });
    const fingerprint = mutationRequestFingerprint(payload, sender);
    const authorize = async ({ cachedResult = null } = {}) => {
      const access = cachedResult?.sourceDeleted === true
        ? null
        : await this.#resolveAccess(payload, sender);
      if (destination === "self" && access?.character?.type !== "character") {
        throw new Error("Для получения лута себе выберите персонажа.");
      }
      if (destination === "party") await this.#resolvePartyTarget(target);
    };
    return this.#runClaim(storageQueueKey(tokenUuid), mutationKey, async () => {
      const access = await this.#resolveAccess(payload, sender);
      if (destination === "self" && access.character?.type !== "character") {
        throw new Error("Для получения лута себе выберите персонажа.");
      }
      let partyActor = null;
      let partyTarget = null;
      if (destination === "party") {
        ({ actor: partyActor, target: partyTarget } = await this.#resolvePartyTarget(target));
      }
      const stateBeforeBinding = readStorageStateAtPath(access.storageToken, path);
      if (stateBeforeBinding.state === "unopened") throw new Error("Сначала откройте хранилище.");
      await this.storageService.bindBulkClaimMutation(access.storageToken, mutationKey, fingerprint, { path });
      const initialState = readStorageStateAtPath(access.storageToken, path);
      const claimed = new Set(initialState.claimedRowIds);
      const plannedById = new Map((payload.ingressPlan?.rows ?? []).map((row) => [row.sourceKey, row]));
      const rows = [...initialState.manualRows, ...initialState.generatedRows]
        .map((row, index) => ({ row, rowId: rowIdentity(row, index) }))
        .filter(({ rowId }) => destination === "party" && payload.ingressPlan
          ? plannedById.has(rowId)
          : !claimed.has(rowId));
      const skippedJournalRowIds = rows
        .filter(({ row }) => isStorageJournalRow(row))
        .map(({ rowId }) => rowId);
      const claimedRowIds = [];
      const preparedRows = [];
      const partyReceipts = [];
      for (const { row, rowId } of rows) {
        if (isStorageJournalRow(row)) continue;
        const quantity = destination === "party" && plannedById.has(rowId)
          ? Number(plannedById.get(rowId)?.quantity)
          : Math.max(1, Math.trunc(Number(
            row.quantity ?? row.itemData?.system?.quantity ?? 1
          )) || 1);
        const transferRow = clone(row);
        transferRow.quantity = quantity;
        transferRow.itemData ??= {};
        transferRow.itemData.system ??= {};
        transferRow.itemData.system.quantity = quantity;
        const preparedTransferRow = await this.#prepareGroundRow(transferRow);
        preparedRows.push({ rowId, quantity, transferRow, preparedTransferRow });
      }

      if (destination === "party" && preparedRows.length > 0) {
        const ingressRows = preparedRows.map(({ rowId, quantity, preparedTransferRow }) => (
          this.#inventoryIngressRow(preparedTransferRow, rowId, quantity, partyTarget.folderId)
        ));
        const committed = await this.#commitPartyIngress({
          actor: partyActor,
          target: partyTarget,
          storageToken: access.storageToken,
          path,
          mutationKey,
          ingressPlan: payload.ingressPlan,
          rows: ingressRows
        });
        const transferById = new Map(preparedRows.map((entry) => [entry.rowId, entry]));
        for (const outcome of committed.result.rows) {
          if (outcome.changed !== true) continue;
          const transfer = transferById.get(outcome.sourceKey);
          if (!transfer) continue;
          claimedRowIds.push(outcome.sourceKey);
          partyReceipts.push({
            destination,
            actor: access.character,
            characterToken: access.characterToken,
            row: transfer.transferRow,
            quantity: transfer.quantity,
            filterOutcome: outcome.filterOutcome ?? null
          });
        }
      }
      else if (destination === "self") {
        for (const { rowId, quantity, transferRow, preparedTransferRow } of preparedRows) {
        const grantId = `${mutationKey}:row:${rowId}`;
        if (isStorageContainerRow(preparedTransferRow)) {
          if (!this.containerItemService) {
            throw new Error("Сервис переносимых контейнеров Rebreya недоступен.");
          }
          await this.containerItemService.materializeToActorOnce(
            access.character,
            preparedTransferRow.container,
            grantId
          );
        }
        else {
          await this.inventoryService.addLootgenRowToCharacterOnce(
            preparedTransferRow,
            access.character,
            grantId
          );
        }
        const result = await this.storageService.claim(access.storageToken, {
          kind: "row",
          rowId,
          quantity,
          path
        });
        if (result.changed === true) {
          claimedRowIds.push(rowId);
          await this.#publishClaimMessage({
            destination,
            actor: access.character,
            characterToken: access.characterToken,
            row: transferRow,
            quantity
          });
        }
      }
      }

      const stateBeforeCoins = readStorageStateAtPath(access.storageToken, path);
      const coinKeys = ["pp", "gp", "sp", "cp"];
      const coins = Object.fromEntries(coinKeys.map((key) => [
        key,
        Math.max(0, Math.trunc(
          Number(stateBeforeCoins.manualCoins?.[key] ?? 0)
          + Number(stateBeforeCoins.generatedCoins?.[key] ?? 0)
        ))
      ]));
      let coinsChanged = false;
      if (!stateBeforeCoins.coinsClaimed && coinKeys.some((key) => coins[key] > 0)) {
        const grantId = `${mutationKey}:coins`;
        if (destination === "self") {
          await this.inventoryService.addCurrencyToCharacterOnce(coins, access.character, grantId);
        }
        else {
          await this.inventoryService.addCurrencyToInventoryOnce(
            coins,
            grantId,
            { groupActorId: partyTarget.groupActorId }
          );
        }
        const result = await this.storageService.claim(access.storageToken, { kind: "coins", path });
        coinsChanged = result.changed === true;
        if (coinsChanged) {
          await this.#publishClaimMessage({
            destination,
            actor: access.character,
            characterToken: access.characterToken,
            coins
          });
        }
      }

      const changed = claimedRowIds.length > 0 || coinsChanged;
      await this.storageService.completeBulkClaimMutation(access.storageToken, mutationKey, fingerprint, { path });
      if (changed) {
        const committedState = readStorageStateAtPath(access.storageToken, path);
        await this.#executeCommittedClaimTriggers(payload, sender, access, stateBeforeBinding, {
          kind: "all",
          claimedRowIds: clone(claimedRowIds),
          skippedJournalRowIds: clone(skippedJournalRowIds),
          coinsChanged,
          destination,
          state: clean(committedState.state)
        });
      }
      const refresh = await this.#refreshSource(access.storageToken, readStorageState(access.storageToken));
      const sourceDeleted = refresh.deleted === true;
      for (const receipt of partyReceipts) await this.#publishClaimMessage(receipt);
      const finalState = readStorageStateAtPath(access.storageToken, path);
      return {
        changed,
        claimedRowIds,
        skippedJournalRowIds,
        coinsChanged,
        sourceDeleted,
        state: finalState.state,
        displayMode: finalState.displayMode
      };
    }, {
      fingerprint,
      authorize
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
          ? clean(sourceRef.sourceUuid)
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
      storageQueueKey(tokenUuid),
      ["storage-row", "storage-token"].includes(sourceRef.kind)
        ? `${clean(sourceRef.tokenUuid)}:storage`
        : sourceRef.kind === "journal"
          ? `${clean(sourceRef.sourceUuid)}:journal`
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
          throw new Error("Предмет можно положить на землю только в пределах 10 футов от персонажа.");
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
          throw new Error("Монеты можно положить на землю только в пределах 10 футов от персонажа.");
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

  async dropJournalToScene(payload = {}, { sender } = {}) {
    if (!isValidStorageJournalDropPayload(payload)) {
      throw new Error("Некорректная команда переноса записи журнала на сцену.");
    }
    if (sender?.isGM !== true) {
      throw new Error("Переносить записи журнала на сцену может только мастер.");
    }
    if (typeof this.groundPileService?.findProcessedMutationAtPoint !== "function"
      || typeof this.groundPileService?.transferToScene !== "function") {
      throw new Error("Сервис наземных куч Rebreya недоступен.");
    }

    const mutationKey = journalSceneMutationKey(payload.mutationId);
    const fingerprint = mutationRequestFingerprint(payload, sender);
    const pointRequest = {
      sceneId: payload.sceneId,
      x: payload.x,
      y: payload.y,
      mutationId: mutationKey
    };
    const authorize = async () => {
      if (sender?.isGM !== true) {
        throw new Error("Переносить записи журнала на сцену может только мастер.");
      }
    };

    return this.#runMutation([
      `${payload.sourceUuid}:journal`,
      `${payload.sceneId}:scene`
    ], mutationKey, async () => {
      const duplicate = this.groundPileService.findProcessedMutationAtPoint(pointRequest);
      if (duplicate) {
        return {
          changed: false,
          created: duplicate.created === true,
          merged: duplicate.merged === true,
          duplicate: true
        };
      }

      const source = await this.resolveDepositSource({
        kind: "journal",
        sourceUuid: payload.sourceUuid,
        documentName: payload.documentName
      }, {
        fromUuid: this.resolveDocument,
        resolveToken: this.resolveToken,
        storageService: this.storageService,
        containerItemService: this.containerItemService
      });
      if (!source || source.kind !== "journal" || source.mode !== "copy"
        || source.available !== 1 || source.canUserMove?.(sender) !== true
        || !isStorageJournalRow(source.row)
        || source.row?.rowKind !== "journal"
        || clean(source.row?.sourceType).toLowerCase() !== "journal"
        || clean(source.row?.sourceDocumentName) !== payload.documentName
        || !clean(source.row?.sourceId)
        || !clean(source.row?.rowId)
        || !clean(source.row?.name)
        || source.row?.stackKey !== ""
        || Number(source.row?.quantity) !== 1
        || typeof source.consume !== "function" || typeof source.restore !== "function") {
        throw new Error("Источник записи журнала для сцены недоступен.");
      }

      let receipt = null;
      try {
        receipt = await source.consume(1);
        const created = await this.groundPileService.transferToScene({
          row: clone(source.row),
          quantity: 1,
          sceneId: payload.sceneId,
          x: payload.x,
          y: payload.y,
          mutationId: mutationKey,
          ownerUserId: clean(sender.id)
        });
        return {
          changed: created?.duplicate !== true,
          created: created?.created === true,
          merged: created?.merged === true,
          duplicate: created?.duplicate === true
        };
      }
      catch (error) {
        if (receipt) {
          try {
            await source.restore(receipt);
          }
          catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              "Не удалось откатить выгрузку записи журнала на сцену."
            );
          }
        }
        throw error;
      }
    }, { fingerprint, authorize });
  }
}
