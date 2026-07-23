import { BUILTIN_DATA_PATH, DATA_SOURCE_MODES, MODULE_ID, SETTINGS_KEYS } from "../constants.js";
import { normalizeEconomyDataset } from "./normalizer.js?v=1.4.109-implants-1";

const LEGACY_IMPLANT_ID_BY_SOURCE_NAME = Object.freeze({
  "Настроенные сервопривод": "nastroennye-servoprivody",
  "Сокрушительные конечности (М)": "sokrushitelnye-konechnosti",
  "Конденсатор магии (М)": "kondensator-magii",
  "Модуль чувства жизни (М)": "modul-chuvstva-zhizni",
  "Телепатический модуль (М)": "telepaticheskiy-modul",
  "Язык чудовища (м)": "yazyk-chudovishcha",
  "Модуль иммитации речи (м)": "modul-imitatsii-rechi",
  "Искуственный глаз": "iskusstvennyy-glaz"
});

const IMPLANT_CLASSIFICATION_FIELDS = Object.freeze([
  "foundryType",
  "foundrySubtype",
  "foundrySubtypeExtra",
  "foundryBaseItem",
  "foundryFolder",
  "itemSlot",
  "heroDollSlots"
]);

function normalizeImplantMatchText(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/\s+/gu, " ");
}

function isGearImplant(record) {
  return normalizeImplantMatchText(record?.equipmentType) === "имплант";
}

function enrichExistingImplant(base, source) {
  const merged = {
    ...base,
    implant: source?.implant && typeof source.implant === "object"
      ? JSON.parse(JSON.stringify(source.implant))
      : null
  };
  for (const field of IMPLANT_CLASSIFICATION_FIELDS) {
    if (source?.[field] !== undefined) {
      merged[field] = Array.isArray(source[field]) ? [...source[field]] : source[field];
    }
  }
  return merged;
}

export function mergeGearWithImplants(gear = [], implants = []) {
  const merged = (Array.isArray(gear) ? gear : []).map((entry) => ({ ...entry }));
  const existingById = new Map();
  const existingByName = new Map();
  for (const [index, entry] of merged.entries()) {
    if (!isGearImplant(entry)) continue;
    const id = String(entry?.id ?? "").trim();
    const name = normalizeImplantMatchText(entry?.name);
    if (id) existingById.set(id, index);
    if (name) existingByName.set(name, index);
  }

  for (const source of Array.isArray(implants) ? implants : []) {
    const legacyId = LEGACY_IMPLANT_ID_BY_SOURCE_NAME[source?.name];
    const existingIndex = (
      (legacyId ? existingById.get(legacyId) : undefined)
      ?? existingByName.get(normalizeImplantMatchText(source?.name))
    );
    if (existingIndex === undefined) {
      merged.push({ ...source });
      continue;
    }
    merged[existingIndex] = enrichExistingImplant(merged[existingIndex], source);
  }
  return merged;
}

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
  const [goods, regions, cities, reference, materials, gear, implants] = await Promise.all([
    fetchJson(`${normalizedBasePath}/goods.json`),
    fetchJson(`${normalizedBasePath}/regions.json`),
    fetchJson(`${normalizedBasePath}/cities.json`),
    fetchJson(`${normalizedBasePath}/reference.json`),
    fetchJson(`${normalizedBasePath}/materials.json`, { optional: true }),
    fetchJson(`${normalizedBasePath}/gear.json`, { optional: true }),
    fetchJson(`${normalizedBasePath}/implants.json`, { optional: true })
  ]);

  return normalizeEconomyDataset({
    goods,
    regions,
    cities,
    reference,
    materials: Array.isArray(materials) ? materials : [],
    gear: mergeGearWithImplants(gear, implants),
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
