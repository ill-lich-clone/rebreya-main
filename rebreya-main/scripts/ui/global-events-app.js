import { MODULE_ID, SETTINGS_KEYS } from "../constants.js";
import { bringAppToFront, getAppElement } from "../ui.js";

const {
  ApplicationV2,
  HandlebarsApplicationMixin,
  DialogV2,
  Dialog: DialogApi
} = foundry.applications.api;

const EVENT_PRESETS = [
  { id: "drought", label: "Засуха", hint: "Еды меньше, цены выше.", effects: [
    { target: "production", op: "dec", value: 30 },
    { target: "demand", op: "inc", value: 15 },
    { target: "price", op: "inc", value: 25 }
  ] },
  { id: "war", label: "Война", hint: "Пошлины и стоимость маршрутов растут.", effects: [
    { target: "tariff", op: "inc", value: 40 },
    { target: "routeCost", op: "inc", value: 20 },
    { target: "disableRoute", op: "disable", value: 1 }
  ] },
  { id: "epidemic", label: "Эпидемия", hint: "Спрос растет, ассортимент сужается.", effects: [
    { target: "demand", op: "inc", value: 20 },
    { target: "price", op: "inc", value: 10 },
    { target: "merchantStock", op: "dec", value: 20 }
  ] },
  { id: "festival", label: "Праздник", hint: "Спрос и цены растут.", effects: [
    { target: "demand", op: "inc", value: 15 },
    { target: "price", op: "inc", value: 10 }
  ] },
  { id: "harvest", label: "Урожайный год", hint: "Производство выше, цена ниже.", effects: [
    { target: "production", op: "inc", value: 25 },
    { target: "price", op: "dec", value: 10 }
  ] },
  { id: "accident", label: "Авария", hint: "Производство падает, поставки сложнее.", effects: [
    { target: "production", op: "dec", value: 35 },
    { target: "routeCost", op: "inc", value: 15 }
  ] },
  { id: "monopoly", label: "Монополия", hint: "Цены выше, часть товаров скрыта.", effects: [
    { target: "merchantSell", op: "inc", value: 20, merchantCategory: "gear" },
    { target: "availabilityBlock", op: "disable", value: 1, merchantCategory: "material" }
  ] },
  { id: "blockade", label: "Торговая блокада", hint: "Маршруты дороже и слабее.", effects: [
    { target: "routeCost", op: "inc", value: 30 },
    { target: "routeCapacity", op: "dec", value: 40 },
    { target: "disableRoute", op: "disable", value: 1 }
  ] },
  { id: "custom", label: "Пользовательское", hint: "Соберите событие вручную.", effects: [] }
];

const EFFECT_TARGETS = [
  { id: "production", label: "Производство товаров", type: "productionMultiplier" },
  { id: "demand", label: "Спрос на товары", type: "demandMultiplier" },
  { id: "price", label: "Цена товаров", type: "priceMultiplier" },
  { id: "stateTax", label: "Налоги государства", type: "stateTaxPercent" },
  { id: "tariff", label: "Торговые пошлины", type: "tariffPercent" },
  { id: "bilateralTariff", label: "Двусторонняя пошлина", type: "bilateralTariffPercent" },
  { id: "merchantBuy", label: "Цена выкупа у торговца", type: "merchantBuyPricePercent" },
  { id: "merchantSell", label: "Цена продажи у торговца", type: "merchantSellPricePercent" },
  { id: "merchantStock", label: "Размер ассортимента торговцев", type: "merchantStockPercent" },
  { id: "availabilityBlock", label: "Скрыть товары из продажи", type: "availabilityBlock", disableOnly: true },
  { id: "availabilityBoost", label: "Сделать товары доступнее", type: "availabilityBoost" },
  { id: "rarityShift", label: "Редкость товаров", type: "rarityShift" },
  { id: "routeCost", label: "Стоимость маршрутов", type: "routeCostPercent" },
  { id: "routeCapacity", label: "Пропускная способность маршрутов", type: "routeCapacityPercent" },
  { id: "disableRoute", label: "Полностью перекрыть маршруты", type: "disableRoute", disableOnly: true }
];
const ROUTE_EFFECT_TARGET_IDS = new Set(["routeCost", "routeCapacity", "disableRoute"]);
const ROUTE_EFFECT_TYPES = new Set(["routeCostPercent", "routeCapacityPercent", "disableRoute"]);
const NON_ROUTE_EFFECT_TARGETS = EFFECT_TARGETS.filter((row) => !ROUTE_EFFECT_TARGET_IDS.has(row.id));
const ROUTE_EFFECT_ACTIONS = [
  { id: "routeCost", label: "Цена маршрута" },
  { id: "routeCapacity", label: "Пропускная способность маршрута" },
  { id: "disableRoute", label: "Полностью перекрыть маршрут" }
];
const MERCHANT_CATEGORY_TARGET_IDS = new Set(["merchantBuy", "merchantSell", "merchantStock", "availabilityBlock", "availabilityBoost"]);

function toNumber(value, fallback = 0) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toInt(value, fallback = 0) {
  return Math.round(toNumber(value, fallback));
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function hasCyrillic(value) {
  return /[\u0400-\u04FF]/u.test(String(value ?? ""));
}

const ROUTE_TYPE_ALIAS_GROUPS = [
  ["land", "ground", "road", "земля", "суша", "сухопут", "дорога"],
  ["sea", "ocean", "мор", "море", "морской"],
  ["river", "canal", "река", "речной", "канал"],
  ["air", "sky", "flight", "воздух", "воздуш", "авиа"],
  ["rail", "train", "желез", "жд", "поезд"]
];

function resolveRouteTypeTokens(value) {
  const text = normalizeText(value);
  if (!text) {
    return new Set();
  }
  const tokens = new Set([text]);
  for (const group of ROUTE_TYPE_ALIAS_GROUPS) {
    const normalizedGroup = group.map((entry) => normalizeText(entry)).filter(Boolean);
    if (normalizedGroup.some((entry) => text.includes(entry) || entry.includes(text))) {
      for (const entry of normalizedGroup) {
        tokens.add(entry);
      }
    }
  }
  return tokens;
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

function buildEffectSubjectOptions(routeConnectionOptions = []) {
  const effectOptions = NON_ROUTE_EFFECT_TARGETS
    .map((item) => ({ value: `effect:${item.id}`, label: item.label }));
  const routeOptions = [
    { value: "route:*", label: "Маршрут: все выбранные связи" },
    ...(routeConnectionOptions ?? []).map((row) => ({
      value: `route:${String(row.value ?? "").trim()}`,
      label: `Маршрут: ${String(row.label ?? row.value ?? "").trim()}`
    }))
  ];
  return [...effectOptions, ...routeOptions];
}

function isRouteSubject(value) {
  return String(value ?? "").trim().startsWith("route:");
}

function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function getPreset(type) {
  return EVENT_PRESETS.find((row) => row.id === type) ?? EVENT_PRESETS[EVENT_PRESETS.length - 1];
}

function getDialogRoot(...inputs) {
  const queue = [];
  for (const input of inputs) {
    if (Array.isArray(input)) {
      queue.push(...input);
    } else {
      queue.push(input);
    }
  }

  for (const html of queue) {
    if (!html) {
      continue;
    }

    if (html instanceof HTMLElement) {
      return html;
    }

    if (html[0] instanceof HTMLElement) {
      return html[0];
    }

    const element = html.element ?? html.target ?? html.currentTarget ?? null;
    if (element instanceof HTMLElement) {
      return element;
    }
    if (element?.[0] instanceof HTMLElement) {
      return element[0];
    }
  }

  return null;
}

function resolveDialogClass() {
  const globalDialog = globalThis.Dialog;
  if (typeof globalDialog === "function") {
    const name = String(globalDialog.name ?? "").toLowerCase();
    if (!name.includes("dialogv2")) {
      return globalDialog;
    }
  }

  if (typeof DialogApi === "function") {
    return DialogApi;
  }

  if (typeof globalDialog === "function") {
    return globalDialog;
  }

  return null;
}

function isDialogV2Class(DialogClass) {
  if (!DialogClass) {
    return false;
  }

  if (DialogClass === DialogV2) {
    return true;
  }

  const className = String(DialogClass.name ?? "").toLowerCase();
  return className.includes("dialogv2");
}

function buildEditorDialogButtons(DialogClass) {
  const noop = () => {};
  if (isDialogV2Class(DialogClass)) {
    return [
      {
        action: "close",
        label: "Закрыть",
        callback: noop
      }
    ];
  }

  return {
    close: {
      label: "Закрыть",
      callback: noop
    }
  };
}

function formatUtcTodayIsoDate() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resolveDefaultStartDate(moduleApi) {
  const fromCalendar = String(moduleApi?.getCalendarSnapshot?.()?.isoDate ?? "").trim();
  if (/^\d{1,6}-\d{2}-\d{2}$/u.test(fromCalendar)) {
    return fromCalendar;
  }
  return formatUtcTodayIsoDate();
}

function registerOption(map, rawValue, rawLabel = rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) return;
  if (map.has(value)) return;
  const label = String(rawLabel ?? value).trim() || value;
  map.set(value, label);
}

function mapToSortedOptions(map) {
  return Array.from(map.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label, "ru"));
}

function registerTagOption(map, rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) {
    return;
  }

  const key = normalizeText(value);
  if (!key) {
    return;
  }

  const priority = hasCyrillic(value) ? 2 : 1;
  const current = map.get(key);
  if (!current || priority > current.priority) {
    map.set(key, {
      value,
      label: value,
      priority
    });
  }
}

async function getSelectionOptions(moduleApi) {
  let model = moduleApi?.repository?.model ?? null;
  let dataset = moduleApi?.repository?.dataset ?? null;
  if ((!model || !dataset) && typeof moduleApi?.getModel === "function") {
    try {
      model = await moduleApi.getModel();
      dataset = moduleApi?.repository?.dataset ?? dataset;
    } catch (error) {
      console.warn(`${MODULE_ID} | Failed to load model for global events editor options.`, error);
    }
  }

  const safeModel = model ?? {};
  const safeDataset = dataset ?? {};
  const stateMap = new Map();
  const regionMap = new Map();
  const cityMap = new Map();
  const goodsMap = new Map();
  const tagMap = new Map();
  const tagCanonicalByNormalized = new Map();
  const connectionGroupsByPairKey = new Map();
  const connectionAliasToCanonicalId = new Map();
  const connectionTypeMap = new Map();
  const categoryToGroupName = new Map();
  const regionMetaById = new Map();
  const cityMetaById = new Map();
  const goodsMetaById = new Map();

  const regionRows = [
    ...(Array.isArray(safeModel.regionSummaries) ? safeModel.regionSummaries : []),
    ...(Array.isArray(safeModel.regions) ? safeModel.regions : []),
    ...(Array.isArray(safeDataset.regions) ? safeDataset.regions : [])
  ];
  for (const row of regionRows) {
    const id = String(row?.id ?? "").trim();
    const name = String(row?.name ?? id).trim();
    const state = String(row?.state ?? "").trim();
    if (id) {
      const label = state ? `${name} (${state})` : name;
      registerOption(regionMap, id, label);
      if (!regionMetaById.has(id)) {
        regionMetaById.set(id, { value: id, label, state });
      }
    }
    if (state) {
      registerOption(stateMap, state, state);
    }
  }

  const cityRows = [
    ...(Array.isArray(safeModel.cities) ? safeModel.cities : []),
    ...(Array.isArray(safeDataset.cities) ? safeDataset.cities : [])
  ];
  for (const row of cityRows) {
    const id = String(row?.id ?? "").trim();
    const name = String(row?.name ?? id).trim();
    const state = String(row?.state ?? "").trim();
    const regionId = String(row?.regionId ?? "").trim();
    if (id) {
      const label = state ? `${name} (${state})` : name;
      registerOption(cityMap, id, label);
      if (!cityMetaById.has(id)) {
        cityMetaById.set(id, { value: id, label, state, regionId });
      }
    }
    if (state) {
      registerOption(stateMap, state, state);
    }
  }

  const stateRows = Array.isArray(safeModel.stateSummaries) ? safeModel.stateSummaries : [];
  for (const row of stateRows) {
    const stateId = String(row?.id ?? row?.state ?? "").trim();
    const stateName = String(row?.name ?? stateId).trim();
    if (stateId) {
      registerOption(stateMap, stateId, stateName || stateId);
    }
  }

  const goodsRows = [
    ...(Array.isArray(safeModel.goods) ? safeModel.goods : []),
    ...(Array.isArray(safeDataset.goods) ? safeDataset.goods : [])
  ];
  for (const row of goodsRows) {
    const id = String(row?.id ?? "").trim();
    const name = String(row?.name ?? id).trim();
    const category = String(row?.category ?? "").trim();
    const groupName = String(row?.groupName ?? "").trim();
    if (id) {
      registerOption(goodsMap, id, name || id);
      if (!goodsMetaById.has(id)) {
        goodsMetaById.set(id, {
          value: id,
          label: name || id,
          category,
          groupName
        });
      }
    }
    if (groupName && category) {
      const categoryKey = normalizeText(category);
      if (categoryKey && !categoryToGroupName.has(categoryKey)) {
        categoryToGroupName.set(categoryKey, groupName);
      }
    }
  }

  for (const row of goodsRows) {
    const category = String(row?.category ?? "").trim();
    const groupName = String(row?.groupName ?? "").trim();
    const categoryKey = normalizeText(category);
    const aliasGroup = categoryKey ? (categoryToGroupName.get(categoryKey) ?? "") : "";
    const preferredTag = groupName || aliasGroup || category;
    if (preferredTag) {
      registerTagOption(tagMap, preferredTag);
      const preferredKey = normalizeText(preferredTag);
      if (preferredKey) {
        tagCanonicalByNormalized.set(preferredKey, preferredTag);
      }
    }
    if (categoryKey && preferredTag) {
      tagCanonicalByNormalized.set(categoryKey, preferredTag);
    }
    const groupKey = normalizeText(groupName);
    if (groupKey && groupName) {
      tagCanonicalByNormalized.set(groupKey, groupName);
    }
  }

  const cityLabelById = new Map();
  for (const row of cityRows) {
    const cityId = String(row?.id ?? "").trim();
    if (!cityId || cityLabelById.has(cityId)) {
      continue;
    }
    cityLabelById.set(cityId, String(row?.name ?? cityId).trim() || cityId);
  }

  for (const city of Array.isArray(safeModel.cities) ? safeModel.cities : []) {
    const fromCityId = String(city?.id ?? "").trim();
    if (!fromCityId) {
      continue;
    }

    for (const connection of Array.isArray(city?.connections) ? city.connections : []) {
      const connectionId = String(connection?.connectionId ?? "").trim();
      const toCityId = String(connection?.targetCityId ?? "").trim();
      if (!connectionId || !toCityId) {
        continue;
      }

      const connectionType = String(connection?.connectionType ?? "").trim();
      const routePairKey = buildRoutePairKey(fromCityId, toCityId, connectionType);
      if (!routePairKey) {
        continue;
      }

      const [leftCityId, rightCityId] = [fromCityId, toCityId].sort((left, right) => left.localeCompare(right, "ru"));
      const leftCityName = cityLabelById.get(leftCityId) ?? leftCityId;
      const rightCityName = cityLabelById.get(rightCityId) ?? rightCityId;
      const existingGroup = connectionGroupsByPairKey.get(routePairKey);
      if (existingGroup) {
        if (!existingGroup.memberConnectionIds.includes(connectionId)) {
          existingGroup.memberConnectionIds.push(connectionId);
        }
      } else {
        connectionGroupsByPairKey.set(routePairKey, {
          pairKey: routePairKey,
          fromCityId: leftCityId,
          toCityId: rightCityId,
          fromCityName: leftCityName,
          toCityName: rightCityName,
          connectionType,
          memberConnectionIds: [connectionId]
        });
      }

      if (connectionType) {
        registerOption(connectionTypeMap, connectionType, connectionType);
      }
    }
  }

  const states = mapToSortedOptions(stateMap);
  const regions = mapToSortedOptions(regionMap).map((row) => ({
    ...row,
    state: regionMetaById.get(row.value)?.state ?? ""
  }));
  const cities = mapToSortedOptions(cityMap).map((row) => ({
    ...row,
    state: cityMetaById.get(row.value)?.state ?? "",
    regionId: cityMetaById.get(row.value)?.regionId ?? ""
  }));
  const goods = mapToSortedOptions(goodsMap).map((row) => ({
    ...row,
    category: goodsMetaById.get(row.value)?.category ?? "",
    groupName: goodsMetaById.get(row.value)?.groupName ?? ""
  }));
  const tags = Array.from(tagMap.values())
    .map((row) => ({ value: row.value, label: row.label }))
    .sort((left, right) => left.label.localeCompare(right.label, "ru"));
  const connections = Array.from(connectionGroupsByPairKey.values())
    .map((group) => {
      const memberConnectionIds = [...new Set((group.memberConnectionIds ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, "ru"));
      const canonicalId = memberConnectionIds[0] ?? "";
      for (const aliasId of memberConnectionIds) {
        connectionAliasToCanonicalId.set(aliasId, canonicalId);
      }
      if (!canonicalId) {
        return null;
      }

      const label = `${group.fromCityName} <-> ${group.toCityName}${group.connectionType ? ` (${group.connectionType})` : ""} · ${canonicalId}`;
      return {
        value: canonicalId,
        label,
        fromCityId: group.fromCityId,
        toCityId: group.toCityId,
        connectionType: group.connectionType,
        memberConnectionIds
      };
    })
    .filter(Boolean)
    .sort((left, right) => String(left.label ?? "").localeCompare(String(right.label ?? ""), "ru"));
  const connectionTypes = mapToSortedOptions(connectionTypeMap);

  return {
    states,
    regions,
    cities,
    goods,
    tags,
    tagCanonicalByNormalized,
    connectionAliasToCanonicalId,
    connections,
    connectionTypes
  };
}

function selectOptions(items = [], selected = []) {
  const selectedSet = new Set(selected);
  return items.map((row) => `<option value="${escapeHtml(row.value)}" ${selectedSet.has(row.value) ? "selected" : ""}>${escapeHtml(row.label)}</option>`).join("");
}

function emptyEditorState(defaultStartDate = "") {
  return {
    id: "",
    name: "",
    description: "",
    eventType: "custom",
    scopeWorld: true,
    scopeMode: "world",
    scheduleMode: "manual",
    startDate: String(defaultStartDate ?? "").trim(),
    endDate: "",
    activeNow: false,
    states: [],
    regions: [],
    cities: [],
    goods: [],
    tags: [],
    goodsAll: true,
    routes: [{ from: "", to: "" }],
    routeConnectionIds: [],
    routeEffectConnectionId: "",
    effects: [],
    advanced: false,
    enabled: true,
    stackingMode: "stack",
    priority: 100,
    gmOnly: true,
    notifyStart: true,
    notifyEnd: true
  };
}

function draftState() {
  const raw = game.settings.get(MODULE_ID, SETTINGS_KEYS.GLOBAL_EVENTS_DRAFT);
  return raw?.draft && typeof raw.draft === "object" ? foundry.utils.deepClone(raw.draft) : null;
}

async function saveDraftState(state) {
  await game.settings.set(MODULE_ID, SETTINGS_KEYS.GLOBAL_EVENTS_DRAFT, { updatedAt: Date.now(), draft: foundry.utils.deepClone(state) });
}

async function clearDraftState() {
  await game.settings.set(MODULE_ID, SETTINGS_KEYS.GLOBAL_EVENTS_DRAFT, { updatedAt: Date.now(), draft: null });
}

function effectToInternal(effect, routeEffectConnectionId = "") {
  const target = EFFECT_TARGETS.find((row) => row.id === effect.target);
  if (!target) return null;
  const row = { type: target.type, mode: "addPercent", value: 0 };
  if (effect.op === "disable") {
    row.mode = "override";
    row.value = 1;
  } else if (effect.op === "mul") {
    row.mode = "multiply";
    row.value = toNumber(effect.value, 1);
  } else if (effect.op === "set") {
    row.mode = "override";
    row.value = toNumber(effect.value, 0);
  } else {
    const sign = effect.op === "dec" ? -1 : 1;
    row.mode = "addPercent";
    row.value = sign * Math.abs(toNumber(effect.value, 0)) / 100;
  }

  const safeRouteConnectionId = String(effect.connectionId ?? routeEffectConnectionId ?? "").trim();
  if (
    safeRouteConnectionId
    && (row.type === "routeCostPercent" || row.type === "routeCapacityPercent" || row.type === "disableRoute")
  ) {
    row.connectionId = safeRouteConnectionId;
  }

  if (effect.merchantCategory) row.merchantCategory = effect.merchantCategory;
  return row;
}

function buildPayload(state) {
  const scope = { world: state.scopeWorld !== false, states: [], regions: [], cities: [], goods: [], goodTags: [], routes: [], routeConnectionIds: [] };

  if (!scope.world) {
    if ((state.cities ?? []).length) {
      scope.cities = [...state.cities];
    } else if ((state.regions ?? []).length) {
      scope.regions = [...state.regions];
    } else {
      scope.states = [...(state.states ?? [])];
    }
  }

  if (state.goodsAll) {
    scope.goods = [];
    scope.goodTags = [];
  } else if ((state.goods ?? []).length) {
    scope.goods = [...state.goods];
  } else {
    scope.goodTags = [...new Set((state.tags ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
  }

  scope.routes = (state.routes ?? [])
    .map((row) => ({ from: row.from, to: row.to }))
    .filter((row) => row.from && row.to);
  scope.routeConnectionIds = [...new Set((state.routeConnectionIds ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];

  const trigger = { type: "manual", startDate: null, endDate: null };
  const duration = { mode: "untilDisabled", startDate: null, endDate: null };
  let active = state.activeNow;
  if (state.scheduleMode === "date") {
    trigger.type = "date";
    trigger.startDate = state.startDate || null;
    active = false;
  }
  if (state.scheduleMode === "dateRange") {
    trigger.type = "dateRange";
    trigger.startDate = state.startDate || null;
    trigger.endDate = state.endDate || null;
    duration.mode = "dateRange";
    duration.startDate = state.startDate || null;
    duration.endDate = state.endDate || null;
    active = false;
  }

  const effectiveRouteEffectConnectionId = String(state.routeEffectConnectionId ?? "").trim()
    || (scope.routeConnectionIds.length === 1 ? scope.routeConnectionIds[0] : "");

  return {
    id: state.id || "",
    name: state.name,
    description: state.description,
    eventType: state.eventType,
    enabled: state.advanced ? state.enabled : true,
    active,
    trigger,
    duration,
    scope,
    stacking: {
      mode: state.advanced ? state.stackingMode : "stack",
      priority: state.advanced ? toInt(state.priority, 100) : 100
    },
    effects: state.effects.map((effect) => effectToInternal(effect, effectiveRouteEffectConnectionId)).filter(Boolean),
    merchantEffects: { restockModifier: 0, rarityShift: 0, priceModifier: 0, stockModifier: 0 },
    routeEffects: { disableRoutes: false, routeCostPercent: 0, routeCapacityPercent: 0 },
    taxEffects: { stateTaxModifierPercent: 0, tariffModifierPercent: 0, bilateralTariffPercent: 0 },
    visibility: {
      gmOnly: state.gmOnly,
      showNotificationOnStart: state.notifyStart,
      showNotificationOnEnd: state.notifyEnd
    }
  };
}

function internalEffectsToRows(effects = []) {
  const byType = new Map(EFFECT_TARGETS.map((row) => [row.type, row.id]));
  return effects
    .map((effect) => {
      const target = byType.get(effect?.type);
      if (!target) return null;
      const routeConnectionId = String(effect.connectionId ?? "").trim();
      const base = {
        target: ROUTE_EFFECT_TARGET_IDS.has(target) ? `route:${routeConnectionId || "*"}` : target,
        merchantCategory: effect.merchantCategory ?? "",
        connectionId: routeConnectionId,
        routeAction: ROUTE_EFFECT_TARGET_IDS.has(target) ? target : ""
      };
      if (effect.mode === "override" && (target === "disableRoute" || target === "availabilityBlock")) {
        return { ...base, op: "disable", value: 1 };
      }
      if (effect.mode === "multiply") {
        return { ...base, op: "mul", value: toNumber(effect.value, 1) };
      }
      if (effect.mode === "override" || effect.mode === "flat") {
        return { ...base, op: "set", value: toNumber(effect.value, 0) };
      }
      const percent = toNumber(effect.value, 0) * 100;
      return {
        ...base,
        op: percent >= 0 ? "inc" : "dec",
        value: Math.abs(percent),
      };
    })
    .filter(Boolean);
}

function parseState(root) {
  const read = (name) => root.querySelector(`[name='${name}']`);
  const pickChecked = (selector) => Array.from(root.querySelectorAll(selector))
    .filter((field) => field instanceof HTMLInputElement && field.checked)
    .map((field) => String(field.value ?? "").trim())
    .filter(Boolean);
  const effects = Array.from(root.querySelectorAll("[data-effect-row]")).map((row) => {
    const rawTarget = String(row.querySelector("[data-effect-target]")?.value ?? "price").trim();
    const rawAction = String(row.querySelector("[data-effect-op]")?.value ?? "inc").trim();
    const rawValue = toNumber(row.querySelector("[data-effect-value]")?.value, 0);
    const merchantCategory = String(row.querySelector("[data-effect-merchant-category]")?.value ?? "");
    if (isRouteSubject(rawTarget)) {
      const connectionToken = String(rawTarget.slice("route:".length) ?? "").trim();
      const connectionId = connectionToken === "*" ? "" : connectionToken;
      const routeAction = ROUTE_EFFECT_TARGET_IDS.has(rawAction) ? rawAction : "routeCost";
      if (routeAction === "disableRoute") {
        return { target: routeAction, op: "disable", value: 1, merchantCategory: "", connectionId, routeAction };
      }
      return {
        target: routeAction,
        op: rawValue >= 0 ? "inc" : "dec",
        value: Math.abs(rawValue),
        merchantCategory: "",
        connectionId,
        routeAction
      };
    }

    return {
      target: String(rawTarget.replace(/^effect:/u, "")).trim() || "price",
      op: rawAction,
      value: rawValue,
      merchantCategory,
      connectionId: "",
      routeAction: ""
    };
  });
  const scopeWorld = read("scopeWorld")?.checked !== false;
  return {
    id: String(read("id")?.value ?? ""),
    name: String(read("name")?.value ?? "").trim(),
    description: String(read("description")?.value ?? "").trim(),
    eventType: String(read("eventType")?.value ?? "custom"),
    scopeWorld,
    scopeMode: scopeWorld ? "world" : "combination",
    scheduleMode: String(read("scheduleMode")?.value ?? "manual"),
    startDate: String(read("startDate")?.value ?? "").trim(),
    endDate: String(read("endDate")?.value ?? "").trim(),
    activeNow: read("activeNow")?.checked === true,
    states: pickChecked("[data-scope-state]"),
    regions: pickChecked("[data-scope-region]"),
    cities: pickChecked("[data-scope-city]"),
    goods: pickChecked("[data-good-checkbox]"),
    tags: pickChecked("[data-tag-checkbox]"),
    goodsAll: read("goodsAll")?.checked === true,
    routes: [],
    routeConnectionIds: pickChecked("[data-route-connection-checkbox]"),
    routeEffectConnectionId: String(read("routeEffectConnectionId")?.value ?? "").trim(),
    effects,
    advanced: read("advanced")?.checked === true,
    enabled: read("enabled")?.checked !== false,
    stackingMode: String(read("stackingMode")?.value ?? "stack"),
    priority: toInt(read("priority")?.value, 100),
    gmOnly: read("gmOnly")?.checked !== false,
    notifyStart: read("notifyStart")?.checked !== false,
    notifyEnd: read("notifyEnd")?.checked !== false
  };
}

function validateState(state) {
  const errors = [];
  const warnings = [];
  if (!state.name) errors.push("Введите название события.");
  const hasScope = state.scopeWorld
    || state.states.length
    || state.regions.length
    || state.cities.length
    || state.routeConnectionIds.length
    || state.routes.length;
  if (!hasScope) errors.push("Выберите, где действует событие.");
  if (state.scheduleMode === "date" && !state.startDate) errors.push("Укажите дату начала.");
  if (state.scheduleMode === "dateRange" && (!state.startDate || !state.endDate)) errors.push("Укажите дату начала и окончания.");
  if (state.scheduleMode === "dateRange" && state.startDate && state.endDate && state.endDate < state.startDate) errors.push("Дата окончания раньше даты начала.");
  if (!state.effects.length) warnings.push("Сейчас событие ничего не меняет.");
  return { errors, warnings };
}

function formatIsoDateForView(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{1,6})-(\d{2})-(\d{2})$/u);
  if (!match) {
    return text || "не задана";
  }
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function buildEventDateLabel(event) {
  const triggerType = event?.trigger?.type ?? "manual";
  const startDate = event?.trigger?.startDate ?? event?.duration?.startDate ?? "";
  const endDate = event?.trigger?.endDate ?? event?.duration?.endDate ?? "";
  if (triggerType === "dateRange") {
    if (startDate && endDate) {
      return `${formatIsoDateForView(startDate)} - ${formatIsoDateForView(endDate)}`;
    }
    if (startDate) {
      return `С ${formatIsoDateForView(startDate)} до отключения`;
    }
    return "Период не задан";
  }
  if (triggerType === "date") {
    return `Дата: ${formatIsoDateForView(startDate)}`;
  }
  return "Ручной запуск";
}

function buildScopeLabel(event) {
  const scope = event?.scope ?? {};
  if (scope.world) return "Весь мир";
  const cityCount = (scope.cities ?? []).length;
  if (cityCount) return `Города: ${cityCount}`;
  const regionCount = (scope.regions ?? []).length;
  if (regionCount) return `Регионы: ${regionCount}`;
  const stateCount = (scope.states ?? []).length;
  if (stateCount) return `Государства: ${stateCount}`;
  const routeConnectionCount = (scope.routeConnectionIds ?? []).length;
  if (routeConnectionCount) return `Связи: ${routeConnectionCount}`;
  const routeCount = (scope.routes ?? []).length;
  if (routeCount) return `Маршруты: ${routeCount}`;
  return "Выборочная область";
}

function mapEventForView(event, activeEventIds) {
  const activeByDate = activeEventIds.has(event.id);
  const enabled = event.enabled !== false;
  const status = !enabled ? "disabled" : (activeByDate ? "active" : "inactive");
  const triggerTypeLabel = event.trigger?.type === "dateRange"
    ? "По периоду"
    : (event.trigger?.type === "date" ? "По дате" : "Вручную");
  return {
    ...event,
    status,
    triggerTypeLabel,
    statusLabel: status === "active" ? "Активен" : (status === "disabled" ? "Выключен" : "Неактивен"),
    statusClass: status === "active" ? "rm-badge--good" : (status === "disabled" ? "rm-badge--warn" : ""),
    scopeLabel: buildScopeLabel(event),
    dateLabel: buildEventDateLabel(event),
    effectsCount: (event.effects ?? []).length,
    priority: toInt(event?.stacking?.priority, 100)
  };
}

function shouldIncludeByFilter(event, filters) {
  if (filters.status === "active" && event.status !== "active") return false;
  if (filters.status === "inactive" && event.status !== "inactive") return false;
  if (filters.status === "disabled" && event.status !== "disabled") return false;
  const search = String(filters.search ?? "").trim().toLowerCase();
  if (!search) return true;
  return `${event.name ?? ""} ${event.description ?? ""} ${event.scopeLabel ?? ""} ${event.dateLabel ?? ""}`.toLowerCase().includes(search);
}

async function openEditor(moduleApi, initial, { title = "Событие", quick = false } = {}) {
  const DialogClass = resolveDialogClass();
  if (!DialogClass) {
    const message = "Не удалось открыть редактор ивента: Dialog API недоступен.";
    console.error(`${MODULE_ID} | ${message}`);
    ui.notifications?.error(message);
    return null;
  }

  const defaultStartDate = resolveDefaultStartDate(moduleApi);
  const state = { ...emptyEditorState(defaultStartDate), ...(initial ?? {}) };
  state.scopeWorld = typeof state.scopeWorld === "boolean"
    ? state.scopeWorld
    : (
      state.scopeMode === "world"
      || !(
        (state.states ?? []).length
        || (state.regions ?? []).length
        || (state.cities ?? []).length
        || (state.routes ?? []).length
        || (state.routeConnectionIds ?? []).length
      )
    );
  if (!state.startDate) {
    state.startDate = defaultStartDate;
  }
  state.states = [...new Set((state.states ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
  state.regions = [...new Set((state.regions ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
  state.cities = [...new Set((state.cities ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
  state.tags = [...new Set((state.tags ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
  state.goods = [...new Set((state.goods ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
  state.routeConnectionIds = [...new Set((state.routeConnectionIds ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))];
  state.routeEffectConnectionId = String(state.routeEffectConnectionId ?? "").trim();

  const options = await getSelectionOptions(moduleApi);
  const canonicalTagByNormalized = options.tagCanonicalByNormalized instanceof Map
    ? options.tagCanonicalByNormalized
    : new Map();
  const connectionAliasToCanonicalId = options.connectionAliasToCanonicalId instanceof Map
    ? options.connectionAliasToCanonicalId
    : new Map();
  const canonicalizeConnectionId = (value) => {
    const rawValue = String(value ?? "").trim();
    if (!rawValue) {
      return "";
    }
    return String(connectionAliasToCanonicalId.get(rawValue) ?? rawValue).trim();
  };
  const canonicalizeTag = (value) => {
    const rawValue = String(value ?? "").trim();
    if (!rawValue) {
      return "";
    }
    const normalizedKey = normalizeText(rawValue);
    return String(canonicalTagByNormalized.get(normalizedKey) ?? rawValue).trim();
  };
  state.tags = [...new Set((state.tags ?? []).map((value) => canonicalizeTag(value)).filter(Boolean))];
  state.routeConnectionIds = [...new Set((state.routeConnectionIds ?? []).map((value) => canonicalizeConnectionId(value)).filter(Boolean))];
  state.routeEffectConnectionId = canonicalizeConnectionId(state.routeEffectConnectionId);
  state.effects = (state.effects ?? []).map((effect) => ({
    ...effect,
    connectionId: canonicalizeConnectionId(effect?.connectionId)
  }));
  if (typeof state.goodsAll !== "boolean") {
    state.goodsAll = !(state.tags.length || state.goods.length);
  }

  const routeEffectConnectionIds = [...new Set((state.effects ?? [])
    .map((effect) => String(effect?.connectionId ?? "").trim())
    .filter(Boolean))];
  if (routeEffectConnectionIds.length) {
    state.routeConnectionIds = [...new Set([...state.routeConnectionIds, ...routeEffectConnectionIds])];
  }
  if (state.routeEffectConnectionId && !state.routeConnectionIds.includes(state.routeEffectConnectionId)) {
    state.routeConnectionIds = [...state.routeConnectionIds, state.routeEffectConnectionId];
  }

  const connectionById = new Map((options.connections ?? []).map((row) => [row.value, row]));
  if (!state.routeEffectConnectionId && state.routeConnectionIds.length === 1) {
    state.routeEffectConnectionId = routeEffectConnectionIds[0] ?? state.routeConnectionIds[0];
  }
  const preset = getPreset(state.eventType);
  const effects = state.effects.length ? state.effects : preset.effects;

  const renderCheckboxList = (items = [], selected = [], dataAttribute = "", emptyText = "Список пуст.") => {
    const selectedSet = new Set(selected.map((value) => String(value ?? "").trim()).filter(Boolean));
    const rows = items
      .map((row) => {
        const value = String(row.value ?? "").trim();
        if (!value) {
          return "";
        }
        return `
          <label class='rm-check rm-check--boxed'>
            <input type='checkbox' ${dataAttribute} value='${escapeHtml(value)}' ${selectedSet.has(value) ? "checked" : ""} />
            <span>${escapeHtml(row.label ?? value)}</span>
          </label>
        `;
      })
      .filter(Boolean)
      .join("");
    if (rows) {
      return `<div class='rm-checkbox-grid'>${rows}</div>`;
    }
    return `<p class='rm-muted rm-muted--small'>${escapeHtml(emptyText)}</p>`;
  };

  const renderGroupedCheckboxList = (
    items = [],
    selected = [],
    dataAttribute = "",
    groupBy = (row) => String(row?.state ?? "").trim(),
    emptyText = "Список пуст."
  ) => {
    const selectedSet = new Set(selected.map((value) => String(value ?? "").trim()).filter(Boolean));
    const groups = new Map();
    for (const row of items) {
      const value = String(row?.value ?? "").trim();
      if (!value) continue;
      const groupNameRaw = String(groupBy(row) ?? "").trim();
      const groupName = groupNameRaw || "Прочее";
      const list = groups.get(groupName) ?? [];
      list.push(row);
      groups.set(groupName, list);
    }

    const groupNames = Array.from(groups.keys()).sort((left, right) => left.localeCompare(right, "ru"));
    if (!groupNames.length) {
      return `<p class='rm-muted rm-muted--small'>${escapeHtml(emptyText)}</p>`;
    }

    return `
      <div class='rm-checkbox-group-list'>
        ${groupNames.map((groupName) => {
          const groupRows = [...(groups.get(groupName) ?? [])].sort((left, right) => String(left.label ?? "").localeCompare(String(right.label ?? ""), "ru"));
          return `
            <section class='rm-checkbox-group'>
              <h5>${escapeHtml(groupName)}</h5>
              <div class='rm-checkbox-grid'>
                ${groupRows.map((row) => {
                  const value = String(row.value ?? "").trim();
                  return `
                    <label class='rm-check rm-check--boxed'>
                      <input type='checkbox' ${dataAttribute} value='${escapeHtml(value)}' ${selectedSet.has(value) ? "checked" : ""} />
                      <span>${escapeHtml(row.label ?? value)}</span>
                    </label>
                  `;
                }).join("")}
              </div>
            </section>
          `;
        }).join("")}
      </div>
    `;
  };

  const resolveRegionsForStates = (stateIds = []) => {
    const stateSet = new Set(stateIds);
    if (!stateSet.size) {
      return [];
    }
    return options.regions.filter((row) => stateSet.has(row.state));
  };

  const resolveCitiesForScope = (stateIds = [], regionIds = []) => {
    const stateSet = new Set(stateIds);
    if (!stateSet.size) {
      return [];
    }

    const regionSet = new Set(regionIds);
    if (regionSet.size) {
      const regionCities = options.cities.filter((row) => regionSet.has(row.regionId));
      if (regionCities.length) {
        return regionCities;
      }
    }

    return options.cities.filter((row) => stateSet.has(row.state));
  };

  const resolveGoodsForTags = (tagIds = []) => {
    const tagSet = new Set(tagIds.map((value) => normalizeText(value)).filter(Boolean));
    if (!tagSet.size) {
      return [];
    }
    return options.goods.filter((row) => (
      tagSet.has(normalizeText(row.category))
      || tagSet.has(normalizeText(row.groupName))
    ));
  };

  const resolveRouteConnectionsByIds = (connectionIds = []) => (
    [...new Set(connectionIds.map((value) => canonicalizeConnectionId(value)).filter(Boolean))]
      .map((connectionId) => connectionById.get(connectionId) ?? {
        value: connectionId,
        label: `${connectionId} (вне текущей модели)`
      })
      .sort((left, right) => String(left.label ?? "").localeCompare(String(right.label ?? ""), "ru"))
  );

  const findRouteConnections = ({ fromCityId = "", toCityId = "", typeQuery = "" } = {}) => {
    const safeFromCityId = String(fromCityId ?? "").trim();
    const safeToCityId = String(toCityId ?? "").trim();
    const typeQueryTokens = resolveRouteTypeTokens(typeQuery);

    return (options.connections ?? [])
      .filter((connection) => {
        const fromId = String(connection.fromCityId ?? "").trim();
        const toId = String(connection.toCityId ?? "").trim();
        const samePair = safeFromCityId && safeToCityId
          ? (
            (fromId === safeFromCityId && toId === safeToCityId)
            || (fromId === safeToCityId && toId === safeFromCityId)
          )
          : true;
        if (!samePair) {
          return false;
        }

        const fromMatch = safeFromCityId
          ? (fromId === safeFromCityId || toId === safeFromCityId)
          : true;
        if (!fromMatch) {
          return false;
        }

        const toMatch = safeToCityId
          ? (fromId === safeToCityId || toId === safeToCityId)
          : true;
        if (!toMatch) {
          return false;
        }

        if (!typeQueryTokens.size) {
          return true;
        }

        const connectionTypeTokens = resolveRouteTypeTokens(connection.connectionType);
        if (!connectionTypeTokens.size) {
          return false;
        }
        return Array.from(typeQueryTokens).some((queryToken) => (
          Array.from(connectionTypeTokens).some((connectionToken) => (
            connectionToken.includes(queryToken) || queryToken.includes(connectionToken)
          ))
        ));
      })
      .sort((left, right) => String(left.label ?? "").localeCompare(String(right.label ?? ""), "ru"));
  };

  const renderRouteConnectionCheckboxes = (connections = [], selectedIds = []) => {
    const selectedSet = new Set((selectedIds ?? []).map((value) => String(value ?? "").trim()).filter(Boolean));
    const rows = (connections ?? [])
      .map((connection) => {
        const connectionId = String(connection?.value ?? "").trim();
        if (!connectionId) {
          return "";
        }

        return `
          <label class='rm-check rm-check--boxed'>
            <input type='checkbox' data-route-connection-checkbox value='${escapeHtml(connectionId)}' ${selectedSet.has(connectionId) ? "checked" : ""} />
            <span>${escapeHtml(connection.label ?? connectionId)}</span>
          </label>
        `;
      })
      .filter(Boolean)
      .join("");

    return rows
      ? `<div class='rm-checkbox-grid'>${rows}</div>`
      : "<p class='rm-muted rm-muted--small'>По текущему фильтру связи не найдены.</p>";
  };

  const renderEffectRow = (row = {}, canRemove = true, routeConnectionOptions = []) => {
    const rawTarget = String(row.target ?? "price").trim();
    const isRouteTarget = isRouteSubject(rawTarget) || ROUTE_EFFECT_TARGET_IDS.has(rawTarget);
    const normalizedTarget = isRouteTarget
      ? (isRouteSubject(rawTarget) ? rawTarget : "route:*")
      : (rawTarget.startsWith("effect:") ? rawTarget : `effect:${rawTarget}`);
    const subjectOptions = buildEffectSubjectOptions(routeConnectionOptions);
    const fallbackTargetId = NON_ROUTE_EFFECT_TARGETS.find((entry) => entry.id === "price")?.id ?? NON_ROUTE_EFFECT_TARGETS[0]?.id ?? "price";
    const fallbackTarget = `effect:${fallbackTargetId}`;
    const safeTarget = subjectOptions.some((entry) => entry.value === normalizedTarget)
      ? normalizedTarget
      : (isRouteTarget ? "route:*" : fallbackTarget);
    const safeAction = isRouteTarget
      ? (
        ROUTE_EFFECT_TARGET_IDS.has(String(row.routeAction ?? "").trim())
          ? String(row.routeAction ?? "").trim()
          : (ROUTE_EFFECT_TARGET_IDS.has(rawTarget) ? rawTarget : "routeCost")
      )
      : String(row.op ?? "inc").trim();
    const showValue = !(isRouteTarget && safeAction === "disableRoute");
    const showMerchantCategory = !isRouteTarget && MERCHANT_CATEGORY_TARGET_IDS.has(String(safeTarget ?? "").trim().replace(/^effect:/u, ""));
    const valueForInput = isRouteTarget && String(row.op ?? "").trim() === "dec"
      ? -Math.abs(toNumber(row.value, 0))
      : toNumber(row.value, 0);
    return `
    <div class='rm-effect-row' data-effect-row data-route-target='${isRouteTarget ? "true" : "false"}'>
      <select data-effect-target>
        ${selectOptions(subjectOptions, [safeTarget])}
      </select>
      <select data-effect-op>
        ${
  isRouteTarget
    ? ROUTE_EFFECT_ACTIONS
      .map((item) => `<option value='${escapeHtml(item.id)}' ${item.id === safeAction ? "selected" : ""}>${escapeHtml(item.label)}</option>`)
      .join("")
    : [
      `<option value='inc' ${safeAction === "inc" ? "selected" : ""}>Увеличить %</option>`,
      `<option value='dec' ${safeAction === "dec" ? "selected" : ""}>Уменьшить %</option>`,
      `<option value='mul' ${safeAction === "mul" ? "selected" : ""}>Умножить</option>`,
      `<option value='set' ${safeAction === "set" ? "selected" : ""}>Фикс.</option>`,
      `<option value='disable' ${safeAction === "disable" ? "selected" : ""}>Отключить</option>`
    ].join("")
}
      </select>
      <input type='number' step='0.01' data-effect-value value='${escapeHtml(String(valueForInput))}' ${showValue ? "" : "hidden disabled"} />
      <select data-effect-merchant-category ${showMerchantCategory ? "" : "hidden disabled"}>
        <option value='' ${!row.merchantCategory ? "selected" : ""}>Любая</option>
        <option value='material' ${row.merchantCategory === "material" ? "selected" : ""}>Материалы</option>
        <option value='gear' ${row.merchantCategory === "gear" ? "selected" : ""}>Снаряжение</option>
      </select>
      ${canRemove ? "<button type='button' class='rm-button rm-button--small' data-action='remove-effect'>Удалить</button>" : ""}
    </div>
  `;
  };

  const content = `
    <form class='rm-global-event-editor rm-global-event-editor--wizard'>
      <input type='hidden' name='id' value='${escapeHtml(state.id)}' />

      <section class='rm-editor-progress rm-editor-progress--wizard'>
        <span class='rm-step-pill' data-step-pill='1'>1. Название, описание и тип</span>
        <span class='rm-step-pill' data-step-pill='2'>2. Область действия и маршруты</span>
        <span class='rm-step-pill' data-step-pill='3'>3. Категории и товары</span>
        <span class='rm-step-pill' data-step-pill='4'>4. Эффекты</span>
        <span class='rm-step-pill' data-step-pill='5'>5. Дата и доп. настройки</span>
      </section>

      ${quick ? "<p class='rm-hint rm-hint--accent'>Быстрый режим: пройдите 5 шагов и сохраните событие.</p>" : ""}

      <section class='rm-editor-step' data-editor-step='1'>
        <h3>Шаг 1. Название, описание и тип</h3>
        <div class='rm-field'>
          <label>Название</label>
          <input type='text' name='name' value='${escapeHtml(state.name)}' />
        </div>
        <div class='rm-field'>
          <label>Описание</label>
          <textarea class='rm-textarea rm-textarea--medium' name='description'>${escapeHtml(state.description)}</textarea>
        </div>
        <div class='rm-field'>
          <label>Тип события</label>
          <select name='eventType'>
            ${EVENT_PRESETS.map((row) => `<option value='${escapeHtml(row.id)}' ${row.id === state.eventType ? "selected" : ""}>${escapeHtml(row.label)}</option>`).join("")}
          </select>
        </div>
        <p class='rm-hint' data-type-hint>${escapeHtml(preset.hint)}</p>
        <button type='button' class='rm-button rm-button--small' data-action='apply-template'>Подставить шаблон эффектов</button>
      </section>

      <section class='rm-editor-step' data-editor-step='2'>
        <h3>Шаг 2. Область действия</h3>
        <label class='rm-check rm-check--boxed rm-check--world'>
          <input type='checkbox' name='scopeWorld' ${state.scopeWorld ? "checked" : ""} />
          <span>Применять событие ко всему миру</span>
        </label>

        <div data-scope-tree ${state.scopeWorld ? "hidden" : ""}>
          <div class='rm-checkbox-panel'>
            <h4>Государства</h4>
            <p class='rm-hint'>Отметьте одно или несколько государств.</p>
            <div data-scope-states-host>
              ${renderCheckboxList(options.states, state.states, "data-scope-state", "Список государств пуст.")}
            </div>
          </div>

          <div class='rm-checkbox-panel' data-scope-regions-panel>
            <h4>Регионы выбранных государств</h4>
            <p class='rm-hint'>Если выбран хотя бы один регион, событие ограничивается только выбранными регионами.</p>
            <div data-scope-regions-host>
              ${renderGroupedCheckboxList(resolveRegionsForStates(state.states), state.regions, "data-scope-region", (row) => row.state, "Сначала выберите государство.")}
            </div>
          </div>

          <div class='rm-checkbox-panel' data-scope-cities-panel>
            <h4>Города выбранной области</h4>
            <p class='rm-hint'>Если выбран хотя бы один город, событие ограничивается только этими городами.</p>
            <div data-scope-cities-host>
              ${renderGroupedCheckboxList(resolveCitiesForScope(state.states, state.regions), state.cities, "data-scope-city", (row) => row.state, "Сначала выберите государство или регион.")}
            </div>
          </div>
        </div>

        <div class='rm-checkbox-panel'>
          <h4>Шаг 2.5. Маршруты (по необходимости)</h4>
          <div class='rm-editor-grid rm-editor-grid--3'>
            <div class='rm-field'>
              <label>Город A</label>
              <select data-route-find-from>
                <option value=''>Любой</option>
                ${selectOptions(options.cities, [])}
              </select>
            </div>
            <div class='rm-field'>
              <label>Город B</label>
              <select data-route-find-to>
                <option value=''>Любой</option>
                ${selectOptions(options.cities, [])}
              </select>
            </div>
            <div class='rm-field'>
              <label>Тип связи (поиск)</label>
              <select data-route-find-type>
                <option value=''>Любой</option>
                ${selectOptions(options.connectionTypes ?? [], [])}
              </select>
            </div>
          </div>
          <div class='rm-editor-actions'>
            <button type='button' class='rm-button rm-button--small' data-action='find-route-connections'>Найти связь</button>
            <button type='button' class='rm-button rm-button--small' data-action='clear-route-connections'>Сбросить найденные</button>
          </div>
          <div data-route-connections-host>
            ${renderRouteConnectionCheckboxes(resolveRouteConnectionsByIds(state.routeConnectionIds), state.routeConnectionIds)}
          </div>
          <input type='hidden' name='routeEffectConnectionId' value='${escapeHtml(state.routeEffectConnectionId)}' data-route-effect-connection />
          <p class='rm-hint'>В шаге 4 в первой колонке выберите нужную связь, во второй — эффект для маршрута.</p>
        </div>
      </section>

      <section class='rm-editor-step' data-editor-step='3'>
        <h3>Шаг 3. Категории и товары</h3>
        <label class='rm-check rm-check--boxed'>
          <input type='checkbox' name='goodsAll' ${state.goodsAll ? "checked" : ""} />
          <span>Применять ко всем товарам</span>
        </label>
        <div data-goods-filter-host ${state.goodsAll ? "hidden" : ""}>
          <div class='rm-checkbox-panel'>
            <h4>Категории товаров</h4>
            <div data-tags-host>
              ${renderCheckboxList(options.tags, state.tags, "data-tag-checkbox", "Список категорий пуст.")}
            </div>
          </div>

          <div class='rm-checkbox-panel'>
            <h4>Товары из выбранных категорий</h4>
            <div data-goods-host>
              ${renderCheckboxList(resolveGoodsForTags(state.tags), state.goods, "data-good-checkbox", "Сначала выберите категорию товаров.")}
            </div>
          </div>
        </div>

        <p class='rm-hint'>Логика приоритета: если выбран хотя бы один товар, применяются только выбранные товары. Если товары не выбраны, применяются выбранные категории.</p>
      </section>

      <section class='rm-editor-step' data-editor-step='4'>
        <h3>Шаг 4. Эффекты</h3>
        <p class='rm-hint'>Никакого JSON: только конструктор эффектов. Для маршрута в колонке 1 выберите пункт "Маршрут: ...", затем в колонке 2 — тип маршрутного эффекта.</p>
        <div data-effects>
          ${effects.map((row) => renderEffectRow(row, !quick, resolveRouteConnectionsByIds(state.routeConnectionIds))).join("")}
        </div>
        ${quick ? "" : "<button type='button' class='rm-button rm-button--small' data-action='add-effect'>Добавить эффект</button>"}
      </section>

      <section class='rm-editor-step' data-editor-step='5'>
        <h3>Шаг 5. Дата и доп. настройки</h3>

        <div class='rm-field'>
          <label>Режим запуска</label>
          <select name='scheduleMode'>
            <option value='manual' ${state.scheduleMode === "manual" ? "selected" : ""}>Вручную</option>
            <option value='date' ${state.scheduleMode === "date" ? "selected" : ""}>В конкретную дату</option>
            <option value='dateRange' ${state.scheduleMode === "dateRange" ? "selected" : ""}>В период с даты по дату</option>
          </select>
        </div>

        <div class='rm-field' data-schedule='start'>
          <label>Дата начала</label>
          <input type='date' name='startDate' value='${escapeHtml(state.startDate)}' />
        </div>

        <div class='rm-field' data-schedule='end'>
          <label>Дата окончания</label>
          <input type='date' name='endDate' value='${escapeHtml(state.endDate)}' />
        </div>

        <label class='rm-check' data-schedule='active'>
          <input type='checkbox' name='activeNow' ${state.activeNow ? "checked" : ""} />
          Событие активно сейчас
        </label>

        ${quick ? "" : `
          <label class='rm-check'><input type='checkbox' name='advanced' ${state.advanced ? "checked" : ""} /> Показать продвинутые настройки</label>
          <div data-advanced>
            <label class='rm-check'><input type='checkbox' name='enabled' ${state.enabled ? "checked" : ""} /> Событие включено</label>
            <label class='rm-check'><input type='checkbox' name='gmOnly' ${state.gmOnly ? "checked" : ""} /> Только для ГМа</label>
            <label class='rm-check'><input type='checkbox' name='notifyStart' ${state.notifyStart ? "checked" : ""} /> Уведомлять о старте</label>
            <label class='rm-check'><input type='checkbox' name='notifyEnd' ${state.notifyEnd ? "checked" : ""} /> Уведомлять о завершении</label>
            <div class='rm-field'>
              <label>Совмещение событий</label>
              <select name='stackingMode'>
                <option value='stack' ${state.stackingMode === "stack" ? "selected" : ""}>Складывать</option>
                <option value='highestOnly' ${state.stackingMode === "highestOnly" ? "selected" : ""}>Самый сильный</option>
                <option value='overrideByPriority' ${state.stackingMode === "overrideByPriority" ? "selected" : ""}>По приоритету</option>
                <option value='lowestOnly' ${state.stackingMode === "lowestOnly" ? "selected" : ""}>Самый слабый</option>
              </select>
            </div>
            <div class='rm-field'>
              <label>Приоритет</label>
              <input type='number' step='1' name='priority' value='${escapeHtml(String(state.priority))}' />
            </div>
          </div>
        `}

        <div data-validation></div>
      </section>

      <section class='rm-editor-step-nav'>
        <button type='button' class='rm-button rm-button--small' data-action='prev-step'>Назад</button>
        <span class='rm-chip rm-chip--step' data-step-label>1 из 5</span>
        <button type='button' class='rm-button rm-button--small' data-action='next-step'>Далее</button>
      </section>

      <section class='rm-editor-draft-row'>
        <button type='button' class='rm-button rm-button--small' data-action='save-draft'>Сохранить черновик</button>
      </section>
    </form>
  `;

  return new Promise((resolve) => {
    let settled = false;
    const dialog = new DialogClass({
      title,
      window: { title },
      content,
      buttons: buildEditorDialogButtons(DialogClass),
      render: (...args) => {
        const root = getDialogRoot(...args);
        if (!root) return;
        const validationHost = root.querySelector("[data-validation]");
        const typeHint = root.querySelector("[data-type-hint]");
        const scopeTree = root.querySelector("[data-scope-tree]");
        const statesHost = root.querySelector("[data-scope-states-host]");
        const regionsHost = root.querySelector("[data-scope-regions-host]");
        const citiesHost = root.querySelector("[data-scope-cities-host]");
        const tagsHost = root.querySelector("[data-tags-host]");
        const goodsHost = root.querySelector("[data-goods-host]");
        const goodsFilterHost = root.querySelector("[data-goods-filter-host]");
        const regionPanel = root.querySelector("[data-scope-regions-panel]");
        const cityPanel = root.querySelector("[data-scope-cities-panel]");
        const routeConnectionsHost = root.querySelector("[data-route-connections-host]");
        const routeEffectConnectionField = root.querySelector("[data-route-effect-connection]");
        const routeFindFromField = root.querySelector("[data-route-find-from]");
        const routeFindToField = root.querySelector("[data-route-find-to]");
        const routeFindTypeField = root.querySelector("[data-route-find-type]");

        let currentStep = 1;
        const maxStep = 5;
        let routeConnectionSearchResults = resolveRouteConnectionsByIds(
          [...state.routeConnectionIds, state.routeEffectConnectionId].filter(Boolean)
        );

        const renderScopeHosts = (stateNow) => {
          if (!(statesHost instanceof HTMLElement) || !(regionsHost instanceof HTMLElement) || !(citiesHost instanceof HTMLElement)) {
            return;
          }
          statesHost.innerHTML = renderCheckboxList(options.states, stateNow.states, "data-scope-state", "Список государств пуст.");

          const regions = resolveRegionsForStates(stateNow.states);
          regionsHost.innerHTML = renderGroupedCheckboxList(regions, stateNow.regions, "data-scope-region", (row) => row.state, "Сначала выберите государство.");
          if (regionPanel instanceof HTMLElement) {
            regionPanel.hidden = !stateNow.states.length;
          }

          const regionsAfterRender = Array.from(root.querySelectorAll("[data-scope-region]"))
            .filter((field) => field instanceof HTMLInputElement && field.checked)
            .map((field) => String(field.value ?? "").trim())
            .filter(Boolean);
          const cities = resolveCitiesForScope(stateNow.states, regionsAfterRender);
          citiesHost.innerHTML = renderGroupedCheckboxList(cities, stateNow.cities, "data-scope-city", (row) => row.state, "Сначала выберите государство или регион.");
          if (cityPanel instanceof HTMLElement) {
            cityPanel.hidden = !stateNow.states.length;
          }
        };

        const renderGoodsHosts = (stateNow) => {
          if (!(tagsHost instanceof HTMLElement) || !(goodsHost instanceof HTMLElement)) {
            return;
          }
          if (goodsFilterHost instanceof HTMLElement) {
            goodsFilterHost.hidden = stateNow.goodsAll === true;
          }
          tagsHost.innerHTML = renderCheckboxList(options.tags, stateNow.tags, "data-tag-checkbox", "Список категорий пуст.");

          const goods = resolveGoodsForTags(stateNow.tags);
          goodsHost.innerHTML = renderCheckboxList(goods, stateNow.goods, "data-good-checkbox", "Сначала выберите категорию товаров.");
        };

        const mergeRouteConnectionRows = (...groups) => {
          const rowsById = new Map();
          for (const group of groups) {
            for (const row of group ?? []) {
              const value = String(row?.value ?? "").trim();
              if (!value || rowsById.has(value)) {
                continue;
              }
              rowsById.set(value, row);
            }
          }
          return Array.from(rowsById.values())
            .sort((left, right) => String(left.label ?? "").localeCompare(String(right.label ?? ""), "ru"));
        };

        const renderRouteConnectionHosts = (stateNow) => {
          const selectedConnectionIds = [...new Set((stateNow.routeConnectionIds ?? [])
            .map((value) => canonicalizeConnectionId(value))
            .filter(Boolean))];
          const selectedRows = resolveRouteConnectionsByIds(selectedConnectionIds);
          const effectConnectionId = canonicalizeConnectionId(stateNow.routeEffectConnectionId);
          const effectRows = effectConnectionId ? resolveRouteConnectionsByIds([effectConnectionId]) : [];

          const hostRows = mergeRouteConnectionRows(routeConnectionSearchResults, selectedRows, effectRows);
          routeConnectionSearchResults = hostRows;

          if (routeConnectionsHost instanceof HTMLElement) {
            routeConnectionsHost.innerHTML = renderRouteConnectionCheckboxes(hostRows, selectedConnectionIds);
          }

          if (routeEffectConnectionField instanceof HTMLSelectElement) {
            const dropdownRows = mergeRouteConnectionRows(selectedRows, effectRows);
            const selectedValue = effectConnectionId || (selectedConnectionIds.length === 1 ? selectedConnectionIds[0] : "");
            routeEffectConnectionField.innerHTML = `
              <option value=''>Все выбранные связи</option>
              ${selectOptions(dropdownRows, [selectedValue])}
            `;
          } else if (routeEffectConnectionField instanceof HTMLInputElement) {
            const currentValue = canonicalizeConnectionId(routeEffectConnectionField.value);
            const nextValue = selectedConnectionIds.includes(currentValue)
              ? currentValue
              : (selectedConnectionIds.length === 1 ? selectedConnectionIds[0] : "");
            routeEffectConnectionField.value = nextValue;
          }
        };

        const syncEffectRouteConnectionSelectors = (stateNow) => {
          const effectRows = Array.from(root.querySelectorAll("[data-effect-row]"));
          if (!effectRows.length) {
            return;
          }
          const selectedRouteRows = resolveRouteConnectionsByIds(stateNow.routeConnectionIds ?? []);
          const subjectOptions = buildEffectSubjectOptions(selectedRouteRows);

          for (const row of effectRows) {
            if (!(row instanceof HTMLElement)) {
              continue;
            }
            const targetField = row.querySelector("[data-effect-target]");
            const actionField = row.querySelector("[data-effect-op]");
            const valueField = row.querySelector("[data-effect-value]");
            const merchantCategoryField = row.querySelector("[data-effect-merchant-category]");
            if (!(targetField instanceof HTMLSelectElement) || !(actionField instanceof HTMLSelectElement)) {
              continue;
            }

            const currentTarget = String(targetField.value ?? "").trim();
            targetField.innerHTML = selectOptions(subjectOptions, [currentTarget]);
            const targetValue = subjectOptions.some((entry) => entry.value === currentTarget)
              ? currentTarget
              : (
                isRouteSubject(currentTarget)
                  ? "route:*"
                  : `effect:${NON_ROUTE_EFFECT_TARGETS.find((entry) => entry.id === "price")?.id ?? NON_ROUTE_EFFECT_TARGETS[0]?.id ?? "price"}`
              );
            targetField.value = targetValue;

            const isRouteTarget = isRouteSubject(targetField.value);
            row.dataset.routeTarget = isRouteTarget ? "true" : "false";
            if (isRouteTarget) {
              const currentAction = String(actionField.value ?? "").trim();
              actionField.innerHTML = ROUTE_EFFECT_ACTIONS
                .map((item) => `<option value='${escapeHtml(item.id)}' ${item.id === currentAction ? "selected" : ""}>${escapeHtml(item.label)}</option>`)
                .join("");
              if (!ROUTE_EFFECT_ACTIONS.some((item) => item.id === currentAction)) {
                actionField.value = "routeCost";
              }
              const hideValue = actionField.value === "disableRoute";
              if (valueField instanceof HTMLInputElement) {
                valueField.hidden = hideValue;
                valueField.disabled = hideValue;
              }
              if (merchantCategoryField instanceof HTMLSelectElement) {
                merchantCategoryField.hidden = true;
                merchantCategoryField.disabled = true;
              }
            } else {
              const currentAction = String(actionField.value ?? "").trim();
              actionField.innerHTML = [
                `<option value='inc' ${currentAction === "inc" ? "selected" : ""}>Увеличить %</option>`,
                `<option value='dec' ${currentAction === "dec" ? "selected" : ""}>Уменьшить %</option>`,
                `<option value='mul' ${currentAction === "mul" ? "selected" : ""}>Умножить</option>`,
                `<option value='set' ${currentAction === "set" ? "selected" : ""}>Фикс.</option>`,
                `<option value='disable' ${currentAction === "disable" ? "selected" : ""}>Отключить</option>`
              ].join("");
              if (!["inc", "dec", "mul", "set", "disable"].includes(currentAction)) {
                actionField.value = "inc";
              }
              if (valueField instanceof HTMLInputElement) {
                valueField.hidden = false;
                valueField.disabled = false;
              }
              if (merchantCategoryField instanceof HTMLSelectElement) {
                const targetId = String(targetField.value ?? "").trim().replace(/^effect:/u, "");
                const showMerchantCategory = MERCHANT_CATEGORY_TARGET_IDS.has(targetId);
                merchantCategoryField.hidden = !showMerchantCategory;
                merchantCategoryField.disabled = !showMerchantCategory;
              }
            }
          }
        };

        const updateStepView = () => {
          root.querySelectorAll("[data-editor-step]").forEach((section) => {
            if (!(section instanceof HTMLElement)) return;
            section.hidden = Number(section.dataset.editorStep) !== currentStep;
          });

          root.querySelectorAll("[data-step-pill]").forEach((pill) => {
            if (!(pill instanceof HTMLElement)) return;
            const stepNumber = Number(pill.dataset.stepPill);
            pill.classList.toggle("is-active", stepNumber === currentStep);
            pill.classList.toggle("is-complete", stepNumber < currentStep);
          });

          const stepLabel = root.querySelector("[data-step-label]");
          if (stepLabel instanceof HTMLElement) {
            stepLabel.textContent = `${currentStep} из ${maxStep}`;
          }

          const prevButton = root.querySelector("[data-action='prev-step']");
          if (prevButton instanceof HTMLButtonElement) {
            prevButton.disabled = currentStep <= 1;
          }

          const nextButton = root.querySelector("[data-action='next-step']");
          if (nextButton instanceof HTMLButtonElement) {
            nextButton.textContent = currentStep >= maxStep ? "Завершить" : "Далее";
            nextButton.disabled = false;
          }
        };

        const refreshVisibility = () => {
          let stateNow = parseState(root);

          if (scopeTree instanceof HTMLElement) {
            scopeTree.hidden = stateNow.scopeWorld;
          }

          renderScopeHosts(stateNow);
          renderGoodsHosts(stateNow);
          renderRouteConnectionHosts(stateNow);
          syncEffectRouteConnectionSelectors(stateNow);
          stateNow = parseState(root);

          const start = root.querySelector("[data-schedule='start']");
          const end = root.querySelector("[data-schedule='end']");
          const active = root.querySelector("[data-schedule='active']");
          if (start instanceof HTMLElement) start.hidden = stateNow.scheduleMode === "manual";
          if (end instanceof HTMLElement) end.hidden = stateNow.scheduleMode !== "dateRange";
          if (active instanceof HTMLElement) active.hidden = stateNow.scheduleMode !== "manual";

          const advancedBlock = root.querySelector("[data-advanced]");
          if (advancedBlock instanceof HTMLElement) {
            advancedBlock.hidden = !(root.querySelector("[name='advanced']")?.checked === true);
          }

          const validation = validateState(stateNow);
          const lines = [
            ...validation.errors.map((text) => `<li class='is-error'>${escapeHtml(text)}</li>`),
            ...validation.warnings.map((text) => `<li class='is-warning'>${escapeHtml(text)}</li>`)
          ];
          if (validationHost instanceof HTMLElement) {
            validationHost.innerHTML = lines.length ? `<ul class='rm-editor-validation'>${lines.join("")}</ul>` : "";
          }

          updateStepView();
        };

        root.addEventListener("change", (event) => {
          const target = event.target;
          if (target instanceof HTMLElement && target.matches("[name='eventType']")) {
            const selectedPreset = getPreset(target.value);
            if (typeHint instanceof HTMLElement) typeHint.textContent = selectedPreset.hint;
          }
          refreshVisibility();
        });

        root.addEventListener("input", () => {
          refreshVisibility();
        });

        root.addEventListener("click", async (event) => {
          const button = event.target.closest("[data-action]");
          if (!(button instanceof HTMLElement)) return;
          const action = button.dataset.action;
          const effectsHost = root.querySelector("[data-effects]");

          if (action === "save-draft") {
            try {
              await saveDraftState(parseState(root));
              ui.notifications?.info("Черновик сохранён.");
              settled = true;
              resolve({ action: "draft" });
              dialog.close();
            } catch (error) {
              console.error(`${MODULE_ID} | Failed to save draft.`, error);
              ui.notifications?.error("Не удалось сохранить черновик.");
            }
            return;
          }

          if (action === "prev-step") {
            currentStep = Math.max(1, currentStep - 1);
          }

          if (action === "next-step") {
            if (currentStep >= maxStep) {
              const stateNow = parseState(root);
              const validation = validateState(stateNow);
              if (validation.errors.length) {
                ui.notifications?.error(validation.errors[0]);
              } else {
                settled = true;
                resolve({ action: "save", payload: buildPayload(stateNow) });
                dialog.close();
                return;
              }
            } else {
              currentStep = Math.min(maxStep, currentStep + 1);
            }
          }

          if (action === "apply-template" && effectsHost instanceof HTMLElement) {
            const type = root.querySelector("[name='eventType']")?.value ?? "custom";
            const selectedPreset = getPreset(type);
            const stateNow = parseState(root);
            const routeRows = resolveRouteConnectionsByIds(stateNow.routeConnectionIds);
            effectsHost.innerHTML = (selectedPreset.effects ?? []).map((row) => renderEffectRow(row, !quick, routeRows)).join("");
          }
          if (action === "add-effect" && effectsHost instanceof HTMLElement) {
            const stateNow = parseState(root);
            const routeRows = resolveRouteConnectionsByIds(stateNow.routeConnectionIds);
            effectsHost.insertAdjacentHTML("beforeend", renderEffectRow({ target: "price", op: "inc", value: 10 }, true, routeRows));
          }
          if (action === "remove-effect") {
            button.closest("[data-effect-row]")?.remove();
          }
          if (action === "find-route-connections") {
            const fromCityId = String(routeFindFromField?.value ?? "").trim();
            const toCityId = String(routeFindToField?.value ?? "").trim();
            const typeQuery = String(routeFindTypeField?.value ?? "").trim();
            routeConnectionSearchResults = findRouteConnections({ fromCityId, toCityId, typeQuery });
            if (!routeConnectionSearchResults.length) {
              ui.notifications?.warn("По заданному фильтру связи не найдены.");
            }
          }
          if (action === "clear-route-connections") {
            routeConnectionSearchResults = [];
            root.querySelectorAll("[data-route-connection-checkbox]").forEach((field) => {
              if (field instanceof HTMLInputElement) {
                field.checked = false;
              }
            });
            if (routeEffectConnectionField instanceof HTMLSelectElement || routeEffectConnectionField instanceof HTMLInputElement) {
              routeEffectConnectionField.value = "";
            }
            if (routeFindFromField instanceof HTMLSelectElement) {
              routeFindFromField.value = "";
            }
            if (routeFindToField instanceof HTMLSelectElement) {
              routeFindToField.value = "";
            }
            if (routeFindTypeField instanceof HTMLInputElement || routeFindTypeField instanceof HTMLSelectElement) {
              routeFindTypeField.value = "";
            }
          }

          refreshVisibility();
        });

        refreshVisibility();
      },
      close: () => {
        if (!settled) resolve(null);
      }
    }, {
      classes: ["rebreya-main", "rm-global-event-editor-dialog"],
      width: 1120
    });
    dialog.render(true);
  });
}
export class GlobalEventsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-global-events-app`,
    classes: ["rebreya-main", "rebreya-global-events-app"],
    window: {
      title: "Глобальные ивенты",
      icon: "fa-solid fa-bolt",
      resizable: true
    },
    position: {
      width: 1320,
      height: 880
    }
  };

  static PARTS = {
    main: {
      root: true,
      template: `modules/${MODULE_ID}/templates/global-events-app.hbs`
    }
  };

  constructor(moduleApi, options = {}) {
    super(options);
    this.moduleApi = moduleApi;
    this.filters = { search: "", status: "all" };
  }

  async _prepareContext() {
    const events = this.moduleApi.getAllGlobalEvents();
    const activeEventIds = new Set(this.moduleApi.getActiveGlobalEvents().map((event) => event.id));
    const rows = events
      .map((event) => mapEventForView(event, activeEventIds))
      .filter((event) => shouldIncludeByFilter(event, this.filters))
      .sort((left, right) => right.priority - left.priority || right.updatedAt - left.updatedAt);
    return {
      filters: this.filters,
      events: rows,
      totalEventCount: events.length,
      filteredEventCount: rows.length,
      activeEventCount: rows.filter((event) => event.status === "active").length,
      enabled: game.settings.get(MODULE_ID, SETTINGS_KEYS.GLOBAL_EVENTS_ENABLED) !== false,
      hasDraft: Boolean(draftState())
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const element = getAppElement(this);
    if (!element) return;

    const safeOpenEditor = async (initialState, editorOptions, fallbackMessage) => {
      try {
        return await openEditor(this.moduleApi, initialState, editorOptions);
      } catch (error) {
        console.error(`${MODULE_ID} | Failed to open global event editor.`, error);
        ui.notifications?.error(error?.message || fallbackMessage || "Не удалось открыть редактор ивента.");
        return null;
      }
    };

    element.querySelectorAll("[data-filter]").forEach((field) => {
      const eventName = field.tagName === "SELECT" ? "change" : "input";
      field.addEventListener(eventName, (event) => {
        const target = event.currentTarget;
        this.filters[target.dataset.filter] = target.value;
        this.render({ force: true });
      });
    });

    element.querySelector("[data-action='create-event']")?.addEventListener("click", async () => {
      const outcome = await safeOpenEditor(
        emptyEditorState(),
        { title: "Создать событие" },
        "Не удалось открыть создание ивента."
      );
      if (!outcome || outcome.action !== "save") return;
      try {
        await this.moduleApi.createGlobalEvent(outcome.payload);
        await clearDraftState();
        bringAppToFront(this);
      } catch (error) {
        ui.notifications?.error(error.message || "Не удалось создать ивент.");
      }
    });

    element.querySelector("[data-action='quick-create-event']")?.addEventListener("click", async () => {
      const preset = getPreset("drought");
      const outcome = await safeOpenEditor(
        {
          ...emptyEditorState(),
          eventType: "drought",
          name: "Засуха",
          scopeWorld: true,
          scheduleMode: "dateRange",
          effects: preset.effects
        },
        {
          title: "Быстрое создание события (30 сек)",
          quick: true
        },
        "Не удалось открыть быстрое создание ивента."
      );
      if (!outcome || outcome.action !== "save") return;
      try {
        await this.moduleApi.createGlobalEvent(outcome.payload);
        await clearDraftState();
        bringAppToFront(this);
      } catch (error) {
        ui.notifications?.error(error.message || "Не удалось создать ивент.");
      }
    });

    element.querySelector("[data-action='continue-draft']")?.addEventListener("click", async () => {
      const draft = draftState();
      if (!draft) {
        ui.notifications?.warn("Черновик не найден.");
        return;
      }
      const outcome = await safeOpenEditor(
        draft,
        { title: "Продолжить черновик" },
        "Не удалось открыть черновик ивента."
      );
      if (!outcome || outcome.action !== "save") return;
      try {
        await this.moduleApi.createGlobalEvent(outcome.payload);
        await clearDraftState();
        bringAppToFront(this);
      } catch (error) {
        ui.notifications?.error(error.message || "Не удалось создать ивент из черновика.");
      }
    });

    element.querySelector("[data-action='import-templates']")?.addEventListener("click", async () => {
      try {
        const imported = await this.moduleApi.importDefaultGlobalEventTemplates();
        ui.notifications?.info(`Импортировано шаблонов: ${imported.length}.`);
        bringAppToFront(this);
      } catch (error) {
        ui.notifications?.error(error.message || "Не удалось импортировать шаблоны.");
      }
    });

    element.querySelectorAll("[data-action='edit-event']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const eventId = event.currentTarget.dataset.eventId;
        const source = this.moduleApi.getAllGlobalEvents().find((entry) => entry.id === eventId);
        if (!source) {
          ui.notifications?.warn("Ивент не найден.");
          return;
        }
        const sourceRouteEffectConnectionIds = [...new Set((source.effects ?? [])
          .filter((effect) => ROUTE_EFFECT_TYPES.has(String(effect?.type ?? "").trim()))
          .map((effect) => String(effect?.connectionId ?? "").trim())
          .filter(Boolean))];
        const sourceRouteConnectionIds = [...new Set([
          ...(source.scope?.routeConnectionIds ?? []),
          ...sourceRouteEffectConnectionIds
        ].map((value) => String(value ?? "").trim()).filter(Boolean))];
        const hasAreaScope = Boolean(
          (source.scope?.states ?? []).length
          || (source.scope?.regions ?? []).length
          || (source.scope?.cities ?? []).length
          || (source.scope?.routes ?? []).length
          || sourceRouteConnectionIds.length
        );
        const scheduleMode = source.trigger?.type === "dateRange" || source.duration?.mode === "dateRange"
          ? "dateRange"
          : (source.trigger?.type === "date" ? "date" : "manual");
        const outcome = await safeOpenEditor(
          {
            ...emptyEditorState(),
            id: source.id,
            name: source.name ?? "",
            description: source.description ?? "",
            eventType: source.eventType ?? "custom",
            scopeWorld: source.scope?.world === true || !hasAreaScope,
            scopeMode: source.scope?.world === true || !hasAreaScope ? "world" : "combination",
            scheduleMode,
            startDate: source.trigger?.startDate ?? source.duration?.startDate ?? "",
            endDate: source.trigger?.endDate ?? source.duration?.endDate ?? "",
            activeNow: source.active === true,
            states: [...(source.scope?.states ?? [])],
            regions: [...(source.scope?.regions ?? [])],
            cities: [...(source.scope?.cities ?? [])],
            goods: [...(source.scope?.goods ?? [])],
            tags: [...(source.scope?.goodTags ?? [])],
            routes: (source.scope?.routes ?? []).map((row) => ({ from: row.from ?? "", to: row.to ?? "" })),
            routeConnectionIds: sourceRouteConnectionIds,
            routeEffectConnectionId: sourceRouteEffectConnectionIds[0] ?? sourceRouteConnectionIds[0] ?? "",
            effects: internalEffectsToRows(source.effects ?? []),
            advanced: true,
            enabled: source.enabled !== false,
            stackingMode: source.stacking?.mode ?? "stack",
            priority: toInt(source.stacking?.priority, 100),
            gmOnly: source.visibility?.gmOnly !== false,
            notifyStart: source.visibility?.showNotificationOnStart !== false,
            notifyEnd: source.visibility?.showNotificationOnEnd !== false
          },
          { title: "Редактировать событие" },
          "Не удалось открыть редактирование ивента."
        );
        if (!outcome || outcome.action !== "save") return;
        try {
          await this.moduleApi.updateGlobalEvent(eventId, outcome.payload);
          bringAppToFront(this);
        } catch (error) {
          ui.notifications?.error(error.message || "Не удалось обновить ивент.");
        }
      });
    });

    element.querySelectorAll("[data-action='delete-event']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const eventId = event.currentTarget.dataset.eventId;
        const confirmed = await DialogV2.confirm?.({
          window: { title: "Удалить ивент" },
          content: "<p>Удалить это событие?</p>"
        }) ?? true;
        if (!confirmed) return;
        try {
          await this.moduleApi.deleteGlobalEvent(eventId);
          bringAppToFront(this);
        } catch (error) {
          ui.notifications?.error(error.message || "Не удалось удалить ивент.");
        }
      });
    });

    element.querySelectorAll("[data-action='duplicate-event']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        try {
          await this.moduleApi.duplicateGlobalEvent(event.currentTarget.dataset.eventId);
          bringAppToFront(this);
        } catch (error) {
          ui.notifications?.error(error.message || "Не удалось дублировать ивент.");
        }
      });
    });

    element.querySelectorAll("[data-action='toggle-enabled']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const eventId = event.currentTarget.dataset.eventId;
        const enabled = event.currentTarget.dataset.enabled === "true";
        try {
          await this.moduleApi.updateGlobalEvent(eventId, { enabled: !enabled });
          bringAppToFront(this);
        } catch (error) {
          ui.notifications?.error(error.message || "Не удалось изменить состояние ивента.");
        }
      });
    });

    element.querySelectorAll("[data-action='toggle-active']").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const eventId = event.currentTarget.dataset.eventId;
        const active = event.currentTarget.dataset.active === "true";
        try {
          await this.moduleApi.updateGlobalEvent(eventId, { active: !active });
          bringAppToFront(this);
        } catch (error) {
          ui.notifications?.error(error.message || "Не удалось изменить активность ивента.");
        }
      });
    });
  }
}


