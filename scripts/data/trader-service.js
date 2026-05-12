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
import { formatPercent, formatSignedPercent } from "../ui.js";

const MAX_ACTIVE_TRADERS = 21;
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

function createEmptyTraderState() {
  return {
    version: 1,
    order: [],
    traders: {}
  };
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

  const denomination = finalPriceCopper >= PRICE_IN_COPPER.gp
    ? "gp"
    : (finalPriceCopper % PRICE_IN_COPPER.sp === 0 ? "sp" : "cp");
  const priceValue = denomination === "gp"
    ? roundNumber(finalPriceCopper / PRICE_IN_COPPER.gp, 2)
    : (denomination === "sp"
      ? Math.floor(finalPriceCopper / PRICE_IN_COPPER.sp)
      : finalPriceCopper);

  return {
    name: entry.name,
    type: "loot",
    img: getInventoryEntryIcon(entry),
    system: {
      description: {
        value: descriptionLines.join(""),
        chat: ""
      },
      unidentified: {
        description: ""
      },
      quantity,
      price: {
        value: priceValue,
        denomination
      },
      weight: {
        value: toNumber(entry.finalWeight, entry.baseWeight),
        units: "lb"
      },
      type: {
        value: entry.sourceType === "material" ? "trade" : "loot",
        subtype
      }
    },
    flags: {
      [MODULE_ID]: {
        traderManaged: true,
        sourceType: entry.sourceType,
          sourceId: entry.sourceId,
          basePriceGold: entry.basePriceGold,
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
  constructor(moduleApi) {
    this.moduleApi = moduleApi;
  }

  invalidatePackCache() {}

  isAvailable() {
    return true;
  }

  #getState() {
    const state = game.settings.get(MODULE_ID, SETTINGS_KEYS.TRADER_STATE);
    if (!state || typeof state !== "object") {
      return createEmptyTraderState();
    }

    return foundry.utils.mergeObject(createEmptyTraderState(), foundry.utils.deepClone(state));
  }

  async #setState(nextState) {
    await game.settings.set(MODULE_ID, SETTINGS_KEYS.TRADER_STATE, nextState);
    return nextState;
  }

  async #writeState(mutator) {
    if (!game.user?.isGM) {
      throw new Error("Торговые операции может сохранять только ГМ.");
    }

    const state = this.#getState();
    const result = await mutator(state);
    await this.#setState(state);
    return result;
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

  #buildInventoryViewEntry(model, citySnapshot, statePolicy, traderType, stockEntry) {
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

    return {
      ...stockEntry,
      img: getInventoryEntryIcon({ ...stockEntry, ...resolvedMetadata }),
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
    const inventory = (traderState.inventory ?? [])
      .filter((entry) => toNumber(entry.quantity, 0) > 0)
      .map((entry) => this.#buildInventoryViewEntry(model, citySnapshot, statePolicy, plan.traderType, entry))
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
      customerOptions: buildCustomerOptions(customerActor?.id ?? null, {
        partyInventoryActorId: partyInventoryActor?.id ?? null
      }),
      taxPercent: toNumber(statePolicy.taxPercent, 0),
      taxLabel: formatPercent(toNumber(statePolicy.taxPercent, 0), 1),
      taxEventSourceNames: uniqueStrings(statePolicy?.eventDelta?.sourceEventNames ?? []),
      canTrade: game.user?.isGM === true,
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

  async purchaseItem(cityId, traderKey, itemKey, quantity, { actorId = null } = {}) {
    const partyInventoryActor = await this.moduleApi.inventoryService?.getInventoryActor?.({
      create: game.user?.isGM === true
    }) ?? null;
    const buyer = resolveActorByPreference(actorId, {
      preferredActor: partyInventoryActor
    });
    if (!buyer?.isOwner) {
      throw new Error("Не выбран персонаж для покупки.");
    }

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

    foundry.utils.setProperty(purchasedItemData, "system.quantity", purchaseQuantity);
    foundry.utils.setProperty(purchasedItemData, `flags.${MODULE_ID}.sourceType`, inventoryItem.sourceType);
    foundry.utils.setProperty(purchasedItemData, `flags.${MODULE_ID}.sourceId`, inventoryItem.sourceId);
    foundry.utils.setProperty(purchasedItemData, `flags.${MODULE_ID}.basePriceGold`, inventoryItem.basePriceGold);
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

    if (matchItem) {
      const nextQuantity = getRawQuantity(matchItem.toObject()) + purchaseQuantity;
      await matchItem.update({
        "system.quantity": nextQuantity
      });
    }
    else {
      await buyer.createEmbeddedDocuments("Item", [purchasedItemData]);
    }

    await buyer.update(buildCurrencyUpdate(currentFundsCopper - totalPriceCopper));

    await this.#writeState(async (state) => {
      const traderId = getTraderStateKey(cityId, traderKey);
      const traderState = state.traders[traderId];
      if (!traderState) {
        throw new Error("Состояние торговца не найдено.");
      }

      const stockItem = traderState.inventory.find((entry) => entry.itemKey === itemKey);
      if (!stockItem) {
        throw new Error("Товар отсутствует в сохранённом ассортименте.");
      }

      stockItem.quantity = Math.max(0, Math.floor(toNumber(stockItem.quantity, 0)) - purchaseQuantity);
      traderState.updatedAt = Date.now();
      traderState.inventory = traderState.inventory.filter((entry) => toNumber(entry.quantity, 0) > 0);
      state.order = [traderId, ...state.order.filter((entry) => entry !== traderId)];
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

  async sellItem(cityId, traderKey, preview, quantity) {
    if (!preview?.actorId || !preview?.itemUuid) {
      throw new Error("Нет подготовленного предмета для продажи.");
    }

    const actor = game.actors.get(preview.actorId);
    if (!actor?.isOwner) {
      throw new Error("Продавец недоступен.");
    }

    const itemDocument = await fromUuid(preview.itemUuid);
    if (!(itemDocument instanceof Item) || itemDocument.parent?.id !== actor.id) {
      throw new Error("Предмет для продажи уже недоступен.");
    }

    const sellQuantity = Math.max(1, Math.floor(toNumber(quantity, 1)));
    const currentQuantity = getRawQuantity(itemDocument.toObject());
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

    await this.#writeState(async (state) => {
      const traderId = getTraderStateKey(cityId, traderKey);
      const traderState = state.traders[traderId];
      if (!traderState) {
        throw new Error("Состояние торговца не найдено.");
      }

      const existingEntry = traderState.inventory.find((entry) => (
        entry.sourceType === preview.sourceType
        && entry.sourceId === preview.sourceId
      ));

      if (existingEntry) {
        existingEntry.quantity = Math.max(0, Math.floor(toNumber(existingEntry.quantity, 0))) + sellQuantity;
        if (preview.sourceType === "custom" && !existingEntry.rawItemData) {
          existingEntry.rawItemData = sanitizeRawItemData(preview.rawItemData);
        }
        if (!existingEntry.rarity && preview.rarity) {
          existingEntry.rarity = preview.rarity;
        }
        if (!existingEntry.shopSubtype && preview.shopSubtype) {
          existingEntry.shopSubtype = preview.shopSubtype;
        }
      }
      else {
        traderState.inventory.push({
          itemKey: `${preview.sourceType}:${preview.sourceId}`,
          sourceType: preview.sourceType,
          sourceId: preview.sourceId,
          name: preview.itemName,
          img: preview.img,
          description: preview.description,
          quantity: sellQuantity,
          basePriceGold: preview.basePriceGold,
          baseWeight: preview.baseWeight,
          rank: preview.rank,
          itemTypeLabel: preview.itemTypeLabel,
          predominantMaterialId: preview.predominantMaterialId,
          predominantMaterialName: preview.predominantMaterialName,
          linkedTool: preview.linkedTool,
          linkedGoodId: preview.linkedGoodId,
          rarity: preview.rarity ?? "",
          shopSubtype: preview.shopSubtype ?? "",
          rawItemData: preview.sourceType === "custom" ? sanitizeRawItemData(preview.rawItemData) : null
        });
      }

      traderState.updatedAt = Date.now();
      state.order = [traderId, ...state.order.filter((entry) => entry !== traderId)];
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
