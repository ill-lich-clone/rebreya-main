import { MODULE_ID, SETTINGS_KEYS } from "../constants.js";
import {
  applyMarketPrice,
  buildCityTraderPlans,
  getExpectedTraderCount,
  getGearBasePriceGold,
  getGearPriceModifier,
  getMaterialPriceModifier,
  getTraderPlanByKey
} from "../engine/trader-engine.js";
import { buildGearIconLookup, resolveGearItemIcon } from "./gear-icon-resolver.js";
import { classifyGearEntry } from "./item-classification.js";
import { formatPercent, formatSignedPercent } from "../ui.js";
import {
  normalizeTradeTransaction,
  retainTradeLog
} from "../features/trading/trade-transaction-model.js";

const MAX_ACTIVE_TRADERS = 21;
const TRADE_AUDIT_LIMIT = 20;
const TRADE_DOCUMENT_RECEIPT_LIMIT = 64;
const NONTERMINAL_TRADE_STATUSES = new Set([
  "prepared",
  "applying",
  "compensating",
  "reconciliation-required"
]);
const MIN_PRICE_GOLD = 0.01;
const GENERAL_TRADER_ICON = "icons/svg/item-bag.svg";
const MATERIAL_TRADER_ICON = "icons/svg/coins.svg";
const MAGIC_TRADER_ICON = "icons/magic/symbols/runes-star-pentagon-blue.webp";
const PRICE_IN_COPPER = {
  pp: 1000,
  gp: 100,
  ep: 50,
  sp: 10,
  cp: 1
};

const COIN_LABELS = {
  gp: "зм",
  sp: "см",
  cp: "мм"
};

const TRADER_RESTOCK_MODES = {
  DEFAULT: "default",
  MERGE: "merge",
  FREEZE: "freeze"
};

let sharedGearIconLookupPromise = null;

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, toNumber(value, min)));
}

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((toNumber(value) + Number.EPSILON) * factor) / factor;
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const rows = [];
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text || seen.has(text)) {
      continue;
    }

    seen.add(text);
    rows.push(text);
  }

  return rows;
}

async function getTraderGearIconLookup(moduleApi) {
  if (typeof moduleApi?.getGearIconLookup === "function") {
    const providedLookup = await moduleApi.getGearIconLookup();
    return providedLookup instanceof Map ? providedLookup : new Map();
  }

  if (!sharedGearIconLookupPromise) {
    sharedGearIconLookupPromise = buildGearIconLookup().catch((error) => {
      console.warn(`${MODULE_ID} | Failed to build trader gear icon lookup.`, error);
      return new Map();
    });
  }

  return sharedGearIconLookupPromise;
}

function getTraderSeedSalt(moduleApi) {
  const snapshot = moduleApi?.getCalendarSnapshot?.() ?? null;
  const year = Number(snapshot?.year);
  const month = Number(snapshot?.month);
  if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
    return `${year}-${String(month).padStart(2, "0")}`;
  }

  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildPlanSignature(plan) {
  const rows = Array.isArray(plan?.items) ? plan.items : [];
  if (!rows.length) {
    return `${String(plan?.traderType ?? "")}::empty`;
  }

  return rows
    .map((item) => `${item.sourceType}:${item.sourceId}:${Math.max(0, Math.floor(toNumber(item.quantity, 0)))}`)
    .sort((left, right) => left.localeCompare(right, "ru"))
    .join("|");
}

export function createEmptyTraderState() {
  return {
    version: 1,
    order: [],
    traders: {},
    tradeLog: []
  };
}

function cloneTraderState(value) {
  if (typeof globalThis.foundry?.utils?.deepClone === "function") {
    return globalThis.foundry.utils.deepClone(value);
  }

  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function normalizeTraderState(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const state = {
    ...createEmptyTraderState(),
    ...cloneTraderState(source)
  };

  state.order = Array.isArray(state.order) ? state.order : [];
  state.traders = state.traders && typeof state.traders === "object" ? state.traders : {};
  const tradeLog = Array.isArray(state.tradeLog)
    ? state.tradeLog.map((row) => normalizeTradeTransaction(row))
    : [];
  state.tradeLog = retainTradeLog(tradeLog);
  return state;
}

function createTradeAuditId() {
  const randomPart = typeof randomID === "function"
    ? randomID()
    : Math.random().toString(36).slice(2, 10);
  return `trade-${Date.now()}-${randomPart}`;
}

function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function getTraderStateKey(cityId, traderKey) {
  return `${cityId}::${traderKey}`;
}

function goldToCopper(value) {
  return Math.max(1, Math.round(Math.max(0, toNumber(value, MIN_PRICE_GOLD)) * 100));
}

function copperToBreakdown(value) {
  let remaining = Math.max(0, Math.round(toNumber(value, 0)));
  const breakdown = {
    pp: 0,
    gp: 0,
    ep: 0,
    sp: 0,
    cp: 0
  };

  breakdown.gp = Math.floor(remaining / PRICE_IN_COPPER.gp);
  remaining -= breakdown.gp * PRICE_IN_COPPER.gp;
  breakdown.sp = Math.floor(remaining / PRICE_IN_COPPER.sp);
  remaining -= breakdown.sp * PRICE_IN_COPPER.sp;
  breakdown.cp = remaining;
  return breakdown;
}

function formatCopper(value) {
  const breakdown = copperToBreakdown(value);
  const parts = Object.entries(breakdown)
    .filter(([, amount]) => amount > 0)
    .map(([denomination, amount]) => `${amount} ${COIN_LABELS[denomination]}`);

  return parts.length ? parts.join(" ") : `0 ${COIN_LABELS.cp}`;
}

function actorCurrencyToCopper(actor) {
  const currency = foundry.utils.getProperty(actor, "system.currency") ?? {};
  return Object.entries(PRICE_IN_COPPER)
    .reduce((sum, [denomination, multiplier]) => sum + (toNumber(currency[denomination], 0) * multiplier), 0);
}

function buildCurrencyUpdate(totalCopper) {
  const breakdown = copperToBreakdown(totalCopper);
  return {
    "system.currency.pp": 0,
    "system.currency.gp": breakdown.gp,
    "system.currency.ep": 0,
    "system.currency.sp": breakdown.sp,
    "system.currency.cp": breakdown.cp
  };
}

function getRawQuantity(itemData) {
  return Math.max(1, Math.floor(toNumber(foundry.utils.getProperty(itemData, "system.quantity"), 1)));
}

function getPlainDescription(itemData) {
  const rawDescription = String(foundry.utils.getProperty(itemData, "system.description.value") ?? "").trim();
  const container = document.createElement("div");
  container.innerHTML = rawDescription;
  return container.textContent?.trim() || "";
}

function getActorTradeCandidates() {
  return game.actors.contents
    .filter((actor) => actor?.isOwner && !actor.getFlag(MODULE_ID, "managedTrader"))
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));
}

function getUserById(userId) {
  const safeUserId = String(userId ?? "").trim();
  if (!safeUserId) {
    return null;
  }

  return game.users?.get?.(safeUserId)
    ?? game.users?.contents?.find?.((user) => user?.id === safeUserId)
    ?? null;
}

function userOwnsActor(actor, userId) {
  const safeUserId = String(userId ?? "").trim();
  if (!actor || !safeUserId) {
    return false;
  }

  const user = getUserById(safeUserId);
  if (user?.isGM) {
    return true;
  }

  const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  if (user && typeof actor.testUserPermission === "function") {
    try {
      if (actor.testUserPermission(user, ownerLevel)) {
        return true;
      }
    }
    catch (_error) {
      // Try the string permission form below for older Foundry APIs.
    }

    try {
      if (actor.testUserPermission(user, "OWNER")) {
        return true;
      }
    }
    catch (_error) {
      // Fall through to ownership data.
    }
  }

  const ownership = actor.ownership ?? actor._source?.ownership ?? {};
  return toNumber(ownership[safeUserId], 0) >= ownerLevel
    || toNumber(ownership.default, 0) >= ownerLevel;
}

function assertUserCanTradeActor(actor, userId) {
  const safeUserId = String(userId ?? "").trim();
  if (!safeUserId) {
    return;
  }

  if (!userOwnsActor(actor, safeUserId)) {
    throw new Error("Игрок не владеет выбранным персонажем для торговли.");
  }
}

function getUserLabel(userId) {
  const user = getUserById(userId);
  return String(user?.name ?? user?.id ?? userId ?? "").trim();
}

function formatAuditTimestamp(timestamp) {
  const date = new Date(Math.max(0, Math.floor(toNumber(timestamp, Date.now()))));
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function normalizeTradeAuditRecord(operation = {}, { senderId = "" } = {}) {
  const type = String(operation.type ?? "").trim() === "sale" ? "sale" : "purchase";
  const quantity = Math.max(1, Math.floor(toNumber(operation.quantity, 1)));
  const totalCopper = Math.max(0, Math.round(toNumber(
    operation.totalCopper,
    type === "sale" ? operation.netPayoutCopper : operation.totalPriceCopper
  )));
  const safeSenderId = String(senderId || operation.senderId || "").trim();

  return {
    id: String(operation.id ?? "").trim() || createTradeAuditId(),
    type,
    createdAt: Math.max(0, Math.floor(toNumber(operation.createdAt, Date.now()))),
    senderId: safeSenderId,
    senderName: String(operation.senderName ?? getUserLabel(safeSenderId)).trim(),
    actorId: String(operation.actorId ?? "").trim(),
    actorName: String(operation.actorName ?? "").trim(),
    cityId: String(operation.cityId ?? "").trim(),
    cityName: String(operation.cityName ?? "").trim(),
    traderKey: String(operation.traderKey ?? "").trim(),
    traderName: String(operation.traderName ?? "").trim(),
    itemId: String(operation.itemId ?? "").trim(),
    itemUuid: String(operation.itemUuid ?? "").trim(),
    itemName: String(operation.itemName ?? "").trim(),
    sourceType: String(operation.sourceType ?? "").trim(),
    sourceId: String(operation.sourceId ?? "").trim(),
    quantity,
    totalCopper,
    totalPriceCopper: Math.max(0, Math.round(toNumber(operation.totalPriceCopper, type === "purchase" ? totalCopper : 0))),
    grossOfferCopper: Math.max(0, Math.round(toNumber(operation.grossOfferCopper, 0))),
    taxCopper: Math.max(0, Math.round(toNumber(operation.taxCopper, 0))),
    netPayoutCopper: Math.max(0, Math.round(toNumber(operation.netPayoutCopper, type === "sale" ? totalCopper : 0))),
    currencyBeforeCopper: Math.max(0, Math.round(toNumber(operation.currencyBeforeCopper, 0))),
    currencyAfterCopper: Math.max(0, Math.round(toNumber(operation.currencyAfterCopper, 0))),
    itemQuantityBefore: Math.max(0, Math.floor(toNumber(operation.itemQuantityBefore, 0))),
    itemQuantityAfter: Math.max(0, Math.floor(toNumber(operation.itemQuantityAfter, 0))),
    rawItemData: operation.rawItemData ? sanitizeRawItemData(operation.rawItemData) : null,
    verified: operation.verified === false ? false : true,
    rolledBack: operation.rolledBack === true,
    rolledBackAt: Math.max(0, Math.floor(toNumber(operation.rolledBackAt, 0))),
    rolledBackByUserId: String(operation.rolledBackByUserId ?? "").trim()
  };
}

function buildAuditViewRecord(record) {
  const typeLabel = record.type === "sale" ? "Продажа" : "Покупка";
  const copper = record.type === "sale"
    ? toNumber(record.netPayoutCopper, record.totalCopper)
    : toNumber(record.totalPriceCopper, record.totalCopper);
  const rolledBack = record.rolledBack === true;
  const verified = record.verified !== false;

  return {
    ...record,
    typeLabel,
    timestampLabel: formatAuditTimestamp(record.createdAt),
    amountLabel: formatCopper(copper),
    quantityLabel: `${record.quantity} шт.`,
    actorLabel: record.actorName || record.actorId || "Персонаж",
    traderLabel: [record.cityName, record.traderName].filter(Boolean).join(" / "),
    userLabel: record.senderName || record.senderId || "Игрок",
    statusLabel: rolledBack ? "Откат выполнен" : (verified ? "Активна" : "Проверить вручную"),
    rolledBack,
    rollbackDisabled: rolledBack || !verified || game.user?.isGM !== true,
    rollbackTitle: rolledBack
      ? "Операция уже откачена"
      : (verified ? "Откатить операцию" : "Нельзя откатить: владелец операции не подтверждён")
  };
}

function resolveActorByPreference(actorId = null, { preferredActor = null } = {}) {
  if (actorId) {
    const actor = game.actors.get(actorId);
    if (actor?.isOwner) {
      return actor;
    }
  }

  if (preferredActor?.isOwner) {
    return preferredActor;
  }

  const controlledActor = canvas?.tokens?.controlled?.find((token) => token.actor?.isOwner)?.actor ?? null;
  if (controlledActor) {
    return controlledActor;
  }

  if (game.user?.character?.isOwner) {
    return game.user.character;
  }

  return getActorTradeCandidates()[0] ?? null;
}

function parseDnd5ePriceGold(itemData) {
  const priceValue = toNumber(foundry.utils.getProperty(itemData, "system.price.value"), 0);
  const denomination = String(foundry.utils.getProperty(itemData, "system.price.denomination") ?? "gp");
  const multiplier = {
    pp: 10,
    gp: 1,
    ep: 0.5,
    sp: 0.1,
    cp: 0.01
  }[denomination] ?? 1;

  return Math.max(MIN_PRICE_GOLD, roundNumber(priceValue * multiplier, 4));
}

function getInventoryEntryIcon(entry) {
  if (entry.sourceType === "material") {
    return entry.img || MATERIAL_TRADER_ICON;
  }

  if (entry.sourceType === "magicItem") {
    return entry.img || MAGIC_TRADER_ICON;
  }

  const typeText = normalizeText(entry.itemTypeLabel);
  if (typeText.includes("инстру")) {
    return "icons/tools/smithing/anvil.webp";
  }

  if (typeText.includes("одеж")) {
    return "icons/commodities/cloth/coat-collared-red.webp";
  }

  if (typeText.includes("зель")) {
    return "icons/consumables/potions/potion-flask-corked-red.webp";
  }

  if (typeText.includes("транспорт") || typeText.includes("скакун")) {
    return "icons/environment/settlement/wagon.webp";
  }

  return entry.img || GENERAL_TRADER_ICON;
}

function sanitizeRawItemData(itemData) {
  const source = foundry.utils.deepClone(itemData);
  delete source._id;
  delete source.folder;
  delete source.sort;
  delete source.ownership;
  delete source._stats;
  return source;
}

function buildInventoryEntryFromPlanItem(plan, planItem, { quantityMultiplier = 1 } = {}) {
  const baseQuantity = Math.max(0, Math.floor(toNumber(planItem.quantity, 0)));
  const scaledQuantity = Math.max(0, Math.floor(baseQuantity * Math.max(0, toNumber(quantityMultiplier, 1))));
  const sourceType = String(planItem.sourceType ?? "");
  const img = sourceType === "material"
    ? MATERIAL_TRADER_ICON
    : (sourceType === "magicItem" ? MAGIC_TRADER_ICON : GENERAL_TRADER_ICON);
  const itemTypeLabel = sourceType === "material"
    ? "Материал"
    : (sourceType === "magicItem" ? "Магический предмет" : "Снаряжение");

  return {
    itemKey: `${planItem.sourceType}:${planItem.sourceId}`,
    sourceType: planItem.sourceType,
    sourceId: planItem.sourceId,
    name: planItem.name,
    img: planItem.img || img,
    description: String(planItem.description ?? ""),
    quantity: scaledQuantity,
    basePriceGold: Math.max(MIN_PRICE_GOLD, toNumber(planItem.basePriceGold, MIN_PRICE_GOLD)),
    baseWeight: toNumber(planItem.baseWeight, 0),
    rank: Math.max(0, Math.round(toNumber(planItem.rank, 0))),
    itemTypeLabel: String(planItem.itemTypeLabel ?? itemTypeLabel),
    predominantMaterialId: planItem.predominantMaterialId ?? null,
    predominantMaterialName: planItem.predominantMaterialName ?? "",
    linkedTool: planItem.linkedTool ?? "",
    linkedGoodId: planItem.linkedGoodId ?? null,
    shopSubtype: String(planItem.shopSubtype ?? plan.shopSubtype ?? ""),
    rarity: String(planItem.rarity ?? ""),
    rawItemData: null
  };
}

function buildTraderGearClassification(entry) {
  if (entry.sourceType !== "gear") {
    return null;
  }

  return classifyGearEntry({
    id: entry.sourceId,
    name: entry.name,
    equipmentType: entry.itemTypeLabel
  });
}

function parseTraderAmmunitionSourcePack(entry) {
  const classification = buildTraderGearClassification(entry);
  if (classification?.documentType !== "consumable" || classification.systemTypeValue !== "ammo") {
    return null;
  }

  const sourceName = String(entry.name ?? "").trim();
  const match = sourceName.match(/\s*\((\d+)\)\s*$/u);
  if (!match) {
    return null;
  }

  const quantity = Math.max(1, Math.floor(toNumber(match[1], 1)));
  const sourcePackPriceGoldEquivalent = Math.max(0, toNumber(entry.basePriceGold, 0));
  const sourcePackWeight = Math.max(0, toNumber(entry.baseWeight, 0));

  return {
    quantity,
    classification,
    actorName: sourceName.replace(/\s*\(\d+\)\s*$/u, "").trim() || sourceName,
    actorBasePriceGold: roundNumber(sourcePackPriceGoldEquivalent / quantity, 6),
    actorWeight: roundNumber(toNumber(entry.finalWeight, sourcePackWeight) / quantity, 6),
    sourcePackPriceGoldEquivalent,
    sourcePackWeight
  };
}

function copperToDnd5ePrice(priceCopper) {
  const safePriceCopper = Math.max(0, roundNumber(priceCopper, 6));
  const denomination = safePriceCopper >= PRICE_IN_COPPER.gp
    ? "gp"
    : (safePriceCopper % PRICE_IN_COPPER.sp === 0 ? "sp" : "cp");
  const value = denomination === "gp"
    ? roundNumber(safePriceCopper / PRICE_IN_COPPER.gp, 2)
    : (denomination === "sp"
      ? roundNumber(safePriceCopper / PRICE_IN_COPPER.sp, 6)
      : safePriceCopper);

  return {
    value,
    denomination
  };
}

function normalizeRestockMode(value) {
  const text = normalizeText(value);
  if (!text) {
    return TRADER_RESTOCK_MODES.DEFAULT;
  }

  if ([
    "freeze",
    "frozen",
    "keep",
    "preserve",
    "norestock",
    "noreset",
    "безпополнения",
    "безобновления",
    "заморозка",
    "сохранить"
  ].includes(text)) {
    return TRADER_RESTOCK_MODES.FREEZE;
  }

  if ([
    "merge",
    "append",
    "combine",
    "partial",
    "смешать",
    "объединить",
    "добавить"
  ].includes(text)) {
    return TRADER_RESTOCK_MODES.MERGE;
  }

  return TRADER_RESTOCK_MODES.DEFAULT;
}

function getRestockModePriority(mode) {
  switch (normalizeRestockMode(mode)) {
    case TRADER_RESTOCK_MODES.FREEZE:
      return 3;
    case TRADER_RESTOCK_MODES.MERGE:
      return 2;
    case TRADER_RESTOCK_MODES.DEFAULT:
    default:
      return 1;
  }
}

function mergeRestockModes(leftMode, rightMode) {
  const left = normalizeRestockMode(leftMode);
  const right = normalizeRestockMode(rightMode);
  return getRestockModePriority(right) > getRestockModePriority(left) ? right : left;
}

function mergeInventoryForRestock(existingInventory = [], refreshedInventory = []) {
  const existingRows = Array.isArray(existingInventory) ? existingInventory : [];
  const refreshedRows = Array.isArray(refreshedInventory) ? refreshedInventory : [];
  const existingByKey = new Map(existingRows.map((row) => [String(row?.itemKey ?? ""), row]).filter(([key]) => key));
  const mergedRows = [];

  for (const refreshedEntry of refreshedRows) {
    const itemKey = String(refreshedEntry?.itemKey ?? "").trim();
    const existingEntry = itemKey ? existingByKey.get(itemKey) ?? null : null;
    if (existingEntry) {
      mergedRows.push({
        ...refreshedEntry,
        quantity: Math.max(
          0,
          Math.floor(Math.max(
            toNumber(refreshedEntry.quantity, 0),
            toNumber(existingEntry.quantity, 0)
          ))
        ),
        rawItemData: existingEntry.rawItemData ?? refreshedEntry.rawItemData ?? null,
        eventSourceNames: uniqueStrings([
          ...(existingEntry.eventSourceNames ?? []),
          ...(refreshedEntry.eventSourceNames ?? [])
        ])
      });
      existingByKey.delete(itemKey);
    }
    else {
      mergedRows.push({
        ...refreshedEntry,
        quantity: Math.max(0, Math.floor(toNumber(refreshedEntry.quantity, 0)))
      });
    }
  }

  for (const staleEntry of existingByKey.values()) {
    mergedRows.push({
      ...staleEntry,
      quantity: Math.max(0, Math.floor(toNumber(staleEntry.quantity, 0)))
    });
  }

  return mergedRows.filter((entry) => toNumber(entry.quantity, 0) > 0);
}

function applyRestockModeToInventory(existingInventory = [], refreshedInventory = [], mode = TRADER_RESTOCK_MODES.DEFAULT) {
  const safeMode = normalizeRestockMode(mode);
  if (safeMode === TRADER_RESTOCK_MODES.FREEZE) {
    return foundry.utils.deepClone(Array.isArray(existingInventory) ? existingInventory : []);
  }

  if (safeMode === TRADER_RESTOCK_MODES.MERGE) {
    return mergeInventoryForRestock(existingInventory, refreshedInventory);
  }

  return foundry.utils.deepClone(Array.isArray(refreshedInventory) ? refreshedInventory : []);
}

function getAssortmentStatusByRestockMode(mode) {
  const safeMode = normalizeRestockMode(mode);
  if (safeMode === TRADER_RESTOCK_MODES.FREEZE) {
    return "frozen";
  }

  if (safeMode === TRADER_RESTOCK_MODES.MERGE) {
    return "merged";
  }

  return "updated";
}

function createStateFromPlan(
  citySnapshot,
  plan,
  {
    moduleApi = null,
    model = null,
    assortmentSeedSalt = "",
    assortmentStatus = "saved",
    assortmentUpdatedAt = null
  } = {}
) {
  const sourceModel = model ?? null;
  const now = Date.now();
  let restockMode = TRADER_RESTOCK_MODES.DEFAULT;
  const inventory = plan.items
    .map((item) => {
      let quantityMultiplier = 1;
      let blocked = false;
      let eventSourceNames = [];

      if (moduleApi?.globalEventsService && sourceModel) {
        const goodId = item.sourceType === "material"
          ? (sourceModel.materialById?.get(item.sourceId)?.linkedGoodId ?? item.linkedGoodId ?? null)
          : (
            item.sourceType === "gear"
              ? (() => {
                const gearItem = sourceModel.gearById?.get(item.sourceId) ?? null;
                const materialId = gearItem?.predominantMaterialId ?? item.predominantMaterialId ?? null;
                return materialId ? sourceModel.materialById?.get(materialId)?.linkedGoodId ?? null : null;
              })()
              : (item.linkedGoodId ?? null)
          );
        const merchantModifiers = moduleApi.globalEventsService.collectMerchantModifiers({
          model: sourceModel,
          cityId: citySnapshot.id,
          goodId: goodId ?? "",
          itemCategory: item.sourceType,
          traderType: plan.traderType
        });
        quantityMultiplier = 1 + toNumber(merchantModifiers.stockPercent, 0);
        blocked = merchantModifiers.blocked === true;
        eventSourceNames = merchantModifiers.sourceEventNames ?? [];
        restockMode = mergeRestockModes(restockMode, merchantModifiers.restockMode);
      }

      const entry = buildInventoryEntryFromPlanItem(plan, item, { quantityMultiplier });
      entry.eventSourceNames = eventSourceNames;
      entry.blockedByEvents = blocked;
      if (blocked) {
        entry.quantity = 0;
      }

      return entry;
    })
    .filter((entry) => toNumber(entry.quantity, 0) > 0);

  return {
    traderId: getTraderStateKey(citySnapshot.id, plan.traderKey),
    cityId: citySnapshot.id,
    traderKey: plan.traderKey,
    traderType: plan.traderType,
    planSignature: buildPlanSignature(plan),
    portrait: "",
    description: "",
    openedAt: now,
    updatedAt: now,
    assortmentSeedSalt: String(assortmentSeedSalt ?? "").trim(),
    assortmentStatus: String(assortmentStatus ?? "saved").trim() || "saved",
    assortmentUpdatedAt: Math.max(0, Math.floor(toNumber(assortmentUpdatedAt, now))),
    restockMode,
    inventory
  };
}

function buildCustomerOptions(selectedActorId = null, { partyInventoryActorId = null } = {}) {
  return getActorTradeCandidates().map((actor) => ({
    value: actor.id,
    label: actor.id === partyInventoryActorId
      ? `${actor.name} (партийный склад)`
      : actor.name,
    selected: actor.id === selectedActorId
  }));
}

function buildPricePresentation(finalPriceCopper) {
  return {
    finalPriceCopper,
    finalPriceLabel: formatCopper(finalPriceCopper)
  };
}

function getStatePolicyByCity(moduleApi, citySnapshot) {
  if (typeof moduleApi.getEffectiveStatePolicy === "function") {
    return foundry.utils.deepClone(moduleApi.getEffectiveStatePolicy(citySnapshot.state) ?? {
      taxPercent: 0,
      generalDutyPercent: 0,
      bilateralDuties: {},
      eventDelta: {
        taxPercent: 0,
        generalDutyPercent: 0,
        bilateralDuties: {},
        sourceEventNames: []
      }
    });
  }

  const policies = moduleApi.getStatePolicies?.() ?? {};
  return foundry.utils.deepClone(policies?.[citySnapshot.state] ?? {
    taxPercent: 0,
    generalDutyPercent: 0,
    bilateralDuties: {}
  });
}

function resolveGoodIdForStockEntry(model, stockEntry, resolvedMetadata = {}) {
  if (stockEntry.sourceType === "material") {
    const material = model.materialById?.get(stockEntry.sourceId) ?? null;
    return material?.linkedGoodId ?? resolvedMetadata.linkedGoodId ?? null;
  }

  if (stockEntry.sourceType === "gear") {
    const gearItem = model.gearById?.get(stockEntry.sourceId) ?? null;
    const materialId = gearItem?.predominantMaterialId ?? resolvedMetadata.predominantMaterialId ?? null;
    const material = materialId ? model.materialById?.get(materialId) ?? null : null;
    return material?.linkedGoodId ?? resolvedMetadata.linkedGoodId ?? null;
  }

  return resolvedMetadata.linkedGoodId ?? null;
}

function resolveDutyPercentForSourceState(statePolicy = {}, sourceStateId = "", importerStateId = "") {
  const exporterStateId = String(sourceStateId ?? "").trim();
  const safeImporterStateId = String(importerStateId ?? "").trim();
  if (!exporterStateId || !safeImporterStateId || exporterStateId === safeImporterStateId) {
    return 0;
  }

  const bilateralDuty = statePolicy?.bilateralDuties?.[exporterStateId];
  if (bilateralDuty !== undefined && bilateralDuty !== null && Number.isFinite(Number(bilateralDuty))) {
    return toNumber(bilateralDuty, 0);
  }

  return toNumber(statePolicy?.generalDutyPercent, 0);
}

function getDutyModifierPercentForGood(model, citySnapshot, statePolicy = {}, linkedGoodId = null) {
  const importerStateId = String(citySnapshot?.state ?? "").trim();
  if (!importerStateId) {
    return 0;
  }

  const fallbackDutyPercent = toNumber(statePolicy?.generalDutyPercent, 0);
  const goodId = String(linkedGoodId ?? "").trim();
  if (!goodId) {
    return fallbackDutyPercent;
  }

  const goodsRow = citySnapshot?.goodsRowById?.[goodId] ?? null;
  if (!goodsRow) {
    return fallbackDutyPercent;
  }

  const importSources = Array.isArray(goodsRow.importSources) ? goodsRow.importSources : [];
  if (!importSources.length) {
    return 0;
  }

  let weightedDuty = 0;
  let totalImported = 0;
  for (const source of importSources) {
    const quantity = Math.max(0, toNumber(source?.quantity, 0));
    if (quantity <= 0) {
      continue;
    }

    const sourceCity = model?.cityById?.get(source.sourceCityId) ?? null;
    const sourceStateId = String(sourceCity?.state ?? "").trim();
    const dutyPercent = resolveDutyPercentForSourceState(statePolicy, sourceStateId, importerStateId);
    weightedDuty += dutyPercent * quantity;
    totalImported += quantity;
  }

  if (totalImported <= 1e-9) {
    return 0;
  }

  const averageDutyPercent = weightedDuty / totalImported;
  const totalAvailableSupply = toNumber(
    goodsRow.totalAvailableSupply,
    toNumber(goodsRow.production, 0) + toNumber(goodsRow.importedQuantity, 0)
  );
  const importShare = totalAvailableSupply > 1e-9
    ? clamp(toNumber(goodsRow.importedQuantity, 0) / totalAvailableSupply, 0, 1)
    : 0;

  return averageDutyPercent * importShare;
}

function buildMarkupTooltip({
  totalModifierPercent = 0,
  importMarkupPercent = 0,
  eventPriceModifierPercent = 0,
  goodEventSourceNames = [],
  dutyModifierPercent = 0,
  merchantModifierPercent = 0,
  merchantEventSourceNames = []
} = {}) {
  const lines = [
    `Итоговая наценка: ${formatSignedPercent(toNumber(totalModifierPercent, 0), 1)}`
  ];
  const safeImportMarkupPercent = toNumber(importMarkupPercent, 0);
  if (Math.abs(safeImportMarkupPercent) > 1e-9) {
    lines.push(`Наценка за импорт: ${formatSignedPercent(safeImportMarkupPercent, 1)}`);
  }

  const safeEventPriceModifierPercent = toNumber(eventPriceModifierPercent, 0);
  const normalizedGoodEventNames = uniqueStrings(goodEventSourceNames);
  if (Math.abs(safeEventPriceModifierPercent) > 1e-9 && normalizedGoodEventNames.length) {
    lines.push(
      `Ивенты товара (${normalizedGoodEventNames.join(", ")}): ${formatSignedPercent(safeEventPriceModifierPercent, 1)}`
    );
  } else if (Math.abs(safeEventPriceModifierPercent) > 1e-9) {
    lines.push(`Ивенты товара: ${formatSignedPercent(safeEventPriceModifierPercent, 1)}`);
  }

  const safeDutyModifierPercent = toNumber(dutyModifierPercent, 0);
  if (Math.abs(safeDutyModifierPercent) > 1e-9) {
    lines.push(`Пошлина: ${formatSignedPercent(safeDutyModifierPercent, 1)}`);
  }

  const safeMerchantModifierPercent = toNumber(merchantModifierPercent, 0);
  const normalizedMerchantEventNames = uniqueStrings(merchantEventSourceNames);
  if (Math.abs(safeMerchantModifierPercent) > 1e-9 && normalizedMerchantEventNames.length) {
    lines.push(
      `Ивенты торговца (${normalizedMerchantEventNames.join(", ")}): ${formatSignedPercent(safeMerchantModifierPercent, 1)}`
    );
  } else if (Math.abs(safeMerchantModifierPercent) > 1e-9) {
    lines.push(`Ивенты торговца: ${formatSignedPercent(safeMerchantModifierPercent, 1)}`);
  }

  if (lines.length === 1) {
    lines.push("Дополнительных факторов нет.");
  }

  return lines.join("\n");
}

function buildCanonicalItemData(entry, quantity, finalPriceCopper) {
  const sourcePack = parseTraderAmmunitionSourcePack(entry);
  const subtype = entry.sourceType === "material"
    ? entry.itemTypeLabel
    : entry.itemTypeLabel || "Снаряжение";

  const descriptionLines = [];
  if (entry.materialLabel) {
    descriptionLines.push(`<p><strong>Преобладающий материал:</strong> ${escapeHtml(entry.materialLabel)}</p>`);
  }
  if (entry.linkedTool) {
    descriptionLines.push(`<p><strong>Связанный инструмент:</strong> ${escapeHtml(entry.linkedTool)}</p>`);
  }
  if (entry.rarity) {
    descriptionLines.push(`<p><strong>Редкость:</strong> ${escapeHtml(entry.rarity)}</p>`);
  }
  if (entry.shopSubtype) {
    descriptionLines.push(`<p><strong>Лавка:</strong> ${escapeHtml(entry.shopSubtype)}</p>`);
  }
  if (entry.description) {
    descriptionLines.push(`<p>${escapeHtml(entry.description)}</p>`);
  }

  const sourcePackQuantity = sourcePack?.quantity ?? 1;
  const actorQuantity = Math.max(1, Math.floor(toNumber(quantity, 1))) * sourcePackQuantity;
  const actorPriceCopper = finalPriceCopper / sourcePackQuantity;
  const price = copperToDnd5ePrice(actorPriceCopper);
  const itemType = sourcePack ? "consumable" : "loot";
  const systemType = sourcePack
    ? {
      value: sourcePack.classification.systemTypeValue || "ammo",
      subtype: sourcePack.classification.systemTypeSubtype || ""
    }
    : {
      value: entry.sourceType === "material" ? "trade" : "loot",
      subtype
    };

  return {
    name: sourcePack?.actorName ?? entry.name,
    type: itemType,
    img: getInventoryEntryIcon(entry),
    system: {
      description: {
        value: descriptionLines.join(""),
        chat: ""
      },
      unidentified: {
        description: ""
      },
      quantity: actorQuantity,
      price: {
        value: price.value,
        denomination: price.denomination
      },
      weight: {
        value: sourcePack?.actorWeight ?? toNumber(entry.finalWeight, entry.baseWeight),
        units: "lb"
      },
      type: systemType
    },
    flags: {
      [MODULE_ID]: {
        traderManaged: true,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        basePriceGold: sourcePack?.actorBasePriceGold ?? entry.basePriceGold,
        priceGoldEquivalent: sourcePack?.actorBasePriceGold ?? entry.basePriceGold,
        sourcePackQuantity: sourcePack?.quantity ?? null,
        sourcePackPriceGoldEquivalent: sourcePack?.sourcePackPriceGoldEquivalent ?? null,
        sourcePackWeight: sourcePack?.sourcePackWeight ?? null,
        foundryType: itemType,
        foundrySubtype: sourcePack?.classification.systemTypeValue ?? (entry.sourceType === "material" ? "trade" : "loot"),
        foundrySubtypeExtra: sourcePack?.classification.systemTypeSubtype ?? "",
        predominantMaterialId: entry.predominantMaterialId ?? null,
        predominantMaterialName: entry.predominantMaterialName ?? "",
        linkedGoodId: entry.linkedGoodId ?? null,
        shopSubtype: entry.shopSubtype ?? "",
        rarity: entry.rarity ?? ""
      }
    }
  };
}

export class TraderService {
  constructor(moduleApi, { stateRepository = null } = {}) {
    this.moduleApi = moduleApi;
    this.stateRepository = stateRepository;
    this.transactionService = null;
  }

  setTransactionService(service) {
    this.transactionService = service;
  }

  createFoundryTradeOperations() {
    return {
      preparePurchase: (request, context) => this.#preparePurchase(request, context),
      applyPurchaseItem: (transaction) => this.#applyPurchaseItem(transaction),
      applyPurchaseCurrency: (transaction) => this.#applyPurchaseCurrency(transaction),
      readPurchaseReceipts: (transaction) => this.#readPurchaseReceipts(transaction),
      compensatePurchaseCurrency: (transaction) => this.#compensatePurchaseCurrency(transaction),
      compensatePurchaseItem: (transaction) => this.#compensatePurchaseItem(transaction),
      prepareSale: (request, context) => this.#prepareSale(request, context),
      applySaleItem: (transaction) => this.#applySaleItem(transaction),
      applySaleCurrency: (transaction) => this.#applySaleCurrency(transaction),
      readSaleReceipts: (transaction) => this.#readSaleReceipts(transaction),
      compensateSaleCurrency: (transaction) => this.#compensateSaleCurrency(transaction),
      compensateSaleItem: (transaction) => this.#compensateSaleItem(transaction)
    };
  }

  #getTradeMarkerMap(document, flagName) {
    const value = foundry.utils.getProperty(document, `flags.${MODULE_ID}.${flagName}`);
    return value && typeof value === "object" && !Array.isArray(value)
      ? foundry.utils.deepClone(value)
      : {};
  }

  #pruneTradeMarkerMap(markers, activeTransactionId) {
    const tradeLog = this.stateRepository
      ? this.stateRepository.read()?.tradeLog
      : [];
    const statusByTransactionId = new Map(
      (Array.isArray(tradeLog) ? tradeLog : []).map((row) => [
        String(row?.transactionId ?? "").trim(),
        String(row?.status ?? "").trim()
      ])
    );
    const retained = [];
    const terminal = [];
    for (const [transactionId, marker] of Object.entries(markers)) {
      if (transactionId === activeTransactionId
        || NONTERMINAL_TRADE_STATUSES.has(statusByTransactionId.get(transactionId))) {
        retained.push([transactionId, marker]);
      }
      else {
        terminal.push([transactionId, marker]);
      }
    }
    terminal.sort((left, right) => (
      toNumber(right[1]?.updatedAt, 0) - toNumber(left[1]?.updatedAt, 0)
        || right[0].localeCompare(left[0])
    ));
    return Object.fromEntries([
      ...retained,
      ...terminal.slice(0, TRADE_DOCUMENT_RECEIPT_LIMIT)
    ]);
  }

  #buildItemMarker(transaction, item, { applied, phase }) {
    return {
      transactionId: transaction.transactionId,
      kind: transaction.kind,
      applied,
      phase,
      actorId: transaction.request.actorId,
      itemId: transaction.item.created ? "" : item.id,
      itemUuid: transaction.item.created ? "" : item.uuid,
      created: transaction.item.created === true,
      delta: transaction.item.delta,
      before: transaction.item.beforeQuantity,
      after: transaction.item.afterQuantity,
      updatedAt: Date.now()
    };
  }

  #buildCurrencyReceipt(transaction, { applied, phase }) {
    return {
      transactionId: transaction.transactionId,
      kind: transaction.kind,
      applied,
      phase,
      actorId: transaction.request.actorId,
      deltaCopper: transaction.currency.deltaCopper,
      beforeCopper: transaction.currency.beforeCopper,
      afterCopper: transaction.currency.afterCopper,
      updatedAt: Date.now()
    };
  }

  #buildRecreatedSaleMarker(transaction) {
    return {
      transactionId: transaction.transactionId,
      kind: "sale",
      applied: false,
      phase: "compensated",
      actorId: transaction.request.actorId,
      itemId: "",
      itemUuid: "",
      originalItemId: transaction.item.itemId,
      originalItemUuid: transaction.item.itemUuid,
      created: false,
      recreated: true,
      delta: transaction.item.delta,
      before: transaction.item.beforeQuantity,
      after: transaction.item.afterQuantity,
      updatedAt: Date.now()
    };
  }

  #itemMarkerMatches(marker, transaction, item, { applied }) {
    if (!marker || typeof marker !== "object" || Array.isArray(marker)) return false;
    const expectedCreated = transaction.item.created === true;
    const recreatedCompensation = transaction.kind === "sale"
      && applied === false
      && marker.recreated === true;
    const identityMatches = recreatedCompensation
      ? marker.itemId === ""
        && marker.itemUuid === ""
        && marker.originalItemId === transaction.item.itemId
        && marker.originalItemUuid === transaction.item.itemUuid
        && item.parent?.id === transaction.request.actorId
      : expectedCreated
        ? (!marker.itemId || marker.itemId === item.id)
          && (!marker.itemUuid || marker.itemUuid === item.uuid)
        : marker.recreated !== true
          && marker.itemId === transaction.item.itemId
          && marker.itemUuid === transaction.item.itemUuid
          && item.id === transaction.item.itemId
          && item.uuid === transaction.item.itemUuid;
    return marker.transactionId === transaction.transactionId
      && marker.kind === transaction.kind
      && marker.applied === applied
      && marker.phase === (applied ? "applied" : "compensated")
      && marker.actorId === transaction.request.actorId
      && marker.created === expectedCreated
      && marker.delta === transaction.item.delta
      && marker.before === transaction.item.beforeQuantity
      && marker.after === transaction.item.afterQuantity
      && identityMatches;
  }

  #currencyReceiptMatches(receipt, transaction, { applied }) {
    return Boolean(receipt) && typeof receipt === "object" && !Array.isArray(receipt)
      && receipt.transactionId === transaction.transactionId
      && receipt.kind === transaction.kind
      && receipt.applied === applied
      && receipt.phase === (applied ? "applied" : "compensated")
      && receipt.actorId === transaction.request.actorId
      && receipt.deltaCopper === transaction.currency.deltaCopper
      && receipt.beforeCopper === transaction.currency.beforeCopper
      && receipt.afterCopper === transaction.currency.afterCopper;
  }

  #findTransactionItem(actor, transaction) {
    const directItem = transaction.item.itemId
      ? actor.items?.get?.(transaction.item.itemId)
        ?? actor.items?.contents?.find?.((item) => item.id === transaction.item.itemId)
        ?? null
      : null;
    if (directItem) return directItem;

    return actor.items?.contents?.find?.((item) => (
      Object.hasOwn(
        this.#getTradeMarkerMap(item, "tradeTransactions"),
        transaction.transactionId
      )
    )) ?? null;
  }

  #assertNoConflictingMarker(marker, transaction, item) {
    if (!marker) return;
    if (this.#itemMarkerMatches(marker, transaction, item, { applied: true })
      || this.#itemMarkerMatches(marker, transaction, item, { applied: false })) {
      return;
    }
    throw new Error("Маркер торговой операции предмета конфликтует с транзакцией.");
  }

  #assertNoConflictingReceipt(receipt, transaction) {
    if (!receipt) return;
    if (this.#currencyReceiptMatches(receipt, transaction, { applied: true })
      || this.#currencyReceiptMatches(receipt, transaction, { applied: false })) {
      return;
    }
    throw new Error("Квитанция торговой операции конфликтует с транзакцией.");
  }

  async #applyPurchaseItem(transaction) {
    const actor = this.#requireTransactionActor(
      transaction.request.actorId,
      transaction.request.requestedByUserId
    );
    let item = this.#findTransactionItem(actor, transaction);
    if (item) {
      const markers = this.#getTradeMarkerMap(item, "tradeTransactions");
      const marker = markers[transaction.transactionId];
      this.#assertNoConflictingMarker(marker, transaction, item);
      if (this.#itemMarkerMatches(marker, transaction, item, { applied: true })) return;
      if (marker) {
        throw new Error("Компенсированную покупку нельзя применить повторно.");
      }
    }

    if (transaction.item.created === true) {
      const itemData = sanitizeRawItemData(transaction.item.rawItemData);
      foundry.utils.setProperty(itemData, "system.quantity", transaction.item.afterQuantity);
      const markers = this.#getTradeMarkerMap(itemData, "tradeTransactions");
      markers[transaction.transactionId] = this.#buildItemMarker(
        transaction,
        { id: "", uuid: "" },
        { applied: true, phase: "applied" }
      );
      foundry.utils.setProperty(
        itemData,
        `flags.${MODULE_ID}.tradeTransactions`,
        this.#pruneTradeMarkerMap(markers, transaction.transactionId)
      );
      await actor.createEmbeddedDocuments("Item", [itemData]);
      return;
    }

    if (!item || item.parent?.id !== actor.id || item.uuid !== transaction.item.itemUuid) {
      throw new Error("Предмет покупки больше недоступен.");
    }
    const currentQuantity = Math.max(
      0,
      Math.floor(toNumber(foundry.utils.getProperty(item, "system.quantity"), 0))
    );
    if (currentQuantity !== transaction.item.beforeQuantity) {
      throw new Error("Количество предмета изменилось до применения покупки.");
    }

    const markers = this.#getTradeMarkerMap(item, "tradeTransactions");
    markers[transaction.transactionId] = this.#buildItemMarker(transaction, item, {
      applied: true,
      phase: "applied"
    });
    await item.update({
      "system.quantity": transaction.item.afterQuantity,
      [`flags.${MODULE_ID}.tradeTransactions`]: this.#pruneTradeMarkerMap(
        markers,
        transaction.transactionId
      )
    });
  }

  async #applyPurchaseCurrency(transaction) {
    const actor = this.#requireTransactionActor(
      transaction.request.actorId,
      transaction.request.requestedByUserId
    );
    const receipts = this.#getTradeMarkerMap(actor, "tradeReceipts");
    const receipt = receipts[transaction.transactionId];
    this.#assertNoConflictingReceipt(receipt, transaction);
    if (this.#currencyReceiptMatches(receipt, transaction, { applied: true })) return;
    if (receipt) {
      throw new Error("Компенсированную покупку нельзя списать повторно.");
    }

    const currentFunds = actorCurrencyToCopper(actor);
    if (currentFunds !== transaction.currency.beforeCopper) {
      throw new Error("Баланс персонажа изменился до списания покупки.");
    }
    receipts[transaction.transactionId] = this.#buildCurrencyReceipt(transaction, {
      applied: true,
      phase: "applied"
    });
    await actor.update({
      ...buildCurrencyUpdate(transaction.currency.afterCopper),
      [`flags.${MODULE_ID}.tradeReceipts`]: this.#pruneTradeMarkerMap(
        receipts,
        transaction.transactionId
      )
    });
  }

  async #readPurchaseReceipts(transaction) {
    const actor = this.#requireTransactionActor(
      transaction.request.actorId,
      transaction.request.requestedByUserId
    );
    const item = this.#findTransactionItem(actor, transaction);
    const marker = item
      ? this.#getTradeMarkerMap(item, "tradeTransactions")[transaction.transactionId]
      : null;
    const receipt = this.#getTradeMarkerMap(actor, "tradeReceipts")[transaction.transactionId];
    const itemApplied = Boolean(item)
      && this.#itemMarkerMatches(marker, transaction, item, { applied: true });
    const currencyApplied = this.#currencyReceiptMatches(receipt, transaction, { applied: true });
    return {
      itemApplied,
      currencyApplied,
      itemId: itemApplied ? item.id : "",
      itemUuid: itemApplied ? item.uuid : ""
    };
  }

  async #compensatePurchaseCurrency(transaction) {
    const actor = this.#requireTransactionActor(
      transaction.request.actorId,
      transaction.request.requestedByUserId
    );
    const receipts = this.#getTradeMarkerMap(actor, "tradeReceipts");
    const receipt = receipts[transaction.transactionId];
    this.#assertNoConflictingReceipt(receipt, transaction);
    if (!receipt || this.#currencyReceiptMatches(receipt, transaction, { applied: false })) return;

    const compensatedFunds = actorCurrencyToCopper(actor) - transaction.currency.deltaCopper;
    if (compensatedFunds < 0) {
      throw new Error("Компенсация монет привела бы к отрицательному балансу.");
    }
    receipts[transaction.transactionId] = this.#buildCurrencyReceipt(transaction, {
      applied: false,
      phase: "compensated"
    });
    await actor.update({
      ...buildCurrencyUpdate(compensatedFunds),
      [`flags.${MODULE_ID}.tradeReceipts`]: this.#pruneTradeMarkerMap(
        receipts,
        transaction.transactionId
      )
    });
  }

  async #compensatePurchaseItem(transaction) {
    const actor = this.#requireTransactionActor(
      transaction.request.actorId,
      transaction.request.requestedByUserId
    );
    const item = this.#findTransactionItem(actor, transaction);
    if (!item) return;

    const markers = this.#getTradeMarkerMap(item, "tradeTransactions");
    const marker = markers[transaction.transactionId];
    this.#assertNoConflictingMarker(marker, transaction, item);
    if (!marker || this.#itemMarkerMatches(marker, transaction, item, { applied: false })) return;

    const currentQuantity = Math.max(
      0,
      Math.floor(toNumber(foundry.utils.getProperty(item, "system.quantity"), 0))
    );
    if (currentQuantity < transaction.item.delta) {
      throw new Error("Количество предмета недостаточно для компенсации покупки.");
    }
    const remainder = currentQuantity - transaction.item.delta;
    if (transaction.item.created === true && remainder === 0) {
      await item.delete();
      return;
    }

    markers[transaction.transactionId] = this.#buildItemMarker(transaction, item, {
      applied: false,
      phase: "compensated"
    });
    await item.update({
      "system.quantity": remainder,
      [`flags.${MODULE_ID}.tradeTransactions`]: this.#pruneTradeMarkerMap(
        markers,
        transaction.transactionId
      )
    });
  }

  async #applySaleItem(transaction) {
    const actor = this.#requireTransactionActor(
      transaction.request.actorId,
      transaction.request.requestedByUserId
    );
    const item = this.#findTransactionItem(actor, transaction);
    if (!item || item.parent?.id !== actor.id || item.uuid !== transaction.item.itemUuid) {
      throw new Error("Предмет продажи больше недоступен.");
    }

    const markers = this.#getTradeMarkerMap(item, "tradeTransactions");
    const marker = markers[transaction.transactionId];
    this.#assertNoConflictingMarker(marker, transaction, item);
    if (this.#itemMarkerMatches(marker, transaction, item, { applied: true })) return;
    if (marker) {
      throw new Error("Компенсированную продажу нельзя применить повторно.");
    }

    const currentQuantity = Math.max(
      0,
      Math.floor(toNumber(foundry.utils.getProperty(item, "system.quantity"), 0))
    );
    if (currentQuantity !== transaction.item.beforeQuantity) {
      throw new Error("Количество предмета изменилось до применения продажи.");
    }
    markers[transaction.transactionId] = this.#buildItemMarker(transaction, item, {
      applied: true,
      phase: "applied"
    });
    await item.update({
      "system.quantity": transaction.item.afterQuantity,
      [`flags.${MODULE_ID}.tradeTransactions`]: this.#pruneTradeMarkerMap(
        markers,
        transaction.transactionId
      )
    });
  }

  async #applySaleCurrency(transaction) {
    const actor = this.#requireTransactionActor(
      transaction.request.actorId,
      transaction.request.requestedByUserId
    );
    const receipts = this.#getTradeMarkerMap(actor, "tradeReceipts");
    const receipt = receipts[transaction.transactionId];
    this.#assertNoConflictingReceipt(receipt, transaction);
    if (this.#currencyReceiptMatches(receipt, transaction, { applied: true })) return;
    if (receipt) {
      throw new Error("Компенсированную продажу нельзя выплатить повторно.");
    }

    const currentFunds = actorCurrencyToCopper(actor);
    if (currentFunds !== transaction.currency.beforeCopper) {
      throw new Error("Баланс персонажа изменился до выплаты продажи.");
    }
    receipts[transaction.transactionId] = this.#buildCurrencyReceipt(transaction, {
      applied: true,
      phase: "applied"
    });
    await actor.update({
      ...buildCurrencyUpdate(transaction.currency.afterCopper),
      [`flags.${MODULE_ID}.tradeReceipts`]: this.#pruneTradeMarkerMap(
        receipts,
        transaction.transactionId
      )
    });
  }

  async #readSaleReceipts(transaction) {
    const actor = this.#requireTransactionActor(
      transaction.request.actorId,
      transaction.request.requestedByUserId
    );
    const item = this.#findTransactionItem(actor, transaction);
    const marker = item
      ? this.#getTradeMarkerMap(item, "tradeTransactions")[transaction.transactionId]
      : null;
    const receipt = this.#getTradeMarkerMap(actor, "tradeReceipts")[transaction.transactionId];
    return {
      itemRemoved: Boolean(item)
        && this.#itemMarkerMatches(marker, transaction, item, { applied: true }),
      currencyApplied: this.#currencyReceiptMatches(receipt, transaction, { applied: true })
    };
  }

  async #compensateSaleCurrency(transaction) {
    const actor = this.#requireTransactionActor(
      transaction.request.actorId,
      transaction.request.requestedByUserId
    );
    const receipts = this.#getTradeMarkerMap(actor, "tradeReceipts");
    const receipt = receipts[transaction.transactionId];
    this.#assertNoConflictingReceipt(receipt, transaction);
    if (!receipt || this.#currencyReceiptMatches(receipt, transaction, { applied: false })) return;

    const compensatedFunds = actorCurrencyToCopper(actor) - transaction.currency.deltaCopper;
    if (compensatedFunds < 0) {
      throw new Error("У персонажа не хватает монет для отмены продажи.");
    }
    receipts[transaction.transactionId] = this.#buildCurrencyReceipt(transaction, {
      applied: false,
      phase: "compensated"
    });
    await actor.update({
      ...buildCurrencyUpdate(compensatedFunds),
      [`flags.${MODULE_ID}.tradeReceipts`]: this.#pruneTradeMarkerMap(
        receipts,
        transaction.transactionId
      )
    });
  }

  async #compensateSaleItem(transaction) {
    const actor = this.#requireTransactionActor(
      transaction.request.actorId,
      transaction.request.requestedByUserId
    );
    const item = this.#findTransactionItem(actor, transaction);
    if (!item) {
      const itemData = sanitizeRawItemData(transaction.item.rawItemData);
      foundry.utils.setProperty(itemData, "system.quantity", -transaction.item.delta);
      const markers = this.#getTradeMarkerMap(itemData, "tradeTransactions");
      markers[transaction.transactionId] = this.#buildRecreatedSaleMarker(transaction);
      foundry.utils.setProperty(
        itemData,
        `flags.${MODULE_ID}.tradeTransactions`,
        this.#pruneTradeMarkerMap(markers, transaction.transactionId)
      );
      await actor.createEmbeddedDocuments("Item", [itemData]);
      return;
    }

    const markers = this.#getTradeMarkerMap(item, "tradeTransactions");
    const marker = markers[transaction.transactionId];
    this.#assertNoConflictingMarker(marker, transaction, item);
    if (!marker || this.#itemMarkerMatches(marker, transaction, item, { applied: false })) return;

    const currentQuantity = Math.max(
      0,
      Math.floor(toNumber(foundry.utils.getProperty(item, "system.quantity"), 0))
    );
    const restoredQuantity = currentQuantity - transaction.item.delta;
    markers[transaction.transactionId] = this.#buildItemMarker(transaction, item, {
      applied: false,
      phase: "compensated"
    });
    await item.update({
      "system.quantity": restoredQuantity,
      [`flags.${MODULE_ID}.tradeTransactions`]: this.#pruneTradeMarkerMap(
        markers,
        transaction.transactionId
      )
    });
  }

  invalidatePackCache() {}

  isAvailable() {
    return true;
  }

  #getState() {
    if (this.stateRepository) {
      return this.stateRepository.read();
    }
    return normalizeTraderState(game.settings.get(MODULE_ID, SETTINGS_KEYS.TRADER_STATE));
  }

  async #setState(nextState) {
    if (this.stateRepository) {
      const normalized = normalizeTraderState(nextState);
      await this.stateRepository.mutate((state) => {
        for (const key of Object.keys(state)) {
          delete state[key];
        }
        Object.assign(state, cloneTraderState(normalized));
      });
      return normalized;
    }

    await game.settings.set(MODULE_ID, SETTINGS_KEYS.TRADER_STATE, nextState);
    return nextState;
  }

  async #writeState(mutator) {
    if (!game.user?.isGM) {
      throw new Error("Торговые операции может сохранять только ГМ.");
    }

    if (this.stateRepository) {
      return this.stateRepository.mutate(mutator);
    }

    const state = this.#getState();
    const result = await mutator(state);
    await this.#setState(state);
    return result;
  }

  async #recordTradeAudit(operation = {}) {
    if (typeof this.moduleApi?.recordTraderAudit !== "function") {
      return null;
    }

    try {
      return await this.moduleApi.recordTraderAudit(operation);
    }
    catch (error) {
      console.warn(`${MODULE_ID} | Failed to record trade audit.`, error);
      return null;
    }
  }

  #verifyAuditRecord(record) {
    const actor = record.actorId ? game.actors?.get?.(record.actorId) ?? null : null;
    if (!actor || !record.senderId) {
      return {
        ...record,
        verified: record.verified !== false && Boolean(actor)
      };
    }

    return {
      ...record,
      actorName: String(actor.name ?? record.actorName ?? "").trim(),
      verified: userOwnsActor(actor, record.senderId)
    };
  }

  #findAuditItem(actor, record) {
    const itemId = String(record.itemId ?? "").trim();
    if (itemId) {
      const byId = actor.items?.get?.(itemId) ?? null;
      if (byId) {
        return byId;
      }
    }

    const sourceType = String(record.sourceType ?? "").trim();
    const sourceId = String(record.sourceId ?? "").trim();
    const itemName = normalizeText(record.itemName);
    return actor.items?.contents?.find?.((item) => {
      if (sourceType && sourceId) {
        const itemSourceType = item.getFlag?.(MODULE_ID, "sourceType");
        const itemSourceId = item.getFlag?.(MODULE_ID, "sourceId");
        if (itemSourceType === sourceType && itemSourceId === sourceId) {
          return true;
        }
      }

      return itemName && normalizeText(item.name) === itemName;
    }) ?? null;
  }

  async #rollbackPurchase(record, actor) {
    const quantity = Math.max(1, Math.floor(toNumber(record.quantity, 1)));
    const item = this.#findAuditItem(actor, record);
    if (!item) {
      throw new Error("Предмет покупки больше не найден у персонажа.");
    }

    const currentQuantity = getRawQuantity(item.toObject());
    if (currentQuantity < quantity) {
      throw new Error("У персонажа уже нет нужного количества предмета для отката.");
    }

    if (currentQuantity <= quantity) {
      await item.delete();
    }
    else {
      await item.update({
        "system.quantity": currentQuantity - quantity
      });
    }

    const refundCopper = Math.max(0, Math.round(toNumber(record.totalPriceCopper, record.totalCopper)));
    await actor.update(buildCurrencyUpdate(actorCurrencyToCopper(actor) + refundCopper));
  }

  async #rollbackSale(record, actor) {
    const quantity = Math.max(1, Math.floor(toNumber(record.quantity, 1)));
    const payoutCopper = Math.max(0, Math.round(toNumber(record.netPayoutCopper, record.totalCopper)));
    const currentFundsCopper = actorCurrencyToCopper(actor);
    if (currentFundsCopper < payoutCopper) {
      throw new Error("У персонажа не хватает монет, чтобы откатить продажу.");
    }

    await actor.update(buildCurrencyUpdate(currentFundsCopper - payoutCopper));

    const existingItem = this.#findAuditItem(actor, record);
    if (existingItem) {
      const nextQuantity = getRawQuantity(existingItem.toObject()) + quantity;
      await existingItem.update({
        "system.quantity": nextQuantity
      });
      return;
    }

    const itemData = record.rawItemData
      ? sanitizeRawItemData(record.rawItemData)
      : {
          name: record.itemName || "Возвращённый предмет",
          type: "loot",
          img: "icons/svg/item-bag.svg",
          system: {
            quantity
          },
          flags: {
            [MODULE_ID]: {
              sourceType: record.sourceType,
              sourceId: record.sourceId
            }
          }
        };
    foundry.utils.setProperty(itemData, "system.quantity", quantity);
    await actor.createEmbeddedDocuments("Item", [itemData]);
  }

  getTradeAuditLog() {
    return this.#getState()
      .tradeLog
      .slice()
      .sort((left, right) => toNumber(right.createdAt, 0) - toNumber(left.createdAt, 0))
      .slice(0, TRADE_AUDIT_LIMIT)
      .map((record) => buildAuditViewRecord(record));
  }

  async recordTradeAudit(operation = {}, { senderId = "" } = {}) {
    if (!game.user?.isGM) {
      return null;
    }

    return this.#writeState((state) => {
      const record = this.#verifyAuditRecord(normalizeTradeAuditRecord(operation, { senderId }));
      state.tradeLog = retainTradeLog(
        [record, ...(state.tradeLog ?? []).filter((entry) => entry.id !== record.id)],
        { terminalLimit: TRADE_AUDIT_LIMIT }
      );
      return buildAuditViewRecord(foundry.utils.deepClone(record));
    });
  }

  async rollbackTradeAuditEntry(entryId) {
    if (!game.user?.isGM) {
      throw new Error("Откат торговых операций доступен только мастеру.");
    }

    const safeEntryId = String(entryId ?? "").trim();
    if (!safeEntryId) {
      throw new Error("Операция торговли не найдена.");
    }

    return this.#writeState(async (state) => {
      const record = (state.tradeLog ?? []).find((entry) => entry.id === safeEntryId) ?? null;
      if (!record) {
        throw new Error("Операция торговли не найдена.");
      }

      if (record.rolledBack === true) {
        throw new Error("Эта операция уже откачена.");
      }

      if (record.verified === false) {
        throw new Error("Операция не подтверждена владельцем персонажа.");
      }

      const actor = game.actors?.get?.(record.actorId) ?? null;
      if (!actor) {
        throw new Error("Персонаж операции не найден.");
      }

      if (record.type === "sale") {
        await this.#rollbackSale(record, actor);
      }
      else {
        await this.#rollbackPurchase(record, actor);
      }

      record.rolledBack = true;
      record.rolledBackAt = Date.now();
      record.rolledBackByUserId = game.user?.id ?? "";
      return buildAuditViewRecord(foundry.utils.deepClone(record));
    });
  }

  async resetState() {
    if (!game.user?.isGM) {
      return 0;
    }

    await this.#setState(createEmptyTraderState());
    return 0;
  }

  async resetAssortments() {
    if (!game.user?.isGM) {
      return {
        refreshedTraderCount: 0,
        removedTraderCount: 0
      };
    }

    const model = await this.moduleApi.getModel();
    return this.#writeState(async (state) => {
      const sourceTraders = Object.entries(state.traders ?? {});
      const nextTraders = {};
      let refreshedTraderCount = 0;
      let removedTraderCount = 0;
      const now = Date.now();
      const seedSalt = getTraderSeedSalt(this.moduleApi);

      for (const [traderId, traderState] of sourceTraders) {
        const cityId = String(traderState?.cityId ?? "");
        const traderKey = String(traderState?.traderKey ?? "");
        const citySnapshot = this.moduleApi.getCitySnapshot(cityId);
        if (!citySnapshot) {
          removedTraderCount += 1;
          continue;
        }

        const plan = getTraderPlanByKey(model, citySnapshot, traderKey, { seedSalt });
        if (!plan) {
          removedTraderCount += 1;
          continue;
        }

        const openedAt = Math.max(0, Math.floor(toNumber(traderState?.openedAt, now)));
        const refreshedState = createStateFromPlan(citySnapshot, plan, {
          moduleApi: this.moduleApi,
          model,
          assortmentSeedSalt: seedSalt,
          assortmentStatus: "updated",
          assortmentUpdatedAt: now
        });
        const resolvedRestockMode = mergeRestockModes(
          traderState?.restockMode ?? TRADER_RESTOCK_MODES.DEFAULT,
          refreshedState?.restockMode ?? TRADER_RESTOCK_MODES.DEFAULT
        );
        const nextInventory = applyRestockModeToInventory(
          traderState?.inventory ?? [],
          refreshedState.inventory,
          resolvedRestockMode
        );
        const nextAssortmentStatus = getAssortmentStatusByRestockMode(resolvedRestockMode);

        nextTraders[traderId] = {
          ...traderState,
          traderId,
          cityId: citySnapshot.id,
          traderKey: plan.traderKey,
          traderType: plan.traderType,
          planSignature: refreshedState.planSignature,
          portrait: String(traderState?.portrait ?? ""),
          description: String(traderState?.description ?? ""),
          openedAt,
          updatedAt: now,
          assortmentSeedSalt: refreshedState.assortmentSeedSalt,
          assortmentStatus: nextAssortmentStatus,
          assortmentUpdatedAt: refreshedState.assortmentUpdatedAt,
          restockMode: resolvedRestockMode,
          inventory: nextInventory
        };
        refreshedTraderCount += 1;
      }

      const nextOrder = [];
      const orderedIds = Array.isArray(state.order) ? state.order : [];
      const seen = new Set();
      for (const traderId of orderedIds) {
        if (!nextTraders[traderId] || seen.has(traderId)) {
          continue;
        }

        seen.add(traderId);
        nextOrder.push(traderId);
      }

      for (const traderId of Object.keys(nextTraders)) {
        if (seen.has(traderId)) {
          continue;
        }

        seen.add(traderId);
        nextOrder.push(traderId);
      }

      while (nextOrder.length > MAX_ACTIVE_TRADERS) {
        const staleTraderId = nextOrder.pop();
        if (staleTraderId && nextTraders[staleTraderId]) {
          delete nextTraders[staleTraderId];
          removedTraderCount += 1;
        }
      }

      state.traders = nextTraders;
      state.order = nextOrder;

      return {
        refreshedTraderCount,
        removedTraderCount
      };
    });
  }

  async cleanupLegacyManagedTraders() {
    if (!game.user?.isGM) {
      return 0;
    }

    const actors = game.actors.contents.filter((actor) => actor.getFlag(MODULE_ID, "managedTrader"));
    if (!actors.length) {
      return 0;
    }

    await Actor.deleteDocuments(actors.map((actor) => actor.id));
    return actors.length;
  }

  async #ensureTraderState(citySnapshot, traderKey) {
    const model = await this.moduleApi.getModel();
    const seedSalt = getTraderSeedSalt(this.moduleApi);
    const plan = getTraderPlanByKey(model, citySnapshot, traderKey, { seedSalt });
    if (!plan) {
      throw new Error(`Trader '${traderKey}' was not found for city '${citySnapshot.id}'.`);
    }

    return this.#writeState(async (state) => {
      const traderId = getTraderStateKey(citySnapshot.id, traderKey);
      let traderState = state.traders[traderId];
      const expectedPlanSignature = buildPlanSignature(plan);
      if (!traderState) {
        traderState = createStateFromPlan(citySnapshot, plan, {
          moduleApi: this.moduleApi,
          model,
          assortmentSeedSalt: seedSalt
        });
        state.traders[traderId] = traderState;
      }
      else {
        const currentPlanSignature = String(traderState.planSignature ?? "");
        if (currentPlanSignature !== expectedPlanSignature) {
          const preservedPortrait = String(traderState.portrait ?? "");
          const preservedDescription = String(traderState.description ?? "");
          const preservedOpenedAt = Math.max(0, Math.floor(toNumber(traderState.openedAt, Date.now())));
          const refreshedState = createStateFromPlan(citySnapshot, plan, {
            moduleApi: this.moduleApi,
            model,
            assortmentSeedSalt: seedSalt,
            assortmentStatus: "updated"
          });
          const resolvedRestockMode = mergeRestockModes(
            traderState?.restockMode ?? TRADER_RESTOCK_MODES.DEFAULT,
            refreshedState?.restockMode ?? TRADER_RESTOCK_MODES.DEFAULT
          );
          const nextInventory = applyRestockModeToInventory(
            traderState?.inventory ?? [],
            refreshedState.inventory,
            resolvedRestockMode
          );
          traderState = {
            ...refreshedState,
            traderId,
            openedAt: preservedOpenedAt,
            portrait: preservedPortrait,
            description: preservedDescription,
            restockMode: resolvedRestockMode,
            assortmentStatus: getAssortmentStatusByRestockMode(resolvedRestockMode),
            inventory: nextInventory
          };
          state.traders[traderId] = traderState;
        }
        else {
          traderState.portrait = String(traderState.portrait ?? "");
          traderState.description = String(traderState.description ?? "");
          traderState.planSignature = expectedPlanSignature;
          traderState.assortmentSeedSalt = String(traderState.assortmentSeedSalt ?? seedSalt).trim();
          traderState.assortmentStatus = String(traderState.assortmentStatus ?? "saved").trim() || "saved";
          traderState.restockMode = normalizeRestockMode(traderState.restockMode ?? TRADER_RESTOCK_MODES.DEFAULT);
          traderState.assortmentUpdatedAt = Math.max(
            0,
            Math.floor(toNumber(traderState.assortmentUpdatedAt, traderState.updatedAt ?? Date.now()))
          );
        }
      }

      traderState.updatedAt = Date.now();
      state.order = [traderId, ...state.order.filter((entry) => entry !== traderId)];

      while (state.order.length > MAX_ACTIVE_TRADERS) {
        const staleTraderId = state.order.pop();
        if (staleTraderId) {
          delete state.traders[staleTraderId];
        }
      }

      return foundry.utils.deepClone(traderState);
    });
  }

  #resolveItemMetadata(model, stockEntry) {
    if (stockEntry.sourceType === "material") {
      const material = model.materialById?.get(stockEntry.sourceId) ?? null;
      return {
        description: material?.description ?? stockEntry.description ?? "",
        itemTypeLabel: material?.type ?? stockEntry.itemTypeLabel ?? "Материал",
        subtypeLabel: material?.subtype ?? "",
        basePriceGold: Math.max(MIN_PRICE_GOLD, toNumber(material?.priceGold, stockEntry.basePriceGold)),
        baseWeight: toNumber(material?.weight, stockEntry.baseWeight),
        rank: Math.max(0, Math.round(toNumber(material?.rank, stockEntry.rank))),
        predominantMaterialId: material?.id ?? stockEntry.predominantMaterialId ?? null,
        predominantMaterialName: material?.name ?? stockEntry.predominantMaterialName ?? "",
        linkedGoodId: material?.linkedGoodId ?? stockEntry.linkedGoodId ?? null,
        materialLabel: material?.name ?? stockEntry.predominantMaterialName ?? "",
        img: stockEntry.img || MATERIAL_TRADER_ICON,
        linkedTool: stockEntry.linkedTool ?? ""
      };
    }

    if (stockEntry.sourceType === "gear") {
      const gearItem = model.gearById?.get(stockEntry.sourceId) ?? null;
      return {
        description: gearItem?.description ?? stockEntry.description ?? "",
        itemTypeLabel: gearItem?.equipmentType ?? stockEntry.itemTypeLabel ?? "Снаряжение",
        subtypeLabel: gearItem?.equipmentType ?? "",
        basePriceGold: Math.max(MIN_PRICE_GOLD, getGearBasePriceGold(gearItem ?? stockEntry)),
        baseWeight: toNumber(gearItem?.weight, stockEntry.baseWeight),
        rank: Math.max(0, Math.round(toNumber(gearItem?.rank, stockEntry.rank))),
        predominantMaterialId: gearItem?.predominantMaterialId ?? stockEntry.predominantMaterialId ?? null,
        predominantMaterialName: gearItem?.predominantMaterialName ?? stockEntry.predominantMaterialName ?? "",
        linkedGoodId: stockEntry.linkedGoodId ?? null,
        materialLabel: gearItem?.predominantMaterialName ?? stockEntry.predominantMaterialName ?? "",
        img: stockEntry.img || GENERAL_TRADER_ICON,
        linkedTool: gearItem?.linkedTool ?? stockEntry.linkedTool ?? ""
      };
    }

    if (stockEntry.sourceType === "magicItem") {
      return {
        description: stockEntry.description ?? "",
        itemTypeLabel: stockEntry.itemTypeLabel ?? "Магический предмет",
        subtypeLabel: stockEntry.itemTypeLabel ?? "Магический предмет",
        basePriceGold: Math.max(MIN_PRICE_GOLD, toNumber(stockEntry.basePriceGold, MIN_PRICE_GOLD)),
        baseWeight: toNumber(stockEntry.baseWeight, 0),
        rank: Math.max(0, Math.round(toNumber(stockEntry.rank, 0))),
        predominantMaterialId: stockEntry.predominantMaterialId ?? null,
        predominantMaterialName: stockEntry.predominantMaterialName ?? "",
        linkedGoodId: stockEntry.linkedGoodId ?? null,
        materialLabel: stockEntry.predominantMaterialName ?? "",
        img: stockEntry.img || MAGIC_TRADER_ICON,
        linkedTool: stockEntry.linkedTool ?? "",
        rarity: stockEntry.rarity ?? ""
      };
    }

    return {
      description: stockEntry.description ?? "",
      itemTypeLabel: stockEntry.itemTypeLabel ?? "Предмет",
      subtypeLabel: stockEntry.itemTypeLabel ?? "",
      basePriceGold: Math.max(MIN_PRICE_GOLD, toNumber(stockEntry.basePriceGold, MIN_PRICE_GOLD)),
      baseWeight: toNumber(stockEntry.baseWeight, 0),
      rank: Math.max(0, Math.round(toNumber(stockEntry.rank, 0))),
      predominantMaterialId: stockEntry.predominantMaterialId ?? null,
      predominantMaterialName: stockEntry.predominantMaterialName ?? "",
      linkedGoodId: stockEntry.linkedGoodId ?? null,
      materialLabel: stockEntry.predominantMaterialName ?? "",
      img: stockEntry.img || GENERAL_TRADER_ICON,
      linkedTool: stockEntry.linkedTool ?? "",
      rarity: stockEntry.rarity ?? ""
    };
  }

  #getModifierPercent(model, citySnapshot, stockEntry, resolvedMetadata) {
    if (stockEntry.sourceType === "material") {
      const material = model.materialById?.get(stockEntry.sourceId) ?? null;
      return getMaterialPriceModifier(model, citySnapshot, material ?? {
        id: stockEntry.sourceId,
        linkedGoodId: resolvedMetadata.linkedGoodId
      });
    }

    if (stockEntry.sourceType === "gear") {
      const gearItem = model.gearById?.get(stockEntry.sourceId) ?? null;
      return getGearPriceModifier(model, citySnapshot, gearItem ?? resolvedMetadata);
    }

    if (stockEntry.sourceType === "magicItem") {
      return 0;
    }

    const material = resolvedMetadata.predominantMaterialId
      ? model.materialById?.get(resolvedMetadata.predominantMaterialId) ?? null
      : null;

    if (!material) {
      return 0;
    }

    const materialModifier = getMaterialPriceModifier(model, citySnapshot, material);
    return materialModifier > 0 ? materialModifier : materialModifier / 2;
  }

  async #resolveInventoryEntryIcon(model, stockEntry, resolvedMetadata) {
    const fallbackIcon = getInventoryEntryIcon({ ...stockEntry, ...resolvedMetadata });
    if (stockEntry.sourceType !== "gear") {
      return fallbackIcon;
    }

    const explicitIcon = String(stockEntry.img ?? resolvedMetadata.img ?? "").trim();
    if (explicitIcon && explicitIcon !== GENERAL_TRADER_ICON) {
      return explicitIcon;
    }

    const gearItem = model.gearById?.get(stockEntry.sourceId) ?? null;
    if (!gearItem) {
      return fallbackIcon;
    }

    const iconLookup = await getTraderGearIconLookup(this.moduleApi);
    return resolveGearItemIcon(gearItem, { iconLookup });
  }

  async #buildInventoryViewEntry(model, citySnapshot, statePolicy, traderType, stockEntry) {
    const resolvedMetadata = this.#resolveItemMetadata(model, stockEntry);
    const goodId = resolveGoodIdForStockEntry(model, stockEntry, resolvedMetadata);
    const linkedGoodRow = goodId
      ? citySnapshot?.goodsRowById?.[goodId] ?? null
      : null;
    const merchantModifiers = this.moduleApi.globalEventsService?.collectMerchantModifiers?.({
      model,
      cityId: citySnapshot.id,
      goodId: goodId ?? "",
      itemCategory: resolvedMetadata.itemTypeLabel ?? stockEntry.sourceType,
      traderType
    }) ?? {
      buyPricePercent: 0,
      sellPricePercent: 0,
      stockPercent: 0,
      blocked: false,
      rarityShift: 0,
      restockMode: "",
      sourceEventNames: []
    };
    const baseModifierPercent = this.#getModifierPercent(model, citySnapshot, stockEntry, resolvedMetadata);
    const dutyModifierPercent = getDutyModifierPercentForGood(
      model,
      citySnapshot,
      statePolicy,
      goodId ?? resolvedMetadata.linkedGoodId
    );
    const merchantModifierPercent = toNumber(merchantModifiers.sellPricePercent, 0);
    const modifierPercent = baseModifierPercent + merchantModifierPercent + dutyModifierPercent;
    const importMarkupPercent = toNumber(linkedGoodRow?.routePriceModifierPercent, 0);
    const eventPriceModifierPercent = toNumber(linkedGoodRow?.eventPriceModifierPercent, 0);
    const goodEventSourceNames = uniqueStrings(linkedGoodRow?.eventSourceNames ?? []);
    const markupTooltip = buildMarkupTooltip({
      totalModifierPercent: modifierPercent,
      importMarkupPercent,
      eventPriceModifierPercent,
      goodEventSourceNames,
      dutyModifierPercent,
      merchantModifierPercent,
      merchantEventSourceNames: merchantModifiers.sourceEventNames ?? []
    });
    const pricing = applyMarketPrice(
      resolvedMetadata.basePriceGold,
      modifierPercent,
      resolvedMetadata.baseWeight
    );
    const finalPriceCopper = goldToCopper(pricing.finalPriceGold);
    const icon = await this.#resolveInventoryEntryIcon(model, stockEntry, resolvedMetadata);

    return {
      ...stockEntry,
      img: icon,
      description: resolvedMetadata.description,
      itemTypeLabel: resolvedMetadata.itemTypeLabel,
      subtypeLabel: resolvedMetadata.subtypeLabel,
      basePriceGold: resolvedMetadata.basePriceGold,
      baseWeight: resolvedMetadata.baseWeight,
      rank: resolvedMetadata.rank,
      predominantMaterialId: resolvedMetadata.predominantMaterialId,
      predominantMaterialName: resolvedMetadata.predominantMaterialName,
      materialLabel: resolvedMetadata.materialLabel,
      rarity: resolvedMetadata.rarity ?? stockEntry.rarity ?? "",
      shopSubtype: stockEntry.shopSubtype ?? "",
      linkedGoodId: goodId ?? resolvedMetadata.linkedGoodId,
      linkedTool: resolvedMetadata.linkedTool,
      baseModifierPercent,
      importMarkupPercent,
      eventPriceModifierPercent,
      goodEventSourceNames,
      dutyModifierPercent,
      merchantModifierPercent,
      merchantBuyModifierPercent: toNumber(merchantModifiers.buyPricePercent, 0),
      merchantStockPercent: toNumber(merchantModifiers.stockPercent, 0),
      blockedByEvents: merchantModifiers.blocked === true || stockEntry.blockedByEvents === true,
      eventSourceNames: uniqueStrings([
        ...(stockEntry.eventSourceNames ?? []),
        ...(merchantModifiers.sourceEventNames ?? [])
      ]),
      modifierPercent,
      modifierLabel: formatSignedPercent(modifierPercent, 1),
      modifierClass: modifierPercent > 0 ? "rm-negative" : (modifierPercent < 0 ? "rm-positive" : ""),
      markupTooltip,
      finalWeight: pricing.finalWeight,
      weightAdjusted: pricing.weightAdjusted,
      traderType,
      canOpenEntry: stockEntry.sourceType === "material" || stockEntry.sourceType === "gear" || stockEntry.sourceType === "magicItem",
      ...buildPricePresentation(finalPriceCopper)
    };
  }

  async getCityTraderSummaries(cityId) {
    const model = await this.moduleApi.getModel();
    const citySnapshot = this.moduleApi.getCitySnapshot(cityId);
    if (!citySnapshot) {
      return [];
    }

    const state = this.#getState();
    const seedSalt = getTraderSeedSalt(this.moduleApi);
    return buildCityTraderPlans(model, citySnapshot, { seedSalt }).map((plan) => {
      const traderId = getTraderStateKey(cityId, plan.traderKey);
      const traderState = state.traders[traderId] ?? null;
      const expectedPlanSignature = buildPlanSignature(plan);
      const isSignatureCurrent = Boolean(traderState && String(traderState.planSignature ?? "") === expectedPlanSignature);
      const inventory = (traderState && isSignatureCurrent) ? traderState.inventory : createStateFromPlan(citySnapshot, plan, {
        moduleApi: this.moduleApi,
        model,
        assortmentSeedSalt: seedSalt
      }).inventory;
      const totalQuantity = inventory.reduce((sum, item) => sum + Math.max(0, Math.floor(toNumber(item.quantity, 0))), 0);
      const isMonthlyFresh = Boolean(
        traderState
        && String(traderState.assortmentSeedSalt ?? "").trim() === seedSalt
      );
      const assortmentStatus = String(traderState?.assortmentStatus ?? "").trim().toLowerCase();
      const statusLabel = !traderState
        ? "Готов к открытию"
        : (
          assortmentStatus === "frozen"
            ? "Ассортимент заморожен ивентом"
            : (
              assortmentStatus === "merged"
                ? "Ассортимент частично обновлён"
                : (isMonthlyFresh ? "Ассортимент был обновлён" : "Ассортимент сохранён")
            )
        );
      const statusClass = !traderState
        ? ""
        : (
          assortmentStatus === "frozen"
            ? "rm-badge--warn"
            : (
              assortmentStatus === "merged"
                ? "rm-badge--warn"
                : (isMonthlyFresh ? "rm-badge--updated" : "rm-badge--good")
            )
        );

      return {
        traderKey: plan.traderKey,
        traderType: plan.traderType,
        traderIndex: plan.traderIndex,
        name: plan.name,
        roleLabel: plan.roleLabel,
        merchantName: plan.merchantName ?? plan.roleLabel ?? "",
        merchantRole: plan.merchantRole ?? "",
        shopSubtype: plan.shopSubtype ?? plan.name ?? "",
        portrait: String(traderState?.portrait ?? ""),
        totalDistinctItems: inventory.filter((item) => toNumber(item.quantity, 0) > 0).length,
        totalQuantity,
        totalTraderValue: plan.targetTraderValue,
        targetTraderValue: plan.targetTraderValue,
        cityRank: citySnapshot.rank,
        statusLabel,
        statusClass
      };
    });
  }

  async getTraderSnapshot(cityId, traderKey, { actorId = null } = {}) {
    const model = await this.moduleApi.getModel();
    const citySnapshot = this.moduleApi.getCitySnapshot(cityId);
    if (!citySnapshot) {
      throw new Error(`City '${cityId}' was not found.`);
    }

    const seedSalt = getTraderSeedSalt(this.moduleApi);
    const plan = getTraderPlanByKey(model, citySnapshot, traderKey, { seedSalt });
    if (!plan) {
      throw new Error(`Trader '${traderKey}' was not found for city '${cityId}'.`);
    }

    const traderId = getTraderStateKey(cityId, traderKey);
    let traderState = this.#getState().traders[traderId] ?? null;
    const expectedPlanSignature = buildPlanSignature(plan);
    const isSignatureCurrent = Boolean(traderState && String(traderState.planSignature ?? "") === expectedPlanSignature);
    if (( !traderState || !isSignatureCurrent ) && game.user?.isGM) {
      traderState = await this.#ensureTraderState(citySnapshot, traderKey);
    }
    if (!traderState) {
      traderState = createStateFromPlan(citySnapshot, plan, {
        moduleApi: this.moduleApi,
        model,
        assortmentSeedSalt: seedSalt
      });
    }

    const partyInventoryActor = await this.moduleApi.inventoryService?.getInventoryActor?.({
      create: game.user?.isGM === true
    }) ?? null;
    const customerActor = resolveActorByPreference(actorId, {
      preferredActor: partyInventoryActor
    });
    const statePolicy = getStatePolicyByCity(this.moduleApi, citySnapshot);
    const inventory = (await Promise.all(
      (traderState.inventory ?? [])
        .filter((entry) => toNumber(entry.quantity, 0) > 0)
        .map((entry) => this.#buildInventoryViewEntry(model, citySnapshot, statePolicy, plan.traderType, entry))
    ))
      .filter((entry) => entry.blockedByEvents !== true)
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));

    return {
      traderId: traderState.traderId,
      cityId,
      traderKey,
      traderType: plan.traderType,
      cityName: citySnapshot.name,
      cityState: citySnapshot.state,
      cityRegion: citySnapshot.regionName,
      cityRank: citySnapshot.rank,
      name: plan.name,
      roleLabel: plan.roleLabel,
      merchantName: plan.merchantName ?? plan.roleLabel ?? "",
      merchantRole: plan.merchantRole ?? "",
      shopSubtype: plan.shopSubtype ?? plan.name ?? "",
      description: String(traderState.description ?? ""),
      portrait: String(traderState.portrait ?? ""),
      img: String(traderState.portrait ?? ""),
      inventory,
      inventoryCount: inventory.length,
      totalQuantity: inventory.reduce((sum, item) => sum + toNumber(item.quantity, 0), 0),
      totalCustomerFundsCopper: customerActor ? actorCurrencyToCopper(customerActor) : 0,
      customer: customerActor ? {
        id: customerActor.id,
        name: customerActor.name,
        img: customerActor.img,
        currencyLabel: formatCopper(actorCurrencyToCopper(customerActor))
      } : null,
      partyInventoryActorId: partyInventoryActor?.id ?? null,
      customerOptions: buildCustomerOptions(customerActor?.id ?? null, {
        partyInventoryActorId: partyInventoryActor?.id ?? null
      }),
      taxPercent: toNumber(statePolicy.taxPercent, 0),
      taxLabel: formatPercent(toNumber(statePolicy.taxPercent, 0), 1),
      taxEventSourceNames: uniqueStrings(statePolicy?.eventDelta?.sourceEventNames ?? []),
      canTrade: game.user?.isGM === true || Boolean(customerActor),
      expectedTraderCount: getExpectedTraderCount(citySnapshot),
      cityEventNames: uniqueStrings(citySnapshot?.activeEventNames ?? [])
    };
  }

  async updateTraderMetadata(cityId, traderKey, patch = {}) {
    const model = await this.moduleApi.getModel();
    const citySnapshot = this.moduleApi.getCitySnapshot(cityId);
    if (!citySnapshot) {
      throw new Error("Город не найден.");
    }

    const seedSalt = getTraderSeedSalt(this.moduleApi);
    const plan = getTraderPlanByKey(model, citySnapshot, traderKey, { seedSalt });
    if (!plan) {
      throw new Error("Торговец не найден.");
    }

    return this.#writeState(async (state) => {
      const traderId = getTraderStateKey(cityId, traderKey);
      let traderState = state.traders[traderId];
      const expectedPlanSignature = buildPlanSignature(plan);
      if (!traderState) {
        traderState = createStateFromPlan(citySnapshot, plan, {
          moduleApi: this.moduleApi,
          model,
          assortmentSeedSalt: seedSalt
        });
        state.traders[traderId] = traderState;
      }

      traderState.portrait = String(patch.portrait ?? traderState.portrait ?? "").trim();
      traderState.description = String(patch.description ?? traderState.description ?? "");
      traderState.planSignature = expectedPlanSignature;
      traderState.assortmentSeedSalt = String(traderState.assortmentSeedSalt ?? seedSalt).trim();
      traderState.assortmentStatus = String(traderState.assortmentStatus ?? "saved").trim() || "saved";
      traderState.assortmentUpdatedAt = Math.max(
        0,
        Math.floor(toNumber(traderState.assortmentUpdatedAt, traderState.updatedAt ?? Date.now()))
      );
      traderState.updatedAt = Date.now();
      state.order = [traderId, ...state.order.filter((entry) => entry !== traderId)];
      return foundry.utils.deepClone(traderState);
    });
  }

  #requireTransactionActor(actorId, requestedByUserId = "") {
    const safeActorId = String(actorId ?? "").trim();
    const actor = safeActorId ? game.actors?.get?.(safeActorId) ?? null : null;
    if (!actor?.isOwner) {
      throw new Error("Персонаж для торговой операции недоступен.");
    }
    assertUserCanTradeActor(actor, requestedByUserId);
    return actor;
  }

  async #buildPurchasedItemData(inventoryItem, purchaseQuantity) {
    let purchasedItemData = inventoryItem.sourceType === "custom" && inventoryItem.rawItemData
      ? sanitizeRawItemData(inventoryItem.rawItemData)
      : buildCanonicalItemData(inventoryItem, purchaseQuantity, inventoryItem.finalPriceCopper);

    if (inventoryItem.sourceType === "magicItem") {
      const magicDocument = await this.moduleApi.magicItemsCompendium?.getMagicItemDocument?.(
        inventoryItem.sourceId,
        inventoryItem.name
      );
      if (magicDocument) {
        purchasedItemData = sanitizeRawItemData(magicDocument.toObject());
      }
    }

    const sourcePackQuantity = Math.max(
      1,
      Math.floor(toNumber(foundry.utils.getProperty(
        purchasedItemData,
        `flags.${MODULE_ID}.sourcePackQuantity`
      ), 1))
    );
    const actorPurchaseQuantity = purchaseQuantity * sourcePackQuantity;
    const actorBasePriceGold = sourcePackQuantity > 1
      ? roundNumber(toNumber(inventoryItem.basePriceGold, 0) / sourcePackQuantity, 6)
      : inventoryItem.basePriceGold;

    foundry.utils.setProperty(purchasedItemData, "system.quantity", actorPurchaseQuantity);
    foundry.utils.setProperty(purchasedItemData, `flags.${MODULE_ID}.sourceType`, inventoryItem.sourceType);
    foundry.utils.setProperty(purchasedItemData, `flags.${MODULE_ID}.sourceId`, inventoryItem.sourceId);
    foundry.utils.setProperty(purchasedItemData, `flags.${MODULE_ID}.basePriceGold`, actorBasePriceGold);
    foundry.utils.setProperty(purchasedItemData, `flags.${MODULE_ID}.priceGoldEquivalent`, actorBasePriceGold);
    if (sourcePackQuantity > 1) {
      foundry.utils.setProperty(
        purchasedItemData,
        `flags.${MODULE_ID}.sourcePackPriceGoldEquivalent`,
        inventoryItem.basePriceGold
      );
      foundry.utils.setProperty(
        purchasedItemData,
        `flags.${MODULE_ID}.sourcePackWeight`,
        inventoryItem.baseWeight
      );
    }
    foundry.utils.setProperty(
      purchasedItemData,
      `flags.${MODULE_ID}.predominantMaterialId`,
      inventoryItem.predominantMaterialId ?? null
    );
    foundry.utils.setProperty(
      purchasedItemData,
      `flags.${MODULE_ID}.linkedGoodId`,
      inventoryItem.linkedGoodId ?? null
    );
    foundry.utils.setProperty(
      purchasedItemData,
      `flags.${MODULE_ID}.materialId`,
      inventoryItem.sourceType === "material" ? inventoryItem.sourceId : null
    );
    foundry.utils.setProperty(
      purchasedItemData,
      `flags.${MODULE_ID}.gearId`,
      inventoryItem.sourceType === "gear" ? inventoryItem.sourceId : null
    );

    return {
      actorPurchaseQuantity,
      purchasedItemData: sanitizeRawItemData(purchasedItemData)
    };
  }

  async #preparePurchase(request, _context = {}) {
    const buyer = this.#requireTransactionActor(request?.actorId, request?.requestedByUserId);
    const purchaseQuantity = Number(request?.quantity);
    if (!Number.isInteger(purchaseQuantity) || purchaseQuantity < 1) {
      throw new Error("Количество товара для покупки указано неверно.");
    }

    const snapshot = await this.getTraderSnapshot(request.cityId, request.traderKey, {
      actorId: buyer.id,
      persistState: false
    });
    const inventoryItem = snapshot.inventory.find((entry) => entry.itemKey === request.itemKey);
    if (!inventoryItem) {
      throw new Error("Товар больше недоступен у торговца.");
    }
    if (purchaseQuantity > inventoryItem.quantity) {
      throw new Error("У торговца нет такого количества товара.");
    }

    const totalPriceCopper = inventoryItem.finalPriceCopper * purchaseQuantity;
    const currentFundsCopper = actorCurrencyToCopper(buyer);
    if (currentFundsCopper < totalPriceCopper) {
      throw new Error("У персонажа не хватает монет на покупку.");
    }

    const { actorPurchaseQuantity, purchasedItemData } = await this.#buildPurchasedItemData(
      inventoryItem,
      purchaseQuantity
    );
    const matchItem = buyer.items?.contents?.find?.((item) => (
      item.getFlag?.(MODULE_ID, "sourceType") === inventoryItem.sourceType
      && item.getFlag?.(MODULE_ID, "sourceId") === inventoryItem.sourceId
    )) ?? null;
    const itemQuantityBefore = matchItem
      ? Math.max(0, Math.floor(toNumber(foundry.utils.getProperty(matchItem, "system.quantity"), 0)))
      : 0;
    const itemQuantityAfter = itemQuantityBefore + actorPurchaseQuantity;

    return {
      traderId: snapshot.traderId,
      stock: { itemKey: request.itemKey },
      item: {
        itemId: matchItem?.id ?? "",
        itemUuid: matchItem?.uuid ?? "",
        beforeQuantity: itemQuantityBefore,
        afterQuantity: itemQuantityAfter,
        delta: actorPurchaseQuantity,
        created: !matchItem,
        rawItemData: purchasedItemData
      },
      currency: {
        beforeCopper: currentFundsCopper,
        afterCopper: currentFundsCopper - totalPriceCopper,
        deltaCopper: -totalPriceCopper
      },
      result: {
        transactionId: request.transactionId,
        actorName: buyer.name,
        itemName: inventoryItem.name,
        totalPriceCopper,
        totalPriceLabel: formatCopper(totalPriceCopper)
      },
      audit: {
        type: "purchase",
        actorId: buyer.id,
        actorName: buyer.name,
        cityId: request.cityId,
        cityName: snapshot.cityName,
        traderKey: request.traderKey,
        traderName: snapshot.name,
        itemId: matchItem?.id ?? "",
        itemUuid: matchItem?.uuid ?? "",
        itemName: inventoryItem.name,
        sourceType: inventoryItem.sourceType,
        sourceId: inventoryItem.sourceId,
        quantity: purchaseQuantity,
        totalCopper: totalPriceCopper,
        totalPriceCopper,
        currencyBeforeCopper: currentFundsCopper,
        currencyAfterCopper: currentFundsCopper - totalPriceCopper,
        itemQuantityBefore,
        itemQuantityAfter
      }
    };
  }

  async #prepareSale(request, _context = {}) {
    const preview = await this.createSalePreview(
      request.cityId,
      request.traderKey,
      { uuid: request.itemUuid }
    );
    const actor = this.#requireTransactionActor(request.actorId, request.requestedByUserId);
    if (preview?.actorId !== actor.id || preview?.itemUuid !== request.itemUuid) {
      throw new Error("Предмет продажи не принадлежит выбранному персонажу.");
    }

    const itemDocument = await fromUuid(request.itemUuid);
    if (!(itemDocument instanceof Item) || itemDocument.parent?.id !== actor.id) {
      throw new Error("Предмет для продажи уже недоступен.");
    }

    const sellQuantity = Number(request.quantity);
    if (!Number.isInteger(sellQuantity) || sellQuantity < 1) {
      throw new Error("Количество предмета для продажи указано неверно.");
    }
    const itemDataBeforeSale = itemDocument.toObject();
    const currentQuantity = Math.max(
      0,
      Math.floor(toNumber(foundry.utils.getProperty(itemDataBeforeSale, "system.quantity"), 0))
    );
    if (sellQuantity > currentQuantity) {
      throw new Error("У персонажа нет такого количества предмета.");
    }

    const grossOfferCopper = Math.max(0, Math.round(toNumber(preview.grossOfferCopper, 0)))
      * sellQuantity;
    const taxCopper = Math.max(0, Math.round(toNumber(preview.taxCopper, 0))) * sellQuantity;
    const netPayoutCopper = Math.max(0, Math.round(toNumber(preview.netPayoutCopper, 0)))
      * sellQuantity;
    const actorFunds = actorCurrencyToCopper(actor);

    return {
      traderId: getTraderStateKey(request.cityId, request.traderKey),
      item: {
        itemId: itemDocument.id,
        itemUuid: itemDocument.uuid,
        beforeQuantity: currentQuantity,
        afterQuantity: currentQuantity - sellQuantity,
        delta: -sellQuantity,
        created: false,
        rawItemData: sanitizeRawItemData(itemDataBeforeSale)
      },
      currency: {
        beforeCopper: actorFunds,
        afterCopper: actorFunds + netPayoutCopper,
        deltaCopper: netPayoutCopper
      },
      result: {
        transactionId: request.transactionId,
        actorName: actor.name,
        itemName: preview.itemName,
        sellQuantity,
        grossOfferCopper,
        taxCopper,
        netPayoutCopper,
        totalCopper: netPayoutCopper,
        grossOfferLabel: formatCopper(grossOfferCopper),
        taxLabel: formatCopper(taxCopper),
        netPayoutLabel: formatCopper(netPayoutCopper)
      },
      audit: {
        type: "sale",
        actorId: actor.id,
        actorName: actor.name,
        cityId: request.cityId,
        cityName: preview.cityName,
        traderKey: request.traderKey,
        traderName: preview.traderName,
        itemId: itemDocument.id,
        itemUuid: itemDocument.uuid,
        itemName: preview.itemName,
        sourceType: preview.sourceType,
        sourceId: preview.sourceId,
        quantity: sellQuantity,
        totalCopper: netPayoutCopper,
        grossOfferCopper,
        taxCopper,
        netPayoutCopper,
        currencyBeforeCopper: actorFunds,
        currencyAfterCopper: actorFunds + netPayoutCopper,
        itemQuantityBefore: currentQuantity,
        itemQuantityAfter: currentQuantity - sellQuantity,
        rawItemData: sanitizeRawItemData(itemDataBeforeSale)
      }
    };
  }

  async purchaseItem(cityId, traderKey, itemKey, quantity, options = {}) {
    if (this.transactionService) {
      return this.transactionService.purchase({
        transactionId: options.transactionId,
        actorId: options.actorId,
        cityId,
        traderKey,
        itemKey,
        quantity,
        requestedByUserId: options.requestedByUserId
      }, { source: "trader-service" });
    }

    return this.purchaseItemLegacy(cityId, traderKey, itemKey, quantity, options);
  }

  /** @deprecated bootstrap fallback */
  async purchaseItemLegacy(cityId, traderKey, itemKey, quantity, { actorId = null, requestedByUserId = "" } = {}) {
    const partyInventoryActor = await this.moduleApi.inventoryService?.getInventoryActor?.({
      create: game.user?.isGM === true
    }) ?? null;
    const buyer = resolveActorByPreference(actorId, {
      preferredActor: partyInventoryActor
    });
    if (!buyer?.isOwner) {
      throw new Error("Не выбран персонаж для покупки.");
    }
    assertUserCanTradeActor(buyer, requestedByUserId);

    const snapshot = await this.getTraderSnapshot(cityId, traderKey, { actorId: buyer.id });
    const inventoryItem = snapshot.inventory.find((entry) => entry.itemKey === itemKey);
    if (!inventoryItem) {
      throw new Error("Товар больше недоступен у торговца.");
    }

    const purchaseQuantity = Math.max(1, Math.floor(toNumber(quantity, 1)));
    if (purchaseQuantity > inventoryItem.quantity) {
      throw new Error("У торговца нет такого количества товара.");
    }

    const totalPriceCopper = inventoryItem.finalPriceCopper * purchaseQuantity;
    const currentFundsCopper = actorCurrencyToCopper(buyer);
    if (currentFundsCopper < totalPriceCopper) {
      throw new Error("У персонажа не хватает монет на покупку.");
    }

    let purchasedItemData = inventoryItem.sourceType === "custom" && inventoryItem.rawItemData
      ? sanitizeRawItemData(inventoryItem.rawItemData)
      : buildCanonicalItemData(inventoryItem, purchaseQuantity, inventoryItem.finalPriceCopper);

    if (inventoryItem.sourceType === "magicItem") {
      const magicDocument = await this.moduleApi.magicItemsCompendium?.getMagicItemDocument?.(
        inventoryItem.sourceId,
        inventoryItem.name
      );
      if (magicDocument) {
        purchasedItemData = sanitizeRawItemData(magicDocument.toObject());
      }
    }

    const sourcePackQuantity = Math.max(
      1,
      Math.floor(toNumber(foundry.utils.getProperty(purchasedItemData, `flags.${MODULE_ID}.sourcePackQuantity`), 1))
    );
    const actorPurchaseQuantity = purchaseQuantity * sourcePackQuantity;
    const actorBasePriceGold = sourcePackQuantity > 1
      ? roundNumber(toNumber(inventoryItem.basePriceGold, 0) / sourcePackQuantity, 6)
      : inventoryItem.basePriceGold;

    foundry.utils.setProperty(purchasedItemData, "system.quantity", actorPurchaseQuantity);
    foundry.utils.setProperty(purchasedItemData, `flags.${MODULE_ID}.sourceType`, inventoryItem.sourceType);
    foundry.utils.setProperty(purchasedItemData, `flags.${MODULE_ID}.sourceId`, inventoryItem.sourceId);
    foundry.utils.setProperty(purchasedItemData, `flags.${MODULE_ID}.basePriceGold`, actorBasePriceGold);
    foundry.utils.setProperty(purchasedItemData, `flags.${MODULE_ID}.priceGoldEquivalent`, actorBasePriceGold);
    if (sourcePackQuantity > 1) {
      foundry.utils.setProperty(purchasedItemData, `flags.${MODULE_ID}.sourcePackPriceGoldEquivalent`, inventoryItem.basePriceGold);
      foundry.utils.setProperty(purchasedItemData, `flags.${MODULE_ID}.sourcePackWeight`, inventoryItem.baseWeight);
    }
    foundry.utils.setProperty(purchasedItemData, `flags.${MODULE_ID}.predominantMaterialId`, inventoryItem.predominantMaterialId ?? null);
    foundry.utils.setProperty(purchasedItemData, `flags.${MODULE_ID}.linkedGoodId`, inventoryItem.linkedGoodId ?? null);
    foundry.utils.setProperty(
      purchasedItemData,
      `flags.${MODULE_ID}.materialId`,
      inventoryItem.sourceType === "material" ? inventoryItem.sourceId : null
    );
    foundry.utils.setProperty(
      purchasedItemData,
      `flags.${MODULE_ID}.gearId`,
      inventoryItem.sourceType === "gear" ? inventoryItem.sourceId : null
    );

    const matchItem = buyer.items.contents.find((item) => {
      const sourceType = item.getFlag(MODULE_ID, "sourceType");
      const sourceId = item.getFlag(MODULE_ID, "sourceId");
      return sourceType === inventoryItem.sourceType && sourceId === inventoryItem.sourceId;
    });
    const itemQuantityBefore = matchItem ? getRawQuantity(matchItem.toObject()) : 0;
    let purchasedItemDocument = matchItem ?? null;

    if (matchItem) {
      const nextQuantity = getRawQuantity(matchItem.toObject()) + actorPurchaseQuantity;
      await matchItem.update({
        "system.quantity": nextQuantity
      });
    }
    else {
      const [createdItem] = await buyer.createEmbeddedDocuments("Item", [purchasedItemData]);
      purchasedItemDocument = createdItem ?? null;
    }

    await buyer.update(buildCurrencyUpdate(currentFundsCopper - totalPriceCopper));

    await this.#recordTradeAudit({
      type: "purchase",
      actorId: buyer.id,
      actorName: buyer.name,
      cityId,
      cityName: snapshot.cityName,
      traderKey,
      traderName: snapshot.name,
      itemId: purchasedItemDocument?.id ?? matchItem?.id ?? "",
      itemUuid: purchasedItemDocument?.uuid ?? matchItem?.uuid ?? "",
      itemName: inventoryItem.name,
      sourceType: inventoryItem.sourceType,
      sourceId: inventoryItem.sourceId,
      quantity: purchaseQuantity,
      totalCopper: totalPriceCopper,
      totalPriceCopper,
      currencyBeforeCopper: currentFundsCopper,
      currencyAfterCopper: currentFundsCopper - totalPriceCopper,
      itemQuantityBefore,
      itemQuantityAfter: itemQuantityBefore + actorPurchaseQuantity
    });

    return {
      actorName: buyer.name,
      itemName: inventoryItem.name,
      totalPriceCopper,
      totalPriceLabel: formatCopper(totalPriceCopper)
    };
  }

  async createSalePreview(cityId, traderKey, dropData) {
    const citySnapshot = this.moduleApi.getCitySnapshot(cityId);
    if (!citySnapshot) {
      throw new Error("Город не найден.");
    }

    const itemDocument = dropData?.uuid ? await fromUuid(dropData.uuid) : null;
    if (!(itemDocument instanceof Item) || !(itemDocument.parent instanceof Actor)) {
      throw new Error("Перетащите предмет прямо из листа персонажа.");
    }

    const actor = itemDocument.parent;
    if (!actor.isOwner) {
      throw new Error("У вас нет прав на этот предмет.");
    }

    const model = await this.moduleApi.getModel();
    const traderSnapshot = await this.getTraderSnapshot(cityId, traderKey, { actorId: actor.id });
    const itemData = itemDocument.toObject();
    const sourceFlags = foundry.utils.deepClone(itemDocument.flags?.[MODULE_ID] ?? {});
    const quantityAvailable = getRawQuantity(itemData);

    const matchedMaterial = model.materialById?.get(sourceFlags.materialId)
      ?? model.materialByGoodId?.get(sourceFlags.linkedGoodId)
      ?? model.materials.find((material) => normalizeText(material.name) === normalizeText(itemDocument.name))
      ?? null;
    const matchedGear = model.gearById?.get(sourceFlags.gearId)
      ?? model.gear.find((gearItem) => normalizeText(gearItem.name) === normalizeText(itemDocument.name))
      ?? null;
    const sourceTypeText = normalizeText(sourceFlags.sourceType ?? "");
    const magicSourceId = String(
      sourceFlags.magicItemId
      ?? sourceFlags.magicId
      ?? ((sourceTypeText === "magicitem" || sourceTypeText === "магическийпредмет") ? sourceFlags.sourceId : "")
      ?? ""
    ).trim();
    const isMagicItem = Boolean(
      magicSourceId
      || sourceFlags.magical === true
      || sourceTypeText === "magicitem"
      || sourceTypeText === "магическийпредмет"
    );

    const sourceType = matchedMaterial
      ? "material"
      : (matchedGear
        ? "gear"
        : (isMagicItem ? "magicItem" : "custom"));
    const predominantMaterialId = matchedMaterial?.id
      ?? matchedGear?.predominantMaterialId
      ?? sourceFlags.predominantMaterialId
      ?? null;
    const predominantMaterialName = matchedMaterial?.name
      ?? matchedGear?.predominantMaterialName
      ?? sourceFlags.predominantMaterialName
      ?? "";
    const basePriceGold = matchedMaterial
      ? toNumber(matchedMaterial.priceGold, MIN_PRICE_GOLD)
      : (matchedGear
        ? getGearBasePriceGold(matchedGear)
        : (isMagicItem
          ? Math.max(MIN_PRICE_GOLD, toNumber(sourceFlags.basePriceGold, parseDnd5ePriceGold(itemData)))
          : parseDnd5ePriceGold(itemData)));
    const sourceId = matchedMaterial?.id
      ?? matchedGear?.id
      ?? (isMagicItem ? (magicSourceId || `magic-${normalizeText(itemDocument.name).replace(/\s+/gu, "-")}`) : null)
      ?? `custom-${normalizeText(itemDocument.name).replace(/\s+/gu, "-")}-${Math.round(basePriceGold * 100)}-${predominantMaterialId ?? "na"}`;
    const baseWeight = Math.max(0, toNumber(foundry.utils.getProperty(itemData, "system.weight.value"), matchedMaterial?.weight ?? matchedGear?.weight ?? 0));
    const linkedGoodId = matchedMaterial?.linkedGoodId ?? sourceFlags.linkedGoodId ?? null;
    const modifierPercent = matchedMaterial
      ? getMaterialPriceModifier(model, citySnapshot, matchedMaterial)
      : (matchedGear
        ? getGearPriceModifier(model, citySnapshot, matchedGear)
        : (isMagicItem
          ? 0
          : (() => {
            const material = predominantMaterialId ? model.materialById?.get(predominantMaterialId) ?? null : null;
            if (!material) {
              return 0;
            }

            const materialModifier = getMaterialPriceModifier(model, citySnapshot, material);
            return materialModifier > 0 ? materialModifier : materialModifier / 2;
          })())
      );
    const merchantItemCategory = matchedMaterial?.type
      ?? matchedGear?.equipmentType
      ?? (isMagicItem ? "Магический предмет" : itemDocument.type);
    const merchantModifiers = this.moduleApi.globalEventsService?.collectMerchantModifiers?.({
      model,
      cityId,
      goodId: linkedGoodId ?? "",
      itemCategory: merchantItemCategory,
      traderType: traderSnapshot.traderType
    }) ?? {
      buyPricePercent: 0,
      sourceEventNames: []
    };
    const buyModifierPercent = toNumber(merchantModifiers.buyPricePercent, 0);
    const totalBuyModifierPercent = modifierPercent + buyModifierPercent;

    const marketPricing = applyMarketPrice(basePriceGold, totalBuyModifierPercent, baseWeight);
    const marketPriceCopper = goldToCopper(marketPricing.finalPriceGold);
    const grossOfferCopper = marketPriceCopper;
    const taxCopper = Math.max(0, Math.round(grossOfferCopper * traderSnapshot.taxPercent));
    const netPayoutCopper = Math.max(0, grossOfferCopper - taxCopper);

    return {
      actorId: actor.id,
      actorName: actor.name,
      cityName: traderSnapshot.cityName,
      traderName: traderSnapshot.name,
      itemUuid: itemDocument.uuid,
      itemId: itemDocument.id,
      itemName: itemDocument.name,
      itemType: itemDocument.type,
      img: itemDocument.img,
      description: getPlainDescription(itemData),
      quantityAvailable,
      quantity: 1,
      sourceType,
      sourceId,
      basePriceGold,
      baseWeight,
      rank: Math.max(0, Math.round(toNumber(sourceFlags.rank, matchedMaterial?.rank ?? matchedGear?.rank ?? 0))),
      predominantMaterialId,
      predominantMaterialName,
      linkedGoodId,
      linkedTool: matchedGear?.linkedTool ?? sourceFlags.linkedTool ?? "",
      itemTypeLabel: matchedMaterial?.type ?? matchedGear?.equipmentType ?? (isMagicItem ? "Магический предмет" : itemDocument.type),
      rarity: String(sourceFlags.rarity ?? ""),
      shopSubtype: String(sourceFlags.shopSubtype ?? ""),
      rawItemData: sanitizeRawItemData(itemData),
      modifierPercent,
      merchantBuyModifierPercent: buyModifierPercent,
      totalBuyModifierPercent,
      eventSourceNames: uniqueStrings(merchantModifiers.sourceEventNames ?? []),
      modifierLabel: formatSignedPercent(modifierPercent, 1),
      modifierClass: modifierPercent > 0 ? "rm-negative" : (modifierPercent < 0 ? "rm-positive" : ""),
      marketPriceCopper,
      marketPriceLabel: formatCopper(marketPriceCopper),
      grossOfferCopper,
      grossOfferLabel: formatCopper(grossOfferCopper),
      taxPercent: traderSnapshot.taxPercent,
      taxLabel: traderSnapshot.taxLabel,
      taxCopper,
      taxCopperLabel: formatCopper(taxCopper),
      netPayoutCopper,
      netPayoutLabel: formatCopper(netPayoutCopper)
    };
  }

  async sellItem(cityId, traderKey, preview, quantity, options = {}) {
    if (this.transactionService) {
      return this.transactionService.sale({
        transactionId: options.transactionId,
        actorId: options.actorId ?? preview?.actorId,
        cityId,
        traderKey,
        itemUuid: preview?.itemUuid,
        quantity,
        requestedByUserId: options.requestedByUserId
      }, { source: "trader-service" });
    }

    return this.sellItemLegacy(cityId, traderKey, preview, quantity, options);
  }

  /** @deprecated bootstrap fallback */
  async sellItemLegacy(cityId, traderKey, preview, quantity, { requestedByUserId = "" } = {}) {
    if (!preview?.actorId || !preview?.itemUuid) {
      throw new Error("Нет подготовленного предмета для продажи.");
    }

    const actor = game.actors.get(preview.actorId);
    if (!actor?.isOwner) {
      throw new Error("Продавец недоступен.");
    }
    assertUserCanTradeActor(actor, requestedByUserId);

    const itemDocument = await fromUuid(preview.itemUuid);
    if (!(itemDocument instanceof Item) || itemDocument.parent?.id !== actor.id) {
      throw new Error("Предмет для продажи уже недоступен.");
    }

    const sellQuantity = Math.max(1, Math.floor(toNumber(quantity, 1)));
    const itemDataBeforeSale = itemDocument.toObject();
    const currentQuantity = getRawQuantity(itemDataBeforeSale);
    if (sellQuantity > currentQuantity) {
      throw new Error("У персонажа нет такого количества предмета.");
    }

    const grossOfferCopper = preview.grossOfferCopper * sellQuantity;
    const taxCopper = preview.taxCopper * sellQuantity;
    const netPayoutCopper = preview.netPayoutCopper * sellQuantity;

    const actorFunds = actorCurrencyToCopper(actor);
    await actor.update(buildCurrencyUpdate(actorFunds + netPayoutCopper));

    if (sellQuantity >= currentQuantity) {
      await itemDocument.delete();
    }
    else {
      await itemDocument.update({
        "system.quantity": currentQuantity - sellQuantity
      });
    }

    const traderSnapshot = await this.getTraderSnapshot(cityId, traderKey, { actorId: actor.id });
    await this.#recordTradeAudit({
      type: "sale",
      actorId: actor.id,
      actorName: actor.name,
      cityId,
      cityName: traderSnapshot.cityName,
      traderKey,
      traderName: traderSnapshot.name,
      itemId: itemDocument.id,
      itemUuid: itemDocument.uuid,
      itemName: preview.itemName,
      sourceType: preview.sourceType,
      sourceId: preview.sourceId,
      quantity: sellQuantity,
      totalCopper: netPayoutCopper,
      grossOfferCopper,
      taxCopper,
      netPayoutCopper,
      currencyBeforeCopper: actorFunds,
      currencyAfterCopper: actorFunds + netPayoutCopper,
      itemQuantityBefore: currentQuantity,
      itemQuantityAfter: Math.max(0, currentQuantity - sellQuantity),
      rawItemData: itemDataBeforeSale
    });

    return {
      actorName: actor.name,
      itemName: preview.itemName,
      sellQuantity,
      grossOfferLabel: formatCopper(grossOfferCopper),
      taxLabel: formatCopper(taxCopper),
      netPayoutLabel: formatCopper(netPayoutCopper)
    };
  }
}
