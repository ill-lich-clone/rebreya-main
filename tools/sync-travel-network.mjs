import fs from "node:fs";
import path from "node:path";

const defaultOutputPath = path.resolve("data/travel-network.json");
const mapRoot = process.argv[2] || process.env.MAP_ROOT;
const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : defaultOutputPath;

if (!mapRoot) {
  throw new Error("Pass the interactive map folder path as argv[2] or MAP_ROOT.");
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(mapRoot, relativePath), "utf8"));
}

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/[\u2019\u2018\u02bc\u02b9\u2032`'"]/gu, "'")
    .replace(/\s+/gu, " ");
}

function normalizeLooseName(value) {
  return normalizeName(value).replace(/[^a-z\u0430-\u044f0-9]+/gu, "");
}

function normalizeMode(mode, type = "") {
  const rawMode = String(mode ?? "").trim().toLowerCase();
  if (rawMode === "land_plus_gray" || rawMode.startsWith("land")) {
    return "land";
  }
  if (rawMode.startsWith("rail")) {
    return "rail";
  }
  if (rawMode.startsWith("water")) {
    return "water";
  }
  if (rawMode.startsWith("air")) {
    return "air";
  }

  const text = normalizeName(type);
  if (text.includes("\u0436\u0434") || text.includes("\u0436\u0435\u043b\u0435\u0437")) {
    return "rail";
  }
  if (text.includes("\u043c\u043e\u0440\u0435") || text.includes("\u0440\u0435\u043a\u0430") || text.includes("\u0432\u043e\u0434\u0430")) {
    return "water";
  }
  if (text.includes("\u0432\u043e\u0437\u0434\u0443\u0445")) {
    return "air";
  }
  return "land";
}

const metadata = readJson("metadata.json");
const cityRaw = readJson("data/cities.json");
const routeRaw = readJson("data/routes.json");
const mapCities = Array.isArray(cityRaw) ? cityRaw : cityRaw.cities;
const mapRoutes = Array.isArray(routeRaw) ? routeRaw : routeRaw.routes;
const routeEndpointSnapDistance = 600;
const cityByName = new Map();
for (const city of mapCities) {
  cityByName.set(normalizeName(city.name), city);
  const looseName = normalizeLooseName(city.name);
  if (looseName && !cityByName.has(looseName)) {
    cityByName.set(looseName, city);
  }
}

function getCityByName(value) {
  return cityByName.get(normalizeName(value)) ?? cityByName.get(normalizeLooseName(value));
}

function hasCityCoordinates(city) {
  return Number.isFinite(Number(city?.x)) && Number.isFinite(Number(city?.y));
}

function distancePointToCity(point, city) {
  if (!Array.isArray(point) || point.length < 2 || !hasCityCoordinates(city)) {
    return Infinity;
  }

  return Math.hypot(point[0] - Number(city.x), point[1] - Number(city.y));
}

function findNearestCityToPoint(point) {
  let nearestCity = null;
  let nearestDistance = Infinity;
  for (const city of mapCities) {
    const distance = distancePointToCity(point, city);
    if (distance < nearestDistance) {
      nearestCity = city;
      nearestDistance = distance;
    }
  }

  return nearestCity ? { city: nearestCity, distance: nearestDistance } : null;
}

function snapEndpointCity(declaredCity, point) {
  const nearest = findNearestCityToPoint(point);
  if (!nearest || nearest.distance > routeEndpointSnapDistance) {
    return declaredCity ?? null;
  }

  const declaredDistance = distancePointToCity(point, declaredCity);
  if (!declaredCity || declaredDistance > routeEndpointSnapDistance) {
    return nearest.city;
  }

  return declaredCity;
}

const fieldState = "\u0413\u043e\u0441\u0443\u0434\u0430\u0440\u0441\u0442\u0432\u043e";
const fieldRegion = "\u0420\u0435\u0433\u0438\u043e\u043d";
const fieldLocation = "\u0422\u0438\u043f \u043b\u043e\u043a\u0430\u0446\u0438\u0438";
const fieldPopulation = "\u041d\u0430\u0441\u0435\u043b\u0435\u043d\u0438\u0435";

const cities = mapCities.map((city) => ({
  id: city.id,
  name: city.name,
  norm: city.norm,
  x: city.x,
  y: city.y,
  class: city.class,
  state: city.fields?.[fieldState] ?? "",
  regionName: city.fields?.[fieldRegion] ?? "",
  locationType: city.fields?.[fieldLocation] ?? "",
  population: Number(city.fields?.[fieldPopulation] ?? 0) || 0
}));

const routes = mapRoutes.map((route) => {
  const points = Array.isArray(route.points) ? route.points : [];
  const declaredSource = getCityByName(route.source);
  const declaredTarget = getCityByName(route.target);
  const source = points.length >= 2 ? snapEndpointCity(declaredSource, points[0]) : declaredSource;
  const target = points.length >= 2 ? snapEndpointCity(declaredTarget, points.at(-1)) : declaredTarget;
  return {
    id: route.id,
    sourceId: source?.id ?? "",
    targetId: target?.id ?? "",
    sourceName: source?.name ?? route.source,
    targetName: target?.name ?? route.target,
    mode: normalizeMode(route.mode, route.type),
    type: route.type,
    miles: Number(route.miles ?? 0),
    bbox: route.bbox,
    points
  };
});

const modeCounts = {};
for (const route of routes) {
  modeCounts[route.mode] = (modeCounts[route.mode] ?? 0) + 1;
}

const unresolvedRoutes = routes
  .filter((route) => !route.sourceId || !route.targetId)
  .map((route) => ({ id: route.id, source: route.sourceName, target: route.targetName }));

const output = {
  schema: "rebreya-travel-network/v1",
  generatedAt: new Date().toISOString(),
  source: {
    tileProject: mapRoot,
    metadataGeneratedAt: metadata.generatedAt,
    routeSource: "interactive-map-data/routes.json",
    citySource: "interactive-map-data/cities.json"
  },
  speedMph: 3,
  cities,
  routes,
  stats: {
    cityCount: cities.length,
    routeCount: routes.length,
    unresolvedRouteCount: unresolvedRoutes.length,
    modeCounts,
    unresolvedRoutes
  },
  map: {
    sceneName: "\u041a\u0430\u0440\u0442\u0430 \u043c\u0438\u0440\u0430",
    sourceWidth: metadata.source?.width ?? 23906,
    sourceHeight: metadata.source?.height ?? 13448,
    sceneWidth: 16000,
    sceneHeight: 9000,
    coordinateSystem: "image-pixels-top-left"
  }
};

fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify(output.stats, null, 2));
