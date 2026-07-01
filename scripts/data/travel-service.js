import { MODULE_ID } from "../constants.js";
import { GROUP_CONTEXT_ERRORS, normalizeGroupState } from "./group-context-service.js";

const TRAVEL_NETWORK_PATH = `modules/${MODULE_ID}/data/travel-network.json`;
const DEFAULT_TRAVEL_SPEED_MPH = 3;
const TRAVEL_DAY_HOURS = 8;
const GROUP_CONTEXT_FALLBACK_ERRORS = new Set([
  GROUP_CONTEXT_ERRORS.GM_NO_ACTIVE_GROUP,
  GROUP_CONTEXT_ERRORS.PLAYER_NO_GROUP,
  GROUP_CONTEXT_ERRORS.GROUP_NOT_FOUND
]);

const TRAVEL_MODE_CONFIG = Object.freeze({
  land: {
    id: "land",
    label: "Земля",
    routeModes: ["land", "land_plus_gray", "rail"],
    enabled: true
  },
  rail: {
    id: "rail",
    label: "ЖД",
    routeModes: ["rail"],
    enabled: false,
    disabledReason: "ЖД будет подключена следующим этапом."
  },
  water: {
    id: "water",
    label: "Море",
    routeModes: ["water"],
    enabled: false,
    disabledReason: "Море будет подключено следующим этапом."
  }
});

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return globalThis.foundry.utils.deepClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function cleanId(value) {
  return String(value ?? "").trim();
}

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((toNumber(value, 0) + Number.EPSILON) * factor) / factor;
}

export function normalizeLocationName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[\u2019\u2018\u02bc\u02b9\u2032`´"]/gu, "'")
    .replace(/\s+/gu, " ");
}

function normalizeRouteMode(mode, type = "") {
  const rawMode = String(mode ?? "").trim().toLowerCase();
  if (rawMode === "land_plus_gray") {
    return "land_plus_gray";
  }
  if (rawMode.startsWith("land")) {
    return "land";
  }
  if (rawMode.startsWith("rail")) {
    return "rail";
  }
  if (rawMode.startsWith("water")) {
    return "water";
  }
  if (rawMode === "land" || rawMode === "rail" || rawMode === "water" || rawMode === "air") {
    return rawMode;
  }

  const text = normalizeLocationName(type);
  if (text.includes("жд") || text.includes("желез")) {
    return "rail";
  }
  if (text.includes("море") || text.includes("река") || text.includes("вода")) {
    return "water";
  }
  if (text.includes("земля")) {
    return "land";
  }
  return rawMode || text;
}

function normalizeTravelMode(value) {
  const mode = cleanId(value).toLowerCase();
  return TRAVEL_MODE_CONFIG[mode]?.id ?? "land";
}

function normalizeCity(row = {}) {
  const id = cleanId(row.id);
  const name = String(row.name ?? id).trim();
  return {
    id,
    name,
    state: String(row.state ?? row.fields?.["Государство"] ?? "").trim(),
    regionName: String(row.regionName ?? row.fields?.["Регион"] ?? "").trim(),
    locationType: String(row.locationType ?? row.fields?.["Тип локации"] ?? "").trim(),
    x: Number.isFinite(Number(row.x)) ? Number(row.x) : null,
    y: Number.isFinite(Number(row.y)) ? Number(row.y) : null,
    searchName: normalizeLocationName(row.norm ?? name)
  };
}

function buildCityLookup(cities) {
  const cityById = new Map();
  const cityByName = new Map();
  for (const city of cities) {
    if (!city.id) {
      continue;
    }
    cityById.set(city.id, city);
    cityByName.set(normalizeLocationName(city.name), city);
    if (city.searchName) {
      cityByName.set(city.searchName, city);
    }
  }
  return { cityById, cityByName };
}

function normalizeRoute(row = {}, cityByName = new Map()) {
  const explicitSourceId = cleanId(row.sourceId);
  const explicitTargetId = cleanId(row.targetId);
  const source = explicitSourceId ? null : cityByName.get(normalizeLocationName(row.source));
  const target = explicitTargetId ? null : cityByName.get(normalizeLocationName(row.target));
  const sourceId = explicitSourceId || source?.id || "";
  const targetId = explicitTargetId || target?.id || "";
  const miles = roundNumber(toNumber(row.miles, 0), 2);
  const mode = normalizeRouteMode(row.mode, row.type);

  return {
    id: cleanId(row.id) || `${sourceId}-${targetId}-${mode}`,
    sourceId,
    targetId,
    sourceName: String(row.sourceName ?? row.source ?? source?.name ?? "").trim(),
    targetName: String(row.targetName ?? row.target ?? target?.name ?? "").trim(),
    mode,
    type: String(row.type ?? "").trim(),
    miles
  };
}

export function normalizeTravelNetwork(value = {}) {
  const rawCities = Array.isArray(value.cities) ? value.cities : [];
  const cities = rawCities
    .map((row) => normalizeCity(row))
    .filter((city) => city.id && city.name);
  const { cityById, cityByName } = buildCityLookup(cities);

  const rawRoutes = Array.isArray(value.routes) ? value.routes : [];
  const routes = rawRoutes
    .map((row) => normalizeRoute(row, cityByName))
    .filter((route) => (
      route.sourceId
      && route.targetId
      && route.sourceId !== route.targetId
      && cityById.has(route.sourceId)
      && cityById.has(route.targetId)
      && route.miles > 0
    ));

  return {
    schema: value.schema ?? "rebreya-travel-network/v1",
    speedMph: Math.max(0.01, toNumber(value.speedMph, DEFAULT_TRAVEL_SPEED_MPH)),
    cities,
    routes,
    cityById,
    cityByName
  };
}

export function normalizeTravelState(value = {}) {
  const source = asObject(value);
  return {
    version: 1,
    originCityId: cleanId(source.originCityId),
    destinationCityId: cleanId(source.destinationCityId),
    mode: normalizeTravelMode(source.mode),
    traveledMiles: Math.max(0, roundNumber(toNumber(source.traveledMiles, 0), 2))
  };
}

function buildAdjacency(network, mode) {
  const modeConfig = TRAVEL_MODE_CONFIG[normalizeTravelMode(mode)] ?? TRAVEL_MODE_CONFIG.land;
  const routeModes = new Set(modeConfig.routeModes);
  const adjacency = new Map(network.cities.map((city) => [city.id, []]));

  for (const route of network.routes) {
    if (!routeModes.has(route.mode)) {
      continue;
    }

    adjacency.get(route.sourceId)?.push({
      to: route.targetId,
      route
    });
    adjacency.get(route.targetId)?.push({
      to: route.sourceId,
      route
    });
  }

  return adjacency;
}

function buildMissingPlan(network, state, reason) {
  const origin = network.cityById.get(state.originCityId) ?? null;
  const destination = network.cityById.get(state.destinationCityId) ?? null;
  const modeConfig = TRAVEL_MODE_CONFIG[state.mode] ?? TRAVEL_MODE_CONFIG.land;
  return {
    available: false,
    reason,
    mode: state.mode,
    modeLabel: modeConfig.label,
    speedMph: network.speedMph,
    originCityId: state.originCityId,
    destinationCityId: state.destinationCityId,
    originName: origin?.name ?? "",
    destinationName: destination?.name ?? "",
    cityIds: [],
    totalMiles: 0,
    totalHours: 0,
    totalTravelDays: 0,
    legs: []
  };
}

function buildPlanLeg(network, fromId, toId, route) {
  const fromCity = network.cityById.get(fromId) ?? null;
  const toCity = network.cityById.get(toId) ?? null;
  return {
    routeId: route.id,
    sourceCityId: fromId,
    sourceName: fromCity?.name ?? route.sourceName ?? fromId,
    targetCityId: toId,
    targetName: toCity?.name ?? route.targetName ?? toId,
    mode: route.mode,
    type: route.type,
    miles: route.miles,
    hours: roundNumber(route.miles / network.speedMph, 2)
  };
}

export function buildTravelPlan(rawNetwork, rawState = {}) {
  const network = normalizeTravelNetwork(rawNetwork);
  const state = normalizeTravelState(rawState);
  const origin = network.cityById.get(state.originCityId) ?? null;
  const destination = network.cityById.get(state.destinationCityId) ?? null;

  if (!origin || !destination) {
    return buildMissingPlan(network, state, "Выберите город отправления и город назначения.");
  }

  if (origin.id === destination.id) {
    return buildMissingPlan(network, state, "Город отправления и назначения совпадают.");
  }

  const modeConfig = TRAVEL_MODE_CONFIG[state.mode] ?? TRAVEL_MODE_CONFIG.land;
  const adjacency = buildAdjacency(network, state.mode);
  const distances = new Map([[origin.id, 0]]);
  const previous = new Map();
  const pending = new Set(network.cities.map((city) => city.id));

  while (pending.size) {
    let currentId = "";
    let currentDistance = Infinity;
    for (const cityId of pending) {
      const distance = distances.get(cityId) ?? Infinity;
      if (distance < currentDistance) {
        currentDistance = distance;
        currentId = cityId;
      }
    }

    if (!currentId || currentDistance === Infinity) {
      break;
    }
    pending.delete(currentId);

    if (currentId === destination.id) {
      break;
    }

    for (const edge of adjacency.get(currentId) ?? []) {
      if (!pending.has(edge.to)) {
        continue;
      }

      const nextDistance = currentDistance + edge.route.miles;
      if (nextDistance + 1e-9 < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, nextDistance);
        previous.set(edge.to, {
          from: currentId,
          route: edge.route
        });
      }
    }
  }

  if (!previous.has(destination.id)) {
    return buildMissingPlan(network, state, `Маршрут «${modeConfig.label}» не найден.`);
  }

  const legs = [];
  const cityIds = [destination.id];
  let cursor = destination.id;
  while (cursor !== origin.id) {
    const step = previous.get(cursor);
    if (!step) {
      return buildMissingPlan(network, state, `Маршрут «${modeConfig.label}» не найден.`);
    }

    legs.unshift(buildPlanLeg(network, step.from, cursor, step.route));
    cursor = step.from;
    cityIds.unshift(cursor);
  }

  const totalMiles = roundNumber(legs.reduce((sum, leg) => sum + leg.miles, 0), 2);
  const totalHours = roundNumber(totalMiles / network.speedMph, 2);
  return {
    available: true,
    reason: "",
    mode: state.mode,
    modeLabel: modeConfig.label,
    speedMph: network.speedMph,
    originCityId: origin.id,
    destinationCityId: destination.id,
    originName: origin.name,
    destinationName: destination.name,
    cityIds,
    totalMiles,
    totalHours,
    totalTravelDays: roundNumber(totalHours / TRAVEL_DAY_HOURS, 2),
    legs
  };
}

export function advanceTravelProgress(rawState = {}, rawPlan = {}, hours = 0) {
  const state = normalizeTravelState(rawState);
  const totalMiles = Math.max(0, roundNumber(toNumber(rawPlan.totalMiles, 0), 2));
  const speedMph = Math.max(0.01, toNumber(rawPlan.speedMph, DEFAULT_TRAVEL_SPEED_MPH));
  const safeHours = Math.max(0, roundNumber(toNumber(hours, 0), 2));
  const currentMiles = Math.max(0, Math.min(totalMiles, state.traveledMiles));
  const requestedMiles = roundNumber(safeHours * speedMph, 2);
  const addedMiles = Math.max(0, Math.min(requestedMiles, roundNumber(totalMiles - currentMiles, 2)));
  const traveledMiles = roundNumber(currentMiles + addedMiles, 2);

  return {
    ...state,
    traveledMiles,
    addedHours: safeHours,
    addedMiles,
    completed: totalMiles > 0 && traveledMiles + 1e-9 >= totalMiles
  };
}

function buildProgress(state, plan) {
  if (!plan?.available) {
    return {
      traveledMiles: 0,
      remainingMiles: 0,
      percent: 0,
      traveledHours: 0,
      remainingHours: 0,
      label: "Маршрут не выбран",
      completed: false
    };
  }

  const traveledMiles = Math.max(0, Math.min(plan.totalMiles, roundNumber(state.traveledMiles, 2)));
  const remainingMiles = roundNumber(Math.max(0, plan.totalMiles - traveledMiles), 2);
  const percent = plan.totalMiles > 0
    ? roundNumber((traveledMiles / plan.totalMiles) * 100, 2)
    : 0;
  const completed = remainingMiles <= 0.001;

  return {
    traveledMiles,
    remainingMiles,
    percent,
    traveledHours: roundNumber(traveledMiles / plan.speedMph, 2),
    remainingHours: roundNumber(remainingMiles / plan.speedMph, 2),
    label: `${traveledMiles} / ${plan.totalMiles} миль`,
    completed
  };
}

function buildCityOptions(cities, state) {
  return [...cities]
    .sort((left, right) => left.name.localeCompare(right.name, "ru"))
    .map((city) => ({
      value: city.id,
      label: city.name,
      subtitle: [city.state, city.regionName].filter(Boolean).join(" • "),
      searchText: [city.name, city.state, city.regionName, city.locationType].filter(Boolean).join(" "),
      selectedOrigin: city.id === state.originCityId,
      selectedDestination: city.id === state.destinationCityId
    }));
}

function buildModeOptions(state) {
  return Object.values(TRAVEL_MODE_CONFIG).map((mode) => ({
    value: mode.id,
    label: mode.label,
    selected: state.mode === mode.id,
    disabled: !mode.enabled,
    disabledReason: mode.disabledReason ?? ""
  }));
}

export function buildTravelSnapshot(rawNetwork = {}, rawState = {}, { warning = "", canAdvance = true } = {}) {
  const network = normalizeTravelNetwork(rawNetwork);
  const state = normalizeTravelState(rawState);
  const plan = buildTravelPlan(network, state);
  const progress = buildProgress(state, plan);

  return {
    available: !warning,
    warning,
    canAdvance: Boolean(canAdvance && plan.available && !progress.completed),
    canSelectRoute: Boolean(canAdvance),
    mode: state.mode,
    cityOptions: buildCityOptions(network.cities, state),
    modeOptions: buildModeOptions(state),
    plan,
    progress,
    emptyMessage: plan.reason || "Выберите города и способ пути.",
    speedMph: network.speedMph,
    speedLabel: `${network.speedMph} мили/час`
  };
}

export class TravelService {
  constructor({ groupContextService = null, networkPath = TRAVEL_NETWORK_PATH } = {}) {
    this.groupContextService = groupContextService;
    this.networkPath = networkPath;
    this.networkPromise = null;
  }

  setGroupContextService(groupContextService) {
    this.groupContextService = groupContextService;
  }

  async #loadNetwork() {
    if (!this.networkPromise) {
      this.networkPromise = (async () => {
        if (typeof fetch !== "function") {
          return normalizeTravelNetwork({});
        }

        const response = await fetch(this.networkPath);
        if (!response?.ok) {
          throw new Error("Не удалось загрузить дорожную сеть путешествий.");
        }
        return normalizeTravelNetwork(await response.json());
      })();
    }

    return this.networkPromise;
  }

  #getCurrentGroupContext() {
    if (!this.groupContextService?.resolveForCurrentUser) {
      return null;
    }
    return this.groupContextService.resolveForCurrentUser();
  }

  async #writeGroupTravelState(context, nextState) {
    if (!context?.groupId || !this.groupContextService) {
      throw new Error("Группа для путешествия не выбрана.");
    }

    if (!context.canManage) {
      throw new Error("Путешествием управляют участники группы или мастер.");
    }

    const registry = this.groupContextService.getRegistry();
    registry.groupsById[context.groupId] = {
      ...normalizeGroupState(context.groupId, registry.groupsById[context.groupId] ?? {}),
      travelState: clone(normalizeTravelState(nextState))
    };
    await this.groupContextService.setRegistry(registry);
    return normalizeTravelState(nextState);
  }

  async getSnapshot() {
    const network = await this.#loadNetwork();
    let context = null;
    try {
      context = this.#getCurrentGroupContext();
    }
    catch (error) {
      if (!GROUP_CONTEXT_FALLBACK_ERRORS.has(error?.message)) {
        throw error;
      }

      return buildTravelSnapshot(network, {}, {
        warning: error.message || "Группа для путешествия не выбрана.",
        canAdvance: false
      });
    }

    return buildTravelSnapshot(network, context?.groupState?.travelState ?? {}, {
      canAdvance: Boolean(context?.canManage)
    });
  }

  async setRoute({ originCityId = "", destinationCityId = "", mode = "land" } = {}) {
    const context = this.#getCurrentGroupContext();
    const currentState = normalizeTravelState(context?.groupState?.travelState ?? {});
    const nextState = normalizeTravelState({
      ...currentState,
      originCityId,
      destinationCityId,
      mode,
      traveledMiles: 0
    });
    await this.#writeGroupTravelState(context, nextState);
    return this.getSnapshot();
  }

  async clearRoute() {
    const context = this.#getCurrentGroupContext();
    await this.#writeGroupTravelState(context, normalizeTravelState({}));
    return this.getSnapshot();
  }

  async advanceHours(hours = 0) {
    const network = await this.#loadNetwork();
    const context = this.#getCurrentGroupContext();
    const currentState = normalizeTravelState(context?.groupState?.travelState ?? {});
    const plan = buildTravelPlan(network, currentState);
    if (!plan.available) {
      throw new Error(plan.reason || "Сначала выберите маршрут путешествия.");
    }

    const nextState = advanceTravelProgress(currentState, plan, hours);
    await this.#writeGroupTravelState(context, nextState);
    return this.getSnapshot();
  }
}
