import { MODULE_ID } from "../constants.js";
import { GROUP_CONTEXT_ERRORS } from "./group-context-service.js";
import { isActiveGmClient } from "../infrastructure/foundry/active-gm.js";

export const GROUP_TRAVEL_REPLACE_STATE_COMMAND = "group.travel.replaceState";

const TRAVEL_NETWORK_PATH = `modules/${MODULE_ID}/data/travel-network.json`;
const CANONICAL_CITY_CONNECTIONS_PATH = `modules/${MODULE_ID}/data/cities.json`;
const DEFAULT_TRAVEL_SPEED_MPH = 3;
const TRAVEL_DAY_HOURS = 8;
const DEFAULT_WORLD_MAP = Object.freeze({
  sceneName: "Карта мира",
  sourceWidth: 23906,
  sourceHeight: 13448,
  sceneWidth: 16000,
  sceneHeight: 9000
});
const GROUP_CONTEXT_FALLBACK_ERRORS = new Set([
  GROUP_CONTEXT_ERRORS.GM_NO_ACTIVE_GROUP,
  GROUP_CONTEXT_ERRORS.PLAYER_NO_GROUP,
  GROUP_CONTEXT_ERRORS.GROUP_NOT_FOUND
]);
const DISABLED_TRAVEL_ROUTE_IDS = new Set([
  "route-0464-land_plus_gray-орланис-фрех"
]);
const ROUTE_ENDPOINT_SNAP_DISTANCE = 600;
const ROUTE_GEOMETRY_SLICE_SNAP_DISTANCE = 160;

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

function normalizePoint(value) {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const x = Number(value[0]);
  const y = Number(value[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return [x, y];
}

function normalizeRoutePoints(value) {
  return Array.isArray(value)
    ? value.map((point) => normalizePoint(point)).filter(Boolean)
    : [];
}

function hasCityCoordinates(city) {
  return Number.isFinite(Number(city?.x)) && Number.isFinite(Number(city?.y));
}

function distancePointToCity(point, city) {
  if (!point || !hasCityCoordinates(city)) {
    return Infinity;
  }

  return Math.hypot(point[0] - Number(city.x), point[1] - Number(city.y));
}

function findNearestCityToPoint(point, cities = []) {
  let nearestCity = null;
  let nearestDistance = Infinity;
  for (const city of cities) {
    const distance = distancePointToCity(point, city);
    if (distance < nearestDistance) {
      nearestCity = city;
      nearestDistance = distance;
    }
  }

  return nearestCity ? { city: nearestCity, distance: nearestDistance } : null;
}

function snapRouteEndpointCity(declaredCity, point, cities = []) {
  const nearest = findNearestCityToPoint(point, cities);
  if (!nearest || nearest.distance > ROUTE_ENDPOINT_SNAP_DISTANCE) {
    return declaredCity ?? null;
  }

  const declaredDistance = distancePointToCity(point, declaredCity);
  if (!declaredCity || declaredDistance > ROUTE_ENDPOINT_SNAP_DISTANCE) {
    return nearest.city;
  }

  return declaredCity;
}

function buildDirectRoutePoints(sourceCity, targetCity) {
  return hasCityCoordinates(sourceCity) && hasCityCoordinates(targetCity)
    ? [[Number(sourceCity.x), Number(sourceCity.y)], [Number(targetCity.x), Number(targetCity.y)]]
    : [];
}

function normalizeMapConfig(value = {}) {
  const source = asObject(value);
  return {
    sceneName: String(source.sceneName ?? DEFAULT_WORLD_MAP.sceneName).trim() || DEFAULT_WORLD_MAP.sceneName,
    sourceWidth: Math.max(1, toNumber(source.sourceWidth, DEFAULT_WORLD_MAP.sourceWidth)),
    sourceHeight: Math.max(1, toNumber(source.sourceHeight, DEFAULT_WORLD_MAP.sourceHeight)),
    sceneWidth: Math.max(1, toNumber(source.sceneWidth, DEFAULT_WORLD_MAP.sceneWidth)),
    sceneHeight: Math.max(1, toNumber(source.sceneHeight, DEFAULT_WORLD_MAP.sceneHeight))
  };
}

export function normalizeLocationName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[\u2019\u2018\u02bc\u02b9\u2032`´"]/gu, "'")
    .replace(/\s+/gu, " ");
}

function normalizeLooseLocationName(value) {
  return normalizeLocationName(value).replace(/[^a-zа-я0-9]+/gu, "");
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
  if (text.includes("воздух")) {
    return "air";
  }
  if (text.includes("земля") || text.includes("песок") || text.includes("суша")) {
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
    const looseName = normalizeLooseLocationName(city.name);
    if (looseName && !cityByName.has(looseName)) {
      cityByName.set(looseName, city);
    }
    if (city.searchName) {
      cityByName.set(city.searchName, city);
      const looseSearchName = normalizeLooseLocationName(city.searchName);
      if (looseSearchName && !cityByName.has(looseSearchName)) {
        cityByName.set(looseSearchName, city);
      }
    }
  }
  return { cityById, cityByName };
}

function getCityByName(cityByName, value) {
  return cityByName.get(normalizeLocationName(value))
    ?? cityByName.get(normalizeLooseLocationName(value));
}

function normalizeRoute(row = {}, cityById = new Map(), cityByName = new Map(), cities = []) {
  const explicitSourceId = cleanId(row.sourceId);
  const explicitTargetId = cleanId(row.targetId);
  const points = normalizeRoutePoints(row.points);
  const declaredSource = explicitSourceId
    ? cityById.get(explicitSourceId)
    : getCityByName(cityByName, row.source);
  const declaredTarget = explicitTargetId
    ? cityById.get(explicitTargetId)
    : getCityByName(cityByName, row.target);
  const source = points.length >= 2
    ? snapRouteEndpointCity(declaredSource, points[0], cities) ?? declaredSource
    : declaredSource;
  const target = points.length >= 2
    ? snapRouteEndpointCity(declaredTarget, points.at(-1), cities) ?? declaredTarget
    : declaredTarget;
  const sourceId = source?.id || explicitSourceId || "";
  const targetId = target?.id || explicitTargetId || "";
  const miles = roundNumber(toNumber(row.miles, 0), 2);
  const mode = normalizeRouteMode(row.mode, row.type);

  return {
    id: cleanId(row.id) || `${sourceId}-${targetId}-${mode}`,
    sourceId,
    targetId,
    sourceName: String(source?.name ?? row.sourceName ?? row.source ?? "").trim(),
    targetName: String(target?.name ?? row.targetName ?? row.target ?? "").trim(),
    mode,
    type: String(row.type ?? "").trim(),
    miles,
    points
  };
}

function buildRoutePairKey(sourceId, targetId) {
  return [cleanId(sourceId), cleanId(targetId)].sort().join("\u0000");
}

function buildRouteVariantKey(sourceId, targetId, mode, type = "") {
  return [
    buildRoutePairKey(sourceId, targetId),
    cleanId(mode),
    normalizeLocationName(type)
  ].join("\u0000");
}

function pickRouteWithGeometry(left = null, right = null) {
  if (!left) {
    return right ?? null;
  }
  if (!right) {
    return left;
  }

  return right.points.length > left.points.length ? right : left;
}

function buildGeometryModeSet(mode) {
  if (mode === "land" || mode === "rail" || mode === "land_plus_gray") {
    return new Set(["land", "land_plus_gray", "rail"]);
  }
  if (mode === "water") {
    return new Set(["water"]);
  }
  if (mode === "air") {
    return new Set(["air"]);
  }

  return new Set([mode]);
}

function findNearestRoutePointIndex(points = [], city = null) {
  if (!hasCityCoordinates(city) || !Array.isArray(points) || !points.length) {
    return { index: -1, distance: Infinity };
  }

  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const distance = distancePointToCity(point, city);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }

  return { index: bestIndex, distance: bestDistance };
}

function polylinePixelLength(points = []) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distanceBetweenPoints(points[index - 1], points[index]);
  }

  return total;
}

function sliceRouteGeometry(route = null, sourceCity = null, targetCity = null) {
  const points = normalizeRoutePoints(route?.points);
  if (points.length < 2) {
    return null;
  }

  const sourceNearest = findNearestRoutePointIndex(points, sourceCity);
  const targetNearest = findNearestRoutePointIndex(points, targetCity);
  if (
    sourceNearest.index < 0
    || targetNearest.index < 0
    || sourceNearest.index === targetNearest.index
    || sourceNearest.distance > ROUTE_GEOMETRY_SLICE_SNAP_DISTANCE
    || targetNearest.distance > ROUTE_GEOMETRY_SLICE_SNAP_DISTANCE
  ) {
    return null;
  }

  const start = Math.min(sourceNearest.index, targetNearest.index);
  const end = Math.max(sourceNearest.index, targetNearest.index);
  const slice = points.slice(start, end + 1);
  const orientedPoints = sourceNearest.index <= targetNearest.index ? slice : slice.reverse();
  return {
    points: orientedPoints,
    endpointDistance: sourceNearest.distance + targetNearest.distance,
    pixelLength: polylinePixelLength(orientedPoints)
  };
}

function findNearbyRouteGeometry(routes = [], sourceCity = null, targetCity = null, mode = "land") {
  const allowedModes = buildGeometryModeSet(mode);
  let best = null;

  for (const route of routes) {
    if (!allowedModes.has(route.mode)) {
      continue;
    }

    const candidate = sliceRouteGeometry(route, sourceCity, targetCity);
    if (!candidate) {
      continue;
    }

    if (
      !best
      || candidate.endpointDistance < best.endpointDistance - 1e-9
      || (
        Math.abs(candidate.endpointDistance - best.endpointDistance) <= 1e-9
        && candidate.pixelLength < best.pixelLength
      )
    ) {
      best = candidate;
    }
  }

  return best?.points ?? [];
}

function buildExistingRouteIndexes(routes = []) {
  const byVariant = new Map();
  const byMode = new Map();
  const byPair = new Map();

  for (const route of routes) {
    const pairKey = buildRoutePairKey(route.sourceId, route.targetId);
    const variantKey = buildRouteVariantKey(route.sourceId, route.targetId, route.mode, route.type);
    const modeKey = [
      pairKey,
      route.mode
    ].join("\u0000");
    byVariant.set(variantKey, pickRouteWithGeometry(byVariant.get(variantKey), route));
    byMode.set(modeKey, pickRouteWithGeometry(byMode.get(modeKey), route));
    byPair.set(pairKey, pickRouteWithGeometry(byPair.get(pairKey), route));
  }

  return { byVariant, byMode, byPair };
}

function slugRoutePart(value) {
  return normalizeLocationName(value)
    .replace(/[^a-zа-я0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "route";
}

function getCanonicalConnectionMode(connectionType) {
  const mode = normalizeRouteMode("", connectionType);
  if (mode === "rail" || mode === "water" || mode === "air") {
    return mode;
  }

  return "land";
}

function buildCanonicalCityRoutes(
  economyCities = [],
  cityById = new Map(),
  cityByName = new Map(),
  existingRoutes = [],
  geometryRoutes = existingRoutes
) {
  if (!Array.isArray(economyCities) || !economyCities.length) {
    return [];
  }

  const economyCityById = new Map();
  for (const city of economyCities) {
    const id = cleanId(city?.id);
    if (id) {
      economyCityById.set(id, city);
    }
  }

  const existingRouteIndexes = buildExistingRouteIndexes(existingRoutes);
  const canonicalRouteByKey = new Map();

  for (const economyCity of economyCities) {
    const sourceCity = getCityByName(cityByName, economyCity?.name);
    if (!sourceCity) {
      continue;
    }

    for (const connection of economyCity.connections ?? []) {
      if (connection?.broken) {
        continue;
      }

      const targetEconomyCity = economyCityById.get(cleanId(connection.targetCityId));
      const targetName = targetEconomyCity?.name ?? connection.targetName;
      const targetCity = getCityByName(cityByName, targetName);
      if (!targetCity || targetCity.id === sourceCity.id) {
        continue;
      }

      const miles = roundNumber(toNumber(connection.distance, 0), 2);
      if (miles <= 0) {
        continue;
      }

      const type = String(connection.connectionType ?? "").trim();
      const mode = getCanonicalConnectionMode(type);
      const routeKey = buildRouteVariantKey(sourceCity.id, targetCity.id, mode, type);
      const existingRoute = existingRouteIndexes.byVariant.get(routeKey)
        ?? existingRouteIndexes.byMode.get([buildRoutePairKey(sourceCity.id, targetCity.id), mode].join("\u0000"))
        ?? existingRouteIndexes.byPair.get(buildRoutePairKey(sourceCity.id, targetCity.id));
      const sourceId = existingRoute?.sourceId ?? sourceCity.id;
      const targetId = existingRoute?.targetId ?? targetCity.id;
      const source = cityById.get(sourceId) ?? sourceCity;
      const target = cityById.get(targetId) ?? targetCity;
      const routePoints = existingRoute?.points?.length >= 2
        ? existingRoute.points
        : findNearbyRouteGeometry(geometryRoutes, sourceCity, targetCity, mode);
      const points = routePoints.length >= 2
        ? routePoints
        : buildDirectRoutePoints(sourceCity, targetCity);
      const currentRoute = canonicalRouteByKey.get(routeKey);

      if (currentRoute) {
        currentRoute.miles = Math.min(currentRoute.miles, miles);
        if (points.length > currentRoute.points.length) {
          currentRoute.points = points;
          currentRoute.sourceId = sourceId;
          currentRoute.targetId = targetId;
          currentRoute.sourceName = source.name;
          currentRoute.targetName = target.name;
        }
        continue;
      }

      canonicalRouteByKey.set(routeKey, {
        id: existingRoute?.id ?? `canonical-${mode}-${slugRoutePart(source.name)}-${slugRoutePart(target.name)}-${slugRoutePart(type)}`,
        sourceId,
        targetId,
        sourceName: source.name,
        targetName: target.name,
        mode,
        type,
        miles,
        points
      });
    }
  }

  return [...canonicalRouteByKey.values()];
}

export function normalizeTravelNetwork(value = {}) {
  const rawCities = Array.isArray(value.cities) ? value.cities : [];
  const cities = rawCities
    .map((row) => normalizeCity(row))
    .filter((city) => city.id && city.name);
  const { cityById, cityByName } = buildCityLookup(cities);

  const rawRoutes = Array.isArray(value.routes) ? value.routes : [];
  const normalizedRoutes = rawRoutes
    .map((row) => normalizeRoute(row, cityById, cityByName, cities))
    .filter((route) => (
      route.sourceId
      && route.targetId
      && route.sourceId !== route.targetId
      && cityById.has(route.sourceId)
      && cityById.has(route.targetId)
      && route.miles > 0
    ));
  const routes = normalizedRoutes.filter((route) => !DISABLED_TRAVEL_ROUTE_IDS.has(route.id));
  const geometryRoutes = normalizedRoutes.filter((route) => route.points.length >= 2);
  const economyCities = value.economyCities ?? value.canonicalCities;
  const canonicalRoutes = buildCanonicalCityRoutes(
    economyCities,
    cityById,
    cityByName,
    routes,
    geometryRoutes
  );
  const mergedRoutes = Array.isArray(economyCities) && economyCities.length
    ? canonicalRoutes
    : routes;

  return {
    schema: value.schema ?? "rebreya-travel-network/v1",
    map: normalizeMapConfig(value.map),
    speedMph: Math.max(0.01, toNumber(value.speedMph, DEFAULT_TRAVEL_SPEED_MPH)),
    cities,
    routes: mergedRoutes,
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
  const fallbackPoints = fromCity && toCity && Number.isFinite(fromCity.x) && Number.isFinite(fromCity.y) && Number.isFinite(toCity.x) && Number.isFinite(toCity.y)
    ? [[fromCity.x, fromCity.y], [toCity.x, toCity.y]]
    : [];
  const hasRoutePoints = route.points.length >= 2;
  const routePoints = hasRoutePoints ? route.points : fallbackPoints;
  const points = hasRoutePoints && route.sourceId === fromId && route.targetId === toId
    ? routePoints
    : hasRoutePoints
      ? [...routePoints].reverse()
      : routePoints;

  return {
    routeId: route.id,
    sourceCityId: fromId,
    sourceName: fromCity?.name ?? route.sourceName ?? fromId,
    targetCityId: toId,
    targetName: toCity?.name ?? route.targetName ?? toId,
    mode: route.mode,
    type: route.type,
    miles: route.miles,
    hours: roundNumber(route.miles / network.speedMph, 2),
    points
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

function buildMissingMapPosition(reason = "") {
  return {
    available: false,
    reason,
    sceneName: DEFAULT_WORLD_MAP.sceneName,
    sourceX: 0,
    sourceY: 0,
    sceneX: 0,
    sceneY: 0,
    routeId: "",
    legIndex: -1
  };
}

function distanceBetweenPoints(left, right) {
  return Math.hypot(toNumber(right?.[0], 0) - toNumber(left?.[0], 0), toNumber(right?.[1], 0) - toNumber(left?.[1], 0));
}

function pointAlongPolyline(points = [], ratio = 0) {
  const safePoints = normalizeRoutePoints(points);
  if (!safePoints.length) {
    return null;
  }
  if (safePoints.length === 1) {
    return safePoints[0];
  }

  const segments = [];
  let totalPixels = 0;
  for (let index = 1; index < safePoints.length; index += 1) {
    const from = safePoints[index - 1];
    const to = safePoints[index];
    const length = distanceBetweenPoints(from, to);
    if (length <= 0) {
      continue;
    }

    segments.push({ from, to, length });
    totalPixels += length;
  }

  if (totalPixels <= 0 || !segments.length) {
    return safePoints[0];
  }

  let remainingPixels = totalPixels * Math.max(0, Math.min(1, toNumber(ratio, 0)));
  for (const segment of segments) {
    if (remainingPixels <= segment.length) {
      const segmentRatio = segment.length > 0 ? remainingPixels / segment.length : 0;
      return [
        segment.from[0] + ((segment.to[0] - segment.from[0]) * segmentRatio),
        segment.from[1] + ((segment.to[1] - segment.from[1]) * segmentRatio)
      ];
    }

    remainingPixels -= segment.length;
  }

  return safePoints[safePoints.length - 1];
}

export function buildTravelMapPosition(rawNetwork = {}, rawPlan = {}, rawState = {}) {
  const network = normalizeTravelNetwork(rawNetwork);
  const state = normalizeTravelState(rawState);
  const plan = rawPlan?.available ? rawPlan : buildTravelPlan(network, state);
  if (!plan?.available) {
    return buildMissingMapPosition(plan?.reason || "Маршрут для карты не выбран.");
  }

  const traveledMiles = Math.max(0, Math.min(plan.totalMiles, roundNumber(state.traveledMiles, 2)));
  let cursorMiles = 0;
  let activeLeg = null;
  let activeLegIndex = -1;
  let activeLegMiles = 0;

  for (let index = 0; index < plan.legs.length; index += 1) {
    const leg = plan.legs[index];
    const nextCursor = cursorMiles + Math.max(0, toNumber(leg.miles, 0));
    if (traveledMiles <= nextCursor || index === plan.legs.length - 1) {
      activeLeg = leg;
      activeLegIndex = index;
      activeLegMiles = Math.max(0, traveledMiles - cursorMiles);
      break;
    }

    cursorMiles = nextCursor;
  }

  if (!activeLeg) {
    return buildMissingMapPosition("В маршруте нет участков для карты.");
  }

  const legMiles = Math.max(0.01, toNumber(activeLeg.miles, 0.01));
  const point = pointAlongPolyline(activeLeg.points, activeLegMiles / legMiles);
  if (!point) {
    return buildMissingMapPosition("У участка маршрута нет координат карты.");
  }

  const map = network.map;
  const sourceX = roundNumber(point[0], 2);
  const sourceY = roundNumber(point[1], 2);
  return {
    available: true,
    reason: "",
    sceneName: map.sceneName,
    sourceX,
    sourceY,
    sceneX: roundNumber(sourceX * (map.sceneWidth / map.sourceWidth), 2),
    sceneY: roundNumber(sourceY * (map.sceneHeight / map.sourceHeight), 2),
    routeId: activeLeg.routeId,
    legIndex: activeLegIndex,
    completed: traveledMiles + 1e-9 >= plan.totalMiles
  };
}

export function advanceTravelProgress(rawState = {}, rawPlan = {}, hours = 0) {
  const state = normalizeTravelState(rawState);
  const totalMiles = Math.max(0, roundNumber(toNumber(rawPlan.totalMiles, 0), 2));
  const speedMph = Math.max(0.01, toNumber(rawPlan.speedMph, DEFAULT_TRAVEL_SPEED_MPH));
  const requestedHours = roundNumber(toNumber(hours, 0), 2);
  const currentMiles = Math.max(0, Math.min(totalMiles, state.traveledMiles));
  const requestedMiles = roundNumber(requestedHours * speedMph, 2);
  const traveledMiles = roundNumber(Math.max(0, Math.min(totalMiles, currentMiles + requestedMiles)), 2);
  const addedMiles = roundNumber(traveledMiles - currentMiles, 2);
  const addedHours = roundNumber(addedMiles / speedMph, 2);

  return {
    ...state,
    traveledMiles,
    requestedHours,
    addedHours,
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
      traveledTravelDays: 0,
      remainingTravelDays: 0,
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
  const traveledHours = roundNumber(traveledMiles / plan.speedMph, 2);
  const remainingHours = roundNumber(remainingMiles / plan.speedMph, 2);

  return {
    traveledMiles,
    remainingMiles,
    percent,
    traveledHours,
    remainingHours,
    traveledTravelDays: roundNumber(traveledHours / TRAVEL_DAY_HOURS, 2),
    remainingTravelDays: roundNumber(remainingHours / TRAVEL_DAY_HOURS, 2),
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

export function buildTravelSnapshot(rawNetwork = {}, rawState = {}, {
  warning = "",
  canAdvance = true,
  speedLabel = "",
  speedSourceLabel = ""
} = {}) {
  const network = normalizeTravelNetwork(rawNetwork);
  const state = normalizeTravelState(rawState);
  const plan = buildTravelPlan(network, state);
  const progress = buildProgress(state, plan);
  const mapPosition = buildTravelMapPosition(network, plan, state);
  const originCity = network.cityById.get(state.originCityId) ?? null;
  const destinationCity = network.cityById.get(state.destinationCityId) ?? null;

  return {
    available: !warning,
    warning,
    canAdvance: Boolean(canAdvance && plan.available && !progress.completed),
    canRewind: Boolean(canAdvance && plan.available && progress.traveledMiles > 0.001),
    canSelectRoute: Boolean(canAdvance),
    mode: state.mode,
    originCityId: state.originCityId,
    originCityName: originCity?.name ?? "",
    destinationCityId: state.destinationCityId,
    destinationCityName: destinationCity?.name ?? "",
    cityOptions: buildCityOptions(network.cities, state),
    modeOptions: buildModeOptions(state),
    plan,
    progress,
    mapPosition,
    emptyMessage: plan.reason || "Выберите города и способ пути.",
    speedMph: network.speedMph,
    speedLabel: cleanId(speedLabel) || `${network.speedMph} мили/час`,
    speedSourceLabel: cleanId(speedSourceLabel)
  };
}

export class TravelService {
  constructor({ groupContextService = null, commandBus = null, networkPath = TRAVEL_NETWORK_PATH, citiesPath = CANONICAL_CITY_CONNECTIONS_PATH, speedProvider = null } = {}) {
    this.groupContextService = groupContextService;
    this.commandBus = commandBus;
    this.networkPath = networkPath;
    this.citiesPath = citiesPath;
    this.networkPromise = null;
    this.speedProvider = typeof speedProvider === "function" ? speedProvider : null;
  }

  setGroupContextService(groupContextService) {
    this.groupContextService = groupContextService;
  }

  setSpeedProvider(speedProvider) {
    this.speedProvider = typeof speedProvider === "function" ? speedProvider : null;
  }

  async #resolveNetworkForContext(network, context) {
    if (!this.speedProvider) {
      return {
        network,
        speedLabel: `${network.speedMph} мили/час`,
        speedSourceLabel: ""
      };
    }

    const speedMeta = await this.speedProvider(context);
    const speedMph = Math.max(0.01, toNumber(speedMeta?.speedMph, network.speedMph));
    return {
      network: {
        ...network,
        speedMph
      },
      speedLabel: cleanId(speedMeta?.label) || `${speedMph} мили/час`,
      speedSourceLabel: cleanId(speedMeta?.sourceLabel)
    };
  }

  async #loadNetwork() {
    if (!this.networkPromise) {
      this.networkPromise = (async () => {
        if (typeof fetch !== "function") {
          return normalizeTravelNetwork({});
        }

        const [networkResponse, citiesResponse] = await Promise.all([
          fetch(this.networkPath),
          this.citiesPath ? fetch(this.citiesPath) : Promise.resolve(null)
        ]);
        if (!networkResponse?.ok) {
          throw new Error("Не удалось загрузить дорожную сеть путешествий.");
        }
        if (this.citiesPath && !citiesResponse?.ok) {
          throw new Error("Не удалось загрузить канонические связи городов.");
        }

        const rawNetwork = await networkResponse.json();
        const economyCities = citiesResponse ? await citiesResponse.json() : [];
        return normalizeTravelNetwork({ ...rawNetwork, economyCities });
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

    const travelState = normalizeTravelState(nextState);
    const committedState = isActiveGmClient(globalThis.game)
      ? await this.replaceGroupTravelState(context.groupId, travelState)
      : await this.commandBus?.request?.(GROUP_TRAVEL_REPLACE_STATE_COMMAND, {
        groupActorId: context.groupId,
        travelState
      });
    if (!committedState) {
      throw new Error("Travel command bus is unavailable.");
    }
    return normalizeTravelState(committedState);
  }

  replaceGroupTravelState(groupActorId, nextState) {
    if (!this.groupContextService?.mutateGroupState) {
      throw new Error("Group context service is unavailable.");
    }

    const travelState = normalizeTravelState(nextState);
    return this.groupContextService.mutateGroupState(groupActorId, (groupState) => {
      groupState.travelState = clone(travelState);
      return travelState;
    });
  }

  async getSnapshot() {
    const baseNetwork = await this.#loadNetwork();
    let context = null;
    try {
      context = this.#getCurrentGroupContext();
    }
    catch (error) {
      if (!GROUP_CONTEXT_FALLBACK_ERRORS.has(error?.message)) {
        throw error;
      }

      return buildTravelSnapshot(baseNetwork, {}, {
        warning: error.message || "Группа для путешествия не выбрана.",
        canAdvance: false
      });
    }

    const { network, speedLabel, speedSourceLabel } = await this.#resolveNetworkForContext(baseNetwork, context);
    return buildTravelSnapshot(network, context?.groupState?.travelState ?? {}, {
      canAdvance: Boolean(context?.canManage),
      speedLabel,
      speedSourceLabel
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
    const committedState = await this.#writeGroupTravelState(context, nextState);
    const baseNetwork = await this.#loadNetwork();
    const { network, speedLabel, speedSourceLabel } = await this.#resolveNetworkForContext(baseNetwork, context);
    return buildTravelSnapshot(network, committedState, {
      canAdvance: Boolean(context?.canManage),
      speedLabel,
      speedSourceLabel
    });
  }

  async clearRoute() {
    const context = this.#getCurrentGroupContext();
    const committedState = await this.#writeGroupTravelState(context, normalizeTravelState({}));
    const baseNetwork = await this.#loadNetwork();
    const { network, speedLabel, speedSourceLabel } = await this.#resolveNetworkForContext(baseNetwork, context);
    return buildTravelSnapshot(network, committedState, {
      canAdvance: Boolean(context?.canManage),
      speedLabel,
      speedSourceLabel
    });
  }

  async advanceHours(hours = 0) {
    const baseNetwork = await this.#loadNetwork();
    const context = this.#getCurrentGroupContext();
    const { network, speedLabel, speedSourceLabel } = await this.#resolveNetworkForContext(baseNetwork, context);
    const currentState = normalizeTravelState(context?.groupState?.travelState ?? {});
    const plan = buildTravelPlan(network, currentState);
    if (!plan.available) {
      throw new Error(plan.reason || "Сначала выберите маршрут путешествия.");
    }

    const nextState = advanceTravelProgress(currentState, plan, hours);
    const committedState = await this.#writeGroupTravelState(context, nextState);
    const snapshot = buildTravelSnapshot(network, committedState, {
      canAdvance: Boolean(context?.canManage),
      speedLabel,
      speedSourceLabel
    });
    return {
      ...snapshot,
      travelChange: {
        requestedHours: nextState.requestedHours,
        appliedHours: nextState.addedHours,
        appliedMiles: nextState.addedMiles
      }
    };
  }
}
