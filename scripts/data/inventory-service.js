import {
  DOWNTIME_ITEM_TYPE,
  ENERGY_BASE_DAYS,
  ENERGY_MIN_DAYS,
  GEAR_COMPENDIUM_NAME,
  MAGIC_ITEMS_COMPENDIUM_NAME,
  MATERIALS_COMPENDIUM_NAME,
  MODULE_ID,
  REBREYA_TOOLS,
  SETTINGS_KEYS
} from "../constants.js";
import {
  GROUP_CONTEXT_ERRORS,
  getGroupMemberActors,
  isManagedPartyGroup,
  normalizeGroupTransportState,
  resolveGroupMemberActor
} from "./group-context-service.js";
import { DurableMutationJournal } from "../application/durable-mutation-journal.js";
import { WorldMutationCoordinator } from "../application/world-mutation-coordinator.js";
import { finiteNumber as toNumber } from "../shared/foundry-values.js";
import { buildDurabilitySignature, isDurabilityEligible } from "./durability-rules.js";
import {
  resolveInventoryDismantleMinimumQuantity,
  resolveInventoryDismantleOutputs
} from "./inventory-ingress-descriptor.js?v=1.4.179-dismantle-minimum-quantity";
import {
  InventoryIngressRuleError,
  findInventoryIngressRuleConflicts,
  normalizeInventoryIngressRule,
  normalizeInventoryIngressRuleState
} from "./inventory-ingress-rules.js";
import { applyLootgenRowDurability } from "./lootgen-durability.js?v=1.4.154-corpse-storage-broken-name";
import { formatDurabilityItemName } from "./durability-item-presentation.js?v=1.4.154-broken-item-name";
import { isJournalRecordItem } from "./journal-record-item.js?v=1.4.217-journal-record-items";
import {
  buildTransportFuelInventorySnapshot,
  normalizeTransportFuelSelector
} from "./transport-fuel-item.js";
import {
  normalizeTransportFuelConsumption,
  resolveTransportFuelConsumption
} from "./transport-fuel-consumption.js";
import {
  INVENTORY_FOLDER_STATE_VERSION,
  InventoryFolderStateError,
  createInventoryFolder as createInventoryFolderState,
  deleteInventoryFolder as deleteInventoryFolderState,
  moveInventoryFolder as moveInventoryFolderState,
  moveInventoryItemToFolder as moveInventoryItemToFolderState,
  normalizeExpandedFolderIds,
  normalizeInventoryFolderState,
  renameInventoryFolder as renameInventoryFolderState
} from "./inventory-folder-tree.js";

const SOCKET_CHANNEL = `module.${MODULE_ID}`;
export const SOCKET_EVENT_INVENTORY_IMPORT_REQUEST = "inventory-import-request";
export const SOCKET_EVENT_INVENTORY_IMPORT_RESULT = "inventory-import-result";
export const SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_REQUEST = "inventory-source-depletion-request";
export const SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_RESULT = "inventory-source-depletion-result";
export const SOCKET_EVENT_INVENTORY_ITEM_ACTION_REQUEST = "inventory-item-action-request";
export const SOCKET_EVENT_INVENTORY_ITEM_ACTION_RESULT = "inventory-item-action-result";
export const INVENTORY_TAKE_COMMAND = "inventory.take";
export const INVENTORY_SALE_COMMAND = "inventory.sale";
export const INVENTORY_DISMANTLE_COMMAND = "inventory.dismantle";
export const INVENTORY_IMPORT_COMMAND = "inventory.import";
export const INVENTORY_CURRENCY_UPDATE_COMMAND = "inventory.currency.update";
export const INVENTORY_CURRENCY_CONVERT_COMMAND = "inventory.currency.convert";
export const INVENTORY_FOLDER_CREATE_COMMAND = "inventory.folder.create";
export const INVENTORY_FOLDER_RENAME_COMMAND = "inventory.folder.rename";
export const INVENTORY_FOLDER_MOVE_COMMAND = "inventory.folder.move";
export const INVENTORY_FOLDER_DELETE_COMMAND = "inventory.folder.delete";
export const INVENTORY_ITEM_FOLDER_MOVE_COMMAND = "inventory.item.folder.move";
export const INVENTORY_INGRESS_RULE_CREATE_COMMAND = "inventory.ingress-rule.create";
export const INVENTORY_INGRESS_RULE_UPDATE_COMMAND = "inventory.ingress-rule.update";
export const INVENTORY_INGRESS_RULE_DELETE_COMMAND = "inventory.ingress-rule.delete";
export const GROUP_TRANSPORT_REPLACE_STATE_COMMAND = "group.transport.replaceState";
const INVENTORY_FOLDER_UI_FLAG = "inventoryFolderUi";
const INVENTORY_FOLDER_UI_STATE_VERSION = 1;
const DEFAULT_PARTY_ACTOR_NAME = "Инвентарь группы Rebreya";
const DEFAULT_PARTY_ACTOR_IMAGE = "icons/svg/item-bag.svg";
const LOOTGEN_CHAT_ACTOR_NAME = "Лут Rebreya";
const FOOD_ITEM_NAME = "Еда";
const WATER_ITEM_NAME = "Галлоны воды";
const WATER_LB_PER_GALLON = 8;
const FOOD_SUPPLY_ICON = "icons/consumables/food/berries-ration-round-red.webp";
const WATER_SUPPLY_ICON = "icons/sundries/survival/waterskin-leather-brown.webp";
const RATION_ITEM_NAME_WORDS = new Set(["ration", "rations", "паек", "пайки", "рацион", "рационы"]);
const DEFAULT_CAPACITY_MULTIPLIER = 15;
const DEFAULT_TRAVEL_SPEED_MPH = 3;
const COIN_LABELS = {
  pp: "пм",
  gp: "зм",
  sp: "см",
  cp: "мм"
};

const CURRENCY_MULTIPLIERS = {
  pp: 1000,
  gp: 100,
  sp: 10,
  cp: 1
};

const REBREYA_TOOL_IDS = new Set(REBREYA_TOOLS.map((tool) => tool.id));
const REBREYA_TOOL_LABEL_BY_ID = new Map(REBREYA_TOOLS.map((tool) => [tool.id, tool.label]));
const REBREYA_TOOL_ID_BY_LABEL = new Map(REBREYA_TOOLS.map((tool) => [normalizeText(tool.label), tool.id]));
const GROUP_CONTEXT_FALLBACK_ERRORS = new Set([
  GROUP_CONTEXT_ERRORS.GM_NO_ACTIVE_GROUP,
  GROUP_CONTEXT_ERRORS.PLAYER_NO_GROUP
]);
const NATIVE_GROUP_MEMBERSHIP_MESSAGE = "Состав группы управляется листом dnd5e группы. Откройте лист группы, чтобы добавить или удалить участников.";
const INVENTORY_MUTATION_FLAG = "inventoryMutation";
const CRAFT_QUANTITY_PRECISION = 5;
const CRAFT_EXECUTION_CONTEXT_ERRORS = new WeakSet();
const LEGACY_REBREYA_TOOL_LABEL_ALIASES = [
  ["Воровские", "thieves"],
  ["Алхимические", "alchemy"],
  ["Кузнеца", "smith"],
  ["Каллиграфа", "calligrapher"],
  ["Поддельщика", "forgery"],
  ["Гримёра", "disguise"],
  ["Художественные", "artisan"],
  ["Исследователя", "investigator"],
  ["Жестянщика", "tinker"],
  ["Камнелома", "mason"],
  ["Каменолома", "mason"],
  ["Кожедела", "leatherworker"],
  ["Пивовара", "brewer"],
  ["Деревянщика", "woodcarver"],
  ["Повара", "cook"],
  ["Ювелира", "jeweler"]
];
REBREYA_TOOL_ID_BY_LABEL.set(normalizeText("Камнелома"), "mason");
REBREYA_TOOL_ID_BY_LABEL.set(normalizeText("Каменолома"), "mason");
for (const [legacyLabel, toolId] of LEGACY_REBREYA_TOOL_LABEL_ALIASES) {
  REBREYA_TOOL_ID_BY_LABEL.set(normalizeText(legacyLabel), toolId);
}

const PARTY_ROLE_DEFAULTS = {
  member: {
    role: "member",
    foodPerDay: 1,
    waterGalPerDay: 1
  },
  mount: {
    role: "mount",
    foodPerDay: 4,
    waterGalPerDay: 4
  },
  transport: {
    role: "transport",
    foodPerDay: 0,
    waterGalPerDay: 0
  }
};

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((toNumber(value, 0) + Number.EPSILON) * factor) / factor;
}

function isBlankNumberInput(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

function parseNullableInteger(value, { min = null } = {}) {
  if (isBlankNumberInput(value)) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const normalized = Math.floor(parsed);
  return min === null ? normalized : Math.max(min, normalized);
}

function parseNullableDecimal(value, { min = null, precision = 2 } = {}) {
  if (isBlankNumberInput(value)) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const normalized = roundNumber(parsed, precision);
  return min === null ? normalized : Math.max(min, normalized);
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function cleanId(value) {
  return String(value ?? "").trim();
}

function normalizeInventoryFolderTarget(value) {
  if (value === null || value === undefined) return null;
  const folderId = cleanId(value);
  if (!folderId) {
    throw new Error("Inventory folder target must be a non-empty string or null.");
  }
  return folderId;
}

function createInventoryMutationId(prefix, requestedId = "") {
  const explicit = cleanId(requestedId);
  if (explicit) {
    return explicit;
  }
  const randomPart = globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now()}-${randomPart}`;
}

function requireCraftMutationId(value) {
  const mutationId = typeof value === "string" ? value.trim() : "";
  if (!mutationId) {
    throw new Error("Craft operations require an explicit nonempty stable mutation ID.");
  }
  return mutationId;
}

function normalizeInventoryMutationJournal(value) {
  return {
    version: 1,
    records: Array.isArray(value?.records)
      ? foundry.utils.deepClone(value.records)
      : []
  };
}

function inventoryQuantitiesMatch(left, right) {
  return Math.abs(toNumber(left, 0) - toNumber(right, 0)) <= 1e-9;
}

function roundCraftQuantity(value) {
  return roundNumber(value, CRAFT_QUANTITY_PRECISION);
}

function requireCraftQuantity(value, label) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`${label} must be a nonnegative number.`);
  }
  return roundCraftQuantity(numeric);
}

function normalizeCraftResourceRequest(value = {}, { requireProjectId = true } = {}) {
  const source = value && typeof value === "object" ? value : {};
  const craftProject = source.craftProject && typeof source.craftProject === "object"
    ? source.craftProject
    : {};
  const nested = source.materialReservation && typeof source.materialReservation === "object"
    ? source.materialReservation
    : (craftProject.materialReservation && typeof craftProject.materialReservation === "object"
      ? craftProject.materialReservation
      : (source.reservation && typeof source.reservation === "object"
        ? source.reservation
        : (craftProject.reservation && typeof craftProject.reservation === "object"
          ? craftProject.reservation
          : (Object.keys(craftProject).length ? craftProject : source))));
  const projectId = cleanId(source.projectId ?? craftProject.projectId ?? nested.projectId);
  if (requireProjectId && !projectId) {
    throw new Error("Craft project ID is required.");
  }

  const predominantMaterialId = cleanId(
    nested.predominantMaterialId
    ?? source.predominantMaterialId
  );
  const predominantMaterialLb = requireCraftQuantity(
    nested.predominantMaterialLb
    ?? nested.predominantMaterialLbReserved
    ?? nested.predominantMaterialLbRemaining
    ?? source.predominantMaterialLb
    ?? 0,
    "Predominant material quantity"
  );
  const baseRawMaterialId = cleanId(
    nested.baseRawMaterialId
    ?? source.baseRawMaterialId
  );
  const baseRawQuantity = requireCraftQuantity(
    nested.baseRawQuantity
    ?? nested.baseRawMaterialQuantity
    ?? nested.baseRawQuantityReserved
    ?? nested.baseRawQuantityRemaining
    ?? source.baseRawQuantity
    ?? 0,
    "Base raw material quantity"
  );

  if (predominantMaterialLb > 0 && !predominantMaterialId) {
    throw new Error("Predominant material ID is required for reservation quantity.");
  }
  if (baseRawQuantity > 0 && !baseRawMaterialId) {
    throw new Error("Base raw material ID is required for reservation quantity.");
  }

  return {
    projectId,
    predominantMaterialId,
    predominantMaterialLb,
    baseRawMaterialId,
    baseRawQuantity
  };
}

function normalizeCraftSpendRequest(projectId, spend = {}) {
  const source = spend && typeof spend === "object" ? spend : {};
  return {
    projectId: cleanId(projectId),
    predominantMaterialLb: requireCraftQuantity(
      source.predominantMaterialLb ?? source.predominantMaterialLbSpent ?? 0,
      "Predominant material spend"
    ),
    baseRawQuantity: requireCraftQuantity(
      source.baseRawQuantity ?? source.baseRawMaterialQuantity ?? source.baseRawQuantitySpent ?? 0,
      "Base raw material spend"
    )
  };
}

function collectCraftMaterialResources(request) {
  const resourcesBySourceId = new Map();
  const resources = [
    {
      resource: "predominant",
      sourceId: request.predominantMaterialId,
      quantity: request.predominantMaterialLb
    },
    {
      resource: "baseRaw",
      sourceId: request.baseRawMaterialId,
      quantity: request.baseRawQuantity
    }
  ].filter((entry) => entry.quantity > 0);

  for (const resource of resources) {
    const component = foundry.utils.deepClone(resource);
    const existing = resourcesBySourceId.get(resource.sourceId);
    if (existing) {
      existing.quantity = roundCraftQuantity(existing.quantity + resource.quantity);
      existing.components.push(component);
      continue;
    }
    resourcesBySourceId.set(resource.sourceId, {
      ...resource,
      components: [component]
    });
  }
  return Array.from(resourcesBySourceId.values());
}

function takeCraftMaterialComponents(pendingComponents, quantity) {
  let remaining = roundCraftQuantity(quantity);
  const allocated = [];
  for (const component of pendingComponents) {
    if (remaining <= 1e-9) {
      break;
    }
    const available = roundCraftQuantity(component.quantity);
    if (available <= 0) {
      continue;
    }
    const taken = roundCraftQuantity(Math.min(available, remaining));
    allocated.push({ ...foundry.utils.deepClone(component), quantity: taken });
    component.quantity = roundCraftQuantity(available - taken);
    remaining = roundCraftQuantity(remaining - taken);
  }
  if (remaining > 1e-9) {
    throw new Error("Craft material components do not match their total quantity.");
  }
  return allocated;
}

function normalizeCraftOutputs(outputs) {
  if (!Array.isArray(outputs) || outputs.length === 0) {
    throw new Error("Craft outputs are required.");
  }
  return outputs.map((output) => {
    const sourceType = normalizeInventorySourceType(output?.sourceType ?? "gear");
    const sourceId = cleanId(output?.sourceId ?? output?.gearId ?? output?.id);
    const quantity = Number(output?.quantity ?? 1);
    if (sourceType !== "gear") {
      throw new Error("Magic and non-gear craft outputs are not supported.");
    }
    if (!sourceId) {
      throw new Error("Craft output source ID is required.");
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("Craft output quantity must be a positive integer.");
    }
    return {
      sourceType: "gear",
      sourceId,
      quantity,
      sourceDocumentId: cleanId(output?.sourceDocumentId ?? output?.gearDocumentId)
    };
  });
}

function collectionValues(collection) {
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

  return [];
}

function getSocketUser(senderId) {
  const safeSenderId = cleanId(senderId);
  if (!safeSenderId) {
    return null;
  }

  return game.users?.get?.(safeSenderId)
    ?? collectionValues(game.users).find((user) => user?.id === safeSenderId)
    ?? (game.user?.id === safeSenderId ? game.user : null)
    ?? null;
}

function getActiveGm() {
  return game.users?.activeGM
    ?? collectionValues(game.users).find((user) => user?.isGM && user?.active)
    ?? null;
}

function isActiveGmClient() {
  if (!game.user?.isGM) {
    return false;
  }

  const activeGm = getActiveGm();
  return !activeGm?.id || activeGm.id === game.user.id;
}

function isExplicitActiveGmClient() {
  const activeGm = getActiveGm();
  return Boolean(game.user?.isGM)
    && Boolean(activeGm?.id)
    && activeGm.active !== false
    && activeGm.id === game.user.id;
}

function userOwnsActor(actor, user) {
  if (!actor || !user) {
    return false;
  }

  if (user.isGM) {
    return true;
  }

  if (typeof actor.testUserPermission === "function") {
    try {
      return actor.testUserPermission(user, "OWNER") === true;
    }
    catch (_error) {
      return false;
    }
  }

  const ownership = actor.ownership ?? actor._source?.ownership ?? {};
  return Number(ownership[user.id] ?? ownership.default ?? 0) >= 3;
}

function isActorDocument(document) {
  if (!document) {
    return false;
  }

  if (typeof globalThis.Actor === "function" && document instanceof globalThis.Actor) {
    return true;
  }

  return document.documentName === "Actor"
    || Boolean(document.id && document.system && document.items);
}

function isItemDocument(document) {
  if (!document) {
    return false;
  }

  if (typeof globalThis.Item === "function" && document instanceof globalThis.Item) {
    return true;
  }

  return document.documentName === "Item"
    || Boolean(document.id && document.system && document.parent);
}

async function resolveUuid(uuid) {
  const safeUuid = cleanId(uuid);
  if (!safeUuid || typeof globalThis.fromUuid !== "function") {
    return null;
  }

  try {
    return await globalThis.fromUuid(safeUuid);
  }
  catch (_error) {
    return null;
  }
}

function getLootgenChatClaimFromDropData(dropData = {}) {
  const chatFlag = dropData?.data?.flags?.[MODULE_ID]?.lootgenChat ?? null;
  const lootId = cleanId(chatFlag?.lootId);
  const rowId = cleanId(chatFlag?.rowId);
  return lootId && rowId ? { lootId, rowId } : null;
}

function durabilityTransferSignature(item) {
  const itemData = item?.toObject?.() ?? item;
  if (!isDurabilityEligible(itemData)) {
    return "";
  }
  const durability = item?.getFlag?.(MODULE_ID, "durability")
    ?? itemData?.flags?.[MODULE_ID]?.durability
    ?? null;
  return durability && typeof durability === "object"
    ? buildDurabilitySignature(durability)
    : "uninitialized";
}

export function itemsCanRepresentSameTransfer(sourceItem, acceptedItem) {
  if (!sourceItem || !acceptedItem) {
    return false;
  }

  const sourceData = sourceItem?.toObject?.() ?? sourceItem;
  const acceptedData = acceptedItem?.toObject?.() ?? acceptedItem;
  const sourceFlags = sourceData?.flags?.[MODULE_ID] ?? {};
  const acceptedFlags = acceptedData?.flags?.[MODULE_ID] ?? {};
  const sourceHasIdentity = Boolean(sourceFlags.sourceType && sourceFlags.sourceId);
  const acceptedHasIdentity = Boolean(acceptedFlags.sourceType && acceptedFlags.sourceId);
  const sameSource = sourceHasIdentity || acceptedHasIdentity
    ? sourceHasIdentity && acceptedHasIdentity
      && sourceFlags.sourceType === acceptedFlags.sourceType
      && sourceFlags.sourceId === acceptedFlags.sourceId
    : sourceData.type === acceptedData.type
      && normalizeText(sourceData.name) === normalizeText(acceptedData.name);
  return Boolean(sameSource)
    && durabilityTransferSignature(sourceItem) === durabilityTransferSignature(acceptedItem);
}

function inventoryStackIdentity(item) {
  const itemData = item?.toObject?.() ?? item;
  const flags = itemData?.flags?.[MODULE_ID] ?? {};
  const identities = [
    ["gear", flags.gearId],
    ["material", flags.materialId],
    ["magicItem", flags.magicItemId],
    ["good", flags.linkedGoodId]
  ];
  const identity = identities.find(([, value]) => cleanId(value));
  return identity ? `${identity[0]}:${cleanId(identity[1])}` : "";
}

function itemsCanMergeInInventory(sourceItem, acceptedItem) {
  const sourceIdentity = inventoryStackIdentity(sourceItem);
  const acceptedIdentity = inventoryStackIdentity(acceptedItem);
  const sameStack = sourceIdentity || acceptedIdentity
    ? Boolean(sourceIdentity && acceptedIdentity && sourceIdentity === acceptedIdentity)
    : itemsCanRepresentSameTransfer(sourceItem, acceptedItem);
  return sameStack
    && durabilityTransferSignature(sourceItem) === durabilityTransferSignature(acceptedItem);
}

export function captureInventoryTransferIdentity(item) {
  if (!item) {
    return null;
  }
  const itemData = item?.toObject?.() ?? item;
  const flags = itemData?.flags?.[MODULE_ID] ?? {};
  const sourceType = cleanId(flags.sourceType);
  const sourceId = cleanId(flags.sourceId);
  const hasManagedIdentity = Boolean(sourceType && sourceId);
  return {
    sourceType: hasManagedIdentity ? sourceType : "",
    sourceId: hasManagedIdentity ? sourceId : "",
    itemType: hasManagedIdentity ? "" : cleanId(itemData?.type),
    normalizedName: hasManagedIdentity ? "" : normalizeText(itemData?.name),
    durability: durabilityTransferSignature(item)
  };
}

function normalizeInventoryTransferIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const identity = {
    sourceType: cleanId(value.sourceType),
    sourceId: cleanId(value.sourceId),
    itemType: cleanId(value.itemType),
    normalizedName: normalizeText(value.normalizedName),
    durability: cleanId(value.durability)
  };
  const hasManagedIdentity = Boolean(identity.sourceType && identity.sourceId);
  const hasFallbackIdentity = Boolean(identity.itemType && identity.normalizedName);
  if (hasManagedIdentity === hasFallbackIdentity) {
    return null;
  }
  if (hasManagedIdentity) {
    identity.itemType = "";
    identity.normalizedName = "";
  }
  else {
    identity.sourceType = "";
    identity.sourceId = "";
  }
  return identity;
}

export function inventoryTransferIdentityMatches(item, expectedIdentity) {
  const actualIdentity = captureInventoryTransferIdentity(item);
  const normalizedExpected = normalizeInventoryTransferIdentity(expectedIdentity);
  return Boolean(actualIdentity && normalizedExpected)
    && JSON.stringify(actualIdentity) === JSON.stringify(normalizedExpected);
}

function normalizeInventoryTransferTargetReceipt(value, targetItemUuid, expectedQuantity) {
  const safeTargetItemUuid = cleanId(targetItemUuid);
  const beforeQuantity = roundNumber(value?.beforeQuantity, 2);
  const afterQuantity = roundNumber(value?.afterQuantity, 2);
  const delta = roundNumber(value?.delta, 2);
  if (!value
    || typeof value.created !== "boolean"
    || typeof value.beforeQuantity !== "number"
    || typeof value.afterQuantity !== "number"
    || typeof value.delta !== "number"
    || !Number.isFinite(value.beforeQuantity)
    || !Number.isFinite(value.afterQuantity)
    || !Number.isFinite(value.delta)
    || cleanId(value.targetItemUuid) !== safeTargetItemUuid
    || beforeQuantity < 0
    || afterQuantity <= 0
    || delta <= 0
    || !inventoryQuantitiesMatch(afterQuantity - beforeQuantity, delta)
    || !inventoryQuantitiesMatch(delta, expectedQuantity)
    || (value.created === true && beforeQuantity !== 0)) {
    return null;
  }
  return {
    targetItemUuid: safeTargetItemUuid,
    created: value.created,
    beforeQuantity,
    afterQuantity,
    delta
  };
}

function isRationItemName(value) {
  const words = normalizeText(value)
    .replace(/ё/gu, "е")
    .split(/[^a-zа-я0-9]+/iu)
    .filter(Boolean);
  return words.some((word) => RATION_ITEM_NAME_WORDS.has(word));
}

const LEGACY_CORE_ICON_REPLACEMENTS = new Map([
  ["icons/consumables/food/bowl-oatmeal-brown.webp", FOOD_SUPPLY_ICON],
  ["icons/consumables/water/waterskin-leather-blue.webp", WATER_SUPPLY_ICON]
]);

function normalizeInventoryIconPath(value) {
  const path = String(value ?? "").trim();
  return LEGACY_CORE_ICON_REPLACEMENTS.get(path) ?? path;
}

function normalizeInventorySourceType(value) {
  const compact = normalizeText(value).replace(/[_\-\s]+/gu, "");
  if (!compact) {
    return "";
  }

  if (["material", "materials", "материал", "материалы"].includes(compact)) {
    return "material";
  }

  if (["gear", "equipment", "loot", "снаряжение"].includes(compact)) {
    return "gear";
  }

  if (["supply", "supplies", "resource", "resources", "запасы"].includes(compact)) {
    return "supply";
  }

  if (["magicitem", "magicitems", "magic", "magical", "магическийпредмет", "магия"].includes(compact)) {
    return "magicItem";
  }

  if (["custom", "other", "прочее"].includes(compact)) {
    return "custom";
  }

  return "";
}

function normalizeRole(role) {
  const safeRole = String(role ?? "member").trim().toLowerCase();
  if (safeRole === "mount" || safeRole === "transport" || safeRole === "member") {
    return safeRole;
  }

  if (safeRole === "скакун") {
    return "mount";
  }

  if (safeRole === "транспорт") {
    return "transport";
  }

  return "member";
}

function getRoleLabel(role) {
  switch (normalizeRole(role)) {
    case "mount":
      return "Скакун";
    case "transport":
      return "Транспорт";
    case "member":
    default:
      return "Член группы";
  }
}

function getProperty(source, path) {
  if (!path) {
    return undefined;
  }
  if (globalThis.foundry?.utils?.getProperty) {
    return globalThis.foundry.utils.getProperty(source, path);
  }

  return String(path).split(".").reduce((value, key) => (
    value && typeof value === "object" ? value[key] : undefined
  ), source);
}

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstDefinedValue(source, paths = []) {
  for (const path of paths) {
    const value = getProperty(source, path);
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return undefined;
}

function extractNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const text = String(value ?? "").replace(/\s+/gu, " ").replace(",", ".");
  const match = text.match(/-?\d+(?:\.\d+)?/u);
  if (!match) {
    return null;
  }
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function parseSpeedMph(value) {
  const number = extractNumber(value);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  const normalized = normalizeText(value);
  if (normalized.includes("фут")) {
    return roundNumber(number / 10, 2);
  }
  return roundNumber(number, 2);
}

function parseWeightToPounds(value) {
  const number = extractNumber(value);
  if (!Number.isFinite(number) || number < 0) {
    return null;
  }

  const normalized = normalizeText(value);
  if (normalized.includes("тонн") || normalized.includes("ton")) {
    return roundNumber(number * 2000, 2);
  }
  if (normalized.includes("кг") || normalized.includes("kg")) {
    return roundNumber(number * 2.20462, 2);
  }
  return roundNumber(number, 2);
}

function formatTransportSpeedLabel(speedMph) {
  const speed = roundNumber(toNumber(speedMph, 0), 2);
  return speed > 0 ? `${formatNumberLabel(speed)} миль/час` : "-";
}

function formatPoundLabel(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "-";
  }
  const pounds = roundNumber(numericValue, 2);
  return `${formatNumberLabel(pounds)} фнт.`;
}

function formatNumberLabel(value, precision = 2) {
  const rounded = roundNumber(value, precision);
  return Number.isInteger(rounded)
    ? String(rounded)
    : String(rounded).replace(".", ",");
}

function getDurabilityLabel(value, maximum) {
  const currentHp = extractNumber(value);
  const maxHp = extractNumber(maximum);
  if (Number.isFinite(currentHp) && Number.isFinite(maxHp) && maxHp > 0) {
    return `${formatNumberLabel(currentHp)} / ${formatNumberLabel(maxHp)}`;
  }
  if (Number.isFinite(maxHp) && maxHp > 0) {
    return `${formatNumberLabel(maxHp)} хитов`;
  }
  if (Number.isFinite(currentHp) && currentHp > 0) {
    return `${formatNumberLabel(currentHp)} хитов`;
  }
  return "-";
}

function getTransportConditionLabel(value) {
  switch (cleanId(value)) {
    case "damaged":
      return "Повреждён";
    case "broken":
      return "Сломан";
    case "operational":
    default:
      return "Исправен";
  }
}

function isTransportText(value) {
  const text = normalizeText(value);
  return Boolean(text && (
    text.includes("транспорт")
    || text.includes("скакун")
    || text.includes("автомоб")
    || text.includes("фургон")
    || text.includes("локомотив")
    || text.includes("вертол")
    || text.includes("самолет")
    || text.includes("самолёт")
    || text.includes("кораб")
    || text.includes("лодк")
    || text.includes("дирижаб")
    || text.includes("велосипед")
    || text.includes("мотоцикл")
    || text.includes("лошад")
    || text.includes("мул")
    || text.includes("пони")
  ));
}

function buildTransportProfile({
  id,
  name,
  img = "",
  sourceKind = "",
  sourceLabel = "",
  typeLabel = "",
  speedValue = null,
  fallbackSpeedValue = null,
  cargoValue = null,
  hpValue = null,
  hpMax = null,
  acValue = null,
  crew = null,
  passengers = null,
  fuel = "",
  rank = null,
  size = "",
  quantity = null,
  isTransport = false,
  actorId = "",
  actorUuid = "",
  isActorBacked = false,
  isConcreteInstance = false,
  canEditState = false,
  condition = "operational",
  fuelSelector = null,
  fuelConsumption = null,
  consumption = null,
  hasExplicitCargoCapacity = false,
  accelerationFt = null,
  breakdownThreshold = null
} = {}) {
  const speedMph = parseSpeedMph(speedValue) ?? parseSpeedMph(fallbackSpeedValue) ?? 0;
  const cargoCapacityLb = parseWeightToPounds(cargoValue) ?? 0;
  const ac = extractNumber(acValue);
  const safeRank = extractNumber(rank);
  const crewCount = extractNumber(crew);
  const passengerCount = extractNumber(passengers);
  const details = [
    typeLabel,
    Number.isFinite(safeRank) && safeRank > 0 ? `ранг ${safeRank}` : "",
    cleanId(size),
    cleanId(fuel)
  ].filter(Boolean);

  return {
    id: cleanId(id),
    name: cleanId(name) || "Транспорт",
    img: cleanId(img) || "icons/svg/wingfoot.svg",
    sourceKind: cleanId(sourceKind),
    sourceLabel: cleanId(sourceLabel),
    typeLabel: cleanId(typeLabel) || "Транспорт",
    speedMph,
    speedLabel: formatTransportSpeedLabel(speedMph),
    cargoCapacityLb,
    cargoLabel: formatPoundLabel(cargoCapacityLb),
    hpValue: extractNumber(hpValue) ?? 0,
    hpMax: extractNumber(hpMax) ?? 0,
    ac: Number.isFinite(ac) ? ac : 0,
    acLabel: Number.isFinite(ac) && ac > 0 ? String(ac) : "-",
    durabilityLabel: getDurabilityLabel(hpValue, hpMax),
    crew: Number.isFinite(crewCount) ? crewCount : null,
    passengers: Number.isFinite(passengerCount) ? passengerCount : null,
    crewLabel: Number.isFinite(crewCount) ? String(crewCount) : "-",
    passengersLabel: Number.isFinite(passengerCount) ? String(passengerCount) : "-",
    fuel: cleanId(fuel),
    rank: Number.isFinite(safeRank) ? safeRank : null,
    size: cleanId(size),
    quantity: quantity === null ? null : Math.max(0, roundNumber(toNumber(quantity, 0), 2)),
    detailsLabel: details.join(" • "),
    isTransport: Boolean(isTransport || speedMph > 0 || cargoCapacityLb > 0 || isTransportText(typeLabel) || isTransportText(name)),
    actorId: cleanId(actorId),
    actorUuid: cleanId(actorUuid),
    isActorBacked: isActorBacked === true,
    isConcreteInstance: isConcreteInstance === true,
    canEditState: canEditState === true,
    condition: ["operational", "damaged", "broken"].includes(cleanId(condition))
      ? cleanId(condition)
      : "operational",
    conditionLabel: getTransportConditionLabel(condition),
    fuelSelector: normalizeTransportFuelSelector(fuelSelector),
    fuelConsumption: normalizeTransportFuelConsumption(fuelConsumption, { optional: true }),
    consumption: {
      kind: cleanId(consumption?.kind),
      amount: Math.max(0, toNumber(consumption?.amount, 0)),
      unit: cleanId(consumption?.unit),
      cadence: cleanId(consumption?.cadence),
      raw: cleanId(consumption?.raw)
    },
    hasExplicitCargoCapacity: hasExplicitCargoCapacity === true,
    accelerationFt: extractNumber(accelerationFt),
    breakdownThreshold: extractNumber(breakdownThreshold)
  };
}

function buildTransportProfileFromActor(actor, memberState = {}, {
  memberCapacityLb = 0,
  memberRole = "",
  groupActorId = ""
} = {}) {
  const actorData = actor?.toObject?.() ?? actor ?? {};
  const moduleFlags = asPlainObject(getProperty(actorData, `flags.${MODULE_ID}`));
  const transportFlags = asPlainObject(moduleFlags.transport);
  const role = normalizeRole(memberRole || memberState.role);
  const hasTransportFlags = Object.keys(transportFlags).length > 0;
  const isExplicitTransportActor = actor?.type === "vehicle"
    || role === "transport"
    || role === "mount"
    || hasTransportFlags;
  if (!isExplicitTransportActor) {
    return null;
  }

  const movementSpeed = firstDefinedValue(actorData, [
    "system.attributes.movement.land",
    "system.attributes.movement.walk",
    "system.attributes.movement.ground",
    "system.attributes.movement.fly",
    "system.attributes.movement.swim"
  ]);
  const explicitCargoValue = firstDefinedValue(actorData, [
    `flags.${MODULE_ID}.transport.cargoCapacityLb`,
    `flags.${MODULE_ID}.transport.cargoCapacity`,
    "system.attributes.capacity.cargo.value",
    "system.attributes.capacity.weight.value",
    "system.capacity.weight.value",
    "system.attributes.capacity.cargo"
  ]);
  const instanceState = asPlainObject(transportFlags.instanceState);
  const consumption = asPlainObject(transportFlags.consumption);
  const isConcreteInstance = actor?.type === "vehicle"
    && transportFlags.instance === true
    && Boolean(cleanId(transportFlags.sourceId ?? moduleFlags.sourceId))
    && Boolean(cleanId(transportFlags.sourceActorUuid))
    && cleanId(transportFlags.groupActorId) === cleanId(groupActorId);
  const profile = buildTransportProfile({
    id: actor?.id ? `member:${actor.id}` : "",
    name: actor?.name,
    img: actor?.img,
    sourceKind: "member",
    sourceLabel: "Участник группы",
    typeLabel: cleanId(transportFlags.sourceType)
      || cleanId(transportFlags.typeLabel)
      || cleanId(getProperty(actorData, "system.details.type"))
      || (actor?.type === "vehicle" ? "Транспорт" : getRoleLabel(role)),
    speedValue: firstDefinedValue(actorData, [
      `flags.${MODULE_ID}.transport.speedMph`,
      `flags.${MODULE_ID}.transport.travelSpeedMph`,
      "system.attributes.travel.speeds.land",
      "system.attributes.travel.speeds.walk",
      "system.attributes.travel.speeds.ground",
      "system.attributes.travel.speeds.water",
      "system.attributes.travel.speeds.air"
    ]),
    fallbackSpeedValue: movementSpeed == null ? null : `${movementSpeed} футов`,
    cargoValue: explicitCargoValue ?? memberCapacityLb,
    hpValue: firstDefinedValue(actorData, [
      `flags.${MODULE_ID}.transport.hp.value`,
      "system.attributes.hp.value"
    ]),
    hpMax: firstDefinedValue(actorData, [
      `flags.${MODULE_ID}.transport.hp.max`,
      "system.attributes.hp.max"
    ]),
    acValue: firstDefinedValue(actorData, [
      `flags.${MODULE_ID}.transport.ac`,
      "system.attributes.ac.flat",
      "system.attributes.ac.value"
    ]),
    crew: firstDefinedValue(actorData, [
      `flags.${MODULE_ID}.transport.crew`,
      "system.crew.max",
      "system.attributes.crew.max",
      "system.attributes.crew",
      "system.crew"
    ]),
    passengers: firstDefinedValue(actorData, [
      `flags.${MODULE_ID}.transport.passengers`,
      "system.passengers.max",
      "system.attributes.passengers.max",
      "system.attributes.passengers",
      "system.passengers"
    ]),
    fuel: firstDefinedValue(actorData, [
      `flags.${MODULE_ID}.transport.fuel`,
      `flags.${MODULE_ID}.transport.consumption.raw`,
      "system.attributes.fuel",
      "system.fuel"
    ]),
    rank: firstDefinedValue(actorData, [
      `flags.${MODULE_ID}.transport.rank`,
      `flags.${MODULE_ID}.rank`,
      "system.details.level"
    ]),
    size: firstDefinedValue(actorData, [
      `flags.${MODULE_ID}.transport.size`,
      "system.traits.size",
      "system.attributes.size"
    ]),
    isTransport: true,
    actorId: actor?.id,
    actorUuid: actor?.uuid,
    isActorBacked: true,
    isConcreteInstance,
    canEditState: isConcreteInstance,
    condition: instanceState.condition,
    fuelSelector: instanceState.fuelSelector,
    fuelConsumption: instanceState.fuelConsumption,
    consumption,
    hasExplicitCargoCapacity: explicitCargoValue !== undefined,
    accelerationFt: transportFlags.accelerationFt,
    breakdownThreshold: transportFlags.breakdownThreshold
  });

  return profile.isTransport ? profile : null;
}

function buildTransportProfileFromInventoryItem(itemData, {
  itemId = "",
  itemUuid = "",
  itemTypeLabel = "",
  sourceTypeLabel = "",
  sourceFlags = {},
  matchedGear = null,
  quantity = null
} = {}) {
  const moduleFlags = asPlainObject(itemData?.flags?.[MODULE_ID]);
  const transportFlags = asPlainObject(moduleFlags.transport);
  const typeLabel = cleanId(transportFlags.typeLabel)
    || cleanId(matchedGear?.transportType)
    || cleanId(matchedGear?.equipmentType)
    || cleanId(sourceFlags.transportType)
    || cleanId(itemTypeLabel);
  const isTransport = Boolean(
    moduleFlags.transport
    || moduleFlags.sourceType === "transport"
    || itemData?.type === "vehicle"
    || isTransportText(typeLabel)
    || isTransportText(sourceTypeLabel)
    || isTransportText(sourceFlags.equipmentType)
    || isTransportText(itemData?.name)
  );
  if (!isTransport) {
    return null;
  }

  const profile = buildTransportProfile({
    id: itemId ? `item:${itemId}` : cleanId(itemUuid),
    name: itemData?.name,
    img: itemData?.img,
    sourceKind: "item",
    sourceLabel: "Склад",
    typeLabel,
    speedValue: transportFlags.speedMph
      ?? transportFlags.travelSpeedMph
      ?? matchedGear?.speedMph
      ?? matchedGear?.travelSpeed
      ?? sourceFlags.speedMph
      ?? sourceFlags.travelSpeedMph,
    fallbackSpeedValue: (() => {
      const movement = firstDefinedValue(itemData, [
      "system.attributes.movement.land",
      "system.attributes.movement.walk",
      "system.movement.land"
      ]);
      return movement == null ? null : `${movement} футов`;
    })(),
    cargoValue: transportFlags.cargoCapacityLb
      ?? transportFlags.cargoCapacity
      ?? matchedGear?.cargoCapacityLb
      ?? matchedGear?.capacity
      ?? sourceFlags.cargoCapacityLb
      ?? sourceFlags.capacity
      ?? firstDefinedValue(itemData, [
        "system.capacity.weight.value",
        "system.attributes.capacity.cargo"
      ]),
    hpValue: transportFlags.hp?.value ?? firstDefinedValue(itemData, ["system.attributes.hp.value"]),
    hpMax: transportFlags.hp?.max ?? firstDefinedValue(itemData, ["system.attributes.hp.max"]),
    acValue: transportFlags.ac ?? firstDefinedValue(itemData, ["system.attributes.ac.value", "system.armor.value"]),
    crew: transportFlags.crew ?? sourceFlags.crew,
    passengers: transportFlags.passengers ?? sourceFlags.passengers,
    fuel: transportFlags.fuel ?? transportFlags.consumption ?? sourceFlags.fuel ?? sourceFlags.consumption,
    rank: transportFlags.rank ?? moduleFlags.rank ?? sourceFlags.rank ?? matchedGear?.rank,
    size: transportFlags.size ?? sourceFlags.size,
    quantity,
    isTransport,
    isActorBacked: false,
    canEditState: false
  });

  return profile.isTransport ? profile : null;
}

function buildTransportProfileFromPartyMember(member = {}) {
  if (member.transport && typeof member.transport === "object") {
    return {
      ...member.transport,
      id: cleanId(member.transport.id) || (member.actorId ? `member:${member.actorId}` : ""),
      name: cleanId(member.transport.name) || cleanId(member.actorName) || "Транспорт",
      img: cleanId(member.transport.img) || cleanId(member.actorImg) || "icons/svg/wingfoot.svg",
      sourceKind: "member",
      sourceLabel: cleanId(member.transport.sourceLabel) || "Участник группы",
      speedLabel: cleanId(member.transport.speedLabel) || formatTransportSpeedLabel(member.transport.speedMph),
      cargoLabel: cleanId(member.transport.cargoLabel) || formatPoundLabel(member.transport.cargoCapacityLb),
      durabilityLabel: cleanId(member.transport.durabilityLabel) || getDurabilityLabel(member.transport.hpValue, member.transport.hpMax),
      isTransport: true
    };
  }

  const role = normalizeRole(member.role);
  if (role !== "transport" && role !== "mount" && member.isVehicle !== true) {
    return null;
  }

  return buildTransportProfile({
    id: member.actorId ? `member:${member.actorId}` : "",
    name: member.actorName,
    img: member.actorImg,
    sourceKind: "member",
    sourceLabel: "Участник группы",
    typeLabel: role === "mount" ? "Скакун" : "Транспорт",
    speedValue: member.speedMph,
    cargoValue: member.capacityLb,
    hpValue: member.hpValue,
    hpMax: member.hpMax,
    acValue: member.ac,
    isTransport: true
  });
}

function buildTransportProfileFromInventoryEntry(entry = {}) {
  if (entry.transport && typeof entry.transport === "object") {
    return {
      ...entry.transport,
      id: cleanId(entry.transport.id) || (entry.itemId ? `item:${entry.itemId}` : ""),
      name: cleanId(entry.transport.name) || cleanId(entry.name) || "Транспорт",
      img: cleanId(entry.transport.img) || cleanId(entry.img) || "icons/svg/wingfoot.svg",
      sourceKind: "item",
      sourceLabel: cleanId(entry.transport.sourceLabel) || "Склад",
      quantity: entry.quantity,
      speedLabel: cleanId(entry.transport.speedLabel) || formatTransportSpeedLabel(entry.transport.speedMph),
      cargoLabel: cleanId(entry.transport.cargoLabel) || formatPoundLabel(entry.transport.cargoCapacityLb),
      durabilityLabel: cleanId(entry.transport.durabilityLabel) || getDurabilityLabel(entry.transport.hpValue, entry.transport.hpMax),
      isTransport: true
    };
  }

  if (!isTransportText([entry.name, entry.itemTypeLabel, entry.sourceTypeLabel].join(" "))) {
    return null;
  }

  return buildTransportProfile({
    id: entry.itemId ? `item:${entry.itemId}` : "",
    name: entry.name,
    img: entry.img,
    sourceKind: "item",
    sourceLabel: "Склад",
    typeLabel: entry.itemTypeLabel,
    quantity: entry.quantity,
    isTransport: true
  });
}

function buildEmptyTransportSnapshot({ warning = "", canManage = false } = {}) {
  return {
    available: !warning,
    warning,
    canManage: Boolean(canManage),
    vehicles: [],
    hasVehicles: false,
    activeTransportId: "",
    activeVehicle: null,
    fuel: {
      configured: false,
      selector: normalizeTransportFuelSelector(null),
      card: null,
      quantity: 0,
      consumptionPerMile: 0,
      unit: "",
      consumptionSource: "none",
      miles: 0,
      isEmpty: false,
      stacks: [],
      reason: "noTransport"
    },
    effectiveSpeedMph: DEFAULT_TRAVEL_SPEED_MPH,
    speedLabel: `${DEFAULT_TRAVEL_SPEED_MPH} мили/час`,
    speedSourceLabel: "Пешком",
    cargoLabel: "-",
    durabilityLabel: "-"
  };
}

function getRawQuantity(itemData) {
  return Math.max(0, toNumber(foundry.utils.getProperty(itemData, "system.quantity"), 1));
}

function buildTransportFuelSnapshot(activeVehicle, groupActor) {
  if (!activeVehicle?.isConcreteInstance) {
    return {
      configured: false,
      selector: normalizeTransportFuelSelector(null),
      card: null,
      quantity: 0,
      consumptionPerMile: 0,
      unit: "",
      miles: 0,
      isEmpty: false,
      stacks: [],
      reason: "noTransport"
    };
  }

  const inventoryFuel = buildTransportFuelInventorySnapshot(
    groupActor?.items,
    activeVehicle.fuelSelector
  );
  const effectiveConsumption = resolveTransportFuelConsumption(
    activeVehicle.fuelConsumption,
    activeVehicle.consumption
  );
  const consumptionPerMile = effectiveConsumption.amount;
  const miles = consumptionPerMile > 0
    ? Math.max(0, Math.floor(inventoryFuel.quantity / consumptionPerMile))
    : 0;
  const primaryItem = inventoryFuel.primaryItemId
    ? groupActor?.items?.get?.(inventoryFuel.primaryItemId)
      ?? groupActor?.items?.contents?.find?.((item) => cleanId(item?.id) === inventoryFuel.primaryItemId)
      ?? null
    : null;
  const primaryData = primaryItem?.toObject?.() ?? primaryItem ?? {};
  const weight = Math.max(0, toNumber(getProperty(primaryData, "system.weight.value"), 0));
  const price = getProperty(primaryData, "system.price") ?? {};
  const card = inventoryFuel.configured
    ? {
        ...inventoryFuel.selector,
        itemId: inventoryFuel.primaryItemId,
        itemUuid: inventoryFuel.primaryItemUuid,
        openUuid: inventoryFuel.openUuid,
        name: inventoryFuel.name,
        img: inventoryFuel.img,
        type: inventoryFuel.type,
        quantity: inventoryFuel.quantity,
        weight,
        weightLabel: weight > 0 ? `${roundNumber(weight, 2)} фнт.` : "-",
        valueLabel: formatPriceLabel(price),
        canOpen: Boolean(inventoryFuel.openUuid)
      }
    : null;
  return {
    configured: inventoryFuel.configured,
    selector: inventoryFuel.selector,
    card,
    quantity: inventoryFuel.quantity,
    consumptionPerMile,
    unit: effectiveConsumption.unit,
    consumptionSource: effectiveConsumption.source,
    miles,
    isEmpty: inventoryFuel.configured && inventoryFuel.isEmpty,
    stacks: inventoryFuel.stacks,
    reason: inventoryFuel.configured ? (consumptionPerMile > 0 ? "" : "noConsumption") : "unconfigured"
  };
}

function getItemWeight(itemData) {
  return Math.max(0, toNumber(foundry.utils.getProperty(itemData, "system.weight.value"), 0));
}

function getActorStrength(actor) {
  return Math.max(0, Math.floor(toNumber(foundry.utils.getProperty(actor, "system.abilities.str.value"), 0)));
}

function formatPriceLabel(price) {
  const rawValue = toNumber(price?.value, 0);
  if (rawValue <= 0) {
    return "-";
  }

  const denomination = String(price?.denomination ?? "gp").toLowerCase();
  return `${rawValue} ${COIN_LABELS[denomination] ?? denomination}`;
}

function buildCurrencyLabel(actor) {
  const currency = foundry.utils.getProperty(actor, "system.currency") ?? {};
  const parts = ["pp", "gp", "sp", "cp"]
    .map((key) => {
      const amount = Math.floor(Math.max(0, toNumber(currency[key], 0)));
      return amount > 0 ? `${amount} ${COIN_LABELS[key]}` : "";
    })
    .filter(Boolean);

  return parts.length ? parts.join(" ") : `0 ${COIN_LABELS.cp}`;
}

function buildCurrencySnapshot(actor) {
  const value = {
    pp: getCurrencyValue(actor, "pp"),
    gp: getCurrencyValue(actor, "gp"),
    sp: getCurrencyValue(actor, "sp"),
    cp: getCurrencyValue(actor, "cp")
  };
  return {
    ...value,
    totalCopper: actorCurrencyToCopper(actor),
    label: buildCurrencyLabel(actor)
  };
}

function getCurrencyValue(actor, key) {
  const currency = foundry.utils.getProperty(actor, "system.currency") ?? {};
  return Math.floor(Math.max(0, toNumber(currency?.[key], 0)));
}

function actorCurrencyToCopper(actor) {
  return Object.entries(CURRENCY_MULTIPLIERS)
    .reduce((sum, [key, multiplier]) => sum + (getCurrencyValue(actor, key) * multiplier), 0);
}

function copperToCurrency(totalCopper, mode = "normalized") {
  let remaining = Math.max(0, Math.floor(toNumber(totalCopper, 0)));
  const result = {
    pp: 0,
    gp: 0,
    sp: 0,
    cp: 0
  };

  if (mode === "cp") {
    result.cp = remaining;
    return result;
  }

  if (mode === "sp") {
    result.sp = Math.floor(remaining / CURRENCY_MULTIPLIERS.sp);
    result.cp = remaining % CURRENCY_MULTIPLIERS.sp;
    return result;
  }

  if (mode === "gp") {
    result.gp = Math.floor(remaining / CURRENCY_MULTIPLIERS.gp);
    remaining -= result.gp * CURRENCY_MULTIPLIERS.gp;
    result.sp = Math.floor(remaining / CURRENCY_MULTIPLIERS.sp);
    result.cp = remaining % CURRENCY_MULTIPLIERS.sp;
    return result;
  }

  result.pp = Math.floor(remaining / CURRENCY_MULTIPLIERS.pp);
  remaining -= result.pp * CURRENCY_MULTIPLIERS.pp;
  result.gp = Math.floor(remaining / CURRENCY_MULTIPLIERS.gp);
  remaining -= result.gp * CURRENCY_MULTIPLIERS.gp;
  result.sp = Math.floor(remaining / CURRENCY_MULTIPLIERS.sp);
  remaining -= result.sp * CURRENCY_MULTIPLIERS.sp;
  result.cp = remaining;
  return result;
}

function normalizeCurrencyMode(mode = "normalized") {
  return ["normalized", "gp", "sp", "cp"].includes(mode) ? mode : "normalized";
}

function buildNextCurrency(values = {}, currentCurrency = {}) {
  return {
    pp: values.pp !== undefined ? Math.max(0, Math.floor(toNumber(values.pp, currentCurrency.pp))) : currentCurrency.pp,
    gp: values.gp !== undefined ? Math.max(0, Math.floor(toNumber(values.gp, currentCurrency.gp))) : currentCurrency.gp,
    sp: values.sp !== undefined ? Math.max(0, Math.floor(toNumber(values.sp, currentCurrency.sp))) : currentCurrency.sp,
    cp: values.cp !== undefined ? Math.max(0, Math.floor(toNumber(values.cp, currentCurrency.cp))) : currentCurrency.cp
  };
}

function buildCurrencyUpdatePatch(currency) {
  return {
    "system.currency.pp": Math.max(0, Math.floor(toNumber(currency.pp, 0))),
    "system.currency.gp": Math.max(0, Math.floor(toNumber(currency.gp, 0))),
    "system.currency.ep": 0,
    "system.currency.sp": Math.max(0, Math.floor(toNumber(currency.sp, 0))),
    "system.currency.cp": Math.max(0, Math.floor(toNumber(currency.cp, 0)))
  };
}

function priceToCopper(price = {}) {
  const value = Math.max(0, toNumber(price?.value, 0));
  if (value <= 0) {
    return 0;
  }

  const denomination = String(price?.denomination ?? "gp").toLowerCase();
  const multiplier = CURRENCY_MULTIPLIERS[denomination] ?? CURRENCY_MULTIPLIERS.gp;
  return Math.max(0, Math.floor(value * multiplier));
}

function isMagicalInventoryItem(itemData) {
  const flags = foundry.utils.deepClone(itemData?.flags?.[MODULE_ID] ?? {});
  const dnd5eFlags = foundry.utils.deepClone(itemData?.flags?.dnd5e ?? {});
  const propertyHasMagicMarker = (properties) => {
    if (properties instanceof Set || Array.isArray(properties)) {
      return Array.from(properties).some((entry) => propertyHasMagicMarker(entry));
    }
    if (typeof properties === "string") {
      return ["mgc", "magic", "magical", "магия", "магический"].includes(normalizeText(properties));
    }
    if (!properties || typeof properties !== "object") {
      return false;
    }
    return propertyHasMagicMarker(properties.value)
      || Object.entries(properties).some(([key, enabled]) => (
        key !== "value" && enabled === true && propertyHasMagicMarker(key)
      ));
  };
  const rarityValue = itemData?.system?.rarity;
  const rarity = normalizeText(
    rarityValue && typeof rarityValue === "object"
      ? rarityValue.value ?? rarityValue.id ?? rarityValue.key ?? rarityValue.slug
      : rarityValue
  );
  const rebreyaMagicMarkers = [
    flags.magical,
    flags.isMagical,
    flags.isMagic,
    flags.magic,
    flags.magicItemId,
    flags.magicId,
    flags.magicItem,
    flags.magicWeaponTemplate,
    flags.magicArmorTemplate,
    flags.magicShieldTemplate,
    flags.magicEquipmentTemplate,
    flags.magicAmmunitionTemplate
  ];
  return normalizeInventorySourceType(flags.sourceType) === "magicItem"
    || normalizeInventorySourceType(flags.itemType) === "magicItem"
    || normalizeInventorySourceType(flags.magicItemType) === "magicItem"
    || propertyHasMagicMarker(itemData?.system?.properties)
    || Boolean(rarity && !["mundane", "none"].includes(rarity))
    || rebreyaMagicMarkers.some(Boolean)
    || Boolean(dnd5eFlags.magical || dnd5eFlags.isMagical || dnd5eFlags.isMagic || dnd5eFlags.magic);
}

function normalizeToolId(value) {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }

  if (REBREYA_TOOL_IDS.has(text)) {
    return text;
  }

  return REBREYA_TOOL_ID_BY_LABEL.get(text) ?? "";
}

function buildDefaultToolState() {
  return {
    owned: false,
    prof: false,
    mod: 0,
    rank: 0
  };
}

function normalizeToolState(value) {
  const mod = roundNumber(toNumber(value?.mod, 0), 2);
  return {
    owned: Boolean(value?.owned),
    prof: Boolean(value?.prof),
    mod: Number.isFinite(mod) ? mod : 0,
    rank: Math.max(0, Math.floor(toNumber(value?.rank, 0)))
  };
}

function normalizeToolsMap(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalizedSource = {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const normalizedKey = normalizeToolId(rawKey);
    if (!normalizedKey) {
      continue;
    }

    normalizedSource[normalizedKey] = rawValue;
  }

  const result = {};
  for (const tool of REBREYA_TOOLS) {
    result[tool.id] = normalizeToolState(
      source[tool.id]
      ?? normalizedSource[tool.id]
      ?? buildDefaultToolState()
    );
  }
  return result;
}

function getActorConMod(actor) {
  const conMod = toNumber(foundry.utils.getProperty(actor, "system.abilities.con.mod"), 0);
  return Math.floor(conMod);
}

function resolveEnergyMax(memberState, actorDocument = null) {
  const conOverride = memberState.conModOverride;
  const conMod = conOverride !== null && conOverride !== undefined
    ? Math.floor(toNumber(conOverride, 0))
    : getActorConMod(actorDocument);
  return Math.max(ENERGY_MIN_DAYS, Math.floor(ENERGY_BASE_DAYS + conMod));
}

function clampEnergyCurrent(memberState, actorDocument = null) {
  const maxEnergy = resolveEnergyMax(memberState, actorDocument);
  const current = Math.floor(toNumber(memberState.energyCurrent, maxEnergy));
  return {
    current: Math.max(0, Math.min(maxEnergy, current)),
    max: maxEnergy
  };
}

function sanitizeEmbeddedItemData(itemData) {
  const source = foundry.utils.deepClone(itemData);
  delete source._id;
  delete source.folder;
  delete source.sort;
  delete source.ownership;
  delete source._stats;
  return source;
}

function clearCraftOutputAttunement(itemData) {
  foundry.utils.setProperty(itemData, "system.attuned", false);
  const system = itemData?.system;
  if (!system || typeof system !== "object" || !Object.hasOwn(system, "attunement")) {
    return;
  }

  const attunement = system.attunement;
  if (attunement && typeof attunement === "object" && !Array.isArray(attunement)) {
    foundry.utils.setProperty(itemData, "system.attunement", {
      ...foundry.utils.deepClone(attunement),
      value: typeof attunement.value === "boolean" ? false : 0
    });
  }
  else if (typeof attunement === "boolean") {
    foundry.utils.setProperty(itemData, "system.attunement", false);
  }
  else if (typeof attunement === "string") {
    foundry.utils.setProperty(itemData, "system.attunement", "");
  }
  else {
    foundry.utils.setProperty(itemData, "system.attunement", 0);
  }
}

function getLegacyInventoryMergeKey(itemData) {
  const flags = foundry.utils.deepClone(itemData?.flags?.[MODULE_ID] ?? {});
  if (flags.sourceType && flags.sourceId) {
    return `source:${flags.sourceType}:${flags.sourceId}`;
  }

  return `custom:${normalizeText(itemData?.name)}:${itemData?.type ?? ""}`;
}

function buildInventoryMergeIndex(actor) {
  const index = new Map();
  for (const item of actor?.items?.contents ?? []) {
    const itemData = item.toObject?.() ?? item;
    const key = getLegacyInventoryMergeKey(itemData);
    if (key && !index.has(key)) {
      index.set(key, item);
    }
  }

  return index;
}

function buildLegacyInventorySourceMergeGroups(actor) {
  const groups = new Map();
  for (const sourceItem of actor?.items?.contents ?? []) {
    const sourceItemData = sanitizeEmbeddedItemData(sourceItem.toObject?.() ?? sourceItem);
    const quantity = roundNumber(getRawQuantity(sourceItemData), 2);
    if (quantity <= 0) {
      continue;
    }

    const key = getLegacyInventoryMergeKey(sourceItemData);
    const existing = groups.get(key);
    if (existing) {
      existing.quantity = roundNumber(existing.quantity + quantity, 2);
      continue;
    }

    groups.set(key, {
      key,
      itemData: sourceItemData,
      quantity
    });
  }

  return groups;
}

function getLegacyInventoryPairKey(legacyActorId, groupActorId) {
  return `${legacyActorId}::${groupActorId}`;
}

function getLegacyInventoryMergePairState(groupState, pairKey) {
  return groupState?.migration?.legacyInventoryMergePairs?.[pairKey] ?? {};
}

function getLegacyInventoryItemPairState(item, pairKey, itemKey) {
  return item?.flags?.[MODULE_ID]?.legacyInventoryItemMergePairs?.[pairKey]?.[itemKey] ?? {};
}

function getLegacyInventoryCurrencyPairState(actor, pairKey) {
  return actor?.flags?.[MODULE_ID]?.legacyInventoryCurrencyMergePairs?.[pairKey] ?? {};
}

function getLegacyInventoryCompletionPairState(legacyActor, pairKey) {
  const legacyFlag = legacyActor?.getFlag?.(MODULE_ID, "legacyInventoryMergedIntoGroup") ?? {};
  const pairState = legacyFlag.pairs?.[pairKey] ?? {};
  if (Number(pairState.completedAt) > 0) {
    return pairState;
  }

  const groupActorId = pairKey.split("::").slice(1).join("::");
  if (legacyFlag.groupActorId === groupActorId && Number(legacyFlag.mergedAt) > 0) {
    return {
      groupActorId,
      completedAt: Number(legacyFlag.mergedAt)
    };
  }

  return {};
}

function hasLegacyInventoryCompletionMarker(groupState, legacyActor, pairKey) {
  const pairState = getLegacyInventoryMergePairState(groupState, pairKey);
  if (Number(pairState.completedAt) > 0) {
    return true;
  }

  const legacyPairState = getLegacyInventoryCompletionPairState(legacyActor, pairKey);
  return Number(legacyPairState.completedAt) > 0;
}

function buildDefaultPartyState() {
  return {
    version: 1,
    inventoryActorId: "",
    defaultCapMod: DEFAULT_CAPACITY_MULTIPLIER,
    coverFoodExpenses: false,
    coverWaterExpenses: false,
    members: {}
  };
}

function buildDefaultMemberState(role = "member") {
  const defaults = PARTY_ROLE_DEFAULTS[normalizeRole(role)] ?? PARTY_ROLE_DEFAULTS.member;
  return {
    role: defaults.role,
    foodPerDay: defaults.foodPerDay,
    waterGalPerDay: defaults.waterGalPerDay,
    strOverride: null,
    capModOverride: null,
    capBonusLb: 0,
    conModOverride: null,
    energyCurrent: null,
    tools: normalizeToolsMap({})
  };
}

function buildSupplyItemData(resourceKey, quantity) {
  const isWater = resourceKey === "water";
  const name = isWater ? WATER_ITEM_NAME : FOOD_ITEM_NAME;
  const img = isWater ? WATER_SUPPLY_ICON : FOOD_SUPPLY_ICON;
  const weightPerUnit = isWater ? WATER_LB_PER_GALLON : 1;
  const description = isWater
    ? "<p>Общий запас воды группы. Количество считается в галлонах.</p>"
    : "<p>Общий запас еды группы. Количество считается в фунтах.</p>";

  return {
    name,
    type: "loot",
    img,
    system: {
      description: {
        value: description,
        chat: ""
      },
      unidentified: {
        description: ""
      },
      quantity: Math.max(0, roundNumber(quantity, 2)),
      price: {
        value: 0,
        denomination: "cp"
      },
      weight: {
        value: weightPerUnit,
        units: "lb"
      },
      type: {
        value: "loot",
        subtype: "Запасы"
      }
    },
    flags: {
      [MODULE_ID]: {
        managedPartySupply: true,
        resourceKey
      }
    }
  };
}

export class InventoryService {
  constructor(moduleApi) {
    this.moduleApi = moduleApi;
    this.lastGroupContextError = "";
    this.mutationCoordinator = moduleApi.worldMutationCoordinator ?? new WorldMutationCoordinator();
    this.mutationJournal = new DurableMutationJournal({
      readState: () => game.settings.get(MODULE_ID, SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL),
      writeState: (state) => game.settings.set(MODULE_ID, SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL, state),
      normalizeState: normalizeInventoryMutationJournal
    });
  }

  #normalizeMemberState(member, fallbackRole = "member") {
    const nextRole = normalizeRole(member?.role ?? fallbackRole);
    const defaults = PARTY_ROLE_DEFAULTS[nextRole] ?? PARTY_ROLE_DEFAULTS.member;
    const strOverride = parseNullableInteger(member?.strOverride, { min: 0 });
    const capModOverride = parseNullableDecimal(member?.capModOverride, { min: 1, precision: 2 });
    const conModOverride = parseNullableInteger(member?.conModOverride);
    const energyCurrent = parseNullableInteger(member?.energyCurrent, { min: 0 });

    return {
      role: nextRole,
      foodPerDay: Math.max(0, roundNumber(toNumber(member?.foodPerDay, defaults.foodPerDay), 2)),
      waterGalPerDay: Math.max(0, roundNumber(toNumber(member?.waterGalPerDay, defaults.waterGalPerDay), 2)),
      strOverride,
      capModOverride,
      capBonusLb: Math.max(0, roundNumber(toNumber(member?.capBonusLb, 0), 2)),
      conModOverride,
      energyCurrent,
      tools: normalizeToolsMap(member?.tools)
    };
  }

  #getState() {
    const rawState = game.settings.get(MODULE_ID, SETTINGS_KEYS.PARTY_STATE);
    const state = foundry.utils.mergeObject(buildDefaultPartyState(), foundry.utils.deepClone(rawState ?? {}));
    state.inventoryActorId = String(state.inventoryActorId ?? "").trim();
    state.defaultCapMod = Math.max(1, roundNumber(toNumber(state.defaultCapMod, DEFAULT_CAPACITY_MULTIPLIER), 2));
    state.coverFoodExpenses = state.coverFoodExpenses === true;
    state.coverWaterExpenses = state.coverWaterExpenses === true;
    state.members = state.members && typeof state.members === "object" ? state.members : {};

    for (const [actorId, member] of Object.entries(state.members)) {
      state.members[actorId] = this.#normalizeMemberState(member);
    }

    return state;
  }

  async #setState(nextState) {
    await game.settings.set(MODULE_ID, SETTINGS_KEYS.PARTY_STATE, nextState);
    return nextState;
  }

  #getGroupInventoryActor() {
    this.lastGroupContextError = "";
    try {
      const context = this.moduleApi.groupContextService?.resolveForCurrentUser?.();
      const groupActor = context?.groupActor ?? null;
      return groupActor?.type === "group" ? groupActor : null;
    }
    catch (error) {
      if (!GROUP_CONTEXT_FALLBACK_ERRORS.has(error?.message)) {
        throw error;
      }

      this.lastGroupContextError = error.message;
      return null;
    }
  }

  #getNativeGroupState(inventoryActor) {
    if (!this.#isNativeGroupInventoryActor(inventoryActor)) {
      return null;
    }
    const service = this.moduleApi.groupContextService;
    const context = service?.resolveForGroup?.(inventoryActor.id)
      ?? service?.resolveForCurrentUser?.()
      ?? null;
    const resolvedGroupId = cleanId(context?.groupId ?? context?.groupActor?.id);
    if (resolvedGroupId && resolvedGroupId !== cleanId(inventoryActor.id)) {
      return null;
    }
    return context?.groupState && typeof context.groupState === "object"
      ? context.groupState
      : null;
  }

  canManagePartyInventory(actor = null) {
    if (game.user?.isGM) {
      return true;
    }

    const inventoryActor = actor ?? (() => {
      const groupActor = this.#getGroupInventoryActor();
      if (groupActor) {
        return groupActor;
      }

      const state = this.#getState();
      return state.inventoryActorId ? game.actors.get(state.inventoryActorId) ?? null : null;
    })();
    return inventoryActor?.isOwner === true;
  }

  canDropInventoryItems(actor = null) {
    if (this.canManagePartyInventory(actor)) {
      return true;
    }

    try {
      const context = this.moduleApi.groupContextService?.resolveForCurrentUser?.();
      const groupActor = context?.groupActor ?? null;
      const inventoryActor = actor ?? groupActor;
      return Boolean(
        context?.canManage
        && groupActor?.id
        && inventoryActor?.id === groupActor.id
        && isManagedPartyGroup(groupActor)
      );
    }
    catch (error) {
      if (GROUP_CONTEXT_FALLBACK_ERRORS.has(error?.message)) {
        return false;
      }
      throw error;
    }
  }

  #assertCanManagePartyInventory(actor = null) {
    if (!this.canManagePartyInventory(actor)) {
      throw new Error("Партийным инвентарём управляют владельцы склада.");
    }
  }

  #assertActiveGmCraftMutation() {
    if (!isActiveGmClient()) {
      throw new Error("Craft inventory mutations can only be run by the active GM.");
    }
  }

  #craftExecutionContextError(error) {
    const normalized = error instanceof Error
      ? error
      : new Error(String(error ?? "Craft execution context changed."));
    CRAFT_EXECUTION_CONTEXT_ERRORS.add(normalized);
    return normalized;
  }

  #isCraftExecutionContextError(error) {
    return error instanceof Error && CRAFT_EXECUTION_CONTEXT_ERRORS.has(error);
  }

  #resolveCraftExecutionContext(options = {}) {
    const source = options && typeof options === "object" ? options : {};
    const requestedGroupId = cleanId(source.groupId);
    const guards = [...new Set([source.guard, source.assertExecutionContext].filter((guard) => guard != null))];
    if (guards.some((guard) => typeof guard !== "function")) {
      throw new TypeError("Craft execution guards must be functions.");
    }
    const groupContextService = this.moduleApi.groupContextService;
    if (typeof groupContextService?.resolveForGroup !== "function") {
      throw new Error("Craft inventory mutations require groupContextService.resolveForGroup().");
    }

    let resolved;
    try {
      this.#assertActiveGmCraftMutation();
      for (const guard of guards) guard();
      resolved = groupContextService.resolveForGroup(requestedGroupId);
    }
    catch (error) {
      throw this.#craftExecutionContextError(error);
    }

    const actor = resolved?.groupActor ?? null;
    const groupId = requestedGroupId || cleanId(resolved?.groupId) || cleanId(actor?.id);
    if (!actor?.id || !groupId || cleanId(actor.id) !== groupId) {
      throw this.#craftExecutionContextError(
        this.#inventoryReconciliationError("Craft execution group actor does not match the captured group.")
      );
    }
    const execution = Object.freeze({
      groupId,
      actorId: cleanId(actor.id),
      actor,
      guards: Object.freeze(guards)
    });
    this.#assertCraftExecutionContext(execution);
    return execution;
  }

  #assertCraftExecutionContext(execution) {
    try {
      this.#assertActiveGmCraftMutation();
      for (const guard of execution.guards) guard();
      const resolved = this.moduleApi.groupContextService.resolveForGroup(execution.groupId);
      if (cleanId(resolved?.groupId ?? resolved?.groupActor?.id) !== execution.groupId
        || cleanId(resolved?.groupActor?.id) !== execution.actorId) {
        throw this.#inventoryReconciliationError("Craft execution group changed during mutation.");
      }
    }
    catch (error) {
      throw this.#craftExecutionContextError(error);
    }
  }

  async #awaitCraftExecution(execution, operation) {
    this.#assertCraftExecutionContext(execution);
    let result;
    try {
      result = await operation();
    }
    catch (error) {
      this.#assertCraftExecutionContext(execution);
      throw error;
    }
    this.#assertCraftExecutionContext(execution);
    return result;
  }

  #findCraftMutationRecord(execution, operationId) {
    return this.#awaitCraftExecution(execution, () => this.mutationJournal.find(operationId));
  }

  #startCraftMutationRecord(execution, record) {
    return this.#awaitCraftExecution(execution, () => this.mutationJournal.start(record));
  }

  #checkpointCraftMutationRecord(execution, operationId, expectedPhase, nextPhase, patch = {}) {
    return this.#awaitCraftExecution(
      execution,
      () => this.mutationJournal.checkpoint(operationId, expectedPhase, nextPhase, patch)
    );
  }

  #finishCraftMutationRecord(execution, operationId, result) {
    return this.#awaitCraftExecution(execution, () => this.mutationJournal.finish(operationId, result));
  }

  #assertCraftMutationScope(record, execution, label) {
    if (cleanId(record?.groupId) !== execution.groupId || cleanId(record?.actorId) !== execution.actorId) {
      throw this.#inventoryReconciliationError(`${label} party inventory group or actor changed.`);
    }
  }

  #resolveRecipientCharacter(actorId = "", groupActor = null) {
    const safeActorId = cleanId(actorId);
    const explicitActor = safeActorId ? game.actors?.get?.(safeActorId) ?? null : null;
    const controlledActors = (globalThis.canvas?.tokens?.controlled ?? [])
      .map((token) => token?.actor)
      .filter(Boolean);
    const actor = [
      explicitActor,
      game.user?.character ?? null,
      ...controlledActors
    ].find((candidate) => candidate?.type === "character") ?? null;

    if (!actor) {
      throw new Error("Не выбран персонаж для получения предмета. Назначьте персонажа пользователю или выберите токен персонажа.");
    }

    const memberActor = resolveGroupMemberActor(groupActor, actor);
    if (isManagedPartyGroup(groupActor) && !memberActor) {
      throw new Error("Персонаж для получения предмета не входит в выбранную группу.");
    }

    if (!game.user?.isGM && actor.isOwner === false) {
      throw new Error("У вас нет прав на персонажа, который получает предмет.");
    }

    return memberActor ?? actor;
  }

  #assertInventoryActionSocketAvailable(actor) {
    if (!this.canDropInventoryItems(actor)) {
      throw new Error("У вас нет прав на действия с партийным складом.");
    }

    if (!cleanId(actor?.uuid) || typeof game.socket?.emit !== "function") {
      throw new Error("Не удалось отправить действие склада мастеру.");
    }
  }

  #emitInventoryItemActionRequest(action, payload = {}) {
    game.socket.emit(SOCKET_CHANNEL, {
      type: SOCKET_EVENT_INVENTORY_ITEM_ACTION_REQUEST,
      payload: {
        action,
        ...foundry.utils.deepClone(payload)
      },
      senderId: game.user?.id ?? ""
    });
  }

  #getInventoryItem(actor, itemId) {
    const safeItemId = cleanId(itemId);
    const item = safeItemId ? actor?.items?.get?.(safeItemId) ?? null : null;
    if (!item) {
      throw new Error("Предмет не найден в партийном инвентаре.");
    }
    return item;
  }

  async #depleteInventoryItem(item, quantity) {
    const currentQuantity = getRawQuantity(item.toObject());
    if (currentQuantity <= 0) {
      throw new Error("Inventory item quantity must be greater than zero before depletion.");
    }
    const safeQuantity = Math.max(0.01, Math.min(currentQuantity, roundNumber(toNumber(quantity, 1), 2)));
    const nextQuantity = roundNumber(currentQuantity - safeQuantity, 2);
    if (nextQuantity <= 0) {
      await item.delete();
    }
    else {
      await item.update({
        "system.quantity": nextQuantity
      });
    }

    return safeQuantity;
  }

  #findMutationItem(actor, mutationId) {
    return actor?.items?.contents?.find((item) => (
      cleanId(item.getFlag?.(MODULE_ID, INVENTORY_MUTATION_FLAG)?.id
        ?? item.flags?.[MODULE_ID]?.[INVENTORY_MUTATION_FLAG]?.id) === mutationId
    )) ?? null;
  }

  #readInventoryTerminal(record) {
    if (record?.terminal !== true) {
      return { terminal: false, value: undefined };
    }
    if (record.result?.ok === false) {
      const error = new Error(record.result.error || "Inventory mutation was compensated.");
      error.code = record.result.code || "inventory-mutation-failed";
      throw error;
    }
    return {
      terminal: true,
      value: foundry.utils.deepClone(record.result?.value)
    };
  }

  #inventoryReconciliationError(message) {
    const error = new Error(message);
    error.code = "reconciliation-required";
    return error;
  }

  #sourceReceiptState(actor, receipt) {
    const item = actor?.items?.get?.(receipt.itemId)
      ?? actor?.items?.contents?.find?.((candidate) => candidate.id === receipt.itemId)
      ?? null;
    if (!item) {
      return {
        item: null,
        applied: receipt.afterQuantity <= 0,
        before: false
      };
    }
    const quantity = getRawQuantity(item.toObject());
    return {
      item,
      applied: inventoryQuantitiesMatch(quantity, receipt.afterQuantity),
      before: inventoryQuantitiesMatch(quantity, receipt.beforeQuantity)
    };
  }

  async #applySourceReceipt(actor, receipt) {
    let state = this.#sourceReceiptState(actor, receipt);
    if (state.applied) {
      return;
    }
    if (!state.before || !state.item) {
      throw this.#inventoryReconciliationError("Inventory source quantity no longer matches the prepared receipt.");
    }
    try {
      await this.#depleteInventoryItem(state.item, receipt.delta);
    }
    catch (error) {
      state = this.#sourceReceiptState(actor, receipt);
      if (state.applied) {
        return;
      }
      throw error;
    }
    state = this.#sourceReceiptState(actor, receipt);
    if (!state.applied) {
      throw this.#inventoryReconciliationError("Inventory source debit was not observed after mutation.");
    }
  }

  #assertCraftMutationIdentity(record, kind, request) {
    const sameRequest = JSON.stringify(record?.request ?? null) === JSON.stringify(request);
    if (record?.kind === kind && sameRequest) {
      return;
    }
    const error = new Error(`Inventory mutation '${record?.id ?? ""}' conflicts with the craft request.`);
    error.code = "mutation-conflict";
    throw error;
  }

  #findMaterialInventoryItems(actor, sourceId) {
    const safeSourceId = cleanId(sourceId);
    if (!safeSourceId) {
      return [];
    }
    return collectionValues(actor?.items).filter((item) => {
      const flags = foundry.utils.deepClone(item?.flags?.[MODULE_ID] ?? {});
      const candidateIds = [flags.sourceId, flags.materialId, flags.predominantMaterialId]
        .map(cleanId)
        .filter(Boolean);
      return candidateIds.includes(safeSourceId)
        && normalizeInventorySourceType(flags.sourceType ?? "material") === "material";
    });
  }

  #findMaterialInventoryItem(actor, sourceId) {
    return this.#findMaterialInventoryItems(actor, sourceId)[0] ?? null;
  }

  #prepareCraftDebitReceipts(actor, request) {
    const receipts = [];
    const receiptByItemId = new Map();
    for (const resource of collectCraftMaterialResources(request)) {
      const items = this.#findMaterialInventoryItems(actor, resource.sourceId);
      if (!items.length) {
        throw new Error(`Craft material '${resource.sourceId}' was not found in party inventory.`);
      }
      let remaining = roundCraftQuantity(resource.quantity);
      const pendingComponents = resource.components.map((component) => foundry.utils.deepClone(component));
      for (const item of items) {
        if (remaining <= 1e-9) {
          break;
        }
        const existing = receiptByItemId.get(item.id);
        const beforeQuantity = existing?.afterQuantity
          ?? roundCraftQuantity(getRawQuantity(item.toObject()));
        const quantity = roundCraftQuantity(Math.min(beforeQuantity, remaining));
        if (quantity <= 0) {
          continue;
        }
        const afterQuantity = roundCraftQuantity(beforeQuantity - quantity);
        const components = takeCraftMaterialComponents(pendingComponents, quantity);
        if (existing) {
          existing.quantity = roundCraftQuantity(existing.quantity + quantity);
          existing.delta = existing.quantity;
          existing.afterQuantity = afterQuantity;
          existing.components.push(...components);
        }
        else {
          const receipt = {
            ...resource,
            quantity,
            components,
            sourceType: "material",
            itemId: item.id,
            itemUuid: cleanId(item.uuid),
            beforeQuantity,
            afterQuantity,
            delta: quantity
          };
          receipts.push(receipt);
          receiptByItemId.set(item.id, receipt);
        }
        remaining = roundCraftQuantity(remaining - quantity);
      }
      if (remaining > 1e-9) {
        throw new Error(`Not enough craft material '${resource.sourceId}' in party inventory.`);
      }
    }
    return receipts;
  }

  #craftReceiptItem(actor, receipt) {
    return actor?.items?.get?.(receipt.itemId)
      ?? collectionValues(actor?.items).find((item) => item?.id === receipt.itemId)
      ?? null;
  }

  async #updateCraftItemQuantity(item, quantity, execution) {
    try {
      await this.#awaitCraftExecution(
        execution,
        () => item.update({ "system.quantity": roundCraftQuantity(quantity) })
      );
    }
    catch (error) {
      if (this.#isCraftExecutionContextError(error)) {
        throw error;
      }
      if (!inventoryQuantitiesMatch(getRawQuantity(item.toObject()), quantity)) {
        throw error;
      }
    }
  }

  async #applyCraftDebitReceipt(actor, receipt, execution) {
    this.#assertCraftExecutionContext(execution);
    const item = this.#craftReceiptItem(actor, receipt);
    if (!item) {
      throw this.#inventoryReconciliationError("Craft reservation source item disappeared.");
    }
    const currentQuantity = getRawQuantity(item.toObject());
    if (inventoryQuantitiesMatch(currentQuantity, receipt.afterQuantity)) {
      return null;
    }
    if (!inventoryQuantitiesMatch(currentQuantity, receipt.beforeQuantity)) {
      throw this.#inventoryReconciliationError("Craft reservation source quantity changed before debit.");
    }
    await this.#updateCraftItemQuantity(item, receipt.afterQuantity, execution);
    if (!inventoryQuantitiesMatch(getRawQuantity(item.toObject()), receipt.afterQuantity)) {
      throw this.#inventoryReconciliationError("Craft reservation debit was not observed.");
    }
    return null;
  }

  async #compensateCraftDebitReceipt(actor, receipt, execution) {
    this.#assertCraftExecutionContext(execution);
    const item = this.#craftReceiptItem(actor, receipt);
    if (!item) {
      throw this.#inventoryReconciliationError("Craft reservation source item disappeared before compensation.");
    }
    const currentQuantity = getRawQuantity(item.toObject());
    if (inventoryQuantitiesMatch(currentQuantity, receipt.beforeQuantity)) {
      return;
    }
    if (!inventoryQuantitiesMatch(currentQuantity, receipt.afterQuantity)) {
      throw this.#inventoryReconciliationError("Craft reservation source changed before compensation.");
    }
    await this.#updateCraftItemQuantity(item, receipt.beforeQuantity, execution);
    if (!inventoryQuantitiesMatch(getRawQuantity(item.toObject()), receipt.beforeQuantity)) {
      throw this.#inventoryReconciliationError("Craft reservation compensation was not observed.");
    }
  }

  #findCraftMutationItem(actor, mutationId, receiptIndex) {
    return collectionValues(actor?.items).find((item) => {
      const marker = item?.getFlag?.(MODULE_ID, INVENTORY_MUTATION_FLAG)
        ?? item?.flags?.[MODULE_ID]?.[INVENTORY_MUTATION_FLAG]
        ?? {};
      return cleanId(marker.id) === mutationId && Number(marker.receiptIndex) === receiptIndex;
    }) ?? null;
  }

  async #prepareCraftCreditReceipts(actor, request, mutationId, execution) {
    const receipts = [];
    const receiptByTarget = new Map();

    for (const resource of collectCraftMaterialResources(request)) {
      const item = this.#findMaterialInventoryItem(actor, resource.sourceId);
      const targetKey = item ? `item:${item.id}` : `source:${resource.sourceId}`;
      const existing = receiptByTarget.get(targetKey);
      if (existing) {
        existing.quantity = roundCraftQuantity(existing.quantity + resource.quantity);
        existing.delta = existing.quantity;
        existing.afterQuantity = roundCraftQuantity(existing.beforeQuantity + existing.quantity);
        existing.components.push(...resource.components);
        if (existing.itemData) {
          foundry.utils.setProperty(existing.itemData, "system.quantity", existing.afterQuantity);
        }
        continue;
      }

      const beforeQuantity = item ? roundCraftQuantity(getRawQuantity(item.toObject())) : 0;
      const afterQuantity = roundCraftQuantity(beforeQuantity + resource.quantity);
      let itemData = null;
      if (!item) {
        const receiptIndex = receipts.length;
        itemData = await this.#awaitCraftExecution(
          execution,
          () => this.buildModelItemData("material", resource.sourceId, resource.quantity)
        );
        foundry.utils.setProperty(itemData, "system.quantity", afterQuantity);
        foundry.utils.setProperty(itemData, `flags.${MODULE_ID}.${INVENTORY_MUTATION_FLAG}`, {
          id: mutationId,
          kind: "craft-release",
          receiptIndex
        });
      }
      const receipt = {
        ...resource,
        sourceType: "material",
        itemId: item?.id ?? "",
        itemUuid: cleanId(item?.uuid),
        created: !item,
        itemData,
        beforeQuantity,
        afterQuantity,
        delta: resource.quantity
      };
      receipts.push(receipt);
      receiptByTarget.set(targetKey, receipt);
    }
    return receipts;
  }

  async #applyCraftCreditReceipt(actor, mutationId, receipt, receiptIndex, execution) {
    this.#assertCraftExecutionContext(execution);
    let item = receipt.created
      ? this.#findCraftMutationItem(actor, mutationId, receiptIndex)
      : this.#craftReceiptItem(actor, receipt);
    if (receipt.created) {
      if (!item) {
        try {
            [item] = await this.#awaitCraftExecution(
              execution,
              () => actor.createEmbeddedDocuments("Item", [receipt.itemData], { renderSheet: false })
            );
          }
          catch (error) {
            if (this.#isCraftExecutionContextError(error)) {
              throw error;
            }
          item = this.#findCraftMutationItem(actor, mutationId, receiptIndex);
          if (!item) {
            throw error;
          }
        }
      }
      if (!item || !inventoryQuantitiesMatch(getRawQuantity(item.toObject()), receipt.afterQuantity)) {
        throw this.#inventoryReconciliationError("Craft release item creation was not observed.");
      }
      return {
        itemId: item.id,
        itemUuid: cleanId(item.uuid)
      };
    }

    if (!item) {
      throw this.#inventoryReconciliationError("Craft release target item disappeared.");
    }
    const currentQuantity = getRawQuantity(item.toObject());
    if (!inventoryQuantitiesMatch(currentQuantity, receipt.afterQuantity)) {
      if (!inventoryQuantitiesMatch(currentQuantity, receipt.beforeQuantity)) {
        throw this.#inventoryReconciliationError("Craft release target quantity changed before credit.");
      }
      await this.#updateCraftItemQuantity(item, receipt.afterQuantity, execution);
    }
    if (!inventoryQuantitiesMatch(getRawQuantity(item.toObject()), receipt.afterQuantity)) {
      throw this.#inventoryReconciliationError("Craft release credit was not observed.");
    }
    return null;
  }

  async #compensateCraftCreditReceipt(actor, mutationId, receipt, receiptIndex, execution) {
    this.#assertCraftExecutionContext(execution);
    const item = receipt.created
      ? this.#findCraftMutationItem(actor, mutationId, receiptIndex)
      : this.#craftReceiptItem(actor, receipt);
    if (receipt.created) {
      if (!item) {
        return;
      }
      if (!inventoryQuantitiesMatch(getRawQuantity(item.toObject()), receipt.afterQuantity)) {
        throw this.#inventoryReconciliationError("Created craft release item changed before compensation.");
      }
      try {
        await this.#awaitCraftExecution(execution, () => item.delete());
      }
      catch (error) {
        if (this.#isCraftExecutionContextError(error)) {
          throw error;
        }
        if (this.#findCraftMutationItem(actor, mutationId, receiptIndex)) {
          throw error;
        }
      }
      return;
    }

    if (!item) {
      throw this.#inventoryReconciliationError("Craft release target disappeared before compensation.");
    }
    const currentQuantity = getRawQuantity(item.toObject());
    if (inventoryQuantitiesMatch(currentQuantity, receipt.beforeQuantity)) {
      return;
    }
    if (!inventoryQuantitiesMatch(currentQuantity, receipt.afterQuantity)) {
      throw this.#inventoryReconciliationError("Craft release target changed before compensation.");
    }
    await this.#updateCraftItemQuantity(item, receipt.beforeQuantity, execution);
  }

  #craftReceiptAppliedCount(record) {
    if (record.phase === "prepared") {
      return 0;
    }
    if (record.phase === "committed") {
      return record.receipts.length;
    }
    const match = /^receipt-(\d+)-applied$/u.exec(record.phase);
    return match ? Number(match[1]) : null;
  }

  async #compensateAtomicCraftReceipts(actor, record, error, compensateReceipt, execution) {
    const originalError = error ?? Object.assign(
      new Error(record.failure?.message || "Craft inventory mutation failed."),
      { code: record.failure?.code || "craft-inventory-failed" }
    );
    if (record.phase === "compensated") {
      await this.#finishCraftMutationRecord(execution, record.id, {
        ok: false,
        code: originalError.code ?? "craft-inventory-failed",
        error: originalError.message
      });
      throw originalError;
    }

    try {
      if (record.phase !== "compensating") {
        record = await this.#checkpointCraftMutationRecord(execution, record.id, record.phase, "compensating", {
          failure: {
            code: originalError.code ?? "craft-inventory-failed",
            message: originalError.message
          }
        });
      }
      for (let index = record.receipts.length - 1; index >= 0; index -= 1) {
        await this.#awaitCraftExecution(
          execution,
          () => compensateReceipt(record.receipts[index], index)
        );
        record = await this.#checkpointCraftMutationRecord(execution, record.id, "compensating", "compensating", {
          compensatedThrough: index
        });
      }
      record = await this.#checkpointCraftMutationRecord(execution, record.id, "compensating", "compensated");
    }
    catch (compensationError) {
      if (this.#isCraftExecutionContextError(compensationError)) {
        throw compensationError;
      }
      try {
        await this.#checkpointCraftMutationRecord(execution, record.id, record.phase, "reconciliation-required", {
          compensationFailure: {
            code: compensationError.code ?? "craft-compensation-failed",
            message: compensationError.message
          }
        });
      }
      catch {
        // Preserve both document failures below.
      }
      throw new AggregateError([originalError, compensationError], "Craft inventory mutation and compensation both failed.");
    }

    await this.#finishCraftMutationRecord(execution, record.id, {
      ok: false,
      code: originalError.code ?? "craft-inventory-failed",
      error: originalError.message
    });
    throw originalError;
  }

  async #executeAtomicCraftReceipts(actor, record, execution, { applyReceipt, compensateReceipt }) {
    const terminal = this.#readInventoryTerminal(record);
    if (terminal.terminal) {
      return terminal.value;
    }
    if (record.phase === "reconciliation-required") {
      throw this.#inventoryReconciliationError("Craft inventory mutation requires reconciliation.");
    }
    if (record.phase === "compensating" || record.phase === "compensated") {
      return this.#compensateAtomicCraftReceipts(actor, record, null, compensateReceipt, execution);
    }

    let completedCount = this.#craftReceiptAppliedCount(record);
    if (completedCount === null || completedCount > record.receipts.length) {
      throw this.#inventoryReconciliationError("Craft inventory mutation has an unknown journal phase.");
    }
    try {
      while (completedCount < record.receipts.length) {
        const receiptIndex = completedCount;
        const receiptPatch = await this.#awaitCraftExecution(
          execution,
          () => applyReceipt(record.receipts[receiptIndex], receiptIndex)
        );
        const nextReceipts = foundry.utils.deepClone(record.receipts);
        if (receiptPatch) {
          nextReceipts[receiptIndex] = {
            ...nextReceipts[receiptIndex],
            ...receiptPatch
          };
        }
        record = await this.#checkpointCraftMutationRecord(
          execution,
          record.id,
          record.phase,
          `receipt-${receiptIndex + 1}-applied`,
          { receipts: nextReceipts }
        );
        completedCount += 1;
      }
    }
    catch (error) {
      if (this.#isCraftExecutionContextError(error)) {
        throw error;
      }
      return this.#compensateAtomicCraftReceipts(actor, record, error, compensateReceipt, execution);
    }

    if (record.phase !== "committed") {
      record = await this.#checkpointCraftMutationRecord(execution, record.id, record.phase, "committed");
    }
    const result = record.receipts.map(({ itemData: _itemData, ...receipt }) => receipt);
    await this.#finishCraftMutationRecord(execution, record.id, { ok: true, value: result });
    return foundry.utils.deepClone(result);
  }

  #findCraftOutputItem(actor, mutationId, outputIndex) {
    return collectionValues(actor?.items).find((item) => {
      const marker = item?.getFlag?.(MODULE_ID, INVENTORY_MUTATION_FLAG)
        ?? item?.flags?.[MODULE_ID]?.[INVENTORY_MUTATION_FLAG]
        ?? {};
      return cleanId(marker.id) === mutationId
        && marker.kind === "craft-output"
        && Number(marker.outputIndex) === outputIndex;
    }) ?? null;
  }

  async #loadCraftGearSourceData(output, execution = null) {
    const run = (operation) => execution
      ? this.#awaitCraftExecution(execution, operation)
      : operation();
    const packId = `world.${GEAR_COMPENDIUM_NAME}`;
    const pack = game.packs?.get?.(packId) ?? null;
    const actualPackId = cleanId(pack?.collection ?? pack?.metadata?.id);
    if (!pack || actualPackId !== packId) {
      throw new Error(`Craft gear requires the canonical managed ${packId} source.`);
    }

    let document = null;
    if (output.sourceDocumentId) {
      document = await run(() => pack.getDocument(output.sourceDocumentId));
      if (!document) {
        throw new Error(`Craft gear source document '${output.sourceDocumentId}' was not found in ${packId}.`);
      }
    }
    else {
      const index = await run(() => pack.getIndex({
        fields: [
          `flags.${MODULE_ID}.managed`,
          `flags.${MODULE_ID}.gearId`,
          `flags.${MODULE_ID}.sourceId`,
          `flags.${MODULE_ID}.sourceType`
        ]
      }));
      const entry = collectionValues(index).find((candidate) => {
        const flags = foundry.utils.deepClone(candidate?.flags?.[MODULE_ID] ?? {});
        const sourceType = normalizeInventorySourceType(flags.sourceType);
        const sourceIds = [flags.gearId, flags.sourceId].map(cleanId).filter(Boolean);
        return flags.managed === true
          && sourceType === "gear"
          && sourceIds.length > 0
          && sourceIds.every((sourceId) => sourceId === output.sourceId);
      }) ?? null;
      document = entry ? await run(() => pack.getDocument(entry._id ?? entry.id)) : null;
    }
    if (!document) {
      throw new Error(`Craft gear '${output.sourceId}' was not found in ${packId}.`);
    }

    const sourceData = document.toObject?.() ?? null;
    const flags = foundry.utils.deepClone(sourceData?.flags?.[MODULE_ID] ?? {});
    const sourceIds = [flags.gearId, flags.sourceId].map(cleanId).filter(Boolean);
    const documentUuid = cleanId(document.uuid);
    if (!sourceData
      || flags.managed !== true
      || normalizeInventorySourceType(flags.sourceType) !== "gear"
      || sourceIds.length === 0
      || sourceIds.some((sourceId) => sourceId !== output.sourceId)
      || (documentUuid && !documentUuid.startsWith(`Compendium.${packId}.`))) {
      throw new Error(`Craft gear '${output.sourceId}' requires a matching managed canonical source document.`);
    }
    if (isMagicalInventoryItem(sourceData)) {
      throw new Error("Magic items cannot be created as craft outputs.");
    }
    return foundry.utils.deepClone(sourceData);
  }

  #buildCraftOutputItemData(sourceData, output, mutationId, outputIndex) {
    if (!sourceData) {
      throw new Error(`Craft gear '${output.sourceId}' has no source document data.`);
    }
    const itemData = sanitizeEmbeddedItemData(sourceData);
    foundry.utils.setProperty(itemData, "system.quantity", output.quantity);
    foundry.utils.setProperty(itemData, "system.equipped", false);
    clearCraftOutputAttunement(itemData);
    itemData.flags = itemData.flags && typeof itemData.flags === "object" ? itemData.flags : {};
    const moduleFlags = {
      ...(itemData.flags[MODULE_ID] ?? {}),
      sourceType: "gear",
      sourceId: output.sourceId,
      gearId: output.sourceId,
      crafted: true,
      [INVENTORY_MUTATION_FLAG]: {
        id: mutationId,
        kind: "craft-output",
        outputIndex
      }
    };
    delete moduleFlags.held;
    delete moduleFlags.isHeld;
    delete moduleFlags.heldHands;
    delete moduleFlags.versatileBaseDamageOriginal;
    delete moduleFlags.durability;
    itemData.flags[MODULE_ID] = moduleFlags;
    return itemData;
  }

  #resolveCraftOutputItems(actor, outputs) {
    return outputs.map((output, outputIndex) => {
      const item = this.#findCraftOutputItem(actor, output.mutationId, outputIndex)
        ?? this.#craftReceiptItem(actor, { itemId: output.itemId });
      if (!item) {
        throw this.#inventoryReconciliationError("Craft output item disappeared after creation.");
      }
      return item;
    });
  }

  #craftOutputCreatedCount(record) {
    if (record.phase === "prepared") {
      return 0;
    }
    if (record.phase === "committed") {
      return record.outputs.length;
    }
    const match = /^output-(\d+)-created$/u.exec(record.phase);
    return match ? Number(match[1]) : null;
  }

  async #compensateCreatedMutationItem(actor, mutationId, expectedQuantity) {
    const created = this.#findMutationItem(actor, mutationId);
    if (!created) {
      return;
    }
    if (!inventoryQuantitiesMatch(getRawQuantity(created.toObject()), expectedQuantity)) {
      throw this.#inventoryReconciliationError("Created inventory target changed before compensation.");
    }
    try {
      await created.delete();
    }
    catch (error) {
      if (this.#findMutationItem(actor, mutationId)) {
        throw error;
      }
    }
    if (this.#findMutationItem(actor, mutationId)) {
      throw this.#inventoryReconciliationError("Created inventory target still exists after compensation.");
    }
  }

  #takeInventoryItemFromActor(inventoryActor, itemId, targetActor, quantity = 1, options = {}) {
    return this.mutationCoordinator.run(
      "inventory",
      () => this.#executeTakeInventoryItem(inventoryActor, itemId, targetActor, quantity, options)
    );
  }

  async #executeTakeInventoryItem(inventoryActor, itemId, targetActor, quantity = 1, { mutationId = "" } = {}) {
    if (!isActorDocument(targetActor) || targetActor.type !== "character") {
      throw new Error("Предмет можно забрать только в лист персонажа.");
    }
    const operationId = createInventoryMutationId("inventory-take", mutationId);
    let record = await this.mutationJournal.find(operationId);
    if (!record) {
      const item = this.#getInventoryItem(inventoryActor, itemId);
      const itemData = sanitizeEmbeddedItemData(item.toObject());
      const beforeQuantity = getRawQuantity(itemData);
      if (beforeQuantity <= 0) {
        throw new Error("Inventory item quantity must be greater than zero to take it.");
      }
      const takeQuantity = Math.max(0.01, Math.min(beforeQuantity, roundNumber(toNumber(quantity, 1), 2)));
      foundry.utils.setProperty(itemData, "system.quantity", takeQuantity);
      foundry.utils.setProperty(itemData, `flags.${MODULE_ID}.${INVENTORY_MUTATION_FLAG}`, {
        id: operationId,
        kind: "take"
      });
      record = await this.mutationJournal.start({
        id: operationId,
        kind: "take",
        phase: "prepared",
        sourceActorId: inventoryActor.id,
        targetActorId: targetActor.id,
        itemName: item.name,
        targetItemData: itemData,
        sourceReceipt: {
          itemId: item.id,
          beforeQuantity,
          afterQuantity: roundNumber(beforeQuantity - takeQuantity, 2),
          delta: takeQuantity
        }
      });
    }

    const terminal = this.#readInventoryTerminal(record);
    if (terminal.terminal) {
      return terminal.value;
    }
    if (record.phase === "prepared") {
      let createdItem = this.#findMutationItem(targetActor, operationId);
      if (!createdItem) {
        try {
          [createdItem] = await targetActor.createEmbeddedDocuments("Item", [record.targetItemData], {
            renderSheet: false
          });
        }
        catch (error) {
          createdItem = this.#findMutationItem(targetActor, operationId);
          if (!createdItem) throw error;
        }
      }
      if (!createdItem) {
        throw this.#inventoryReconciliationError("Created inventory target could not be resolved.");
      }
      record = await this.mutationJournal.checkpoint(operationId, "prepared", "target-created", {
        createdItemId: createdItem.id
      });
    }
    if (record.phase === "target-created") {
      try {
        await this.#applySourceReceipt(inventoryActor, record.sourceReceipt);
      }
      catch (error) {
        try {
          await this.#compensateCreatedMutationItem(
            targetActor,
            operationId,
            record.sourceReceipt.delta
          );
          record = await this.mutationJournal.checkpoint(operationId, "target-created", "compensated", {
            failure: { code: error.code ?? "source-debit-failed", message: error.message }
          });
          await this.mutationJournal.finish(operationId, {
            ok: false,
            code: error.code ?? "source-debit-failed",
            error: error.message
          });
        }
        catch (compensationError) {
          try {
            await this.mutationJournal.checkpoint(operationId, "target-created", "reconciliation-required", {
              failure: { code: error.code ?? "source-debit-failed", message: error.message },
              compensationFailure: { code: compensationError.code ?? "target-compensation-failed", message: compensationError.message }
            });
          }
          catch {
            // Preserve the compound failure below.
          }
          throw new AggregateError([error, compensationError], "Inventory take and compensation both failed.");
        }
        throw error;
      }
      record = await this.mutationJournal.checkpoint(operationId, "target-created", "source-debited");
    }
    if (record.phase === "source-debited") {
      record = await this.mutationJournal.checkpoint(operationId, "source-debited", "committed");
    }
    const createdItem = this.#findMutationItem(targetActor, operationId);
    const result = {
      itemName: record.itemName,
      quantity: record.sourceReceipt.delta,
      actorId: targetActor.id,
      createdItemId: createdItem?.id ?? record.createdItemId ?? ""
    };
    await this.mutationJournal.finish(operationId, { ok: true, value: result });
    return foundry.utils.deepClone(result);
  }

  async #deleteInventoryItemFromActor(inventoryActor, itemId) {
    const item = this.#getInventoryItem(inventoryActor, itemId);
    await item.delete();
    return {
      itemId,
      itemName: item.name
    };
  }

  #sellInventoryItemFromActor(inventoryActor, itemId, quantity = 1, options = {}) {
    return this.mutationCoordinator.run(
      "inventory",
      () => this.#executeSellInventoryItem(inventoryActor, itemId, quantity, options)
    );
  }

  async #executeSellInventoryItem(inventoryActor, itemId, quantity = 1, { mutationId = "" } = {}) {
    const operationId = createInventoryMutationId("inventory-sale", mutationId);
    let record = await this.mutationJournal.find(operationId);
    if (!record) {
      const item = this.#getInventoryItem(inventoryActor, itemId);
      const itemData = item.toObject();
      if (isMagicalInventoryItem(itemData)) {
        throw new Error("Магические предметы нельзя продать через партийный склад.");
      }
      const currentQuantity = getRawQuantity(itemData);
      if (currentQuantity <= 0) {
        throw new Error("Inventory item quantity must be greater than zero to sell it.");
      }
      const sellQuantity = Math.max(0.01, Math.min(currentQuantity, roundNumber(toNumber(quantity, 1), 2)));
      const unitCopper = priceToCopper(foundry.utils.getProperty(itemData, "system.price") ?? {});
      const gainedCopper = Math.floor((unitCopper * sellQuantity) / 2);
      if (gainedCopper <= 0) {
        throw new Error("У предмета нет цены для продажи.");
      }
      const beforeCopper = actorCurrencyToCopper(inventoryActor);
      record = await this.mutationJournal.start({
        id: operationId,
        kind: "sale",
        phase: "prepared",
        actorId: inventoryActor.id,
        itemName: item.name,
        gainedCopper,
        sourceReceipt: {
          itemId: item.id,
          beforeQuantity: currentQuantity,
          afterQuantity: roundNumber(currentQuantity - sellQuantity, 2),
          delta: sellQuantity,
          rawItemData: itemData
        },
        currencyReceipt: {
          beforeCopper,
          afterCopper: beforeCopper + gainedCopper
        }
      });
    }

    const terminal = this.#readInventoryTerminal(record);
    if (terminal.terminal) {
      return terminal.value;
    }
    if (record.phase === "prepared") {
      const receipt = record.currencyReceipt;
      const currentCopper = actorCurrencyToCopper(inventoryActor);
      if (currentCopper !== receipt.afterCopper) {
        if (currentCopper !== receipt.beforeCopper) {
          throw this.#inventoryReconciliationError("Inventory sale currency no longer matches the prepared receipt.");
        }
        try {
          await inventoryActor.update(buildCurrencyUpdatePatch(copperToCurrency(receipt.afterCopper)));
        }
        catch (error) {
          if (actorCurrencyToCopper(inventoryActor) !== receipt.afterCopper) throw error;
        }
      }
      record = await this.mutationJournal.checkpoint(operationId, "prepared", "currency-credited");
    }
    if (record.phase === "currency-credited") {
      try {
        await this.#applySourceReceipt(inventoryActor, record.sourceReceipt);
      }
      catch (error) {
        try {
          const currentCopper = actorCurrencyToCopper(inventoryActor);
          if (currentCopper === record.currencyReceipt.afterCopper) {
            try {
              await inventoryActor.update(buildCurrencyUpdatePatch(copperToCurrency(record.currencyReceipt.beforeCopper)));
            }
            catch (compensationError) {
              if (actorCurrencyToCopper(inventoryActor) !== record.currencyReceipt.beforeCopper) {
                throw compensationError;
              }
            }
          }
          else if (currentCopper !== record.currencyReceipt.beforeCopper) {
            throw this.#inventoryReconciliationError("Inventory sale currency changed before compensation.");
          }
          if (actorCurrencyToCopper(inventoryActor) !== record.currencyReceipt.beforeCopper) {
            throw this.#inventoryReconciliationError("Inventory sale currency was not restored by compensation.");
          }
          record = await this.mutationJournal.checkpoint(operationId, "currency-credited", "compensated", {
            failure: { code: error.code ?? "source-debit-failed", message: error.message }
          });
          await this.mutationJournal.finish(operationId, {
            ok: false,
            code: error.code ?? "source-debit-failed",
            error: error.message
          });
        }
        catch (compensationError) {
          try {
            await this.mutationJournal.checkpoint(operationId, "currency-credited", "reconciliation-required", {
              failure: { code: error.code ?? "source-debit-failed", message: error.message },
              compensationFailure: { code: compensationError.code ?? "currency-compensation-failed", message: compensationError.message }
            });
          }
          catch {
            // Preserve the compound failure below.
          }
          throw new AggregateError([error, compensationError], "Inventory sale and compensation both failed.");
        }
        throw error;
      }
      record = await this.mutationJournal.checkpoint(operationId, "currency-credited", "source-debited");
    }
    if (record.phase === "source-debited") {
      record = await this.mutationJournal.checkpoint(operationId, "source-debited", "committed");
    }
    const result = {
      itemName: record.itemName,
      quantity: record.sourceReceipt.delta,
      gainedCopper: record.gainedCopper,
      currency: buildCurrencySnapshot(inventoryActor)
    };
    await this.mutationJournal.finish(operationId, { ok: true, value: result });
    return foundry.utils.deepClone(result);
  }

  async #applyDismantleTargetReceipt(actor, operationId, record) {
    const receipt = record.targetReceipt;
    let item = receipt.created
      ? this.#findMutationItem(actor, operationId)
      : actor.items.get(receipt.itemId);
    if (receipt.created) {
      if (!item) {
        try {
          [item] = await actor.createEmbeddedDocuments("Item", [record.materialItemData]);
        }
        catch (error) {
          item = this.#findMutationItem(actor, operationId);
          if (!item) throw error;
        }
      }
    }
    else {
      if (!item) throw this.#inventoryReconciliationError("Inventory dismantle material target disappeared.");
      const currentQuantity = getRawQuantity(item.toObject());
      if (!inventoryQuantitiesMatch(currentQuantity, receipt.afterQuantity)) {
        if (!inventoryQuantitiesMatch(currentQuantity, receipt.beforeQuantity)) {
          throw this.#inventoryReconciliationError("Inventory dismantle material quantity changed.");
        }
        try {
          await item.update({ "system.quantity": receipt.afterQuantity });
        }
        catch (error) {
          if (!inventoryQuantitiesMatch(getRawQuantity(item.toObject()), receipt.afterQuantity)) throw error;
        }
      }
    }
    if (!item || !inventoryQuantitiesMatch(getRawQuantity(item.toObject()), receipt.afterQuantity)) {
      throw this.#inventoryReconciliationError("Inventory dismantle material credit was not observed.");
    }
    return item;
  }

  async #compensateDismantleTargetReceipt(actor, operationId, record) {
    const receipt = record.targetReceipt;
    let item = receipt.created
      ? this.#findMutationItem(actor, operationId)
      : actor.items.get(receipt.itemId);
    if (!item) {
      if (receipt.created) return;
      throw this.#inventoryReconciliationError("Inventory dismantle material target disappeared before compensation.");
    }
    const currentQuantity = getRawQuantity(item.toObject());
    if (receipt.created) {
      if (!inventoryQuantitiesMatch(currentQuantity, receipt.afterQuantity)) {
        throw this.#inventoryReconciliationError("Created dismantle material changed before compensation.");
      }
      try {
        await item.delete();
      }
      catch (error) {
        item = this.#findMutationItem(actor, operationId);
        if (item) throw error;
      }
      if (this.#findMutationItem(actor, operationId)) {
        throw this.#inventoryReconciliationError("Created dismantle material still exists after compensation.");
      }
      return;
    }
    if (inventoryQuantitiesMatch(currentQuantity, receipt.beforeQuantity)) return;
    if (!inventoryQuantitiesMatch(currentQuantity, receipt.afterQuantity)) {
      throw this.#inventoryReconciliationError("Merged dismantle material changed before compensation.");
    }
    try {
      await item.update({ "system.quantity": receipt.beforeQuantity });
    }
    catch (error) {
      if (!inventoryQuantitiesMatch(getRawQuantity(item.toObject()), receipt.beforeQuantity)) throw error;
    }
    if (!inventoryQuantitiesMatch(getRawQuantity(item.toObject()), receipt.beforeQuantity)) {
      throw this.#inventoryReconciliationError("Merged dismantle material was not restored by compensation.");
    }
  }

  async #repairLegacyFractionalDismantleMutations(actor) {
    const actorId = cleanId(actor?.id);
    const state = normalizeInventoryMutationJournal(
      game.settings.get(MODULE_ID, SETTINGS_KEYS.INVENTORY_MUTATION_JOURNAL)
    );
    const fractionalRecords = state.records.filter((record) => {
      const afterQuantity = Number(record?.targetReceipt?.afterQuantity);
      return record?.kind === "dismantle"
        && record?.phase === "prepared"
        && cleanId(record?.actorId) === actorId
        && Number.isFinite(afterQuantity)
        && afterQuantity > 0
        && !Number.isSafeInteger(afterQuantity);
    });
    const records = fractionalRecords
      .filter((record) => record?.terminal !== true)
      .reverse();
    const missingMergeWasCreatedByLegacyCredit = (record) => {
      const receipt = record?.targetReceipt ?? {};
      const materialIdentity = inventoryStackIdentity(record?.materialItemData);
      if (!materialIdentity) return false;
      return fractionalRecords.some((candidate) => {
        const candidateReceipt = candidate?.targetReceipt ?? {};
        const candidateId = cleanId(candidate?.id);
        return candidateReceipt.created === true
          && candidateId
          && (candidate?.terminal !== true
            || candidate?.result?.code === "legacy-fractional-dismantle-repaired")
          && cleanId(candidate?.request?.actorId) === actorId
          && cleanId(candidate?.request?.itemId) === cleanId(record?.request?.itemId)
          && Number(candidate?.request?.quantity) === Number(record?.request?.quantity)
          && cleanId(candidate?.sourceReceipt?.itemId) === cleanId(record?.sourceReceipt?.itemId)
          && inventoryQuantitiesMatch(
            candidate?.sourceReceipt?.beforeQuantity,
            record?.sourceReceipt?.beforeQuantity
          )
          && inventoryQuantitiesMatch(
            candidate?.sourceReceipt?.afterQuantity,
            record?.sourceReceipt?.afterQuantity
          )
          && inventoryQuantitiesMatch(candidate?.sourceReceipt?.delta, record?.sourceReceipt?.delta)
          && inventoryStackIdentity(candidate?.materialItemData) === materialIdentity
          && inventoryQuantitiesMatch(
            Math.max(0, Math.round(Number(candidateReceipt.afterQuantity))),
            receipt.beforeQuantity
          )
          && !this.#findMutationItem(actor, candidateId);
      });
    };

    for (const record of records) {
      const recordId = cleanId(record.id);
      if (!recordId
        || cleanId(record.request?.actorId) !== actorId
        || cleanId(record.request?.itemId) !== cleanId(record.sourceReceipt?.itemId)) {
        throw this.#inventoryReconciliationError("Legacy fractional dismantle record has an invalid request scope.");
      }
      const sourceState = this.#sourceReceiptState(actor, record.sourceReceipt);
      if (!sourceState.before) {
        throw this.#inventoryReconciliationError(
          `Legacy fractional dismantle '${recordId}' source changed before repair.`
        );
      }

      const receipt = record.targetReceipt;
      const coercedAfterQuantity = Math.max(0, Math.round(Number(receipt.afterQuantity)));
      let targetItem = receipt.created
        ? this.#findMutationItem(actor, recordId)
        : actor.items.get(cleanId(receipt.itemId));
      if (receipt.created) {
        if (targetItem) {
          if (!inventoryQuantitiesMatch(getRawQuantity(targetItem.toObject()), coercedAfterQuantity)) {
            throw this.#inventoryReconciliationError(
              `Legacy fractional dismantle '${record.id}' created target changed before repair.`
            );
          }
          try {
            await targetItem.delete();
          }
          catch (error) {
            targetItem = this.#findMutationItem(actor, recordId);
            if (targetItem) throw error;
          }
          if (this.#findMutationItem(actor, recordId)) {
            throw this.#inventoryReconciliationError(
              `Legacy fractional dismantle '${record.id}' created target still exists after repair.`
            );
          }
        }
      }
      else {
        if (!targetItem) {
          if (!missingMergeWasCreatedByLegacyCredit(record)) {
            throw this.#inventoryReconciliationError(
              `Legacy fractional dismantle '${record.id}' merge target disappeared before repair.`
            );
          }
        }
        else {
          const currentQuantity = getRawQuantity(targetItem.toObject());
          if (!inventoryQuantitiesMatch(currentQuantity, receipt.beforeQuantity)) {
            if (!inventoryQuantitiesMatch(currentQuantity, coercedAfterQuantity)) {
              throw this.#inventoryReconciliationError(
                `Legacy fractional dismantle '${record.id}' merge target changed before repair.`
              );
            }
            try {
              await targetItem.update({ "system.quantity": receipt.beforeQuantity });
            }
            catch (error) {
              if (!inventoryQuantitiesMatch(getRawQuantity(targetItem.toObject()), receipt.beforeQuantity)) throw error;
            }
            if (!inventoryQuantitiesMatch(getRawQuantity(targetItem.toObject()), receipt.beforeQuantity)) {
              throw this.#inventoryReconciliationError(
                `Legacy fractional dismantle '${record.id}' merge target was not restored.`
              );
            }
          }
        }
      }

      await this.mutationJournal.finish(recordId, {
        ok: false,
        code: "legacy-fractional-dismantle-repaired",
        error: "Legacy fractional dismantle credit was compensated before retry."
      });
    }
  }

  #dismantleInventoryItemFromActor(inventoryActor, itemId, quantity = 1, options = {}) {
    return this.mutationCoordinator.run(
      "inventory",
      async () => {
        await this.#repairLegacyFractionalDismantleMutations(inventoryActor);
        return this.#executeDismantleInventoryItem(inventoryActor, itemId, quantity, options);
      }
    );
  }

  async #executeDismantleInventoryItem(inventoryActor, itemId, quantity = 1, { mutationId = "" } = {}) {
    const operationId = createInventoryMutationId("inventory-dismantle", mutationId);
    const requestedQuantity = Math.max(1, Math.floor(toNumber(quantity, 1)));
    const request = {
      actorId: cleanId(inventoryActor?.id),
      itemId: cleanId(itemId),
      quantity: requestedQuantity
    };
    let record = await this.mutationJournal.find(operationId);
    if (record && JSON.stringify(record.request ?? null) !== JSON.stringify(request)) {
      throw new Error("Inventory dismantle mutation ID was reused with a different request.");
    }
    if (!record) {
      const item = this.#getInventoryItem(inventoryActor, itemId);
      const model = await this.moduleApi.getModel();
      const itemData = item.toObject();
      const currentQuantity = getRawQuantity(itemData);
      const breakQuantity = Math.max(1, Math.min(currentQuantity, requestedQuantity));
      const minimumQuantity = resolveInventoryDismantleMinimumQuantity(itemData, { model });
      if (minimumQuantity !== null && breakQuantity < minimumQuantity) {
        throw new Error(
          `Из выбранного количества не получается целой единицы материала. Нужно разобрать минимум ${minimumQuantity} шт.`
        );
      }
      const [output] = resolveInventoryDismantleOutputs(itemData, breakQuantity, { model });
      const material = output
        ? model.materialById?.get(output.sourceId) ?? null
        : null;
      if (!output || !material) {
        throw new Error("Для этого предмета не найден подходящий материал.");
      }
      const materialItemData = this.#buildMaterialItemData(material, output.quantity);
      const target = this.#findInventoryMergeCandidate(inventoryActor, materialItemData);
      const targetBeforeQuantity = target ? getRawQuantity(target.toObject()) : 0;
      if (!target) {
        foundry.utils.setProperty(materialItemData, `flags.${MODULE_ID}.${INVENTORY_MUTATION_FLAG}`, {
          id: operationId,
          kind: "dismantle"
        });
      }
      record = await this.mutationJournal.start({
        id: operationId,
        kind: "dismantle",
        phase: "prepared",
        request,
        actorId: inventoryActor.id,
        itemName: item.name,
        materialName: material.name,
        materialWeight: output.quantity,
        materialItemData,
        sourceReceipt: {
          itemId: item.id,
          beforeQuantity: currentQuantity,
          afterQuantity: roundNumber(currentQuantity - breakQuantity, 2),
          delta: breakQuantity
        },
        targetReceipt: {
          itemId: target?.id ?? "",
          created: !target,
          beforeQuantity: targetBeforeQuantity,
          afterQuantity: roundNumber(targetBeforeQuantity + output.quantity, 2),
          delta: output.quantity
        }
      });
    }

    const terminal = this.#readInventoryTerminal(record);
    if (terminal.terminal) return terminal.value;
    if (record.phase === "prepared") {
      const targetItem = await this.#applyDismantleTargetReceipt(inventoryActor, operationId, record);
      record = await this.mutationJournal.checkpoint(operationId, "prepared", "target-credited", {
        targetItemId: targetItem.id
      });
    }
    if (record.phase === "target-credited") {
      await this.#applyDismantleTargetReceipt(inventoryActor, operationId, record);
      try {
        await this.#applySourceReceipt(inventoryActor, record.sourceReceipt);
      }
      catch (error) {
        try {
          await this.#compensateDismantleTargetReceipt(inventoryActor, operationId, record);
          record = await this.mutationJournal.checkpoint(operationId, "target-credited", "compensated", {
            failure: { code: error.code ?? "source-debit-failed", message: error.message }
          });
          await this.mutationJournal.finish(operationId, {
            ok: false,
            code: error.code ?? "source-debit-failed",
            error: error.message
          });
        }
        catch (compensationError) {
          try {
            await this.mutationJournal.checkpoint(operationId, "target-credited", "reconciliation-required", {
              failure: { code: error.code ?? "source-debit-failed", message: error.message },
              compensationFailure: {
                code: compensationError.code ?? "target-compensation-failed",
                message: compensationError.message
              }
            });
          }
          catch {
            // Preserve the compound failure below.
          }
          throw new AggregateError([error, compensationError], "Inventory dismantle and compensation both failed.");
        }
        throw error;
      }
      record = await this.mutationJournal.checkpoint(operationId, "target-credited", "source-debited");
    }
    if (record.phase === "source-debited") {
      record = await this.mutationJournal.checkpoint(operationId, "source-debited", "committed");
    }
    const result = {
      itemName: record.itemName,
      breakQuantity: record.sourceReceipt.delta,
      materialName: record.materialName,
      materialWeight: record.materialWeight
    };
    await this.mutationJournal.finish(operationId, { ok: true, value: result });
    return foundry.utils.deepClone(result);
  }

  async #writeState(mutator, { guard } = {}) {
    guard?.();
    if (!this.canManagePartyInventory()) {
      throw new Error("Партийным инвентарём управляют владельцы склада.");
    }

    const state = this.#getState();
    const result = await mutator(state);
    guard?.();
    await this.#setState(state);
    guard?.();
    return result;
  }

  #findSupplyItem(actor, resourceKey) {
    return actor.items.contents.find((item) => {
      const itemResourceKey = item.getFlag(MODULE_ID, "resourceKey");
      if (itemResourceKey === resourceKey) {
        return true;
      }

      const itemName = normalizeText(item.name);
      return resourceKey === "food"
        ? itemName === normalizeText(FOOD_ITEM_NAME)
        : itemName === normalizeText(WATER_ITEM_NAME);
    }) ?? null;
  }

  async #ensureSupplyItem(actor, resourceKey) {
    const existing = this.#findSupplyItem(actor, resourceKey);
    if (existing) {
      return existing;
    }

    const [created] = await actor.createEmbeddedDocuments("Item", [buildSupplyItemData(resourceKey, 0)]);
    return created ?? null;
  }

  #getInventoryWeight(actor) {
    return roundNumber(actor.items.contents.reduce((sum, item) => {
      const itemData = item.toObject();
      return sum + (getRawQuantity(itemData) * getItemWeight(itemData));
    }, 0), 2);
  }

  #isNativeGroupInventoryActor(actor) {
    return actor?.type === "group";
  }

  #buildPartyMemberRows(state, inventoryActor) {
    if (this.#isNativeGroupInventoryActor(inventoryActor)) {
      const scopedMemberState = this.#getNativeGroupState(inventoryActor)?.memberStateByActorId ?? {};
      return getGroupMemberActors(inventoryActor)
        .map((actorDocument) => {
          const actorId = String(actorDocument?.id ?? "").trim();
          if (!actorId) {
            return null;
          }

          return {
            actorId,
            actor: actorDocument,
            memberState: this.#normalizeMemberState(
              scopedMemberState[actorId]
              ?? state.members?.[actorId]
              ?? buildDefaultMemberState("member")
            )
          };
        })
        .filter((row) => row);
    }

    return Object.entries(state.members)
      .map(([actorId, memberState]) => ({
        actorId,
        actor: game.actors.get(actorId) ?? null,
        memberState: this.#normalizeMemberState(memberState)
      }));
  }

  #assertLegacyPartyMembershipMutable() {
    if (this.#getGroupInventoryActor()) {
      throw new Error(NATIVE_GROUP_MEMBERSHIP_MESSAGE);
    }
  }

  #findInventoryMergeCandidate(actor, itemData, {
    folderState = null,
    folderId = null,
    scoped = false
  } = {}) {
    const normalizedFolderId = normalizeInventoryFolderTarget(folderId);
    return actor?.items?.contents?.find((candidate) => {
      if (!itemsCanMergeInInventory(candidate, itemData)) return false;
      if (!scoped) return true;
      const candidateFolderId = cleanId(folderState?.itemFolderIds?.[cleanId(candidate?.id)]) || null;
      return candidateFolderId === normalizedFolderId;
    }) ?? null;
  }

  #findInventoryIngressMutationItem(actor, mutationId, sourceKey, outputIndex) {
    return actor?.items?.contents?.find((item) => {
      const marker = item?.getFlag?.(MODULE_ID, INVENTORY_MUTATION_FLAG)
        ?? item?.flags?.[MODULE_ID]?.[INVENTORY_MUTATION_FLAG]
        ?? {};
      return cleanId(marker.id) === mutationId
        && marker.kind === "ingress"
        && cleanId(marker.sourceKey) === sourceKey
        && Number(marker.outputIndex) === outputIndex;
    }) ?? null;
  }

  #assertInventoryIngressBatchRecord(record, fingerprint) {
    if (record?.kind !== "ingress-batch" || record?.fingerprint !== fingerprint) {
      throw new InventoryIngressRuleError(
        "mutation-conflict",
        `Inventory ingress batch '${record?.id ?? ""}' has a different request.`
      );
    }
  }

  #inventoryIngressDerivedRow(previewRow, sourceRow, overrideToRoot) {
    const action = previewRow.action;
    const effectiveType = overrideToRoot ? "root" : action.type;
    const derivedFolderId = effectiveType === "folder" || effectiveType === "legacy"
      ? normalizeInventoryFolderTarget(action.folderId)
      : null;
    return {
      sourceKey: previewRow.sourceKey,
      sourceIdentity: foundry.utils.deepClone(previewRow.identity),
      itemData: foundry.utils.deepClone(sourceRow.itemData),
      container: foundry.utils.deepClone(sourceRow.container),
      quantity: previewRow.quantity,
      matchedRuleId: previewRow.matchedRuleId,
      overrideToRoot,
      action: foundry.utils.deepClone(action),
      effectiveType,
      derivedFolderId,
      dismantlePreview: foundry.utils.deepClone(previewRow.dismantlePreview ?? []),
      phase: effectiveType === "skip" ? "committed" : "prepared",
      targetReceipts: []
    };
  }

  async #prepareInventoryIngressTargetReceipts(actor, folderState, record, row, model) {
    const operationId = record.id;
    if (row.container && row.effectiveType === "dismantle" && row.dismantlePreview.length === 0) {
      throw new InventoryIngressRuleError(
        "dismantle-unavailable",
        `Portable container '${row.sourceKey}' cannot be dismantled.`
      );
    }
    const targetRows = row.effectiveType === "dismantle"
      ? row.dismantlePreview.map((output) => {
          const material = model?.materialById?.get?.(cleanId(output.sourceId)) ?? null;
          if (!material) {
            throw this.#inventoryReconciliationError(
              `Inventory ingress material '${cleanId(output.sourceId)}' is no longer available.`
            );
          }
          return {
            itemData: this.#buildMaterialItemData(material, output.quantity),
            quantity: output.quantity,
            folderId: null,
            scoped: true
          };
        })
      : row.container
        ? [{
          container: foundry.utils.deepClone(row.container),
          quantity: 1,
          folderId: row.derivedFolderId,
          scoped: row.effectiveType !== "legacy"
        }]
        : [{
          itemData: foundry.utils.deepClone(row.itemData),
          quantity: row.quantity,
          folderId: row.derivedFolderId,
          scoped: row.effectiveType !== "legacy"
        }];

    return targetRows.map((target, outputIndex) => {
      if (target.container) {
        return {
          outputIndex,
          container: foundry.utils.deepClone(target.container),
          itemId: "",
          created: true,
          beforeQuantity: 0,
          afterQuantity: 1,
          delta: 1,
          folderId: target.folderId,
          scoped: target.scoped
        };
      }
      const itemData = sanitizeEmbeddedItemData(target.itemData);
      foundry.utils.setProperty(itemData, "system.quantity", target.quantity);
      const candidate = this.#findInventoryMergeCandidate(actor, itemData, {
        folderState,
        folderId: target.folderId,
        scoped: target.scoped
      });
      const beforeQuantity = candidate ? getRawQuantity(candidate.toObject()) : 0;
      if (!candidate) {
        foundry.utils.setProperty(itemData, `flags.${MODULE_ID}.${INVENTORY_MUTATION_FLAG}`, {
          id: operationId,
          kind: "ingress",
          sourceKey: row.sourceKey,
          outputIndex
        });
      }
      return {
        outputIndex,
        itemData,
        itemId: candidate?.id ?? "",
        created: !candidate,
        beforeQuantity,
        afterQuantity: roundNumber(beforeQuantity + target.quantity, 2),
        delta: target.quantity,
        folderId: target.folderId,
        scoped: target.scoped
      };
    });
  }

  async #applyInventoryIngressTargetReceipt(actor, record, row, receipt, grantContainer = null) {
    if (receipt.container) {
      if (typeof grantContainer !== "function") {
        throw new InventoryIngressRuleError(
          "container-grant-unavailable",
          "Portable inventory ingress requires a container grant adapter."
        );
      }
      const root = await grantContainer({
        actor,
        container: foundry.utils.deepClone(receipt.container),
        sourceKey: row.sourceKey,
        mutationId: `${record.id}:${row.sourceKey}`,
        folderId: receipt.folderId
      });
      const itemId = cleanId(root?.id);
      if (!itemId) throw this.#inventoryReconciliationError("Portable container root was not observed.");
      return itemId;
    }
    let item = receipt.created
      ? this.#findInventoryIngressMutationItem(actor, record.id, row.sourceKey, receipt.outputIndex)
      : actor.items.get(receipt.itemId);
    if (receipt.created) {
      if (!item) {
        try {
          [item] = await actor.createEmbeddedDocuments("Item", [receipt.itemData]);
        }
        catch (error) {
          item = this.#findInventoryIngressMutationItem(actor, record.id, row.sourceKey, receipt.outputIndex);
          if (!item) throw error;
        }
      }
      if (!inventoryQuantitiesMatch(getRawQuantity(item.toObject()), receipt.afterQuantity)) {
        throw this.#inventoryReconciliationError("Inventory ingress created target quantity changed.");
      }
    }
    else {
      if (!item) throw this.#inventoryReconciliationError("Inventory ingress merge target disappeared.");
      const currentQuantity = getRawQuantity(item.toObject());
      if (!inventoryQuantitiesMatch(currentQuantity, receipt.afterQuantity)) {
        if (!inventoryQuantitiesMatch(currentQuantity, receipt.beforeQuantity)) {
          throw this.#inventoryReconciliationError("Inventory ingress merge target quantity changed.");
        }
        try {
          await item.update({ "system.quantity": receipt.afterQuantity });
        }
        catch (error) {
          if (!inventoryQuantitiesMatch(getRawQuantity(item.toObject()), receipt.afterQuantity)) throw error;
        }
      }
    }
    if (!item) throw this.#inventoryReconciliationError("Inventory ingress target was not observed.");
    return item.id;
  }

  async commitInventoryIngressBatch(request, {
    resolveRows,
    debitRow,
    grantContainer = null
  } = {}) {
    const exactKeys = ["groupActorId", "batchMutationId", "sourceOrigin", "serializedPlan"];
    if (!request || typeof request !== "object" || Array.isArray(request)
      || Object.keys(request).length !== exactKeys.length
      || !exactKeys.every((key) => Object.hasOwn(request, key))) {
      throw new InventoryIngressRuleError("invalid-batch", "Inventory ingress batch request has an invalid shape.");
    }
    const groupActorId = cleanId(request.groupActorId);
    const batchMutationId = cleanId(request.batchMutationId);
    const sourceOrigin = cleanId(request.sourceOrigin);
    if (!groupActorId || !batchMutationId
      || !new Set(["lootgen", "storage", "import", "public-model"]).has(sourceOrigin)
      || typeof resolveRows !== "function" || typeof debitRow !== "function") {
      throw new InventoryIngressRuleError("invalid-batch", "Inventory ingress batch dependencies or identity are invalid.");
    }
    if (grantContainer !== null && typeof grantContainer !== "function") {
      throw new InventoryIngressRuleError("invalid-batch", "Inventory ingress container grant must be a function.");
    }
    const planner = this.moduleApi.inventoryIngressPlanner;
    if (!planner || typeof planner.preview !== "function" || typeof planner.assertParity !== "function") {
      throw new InventoryIngressRuleError("planner-unavailable", "Inventory ingress planner is unavailable.");
    }
    const serializedPlan = foundry.utils.deepClone(request.serializedPlan);
    const fingerprint = JSON.stringify({ groupActorId, batchMutationId, sourceOrigin, serializedPlan });
    const operationId = `inventory-ingress:${batchMutationId}`;

    return this.#runInventoryOrganizationMutation(groupActorId, async (actor) => {
      let record = await this.mutationJournal.find(operationId);
      if (record) {
        this.#assertInventoryIngressBatchRecord(record, fingerprint);
        const terminal = this.#readInventoryTerminal(record);
        if (terminal.terminal) return terminal.value;
      }

      const sourceRows = await resolveRows({
        groupActorId,
        batchMutationId,
        sourceOrigin,
        recovering: Boolean(record),
        serializedPlan: foundry.utils.deepClone(serializedPlan)
      });
      const authoritativePreview = await planner.preview({
        groupActorId,
        requestedFolderId: serializedPlan?.requestedFolderId ?? null,
        rows: sourceRows,
        batch: Array.isArray(sourceRows) && sourceRows.length > 1
      });
      try {
        planner.assertParity(serializedPlan, authoritativePreview);
      }
      catch (error) {
        if (record) {
          throw this.#inventoryReconciliationError("Inventory ingress plan changed during recovery.");
        }
        throw error;
      }

      let folderState = this.#readInventoryFolderState(actor);
      const folderIds = new Set(folderState.folders.map((folder) => folder.id));
      if (!record) {
        const overrideKeys = new Set(serializedPlan.rootOverrideSourceKeys ?? []);
        const sourceByKey = new Map(sourceRows.map((row) => [cleanId(row.sourceKey), row]));
        const rows = authoritativePreview.rows.map((previewRow) => this.#inventoryIngressDerivedRow(
          previewRow,
          sourceByKey.get(previewRow.sourceKey),
          overrideKeys.has(previewRow.sourceKey)
        ));
        const missingFolder = rows.find((row) => row.derivedFolderId !== null && !folderIds.has(row.derivedFolderId));
        if (missingFolder) {
          throw new InventoryFolderStateError("folder-not-found", "Inventory ingress target folder was not found.");
        }
        record = await this.mutationJournal.start({
          id: operationId,
          kind: "ingress-batch",
          phase: "prepared",
          groupActorId,
          sourceOrigin,
          fingerprint,
          rulesRevision: authoritativePreview.rulesRevision,
          requestedFolderId: authoritativePreview.requestedFolderId,
          rows
        });
      }
      else {
        const previewsByKey = new Map(authoritativePreview.rows.map((row) => [row.sourceKey, row]));
        for (const row of record.rows) {
          const previewRow = previewsByKey.get(row.sourceKey);
          if (JSON.stringify(row.dismantlePreview ?? []) !== JSON.stringify(previewRow?.dismantlePreview ?? [])) {
            throw this.#inventoryReconciliationError("Inventory ingress dismantle outputs changed during recovery.");
          }
          if (row.derivedFolderId !== null && !folderIds.has(row.derivedFolderId)) {
            throw this.#inventoryReconciliationError("Inventory ingress target folder disappeared during recovery.");
          }
        }
      }

      const needsModel = record.rows.some((row) => row.effectiveType === "dismantle");
      const model = needsModel ? await this.moduleApi.getModel() : null;
      for (let rowIndex = 0; rowIndex < record.rows.length; rowIndex += 1) {
        let row = record.rows[rowIndex];
        if (row.phase === "committed" || row.phase === "source-debited" || row.phase === "folder-assigned") continue;
        if (row.targetReceipts.length === 0) {
          const targetReceipts = await this.#prepareInventoryIngressTargetReceipts(actor, folderState, record, row, model);
          const rows = record.rows.map((entry, index) => index === rowIndex ? { ...entry, targetReceipts } : entry);
          record = await this.mutationJournal.checkpoint(operationId, "prepared", "prepared", { rows });
          row = record.rows[rowIndex];
        }
        const targetReceipts = [];
        for (const receipt of row.targetReceipts) {
          const itemId = await this.#applyInventoryIngressTargetReceipt(actor, record, row, receipt, grantContainer);
          targetReceipts.push({ ...receipt, itemId });
        }
        const rows = record.rows.map((entry, index) => index === rowIndex
          ? { ...entry, phase: "target-created", targetReceipts }
          : entry);
        record = await this.mutationJournal.checkpoint(operationId, "prepared", "prepared", { rows });
        for (const receipt of targetReceipts) {
          if (receipt.created) {
            folderState = moveInventoryItemToFolderState(folderState, {
              itemId: receipt.itemId,
              folderId: receipt.folderId
            });
          }
        }
      }

      let nextFolderState = folderState;
      for (const row of record.rows) {
        if (row.phase !== "target-created") continue;
        for (const receipt of row.targetReceipts) {
          if (receipt.created) {
            nextFolderState = moveInventoryItemToFolderState(nextFolderState, {
              itemId: receipt.itemId,
              folderId: receipt.folderId
            });
          }
        }
      }
      const liveFolderState = this.#readInventoryFolderState(actor);
      if (JSON.stringify(liveFolderState) !== JSON.stringify(nextFolderState)) {
        try {
          await this.#writeInventoryFolderState(actor, nextFolderState);
        }
        catch (error) {
          if (JSON.stringify(this.#readInventoryFolderState(actor)) !== JSON.stringify(nextFolderState)) throw error;
        }
      }
      if (record.rows.some((row) => row.phase === "target-created")) {
        const rows = record.rows.map((row) => row.phase === "target-created"
          ? { ...row, phase: "folder-assigned" }
          : row);
        record = await this.mutationJournal.checkpoint(operationId, "prepared", "prepared", { rows });
      }

      const liveRowByKey = new Map(sourceRows.map((row) => [cleanId(row.sourceKey), row]));
      for (let rowIndex = 0; rowIndex < record.rows.length; rowIndex += 1) {
        const row = record.rows[rowIndex];
        if (row.phase === "committed") continue;
        if (row.phase === "folder-assigned") {
          await debitRow(liveRowByKey.get(row.sourceKey), {
            groupActorId,
            batchMutationId,
            sourceOrigin,
            sourceKey: row.sourceKey,
            targetReceipts: foundry.utils.deepClone(row.targetReceipts)
          });
          const debitedRows = record.rows.map((entry, index) => index === rowIndex
            ? { ...entry, phase: "source-debited" }
            : entry);
          record = await this.mutationJournal.checkpoint(operationId, "prepared", "prepared", { rows: debitedRows });
        }
        if (record.rows[rowIndex].phase === "source-debited") {
          const committedRows = record.rows.map((entry, index) => index === rowIndex
            ? { ...entry, phase: "committed" }
            : entry);
          record = await this.mutationJournal.checkpoint(operationId, "prepared", "prepared", { rows: committedRows });
        }
      }

      const result = {
        actorId: actor.id,
        batchMutationId,
        changed: record.rows.some((row) => row.effectiveType !== "skip"),
        rows: record.rows.map((row) => {
          let filterOutcome = null;
          if (row.matchedRuleId && row.overrideToRoot) {
            filterOutcome = { type: "root" };
          }
          else if (row.matchedRuleId && row.effectiveType === "folder") {
            const folder = folderState.folders.find((entry) => entry.id === row.derivedFolderId);
            filterOutcome = {
              type: "folder",
              folderId: row.derivedFolderId,
              folderName: cleanId(folder?.name) || row.derivedFolderId
            };
          }
          else if (row.matchedRuleId && row.effectiveType === "dismantle") {
            filterOutcome = {
              type: "dismantle",
              outputs: foundry.utils.deepClone(row.dismantlePreview)
            };
          }
          return {
            sourceKey: row.sourceKey,
            matchedRuleId: row.matchedRuleId,
            action: foundry.utils.deepClone(row.action),
            overrideToRoot: row.overrideToRoot,
            derivedFolderId: row.derivedFolderId,
            changed: row.effectiveType !== "skip",
            targetItemIds: row.targetReceipts.map((receipt) => receipt.itemId),
            filterOutcome
          };
        })
      };
      await this.mutationJournal.finish(operationId, { ok: true, value: result });
      return foundry.utils.deepClone(result);
    });
  }

  async #upsertInventoryItem(actor, itemData, quantity = null) {
    if (!(actor instanceof Actor)) {
      throw new Error("Не удалось определить актёра партийного инвентаря.");
    }

    const source = sanitizeEmbeddedItemData(itemData);
    const targetQuantity = quantity === null
      ? Math.max(0, getRawQuantity(source))
      : Math.max(0, roundNumber(toNumber(quantity, 0), 2));
    if (targetQuantity <= 0) {
      return null;
    }

    const mergeCandidate = this.#findInventoryMergeCandidate(actor, source);

    if (mergeCandidate) {
      const nextQuantity = roundNumber(getRawQuantity(mergeCandidate.toObject()) + targetQuantity, 2);
      await mergeCandidate.update({
        "system.quantity": nextQuantity
      });
      return mergeCandidate;
    }

    foundry.utils.setProperty(source, "system.quantity", targetQuantity);
    const [created] = await actor.createEmbeddedDocuments("Item", [source]);
    return created ?? null;
  }

  #buildMaterialItemData(material, quantity) {
    return {
      name: material.name,
      type: "loot",
      img: "icons/commodities/materials/slime-thick-blue.webp",
      system: {
        description: {
          value: material.description ? `<p>${foundry.utils.escapeHTML(material.description)}</p>` : "",
          chat: ""
        },
        unidentified: {
          description: ""
        },
        quantity: Math.max(0.01, roundNumber(quantity, 2)),
        price: {
          value: Math.max(0, roundNumber(toNumber(material.priceGold, 0), 2)),
          denomination: "gp"
        },
        weight: {
          value: Math.max(0.01, roundNumber(toNumber(material.weight, 1), 2)),
          units: "lb"
        },
        type: {
          value: "trade",
          subtype: material.type || "Материал"
        }
      },
      flags: {
        [MODULE_ID]: {
          sourceType: "material",
          sourceId: material.id,
          materialId: material.id,
          linkedGoodId: material.linkedGoodId ?? null,
          predominantMaterialId: material.id,
          predominantMaterialName: material.name
        }
      }
    };
  }

  #buildGearItemData(gearItem, quantity) {
    return {
      name: gearItem.name,
      type: "loot",
      img: "icons/svg/item-bag.svg",
      system: {
        description: {
          value: gearItem.description ? `<p>${foundry.utils.escapeHTML(gearItem.description)}</p>` : "",
          chat: ""
        },
        unidentified: {
          description: ""
        },
        quantity: Math.max(0.01, roundNumber(quantity, 2)),
        price: {
          value: Math.max(0, roundNumber(toNumber(gearItem.priceGoldEquivalent, toNumber(gearItem.priceValue, 0)), 2)),
          denomination: "gp"
        },
        weight: {
          value: Math.max(0, roundNumber(toNumber(gearItem.weight, 0), 2)),
          units: "lb"
        },
        type: {
          value: "loot",
          subtype: gearItem.equipmentType || "Снаряжение"
        }
      },
      flags: {
        [MODULE_ID]: {
          sourceType: "gear",
          sourceId: gearItem.id,
          gearId: gearItem.id,
          linkedTool: gearItem.linkedTool ?? "",
          predominantMaterialId: gearItem.predominantMaterialId ?? null,
          predominantMaterialName: gearItem.predominantMaterialName ?? "",
          rank: gearItem.rank ?? 0
        }
      }
    };
  }

  #matchInventorySource(model, item) {
    const sourceFlags = foundry.utils.deepClone(item.flags?.[MODULE_ID] ?? {});
    const itemName = normalizeText(item.name);
    const normalizedSourceType = normalizeInventorySourceType(sourceFlags.sourceType);
    const isMagicFlag = normalizedSourceType === "magicItem"
      || Boolean(sourceFlags.magicItemId)
      || Boolean(sourceFlags.magicId)
      || normalizeInventorySourceType(sourceFlags.itemType) === "magicItem"
      || normalizeInventorySourceType(sourceFlags.magicItemType) === "magicItem"
      || Boolean(sourceFlags.magical);
    const matchedMaterial = model.materialById?.get(sourceFlags.materialId)
      ?? model.materialById?.get(sourceFlags.sourceId)
      ?? model.materialByGoodId?.get(sourceFlags.linkedGoodId)
      ?? model.materials.find((material) => normalizeText(material.name) === itemName)
      ?? null;
    const matchedGear = model.gearById?.get(sourceFlags.gearId)
      ?? model.gearById?.get(sourceFlags.sourceId)
      ?? model.gear.find((gearItem) => normalizeText(gearItem.name) === itemName)
      ?? null;
    const resourceKey = String(sourceFlags.resourceKey ?? "").trim().toLowerCase();
    let sourceType = normalizedSourceType;
    if (!sourceType) {
      if (resourceKey) {
        sourceType = "supply";
      }
      else if (isMagicFlag) {
        sourceType = "magicItem";
      }
      else if (matchedMaterial) {
        sourceType = "material";
      }
      else if (matchedGear) {
        sourceType = "gear";
      }
      else {
        sourceType = "custom";
      }
    }

    return {
      sourceFlags,
      sourceType,
      sourceId: sourceFlags.sourceId
        ?? sourceFlags.magicItemId
        ?? sourceFlags.magicId
        ?? matchedMaterial?.id
        ?? matchedGear?.id
        ?? item.id,
      matchedMaterial,
      matchedGear,
      resourceKey
    };
  }

  #buildInventoryEntry(model, item) {
    const itemData = item.toObject();
    const quantity = roundNumber(getRawQuantity(itemData), 2);
    const weightEach = roundNumber(getItemWeight(itemData), 2);
    const totalWeight = roundNumber(quantity * weightEach, 2);
    let {
      sourceFlags,
      sourceType,
      sourceId,
      matchedMaterial,
      matchedGear,
      resourceKey
    } = this.#matchInventorySource(model, item);
    if (item.type === DOWNTIME_ITEM_TYPE) {
      sourceType = "downtime";
    }

    const isFood = resourceKey === "food" || normalizeText(item.name) === normalizeText(FOOD_ITEM_NAME);
    const isWater = resourceKey === "water" || normalizeText(item.name) === normalizeText(WATER_ITEM_NAME);
    const itemTypeLabel = item.type === DOWNTIME_ITEM_TYPE
      ? "Простой"
      : (matchedMaterial?.type
      ?? matchedGear?.equipmentType
      ?? sourceFlags.itemType
      ?? sourceFlags.magicItemType
      ?? String(foundry.utils.getProperty(itemData, "system.type.subtype") || item.type || "Предмет"));
    const sourceTypeLabel = sourceType === "material"
      ? "Материал"
      : (sourceType === "gear"
        ? "Снаряжение"
        : (sourceType === "magicItem"
          ? "Магический предмет"
          : (sourceType === "supply"
            ? "Запасы"
            : (sourceType === "downtime" ? "Простой" : "Прочее"))));
    const materialLabel = matchedMaterial?.name
      ?? matchedGear?.predominantMaterialName
      ?? sourceFlags.predominantMaterialName
      ?? "";
    const transport = buildTransportProfileFromInventoryItem(itemData, {
      itemId: item.id,
      itemUuid: item.uuid,
      itemTypeLabel,
      sourceTypeLabel,
      sourceFlags,
      matchedGear,
      quantity
    });

    const priceCopper = priceToCopper(foundry.utils.getProperty(itemData, "system.price") ?? {});
    const dismantleMinQuantity = resolveInventoryDismantleMinimumQuantity(itemData, { model });

    return {
      itemId: item.id,
      itemUuid: item.uuid,
      name: item.name,
      img: normalizeInventoryIconPath(item.img),
      quantity,
      weightEach,
      totalWeight,
      priceLabel: formatPriceLabel(foundry.utils.getProperty(itemData, "system.price") ?? {}),
      priceCopper,
      sourceType,
      sourceTypeLabel,
      sourceId,
      sourceName: item.name,
      canOpenEntry: sourceType === "material" || sourceType === "gear" || sourceType === "magicItem",
      isJournalRecord: isJournalRecordItem(item),
      itemTypeLabel,
      materialLabel,
      transport,
      isFood,
      isWater,
      canDismantle: dismantleMinQuantity !== null,
      dismantleMinQuantity,
      canSell: !isMagicalInventoryItem(itemData) && priceCopper > 0
    };
  }

  async getInventoryActor({ create = false, groupActorId = "" } = {}) {
    const requestedGroupActorId = cleanId(groupActorId);
    if (requestedGroupActorId) {
      this.lastGroupContextError = "";
      const context = this.moduleApi.groupContextService?.resolveForGroup?.(requestedGroupActorId);
      const resolvedActor = context?.groupActor ?? null;
      if (
        !resolvedActor
        || resolvedActor.type !== "group"
        || cleanId(resolvedActor.id) !== requestedGroupActorId
      ) {
        throw new Error("Не удалось разрешить указанный групповой инвентарь.");
      }
      return resolvedActor;
    }

    const groupActor = this.#getGroupInventoryActor();
    if (groupActor) {
      return groupActor;
    }

    if (!create && this.lastGroupContextError) {
      return null;
    }

    const state = this.#getState();
    const existingActor = state.inventoryActorId ? game.actors.get(state.inventoryActorId) ?? null : null;
    if (existingActor) {
      return existingActor;
    }

    if (!create || !game.user?.isGM) {
      return null;
    }

    const actor = await Actor.create({
      name: DEFAULT_PARTY_ACTOR_NAME,
      type: "npc",
      img: DEFAULT_PARTY_ACTOR_IMAGE,
      ownership: {
        default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
      },
      flags: {
        [MODULE_ID]: {
          managedPartyInventory: true
        }
      }
    }, {
      renderSheet: false
    });

    await this.#writeState((nextState) => {
      nextState.inventoryActorId = actor.id;
    });

    return actor;
  }

  #readInventoryFolderState(actor) {
    return normalizeInventoryFolderState(
      actor?.getFlag?.(MODULE_ID, "inventoryFolders"),
      {
        itemIds: Array.isArray(actor?.items?.contents)
          ? actor.items.contents.map((item) => cleanId(item?.id)).filter(Boolean)
          : []
      }
    );
  }

  #writeInventoryFolderState(actor, nextState) {
    return actor.setFlag(MODULE_ID, "==inventoryFolders", nextState);
  }

  #readInventoryIngressRuleState(actor) {
    return normalizeInventoryIngressRuleState(actor?.getFlag?.(MODULE_ID, "inventoryIngressRules"));
  }

  #writeInventoryIngressRuleState(actor, nextState) {
    return actor.setFlag(MODULE_ID, "==inventoryIngressRules", nextState);
  }

  #runInventoryOrganizationMutation(groupActorId, operation) {
    const actorId = cleanId(groupActorId);
    if (!actorId) throw new Error("Не указан групповой инвентарь.");
    return this.mutationCoordinator.run(
      `inventory-organization:${actorId}`,
      async () => {
        const actor = await this.getInventoryActor({ create: false, groupActorId: actorId });
        return operation(actor);
      }
    );
  }

  #mutateInventoryFolderState(groupActorId, operation) {
    return this.#runInventoryOrganizationMutation(
      groupActorId,
      async (actor) => {
        const rawState = actor?.getFlag?.(MODULE_ID, "inventoryFolders");
        const currentState = this.#readInventoryFolderState(actor);
        const operationResult = await operation({ actor, state: currentState });
        const nextState = operationResult?.state ?? currentState;
        const changed = JSON.stringify(rawState ?? null) !== JSON.stringify(nextState);
        if (changed) {
          await this.#writeInventoryFolderState(actor, nextState);
        }
        const resultFolderId = operationResult?.folderId == null
          ? null
          : cleanId(operationResult.folderId);
        return {
          actorId: actor.id,
          folderId: resultFolderId,
          changed,
          deletedFolderId: cleanId(operationResult?.deletedFolderId),
          ...(cleanId(operationResult?.itemId) ? { itemId: cleanId(operationResult.itemId) } : {})
        };
      }
    );
  }

  createInventoryFolder({ groupActorId, folderId, name, parentId = null }) {
    return this.#mutateInventoryFolderState(groupActorId, ({ state }) => ({
      state: createInventoryFolderState(state, { folderId, name, parentId }),
      folderId
    }));
  }

  renameInventoryFolder({ groupActorId, folderId, name }) {
    return this.#mutateInventoryFolderState(groupActorId, ({ state }) => ({
      state: renameInventoryFolderState(state, { folderId, name }),
      folderId
    }));
  }

  moveInventoryFolder({ groupActorId, folderId, parentId = null }) {
    return this.#mutateInventoryFolderState(groupActorId, ({ state }) => ({
      state: moveInventoryFolderState(state, { folderId, parentId }),
      folderId
    }));
  }

  deleteInventoryFolder({ groupActorId, folderId }) {
    return this.#mutateInventoryFolderState(groupActorId, ({ actor, state }) => {
      const normalizedFolderId = cleanId(folderId);
      const dependentRules = this.#readInventoryIngressRuleState(actor).rules
        .filter((rule) => rule.action.type === "folder" && rule.action.folderId === normalizedFolderId);
      if (dependentRules.length > 0) {
        const names = dependentRules.map((rule) => rule.name).join(", ");
        throw new InventoryIngressRuleError(
          "folder-in-use",
          `Папка используется правилами входящего лута: ${names}.`,
          { folderId: normalizedFolderId, ruleIds: dependentRules.map((rule) => rule.id) }
        );
      }
      const existed = state.folders.some((folder) => folder.id === normalizedFolderId);
      return {
        state: deleteInventoryFolderState(state, { folderId: normalizedFolderId }),
        folderId: normalizedFolderId,
        deletedFolderId: existed ? normalizedFolderId : ""
      };
    });
  }

  #assignInventoryItemFolder({ groupActorId, itemId, folderId = null }) {
    return this.#mutateInventoryFolderState(groupActorId, ({ actor, state }) => {
      const normalizedItemId = cleanId(itemId);
      const item = actor?.items?.get?.(normalizedItemId)
        ?? actor?.items?.contents?.find?.((entry) => cleanId(entry?.id) === normalizedItemId)
        ?? null;
      if (!item) {
        throw new InventoryFolderStateError("item-not-found", "Предмет не найден в партийном инвентаре.");
      }
      return {
        state: moveInventoryItemToFolderState(state, { itemId: normalizedItemId, folderId }),
        folderId,
        itemId: normalizedItemId
      };
    });
  }

  moveInventoryItemToFolder({ groupActorId, itemId, folderId = null }) {
    return this.#assignInventoryItemFolder({ groupActorId, itemId, folderId });
  }

  assignInventoryGrantFolder({ groupActorId, itemId, folderId = null }) {
    return this.#assignInventoryItemFolder({ groupActorId, itemId, folderId });
  }

  async getInventoryIngressRuleState({ groupActorId } = {}) {
    const actor = await this.getInventoryActor({ create: false, groupActorId });
    return this.#readInventoryIngressRuleState(actor);
  }

  #assertInventoryIngressRuleFolders(rules, folderState) {
    const folderIds = new Set(folderState.folders.map((folder) => folder.id));
    const missingRule = rules.find((rule) => (
      rule.action.type === "folder" && !folderIds.has(rule.action.folderId)
    ));
    if (missingRule) {
      throw new InventoryIngressRuleError(
        "folder-not-found",
        `Папка правила «${missingRule.name}» не найдена.`,
        { ruleId: missingRule.id, folderId: missingRule.action.folderId }
      );
    }
  }

  #buildInventoryIngressRuleMutation(kind, currentState, request, folderState) {
    if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) {
      throw new InventoryIngressRuleError("invalid-revision", "Ожидаемая ревизия правил некорректна.");
    }
    if (currentState.revision !== request.expectedRevision) {
      throw new InventoryIngressRuleError(
        "stale-revision",
        `Правила входящего лута изменились (revision ${currentState.revision}).`,
        { expectedRevision: request.expectedRevision, actualRevision: currentState.revision }
      );
    }
    let rules = currentState.rules.map((rule) => foundry.utils.deepClone(rule));
    let changed = false;
    if (kind === "create") {
      const rule = normalizeInventoryIngressRule(request.rule);
      const existing = rules.find((entry) => entry.id === rule.id) ?? null;
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(rule)) {
          throw new InventoryIngressRuleError("duplicate-rule-id", `Правило ${rule.id} уже существует.`, {
            ruleId: rule.id
          });
        }
      }
      else {
        rules.push(rule);
        changed = true;
      }
    }
    else if (kind === "update") {
      const rule = normalizeInventoryIngressRule(request.rule);
      const index = rules.findIndex((entry) => entry.id === rule.id);
      if (index < 0) {
        throw new InventoryIngressRuleError("rule-not-found", `Правило ${rule.id} не найдено.`, {
          ruleId: rule.id
        });
      }
      if (JSON.stringify(rules[index]) !== JSON.stringify(rule)) {
        rules[index] = rule;
        changed = true;
      }
    }
    else {
      const ruleId = cleanId(request.ruleId);
      if (!ruleId) throw new InventoryIngressRuleError("invalid-rule-id", "Не указан ID правила.");
      const nextRules = rules.filter((rule) => rule.id !== ruleId);
      changed = nextRules.length !== rules.length;
      rules = nextRules;
    }
    const nextState = normalizeInventoryIngressRuleState({
      version: currentState.version,
      revision: currentState.revision + (changed ? 1 : 0),
      rules
    });
    this.#assertInventoryIngressRuleFolders(nextState.rules, folderState);
    const conflicts = findInventoryIngressRuleConflicts(nextState.rules);
    if (conflicts.length > 0) {
      const nameById = new Map(nextState.rules.map((rule) => [rule.id, rule.name]));
      const summary = conflicts.map((conflict) => (
        `«${nameById.get(conflict.leftRuleId) ?? conflict.leftRuleId}» ↔ `
        + `«${nameById.get(conflict.rightRuleId) ?? conflict.rightRuleId}»: `
        + conflict.intersectingFields.join(", ")
      )).join("; ");
      throw new InventoryIngressRuleError("rule-conflict", `Правила входящего лута пересекаются: ${summary}.`, {
        conflicts
      });
    }
    return {
      nextState,
      outcome: {
        actorId: cleanId(request.groupActorId),
        operationId: cleanId(request.operationId),
        changed,
        state: nextState
      }
    };
  }

  #assertInventoryIngressRuleRecord(record, fingerprint) {
    if (record?.kind !== "inventory-ingress-rule" || record?.fingerprint !== fingerprint) {
      throw new InventoryIngressRuleError(
        "mutation-conflict",
        `Inventory ingress rule operation '${record?.id ?? ""}' has a different request.`
      );
    }
  }

  async #mutateInventoryIngressRule(kind, request) {
    const groupActorId = cleanId(request?.groupActorId);
    const operationId = cleanId(request?.operationId);
    if (!groupActorId || !operationId) {
      throw new InventoryIngressRuleError("invalid-operation", "Не указаны группа или operation ID.");
    }
    const canonicalRequest = kind === "delete"
      ? { groupActorId, operationId, expectedRevision: request.expectedRevision, ruleId: cleanId(request.ruleId) }
      : {
          groupActorId,
          operationId,
          expectedRevision: request.expectedRevision,
          rule: normalizeInventoryIngressRule(request.rule)
        };
    const fingerprint = JSON.stringify({ kind, ...canonicalRequest });
    const recordId = `inventory-rule:${groupActorId}:${operationId}`;
    return this.#runInventoryOrganizationMutation(groupActorId, async (actor) => {
      let record = await this.mutationJournal.find(recordId);
      if (record) {
        this.#assertInventoryIngressRuleRecord(record, fingerprint);
        if (record.terminal === true) {
          if (record.result?.ok === false) throw new Error(record.result.error || "Rule mutation failed.");
          return foundry.utils.deepClone(record.result?.value);
        }
      }
      const liveState = this.#readInventoryIngressRuleState(actor);
      if (!record) {
        const { nextState, outcome } = this.#buildInventoryIngressRuleMutation(
          kind,
          liveState,
          canonicalRequest,
          this.#readInventoryFolderState(actor)
        );
        record = await this.mutationJournal.start({
          id: recordId,
          kind: "inventory-ingress-rule",
          phase: "prepared",
          fingerprint,
          groupActorId,
          beforeState: liveState,
          afterState: nextState,
          outcome
        });
        this.#assertInventoryIngressRuleRecord(record, fingerprint);
      }
      const liveMatchesBefore = JSON.stringify(liveState) === JSON.stringify(record.beforeState);
      const liveMatchesAfter = JSON.stringify(liveState) === JSON.stringify(record.afterState);
      if (!liveMatchesBefore && !liveMatchesAfter) {
        throw new InventoryIngressRuleError(
          "reconciliation-required",
          "Состояние правил не совпадает с prepared mutation record."
        );
      }
      if (record.phase === "prepared" && !liveMatchesAfter) {
        try {
          await this.#writeInventoryIngressRuleState(actor, record.afterState);
        }
        catch (error) {
          const durableState = this.#readInventoryIngressRuleState(actor);
          if (JSON.stringify(durableState) !== JSON.stringify(record.afterState)) throw error;
        }
      }
      if (record.phase === "prepared") {
        record = await this.mutationJournal.checkpoint(recordId, "prepared", "actor-written");
      }
      const result = foundry.utils.deepClone(record.outcome);
      await this.mutationJournal.finish(recordId, { ok: true, value: result });
      return result;
    });
  }

  createInventoryIngressRule(request) {
    return this.#mutateInventoryIngressRule("create", request);
  }

  updateInventoryIngressRule(request) {
    return this.#mutateInventoryIngressRule("update", request);
  }

  deleteInventoryIngressRule(request) {
    return this.#mutateInventoryIngressRule("delete", request);
  }

  getInventoryFolderUiState(groupActorId, folderIds = []) {
    const actorId = cleanId(groupActorId);
    if (!actorId) {
      throw new Error("Не указан групповой инвентарь для состояния папок.");
    }
    const rawState = game.user?.getFlag?.(MODULE_ID, INVENTORY_FOLDER_UI_FLAG);
    const rawExpandedFolderIds = rawState?.version === INVENTORY_FOLDER_UI_STATE_VERSION
      ? rawState?.groups?.[actorId]?.expandedFolderIds
      : [];
    return {
      version: INVENTORY_FOLDER_UI_STATE_VERSION,
      groupActorId: actorId,
      expandedFolderIds: normalizeExpandedFolderIds(rawExpandedFolderIds, { folderIds })
    };
  }

  setInventoryFolderExpanded(groupActorId, folderId, expanded) {
    const actorId = cleanId(groupActorId);
    const normalizedFolderId = cleanId(folderId);
    const user = game.user ?? null;
    const userId = cleanId(user?.id);
    if (!actorId || !normalizedFolderId || typeof expanded !== "boolean" || !userId) {
      throw new Error("Некорректное личное состояние папки инвентаря.");
    }
    if (typeof user?.getFlag !== "function" || typeof user?.setFlag !== "function") {
      throw new Error("Пользовательское хранилище состояния папок недоступно.");
    }
    return this.mutationCoordinator.run(
      `inventory-folder-ui:${userId}`,
      async () => {
        const actor = await this.getInventoryActor({ create: false, groupActorId: actorId });
        const folderIds = this.#readInventoryFolderState(actor).folders.map((folder) => folder.id);
        if (expanded && !folderIds.includes(normalizedFolderId)) {
          throw new InventoryFolderStateError("folder-not-found", "Папка инвентаря не найдена.");
        }
        const rawState = user.getFlag(MODULE_ID, INVENTORY_FOLDER_UI_FLAG);
        const rawExpandedFolderIds = rawState?.version === INVENTORY_FOLDER_UI_STATE_VERSION
          ? rawState?.groups?.[actorId]?.expandedFolderIds
          : [];
        const expandedFolderIds = new Set(normalizeExpandedFolderIds(
          rawExpandedFolderIds,
          { folderIds }
        ));
        if (expanded) expandedFolderIds.add(normalizedFolderId);
        else expandedFolderIds.delete(normalizedFolderId);
        const groups = rawState?.version === INVENTORY_FOLDER_UI_STATE_VERSION
          && rawState.groups
          && typeof rawState.groups === "object"
          && !Array.isArray(rawState.groups)
          ? foundry.utils.deepClone(rawState.groups)
          : {};
        const nextExpandedFolderIds = normalizeExpandedFolderIds(
          Array.from(expandedFolderIds),
          { folderIds }
        );
        groups[actorId] = { expandedFolderIds: nextExpandedFolderIds };
        await user.setFlag(MODULE_ID, INVENTORY_FOLDER_UI_FLAG, {
          version: INVENTORY_FOLDER_UI_STATE_VERSION,
          groups
        });
        return {
          version: INVENTORY_FOLDER_UI_STATE_VERSION,
          groupActorId: actorId,
          expandedFolderIds: nextExpandedFolderIds
        };
      }
    );
  }

  async mergeLegacyInventoryIntoGroup(groupActorId) {
    if (!game.user?.isGM) {
      throw new Error("Legacy inventory merge can be run only by a GM.");
    }

    const context = this.moduleApi.groupContextService?.resolveForGroup?.(groupActorId);
    const groupActor = context?.groupActor ?? null;
    if (!groupActor || groupActor.type !== "group") {
      throw new Error("Target actor must be a dnd5e group.");
    }

    const registry = this.moduleApi.groupContextService?.getRegistry?.();
    if (!isManagedPartyGroup(groupActor) || !registry?.groupsById?.[groupActor.id]) {
      throw new Error("Target group must be registered as a Rebreya party group before merging legacy inventory.");
    }

    const state = this.#getState();
    const legacyInventoryActorId = state.inventoryActorId;
    const baseResult = {
      mergedItems: 0,
      createdItems: 0,
      mergedCurrency: {
        pp: 0,
        gp: 0,
        sp: 0,
        cp: 0
      },
      legacyInventoryActorId,
      groupActorId: groupActor.id,
      noop: true
    };

    const legacyActor = legacyInventoryActorId ? game.actors.get(legacyInventoryActorId) ?? null : null;
    if (!legacyActor || legacyActor.id === groupActor.id) {
      return baseResult;
    }

    const pairKey = getLegacyInventoryPairKey(legacyActor.id, groupActor.id);
    const pairState = getLegacyInventoryMergePairState(context.groupState, pairKey);
    const migrationState = context.groupState?.migration ?? {};
    if (
      (migrationState.legacyInventoryActorId === legacyActor.id && Number(migrationState.legacyInventoryMergedAt) > 0)
      || hasLegacyInventoryCompletionMarker(context.groupState, legacyActor, pairKey)
    ) {
      return baseResult;
    }

    const persistPairProgress = async (mutator) => {
      return this.moduleApi.groupContextService.mutateGroupState(groupActor.id, (groupState) => {
        groupState.groupActorId = groupActor.id;
        groupState.migration = groupState.migration && typeof groupState.migration === "object" ? groupState.migration : {};
        groupState.migration.legacyInventoryMergePairs = groupState.migration.legacyInventoryMergePairs
          && typeof groupState.migration.legacyInventoryMergePairs === "object"
          ? groupState.migration.legacyInventoryMergePairs
          : {};
        const nextPairState = {
          legacyInventoryActorId: legacyActor.id,
          groupActorId: groupActor.id,
          currencyAppliedAt: 0,
          completedAt: 0,
          itemsByKey: {},
          ...(groupState.migration.legacyInventoryMergePairs[pairKey] ?? {})
        };
        nextPairState.itemsByKey = nextPairState.itemsByKey && typeof nextPairState.itemsByKey === "object"
          ? nextPairState.itemsByKey
          : {};
        mutator(nextPairState);
        groupState.migration.legacyInventoryMergePairs[pairKey] = nextPairState;
        if (Number(nextPairState.completedAt) > 0) {
          groupState.migration.legacyInventoryMergedAt = nextPairState.completedAt;
          groupState.migration.legacyInventoryActorId = legacyActor.id;
        }
        return nextPairState;
      });
    };

    const sourceCurrency = buildCurrencySnapshot(legacyActor);
    const currencyAlreadyApplied = Number(pairState.currencyAppliedAt) > 0
      || Number(getLegacyInventoryCurrencyPairState(groupActor, pairKey).appliedAt) > 0;
    if (!currencyAlreadyApplied) {
      const targetCurrency = buildCurrencySnapshot(groupActor);
      const mergedCurrency = {
        pp: Math.max(0, Math.floor(targetCurrency.pp + sourceCurrency.pp)),
        gp: Math.max(0, Math.floor(targetCurrency.gp + sourceCurrency.gp)),
        sp: Math.max(0, Math.floor(targetCurrency.sp + sourceCurrency.sp)),
        cp: Math.max(0, Math.floor(targetCurrency.cp + sourceCurrency.cp))
      };
      const currencyAppliedAt = Date.now();
      const currencyPairs = foundry.utils.deepClone(groupActor.flags?.[MODULE_ID]?.legacyInventoryCurrencyMergePairs ?? {});
      currencyPairs[pairKey] = {
        legacyInventoryActorId: legacyActor.id,
        groupActorId: groupActor.id,
        appliedAt: currencyAppliedAt
      };

      await groupActor.update({
        ...buildCurrencyUpdatePatch(mergedCurrency),
        [`flags.${MODULE_ID}.legacyInventoryCurrencyMergePairs`]: currencyPairs
      });
      await persistPairProgress((nextPairState) => {
        nextPairState.currencyAppliedAt = currencyAppliedAt;
      });
    }

    const mergeIndex = buildInventoryMergeIndex(groupActor);
    let mergedItems = 0;
    let createdItems = 0;

    for (const { key, itemData: sourceItemData, quantity: sourceTotalQuantity } of buildLegacyInventorySourceMergeGroups(legacyActor).values()) {
      const targetItem = mergeIndex.get(key) ?? null;
      const appliedQuantity = Math.max(
        toNumber(getLegacyInventoryMergePairState(context.groupState, pairKey).itemsByKey?.[key]?.quantityApplied, 0),
        toNumber(targetItem ? getLegacyInventoryItemPairState(targetItem, pairKey, key).quantityApplied : 0, 0)
      );
      const remainingQuantity = roundNumber(sourceTotalQuantity - appliedQuantity, 2);
      if (remainingQuantity <= 0) {
        continue;
      }

      const itemAppliedAt = Date.now();
      if (targetItem) {
        const nextQuantity = roundNumber(getRawQuantity(targetItem.toObject?.() ?? targetItem) + remainingQuantity, 2);
        const itemPairs = foundry.utils.deepClone(targetItem.flags?.[MODULE_ID]?.legacyInventoryItemMergePairs ?? {});
        itemPairs[pairKey] = {
          ...(itemPairs[pairKey] ?? {}),
          [key]: {
            quantityApplied: sourceTotalQuantity,
            appliedAt: itemAppliedAt,
            targetItemId: targetItem.id ?? ""
          }
        };
        await targetItem.update({
          "system.quantity": nextQuantity,
          [`flags.${MODULE_ID}.legacyInventoryItemMergePairs`]: itemPairs
        });
        await persistPairProgress((nextPairState) => {
          nextPairState.itemsByKey[key] = {
            quantityApplied: sourceTotalQuantity,
            targetItemId: targetItem.id ?? "",
            created: false,
            appliedAt: itemAppliedAt
          };
        });
        mergedItems += 1;
        continue;
      }

      foundry.utils.setProperty(sourceItemData, "system.quantity", remainingQuantity);
      sourceItemData.flags = sourceItemData.flags && typeof sourceItemData.flags === "object" ? sourceItemData.flags : {};
      sourceItemData.flags[MODULE_ID] = sourceItemData.flags[MODULE_ID] && typeof sourceItemData.flags[MODULE_ID] === "object"
        ? sourceItemData.flags[MODULE_ID]
        : {};
      sourceItemData.flags[MODULE_ID].legacyInventoryItemMergePairs = {
        ...(sourceItemData.flags[MODULE_ID].legacyInventoryItemMergePairs ?? {}),
        [pairKey]: {
          [key]: {
            quantityApplied: sourceTotalQuantity,
            appliedAt: itemAppliedAt,
            targetItemId: ""
          }
        }
      };
      const [created] = await groupActor.createEmbeddedDocuments("Item", [sourceItemData], { renderSheet: false });
      if (created) {
        mergeIndex.set(key, created);
        await persistPairProgress((nextPairState) => {
          nextPairState.itemsByKey[key] = {
            quantityApplied: sourceTotalQuantity,
            targetItemId: created.id ?? "",
            created: true,
            appliedAt: itemAppliedAt
          };
        });
        createdItems += 1;
      }
    }

    const mergedAt = Date.now();
    await persistPairProgress((nextPairState) => {
      nextPairState.completedAt = mergedAt;
      nextPairState.currencyAppliedAt = Number(nextPairState.currencyAppliedAt) || mergedAt;
    });

    const legacyFlag = foundry.utils.deepClone(legacyActor.getFlag?.(MODULE_ID, "legacyInventoryMergedIntoGroup") ?? {});
    await legacyActor.setFlag?.(MODULE_ID, "legacyInventoryMergedIntoGroup", {
      ...legacyFlag,
      groupActorId: groupActor.id,
      mergedAt,
      pairs: {
        ...(legacyFlag.pairs ?? {}),
        [pairKey]: {
          groupActorId: groupActor.id,
          completedAt: mergedAt
        }
      }
    });

    return {
      mergedItems,
      createdItems,
      mergedCurrency: sourceCurrency,
      legacyInventoryActorId: legacyActor.id,
      groupActorId: groupActor.id,
      noop: false
    };
  }

  async openInventoryActorSheet() {
    const actor = await this.getInventoryActor({ create: true });
    if (!actor) {
      throw new Error("Не удалось получить актёра партийного инвентаря.");
    }

    await actor.sheet?.render?.(true);
    return actor;
  }

  async getLootgenChatActor({ create = false } = {}) {
    const existingActor = game.actors.contents.find((actor) => actor.getFlag(MODULE_ID, "managedLootgenChatActor")) ?? null;
    if (existingActor) {
      return existingActor;
    }

    if (!create || !game.user?.isGM) {
      return null;
    }

    return Actor.create({
      name: LOOTGEN_CHAT_ACTOR_NAME,
      type: "npc",
      img: "icons/containers/chest/chest-reinforced-steel-brown.webp",
      ownership: {
        default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
      },
      flags: {
        [MODULE_ID]: {
          managedLootgenChatActor: true
        }
      }
    }, {
      renderSheet: false
    });
  }

  async buildModelItemData(sourceType, sourceId, quantity = 1) {
    const model = await this.moduleApi.getModel();
    const safeQuantity = Math.max(0.01, roundNumber(toNumber(quantity, 1), 2));
    const normalizedSourceType = normalizeInventorySourceType(sourceType);

    if (normalizedSourceType === "material") {
      const material = model.materialById?.get(sourceId) ?? null;
      if (!material) {
        throw new Error("Материал не найден в данных модуля.");
      }

      const itemData = this.#buildMaterialItemData(material, safeQuantity);
      itemData.img = await this.#resolveManagedCompendiumIcon(
        MATERIALS_COMPENDIUM_NAME,
        ["materialId"],
        material.id,
        material.name,
        itemData.img
      );
      return itemData;
    }

    if (normalizedSourceType === "gear") {
      const gearItem = model.gearById?.get(sourceId) ?? null;
      if (!gearItem) {
        throw new Error("Предмет снаряжения не найден в данных модуля.");
      }

      const itemData = this.#buildGearItemData(gearItem, safeQuantity);
      itemData.img = await this.#resolveManagedCompendiumIcon(
        GEAR_COMPENDIUM_NAME,
        ["gearId", "sourceId"],
        gearItem.id,
        gearItem.name,
        itemData.img
      );
      return itemData;
    }

    if (normalizedSourceType === "magicItem") {
      const pack = game.packs.get(`world.${MAGIC_ITEMS_COMPENDIUM_NAME}`) ?? null;
      const document = await this.moduleApi.magicItemsCompendium.getMagicItemDocument(sourceId);
      if (!pack || !document) {
        throw new Error("Магический предмет не найден в компендиуме.");
      }

      const itemData = sanitizeEmbeddedItemData(document.toObject());
      foundry.utils.setProperty(itemData, "system.quantity", safeQuantity);
      itemData.flags = itemData.flags && typeof itemData.flags === "object" ? itemData.flags : {};
      itemData.flags[MODULE_ID] = {
        ...(itemData.flags[MODULE_ID] ?? {}),
        sourceType: "magicItem",
        sourceId,
        magicItemId: sourceId,
        magical: true
      };
      return itemData;
    }

    throw new Error("Неизвестный тип предмета для добавления в склад.");
  }

  async #resolveManagedCompendiumIcon(packName, flagNames, sourceId, fallbackName, fallbackIcon) {
    const fallback = String(fallbackIcon ?? "icons/svg/item-bag.svg").trim() || "icons/svg/item-bag.svg";
    const pack = game.packs.get(`world.${packName}`) ?? null;
    if (!pack) {
      return fallback;
    }

    const safeSourceId = String(sourceId ?? "").trim();
    const safeFallbackName = normalizeText(fallbackName);
    const safeFlagNames = Array.isArray(flagNames) ? flagNames.filter(Boolean) : [];
    const fields = safeFlagNames.map((flagName) => `flags.${MODULE_ID}.${flagName}`);

    try {
      const index = await pack.getIndex({ fields });
      const indexEntry = index.find((entry) => {
        if (safeSourceId) {
          for (const flagName of safeFlagNames) {
            if (String(foundry.utils.getProperty(entry, `flags.${MODULE_ID}.${flagName}`) ?? "").trim() === safeSourceId) {
              return true;
            }
          }
        }

        return safeFallbackName && normalizeText(entry.name) === safeFallbackName;
      }) ?? null;

      const document = indexEntry
        ? await pack.getDocument(indexEntry._id ?? indexEntry.id)
        : null;
      return String(document?.img ?? "").trim() || fallback;
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to resolve compendium icon for '${fallbackName}'.`, error);
      return fallback;
    }
  }

  async buildLootgenChatItemData(row, lootMeta = {}) {
    if (!game.user?.isGM) {
      throw new Error("Отправлять лут в чат может только ГМ.");
    }

    const itemData = await this.buildLootgenItemData(row);
    itemData.flags = itemData.flags && typeof itemData.flags === "object" ? itemData.flags : {};
    itemData.flags[MODULE_ID] = {
      ...(itemData.flags[MODULE_ID] ?? {}),
      lootgenChat: {
        lootId: String(lootMeta.lootId ?? ""),
        rowId: String(lootMeta.rowId ?? ""),
        appKey: String(lootMeta.appKey ?? ""),
        rowIndex: Number.isFinite(Number(lootMeta.rowIndex)) ? Number(lootMeta.rowIndex) : null
      }
    };

    return itemData;
  }

  async buildLootgenItemData(row = {}, { allowPersistedItemData = false } = {}) {
    const safeQuantity = Math.max(0.01, roundNumber(toNumber(row.quantity, 1), 2));
    if (allowPersistedItemData && row.itemData && typeof row.itemData === "object") {
      const persistedItemData = sanitizeEmbeddedItemData(row.itemData);
      foundry.utils.setProperty(persistedItemData, "system.quantity", safeQuantity);
      persistedItemData.name = formatDurabilityItemName(
        persistedItemData.name,
        persistedItemData.flags?.[MODULE_ID]?.durability
      );
      return persistedItemData;
    }

    let itemData;
    if (normalizeInventorySourceType(row.sourceType) === "gear") {
      const sourceData = await this.#loadCraftGearSourceData({
        sourceId: cleanId(row.sourceId),
        sourceDocumentId: cleanId(row.sourceDocumentId)
      });
      itemData = sanitizeEmbeddedItemData(sourceData);
      foundry.utils.setProperty(itemData, "system.quantity", safeQuantity);
      foundry.utils.setProperty(itemData, "system.equipped", false);
      clearCraftOutputAttunement(itemData);
      itemData.flags = itemData.flags && typeof itemData.flags === "object" ? itemData.flags : {};
      itemData.flags[MODULE_ID] = {
        ...(itemData.flags[MODULE_ID] ?? {}),
        sourceType: "gear",
        sourceId: cleanId(row.sourceId),
        gearId: cleanId(row.sourceId)
      };
      delete itemData.flags[MODULE_ID].held;
      delete itemData.flags[MODULE_ID].isHeld;
      delete itemData.flags[MODULE_ID].heldHands;
      delete itemData.flags[MODULE_ID].versatileBaseDamageOriginal;
      delete itemData.flags[MODULE_ID].durability;
      delete itemData.flags[MODULE_ID][INVENTORY_MUTATION_FLAG];
    }
    else {
      itemData = await this.buildModelItemData(row.sourceType, row.sourceId, safeQuantity);
    }
    if (row.isBroken !== true || normalizeInventorySourceType(row.sourceType) !== "gear") {
      return itemData;
    }

    const model = await this.moduleApi.getModel();
    return applyLootgenRowDurability(itemData, row, {
      model,
      updatedAt: new Date().toISOString()
    });
  }

  async createLootgenChatItem(row, lootMeta = {}) {
    if (!game.user?.isGM) {
      throw new Error("Отправлять лут в чат может только ГМ.");
    }

    const actor = await this.getLootgenChatActor({ create: true });
    if (!actor) {
      throw new Error("Не удалось подготовить актёра чат-лута.");
    }

    const itemData = await this.buildLootgenChatItemData(row, lootMeta);
    const [created] = await actor.createEmbeddedDocuments("Item", [itemData], { renderSheet: false });
    return created ?? null;
  }

  async deleteLootgenChatItem(itemUuid) {
    if (!game.user?.isGM || !itemUuid) {
      return false;
    }

    let itemDocument = null;
    try {
      itemDocument = await fromUuid(itemUuid);
    }
    catch (error) {
      if (String(error?.message ?? "").includes("does not exist")) {
        return false;
      }

      throw error;
    }

    if (!(itemDocument instanceof Item)) {
      return false;
    }

    const parentActor = itemDocument.parent;
    if (!(parentActor instanceof Actor) || !parentActor.getFlag(MODULE_ID, "managedLootgenChatActor")) {
      return false;
    }

    try {
      await itemDocument.delete();
    }
    catch (error) {
      if (String(error?.message ?? "").includes("does not exist")) {
        return false;
      }

      throw error;
    }
    return true;
  }

  async getPartySnapshot({ actor = null } = {}) {
    const state = this.#getState();
    const inventoryActor = actor ?? await this.getInventoryActor({ create: false });
    const partyInventoryWeight = inventoryActor ? this.#getInventoryWeight(inventoryActor) : 0;
    const model = inventoryActor ? await this.moduleApi.getModel() : null;

    const membershipManagedByNativeGroup = this.#isNativeGroupInventoryActor(inventoryActor);
    const partyMembers = this.#buildPartyMemberRows(state, inventoryActor)
      .map(({ actorId, actor: actorDocument, memberState }) => {
        const inventoryWeight = actorDocument ? this.#getInventoryWeight(actorDocument) : 0;
        const effectiveStrength = memberState.strOverride ?? getActorStrength(actorDocument);
        const capacityMultiplier = memberState.capModOverride ?? state.defaultCapMod;
        const legacyCapacityLb = memberState.role === "transport"
          ? roundNumber(memberState.capBonusLb, 2)
          : roundNumber((effectiveStrength * capacityMultiplier) + memberState.capBonusLb, 2);
        const transportProfile = buildTransportProfileFromActor(actorDocument, memberState, {
          memberCapacityLb: legacyCapacityLb,
          memberRole: memberState.role,
          groupActorId: inventoryActor?.id
        });
        const explicitVehicleCapacity = transportProfile?.hasExplicitCargoCapacity
          ? Math.max(0, Number(transportProfile.cargoCapacityLb) || 0)
          : 0;
        const capacityLb = (
          ["transport", "mount"].includes(memberState.role)
          && explicitVehicleCapacity > 0
        )
          ? roundNumber(explicitVehicleCapacity + memberState.capBonusLb, 2)
          : legacyCapacityLb;
        const energyState = clampEnergyCurrent(memberState, actorDocument);
        const conModEffective = memberState.conModOverride ?? getActorConMod(actorDocument);
        const toolEntries = REBREYA_TOOLS.map((tool) => {
          const currentToolState = normalizeToolState(memberState.tools?.[tool.id]);
          return {
            toolId: tool.id,
            label: tool.label,
            owned: currentToolState.owned,
            prof: currentToolState.prof,
            mod: currentToolState.mod,
            rank: currentToolState.rank
          };
        });

        return {
          actorId,
          actorName: actorDocument?.name ?? actorId,
          actorImg: actorDocument?.img ?? "icons/svg/mystery-man.svg",
          actorType: actorDocument?.type ?? "",
          isVehicle: actorDocument?.type === "vehicle",
          transport: transportProfile,
          isMissing: !actorDocument,
          role: memberState.role,
          roleLabel: getRoleLabel(memberState.role),
          inventoryWeight,
          strength: effectiveStrength,
          strengthSource: memberState.strOverride !== null ? "Ручная" : "Лист",
          capacityMultiplier,
          capacityLb,
          currencyGp: roundNumber(actorCurrencyToCopper(actorDocument) / CURRENCY_MULTIPLIERS.gp, 2),
          capBonusLb: memberState.capBonusLb,
          foodPerDay: memberState.foodPerDay,
          waterGalPerDay: memberState.waterGalPerDay,
          conMod: conModEffective,
          conModSource: memberState.conModOverride !== null ? "Ручной" : "Лист",
          conModOverride: memberState.conModOverride === null ? "" : String(memberState.conModOverride),
          energyCurrent: energyState.current,
          energyMax: energyState.max,
          energyPercent: energyState.max > 0
            ? Math.max(0, Math.min(100, roundNumber((energyState.current / energyState.max) * 100, 0)))
            : 0,
          strOverride: memberState.strOverride === null ? "" : String(memberState.strOverride),
          capModOverride: memberState.capModOverride === null ? "" : String(memberState.capModOverride),
          tools: toolEntries,
          roleOptions: ["member", "mount", "transport"].map((value) => ({
            value,
            label: getRoleLabel(value),
            selected: value === memberState.role
          }))
        };
      })
      .sort((left, right) => left.actorName.localeCompare(right.actorName, "ru"));

    const memberInventoryWeight = roundNumber(partyMembers.reduce((sum, member) => sum + member.inventoryWeight, 0), 2);
    const inventoryWeight = roundNumber(partyInventoryWeight + memberInventoryWeight, 2);
    const totalCapacityLb = roundNumber(partyMembers.reduce((sum, member) => sum + member.capacityLb, 0), 2);
    const foodRequiredPerDay = roundNumber(partyMembers.reduce((sum, member) => sum + member.foodPerDay, 0), 2);
    const waterRequiredPerDay = roundNumber(partyMembers.reduce((sum, member) => sum + member.waterGalPerDay, 0), 2);
    const totalFoodPerDay = state.coverFoodExpenses ? 0 : foodRequiredPerDay;
    const totalWaterGalPerDay = state.coverWaterExpenses ? 0 : waterRequiredPerDay;
    const totalEnergyCurrent = roundNumber(partyMembers.reduce((sum, member) => sum + member.energyCurrent, 0), 0);
    const totalEnergyMax = roundNumber(partyMembers.reduce((sum, member) => sum + member.energyMax, 0), 0);
    const availableActors = membershipManagedByNativeGroup
      ? []
      : game.actors.contents
        .filter((actorDocument) => {
          if (!actorDocument?.isOwner) {
            return false;
          }

          if (actorDocument.id === state.inventoryActorId) {
            return false;
          }

          if (actorDocument.getFlag(MODULE_ID, "managedTrader")) {
            return false;
          }

          return !state.members[actorDocument.id];
        })
        .sort((left, right) => left.name.localeCompare(right.name, "ru"))
        .map((actorDocument) => ({
          id: actorDocument.id,
          name: actorDocument.name
        }));

    const inventoryEntries = inventoryActor && model
      ? inventoryActor.items.contents.map((item) => this.#buildInventoryEntry(model, item))
      : [];
    const foodLb = roundNumber(inventoryEntries.reduce((sum, entry) => sum + (entry.isFood ? entry.quantity : 0), 0), 2);
    const waterGal = roundNumber(inventoryEntries.reduce((sum, entry) => sum + (entry.isWater ? entry.quantity : 0), 0), 2);

    return {
      defaultCapMod: state.defaultCapMod,
      coverFoodExpenses: state.coverFoodExpenses,
      coverWaterExpenses: state.coverWaterExpenses,
      members: partyMembers,
      memberCount: partyMembers.length,
      emptyMembers: partyMembers.length === 0,
      availableActors,
      membershipManagedByNativeGroup,
      totalCapacityLb,
      totalFoodPerDay,
      totalWaterGalPerDay,
      totalEnergyCurrent,
      totalEnergyMax,
      partyInventoryWeight,
      memberInventoryWeight,
      inventoryWeight,
      freeCapacityLb: roundNumber(totalCapacityLb - inventoryWeight, 2),
      foodLb,
      waterGal,
      foodDaysLeft: totalFoodPerDay > 0 ? roundNumber(foodLb / totalFoodPerDay, 1) : null,
      waterDaysLeft: totalWaterGalPerDay > 0 ? roundNumber(waterGal / totalWaterGalPerDay, 1) : null,
      canManage: this.canManagePartyInventory(inventoryActor),
      canDropInventoryItems: this.canDropInventoryItems(inventoryActor)
    };
  }

  replaceGroupTransportState(groupActorId, nextState) {
    if (!this.moduleApi.groupContextService?.mutateGroupState) {
      throw new Error("Group context service is unavailable.");
    }

    const transportState = normalizeGroupTransportState(nextState);
    return this.moduleApi.groupContextService.mutateGroupState(groupActorId, (groupState) => {
      groupState.transportState = foundry.utils.deepClone(transportState);
      return transportState;
    });
  }

  async getTransportSnapshot({
    partySnapshot = null,
    inventorySnapshot = null,
    transportState = null,
    context = null
  } = {}) {
    let groupContext = context;
    if (!groupContext) {
      try {
        groupContext = this.moduleApi.groupContextService?.resolveForCurrentUser?.() ?? null;
      }
      catch (error) {
        if (!GROUP_CONTEXT_FALLBACK_ERRORS.has(error?.message)) {
          throw error;
        }

        return buildEmptyTransportSnapshot({
          warning: error.message || "Группа для транспорта не выбрана.",
          canManage: false
        });
      }
    }

    const resolvedPartySnapshot = partySnapshot ?? await this.getPartySnapshot();
    const resolvedInventorySnapshot = inventorySnapshot ?? await this.getInventorySnapshot({
      createActor: false
    });
    const state = normalizeGroupTransportState(
      transportState ?? groupContext?.groupState?.transportState ?? {}
    );
    const canManage = Boolean(
      groupContext?.canManage
      || resolvedPartySnapshot?.canManage
      || resolvedInventorySnapshot?.actor?.canEdit
      || resolvedInventorySnapshot?.canDropInventoryItems
    );
    const vehiclesById = new Map();
    const addVehicle = (vehicle) => {
      if (!vehicle?.id || !vehicle.isTransport || vehicle.isConcreteInstance !== true) {
        return;
      }
      if (!vehiclesById.has(vehicle.id)) {
        vehiclesById.set(vehicle.id, vehicle);
      }
    };

    for (const member of resolvedPartySnapshot?.members ?? []) {
      addVehicle(buildTransportProfileFromPartyMember(member));
    }

    const vehicles = [...vehiclesById.values()]
      .sort((left, right) => {
        const sourceSort = String(left.sourceKind).localeCompare(String(right.sourceKind), "ru");
        return sourceSort || left.name.localeCompare(right.name, "ru");
      });
    const requestedActive = state.activeTransportId ? vehiclesById.get(state.activeTransportId) ?? null : null;
    const activeVehicle = requestedActive ?? (vehicles.length === 1 ? vehicles[0] : null);
    const activeTransportId = activeVehicle?.id ?? "";
    const effectiveSpeedMph = activeVehicle?.speedMph > 0
      ? roundNumber(activeVehicle.speedMph, 2)
      : DEFAULT_TRAVEL_SPEED_MPH;
    const cargoCapacityLb = Math.max(0, toNumber(activeVehicle?.cargoCapacityLb, 0));
    const cargoUsedLb = roundNumber(toNumber(resolvedPartySnapshot?.inventoryWeight, 0), 2);
    const cargoFreeLb = roundNumber(cargoCapacityLb - cargoUsedLb, 2);
    const vehicleRows = vehicles
      .map((vehicle) => ({
        ...vehicle,
        active: Boolean(activeVehicle && vehicle.id === activeVehicle.id),
        fuel: buildTransportFuelSnapshot(vehicle, groupContext?.groupActor)
      }))
      .sort((left, right) => Number(right.active) - Number(left.active));
    const activeVehicleRow = vehicleRows.find((vehicle) => vehicle.active) ?? null;
    const fuel = activeVehicleRow?.fuel ?? buildTransportFuelSnapshot(null, groupContext?.groupActor);

    return {
      available: true,
      warning: "",
      canManage,
      vehicles: vehicleRows,
      hasVehicles: vehicleRows.length > 0,
      activeTransportId,
      activeVehicle: activeVehicleRow,
      fuel,
      effectiveSpeedMph,
      speedLabel: formatTransportSpeedLabel(effectiveSpeedMph),
      speedSourceLabel: activeVehicle?.name ?? "Пешком",
      cargoCapacityLb,
      cargoUsedLb,
      cargoFreeLb,
      cargoLabel: activeVehicle ? formatPoundLabel(cargoCapacityLb) : "-",
      cargoUsageLabel: activeVehicle && cargoCapacityLb > 0
        ? `${formatPoundLabel(cargoUsedLb)} / ${formatPoundLabel(cargoCapacityLb)}`
        : "-",
      cargoFreeLabel: activeVehicle && cargoCapacityLb > 0 ? formatPoundLabel(cargoFreeLb) : "-",
      cargoOverloaded: activeVehicle && cargoCapacityLb > 0 && cargoFreeLb < 0,
      durabilityLabel: activeVehicle?.durabilityLabel ?? "-",
      fallbackSpeedMph: DEFAULT_TRAVEL_SPEED_MPH,
      fallbackSpeedLabel: formatTransportSpeedLabel(DEFAULT_TRAVEL_SPEED_MPH)
    };
  }

  async getActiveTransportSpeedMeta({ context = null } = {}) {
    const snapshot = await this.getTransportSnapshot({ context });
    return {
      speedMph: snapshot.effectiveSpeedMph,
      label: snapshot.speedLabel,
      sourceLabel: snapshot.speedSourceLabel
    };
  }

  async getInventorySnapshot({
    search = "",
    typeFilter = "all",
    createActor = true,
    groupActorId = ""
  } = {}) {
    const actor = await this.getInventoryActor({ create: createActor, groupActorId });
    if (!actor) {
      return {
        actor: null,
        hasActor: false,
        folders: [],
        folderStateVersion: INVENTORY_FOLDER_STATE_VERSION,
        inventoryIngressRules: normalizeInventoryIngressRuleState(null),
        items: [],
        allItems: [],
        emptyInventory: true,
        canDropInventoryItems: false,
        groupContextError: this.lastGroupContextError || "",
        summary: {
          distinctCount: 0,
          totalQuantity: 0,
          totalWeight: 0,
          foodLb: 0,
          waterGal: 0,
          currencyLabel: `0 ${COIN_LABELS.cp}`
        }
      };
    }

    const model = await this.moduleApi.getModel();
    const currency = buildCurrencySnapshot(actor);
    const folderState = this.#readInventoryFolderState(actor);
    const inventoryIngressRules = this.#readInventoryIngressRuleState(actor);
    const allItems = actor.items.contents
      .map((item) => {
        const entry = this.#buildInventoryEntry(model, item);
        return {
          ...entry,
          folderId: folderState.itemFolderIds[entry.itemId] ?? null
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
    const normalizedSearch = normalizeText(search);
    const filteredItems = allItems.filter((entry) => {
      if (typeFilter !== "all" && entry.sourceType !== typeFilter) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return normalizeText([
        entry.name,
        entry.itemTypeLabel,
        entry.materialLabel,
        entry.sourceTypeLabel
      ].join(" ")).includes(normalizedSearch);
    });

    const summary = {
      distinctCount: allItems.length,
      totalQuantity: roundNumber(allItems.reduce((sum, entry) => sum + entry.quantity, 0), 2),
      totalWeight: roundNumber(allItems.reduce((sum, entry) => sum + entry.totalWeight, 0), 2),
      foodLb: roundNumber(allItems.reduce((sum, entry) => sum + (entry.isFood ? entry.quantity : 0), 0), 2),
      waterGal: roundNumber(allItems.reduce((sum, entry) => sum + (entry.isWater ? entry.quantity : 0), 0), 2),
      currencyLabel: currency.label,
      currency
    };

    return {
      actor: {
        id: actor.id,
        name: actor.name,
        img: actor.img,
        currencyLabel: currency.label,
        currency,
        canEdit: actor.isOwner
      },
      hasActor: true,
      folders: folderState.folders,
      folderStateVersion: folderState.version,
      inventoryIngressRules,
      items: filteredItems,
      allItems,
      emptyInventory: filteredItems.length === 0,
      canDropInventoryItems: this.canDropInventoryItems(actor),
      summary
    };
  }

  async updateItemQuantity(itemId, nextQuantity) {
    const actor = await this.getInventoryActor({ create: true });
    this.#assertCanManagePartyInventory(actor);
    const item = actor?.items.get(itemId) ?? null;
    if (!item) {
      throw new Error("Предмет не найден в партийном инвентаре.");
    }

    const safeQuantity = roundNumber(toNumber(nextQuantity, 0), 2);
    if (safeQuantity <= 0) {
      await item.delete();
      return null;
    }

    await item.update({
      "system.quantity": safeQuantity
    });

    return item;
  }

  async deleteItem(itemId) {
    const actor = await this.getInventoryActor({ create: true });
    if (!actor) {
      throw new Error("Не удалось получить партийный инвентарь.");
    }

    if (!this.canManagePartyInventory(actor)) {
      this.#assertInventoryActionSocketAvailable(actor);
      this.#emitInventoryItemActionRequest("delete", {
        inventoryActorUuid: actor.uuid,
        itemId: cleanId(itemId)
      });
      return {
        requested: true,
        action: "delete",
        itemId: cleanId(itemId)
      };
    }

    return this.#deleteInventoryItemFromActor(actor, itemId);
  }

  async takeInventoryItemToCharacter(itemId, { actorId = "", quantity = 1, mutationId = "" } = {}) {
    const actor = await this.getInventoryActor({ create: true });
    if (!actor) {
      throw new Error("Не удалось получить партийный инвентарь.");
    }

    const targetActor = this.#resolveRecipientCharacter(actorId, actor);
    const operationId = createInventoryMutationId("inventory-take", mutationId);
    if (!game.user?.isGM && typeof this.moduleApi.socketCommandBus?.request === "function") {
      return this.moduleApi.socketCommandBus.request(INVENTORY_TAKE_COMMAND, {
        inventoryActorId: actor.id,
        itemId: cleanId(itemId),
        mutationId: operationId,
        quantity: Math.max(0.01, roundNumber(toNumber(quantity, 1), 2)),
        targetActorId: targetActor.id
      });
    }
    if (!this.canManagePartyInventory(actor)) {
      this.#assertInventoryActionSocketAvailable(actor);
      if (!cleanId(targetActor.uuid)) {
        throw new Error("Не удалось определить персонажа для получения предмета.");
      }

      this.#emitInventoryItemActionRequest("take", {
        inventoryActorUuid: actor.uuid,
        itemId: cleanId(itemId),
        targetActorUuid: targetActor.uuid,
        quantity: Math.max(0.01, roundNumber(toNumber(quantity, 1), 2))
      });
      return {
        requested: true,
        action: "take",
        itemId: cleanId(itemId),
        actorId: targetActor.id
      };
    }

    return this.#takeInventoryItemFromActor(actor, itemId, targetActor, quantity, { mutationId: operationId });
  }

  async sellInventoryItem(itemId, quantity = 1, { mutationId = "" } = {}) {
    const actor = await this.getInventoryActor({ create: true });
    if (!actor) {
      throw new Error("Не удалось получить партийный инвентарь.");
    }

    const operationId = createInventoryMutationId("inventory-sale", mutationId);
    if (!game.user?.isGM && typeof this.moduleApi.socketCommandBus?.request === "function") {
      return this.moduleApi.socketCommandBus.request(INVENTORY_SALE_COMMAND, {
        inventoryActorId: actor.id,
        itemId: cleanId(itemId),
        mutationId: operationId,
        quantity: Math.max(0.01, roundNumber(toNumber(quantity, 1), 2))
      });
    }
    if (!this.canManagePartyInventory(actor)) {
      this.#assertInventoryActionSocketAvailable(actor);
      this.#emitInventoryItemActionRequest("sell", {
        inventoryActorUuid: actor.uuid,
        itemId: cleanId(itemId),
        quantity: Math.max(0.01, roundNumber(toNumber(quantity, 1), 2))
      });
      return {
        requested: true,
        action: "sell",
        itemId: cleanId(itemId)
      };
    }

    return this.#sellInventoryItemFromActor(actor, itemId, quantity, { mutationId: operationId });
  }

  async addSupply(resourceKey, quantity) {
    const normalizedKey = resourceKey === "water" ? "water" : "food";
    const quantityDelta = roundNumber(toNumber(quantity, 0), 2);
    const actor = await this.getInventoryActor({ create: true });
    this.#assertCanManagePartyInventory(actor);
    const item = await this.#ensureSupplyItem(actor, normalizedKey);
    if (!item) {
      throw new Error("Не удалось подготовить предмет запасов.");
    }

    const currentQuantity = getRawQuantity(item.toObject());
    const nextQuantity = Math.max(0, roundNumber(currentQuantity + quantityDelta, 2));
    await item.update({
      "system.quantity": nextQuantity,
      "system.weight.value": normalizedKey === "water" ? WATER_LB_PER_GALLON : 1
    });

    return item;
  }

  async updateCurrency(values = {}) {
    const actor = await this.getInventoryActor({ create: true });
    if (!actor) {
      throw new Error("Не удалось получить партийный инвентарь.");
    }

    const currentCurrency = buildCurrencySnapshot(actor);
    const nextCurrency = buildNextCurrency(values, currentCurrency);
    if (!game.user?.isGM && typeof this.moduleApi.socketCommandBus?.request === "function") {
      return this.moduleApi.socketCommandBus.request(INVENTORY_CURRENCY_UPDATE_COMMAND, {
        inventoryActorId: actor.id,
        values: nextCurrency
      });
    }

    this.#assertCanManagePartyInventory(actor);
    return this.#updateCurrencyOnActor(actor, nextCurrency);
  }

  async convertCurrency(mode = "normalized") {
    const actor = await this.getInventoryActor({ create: true });
    if (!actor) {
      throw new Error("Не удалось получить партийный инвентарь.");
    }

    const safeMode = normalizeCurrencyMode(mode);
    if (!game.user?.isGM && typeof this.moduleApi.socketCommandBus?.request === "function") {
      return this.moduleApi.socketCommandBus.request(INVENTORY_CURRENCY_CONVERT_COMMAND, {
        inventoryActorId: actor.id,
        mode: safeMode
      });
    }

    this.#assertCanManagePartyInventory(actor);
    return this.#convertCurrencyOnActor(actor, safeMode);
  }

  async #updateCurrencyOnActor(actor, values = {}) {
    const currentCurrency = buildCurrencySnapshot(actor);
    const nextCurrency = buildNextCurrency(values, currentCurrency);
    await actor.update(buildCurrencyUpdatePatch(nextCurrency));
    return buildCurrencySnapshot(actor);
  }

  async #convertCurrencyOnActor(actor, mode = "normalized") {
    const totalCopper = actorCurrencyToCopper(actor);
    await actor.update(buildCurrencyUpdatePatch(copperToCurrency(totalCopper, normalizeCurrencyMode(mode))));
    return {
      ...buildCurrencySnapshot(actor),
      totalCopper
    };
  }

  async executeCurrencyUpdateMutation(payload = {}) {
    const inventoryActor = game.actors?.get?.(cleanId(payload.inventoryActorId)) ?? null;
    if (!isManagedPartyGroup(inventoryActor)) {
      throw new Error("Некорректный партийный склад для изменения монет.");
    }

    return this.#updateCurrencyOnActor(inventoryActor, payload.values ?? {});
  }

  async executeCurrencyConvertMutation(payload = {}) {
    const inventoryActor = game.actors?.get?.(cleanId(payload.inventoryActorId)) ?? null;
    if (!isManagedPartyGroup(inventoryActor)) {
      throw new Error("Некорректный партийный склад для конвертации монет.");
    }

    return this.#convertCurrencyOnActor(inventoryActor, payload.mode);
  }

  async #commitDirectInventoryIngress({
    actor,
    itemData,
    quantity,
    folderId = null,
    batchMutationId,
    sourceOrigin
  }) {
    if (actor?.type !== "group") {
      return this.#upsertInventoryItem(actor, itemData, quantity);
    }
    const row = {
      sourceKey: "item",
      quantity,
      itemData: foundry.utils.deepClone(itemData),
      legacyFolderId: normalizeInventoryFolderTarget(folderId),
      container: null
    };
    const preview = await this.moduleApi.inventoryIngressPlanner.preview({
      groupActorId: actor.id,
      requestedFolderId: row.legacyFolderId,
      rows: [row],
      batch: false
    });
    const choices = await this.moduleApi.inventoryIngressPlanner.collectChoices(preview);
    if (choices === null) {
      return { actorId: actor.id, batchMutationId, cancelled: true, changed: false, rows: [] };
    }
    const serializedPlan = this.moduleApi.inventoryIngressPlanner.serialize(preview, choices);
    return this.commitInventoryIngressBatch({
      groupActorId: actor.id,
      batchMutationId,
      sourceOrigin,
      serializedPlan
    }, {
      resolveRows: async () => [foundry.utils.deepClone(row)],
      debitRow: async () => {}
    });
  }

  async addModelItemToInventory(sourceType, sourceId, quantity = 1, {
    groupActorId = "",
    folderId = null,
    batchMutationId = ""
  } = {}) {
    const normalizedGroupActorId = cleanId(groupActorId);
    const actor = await this.getInventoryActor({ create: true, groupActorId: normalizedGroupActorId });
    this.#assertCanManagePartyInventory(actor);
    if (!actor) {
      throw new Error("Не удалось получить партийный инвентарь.");
    }

    const safeQuantity = Math.max(0.01, roundNumber(toNumber(quantity, 1), 2));
    const itemData = await this.buildModelItemData(sourceType, sourceId, safeQuantity);
    return this.#commitDirectInventoryIngress({
      actor,
      itemData,
      quantity: safeQuantity,
      folderId,
      batchMutationId: createInventoryMutationId("inventory-model", batchMutationId),
      sourceOrigin: "public-model"
    });
  }

  async addLootgenRowToInventory(row = {}) {
    const actor = await this.getInventoryActor({ create: true });
    this.#assertCanManagePartyInventory(actor);
    if (!actor) {
      throw new Error("Не удалось получить партийный инвентарь.");
    }

    const safeQuantity = Math.max(0.01, roundNumber(toNumber(row.quantity, 1), 2));
    const itemData = await this.buildLootgenItemData(row);
    return this.#commitDirectInventoryIngress({
      actor,
      itemData,
      quantity: safeQuantity,
      batchMutationId: createInventoryMutationId("inventory-lootgen", row.directGrantId),
      sourceOrigin: "lootgen"
    });
  }

  addModelItemToInventoryOnce(sourceType, sourceId, quantity, mutationId) {
    return this.mutationCoordinator.run(
      "inventory",
      () => this.#executeAddModelItemOnce(sourceType, sourceId, quantity, mutationId)
    );
  }

  addLootgenRowToInventoryOnce(
    row,
    mutationId,
    { allowPersistedItemData = false, groupActorId = "", folderId = null } = {}
  ) {
    const frozenRow = foundry.utils.deepClone(row ?? {});
    const frozenGroupActorId = cleanId(groupActorId);
    const frozenFolderId = normalizeInventoryFolderTarget(folderId);
    return this.mutationCoordinator.run(
      "inventory",
      () => {
        if (allowPersistedItemData && !isActiveGmClient()) {
          throw new Error("Only the active GM can grant persisted storage items.");
        }
        return this.#executeInventoryGrantOnce({
          quantity: frozenRow.quantity,
          mutationId,
          groupActorId: frozenGroupActorId,
          folderId: frozenFolderId,
          buildItemData: () => this.buildLootgenItemData(frozenRow, { allowPersistedItemData })
        });
      }
    );
  }

  addLootgenChatRowToInventoryOnce(row, mutationId) {
    const frozenRow = foundry.utils.deepClone(row ?? {});
    return this.mutationCoordinator.run(
      "inventory",
      () => {
        if (!isActiveGmClient()) {
          throw new Error("Only the active GM can grant persisted Lootgen chat items.");
        }
        return this.#executeInventoryGrantOnce({
          quantity: frozenRow.quantity,
          mutationId,
          buildItemData: () => this.buildLootgenItemData(frozenRow, { allowPersistedItemData: true })
        });
      }
    );
  }

  addLootgenRowToCharacterOnce(row, actor, mutationId) {
    const frozenRow = foundry.utils.deepClone(row ?? {});
    return this.mutationCoordinator.run(
      "inventory",
      () => {
        if (!isActiveGmClient()) {
          throw new Error("Only the active GM can grant storage loot to a character.");
        }
        if (!isActorDocument(actor) || actor.type !== "character") {
          throw new Error("Лут из хранилища можно выдать только персонажу.");
        }
        return this.#executeInventoryGrantOnce({
          actor,
          quantity: frozenRow.quantity,
          mutationId,
          buildItemData: () => this.buildLootgenItemData(frozenRow, { allowPersistedItemData: true })
        });
      }
    );
  }

  async #executeAddModelItemOnce(sourceType, sourceId, quantity, mutationId) {
    return this.#executeInventoryGrantOnce({
      quantity,
      mutationId,
      buildItemData: (safeQuantity) => this.buildModelItemData(sourceType, sourceId, safeQuantity)
    });
  }

  async #executeInventoryGrantOnce({
    actor: requestedActor = null,
    quantity,
    mutationId,
    groupActorId = "",
    folderId = null,
    buildItemData
  }) {
    const operationId = createInventoryMutationId("inventory-grant", mutationId);
    let record = await this.mutationJournal.find(operationId);
    const normalizedGroupActorId = cleanId(groupActorId);
    const normalizedFolderId = normalizeInventoryFolderTarget(folderId);
    if (normalizedFolderId !== null && !normalizedGroupActorId) {
      throw new Error("Inventory folder target requires an explicit group Actor.");
    }
    const actor = requestedActor ?? await this.getInventoryActor({
      create: true,
      groupActorId: normalizedGroupActorId
    });
    if (!requestedActor) {
      this.#assertCanManagePartyInventory(actor);
    }
    if (!actor) throw new Error("Не удалось получить инвентарь для выдачи лута.");
    if (record && (
      cleanId(record.groupActorId) !== normalizedGroupActorId
      || normalizeInventoryFolderTarget(record.folderId) !== normalizedFolderId
    )) {
      throw new Error("Inventory mutation ID was reused with a different folder target.");
    }
    if (!record) {
      const safeQuantity = Math.max(0.01, roundNumber(toNumber(quantity, 1), 2));
      const itemData = await buildItemData(safeQuantity);
      const candidate = this.#findInventoryMergeCandidate(actor, itemData);
      if (!candidate) {
        foundry.utils.setProperty(itemData, `flags.${MODULE_ID}.${INVENTORY_MUTATION_FLAG}`, {
          id: operationId,
          kind: "grant"
        });
      }
      const beforeQuantity = candidate ? getRawQuantity(candidate.toObject()) : 0;
      record = await this.mutationJournal.start({
        id: operationId,
        kind: "grant",
        phase: "prepared",
        actorId: actor.id,
        groupActorId: normalizedGroupActorId,
        folderId: normalizedFolderId,
        itemData,
        targetReceipt: {
          itemId: candidate?.id ?? "",
          created: !candidate,
          beforeQuantity,
          afterQuantity: roundNumber(beforeQuantity + safeQuantity, 2),
          delta: safeQuantity
        }
      });
    }
    const terminal = this.#readInventoryTerminal(record);
    if (terminal.terminal) return terminal.value;
    if (record.phase === "prepared") {
      let item = record.targetReceipt.created
        ? this.#findMutationItem(actor, operationId)
        : actor.items.get(record.targetReceipt.itemId);
      if (record.targetReceipt.created) {
        if (!item) {
          try {
            [item] = await actor.createEmbeddedDocuments("Item", [record.itemData]);
          }
          catch (error) {
            item = this.#findMutationItem(actor, operationId);
            if (!item) throw error;
          }
        }
      }
      else {
        if (!item) throw this.#inventoryReconciliationError("Inventory grant target disappeared.");
        const current = getRawQuantity(item.toObject());
        if (!inventoryQuantitiesMatch(current, record.targetReceipt.afterQuantity)) {
          if (!inventoryQuantitiesMatch(current, record.targetReceipt.beforeQuantity)) {
            throw this.#inventoryReconciliationError("Inventory grant target quantity changed.");
          }
          try {
            await item.update({ "system.quantity": record.targetReceipt.afterQuantity });
          }
          catch (error) {
            if (!inventoryQuantitiesMatch(getRawQuantity(item.toObject()), record.targetReceipt.afterQuantity)) throw error;
          }
        }
      }
      if (!item) throw this.#inventoryReconciliationError("Inventory grant target was not observed.");
      record = await this.mutationJournal.checkpoint(operationId, "prepared", "target-created", {
        targetItemId: item.id
      });
    }
    if (record.phase === "target-created") {
      if (record.targetReceipt.created && record.folderId !== null) {
        await this.assignInventoryGrantFolder({
          groupActorId: record.groupActorId,
          itemId: record.targetItemId,
          folderId: record.folderId
        });
      }
      record = await this.mutationJournal.checkpoint(operationId, "target-created", "folder-assigned");
    }
    if (record.phase === "folder-assigned") {
      record = await this.mutationJournal.checkpoint(operationId, "folder-assigned", "committed");
    }
    const result = {
      actorId: actor.id,
      itemId: record.targetItemId ?? record.targetReceipt.itemId,
      quantity: record.targetReceipt.delta
    };
    await this.mutationJournal.finish(operationId, { ok: true, value: result });
    return foundry.utils.deepClone(result);
  }

  addCurrencyToInventoryOnce(coins = {}, mutationId = "", { groupActorId = "" } = {}) {
    const frozenCoins = foundry.utils.deepClone(coins ?? {});
    const requestedGroupActorId = cleanId(groupActorId);
    return this.mutationCoordinator.run(
      "inventory",
      () => this.#executeAddCurrencyOnce(frozenCoins, mutationId, { groupActorId: requestedGroupActorId })
    );
  }

  addCurrencyToCharacterOnce(coins = {}, actor, mutationId = "") {
    const frozenCoins = foundry.utils.deepClone(coins ?? {});
    return this.mutationCoordinator.run(
      "inventory",
      () => {
        if (!isActiveGmClient()) {
          throw new Error("Only the active GM can grant storage currency to a character.");
        }
        if (!isActorDocument(actor) || actor.type !== "character") {
          throw new Error("Монеты из хранилища можно выдать только персонажу.");
        }
        return this.#executeAddCurrencyOnce(frozenCoins, mutationId, { actor });
      }
    );
  }

  async #executeAddCurrencyOnce(coins, mutationId, {
    actor: requestedActor = null,
    groupActorId = ""
  } = {}) {
    const operationId = createInventoryMutationId("inventory-currency-grant", mutationId);
    let record = await this.mutationJournal.find(operationId);
    const requestedGroupActorId = cleanId(groupActorId);
    const actor = requestedActor ?? await this.getInventoryActor({
      create: !requestedGroupActorId,
      groupActorId: requestedGroupActorId
    });
    if (!requestedActor && !requestedGroupActorId) {
      this.#assertCanManagePartyInventory(actor);
    }
    if (requestedGroupActorId && !isManagedPartyGroup(actor)) {
      throw new Error("Указанный групповой инвентарь не управляется Rebreya.");
    }
    if (!actor) throw new Error("Не удалось получить инвентарь для выдачи монет.");
    if (record && cleanId(record.actorId) !== cleanId(actor.id)) {
      throw this.#inventoryReconciliationError("Inventory currency grant target actor changed.");
    }
    if (!record) {
      const before = buildCurrencySnapshot(actor);
      const after = {
        pp: before.pp + Math.max(0, Math.floor(toNumber(coins.pp, 0))),
        gp: before.gp + Math.max(0, Math.floor(toNumber(coins.gp, 0))),
        sp: before.sp + Math.max(0, Math.floor(toNumber(coins.sp, 0))),
        cp: before.cp + Math.max(0, Math.floor(toNumber(coins.cp, 0)))
      };
      record = await this.mutationJournal.start({
        id: operationId,
        kind: "currency-grant",
        phase: "prepared",
        actorId: actor.id,
        before: { pp: before.pp, gp: before.gp, sp: before.sp, cp: before.cp },
        after
      });
    }
    const terminal = this.#readInventoryTerminal(record);
    if (terminal.terminal) return terminal.value;
    if (record.phase === "prepared") {
      const current = buildCurrencySnapshot(actor);
      const keys = ["pp", "gp", "sp", "cp"];
      const matches = (expected) => keys.every((key) => current[key] === expected[key]);
      if (!matches(record.after)) {
        if (!matches(record.before)) {
          throw this.#inventoryReconciliationError("Inventory currency changed before loot grant.");
        }
        try {
          await actor.update(buildCurrencyUpdatePatch(record.after));
        }
        catch (error) {
          const observed = buildCurrencySnapshot(actor);
          if (!keys.every((key) => observed[key] === record.after[key])) throw error;
        }
      }
      record = await this.mutationJournal.checkpoint(operationId, "prepared", "currency-credited");
    }
    if (record.phase === "currency-credited") {
      record = await this.mutationJournal.checkpoint(operationId, "currency-credited", "committed");
    }
    const result = buildCurrencySnapshot(actor);
    await this.mutationJournal.finish(operationId, { ok: true, value: result });
    return foundry.utils.deepClone(result);
  }

  reserveCraftResourcesOnce(quote, mutationId, options = {}) {
    return this.mutationCoordinator.run(
      "inventory",
      () => this.#executeReserveCraftResourcesOnce(quote, mutationId, options)
    );
  }

  async getCraftResourceAvailability(request = {}) {
    const normalizedRequest = normalizeCraftResourceRequest(request, { requireProjectId: false });
    const requestedGroupId = cleanId(request?.groupId);
    const actor = requestedGroupId
      ? this.moduleApi.groupContextService?.resolveForGroup?.(requestedGroupId)?.groupActor ?? null
      : await this.getInventoryActor({ create: false });
    const rows = collectCraftMaterialResources(normalizedRequest).map((resource) => {
      const available = actor
        ? this.#findMaterialInventoryItems(actor, resource.sourceId).reduce((total, item) => (
          roundCraftQuantity(total + Math.max(0, getRawQuantity(item.toObject())))
        ), 0)
        : 0;
      return {
        sourceId: resource.sourceId,
        required: resource.quantity,
        available,
        sufficient: available + 1e-9 >= resource.quantity,
        components: foundry.utils.deepClone(resource.components)
      };
    });
    return {
      sufficient: rows.every((row) => row.sufficient),
      inventoryActorId: cleanId(actor?.id),
      rows
    };
  }

  async #executeReserveCraftResourcesOnce(quote, mutationId, options) {
    const execution = this.#resolveCraftExecutionContext(options);
    const stableMutationId = requireCraftMutationId(mutationId);
    const request = normalizeCraftResourceRequest(quote);
    const operationId = createInventoryMutationId("craft-reservation", stableMutationId);
    let record = await this.#findCraftMutationRecord(execution, operationId);
    const actor = execution.actor;
    this.#assertCanManagePartyInventory(actor);
    if (!actor) {
      throw new Error("Party inventory is unavailable for craft reservation.");
    }

    if (record) {
      this.#assertCraftMutationIdentity(record, "craft-reservation", request);
      this.#assertCraftMutationScope(record, execution, "Craft reservation");
    }
    else {
      const receipts = this.#prepareCraftDebitReceipts(actor, request);
      record = await this.#startCraftMutationRecord(execution, {
        id: operationId,
        kind: "craft-reservation",
        phase: "prepared",
        actorId: actor.id,
        groupId: execution.groupId,
        projectId: request.projectId,
        request,
        receipts
      });
    }

    return this.#executeAtomicCraftReceipts(actor, record, execution, {
      applyReceipt: (receipt) => this.#applyCraftDebitReceipt(actor, receipt, execution),
      compensateReceipt: (receipt) => this.#compensateCraftDebitReceipt(actor, receipt, execution)
    });
  }

  spendCraftReservationOnce(projectId, spend, mutationId, options = {}) {
    return this.mutationCoordinator.run(
      "inventory",
      () => this.#executeSpendCraftReservationOnce(projectId, spend, mutationId, options)
    );
  }

  async #executeSpendCraftReservationOnce(projectId, spend, mutationId, options) {
    const execution = this.#resolveCraftExecutionContext(options);
    const stableMutationId = requireCraftMutationId(mutationId);
    const request = normalizeCraftSpendRequest(projectId, spend);
    if (!request.projectId) {
      throw new Error("Craft project ID is required.");
    }
    const operationId = createInventoryMutationId("craft-spend", stableMutationId);
    let record = await this.#findCraftMutationRecord(execution, operationId);
    if (record) {
      this.#assertCraftMutationIdentity(record, "craft-spend", request);
      this.#assertCraftMutationScope(record, execution, "Craft spend");
    }
    else {
      record = await this.#startCraftMutationRecord(execution, {
        id: operationId,
        kind: "craft-spend",
        phase: "prepared",
        actorId: execution.actorId,
        groupId: execution.groupId,
        projectId: request.projectId,
        request
      });
    }

    const terminal = this.#readInventoryTerminal(record);
    if (terminal.terminal) {
      return terminal.value;
    }
    if (record.phase === "prepared") {
      record = await this.#checkpointCraftMutationRecord(execution, operationId, "prepared", "committed");
    }
    if (record.phase !== "committed") {
      throw this.#inventoryReconciliationError("Craft spend mutation has an unknown journal phase.");
    }
    const result = foundry.utils.deepClone(request);
    await this.#finishCraftMutationRecord(execution, operationId, { ok: true, value: result });
    return result;
  }

  async #writeMemberStates(actorIds, mutator, { guard, inventoryActor = null } = {}) {
    const ids = [...new Set((actorIds ?? []).map(cleanId).filter(Boolean))];
    const writeLegacyState = () => this.#writeState((state) => {
      const members = new Map(ids.map((actorId) => [
        actorId,
        this.#normalizeMemberState(state.members[actorId] ?? buildDefaultMemberState("member"))
      ]));
      const result = mutator(members);
      for (const [actorId, memberState] of members) {
        state.members[actorId] = this.#normalizeMemberState(memberState, memberState.role);
      }
      return result;
    }, { guard });
    const groupActor = this.#isNativeGroupInventoryActor(inventoryActor)
      ? inventoryActor
      : this.#getGroupInventoryActor();
    if (!groupActor) {
      return writeLegacyState();
    }

    const nativeMemberIds = new Set(getGroupMemberActors(groupActor)
      .map((actor) => cleanId(actor?.id))
      .filter(Boolean));
    if (ids.some((actorId) => !nativeMemberIds.has(actorId))) {
      throw new Error("Участник группы не найден в листе dnd5e группы.");
    }
    guard?.();
    if (!this.canManagePartyInventory(groupActor)) {
      throw new Error("Партийным инвентарём управляют владельцы склада.");
    }
    if (typeof this.moduleApi.groupContextService?.mutateGroupState !== "function") {
      return writeLegacyState();
    }
    const legacyMembers = this.#getState().members;
    const result = await this.moduleApi.groupContextService.mutateGroupState(groupActor.id, (groupState) => {
      groupState.memberStateByActorId = groupState.memberStateByActorId
        && typeof groupState.memberStateByActorId === "object"
        ? groupState.memberStateByActorId
        : {};
      const members = new Map(ids.map((actorId) => [
        actorId,
        this.#normalizeMemberState({
          ...(legacyMembers[actorId] ?? {}),
          ...(groupState.memberStateByActorId[actorId] ?? {})
        })
      ]));
      const mutationResult = mutator(members);
      for (const [actorId, memberState] of members) {
        groupState.memberStateByActorId[actorId] = this.#normalizeMemberState(
          memberState,
          memberState.role
        );
      }
      return mutationResult;
    });
    guard?.();
    return result;
  }

  releaseCraftReservationOnce(projectId, remaining, mutationId, options = {}) {
    return this.mutationCoordinator.run(
      "inventory",
      () => this.#executeReleaseCraftReservationOnce(projectId, remaining, mutationId, options)
    );
  }

  async #executeReleaseCraftReservationOnce(projectId, remaining, mutationId, options) {
    const execution = this.#resolveCraftExecutionContext(options);
    const stableMutationId = requireCraftMutationId(mutationId);
    const source = remaining && typeof remaining === "object" ? remaining : {};
    const request = normalizeCraftResourceRequest({
      ...source,
      projectId
    });
    const operationId = createInventoryMutationId("craft-release", stableMutationId);
    let record = await this.#findCraftMutationRecord(execution, operationId);
    const actor = execution.actor;
    this.#assertCanManagePartyInventory(actor);
    if (!actor) {
      throw new Error("Party inventory is unavailable for craft release.");
    }

    if (record) {
      this.#assertCraftMutationIdentity(record, "craft-release", request);
      this.#assertCraftMutationScope(record, execution, "Craft release");
    }
    else {
      const receipts = await this.#prepareCraftCreditReceipts(actor, request, operationId, execution);
      record = await this.#startCraftMutationRecord(execution, {
        id: operationId,
        kind: "craft-release",
        phase: "prepared",
        actorId: actor.id,
        groupId: execution.groupId,
        projectId: request.projectId,
        request,
        receipts
      });
    }

    return this.#executeAtomicCraftReceipts(actor, record, execution, {
      applyReceipt: (receipt, receiptIndex) => this.#applyCraftCreditReceipt(
        actor,
        operationId,
        receipt,
        receiptIndex,
        execution
      ),
      compensateReceipt: (receipt, receiptIndex) => this.#compensateCraftCreditReceipt(
        actor,
        operationId,
        receipt,
        receiptIndex,
        execution
      )
    });
  }

  createCraftOutputsOnce(outputs, mutationId, options = {}) {
    return this.mutationCoordinator.run(
      "inventory",
      () => this.#executeCreateCraftOutputsOnce(outputs, mutationId, options)
    );
  }

  async #executeCreateCraftOutputsOnce(outputs, mutationId, options) {
    const execution = this.#resolveCraftExecutionContext(options);
    const stableMutationId = requireCraftMutationId(mutationId);
    const request = normalizeCraftOutputs(outputs);
    const operationId = createInventoryMutationId("craft-output", stableMutationId);
    let record = await this.#findCraftMutationRecord(execution, operationId);
    const actor = execution.actor;
    this.#assertCanManagePartyInventory(actor);
    if (!actor) {
      throw new Error("Party inventory is unavailable for craft output.");
    }

    if (record) {
      this.#assertCraftMutationIdentity(record, "craft-output", request);
      this.#assertCraftMutationScope(record, execution, "Craft output");
    }
    else {
      const preparedOutputs = [];
      for (const [outputIndex, output] of request.entries()) {
        const sourceData = await this.#loadCraftGearSourceData(output, execution);
        preparedOutputs.push({
          ...output,
          itemId: "",
          itemUuid: "",
          itemData: this.#buildCraftOutputItemData(sourceData, output, operationId, outputIndex)
        });
      }
      record = await this.#startCraftMutationRecord(execution, {
        id: operationId,
        kind: "craft-output",
        phase: "prepared",
        actorId: actor.id,
        groupId: execution.groupId,
        request,
        outputs: preparedOutputs
      });
    }

    const terminal = this.#readInventoryTerminal(record);
    if (terminal.terminal) {
      return this.#resolveCraftOutputItems(actor, terminal.value);
    }
    if (record.phase === "reconciliation-required") {
      throw this.#inventoryReconciliationError("Craft output mutation requires reconciliation.");
    }

    let createdCount = this.#craftOutputCreatedCount(record);
    if (createdCount === null || createdCount > record.outputs.length) {
      throw this.#inventoryReconciliationError("Craft output mutation has an unknown journal phase.");
    }
    while (createdCount < record.outputs.length) {
      const outputIndex = createdCount;
      const output = record.outputs[outputIndex];
      let item = this.#findCraftOutputItem(actor, operationId, outputIndex);
      if (!item) {
        try {
          [item] = await this.#awaitCraftExecution(
            execution,
            () => actor.createEmbeddedDocuments("Item", [output.itemData], { renderSheet: false })
          );
        }
        catch (error) {
          if (this.#isCraftExecutionContextError(error)) {
            throw error;
          }
          item = this.#findCraftOutputItem(actor, operationId, outputIndex);
          if (!item) {
            throw error;
          }
        }
      }
      if (!item || !inventoryQuantitiesMatch(getRawQuantity(item.toObject()), output.quantity)) {
        throw this.#inventoryReconciliationError("Craft output creation was not observed.");
      }

      const durability = item.flags?.[MODULE_ID]?.durability ?? null;
      const durabilityIsIntact = durability?.state === "intact"
        && inventoryQuantitiesMatch(durability?.hp?.value, durability?.hp?.max);
      if (!durabilityIsIntact && typeof this.moduleApi.durabilityService?.initializeItem === "function") {
        await this.#awaitCraftExecution(
          execution,
          () => this.moduleApi.durabilityService.initializeItem(item, {
            force: true,
            guard: () => this.#assertCraftExecutionContext(execution),
            assertExecutionContext: () => this.#assertCraftExecutionContext(execution)
          })
        );
      }

      const nextOutputs = foundry.utils.deepClone(record.outputs);
      nextOutputs[outputIndex] = {
        ...nextOutputs[outputIndex],
        itemId: item.id,
        itemUuid: cleanId(item.uuid)
      };
      record = await this.#checkpointCraftMutationRecord(
        execution,
        operationId,
        record.phase,
        `output-${outputIndex + 1}-created`,
        { outputs: nextOutputs }
      );
      createdCount += 1;
    }

    if (record.phase !== "committed") {
      record = await this.#checkpointCraftMutationRecord(execution, operationId, record.phase, "committed");
    }
    const result = record.outputs.map(({ itemData: _itemData, sourceDocumentId: _sourceDocumentId, ...output }) => ({
      ...output,
      mutationId: operationId
    }));
    await this.#finishCraftMutationRecord(execution, operationId, { ok: true, value: result });
    return this.#resolveCraftOutputItems(actor, result);
  }

  async breakItemToMaterial(itemId, quantity = 1, { mutationId = "" } = {}) {
    const actor = await this.getInventoryActor({ create: true });
    const operationId = createInventoryMutationId("inventory-dismantle", mutationId);
    const safeQuantity = Math.max(1, Math.floor(toNumber(quantity, 1)));
    if (!game.user?.isGM && typeof this.moduleApi.socketCommandBus?.request === "function") {
      return this.moduleApi.socketCommandBus.request(INVENTORY_DISMANTLE_COMMAND, {
        inventoryActorId: actor.id,
        itemId: cleanId(itemId),
        mutationId: operationId,
        quantity: safeQuantity
      });
    }
    this.#assertCanManagePartyInventory(actor);
    return this.#dismantleInventoryItemFromActor(actor, itemId, safeQuantity, { mutationId: operationId });
  }

  async addPartyMember(actorId) {
    if (!actorId) {
      throw new Error("Не выбран актёр для добавления в группу.");
    }

    this.#assertLegacyPartyMembershipMutable();

    return this.#writeState((state) => {
      state.members[actorId] = state.members[actorId] ?? buildDefaultMemberState("member");
      state.members[actorId] = this.#normalizeMemberState(state.members[actorId]);
      return foundry.utils.deepClone(state.members[actorId]);
    });
  }

  async removePartyMember(actorId) {
    if (!actorId) {
      return false;
    }

    this.#assertLegacyPartyMembershipMutable();

    return this.#writeState((state) => {
      delete state.members[actorId];
      return true;
    });
  }

  async updatePartyDefaults(patch = {}) {
    return this.#writeState((state) => {
      if (patch.defaultCapMod !== undefined) {
        const nextValue = Math.max(1, roundNumber(toNumber(patch.defaultCapMod, state.defaultCapMod), 2));
        state.defaultCapMod = nextValue;
      }
      if (patch.coverFoodExpenses !== undefined) {
        state.coverFoodExpenses = patch.coverFoodExpenses === true;
      }
      if (patch.coverWaterExpenses !== undefined) {
        state.coverWaterExpenses = patch.coverWaterExpenses === true;
      }

      return foundry.utils.deepClone(state);
    });
  }

  async updatePartyMember(actorId, patch = {}) {
    if (!actorId) {
      throw new Error("Не выбран участник группы.");
    }

    return this.#writeMemberStates([actorId], (members) => {
      const currentState = members.get(actorId);
      const nextRole = patch.role !== undefined ? normalizeRole(patch.role) : currentState.role;
      const roleChanged = nextRole !== currentState.role;
      const roleDefaults = PARTY_ROLE_DEFAULTS[nextRole] ?? PARTY_ROLE_DEFAULTS.member;

      const nextMember = {
        ...currentState,
        role: nextRole,
        foodPerDay: patch.foodPerDay !== undefined
          ? Math.max(0, roundNumber(toNumber(patch.foodPerDay, currentState.foodPerDay), 2))
          : (roleChanged ? roleDefaults.foodPerDay : currentState.foodPerDay),
        waterGalPerDay: patch.waterGalPerDay !== undefined
          ? Math.max(0, roundNumber(toNumber(patch.waterGalPerDay, currentState.waterGalPerDay), 2))
          : (roleChanged ? roleDefaults.waterGalPerDay : currentState.waterGalPerDay),
        strOverride: patch.strOverride !== undefined
          ? (String(patch.strOverride).trim() === "" ? null : Math.max(0, Math.floor(toNumber(patch.strOverride, 0))))
          : currentState.strOverride,
        capModOverride: patch.capModOverride !== undefined
          ? (String(patch.capModOverride).trim() === "" ? null : Math.max(1, roundNumber(toNumber(patch.capModOverride, 1), 2)))
          : currentState.capModOverride,
        capBonusLb: patch.capBonusLb !== undefined
          ? Math.max(0, roundNumber(toNumber(patch.capBonusLb, currentState.capBonusLb), 2))
          : currentState.capBonusLb,
        conModOverride: patch.conModOverride !== undefined
          ? (String(patch.conModOverride).trim() === "" ? null : Math.floor(toNumber(patch.conModOverride, 0)))
          : currentState.conModOverride,
        energyCurrent: patch.energyCurrent !== undefined
          ? (String(patch.energyCurrent).trim() === "" ? null : Math.max(0, Math.floor(toNumber(patch.energyCurrent, 0))))
          : currentState.energyCurrent,
        tools: patch.tools !== undefined
          ? normalizeToolsMap(patch.tools)
          : normalizeToolsMap(currentState.tools)
      };

      const normalized = this.#normalizeMemberState(nextMember, nextRole);
      members.set(actorId, normalized);
      return foundry.utils.deepClone(normalized);
    });
  }

  async updatePartyMemberTool(actorId, toolId, patch = {}) {
    if (!actorId) {
      throw new Error("Не выбран участник группы.");
    }

    const normalizedToolId = normalizeToolId(toolId);
    if (!normalizedToolId) {
      throw new Error("Инструмент Rebreya не найден.");
    }

    return this.#writeMemberStates([actorId], (members) => {
      const memberState = members.get(actorId);
      const currentToolState = normalizeToolState(memberState.tools?.[normalizedToolId]);
      const nextToolState = normalizeToolState({
        ...currentToolState,
        ...patch
      });

      memberState.tools = normalizeToolsMap(memberState.tools);
      memberState.tools[normalizedToolId] = nextToolState;
      members.set(actorId, memberState);
      return foundry.utils.deepClone(nextToolState);
    });
  }

  async setMemberEnergy(actorId, currentEnergy) {
    if (!actorId) {
      throw new Error("Не выбран участник группы.");
    }

    return this.#writeMemberStates([actorId], (members) => {
      const memberState = members.get(actorId);
      memberState.energyCurrent = Math.max(0, Math.floor(toNumber(currentEnergy, 0)));
      members.set(actorId, memberState);
      return foundry.utils.deepClone(memberState);
    });
  }

  async restoreMemberEnergy(actorId, days = 1) {
    if (!actorId) {
      throw new Error("Не выбран участник группы.");
    }

    const actor = await this.getInventoryActor({ create: true });
    this.#assertCanManagePartyInventory(actor);
    if (!actor) {
      throw new Error("Не удалось получить партийный инвентарь.");
    }

    const partySnapshot = await this.getPartySnapshot({ actor });
    const member = partySnapshot.members.find((entry) => entry.actorId === actorId);
    if (!member) {
      throw new Error("Участник группы не найден.");
    }

    const restoreDays = Math.max(1, Math.floor(toNumber(days, 1)));
    const foodNeeded = roundNumber(member.foodPerDay * restoreDays, 2);
    const waterNeeded = roundNumber(member.waterGalPerDay * restoreDays, 2);
    const foodItem = this.#findSupplyItem(actor, "food");
    const waterItem = this.#findSupplyItem(actor, "water");
    const currentFood = foodItem ? getRawQuantity(foodItem.toObject()) : 0;
    const currentWater = waterItem ? getRawQuantity(waterItem.toObject()) : 0;

    if (currentFood + 1e-9 < foodNeeded || currentWater + 1e-9 < waterNeeded) {
      throw new Error("Не хватает еды или воды для восстановления энергии.");
    }

    const nextFood = roundNumber(currentFood - foodNeeded, 2);
    const nextWater = roundNumber(currentWater - waterNeeded, 2);

    if (foodItem) {
      if (nextFood <= 0) {
        await foodItem.delete();
      }
      else {
        await foodItem.update({ "system.quantity": nextFood });
      }
    }

    if (waterItem) {
      if (nextWater <= 0) {
        await waterItem.delete();
      }
      else {
        await waterItem.update({ "system.quantity": nextWater });
      }
    }

    const result = await this.#writeMemberStates([actorId], (members) => {
      const memberState = members.get(actorId);
      const actorDocument = game.actors.get(actorId) ?? null;
      const energyState = clampEnergyCurrent(memberState, actorDocument);
      memberState.energyCurrent = Math.min(energyState.max, energyState.current + restoreDays);
      members.set(actorId, memberState);
      return {
        actorId,
        energyCurrent: memberState.energyCurrent
      };
    }, { inventoryActor: actor });

    return {
      ...result,
      foodSpent: foodNeeded,
      waterSpent: waterNeeded,
      nextFood,
      nextWater
    };
  }

  #resolveSupplyConsumptionActor(requestedGroupId) {
    if (requestedGroupId) {
      const context = this.moduleApi.groupContextService?.resolveForGroup?.(requestedGroupId);
      const groupActor = context?.groupActor ?? null;
      if (
        cleanId(context?.groupId) !== requestedGroupId
        || cleanId(groupActor?.id) !== requestedGroupId
        || groupActor?.type !== "group"
      ) {
        throw new Error("Calendar supply mutation group does not match its captured group.");
      }
      return groupActor;
    }

    return null;
  }

  #buildSupplyConsumptionSnapshot(state, inventoryActor) {
    const members = this.#buildPartyMemberRows(state, inventoryActor)
      .map(({ actorId, actor: actorDocument, memberState }) => {
        const normalizedMember = this.#normalizeMemberState(memberState);
        const energyState = clampEnergyCurrent(normalizedMember, actorDocument);
        return {
          actorId,
          actor: actorDocument,
          actorName: actorDocument?.name ?? actorId,
          memberState: normalizedMember,
          energyCurrent: energyState.current,
          energyMax: energyState.max,
          foodPerDay: normalizedMember.foodPerDay,
          waterGalPerDay: normalizedMember.waterGalPerDay
        };
      })
      .sort((left, right) => String(left.actorName).localeCompare(String(right.actorName), "ru"));
    const foodRequiredPerDay = roundNumber(members.reduce((sum, member) => sum + member.foodPerDay, 0), 2);
    const waterRequiredPerDay = roundNumber(members.reduce((sum, member) => sum + member.waterGalPerDay, 0), 2);

    return {
      coverFoodExpenses: state.coverFoodExpenses === true,
      coverWaterExpenses: state.coverWaterExpenses === true,
      members,
      memberCount: members.length,
      totalFoodPerDay: state.coverFoodExpenses ? 0 : foodRequiredPerDay,
      totalWaterGalPerDay: state.coverWaterExpenses ? 0 : waterRequiredPerDay
    };
  }

  async consumeSuppliesDays(days = 1, options = {}) {
    const { applyEnergy = true } = options;
    const safeDays = Math.max(0, Math.floor(toNumber(days, 0)));
    const guard = options.guard ?? options.assertExecutionContext;
    if (guard !== undefined && typeof guard !== "function") {
      throw new TypeError("calendar execution guard must be a function");
    }
    if (safeDays <= 0) {
      return {
        days: 0,
        supplies: [],
        supplyTotals: {
          foodSpent: 0,
          waterSpent: 0,
          foodShortage: 0,
          waterShortage: 0
        }
      };
    }

    const requestedGroupId = cleanId(options.groupId);
    guard?.();
    const actor = requestedGroupId
      ? this.#resolveSupplyConsumptionActor(requestedGroupId)
      : await this.getInventoryActor({ create: true });
    guard?.();
    this.#assertCanManagePartyInventory(actor);
    if (!actor) {
      throw new Error("Не удалось получить партийный инвентарь.");
    }

    const partySnapshot = this.#buildSupplyConsumptionSnapshot(this.#getState(), actor);
    guard?.();
    const foodItem = this.#findSupplyItem(actor, "food");
    const waterItem = this.#findSupplyItem(actor, "water");
    const initialFood = foodItem ? getRawQuantity(foodItem.toObject()) : 0;
    const initialWater = waterItem ? getRawQuantity(waterItem.toObject()) : 0;
    let remainingFood = initialFood;
    let remainingWater = initialWater;
    const currentEnergyByActorId = new Map(partySnapshot.members.map((member) => [
      member.actorId,
      member.energyCurrent
    ]));
    const supplies = [];

    for (let dayIndex = 0; dayIndex < safeDays; dayIndex += 1) {
      const dayFoodStart = remainingFood;
      const dayWaterStart = remainingWater;
      const foodSpent = Math.min(dayFoodStart, partySnapshot.totalFoodPerDay);
      const waterSpent = Math.min(dayWaterStart, partySnapshot.totalWaterGalPerDay);
      remainingFood = roundNumber(dayFoodStart - foodSpent, 2);
      remainingWater = roundNumber(dayWaterStart - waterSpent, 2);
      const energyUpdates = [];

      if (applyEnergy && partySnapshot.memberCount > 0) {
        let availableFood = dayFoodStart;
        let availableWater = dayWaterStart;

        for (const member of partySnapshot.members) {
          const foodNeed = partySnapshot.coverFoodExpenses
            ? 0
            : Math.max(0, roundNumber(toNumber(member.memberState.foodPerDay, 0), 2));
          const waterNeed = partySnapshot.coverWaterExpenses
            ? 0
            : Math.max(0, roundNumber(toNumber(member.memberState.waterGalPerDay, 0), 2));
          const foodCovered = Math.min(availableFood, foodNeed);
          const waterCovered = Math.min(availableWater, waterNeed);
          availableFood = roundNumber(availableFood - foodCovered, 2);
          availableWater = roundNumber(availableWater - waterCovered, 2);
          const isHungry = foodCovered + 1e-9 < foodNeed || waterCovered + 1e-9 < waterNeed;
          const currentEnergy = currentEnergyByActorId.get(member.actorId) ?? member.energyCurrent;
          const nextEnergy = isHungry
            ? Math.max(0, currentEnergy - 1)
            : Math.min(member.energyMax, currentEnergy);
          currentEnergyByActorId.set(member.actorId, nextEnergy);

          energyUpdates.push({
            actorId: member.actorId,
            actorName: member.actorName,
            hungry: isHungry,
            foodNeed,
            waterNeed,
            foodCovered,
            waterCovered,
            energyCurrent: nextEnergy,
            energyMax: member.energyMax
          });
        }
      }

      supplies.push({
        memberCount: partySnapshot.memberCount,
        foodRequired: partySnapshot.totalFoodPerDay,
        waterRequired: partySnapshot.totalWaterGalPerDay,
        foodSpent,
        waterSpent,
        foodShortage: roundNumber(Math.max(0, partySnapshot.totalFoodPerDay - foodSpent), 2),
        waterShortage: roundNumber(Math.max(0, partySnapshot.totalWaterGalPerDay - waterSpent), 2),
        nextFood: remainingFood,
        nextWater: remainingWater,
        energyUpdates
      });
    }

    if (foodItem && !inventoryQuantitiesMatch(initialFood, remainingFood)) {
      guard?.();
      if (remainingFood <= 0) {
        await foodItem.delete();
      }
      else {
        await foodItem.update({ "system.quantity": remainingFood });
      }
      guard?.();
    }

    if (waterItem && !inventoryQuantitiesMatch(initialWater, remainingWater)) {
      guard?.();
      if (remainingWater <= 0) {
        await waterItem.delete();
      }
      else {
        await waterItem.update({ "system.quantity": remainingWater });
      }
      guard?.();
    }

    if (applyEnergy && partySnapshot.memberCount > 0) {
      await this.#writeMemberStates(
        partySnapshot.members.map((member) => member.actorId),
        (members) => {
          for (const member of partySnapshot.members) {
            const memberState = members.get(member.actorId);
            memberState.energyCurrent = currentEnergyByActorId.get(member.actorId) ?? member.energyCurrent;
            members.set(member.actorId, memberState);
          }
        },
        { guard, inventoryActor: actor }
      );
    }

    guard?.();

    return {
      days: safeDays,
      supplies,
      supplyTotals: supplies.reduce((totals, row) => ({
        foodSpent: roundNumber(totals.foodSpent + Number(row.foodSpent ?? 0), 2),
        waterSpent: roundNumber(totals.waterSpent + Number(row.waterSpent ?? 0), 2),
        foodShortage: roundNumber(totals.foodShortage + Number(row.foodShortage ?? 0), 2),
        waterShortage: roundNumber(totals.waterShortage + Number(row.waterShortage ?? 0), 2)
      }), {
        foodSpent: 0,
        waterSpent: 0,
        foodShortage: 0,
        waterShortage: 0
      })
    };
  }

  async consumeSuppliesOneDay(options = {}) {
    const result = await this.consumeSuppliesDays(1, options);
    return result.supplies[0] ?? {
      memberCount: 0,
      foodRequired: 0,
      waterRequired: 0,
      foodSpent: 0,
      waterSpent: 0,
      foodShortage: 0,
      waterShortage: 0,
      nextFood: 0,
      nextWater: 0,
      energyUpdates: []
    };
  }

  getRebreyaToolCatalog() {
    return REBREYA_TOOLS.map((tool) => ({
      ...tool
    }));
  }

  resolveRebreyaToolId(value) {
    return normalizeToolId(value);
  }

  async resolveMemberToolAccess(actorId, toolId) {
    const safeActorId = cleanId(actorId);
    const normalizedToolId = this.resolveRebreyaToolId(toolId);
    if (!safeActorId || !normalizedToolId) {
      return null;
    }

    const actor = game.actors?.get?.(safeActorId)
      ?? collectionValues(game.actors).find((candidate) => candidate?.id === safeActorId)
      ?? null;
    const itemCandidates = collectionValues(actor?.items)
      .filter((item) => item?.type === "tool")
      .map((item) => {
        const itemData = item?.toObject?.() ?? item;
        const flags = foundry.utils.deepClone(itemData?.flags?.[MODULE_ID] ?? {});
        const durabilityState = normalizeText(flags.durability?.state);
        if (getRawQuantity(itemData) <= 0 || ["broken", "destroyed"].includes(durabilityState)) {
          return null;
        }
        const hasRebreyaMetadata = Boolean(
          flags.managed
          || flags.sourceType
          || flags.sourceId
          || flags.gearId
          || flags.rebreyaToolId
          || flags.rebreyaToolLabel
          || flags.linkedTool
        );
        if (!hasRebreyaMetadata) {
          return null;
        }

        const candidateToolId = [
          flags.rebreyaToolId,
          flags.rebreyaToolLabel,
          flags.linkedTool,
          foundry.utils.getProperty(item, "system.type.baseItem")
        ]
          .map((value) => this.resolveRebreyaToolId(value))
          .find(Boolean) ?? "";
        if (candidateToolId !== normalizedToolId) {
          return null;
        }

        return {
          rank: Math.max(0, Math.floor(toNumber(flags.rank, 0))),
          source: "item",
          itemUuid: cleanId(item.uuid)
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.rank - left.rank);
    if (itemCandidates.length) {
      return foundry.utils.deepClone(itemCandidates[0]);
    }

    const memberTool = normalizeToolState(this.#getState().members?.[safeActorId]?.tools?.[normalizedToolId]);
    if (!memberTool.owned) {
      return null;
    }
    return {
      rank: memberTool.rank,
      source: "manual",
      itemUuid: ""
    };
  }

  getRebreyaToolLabel(toolId) {
    const normalizedToolId = normalizeToolId(toolId);
    return REBREYA_TOOL_LABEL_BY_ID.get(normalizedToolId) ?? "";
  }

  getRationFoodConversion(item) {
    const itemData = item?.toObject?.() ?? item ?? {};
    const itemName = String(item?.name ?? itemData.name ?? "").trim();
    if (!isRationItemName(itemName)) {
      return null;
    }

    const itemFlags = foundry.utils.deepClone(itemData.flags?.[MODULE_ID] ?? {});
    const resourceKey = String(item?.getFlag?.(MODULE_ID, "resourceKey") ?? itemFlags.resourceKey ?? "").trim().toLowerCase();
    if (resourceKey) {
      return null;
    }

    const quantity = roundNumber(getRawQuantity(itemData), 2);
    if (quantity <= 0) {
      return null;
    }

    const weightEach = roundNumber(Math.max(getItemWeight(itemData), 1), 2);
    const foodLb = roundNumber(quantity * weightEach, 2);
    if (foodLb <= 0) {
      return null;
    }

    return {
      itemName: itemName || FOOD_ITEM_NAME,
      quantity,
      weightEach,
      foodLb
    };
  }

  async convertRationItemToFoodSupply(item) {
    const conversion = this.getRationFoodConversion(item);
    if (!conversion) {
      throw new Error("Этот предмет не похож на пайки или рационы.");
    }

    const sourceActor = item?.parent ?? item?.actor ?? null;
    if (!(sourceActor instanceof Actor)) {
      throw new Error("Предмет должен находиться в чарнике.");
    }
    if (sourceActor.isOwner === false) {
      throw new Error("У вас нет прав на исходный предмет.");
    }

    await this.addSupply("food", conversion.foodLb);

    if (typeof item?.delete === "function") {
      await item.delete();
    }

    return {
      itemName: conversion.itemName,
      foodLb: conversion.foodLb
    };
  }

  async importDroppedItem(dropData, {
    groupActorId = "",
    folderId = null,
    ingressPlan = null
  } = {}) {
    const normalizedGroupActorId = cleanId(groupActorId);
    const normalizedFolderId = normalizeInventoryFolderTarget(folderId);
    const actor = await this.getInventoryActor({
      create: true,
      groupActorId: normalizedGroupActorId
    });
    if (!actor) {
      throw new Error("Не удалось получить партийный инвентарь.");
    }

    const lootgenClaim = getLootgenChatClaimFromDropData(dropData);
    if (!dropData?.uuid && lootgenClaim) {
      if (typeof this.moduleApi.claimLootgenChatRowToInventory !== "function") {
        throw new Error("Текущая версия склада не поддерживает перенос добычи из чата.");
      }
      return this.moduleApi.claimLootgenChatRowToInventory(lootgenClaim.lootId, lootgenClaim.rowId);
    }

    const itemDocument = dropData?.uuid ? await resolveUuid(dropData.uuid) : null;
    if (!isItemDocument(itemDocument)) {
      throw new Error("Перетащите предмет из листа персонажа или компендиума.");
    }

    const sourceActor = isActorDocument(itemDocument.parent) ? itemDocument.parent : null;
    if (sourceActor && sourceActor.isOwner === false) {
      throw new Error("У вас нет прав на исходный предмет.");
    }

    if (sourceActor?.id === actor.id) {
      return this.moveInventoryItemToFolder({
        groupActorId: actor.id,
        itemId: itemDocument.id,
        folderId: normalizedFolderId
      });
    }

    const operationId = createInventoryMutationId("inventory-import", dropData?.mutationId);
    const prepared = await this.#prepareImportedItemIngress(actor, itemDocument, {
      folderId: normalizedFolderId,
      serializedPlan: ingressPlan
    });
    if (prepared.cancelled) return prepared.result;
    if (!game.user?.isGM && typeof this.moduleApi.socketCommandBus?.request === "function") {
      return this.moduleApi.socketCommandBus.request(INVENTORY_IMPORT_COMMAND, {
        inventoryActorId: actor.id,
        itemUuid: itemDocument.uuid,
        mutationId: operationId,
        folderId: normalizedFolderId,
        ingressPlan: prepared.serializedPlan
      });
    }

    if (!this.canManagePartyInventory(actor)) {
      if (!this.canDropInventoryItems(actor) || !sourceActor) {
        throw new Error("У вас нет прав на добавление предметов в партийный склад.");
      }

      if (!cleanId(actor.uuid) || !cleanId(itemDocument.uuid) || typeof game.socket?.emit !== "function") {
        throw new Error("Не удалось отправить перенос предмета мастеру.");
      }

      game.socket.emit(SOCKET_CHANNEL, {
        type: SOCKET_EVENT_INVENTORY_IMPORT_REQUEST,
        payload: {
          itemUuid: itemDocument.uuid,
          targetActorUuid: actor.uuid
        },
        senderId: game.user?.id ?? ""
      });
      return actor;
    }

    return this.#importItemDocument(actor, itemDocument, {
      mutationId: operationId,
      groupActorId: actor.id,
      folderId: normalizedFolderId,
      serializedPlan: prepared.serializedPlan
    });
  }

  async #prepareImportedItemIngress(actor, itemDocument, {
    folderId = null,
    serializedPlan = null
  } = {}) {
    const itemData = sanitizeEmbeddedItemData(itemDocument.toObject());
    const quantity = Math.max(0, getRawQuantity(itemData));
    if (quantity <= 0) throw new Error("У предмета нет количества для переноса.");
    const row = {
      sourceKey: "item",
      quantity,
      itemData,
      legacyFolderId: normalizeInventoryFolderTarget(folderId),
      container: null
    };
    if (serializedPlan) {
      return { row, serializedPlan: foundry.utils.deepClone(serializedPlan), cancelled: false };
    }
    const preview = await this.moduleApi.inventoryIngressPlanner.preview({
      groupActorId: actor.id,
      requestedFolderId: row.legacyFolderId,
      rows: [row],
      batch: false
    });
    const choices = await this.moduleApi.inventoryIngressPlanner.collectChoices(preview);
    if (choices === null) {
      return {
        row,
        serializedPlan: null,
        cancelled: true,
        result: { actorId: actor.id, cancelled: true, changed: false, rows: [] }
      };
    }
    return {
      row,
      serializedPlan: this.moduleApi.inventoryIngressPlanner.serialize(preview, choices),
      cancelled: false
    };
  }

  async executeTakeMutation(payload = {}) {
    const inventoryActor = game.actors?.get?.(cleanId(payload.inventoryActorId)) ?? null;
    const targetActor = game.actors?.get?.(cleanId(payload.targetActorId)) ?? null;
    if (!isManagedPartyGroup(inventoryActor) || !isActorDocument(targetActor) || targetActor.type !== "character") {
      throw new Error("Некорректные документы переноса предмета.");
    }
    return this.#takeInventoryItemFromActor(
      inventoryActor,
      cleanId(payload.itemId),
      targetActor,
      payload.quantity,
      { mutationId: cleanId(payload.mutationId) }
    );
  }

  async executeSaleMutation(payload = {}) {
    const inventoryActor = game.actors?.get?.(cleanId(payload.inventoryActorId)) ?? null;
    if (!isManagedPartyGroup(inventoryActor)) {
      throw new Error("Некорректный партийный склад для продажи.");
    }
    return this.#sellInventoryItemFromActor(
      inventoryActor,
      cleanId(payload.itemId),
      payload.quantity,
      { mutationId: cleanId(payload.mutationId) }
    );
  }

  async executeDismantleMutation(payload = {}) {
    const inventoryActor = game.actors?.get?.(cleanId(payload.inventoryActorId)) ?? null;
    if (!isManagedPartyGroup(inventoryActor)) {
      throw new Error("Некорректный партийный склад для разбора предмета.");
    }
    return this.#dismantleInventoryItemFromActor(
      inventoryActor,
      cleanId(payload.itemId),
      payload.quantity,
      { mutationId: cleanId(payload.mutationId) }
    );
  }

  async executeImportMutation(payload = {}) {
    const groupActorId = cleanId(payload.inventoryActorId);
    const inventoryActor = await this.getInventoryActor({ create: false, groupActorId });
    const itemDocument = await resolveUuid(payload.itemUuid);
    if (!isManagedPartyGroup(inventoryActor) || !(itemDocument instanceof Item)) {
      throw new Error("Некорректные документы импорта предмета.");
    }
    await this.#importItemDocument(inventoryActor, itemDocument, {
      mutationId: cleanId(payload.mutationId),
      groupActorId,
      folderId: normalizeInventoryFolderTarget(payload.folderId),
      serializedPlan: payload.ingressPlan
    });
    return {
      actorId: inventoryActor.id,
      itemUuid: cleanId(payload.itemUuid)
    };
  }

  async handleImportDroppedItemSocketRequest(payload = {}, { senderId = "" } = {}) {
    if (!isActiveGmClient()) {
      return false;
    }

    const sender = getSocketUser(senderId);
    const itemDocument = await resolveUuid(payload.itemUuid);
    const targetActor = await resolveUuid(payload.targetActorUuid);
    if (!sender || !(itemDocument instanceof Item) || !isActorDocument(targetActor)) {
      throw new Error("Некорректный запрос на перенос предмета.");
    }

    if (!isManagedPartyGroup(targetActor)) {
      throw new Error("Цель переноса не является партийным складом.");
    }

    const sourceActor = isActorDocument(itemDocument.parent) ? itemDocument.parent : null;
    if (!sourceActor || !userOwnsActor(sourceActor, sender)) {
      throw new Error("Игрок не владеет исходным предметом.");
    }

    const context = this.moduleApi.groupContextService?.resolveForGroup?.(targetActor.id);
    const members = context?.members ?? getGroupMemberActors(targetActor);
    const ownedSourceMember = members.some((memberActor) => (
      memberActor?.id === sourceActor.id && userOwnsActor(memberActor, sender)
    ));
    if (!ownedSourceMember) {
      throw new Error("Исходный персонаж не входит в эту группу.");
    }

    return this.#importItemDocument(targetActor, itemDocument, {
      mutationId: cleanId(payload.mutationId),
      groupActorId: targetActor.id,
      folderId: normalizeInventoryFolderTarget(payload.folderId),
      serializedPlan: payload.ingressPlan ?? null
    });
  }

  async handleAcceptedPartyInventoryItem(itemDocument, {
    sourceItemUuid = "",
    transferId = "",
    targetItemUuid = "",
    expectedIdentity = null,
    expectedQuantity = 0,
    targetReceipt = null
  } = {}) {
    if (!isItemDocument(itemDocument)) {
      return {
        handled: false,
        reason: "acceptedItemMissing"
      };
    }

    const targetActor = isActorDocument(itemDocument.parent) ? itemDocument.parent : null;
    if (targetActor?.type !== "character") {
      return {
        handled: false,
        reason: "targetActorNotCharacter"
      };
    }

    const safeSourceItemUuid = cleanId(sourceItemUuid);
    const safeTransferId = cleanId(transferId);
    const safeTargetItemUuid = cleanId(targetItemUuid);
    const normalizedIdentity = normalizeInventoryTransferIdentity(expectedIdentity);
    const safeExpectedQuantity = roundNumber(Number(expectedQuantity), 2);
    const normalizedTargetReceipt = normalizeInventoryTransferTargetReceipt(
      targetReceipt,
      safeTargetItemUuid,
      safeExpectedQuantity
    );
    if (!safeSourceItemUuid
      || !safeTransferId
      || !safeTargetItemUuid
      || safeTargetItemUuid !== cleanId(itemDocument.uuid)
      || !normalizedIdentity
      || !Number.isFinite(safeExpectedQuantity)
      || safeExpectedQuantity <= 0
      || !normalizedTargetReceipt) {
      return {
        handled: false,
        reason: "capturedTransferMissing"
      };
    }

    const sourceItem = await resolveUuid(safeSourceItemUuid);
    if (!isItemDocument(sourceItem)) {
      return {
        handled: false,
        reason: "sourceItemMissing"
      };
    }

    const inventoryActor = await this.getInventoryActor({ create: false });
    const sourceActor = isActorDocument(sourceItem.parent) ? sourceItem.parent : null;
    if (!inventoryActor || !sourceActor || sourceActor.id !== inventoryActor.id) {
      return {
        handled: false,
        reason: "sourceNotPartyInventory"
      };
    }

    if (!itemsCanRepresentSameTransfer(sourceItem, itemDocument)) {
      return {
        handled: false,
        reason: "itemMismatch"
      };
    }
    if (!inventoryTransferIdentityMatches(sourceItem, normalizedIdentity)
      || !inventoryTransferIdentityMatches(itemDocument, normalizedIdentity)
      || !inventoryQuantitiesMatch(getRawQuantity(sourceItem.toObject()), safeExpectedQuantity)
      || !inventoryQuantitiesMatch(getRawQuantity(itemDocument.toObject()), normalizedTargetReceipt.afterQuantity)) {
      return {
        handled: false,
        reason: "capturedTransferMismatch"
      };
    }

    const requestPayload = {
      transferId: safeTransferId,
      sourceItemUuid: safeSourceItemUuid,
      targetItemUuid: safeTargetItemUuid,
      targetActorUuid: cleanId(targetActor.uuid),
      expectedIdentity: normalizedIdentity,
      expectedQuantity: safeExpectedQuantity,
      targetReceipt: normalizedTargetReceipt
    };

    if (!this.canManagePartyInventory(inventoryActor)) {
      if (!getActiveGm()?.id || getActiveGm()?.active === false || typeof game.socket?.emit !== "function") {
        throw new Error("Не удалось отправить запрос на удаление исходного предмета мастеру.");
      }

      game.socket.emit(SOCKET_CHANNEL, {
        type: SOCKET_EVENT_INVENTORY_SOURCE_DEPLETION_REQUEST,
        payload: requestPayload,
        senderId: game.user?.id ?? ""
      });
      return {
        handled: true,
        requested: true,
        transferId: safeTransferId,
        sourceItemUuid: sourceItem.uuid,
        targetItemUuid: itemDocument.uuid,
        targetReceipt: normalizedTargetReceipt
      };
    }

    const result = await this.handlePartyInventorySourceDepletionSocketRequest(requestPayload, {
      senderId: game.user?.id ?? ""
    });
    if (!result) {
      throw new Error("Only the active GM can deplete a party inventory source item.");
    }
    return {
      ...result,
      requested: false,
      targetReceipt: normalizedTargetReceipt
    };
  }

  #sourceDepletionAuthorityError() {
    return new Error("Only the active GM can complete party inventory source depletion.");
  }

  #assertSourceDepletionAuthority() {
    if (!isExplicitActiveGmClient()) {
      throw this.#sourceDepletionAuthorityError();
    }
  }

  async #awaitSourceDepletionAuthority(operation) {
    this.#assertSourceDepletionAuthority();
    let result;
    try {
      result = await operation();
    }
    catch (error) {
      this.#assertSourceDepletionAuthority();
      throw error;
    }
    this.#assertSourceDepletionAuthority();
    return result;
  }

  #normalizeSourceDepletionRequest(payload, senderId) {
    const transferId = cleanId(payload?.transferId);
    const sourceItemUuid = cleanId(payload?.sourceItemUuid);
    const targetItemUuid = cleanId(payload?.targetItemUuid);
    const targetActorUuid = cleanId(payload?.targetActorUuid);
    const safeSenderId = cleanId(senderId);
    const expectedIdentity = normalizeInventoryTransferIdentity(payload?.expectedIdentity);
    const expectedQuantity = roundNumber(Number(payload?.expectedQuantity), 2);
    const targetReceipt = normalizeInventoryTransferTargetReceipt(
      payload?.targetReceipt,
      targetItemUuid,
      expectedQuantity
    );
    if (!transferId
      || !sourceItemUuid
      || !targetItemUuid
      || !targetActorUuid
      || !safeSenderId
      || !expectedIdentity
      || !Number.isFinite(expectedQuantity)
      || expectedQuantity <= 0
      || !targetReceipt) {
      throw new Error("Party inventory source depletion requires a captured identity and quantity receipt.");
    }
    return {
      transferId,
      senderId: safeSenderId,
      sourceItemUuid,
      targetItemUuid,
      targetActorUuid,
      expectedIdentity,
      expectedQuantity,
      targetReceipt
    };
  }

  #assertSourceDepletionMutationIdentity(record, request) {
    if (record?.kind === "party-inventory-source-depletion"
      && JSON.stringify(record.request) === JSON.stringify(request)) {
      return;
    }
    const error = new Error(`Inventory transfer '${request.transferId}' conflicts with the durable source-depletion record.`);
    error.code = "mutation-conflict";
    throw error;
  }

  async #resolveSourceDepletionParticipants(request, sourceActorId = "") {
    const sender = getSocketUser(request.senderId);
    const targetItem = await resolveUuid(request.targetItemUuid);
    const targetActor = isActorDocument(targetItem?.parent)
      ? targetItem.parent
      : await resolveUuid(request.targetActorUuid);
    const sourceActor = cleanId(sourceActorId)
      ? game.actors?.get?.(cleanId(sourceActorId)) ?? null
      : null;
    if (!sender
      || !isItemDocument(targetItem)
      || !isActorDocument(targetActor)
      || cleanId(targetItem.uuid) !== request.targetItemUuid
      || cleanId(targetActor.uuid) !== request.targetActorUuid
      || (sourceActorId && !isManagedPartyGroup(sourceActor))) {
      throw new Error("Некорректный запрос на удаление исходного предмета.");
    }
    if (targetActor.type !== "character" || !userOwnsActor(targetActor, sender)) {
      throw new Error("Игрок не владеет персонажем, получившим предмет.");
    }
    if (sourceActor) {
      const context = this.moduleApi.groupContextService?.resolveForGroup?.(sourceActor.id);
      const members = context?.members ?? getGroupMemberActors(sourceActor);
      if (!members.some((memberActor) => memberActor?.id === targetActor.id)) {
        throw new Error("Персонаж, получивший предмет, не входит в эту группу.");
      }
    }
    return { sender, sourceActor, targetActor, targetItem };
  }

  async #prepareSourceDepletionRecord(request) {
    const sourceItem = await resolveUuid(request.sourceItemUuid);
    if (!isItemDocument(sourceItem)) {
      throw new Error("Исходный предмет партийного склада не найден.");
    }
    const sourceActor = isActorDocument(sourceItem.parent) ? sourceItem.parent : null;
    if (!sourceActor || !isManagedPartyGroup(sourceActor)) {
      throw new Error("Исходный предмет не находится в партийном складе.");
    }
    const { targetItem } = await this.#resolveSourceDepletionParticipants(request, sourceActor.id);
    if (!itemsCanRepresentSameTransfer(sourceItem, targetItem)
      || !inventoryTransferIdentityMatches(sourceItem, request.expectedIdentity)
      || !inventoryTransferIdentityMatches(targetItem, request.expectedIdentity)
      || !inventoryQuantitiesMatch(getRawQuantity(sourceItem.toObject()), request.expectedQuantity)
      || !inventoryQuantitiesMatch(getRawQuantity(targetItem.toObject()), request.targetReceipt.afterQuantity)) {
      throw new Error("Полученный предмет не совпадает с captured identity или quantity исходного предмета склада.");
    }
    return this.#awaitSourceDepletionAuthority(() => this.mutationJournal.start({
      id: request.transferId,
      kind: "party-inventory-source-depletion",
      phase: "prepared",
      request,
      sourceActorId: sourceActor.id,
      targetActorId: targetItem.parent.id
    }));
  }

  async #executePartyInventorySourceDepletion(request) {
    this.#assertSourceDepletionAuthority();
    let record = await this.#awaitSourceDepletionAuthority(
      () => this.mutationJournal.find(request.transferId)
    );
    if (!record) {
      record = await this.#prepareSourceDepletionRecord(request);
    }
    this.#assertSourceDepletionMutationIdentity(record, request);
    const terminal = this.#readInventoryTerminal(record);
    if (terminal.terminal) {
      return terminal.value;
    }
    if (!["prepared", "source-depleted"].includes(record.phase)) {
      throw this.#inventoryReconciliationError("Party inventory source depletion requires reconciliation.");
    }

    await this.#resolveSourceDepletionParticipants(request, record.sourceActorId);
    if (record.phase === "prepared") {
      const sourceItem = await resolveUuid(request.sourceItemUuid);
      if (sourceItem) {
        const sourceActor = isActorDocument(sourceItem.parent) ? sourceItem.parent : null;
        if (!isItemDocument(sourceItem)
          || cleanId(sourceActor?.id) !== cleanId(record.sourceActorId)
          || !inventoryTransferIdentityMatches(sourceItem, request.expectedIdentity)
          || !inventoryQuantitiesMatch(getRawQuantity(sourceItem.toObject()), request.expectedQuantity)) {
          throw this.#inventoryReconciliationError("Party inventory source changed after depletion was prepared.");
        }
        try {
          await sourceItem.delete();
        }
        catch (error) {
          this.#assertSourceDepletionAuthority();
          if (await resolveUuid(request.sourceItemUuid)) {
            throw error;
          }
        }
        this.#assertSourceDepletionAuthority();
      }
      if (await resolveUuid(request.sourceItemUuid)) {
        throw this.#inventoryReconciliationError("Party inventory source deletion was not observed.");
      }
      record = await this.#awaitSourceDepletionAuthority(
        () => this.mutationJournal.checkpoint(request.transferId, "prepared", "source-depleted")
      );
    }

    const result = {
      handled: true,
      transferId: request.transferId,
      sourceItemUuid: request.sourceItemUuid,
      targetItemUuid: request.targetItemUuid,
      targetReceipt: request.targetReceipt
    };
    await this.#awaitSourceDepletionAuthority(
      () => this.mutationJournal.finish(request.transferId, { ok: true, value: result })
    );
    return foundry.utils.deepClone(result);
  }

  async handlePartyInventorySourceDepletionSocketRequest(payload = {}, { senderId = "" } = {}) {
    if (!isExplicitActiveGmClient()) {
      return false;
    }
    const request = this.#normalizeSourceDepletionRequest(payload, senderId);
    return this.mutationCoordinator.run(
      "inventory",
      () => this.#executePartyInventorySourceDepletion(request)
    );
  }

  async handleInventoryItemActionSocketRequest(payload = {}, { senderId = "" } = {}) {
    if (!isActiveGmClient()) {
      return false;
    }

    const sender = getSocketUser(senderId);
    const inventoryActor = await resolveUuid(payload.inventoryActorUuid);
    if (!sender || !isActorDocument(inventoryActor)) {
      throw new Error("Некорректный запрос действия со складом.");
    }

    if (!isManagedPartyGroup(inventoryActor)) {
      throw new Error("Цель действия не является партийным складом.");
    }

    const context = this.moduleApi.groupContextService?.resolveForGroup?.(inventoryActor.id);
    const members = context?.members ?? getGroupMemberActors(inventoryActor);
    const senderCanManageGroup = Boolean(context?.canManage)
      || members.some((memberActor) => userOwnsActor(memberActor, sender));
    if (!senderCanManageGroup) {
      throw new Error("Игрок не может управлять этим партийным складом.");
    }

    const action = cleanId(payload.action);
    const itemId = cleanId(payload.itemId);
    const quantity = Math.max(0.01, roundNumber(toNumber(payload.quantity, 1), 2));
    if (action === "delete") {
      return this.#deleteInventoryItemFromActor(inventoryActor, itemId);
    }

    if (action === "sell") {
      return this.#sellInventoryItemFromActor(inventoryActor, itemId, quantity, {
        mutationId: cleanId(payload.mutationId)
      });
    }

    if (action === "take") {
      const targetActor = await resolveUuid(payload.targetActorUuid);
      if (!isActorDocument(targetActor) || targetActor.type !== "character" || !userOwnsActor(targetActor, sender)) {
        throw new Error("Игрок не владеет персонажем, который получает предмет.");
      }

      const targetIsGroupMember = members.some((memberActor) => memberActor?.id === targetActor.id);
      if (!targetIsGroupMember) {
        throw new Error("Персонаж, получающий предмет, не входит в эту группу.");
      }

      return this.#takeInventoryItemFromActor(inventoryActor, itemId, targetActor, quantity, {
        mutationId: cleanId(payload.mutationId)
      });
    }

    throw new Error("Неизвестное действие со складом.");
  }

  async #importItemDocument(actor, itemDocument, {
    mutationId = "",
    groupActorId = "",
    folderId = null,
    serializedPlan = null
  } = {}) {
    const operationId = createInventoryMutationId("inventory-import", mutationId);
    const prepared = await this.#prepareImportedItemIngress(actor, itemDocument, {
      folderId,
      serializedPlan
    });
    if (prepared.cancelled) return prepared.result;
    const sourceActor = isActorDocument(itemDocument.parent) ? itemDocument.parent : null;
    return this.commitInventoryIngressBatch({
      groupActorId: cleanId(groupActorId || actor?.id),
      batchMutationId: operationId,
      sourceOrigin: "import",
      serializedPlan: prepared.serializedPlan
    }, {
      resolveRows: async () => {
        const livePrepared = await this.#prepareImportedItemIngress(actor, itemDocument, {
          folderId,
          serializedPlan: prepared.serializedPlan
        });
        return [livePrepared.row];
      },
      debitRow: async () => {
        if (!sourceActor) return;
        const sourceStillExists = () => sourceActor.items?.get?.(itemDocument.id)
          ?? sourceActor.items?.contents?.find?.((candidate) => candidate.id === itemDocument.id)
          ?? null;
        try {
          if (sourceStillExists()) await itemDocument.delete();
        }
        catch (error) {
          if (sourceStillExists()) throw error;
        }
      }
    });
  }

}


