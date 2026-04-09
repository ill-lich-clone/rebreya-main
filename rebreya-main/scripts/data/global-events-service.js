import { MODULE_ID, SETTINGS_KEYS } from "../constants.js";

const DEFAULT_PRIORITY = 100;
const EFFECT_MODES = new Set(["addPercent", "multiply", "flat", "override"]);
const STACKING_MODES = new Set(["stack", "highestOnly", "lowestOnly", "overrideByPriority"]);
const EFFECT_TYPES = new Set([
  "productionMultiplier",
  "demandMultiplier",
  "priceMultiplier",
  "supplyFlat",
  "demandFlat",
  "selfSufficiencyModifier",
  "importNeedMultiplier",
  "routeCostPercent",
  "routeCapacityPercent",
  "disableRoute",
  "routeRiskNote",
  "stateTaxPercent",
  "tariffPercent",
  "bilateralTariffPercent",
  "merchantBuyPricePercent",
  "merchantSellPricePercent",
  "merchantStockPercent",
  "merchantRestockMode",
  "merchantCategoryBoost",
  "availabilityBlock",
  "availabilityBoost",
  "rarityShift"
]);

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const rows = [];
  for (const entry of values) {
    const text = String(entry ?? "").trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    rows.push(text);
  }
  return rows;
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function buildRoutePairKey(fromCityId = "", toCityId = "", connectionType = "") {
  const fromId = String(fromCityId ?? "").trim();
  const toId = String(toCityId ?? "").trim();
  if (!fromId || !toId) {
    return "";
  }

  const [left, right] = [fromId, toId].sort((a, b) => a.localeCompare(b, "ru"));
  return `${left}::${right}::${normalizeText(connectionType)}`;
}

function parseConnectionIdPairKey(connectionId = "") {
  const rawConnectionId = String(connectionId ?? "").trim();
  if (!rawConnectionId) {
    return "";
  }

  const parts = rawConnectionId.split("::").map((entry) => String(entry ?? "").trim()).filter(Boolean);
  if (parts.length >= 3) {
    return buildRoutePairKey(parts[0], parts[2], parts[1]);
  }
  if (parts.length === 2) {
    return buildRoutePairKey(parts[0], parts[1], "");
  }

  const dashMatch = rawConnectionId.match(/^(.+?)\s*[\u2014-]\s*(.+)$/u);
  if (dashMatch) {
    return buildRoutePairKey(dashMatch[1], dashMatch[2], "");
  }
  return "";
}

function normalizeIsoDate(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,6})-(\d{2})-(\d{2})$/u);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isoStamp(value) {
  const normalized = normalizeIsoDate(value);
  if (!normalized) {
    return null;
  }
  const [yearText, monthText, dayText] = normalized.split("-");
  return Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText));
}

function compareIso(left, right) {
  const leftStamp = isoStamp(left);
  const rightStamp = isoStamp(right);
  if (leftStamp === null || rightStamp === null) {
    return 0;
  }
  return leftStamp < rightStamp ? -1 : (leftStamp > rightStamp ? 1 : 0);
}

function defaultScope() {
  return {
    world: false,
    states: [],
    regions: [],
    cities: [],
    goods: [],
    goodTags: [],
    routes: [],
    routeConnectionIds: []
  };
}

function defaultEvent() {
  const now = Date.now();
  return {
    id: "",
    eventType: "custom",
    name: "",
    description: "",
    enabled: true,
    active: false,
    trigger: { type: "manual", startDate: null, endDate: null },
    duration: { mode: "untilDisabled", startDate: null, endDate: null },
    scope: defaultScope(),
    stacking: { mode: "stack", priority: DEFAULT_PRIORITY },
    effects: [],
    merchantEffects: {
      restockModifier: 0,
      rarityShift: 0,
      priceModifier: 0,
      stockModifier: 0
    },
    routeEffects: {
      disableRoutes: false,
      routeCostPercent: 0,
      routeCapacityPercent: 0
    },
    taxEffects: {
      stateTaxModifierPercent: 0,
      tariffModifierPercent: 0,
      bilateralTariffPercent: 0
    },
    visibility: {
      gmOnly: true,
      showNotificationOnStart: true,
      showNotificationOnEnd: true
    },
    createdAt: now,
    updatedAt: now
  };
}

function normalizeEffect(rawEffect) {
  if (!rawEffect || typeof rawEffect !== "object") {
    return null;
  }
  const type = String(rawEffect.type ?? "").trim();
  if (!EFFECT_TYPES.has(type)) {
    return null;
  }
  const mode = EFFECT_MODES.has(rawEffect.mode) ? rawEffect.mode : "addPercent";
  const value = type === "routeRiskNote" || type === "merchantRestockMode"
    ? String(rawEffect.value ?? "").trim()
    : toNumber(rawEffect.value, 0);
  return {
    type,
    mode,
    value,
    connectionId: String(rawEffect.connectionId ?? "").trim(),
    targetStateId: String(rawEffect.targetStateId ?? "").trim(),
    targetStateIds: uniqueStrings(toArray(rawEffect.targetStateIds)),
    merchantCategory: normalizeText(rawEffect.merchantCategory),
    merchantType: normalizeText(rawEffect.merchantType)
  };
}

function normalizeEvent(rawEvent) {
  const defaults = defaultEvent();
  const source = rawEvent && typeof rawEvent === "object" ? rawEvent : {};
  const now = Date.now();
  const triggerType = ["manual", "date", "dateRange"].includes(source?.trigger?.type) ? source.trigger.type : "manual";
  const durationMode = ["instant", "untilDisabled", "dateRange"].includes(source?.duration?.mode) ? source.duration.mode : "untilDisabled";
  const stackingMode = STACKING_MODES.has(source?.stacking?.mode) ? source.stacking.mode : "stack";
  const createdAt = Math.max(0, Math.floor(toNumber(source.createdAt, now)));
  const updatedAt = Math.max(createdAt, Math.floor(toNumber(source.updatedAt, now)));
  return {
    ...defaults,
    id: String(source.id ?? "").trim() || `global-event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    eventType: String(source.eventType ?? "custom").trim() || "custom",
    name: String(source.name ?? "").trim(),
    description: String(source.description ?? "").trim(),
    enabled: source.enabled !== false,
    active: source.active === true,
    trigger: {
      type: triggerType,
      startDate: normalizeIsoDate(source?.trigger?.startDate),
      endDate: normalizeIsoDate(source?.trigger?.endDate)
    },
    duration: {
      mode: durationMode,
      startDate: normalizeIsoDate(source?.duration?.startDate),
      endDate: normalizeIsoDate(source?.duration?.endDate)
    },
    scope: {
      world: source?.scope?.world === true,
      states: uniqueStrings(toArray(source?.scope?.states)),
      regions: uniqueStrings(toArray(source?.scope?.regions)),
      cities: uniqueStrings(toArray(source?.scope?.cities)),
      goods: uniqueStrings(toArray(source?.scope?.goods)),
      goodTags: uniqueStrings(toArray(source?.scope?.goodTags).map((entry) => normalizeText(entry)).filter(Boolean)),
      routes: uniqueStrings(toArray(source?.scope?.routes).map((entry) => {
        if (!entry || typeof entry !== "object") {
          return "";
        }
        const from = String(entry.from ?? "").trim();
        const to = String(entry.to ?? "").trim();
        return from && to ? `${from}::${to}` : "";
      })).map((entry) => {
        const [from = "", to = ""] = entry.split("::");
        return { from, to };
      }),
      routeConnectionIds: uniqueStrings(toArray(source?.scope?.routeConnectionIds))
    },
    stacking: {
      mode: stackingMode,
      priority: Math.round(toNumber(source?.stacking?.priority, DEFAULT_PRIORITY))
    },
    effects: toArray(source.effects).map((entry) => normalizeEffect(entry)).filter(Boolean),
    merchantEffects: {
      restockModifier: toNumber(source?.merchantEffects?.restockModifier, 0),
      rarityShift: toNumber(source?.merchantEffects?.rarityShift, 0),
      priceModifier: toNumber(source?.merchantEffects?.priceModifier, 0),
      stockModifier: toNumber(source?.merchantEffects?.stockModifier, 0)
    },
    routeEffects: {
      disableRoutes: source?.routeEffects?.disableRoutes === true,
      routeCostPercent: toNumber(source?.routeEffects?.routeCostPercent, 0),
      routeCapacityPercent: toNumber(source?.routeEffects?.routeCapacityPercent, 0)
    },
    taxEffects: {
      stateTaxModifierPercent: toNumber(source?.taxEffects?.stateTaxModifierPercent, 0),
      tariffModifierPercent: toNumber(source?.taxEffects?.tariffModifierPercent, 0),
      bilateralTariffPercent: toNumber(source?.taxEffects?.bilateralTariffPercent, 0)
    },
    visibility: {
      gmOnly: source?.visibility?.gmOnly !== false,
      showNotificationOnStart: source?.visibility?.showNotificationOnStart !== false,
      showNotificationOnEnd: source?.visibility?.showNotificationOnEnd !== false
    },
    createdAt,
    updatedAt
  };
}

function hasScope(scope) {
  return Boolean(
    scope?.world
    || toArray(scope?.states).length
    || toArray(scope?.regions).length
    || toArray(scope?.cities).length
    || toArray(scope?.goods).length
    || toArray(scope?.goodTags).length
    || toArray(scope?.routes).length
    || toArray(scope?.routeConnectionIds).length
  );
}

function buildDatasetSignature(dataset = {}) {
  const sourceMode = String(dataset?.source?.mode ?? "");
  const sourceBasePath = String(dataset?.source?.basePath ?? "");
  const cityRows = toArray(dataset?.cities)
    .map((city) => {
      const connectionRows = toArray(city?.connections)
        .map((connection) => `${String(connection?.connectionId ?? "")}:${String(connection?.targetCityId ?? "")}`)
        .join(",");
      return `${String(city?.id ?? "")}:${String(city?.state ?? "")}:${String(city?.regionId ?? "")}:${connectionRows}`;
    })
    .sort();
  const goodRows = toArray(dataset?.goods)
    .map((good) => [
      String(good?.id ?? ""),
      normalizeText(good?.name),
      normalizeText(good?.category),
      normalizeText(good?.groupId),
      normalizeText(good?.groupName)
    ].join(":"))
    .sort();
  return [
    sourceMode,
    sourceBasePath,
    cityRows.length,
    goodRows.length,
    cityRows.join("|"),
    goodRows.join("|")
  ].join("::");
}

function getGoodTags(good) {
  return new Set([
    normalizeText(good?.id),
    normalizeText(good?.name),
    normalizeText(good?.category),
    normalizeText(good?.groupId),
    normalizeText(good?.groupName)
  ].filter(Boolean));
}

function pickStackEntries(entries) {
  const stack = entries.filter((entry) => entry.event?.stacking?.mode === "stack");
  const byMode = {
    highestOnly: entries.filter((entry) => entry.event?.stacking?.mode === "highestOnly"),
    lowestOnly: entries.filter((entry) => entry.event?.stacking?.mode === "lowestOnly"),
    overrideByPriority: entries.filter((entry) => entry.event?.stacking?.mode === "overrideByPriority")
  };
  if (byMode.highestOnly.length) {
    stack.push([...byMode.highestOnly].sort((left, right) => toNumber(right.effect.value, 0) - toNumber(left.effect.value, 0))[0]);
  }
  if (byMode.lowestOnly.length) {
    stack.push([...byMode.lowestOnly].sort((left, right) => toNumber(left.effect.value, 0) - toNumber(right.effect.value, 0))[0]);
  }
  if (byMode.overrideByPriority.length) {
    stack.push([...byMode.overrideByPriority].sort((left, right) => {
      const priorityDelta = toNumber(right.event?.stacking?.priority, DEFAULT_PRIORITY) - toNumber(left.event?.stacking?.priority, DEFAULT_PRIORITY);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return toNumber(right.event?.updatedAt, 0) - toNumber(left.event?.updatedAt, 0);
    })[0]);
  }
  return stack.filter(Boolean);
}

function applyNumeric(baseValue, entries) {
  const rows = pickStackEntries(entries);
  if (!rows.length) {
    return toNumber(baseValue, 0);
  }
  let nextValue = toNumber(baseValue, 0);
  const flats = rows.filter((entry) => entry.effect.mode === "flat");
  const addPercents = rows.filter((entry) => entry.effect.mode === "addPercent");
  const multiplies = rows.filter((entry) => entry.effect.mode === "multiply");
  const overrides = rows.filter((entry) => entry.effect.mode === "override").sort((left, right) => {
    const priorityDelta = toNumber(right.event?.stacking?.priority, DEFAULT_PRIORITY) - toNumber(left.event?.stacking?.priority, DEFAULT_PRIORITY);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }
    return toNumber(right.event?.updatedAt, 0) - toNumber(left.event?.updatedAt, 0);
  });
  if (flats.length) {
    nextValue += flats.reduce((sum, entry) => sum + toNumber(entry.effect.value, 0), 0);
  }
  if (addPercents.length) {
    const delta = addPercents.reduce((sum, entry) => sum + toNumber(entry.effect.value, 0), 0);
    nextValue *= (1 + delta);
  }
  for (const entry of multiplies) {
    nextValue *= toNumber(entry.effect.value, 1);
  }
  if (overrides.length) {
    nextValue = toNumber(overrides[0].effect.value, nextValue);
  }
  return nextValue;
}

function applyPercent(entries) {
  return applyNumeric(1, entries) - 1;
}

function mergeEffects(event) {
  const rows = [...toArray(event.effects)];
  const merchant = event.merchantEffects ?? {};
  const route = event.routeEffects ?? {};
  const tax = event.taxEffects ?? {};
  if (Math.abs(toNumber(merchant.priceModifier, 0)) > 1e-9) {
    rows.push({ type: "merchantSellPricePercent", mode: "addPercent", value: merchant.priceModifier });
  }
  if (Math.abs(toNumber(merchant.stockModifier, 0)) > 1e-9) {
    rows.push({ type: "merchantStockPercent", mode: "addPercent", value: merchant.stockModifier });
  }
  if (Math.abs(toNumber(merchant.rarityShift, 0)) > 1e-9) {
    rows.push({ type: "rarityShift", mode: "flat", value: merchant.rarityShift });
  }
  if (route.disableRoutes) {
    rows.push({ type: "disableRoute", mode: "override", value: 1 });
  }
  if (Math.abs(toNumber(route.routeCostPercent, 0)) > 1e-9) {
    rows.push({ type: "routeCostPercent", mode: "addPercent", value: route.routeCostPercent });
  }
  if (Math.abs(toNumber(route.routeCapacityPercent, 0)) > 1e-9) {
    rows.push({ type: "routeCapacityPercent", mode: "addPercent", value: route.routeCapacityPercent });
  }
  if (Math.abs(toNumber(tax.stateTaxModifierPercent, 0)) > 1e-9) {
    rows.push({ type: "stateTaxPercent", mode: "addPercent", value: tax.stateTaxModifierPercent });
  }
  if (Math.abs(toNumber(tax.tariffModifierPercent, 0)) > 1e-9) {
    rows.push({ type: "tariffPercent", mode: "addPercent", value: tax.tariffModifierPercent });
  }
  if (Math.abs(toNumber(tax.bilateralTariffPercent, 0)) > 1e-9) {
    rows.push({ type: "bilateralTariffPercent", mode: "addPercent", value: tax.bilateralTariffPercent, targetStateIds: toArray(event.scope?.states) });
  }
  return rows.map((entry) => normalizeEffect(entry)).filter(Boolean);
}

export class GlobalEventsService {
  #eventsCache = null;
  #eventsUpdatedAt = 0;
  #activeCache = { key: "", rows: [] };
  #scopeCache = new Map();
  #modifiersCache = { key: "", value: null };

  constructor(moduleApi = null) {
    this.moduleApi = moduleApi;
  }

  setModuleApi(moduleApi) {
    this.moduleApi = moduleApi;
  }

  isSubsystemEnabled() {
    return game.settings.get(MODULE_ID, SETTINGS_KEYS.GLOBAL_EVENTS_ENABLED) !== false;
  }

  isNotificationsEnabled() {
    return game.settings.get(MODULE_ID, SETTINGS_KEYS.GLOBAL_EVENTS_NOTIFICATIONS) !== false;
  }

  isAutoRecalculateEnabled() {
    return game.settings.get(MODULE_ID, SETTINGS_KEYS.GLOBAL_EVENTS_AUTO_RECALC) !== false;
  }

  isDebugEnabled() {
    return game.settings.get(MODULE_ID, SETTINGS_KEYS.GLOBAL_EVENTS_DEBUG) === true;
  }

  #invalidateCaches() {
    this.#activeCache = { key: "", rows: [] };
    this.#scopeCache = new Map();
    this.#modifiersCache = { key: "", value: null };
  }

  #loadState() {
    const rawState = game.settings.get(MODULE_ID, SETTINGS_KEYS.GLOBAL_EVENTS_STATE);
    if (!rawState || typeof rawState !== "object") {
      return { updatedAt: 0, events: [] };
    }
    if (Array.isArray(rawState)) {
      return { updatedAt: 0, events: rawState };
    }
    return { updatedAt: Math.max(0, Math.floor(toNumber(rawState.updatedAt, 0))), events: toArray(rawState.events) };
  }

  loadGlobalEvents() {
    const state = this.#loadState();
    if (this.#eventsCache && this.#eventsUpdatedAt === state.updatedAt) {
      return this.#eventsCache.map((entry) => foundry.utils.deepClone(entry));
    }
    const events = state.events.map((entry) => normalizeEvent(entry));
    this.#eventsCache = events;
    this.#eventsUpdatedAt = state.updatedAt;
    this.#invalidateCaches();
    return events.map((entry) => foundry.utils.deepClone(entry));
  }

  async saveGlobalEvents(events) {
    const now = Date.now();
    const payload = {
      version: 1,
      updatedAt: now,
      events: toArray(events).map((entry) => normalizeEvent({ ...entry, updatedAt: now }))
    };
    await game.settings.set(MODULE_ID, SETTINGS_KEYS.GLOBAL_EVENTS_STATE, payload);
    this.#eventsCache = payload.events;
    this.#eventsUpdatedAt = payload.updatedAt;
    this.#invalidateCaches();
    return payload.events.map((entry) => foundry.utils.deepClone(entry));
  }

  getAllGlobalEvents() {
    return this.loadGlobalEvents().sort((left, right) => toNumber(right.updatedAt, 0) - toNumber(left.updatedAt, 0));
  }

  getGlobalEventById(id) {
    const safeId = String(id ?? "").trim();
    return this.getAllGlobalEvents().find((entry) => entry.id === safeId) ?? null;
  }

  validateGlobalEvent(event, { dataset = null } = {}) {
    const normalized = normalizeEvent(event);
    const errors = [];
    const warnings = [];
    if (!normalized.name) {
      errors.push("РќР°Р·РІР°РЅРёРµ СЃРѕР±С‹С‚РёСЏ РѕР±СЏР·Р°С‚РµР»СЊРЅРѕ.");
    }
    if (!hasScope(normalized.scope)) {
      errors.push("РЎРѕР±С‹С‚РёРµ РґРѕР»Р¶РЅРѕ РёРјРµС‚СЊ РѕР±Р»Р°СЃС‚СЊ РґРµР№СЃС‚РІРёСЏ.");
    }
    if (normalized.trigger.startDate && normalized.trigger.endDate && compareIso(normalized.trigger.endDate, normalized.trigger.startDate) < 0) {
      errors.push("Р’ С‚СЂРёРіРіРµСЂРµ РґР°С‚Р° РєРѕРЅС†Р° СЂР°РЅСЊС€Рµ РґР°С‚С‹ РЅР°С‡Р°Р»Р°.");
    }
    if (normalized.duration.startDate && normalized.duration.endDate && compareIso(normalized.duration.endDate, normalized.duration.startDate) < 0) {
      errors.push("Р’ РґР»РёС‚РµР»СЊРЅРѕСЃС‚Рё РґР°С‚Р° РєРѕРЅС†Р° СЂР°РЅСЊС€Рµ РґР°С‚С‹ РЅР°С‡Р°Р»Р°.");
    }
    if (!mergeEffects(normalized).length) {
      warnings.push("РЎРѕР±С‹С‚РёРµ РЅРµ СЃРѕРґРµСЂР¶РёС‚ СЌС„С„РµРєС‚РѕРІ.");
    }
    if (dataset) {
      const goodsById = new Set(toArray(dataset.goods).map((good) => good.id));
      const citiesById = new Set(toArray(dataset.cities).map((city) => city.id));
      const regionsById = new Set(toArray(dataset.regions).map((region) => region.id));
      const missingGoods = normalized.scope.goods.filter((goodId) => !goodsById.has(goodId));
      const missingCities = normalized.scope.cities.filter((cityId) => !citiesById.has(cityId));
      const missingRegions = normalized.scope.regions.filter((regionId) => !regionsById.has(regionId));
      if (missingGoods.length) {
        warnings.push(`РќРµ РЅР°Р№РґРµРЅС‹ С‚РѕРІР°СЂС‹: ${missingGoods.join(", ")}.`);
      }
      if (missingCities.length) {
        warnings.push(`РќРµ РЅР°Р№РґРµРЅС‹ РіРѕСЂРѕРґР°: ${missingCities.join(", ")}.`);
      }
      if (missingRegions.length) {
        warnings.push(`РќРµ РЅР°Р№РґРµРЅС‹ СЂРµРіРёРѕРЅС‹: ${missingRegions.join(", ")}.`);
      }
    }
    return {
      event: normalized,
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  async createGlobalEvent(data = {}) {
    const validation = this.validateGlobalEvent(data, { dataset: this.moduleApi?.repository?.dataset ?? null });
    if (!validation.valid) {
      throw new Error(validation.errors.join(" "));
    }
    const events = this.getAllGlobalEvents();
    const now = Date.now();
    events.push({ ...validation.event, createdAt: now, updatedAt: now });
    await this.saveGlobalEvents(events);
    return this.getGlobalEventById(validation.event.id);
  }

  async updateGlobalEvent(id, patch = {}) {
    const targetId = String(id ?? "").trim();
    const events = this.getAllGlobalEvents();
    const index = events.findIndex((entry) => entry.id === targetId);
    if (index < 0) {
      throw new Error("РЎРѕР±С‹С‚РёРµ РЅРµ РЅР°Р№РґРµРЅРѕ.");
    }
    const merged = normalizeEvent(foundry.utils.mergeObject(foundry.utils.deepClone(events[index]), patch, {
      inplace: false,
      insertKeys: true,
      overwrite: true
    }));
    merged.id = targetId;
    merged.createdAt = events[index].createdAt;
    merged.updatedAt = Date.now();
    const validation = this.validateGlobalEvent(merged, { dataset: this.moduleApi?.repository?.dataset ?? null });
    if (!validation.valid) {
      throw new Error(validation.errors.join(" "));
    }
    events[index] = validation.event;
    events[index].id = targetId;
    events[index].createdAt = merged.createdAt;
    events[index].updatedAt = merged.updatedAt;
    await this.saveGlobalEvents(events);
    return this.getGlobalEventById(targetId);
  }

  async deleteGlobalEvent(id) {
    const targetId = String(id ?? "").trim();
    await this.saveGlobalEvents(this.getAllGlobalEvents().filter((entry) => entry.id !== targetId));
    return true;
  }

  async duplicateGlobalEvent(id) {
    const event = this.getGlobalEventById(id);
    if (!event) {
      throw new Error("РЎРѕР±С‹С‚РёРµ РЅРµ РЅР°Р№РґРµРЅРѕ.");
    }
    return this.createGlobalEvent({
      ...event,
      id: "",
      name: `${event.name} (РєРѕРїРёСЏ)`,
      active: false
    });
  }

  #currentIsoDate() {
    const calendarState = game.settings.get(MODULE_ID, SETTINGS_KEYS.CALENDAR_STATE);
    const isoDate = normalizeIsoDate(calendarState?.isoDate);
    if (isoDate) {
      return isoDate;
    }
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
  }

  isEventActive(event, currentDate = null) {
    const normalized = normalizeEvent(event);
    if (!normalized.enabled) {
      return false;
    }
    const safeDate = normalizeIsoDate(currentDate) || this.#currentIsoDate();
    if (normalized.trigger.type === "manual") {
      return normalized.active === true;
    }
    const currentStamp = isoStamp(safeDate);
    if (currentStamp === null) {
      return false;
    }
    if (normalized.trigger.type === "date") {
      const startStamp = isoStamp(normalized.trigger.startDate);
      if (startStamp === null || currentStamp < startStamp) {
        return false;
      }
    }
    if (normalized.trigger.type === "dateRange") {
      const startStamp = isoStamp(normalized.trigger.startDate);
      const endStamp = isoStamp(normalized.trigger.endDate);
      if (startStamp === null || endStamp === null || currentStamp < startStamp || currentStamp > endStamp) {
        return false;
      }
    }
    if (normalized.duration.mode === "untilDisabled") {
      return true;
    }
    if (normalized.duration.mode === "instant") {
      const anchor = normalizeIsoDate(normalized.duration.startDate) || normalizeIsoDate(normalized.trigger.startDate);
      return anchor ? compareIso(safeDate, anchor) === 0 : false;
    }
    if (normalized.duration.mode === "dateRange") {
      const startStamp = isoStamp(normalized.duration.startDate);
      const endStamp = isoStamp(normalized.duration.endDate);
      return startStamp !== null && endStamp !== null && currentStamp >= startStamp && currentStamp <= endStamp;
    }
    return true;
  }

  async refreshEventActivationByDate(currentDate = null, previousDate = null) {
    const safeCurrentDate = normalizeIsoDate(currentDate) || this.#currentIsoDate();
    const safePreviousDate = normalizeIsoDate(previousDate);
    const events = this.getAllGlobalEvents();
    const started = [];
    const ended = [];
    let changed = false;
    for (const event of events) {
      if (event.trigger?.type === "manual") {
        continue;
      }
      const wasActive = safePreviousDate ? this.isEventActive(event, safePreviousDate) : Boolean(event.active);
      const nextActive = this.isEventActive(event, safeCurrentDate);
      if (event.active !== nextActive) {
        event.active = nextActive;
        event.updatedAt = Date.now();
        changed = true;
      }
      if (!wasActive && nextActive) {
        started.push(foundry.utils.deepClone(event));
      }
      else if (wasActive && !nextActive) {
        ended.push(foundry.utils.deepClone(event));
      }
    }
    if (changed) {
      await this.saveGlobalEvents(events);
    }
    if (this.isNotificationsEnabled() && game.user?.isGM) {
      for (const event of started) {
        if (event.visibility?.showNotificationOnStart !== false) {
          ui.notifications?.info(`РЎРѕР±С‹С‚РёРµ РЅР°С‡Р°Р»РѕСЃСЊ: ${event.name || event.id}.`);
        }
      }
      for (const event of ended) {
        if (event.visibility?.showNotificationOnEnd !== false) {
          ui.notifications?.info(`РЎРѕР±С‹С‚РёРµ Р·Р°РІРµСЂС€РёР»РѕСЃСЊ: ${event.name || event.id}.`);
        }
      }
    }
    return {
      changed,
      started,
      ended,
      currentDate: safeCurrentDate,
      previousDate: safePreviousDate
    };
  }

  getActiveGlobalEvents(currentDate = null) {
    if (!this.isSubsystemEnabled()) {
      return [];
    }
    const safeDate = normalizeIsoDate(currentDate) || this.#currentIsoDate();
    const events = this.getAllGlobalEvents();
    const cacheKey = `${safeDate}::${events.map((entry) => `${entry.id}:${entry.updatedAt}:${entry.active ? 1 : 0}`).join("|")}`;
    if (this.#activeCache.key === cacheKey) {
      return this.#activeCache.rows.map((entry) => foundry.utils.deepClone(entry));
    }
    const activeEvents = events.filter((entry) => this.isEventActive(entry, safeDate));
    this.#activeCache = { key: cacheKey, rows: activeEvents };
    return activeEvents.map((entry) => foundry.utils.deepClone(entry));
  }

  eventAppliesToCity(event, cityId, dataset = null) {
    const normalized = normalizeEvent(event);
    const safeCityId = String(cityId ?? "").trim();
    const cacheKey = `city::${normalized.id}::${normalized.updatedAt}::${safeCityId}`;
    if (this.#scopeCache.has(cacheKey)) {
      return this.#scopeCache.get(cacheKey);
    }
    const cities = toArray(dataset?.cities ?? this.moduleApi?.repository?.dataset?.cities);
    const city = cities.find((entry) => entry.id === safeCityId) ?? null;
    if (!city) {
      this.#scopeCache.set(cacheKey, false);
      return false;
    }
    const scope = normalized.scope;
    const result = scope.world
      || scope.cities.includes(city.id)
      || scope.regions.includes(city.regionId)
      || scope.states.includes(city.state)
      || scope.routes.some((route) => route.from === city.id || route.to === city.id);
    this.#scopeCache.set(cacheKey, result);
    return result;
  }

  eventAppliesToGood(event, goodId, goodTags = []) {
    const normalized = normalizeEvent(event);
    const scope = normalized.scope ?? defaultScope();
    if (!scope.goods.length && !scope.goodTags.length) {
      return true;
    }
    if (scope.goods.includes(goodId)) {
      return true;
    }
    const tagSet = new Set(toArray(goodTags).map((entry) => normalizeText(entry)).filter(Boolean));
    return scope.goodTags.some((tag) => tagSet.has(tag));
  }

  eventAppliesToRoute(event, fromCityId, toCityId, dataset = null, connectionId = "") {
    const normalized = normalizeEvent(event);
    const scope = normalized.scope ?? defaultScope();
    const fromId = String(fromCityId ?? "").trim();
    const toId = String(toCityId ?? "").trim();
    const safeConnectionId = String(connectionId ?? "").trim();
    if (!fromId || !toId) {
      return false;
    }
    const scopedConnectionIds = uniqueStrings(toArray(scope.routeConnectionIds));
    if (scopedConnectionIds.length) {
      if (!safeConnectionId) {
        return false;
      }
      if (scopedConnectionIds.includes(safeConnectionId)) {
        return true;
      }

      const currentPairKey = parseConnectionIdPairKey(safeConnectionId);
      if (!currentPairKey) {
        return false;
      }

      const scopedPairKeys = new Set(
        scopedConnectionIds
          .map((entry) => parseConnectionIdPairKey(entry))
          .filter(Boolean)
      );
      return scopedPairKeys.has(currentPairKey);
    }

    if (scope.routes.length && !scope.routes.some((route) => (
      (route.from === fromId && route.to === toId)
      || (route.from === toId && route.to === fromId)
    ))) {
      return false;
    }
    if (scope.world) {
      return true;
    }
    const cities = toArray(dataset?.cities ?? this.moduleApi?.repository?.dataset?.cities);
    const fromCity = cities.find((entry) => entry.id === fromId) ?? null;
    const toCity = cities.find((entry) => entry.id === toId) ?? null;
    return scope.cities.includes(fromId)
      || scope.cities.includes(toId)
      || scope.regions.includes(fromCity?.regionId)
      || scope.regions.includes(toCity?.regionId)
      || scope.states.includes(fromCity?.state)
      || scope.states.includes(toCity?.state)
      || scope.routes.length > 0;
  }

  getActiveEventsForCity(cityId, currentDate = null, dataset = null) {
    return this.getActiveGlobalEvents(currentDate).filter((event) => this.eventAppliesToCity(event, cityId, dataset));
  }

  getActiveEventsForCityGood(cityId, goodId, currentDate = null, dataset = null) {
    const goods = toArray(dataset?.goods ?? this.moduleApi?.repository?.dataset?.goods);
    const good = goods.find((entry) => entry.id === goodId);
    const goodTags = Array.from(getGoodTags(good));
    return this.getActiveEventsForCity(cityId, currentDate, dataset)
      .filter((event) => this.eventAppliesToGood(event, goodId, goodTags));
  }

  getEventsAffectingCity(cityId, currentDate = null, dataset = null) {
    return this.getActiveEventsForCity(cityId, currentDate, dataset);
  }

  getEventsAffectingCityGood(cityId, goodId, currentDate = null, dataset = null) {
    return this.getActiveEventsForCityGood(cityId, goodId, currentDate, dataset);
  }

  getEventsAffectingRoute(fromCityId, toCityId, currentDate = null, dataset = null, connectionId = "") {
    return this.getActiveGlobalEvents(currentDate)
      .filter((event) => this.eventAppliesToRoute(event, fromCityId, toCityId, dataset, connectionId));
  }

  getEventsAffectingState(stateId, currentDate = null, dataset = null) {
    const cities = toArray(dataset?.cities ?? this.moduleApi?.repository?.dataset?.cities);
    const safeStateId = String(stateId ?? "").trim();
    return this.getActiveGlobalEvents(currentDate).filter((event) => {
      if (event.scope?.world) {
        return true;
      }
      if (event.scope?.states?.includes(safeStateId)) {
        return true;
      }
      if (toArray(event.scope?.cities).some((cityId) => cities.find((city) => city.id === cityId && city.state === safeStateId))) {
        return true;
      }
      return toArray(event.scope?.regions).some((regionId) => cities.find((city) => city.regionId === regionId && city.state === safeStateId));
    });
  }

  collectEconomicModifiers({ dataset = null, currentDate = null } = {}) {
    if (!this.isSubsystemEnabled()) {
      return {
        enabled: false,
        currentDate: normalizeIsoDate(currentDate) || this.#currentIsoDate(),
        activeEvents: [],
        cityEventsByCityId: {},
        cityGoodEffectsByCityId: {},
        routeEffectsByConnectionId: {},
        stateEffectsByStateId: {}
      };
    }
    const safeDate = normalizeIsoDate(currentDate) || this.#currentIsoDate();
    const sourceDataset = dataset ?? this.moduleApi?.repository?.dataset ?? {};
    const cities = toArray(sourceDataset.cities);
    const goods = toArray(sourceDataset.goods);
    const activeEvents = this.getActiveGlobalEvents(safeDate);
    const datasetSignature = buildDatasetSignature(sourceDataset);
    const cacheKey = `${safeDate}::${activeEvents.map((entry) => `${entry.id}:${entry.updatedAt}`).join("|")}::${datasetSignature}`;
    if (this.#modifiersCache.key === cacheKey && this.#modifiersCache.value) {
      return foundry.utils.deepClone(this.#modifiersCache.value);
    }

    const cityEventsByCityId = {};
    const cityGoodEffectsByCityId = {};
    const routeEffectsByConnectionId = {};
    const stateEffectsByStateId = {};
    const states = uniqueStrings(cities.map((city) => city.state).filter(Boolean));

    for (const event of activeEvents) {
      const effects = mergeEffects(event);
      const eventRow = { id: event.id, name: event.name, priority: event?.stacking?.priority ?? DEFAULT_PRIORITY };

      for (const city of cities) {
        if (!this.eventAppliesToCity(event, city.id, sourceDataset)) {
          continue;
        }
        cityEventsByCityId[city.id] = cityEventsByCityId[city.id] ?? [];
        cityEventsByCityId[city.id].push(eventRow);

        for (const good of goods) {
          const goodTags = Array.from(getGoodTags(good));
          if (!this.eventAppliesToGood(event, good.id, goodTags)) {
            continue;
          }

          const cityBucket = cityGoodEffectsByCityId[city.id] ?? {};
          const bucket = cityBucket[good.id] ?? {
            productionEffects: [],
            demandEffects: [],
            priceEffects: [],
            importNeedEffects: [],
            selfSufficiencyEffects: [],
            availabilityBlockEffects: [],
            availabilityBoostEffects: [],
            rarityShiftEffects: [],
            merchantBuyEffects: [],
            merchantSellEffects: [],
            merchantStockEffects: [],
            merchantRestockModeEffects: [],
            merchantCategoryBoostEffects: [],
            sourceEvents: []
          };
          let hasCityGoodEffect = false;

          for (const effect of effects) {
            const row = { event, effect };
            if (effect.type === "productionMultiplier" || effect.type === "supplyFlat") {
              bucket.productionEffects.push(row);
              hasCityGoodEffect = true;
            }
            if (effect.type === "demandMultiplier" || effect.type === "demandFlat") {
              bucket.demandEffects.push(row);
              hasCityGoodEffect = true;
            }
            if (effect.type === "priceMultiplier") {
              bucket.priceEffects.push(row);
              hasCityGoodEffect = true;
            }
            if (effect.type === "importNeedMultiplier") {
              bucket.importNeedEffects.push(row);
              hasCityGoodEffect = true;
            }
            if (effect.type === "selfSufficiencyModifier") {
              bucket.selfSufficiencyEffects.push(row);
              hasCityGoodEffect = true;
            }
            if (effect.type === "availabilityBlock") {
              bucket.availabilityBlockEffects.push(row);
              hasCityGoodEffect = true;
            }
            if (effect.type === "availabilityBoost") {
              bucket.availabilityBoostEffects.push(row);
              hasCityGoodEffect = true;
            }
            if (effect.type === "rarityShift") {
              bucket.rarityShiftEffects.push(row);
              hasCityGoodEffect = true;
            }
            if (effect.type === "merchantBuyPricePercent") {
              bucket.merchantBuyEffects.push(row);
              hasCityGoodEffect = true;
            }
            if (effect.type === "merchantSellPricePercent") {
              bucket.merchantSellEffects.push(row);
              hasCityGoodEffect = true;
            }
            if (effect.type === "merchantStockPercent") {
              bucket.merchantStockEffects.push(row);
              hasCityGoodEffect = true;
            }
            if (effect.type === "merchantRestockMode") {
              bucket.merchantRestockModeEffects.push(row);
              hasCityGoodEffect = true;
            }
            if (effect.type === "merchantCategoryBoost") {
              bucket.merchantCategoryBoostEffects.push(row);
              hasCityGoodEffect = true;
            }
          }

          if (!hasCityGoodEffect) {
            continue;
          }

          bucket.sourceEvents.push(eventRow);
          cityGoodEffectsByCityId[city.id] = cityBucket;
          cityGoodEffectsByCityId[city.id][good.id] = bucket;
        }
      }

      for (const city of cities) {
        for (const connection of toArray(city.connections)) {
          if (!this.eventAppliesToRoute(event, city.id, connection.targetCityId, sourceDataset, connection.connectionId)) {
            continue;
          }
          const currentRoutePairKey = buildRoutePairKey(city.id, connection.targetCityId, connection.connectionType);
          const bucket = routeEffectsByConnectionId[connection.connectionId] ?? {
            routeCostEffects: [],
            routeCapacityEffects: [],
            disableRouteEffects: [],
            routeRiskNotes: [],
            sourceEvents: []
          };
          let hasRouteEffectForCurrentEvent = false;
          for (const effect of effects) {
            const isRouteEffect = effect.type === "routeCostPercent"
              || effect.type === "routeCapacityPercent"
              || effect.type === "disableRoute"
              || effect.type === "routeRiskNote";
            if (isRouteEffect && effect.connectionId) {
              const effectConnectionId = String(effect.connectionId ?? "").trim();
              const effectRoutePairKey = parseConnectionIdPairKey(effectConnectionId);
              const isExactConnectionMatch = effectConnectionId === connection.connectionId;
              const isPairedConnectionMatch = Boolean(effectRoutePairKey && currentRoutePairKey && effectRoutePairKey === currentRoutePairKey);
              if (!isExactConnectionMatch && !isPairedConnectionMatch) {
                continue;
              }
            }

            const row = { event, effect };
            if (effect.type === "routeCostPercent") {
              bucket.routeCostEffects.push(row);
              hasRouteEffectForCurrentEvent = true;
            }
            if (effect.type === "routeCapacityPercent") {
              bucket.routeCapacityEffects.push(row);
              hasRouteEffectForCurrentEvent = true;
            }
            if (effect.type === "disableRoute") {
              bucket.disableRouteEffects.push(row);
              hasRouteEffectForCurrentEvent = true;
            }
            if (effect.type === "routeRiskNote" && String(effect.value ?? "").trim()) {
              bucket.routeRiskNotes.push({ event, note: String(effect.value).trim() });
              hasRouteEffectForCurrentEvent = true;
            }
          }
          if (!hasRouteEffectForCurrentEvent) {
            continue;
          }
          bucket.sourceEvents.push(eventRow);
          routeEffectsByConnectionId[connection.connectionId] = bucket;
        }
      }

      for (const stateId of states) {
        if (!this.getEventsAffectingState(stateId, safeDate, sourceDataset).find((entry) => entry.id === event.id)) {
          continue;
        }
        const bucket = stateEffectsByStateId[stateId] ?? {
          stateTaxEffects: [],
          tariffEffects: [],
          bilateralTariffEffectsByTarget: {},
          sourceEvents: []
        };
        for (const effect of effects) {
          const row = { event, effect };
          if (effect.type === "stateTaxPercent") bucket.stateTaxEffects.push(row);
          if (effect.type === "tariffPercent") bucket.tariffEffects.push(row);
          if (effect.type === "bilateralTariffPercent") {
            const targets = uniqueStrings([...toArray(effect.targetStateIds), effect.targetStateId, ...toArray(event.scope?.states)])
              .filter((targetStateId) => targetStateId && targetStateId !== stateId);
            const resolvedTargets = targets.length ? targets : states.filter((targetStateId) => targetStateId !== stateId);
            for (const targetStateId of resolvedTargets) {
              const rows = bucket.bilateralTariffEffectsByTarget[targetStateId] ?? [];
              rows.push(row);
              bucket.bilateralTariffEffectsByTarget[targetStateId] = rows;
            }
          }
        }
        bucket.sourceEvents.push(eventRow);
        stateEffectsByStateId[stateId] = bucket;
      }
    }

    const routeModifiers = {};
    for (const [connectionId, routeBucket] of Object.entries(routeEffectsByConnectionId)) {
      routeModifiers[connectionId] = {
        routeCostPercent: applyPercent(routeBucket.routeCostEffects),
        routeCapacityPercent: applyPercent(routeBucket.routeCapacityEffects),
        disableRoute: applyNumeric(0, routeBucket.disableRouteEffects) > 0,
        routeRiskNotes: uniqueStrings(routeBucket.routeRiskNotes.map((entry) => entry.note)),
        sourceEventNames: uniqueStrings(routeBucket.sourceEvents.map((entry) => entry.name || entry.id))
      };
    }

    const result = {
      enabled: true,
      currentDate: safeDate,
      activeEvents: activeEvents.map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        priority: entry?.stacking?.priority ?? DEFAULT_PRIORITY
      })),
      cityEventsByCityId,
      cityGoodEffectsByCityId,
      routeEffectsByConnectionId: routeModifiers,
      stateEffectsByStateId
    };
    if (this.isDebugEnabled()) {
      console.log(`${MODULE_ID} | Global events modifiers`, {
        date: safeDate,
        activeEvents: result.activeEvents,
        cityCount: Object.keys(result.cityEventsByCityId).length,
        routeCount: Object.keys(result.routeEffectsByConnectionId).length,
        stateCount: Object.keys(result.stateEffectsByStateId).length
      });
    }
    this.#modifiersCache = { key: cacheKey, value: result };
    return foundry.utils.deepClone(result);
  }

  collectMerchantModifiers({ model = null, cityId = "", goodId = "", itemCategory = "", traderType = "", currentDate = null } = {}) {
    const modifiers = this.collectEconomicModifiers({ dataset: model ?? this.moduleApi?.repository?.model ?? this.moduleApi?.repository?.dataset ?? {}, currentDate });
    const goodBucket = modifiers.cityGoodEffectsByCityId?.[cityId]?.[goodId];
    if (!goodBucket) {
      return { buyPricePercent: 0, sellPricePercent: 0, stockPercent: 0, blocked: false, rarityShift: 0, restockMode: "", sourceEventNames: [] };
    }
    const categoryText = normalizeText(itemCategory);
    const traderTypeText = normalizeText(traderType);
    const byMerchantFilter = (row) => {
      const effectCategory = normalizeText(row.effect.merchantCategory);
      const effectTraderType = normalizeText(row.effect.merchantType);
      if (effectCategory && categoryText && effectCategory !== categoryText) {
        return false;
      }
      if (effectTraderType && traderTypeText && effectTraderType !== traderTypeText) {
        return false;
      }
      return true;
    };
    const blockValue = applyNumeric(0, goodBucket.availabilityBlockEffects.filter(byMerchantFilter));
    const boostValue = applyNumeric(0, goodBucket.availabilityBoostEffects.filter(byMerchantFilter));
    const restockOverride = [...goodBucket.merchantRestockModeEffects.filter(byMerchantFilter).filter((row) => row.effect.mode === "override")]
      .sort((left, right) => {
        const priorityDelta = toNumber(right.event?.stacking?.priority, DEFAULT_PRIORITY) - toNumber(left.event?.stacking?.priority, DEFAULT_PRIORITY);
        if (priorityDelta !== 0) {
          return priorityDelta;
        }
        return toNumber(right.event?.updatedAt, 0) - toNumber(left.event?.updatedAt, 0);
      })[0];
    return {
      buyPricePercent: applyPercent(goodBucket.merchantBuyEffects.filter(byMerchantFilter)),
      sellPricePercent: applyPercent(goodBucket.merchantSellEffects.filter(byMerchantFilter)),
      stockPercent: applyPercent([
        ...goodBucket.merchantStockEffects.filter(byMerchantFilter),
        ...goodBucket.merchantCategoryBoostEffects.filter(byMerchantFilter)
      ]),
      blocked: blockValue > boostValue,
      rarityShift: applyNumeric(0, goodBucket.rarityShiftEffects.filter(byMerchantFilter)),
      restockMode: restockOverride ? String(restockOverride.effect.value ?? "") : "",
      sourceEventNames: uniqueStrings(goodBucket.sourceEvents.map((entry) => entry.name || entry.id))
    };
  }

  getEffectiveStatePolicy(basePolicy = {}, stateId = "", currentDate = null, dataset = null) {
    const safeStateId = String(stateId ?? "").trim();
    const base = {
      taxPercent: toNumber(basePolicy.taxPercent, 0),
      generalDutyPercent: toNumber(basePolicy.generalDutyPercent, 0),
      bilateralDuties: Object.fromEntries(
        Object.entries(basePolicy.bilateralDuties ?? {}).map(([targetStateId, value]) => [targetStateId, toNumber(value, 0)])
      )
    };
    if (!safeStateId || !this.isSubsystemEnabled()) {
      return {
        ...base,
        eventDelta: { taxPercent: 0, generalDutyPercent: 0, bilateralDuties: {}, sourceEventNames: [] }
      };
    }
    const modifiers = this.collectEconomicModifiers({ dataset, currentDate });
    const stateBucket = modifiers.stateEffectsByStateId?.[safeStateId];
    if (!stateBucket) {
      return {
        ...base,
        eventDelta: { taxPercent: 0, generalDutyPercent: 0, bilateralDuties: {}, sourceEventNames: [] }
      };
    }
    const effectiveTaxPercent = applyNumeric(base.taxPercent, stateBucket.stateTaxEffects ?? []);
    const effectiveDutyPercent = applyNumeric(base.generalDutyPercent, stateBucket.tariffEffects ?? []);
    const bilateralDuties = {};
    const bilateralDelta = {};
    const targets = new Set([...Object.keys(base.bilateralDuties), ...Object.keys(stateBucket.bilateralTariffEffectsByTarget ?? {})]);
    for (const targetStateId of targets) {
      const baseValue = toNumber(base.bilateralDuties[targetStateId], 0);
      const nextValue = applyNumeric(baseValue, stateBucket.bilateralTariffEffectsByTarget?.[targetStateId] ?? []);
      bilateralDuties[targetStateId] = nextValue;
      bilateralDelta[targetStateId] = nextValue - baseValue;
    }
    return {
      taxPercent: effectiveTaxPercent,
      generalDutyPercent: effectiveDutyPercent,
      bilateralDuties,
      eventDelta: {
        taxPercent: effectiveTaxPercent - base.taxPercent,
        generalDutyPercent: effectiveDutyPercent - base.generalDutyPercent,
        bilateralDuties: bilateralDelta,
        sourceEventNames: uniqueStrings(toArray(stateBucket.sourceEvents).map((entry) => entry.name || entry.id))
      }
    };
  }

  getDefaultGlobalEventTemplates() {
    const now = Date.now();
    return [
      normalizeEvent({
        id: "template-drought",
        name: "Р—Р°СЃСѓС…Р° РІ СЂРµРіРёРѕРЅРµ",
        description: "РЎРЅРёР¶РµРЅРёРµ РїСЂРѕРёР·РІРѕРґСЃС‚РІР° РµРґС‹ Рё СЂРѕСЃС‚ С†РµРЅ РЅР° РїСЂРѕРґРѕРІРѕР»СЊСЃС‚РІРёРµ.",
        trigger: { type: "dateRange", startDate: "1200-06-01", endDate: "1200-08-31" },
        duration: { mode: "dateRange", startDate: "1200-06-01", endDate: "1200-08-31" },
        scope: { world: false, regions: [], states: [], cities: [], goods: [], goodTags: ["food", "grain", "water", "РµРґР°", "Р·РµСЂРЅРѕ", "РІРѕРґР°"], routes: [] },
        effects: [
          { type: "productionMultiplier", mode: "addPercent", value: -0.30 },
          { type: "demandMultiplier", mode: "addPercent", value: 0.15 },
          { type: "priceMultiplier", mode: "addPercent", value: 0.25 }
        ],
        createdAt: now,
        updatedAt: now
      }),
      normalizeEvent({
        id: "template-war",
        name: "Р’РѕР№РЅР° РјРµР¶РґСѓ РіРѕСЃСѓРґР°СЂСЃС‚РІР°РјРё",
        description: "Р РѕСЃС‚ РґРІСѓСЃС‚РѕСЂРѕРЅРЅРёС… РїРѕС€Р»РёРЅ Рё Р±Р»РѕРєРёСЂРѕРІРєР° С‡Р°СЃС‚Рё РјР°СЂС€СЂСѓС‚РѕРІ.",
        trigger: { type: "manual", startDate: null, endDate: null },
        duration: { mode: "untilDisabled", startDate: null, endDate: null },
        scope: { world: false, states: [], regions: [], cities: [], goods: [], goodTags: [], routes: [] },
        effects: [
          { type: "bilateralTariffPercent", mode: "addPercent", value: 0.40 },
          { type: "disableRoute", mode: "override", value: 1 }
        ],
        createdAt: now,
        updatedAt: now
      }),
      normalizeEvent({
        id: "template-harvest",
        name: "РЈСЂРѕР¶Р°Р№РЅС‹Р№ РіРѕРґ",
        description: "Р РѕСЃС‚ РїСЂРѕРёР·РІРѕРґСЃС‚РІР° РµРґС‹ Рё СЃРЅРёР¶РµРЅРёРµ С†РµРЅС‹.",
        trigger: { type: "dateRange", startDate: "1200-01-01", endDate: "1200-12-31" },
        duration: { mode: "dateRange", startDate: "1200-01-01", endDate: "1200-12-31" },
        scope: { world: false, states: [], regions: [], cities: [], goods: [], goodTags: ["food", "grain", "РµРґР°", "Р·РµСЂРЅРѕ"], routes: [] },
        effects: [
          { type: "productionMultiplier", mode: "addPercent", value: 0.25 },
          { type: "priceMultiplier", mode: "addPercent", value: -0.10 }
        ],
        createdAt: now,
        updatedAt: now
      }),
      normalizeEvent({
        id: "template-mine-collapse",
        name: "РЁР°С…С‚РЅС‹Р№ РѕР±РІР°Р»",
        description: "РџР°РґР°РµС‚ РґРѕР±С‹С‡Р° РјРµС‚Р°Р»Р»РѕРІ, Р° Сѓ С‚РѕСЂРіРѕРІС†РµРІ РјРµРЅСЊС€Рµ РјР°С‚РµСЂРёР°Р»РѕРІ.",
        trigger: { type: "manual", startDate: null, endDate: null },
        duration: { mode: "untilDisabled", startDate: null, endDate: null },
        scope: { world: false, states: [], regions: [], cities: [], goods: [], goodTags: ["ore", "metal", "СЂСѓРґР°", "РјРµС‚Р°Р»Р»"], routes: [] },
        effects: [
          { type: "productionMultiplier", mode: "addPercent", value: -0.50 },
          { type: "merchantStockPercent", mode: "addPercent", value: -0.30 },
          { type: "routeRiskNote", mode: "flat", value: "РџРѕРІС‹С€РµРЅРЅС‹Р№ СЂРёСЃРє РѕР±РІР°Р»РѕРІ РЅР° РјР°СЂС€СЂСѓС‚Рµ." }
        ],
        createdAt: now,
        updatedAt: now
      }),
      normalizeEvent({
        id: "template-monopoly",
        name: "РўРѕСЂРіРѕРІР°СЏ РјРѕРЅРѕРїРѕР»РёСЏ",
        description: "Р РѕСЃС‚ С‚РѕСЂРіРѕРІРѕР№ С†РµРЅС‹ Рё Р±Р»РѕРєРёСЂРѕРІРєР° С‡Р°СЃС‚Рё Р°СЃСЃРѕСЂС‚РёРјРµРЅС‚Р°.",
        trigger: { type: "manual", startDate: null, endDate: null },
        duration: { mode: "untilDisabled", startDate: null, endDate: null },
        scope: { world: false, states: [], regions: [], cities: [], goods: [], goodTags: ["trade", "С‚РѕРІР°СЂ"], routes: [] },
        effects: [
          { type: "merchantSellPricePercent", mode: "addPercent", value: 0.20, merchantCategory: "gear" },
          { type: "availabilityBlock", mode: "override", value: 1, merchantCategory: "material" }
        ],
        createdAt: now,
        updatedAt: now
      })
    ];
  }

  async importDefaultGlobalEventTemplates() {
    const templates = this.getDefaultGlobalEventTemplates();
    const existingEvents = this.getAllGlobalEvents();
    const existingIds = new Set(existingEvents.map((entry) => entry.id));
    const now = Date.now();
    const imported = [];
    for (const template of templates) {
      const nextEvent = foundry.utils.deepClone(template);
      if (existingIds.has(nextEvent.id)) {
        nextEvent.id = `global-event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      }
      nextEvent.createdAt = now;
      nextEvent.updatedAt = now;
      nextEvent.active = false;
      existingEvents.push(nextEvent);
      existingIds.add(nextEvent.id);
      imported.push(nextEvent);
    }
    await this.saveGlobalEvents(existingEvents);
    return imported.map((entry) => foundry.utils.deepClone(entry));
  }

  applyEventEffectsToEconomicNode(baseData = {}, context = {}) {
    return {
      ...baseData,
      value: applyNumeric(toNumber(baseData.value, 0), toArray(context.entries))
    };
  }

  applyEventEffectsToRoute(routeData = {}, context = {}) {
    return {
      ...routeData,
      costPercent: applyPercent(toArray(context.entries))
    };
  }

  applyEventEffectsToMerchant(merchantData = {}, context = {}) {
    return {
      ...merchantData,
      modifierPercent: applyPercent(toArray(context.entries))
    };
  }
}

