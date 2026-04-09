import { BUILTIN_DATA_PATH, DATA_SOURCE_MODES, MODULE_ID, SETTINGS_KEYS } from "../constants.js";
import { normalizeEconomyDataset } from "./normalizer.js";

function trimTrailingSlash(path) {
  return String(path ?? "").trim().replace(/[\\/]+$/, "");
}

function getConfiguredBasePath() {
  const mode = game.settings.get(MODULE_ID, SETTINGS_KEYS.DATA_SOURCE_MODE);
  const customPath = trimTrailingSlash(game.settings.get(MODULE_ID, SETTINGS_KEYS.CUSTOM_DATA_PATH));

  if (mode === DATA_SOURCE_MODES.CUSTOM && customPath) {
    return {
      mode,
      basePath: customPath,
      fallbackPath: BUILTIN_DATA_PATH
    };
  }

  return {
    mode: DATA_SOURCE_MODES.BUILTIN,
    basePath: BUILTIN_DATA_PATH,
    fallbackPath: null
  };
}

async function fetchJson(path, { optional = false } = {}) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    if (optional && response.status === 404) {
      return null;
    }

    throw new Error(`Failed to load ${path}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function loadFromBasePath(basePath) {
  const normalizedBasePath = trimTrailingSlash(basePath);
  const [goods, regions, cities, reference, materials, gear] = await Promise.all([
    fetchJson(`${normalizedBasePath}/goods.json`),
    fetchJson(`${normalizedBasePath}/regions.json`),
    fetchJson(`${normalizedBasePath}/cities.json`),
    fetchJson(`${normalizedBasePath}/reference.json`),
    fetchJson(`${normalizedBasePath}/materials.json`, { optional: true }),
    fetchJson(`${normalizedBasePath}/gear.json`, { optional: true })
  ]);

  return normalizeEconomyDataset({
    goods,
    regions,
    cities,
    reference,
    materials: Array.isArray(materials) ? materials : [],
    gear: Array.isArray(gear) ? gear : [],
    source: {
      basePath: normalizedBasePath
    }
  });
}

export async function loadEconomyDataset() {
  const config = getConfiguredBasePath();

  try {
    const dataset = await loadFromBasePath(config.basePath);
    dataset.source.mode = config.mode;
    return dataset;
  }
  catch (error) {
    if (!config.fallbackPath) {
      throw error;
    }

    console.warn(`${MODULE_ID} | Failed to load economy data from custom path '${config.basePath}'. Falling back to built-in data.`, error);
    ui.notifications?.warn(game.i18n.localize("REBREYA_MAIN.Notifications.CustomPathFallback"));

    const dataset = await loadFromBasePath(config.fallbackPath);
    dataset.source.mode = DATA_SOURCE_MODES.BUILTIN;
    return dataset;
  }
}
