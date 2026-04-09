import { MODULE_ID } from "../constants.js";

const EPSILON = 1e-6;
const TRANSLIT_MAP = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya"
};

const COLLECTION_KEYS = ["items", "records", "data", "entries", "rows", "list"];
const GOODS_ROOT_KEYS = ["goods"];
const REGIONS_ROOT_KEYS = ["regions"];
const CITIES_ROOT_KEYS = ["cities", "settlements", "locations"];
const MATERIALS_ROOT_KEYS = ["materials"];
const GEAR_ROOT_KEYS = ["gear", "equipment", "items"];

const GOODS_FIELD_ALIASES = {
  id: ["id", "slug", "key", "code"],
  name: ["name", "label", "title", "goodName", "good"],
  category: ["category", "categoryId", "type"],
  groupId: ["groupId", "group", "groupKey"],
  groupName: ["groupName", "groupLabel", "groupTitle", "group"]
};

const REGION_FIELD_ALIASES = {
  id: ["id", "slug", "key", "code"],
  name: ["name", "label", "title", "regionName", "region"],
  state: ["state", "stateName", "country", "realm"],
  traits: ["traits", "tags", "features"],
  productionCoefficients: ["productionCoefficients", "productionCoefficient", "coefficients", "production", "goods"],
  productionModifiers: ["productionModifiers", "modifiers", "goodModifiers", "goodsModifiers"]
};

const CITY_FIELD_ALIASES = {
  id: ["id", "slug", "key", "code"],
  name: ["name", "label", "title", "cityName", "city", "settlementName", "locationName"],
  description: ["description", "notes", "info"],
  type: ["type", "kind", "entityType"],
  cityType: ["cityType", "settlementType", "cityClass"],
  rank: ["rank", "tier"],
  state: ["state", "stateName", "country", "realm"],
  regionId: ["regionId", "regionKey", "regionSlug"],
  regionName: ["regionName", "region", "regionLabel"],
  locationType: ["locationType", "location", "terrain"],
  religion: ["religion", "faith"],
  population: ["population", "residents", "inhabitants"],
  consumptionModifier: ["consumptionModifier", "demandModifier", "consumptionRateModifier"],
  production: ["production", "produced", "supply", "output"],
  demand: ["demand", "consumption", "need", "needs"],
  goods: ["goods", "goodsById", "goodsByName", "economy", "resources"],
  connections: ["connections", "links", "tradeLinks", "routes"]
};

const MATERIAL_FIELD_ALIASES = {
  id: ["id", "slug", "key", "code"],
  name: ["name", "label", "title", "materialName", "material"],
  linkedGoodId: ["linkedGoodId", "goodId", "linkedGood", "good", "goodKey", "resourceId"]
};

const GEAR_FIELD_ALIASES = {
  id: ["id", "slug", "key", "code"],
  name: ["name", "label", "title", "itemName", "item"],
  equipmentType: ["equipmentType", "type", "gearType", "itemType"],
  shopSubtype: ["shopSubtype", "shopType", "shopSubType", "marketSubtype", "traderSubtype"],
  priceText: ["priceText", "price", "priceLabel"],
  priceValue: ["priceValue", "priceAmount"],
  priceDenomination: ["priceDenomination", "denomination", "currency"],
  priceGoldEquivalent: ["priceGoldEquivalent", "priceGold", "priceGp", "priceValueGold"],
  rank: ["rank", "tier"],
  weight: ["weight", "mass"],
  volume: ["volume", "size"],
  capacity: ["capacity", "containerCapacity"],
  description: ["description", "notes", "text"],
  predominantMaterial: ["predominantMaterial", "materialName", "material", "sourceMaterial"],
  predominantMaterialId: ["predominantMaterialId", "materialId"],
  linkedTool: ["linkedTool", "tool", "toolName", "relatedTool"],
  value: ["value", "score", "quality"],
  foundryType: ["foundryType", "dnd5eType", "documentType"],
  foundrySubtype: ["foundrySubtype", "dnd5eSubtype", "typeValue"],
  foundrySubtypeExtra: ["foundrySubtypeExtra", "dnd5eSubtypeExtra", "subtypeValue", "typeSubtype"],
  foundryBaseItem: ["foundryBaseItem", "dnd5eBaseItem", "baseItem"],
  foundryFolder: ["foundryFolder", "folderPath", "folder"],
  itemSlot: ["itemSlot", "slot", "wearSlot", "equipSlot"],
  heroDollSlots: ["heroDollSlots", "heroSlots", "itemSlots", "slots"],
  firearmClass: ["firearmClass", "gunClass", "firearmSubtype"]
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function hasValue(value) {
  return value !== undefined && value !== null && !(typeof value === "string" && !value.trim());
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function normalizeMatchText(value) {
  return cleanString(value)
    .toLowerCase()
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"`\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function normalizeIdentity(value) {
  return normalizeMatchText(value)
    .replace(/\u0451/gu, "\u0435")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function slugifyBase(value) {
  const text = cleanString(value).toLowerCase();
  let result = "";
  for (const character of text) {
    if (TRANSLIT_MAP[character]) {
      result += TRANSLIT_MAP[character];
      continue;
    }

    if (/[a-z0-9]/u.test(character)) {
      result += character;
      continue;
    }

    result += "-";
  }

  return result.replace(/-+/gu, "-").replace(/^-|-$/gu, "") || "entry";
}

function ensureUniqueId(baseValue, usedIds) {
  const baseId = slugifyBase(baseValue);
  let candidate = baseId;
  let index = 2;
  while (usedIds.has(candidate)) {
    candidate = `${baseId}-${index}`;
    index += 1;
  }

  usedIds.add(candidate);
  return candidate;
}

function getValue(record, keys, fallback = undefined) {
  for (const key of keys) {
    if (Object.hasOwn(record ?? {}, key) && hasValue(record[key])) {
      return record[key];
    }
  }

  return fallback;
}

function toRecordArray(raw, rootKeys = []) {
  if (Array.isArray(raw)) {
    return raw.filter(Boolean);
  }

  if (!isObject(raw)) {
    return [];
  }

  for (const key of [...rootKeys, ...COLLECTION_KEYS]) {
    if (!Object.hasOwn(raw, key)) {
      continue;
    }

    return toRecordArray(raw[key], []);
  }

  return Object.entries(raw)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => {
      if (isObject(value)) {
        return {
          ...value,
          id: value.id ?? key
        };
      }

      return {
        id: key,
        value
      };
    });
}

function registerAlias(aliasMap, alias, id) {
  const normalizedAlias = normalizeIdentity(alias);
  if (!normalizedAlias || aliasMap.has(normalizedAlias)) {
    return;
  }

  aliasMap.set(normalizedAlias, id);
}

function resolveAlias(aliasMap, value) {
  if (isObject(value)) {
    return resolveAlias(aliasMap, getValue(value, ["id", "slug", "key", "code", "name", "label", "title"]));
  }

  const normalizedAlias = normalizeIdentity(value);
  return normalizedAlias ? aliasMap.get(normalizedAlias) ?? null : null;
}

function collectTraits(record) {
  const directTraits = getValue(record, REGION_FIELD_ALIASES.traits);
  if (Array.isArray(directTraits)) {
    return directTraits.map(cleanString).filter(Boolean);
  }

  if (typeof directTraits === "string") {
    return directTraits.split(/[,;|]/u).map(cleanString).filter(Boolean);
  }

  return ["trait1", "trait2", "trait3", "tag1", "tag2", "tag3"]
    .map((key) => cleanString(record?.[key]))
    .filter(Boolean);
}

function resolveGoodId(goodAliasMap, value, fallbackName = "") {
  return resolveAlias(goodAliasMap, value) ?? resolveAlias(goodAliasMap, fallbackName);
}

function setResolvedValue(state, goodId, value, priority) {
  if (!goodId) {
    return;
  }

  const existing = state.get(goodId);
  if (!existing || priority > existing.priority || (priority === existing.priority && existing.priority < 3)) {
    state.set(goodId, { value, priority });
  }
}

function normalizeGoodValueMap(raw, goodAliasMap, kind) {
  const state = new Map();
  if (!raw) {
    return {};
  }

  const fieldKeys = kind === "production"
    ? ["production", "produced", "supply", "output", "value", "amount", "quantity"]
    : ["demand", "consumption", "need", "needs", "value", "amount", "quantity"];

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!isObject(entry)) {
        continue;
      }

      const goodId = resolveGoodId(
        goodAliasMap,
        getValue(entry, ["goodId", "id", "slug", "key", "code", "name", "label", "title", "good", "goodName"])
      );
      if (!goodId) {
        continue;
      }

      const value = toNumber(getValue(entry, fieldKeys, 0));
      const priority = getValue(entry, ["goodId", "id", "slug", "key", "code"]) ? 3 : 2;
      setResolvedValue(state, goodId, value, priority);
    }
  }
  else if (isObject(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (isObject(value)) {
        const goodId = resolveGoodId(
          goodAliasMap,
          getValue(value, ["goodId", "id", "slug", "key", "code", "name", "label", "title", "good", "goodName"], key),
          key
        );
        if (!goodId) {
          continue;
        }

        const numericValue = toNumber(getValue(value, fieldKeys, 0));
        const priority = normalizeIdentity(key) === normalizeIdentity(goodId) ? 3 : 2;
        setResolvedValue(state, goodId, numericValue, priority);
        continue;
      }

      const goodId = resolveGoodId(goodAliasMap, key);
      if (!goodId) {
        continue;
      }

      const priority = normalizeIdentity(key) === normalizeIdentity(goodId) ? 3 : 1;
      setResolvedValue(state, goodId, toNumber(value), priority);
    }
  }

  return Object.fromEntries(
    Array.from(state.entries()).map(([goodId, entry]) => [goodId, entry.value])
  );
}

function normalizeGoods(rawGoods) {
  const rawItems = toRecordArray(rawGoods, GOODS_ROOT_KEYS);
  const usedIds = new Set();
  const aliasMap = new Map();
  const goods = rawItems.map((record, index) => {
    const name = cleanString(getValue(record, GOODS_FIELD_ALIASES.name, `Good ${index + 1}`));
    const explicitId = cleanString(getValue(record, GOODS_FIELD_ALIASES.id));
    const id = ensureUniqueId(explicitId || name, usedIds);
    const category = cleanString(getValue(record, GOODS_FIELD_ALIASES.category, "misc"));
    const groupName = cleanString(getValue(record, GOODS_FIELD_ALIASES.groupName, category));
    const groupId = cleanString(getValue(record, GOODS_FIELD_ALIASES.groupId)) || slugifyBase(groupName || category);

    const good = {
      id,
      name,
      category,
      groupId,
      groupName,
      baseProductionPer1000: toNumber(getValue(record, ["baseProductionPer1000", "baseProduction", "productionPer1000"])),
      baseConsumptionPer1000: toNumber(getValue(record, ["baseConsumptionPer1000", "baseConsumption", "demandPer1000", "consumptionPer1000"]))
    };

    registerAlias(aliasMap, id, id);
    registerAlias(aliasMap, explicitId, id);
    registerAlias(aliasMap, name, id);
    registerAlias(aliasMap, slugifyBase(name), id);
    return good;
  });

  return { goods, aliasMap };
}

function normalizeRegions(rawRegions, goodAliasMap) {
  const rawItems = toRecordArray(rawRegions, REGIONS_ROOT_KEYS);
  const usedIds = new Set();
  const aliasMap = new Map();
  const regions = rawItems.map((record, index) => {
    const name = cleanString(getValue(record, REGION_FIELD_ALIASES.name, `Region ${index + 1}`));
    const state = cleanString(getValue(record, REGION_FIELD_ALIASES.state));
    const explicitId = cleanString(getValue(record, REGION_FIELD_ALIASES.id));
    const id = ensureUniqueId(explicitId || `${state} ${name}` || name, usedIds);

    const region = {
      id,
      name,
      state,
      traits: collectTraits(record),
      productionCoefficients: normalizeGoodValueMap(getValue(record, REGION_FIELD_ALIASES.productionCoefficients, {}), goodAliasMap, "production"),
      productionModifiers: normalizeGoodValueMap(getValue(record, REGION_FIELD_ALIASES.productionModifiers, {}), goodAliasMap, "production")
    };

    registerAlias(aliasMap, id, id);
    registerAlias(aliasMap, explicitId, id);
    registerAlias(aliasMap, name, id);
    registerAlias(aliasMap, `${state} ${name}`, id);
    return region;
  });

  return { regions, aliasMap };
}

function normalizeConnectionCollection(rawConnections) {
  if (!rawConnections) {
    return [];
  }

  if (Array.isArray(rawConnections)) {
    return rawConnections.map((entry) => {
      if (typeof entry === "string") {
        return {
          targetName: cleanString(entry),
          targetCityIdRaw: "",
          connectionType: ""
        };
      }

      return {
        targetName: cleanString(getValue(entry, ["targetName", "target", "name", "city", "label"])),
        targetCityIdRaw: cleanString(getValue(entry, ["targetCityId", "targetId", "cityId", "id", "slug", "key"])),
        connectionType: cleanString(getValue(entry, ["connectionType", "type", "mode", "routeType"]))
      };
    }).filter((entry) => entry.targetName || entry.targetCityIdRaw);
  }

  if (isObject(rawConnections)) {
    return Object.entries(rawConnections).flatMap(([key, value]) => {
      if (typeof value === "string") {
        return [{
          targetName: cleanString(key),
          targetCityIdRaw: "",
          connectionType: cleanString(value)
        }];
      }

      if (!isObject(value)) {
        return [];
      }

      return [{
        targetName: cleanString(getValue(value, ["targetName", "target", "name", "city", "label"], key)),
        targetCityIdRaw: cleanString(getValue(value, ["targetCityId", "targetId", "cityId", "id", "slug", "key"])),
        connectionType: cleanString(getValue(value, ["connectionType", "type", "mode", "routeType"]))
      }];
    }).filter((entry) => entry.targetName || entry.targetCityIdRaw);
  }

  return [];
}

function collectNumberedConnections(record) {
  const connections = [];
  for (let index = 1; index <= 20; index += 1) {
    const targetName = cleanString(record?.[`connection${index}`] ?? record?.[`target${index}`] ?? record?.[`link${index}`]);
    const connectionType = cleanString(record?.[`connectionType${index}`] ?? record?.[`linkType${index}`] ?? record?.[`routeType${index}`]);
    if (!targetName) {
      continue;
    }

    connections.push({
      targetName,
      targetCityIdRaw: "",
      connectionType
    });
  }

  return connections;
}

function normalizeCities(rawCities, goodAliasMap, regionAliasMap) {
  const rawItems = toRecordArray(rawCities, CITIES_ROOT_KEYS);
  const usedIds = new Set();

  const cities = rawItems.map((record, index) => {
    const name = cleanString(getValue(record, CITY_FIELD_ALIASES.name, `City ${index + 1}`));
    const explicitId = cleanString(getValue(record, CITY_FIELD_ALIASES.id));
    const state = cleanString(getValue(record, CITY_FIELD_ALIASES.state));
    const regionName = cleanString(getValue(record, CITY_FIELD_ALIASES.regionName));
    const regionCandidate = getValue(record, CITY_FIELD_ALIASES.regionId, regionName);
    const regionId = resolveAlias(regionAliasMap, regionCandidate || `${state} ${regionName}`) ?? cleanString(regionCandidate);

    const directProduction = getValue(record, CITY_FIELD_ALIASES.production);
    const directDemand = getValue(record, CITY_FIELD_ALIASES.demand);
    const sharedGoods = getValue(record, CITY_FIELD_ALIASES.goods);
    const connections = normalizeConnectionCollection(getValue(record, CITY_FIELD_ALIASES.connections))
      .concat(collectNumberedConnections(record));

    return {
      _sourceId: explicitId,
      id: ensureUniqueId(explicitId || name, usedIds),
      name,
      description: cleanString(getValue(record, CITY_FIELD_ALIASES.description)),
      type: cleanString(getValue(record, CITY_FIELD_ALIASES.type)),
      cityType: cleanString(getValue(record, CITY_FIELD_ALIASES.cityType)),
      rank: toNumber(getValue(record, CITY_FIELD_ALIASES.rank)),
      state,
      regionId,
      regionName,
      locationType: cleanString(getValue(record, CITY_FIELD_ALIASES.locationType)),
      religion: cleanString(getValue(record, CITY_FIELD_ALIASES.religion)),
      population: toNumber(getValue(record, CITY_FIELD_ALIASES.population)),
      consumptionModifier: hasValue(getValue(record, CITY_FIELD_ALIASES.consumptionModifier))
        ? toNumber(getValue(record, CITY_FIELD_ALIASES.consumptionModifier))
        : null,
      production: normalizeGoodValueMap(directProduction ?? sharedGoods, goodAliasMap, "production"),
      demand: normalizeGoodValueMap(directDemand ?? sharedGoods, goodAliasMap, "demand"),
      connections
    };
  });

  const cityAliasMap = new Map();
  for (const city of cities) {
    registerAlias(cityAliasMap, city.id, city.id);
    registerAlias(cityAliasMap, city._sourceId, city.id);
    registerAlias(cityAliasMap, city.name, city.id);
  }

  for (const city of cities) {
    city.connections = city.connections.map((connection) => {
      const targetCityId = resolveAlias(cityAliasMap, connection.targetCityIdRaw || connection.targetName);
      return {
        targetName: connection.targetName,
        targetCityId,
        connectionType: connection.connectionType,
        broken: !targetCityId
      };
    });
  }

  for (const city of cities) {
    delete city._sourceId;
  }

  return { cities, aliasMap: cityAliasMap };
}

function normalizeMaterials(rawMaterials, goodAliasMap, goods) {
  const rawItems = toRecordArray(rawMaterials, MATERIALS_ROOT_KEYS);
  const usedIds = new Set();
  const aliasMap = new Map();
  const goodsById = new Map(goods.map((good) => [good.id, good]));
  const materials = rawItems.map((record, index) => {
    const name = cleanString(getValue(record, MATERIAL_FIELD_ALIASES.name, `Material ${index + 1}`));
    const explicitId = cleanString(getValue(record, MATERIAL_FIELD_ALIASES.id));
    const linkedGoodId = resolveGoodId(
      goodAliasMap,
      getValue(record, MATERIAL_FIELD_ALIASES.linkedGoodId),
      name
    );

    return {
      ...record,
      id: ensureUniqueId(explicitId || name, usedIds),
      name,
      linkedGoodId: linkedGoodId ?? null,
      linkedGoodName: linkedGoodId ? goodsById.get(linkedGoodId)?.name ?? name : record.linkedGoodName ?? name
    };
  });

  for (const material of materials) {
    registerAlias(aliasMap, material.id, material.id);
    registerAlias(aliasMap, material.name, material.id);
  }

  return { materials, aliasMap };
}

function normalizeGear(rawGear, materialAliasMap, materials) {
  const rawItems = toRecordArray(rawGear, GEAR_ROOT_KEYS);
  const usedIds = new Set();
  const materialsById = new Map(materials.map((material) => [material.id, material]));

  const gear = rawItems.map((record, index) => {
    const name = cleanString(getValue(record, GEAR_FIELD_ALIASES.name, `Item ${index + 1}`));
    const explicitId = cleanString(getValue(record, GEAR_FIELD_ALIASES.id));
    const predominantMaterialName = cleanString(getValue(record, GEAR_FIELD_ALIASES.predominantMaterial));
    const predominantMaterialId = resolveAlias(
      materialAliasMap,
      getValue(record, GEAR_FIELD_ALIASES.predominantMaterialId, predominantMaterialName)
    );

    return {
      id: ensureUniqueId(explicitId || name, usedIds),
      name,
      equipmentType: cleanString(getValue(record, GEAR_FIELD_ALIASES.equipmentType)),
      shopSubtype: cleanString(getValue(record, GEAR_FIELD_ALIASES.shopSubtype)),
      priceText: cleanString(getValue(record, GEAR_FIELD_ALIASES.priceText)),
      priceValue: toNumber(getValue(record, GEAR_FIELD_ALIASES.priceValue)),
      priceDenomination: cleanString(getValue(record, GEAR_FIELD_ALIASES.priceDenomination)),
      priceGoldEquivalent: toNumber(getValue(record, GEAR_FIELD_ALIASES.priceGoldEquivalent)),
      rank: toNumber(getValue(record, GEAR_FIELD_ALIASES.rank)),
      weight: toNumber(getValue(record, GEAR_FIELD_ALIASES.weight)),
      volume: cleanString(getValue(record, GEAR_FIELD_ALIASES.volume)),
      capacity: cleanString(getValue(record, GEAR_FIELD_ALIASES.capacity)),
      description: cleanString(getValue(record, GEAR_FIELD_ALIASES.description)),
      predominantMaterialId: predominantMaterialId ?? null,
      predominantMaterialName: predominantMaterialId
        ? (materialsById.get(predominantMaterialId)?.name ?? predominantMaterialName)
        : predominantMaterialName,
      linkedTool: cleanString(getValue(record, GEAR_FIELD_ALIASES.linkedTool)),
      value: cleanString(getValue(record, GEAR_FIELD_ALIASES.value)),
      foundryType: cleanString(getValue(record, GEAR_FIELD_ALIASES.foundryType)),
      foundrySubtype: cleanString(getValue(record, GEAR_FIELD_ALIASES.foundrySubtype)),
      foundrySubtypeExtra: cleanString(getValue(record, GEAR_FIELD_ALIASES.foundrySubtypeExtra)),
      foundryBaseItem: cleanString(getValue(record, GEAR_FIELD_ALIASES.foundryBaseItem)),
      foundryFolder: cleanString(getValue(record, GEAR_FIELD_ALIASES.foundryFolder)),
      itemSlot: cleanString(getValue(record, GEAR_FIELD_ALIASES.itemSlot)),
      heroDollSlots: getValue(record, GEAR_FIELD_ALIASES.heroDollSlots, []),
      firearmClass: cleanString(getValue(record, GEAR_FIELD_ALIASES.firearmClass)),
      source: cleanString(record?.source ?? "gear-workbook")
    };
  });

  return { gear };
}

function normalizeReference(rawReference, cityAliasMap) {
  const reference = isObject(rawReference) ? foundry.utils.deepClone(rawReference) : {};
  const warnings = isObject(reference.warnings) ? reference.warnings : {};

  warnings.missingDemandCities = toRecordArray(warnings.missingDemandCities ?? []).map((entry) => {
    const record = isObject(entry) ? entry : { cityName: cleanString(entry) };
    return {
      ...record,
      cityId: resolveAlias(cityAliasMap, record.cityId ?? record.cityName) ?? cleanString(record.cityId ?? record.cityName),
      cityName: cleanString(record.cityName)
    };
  });

  warnings.brokenConnections = toRecordArray(warnings.brokenConnections ?? []).map((entry) => {
    const record = isObject(entry) ? entry : { cityName: cleanString(entry) };
    return {
      ...record,
      cityId: resolveAlias(cityAliasMap, record.cityId ?? record.cityName) ?? cleanString(record.cityId ?? record.cityName)
    };
  });

  reference.warnings = warnings;
  return reference;
}

function getMapSum(source) {
  if (!source) {
    return 0;
  }

  return Object.values(source).reduce((sum, value) => sum + toNumber(value), 0);
}

function sanitizeSuspiciousDemandMirrors(cities, goods, reference, source) {
  const totalDemandByGood = Object.fromEntries(goods.map((good) => [good.id, 0]));
  for (const city of cities) {
    for (const good of goods) {
      totalDemandByGood[good.id] += toNumber(city.demand?.[good.id]);
    }
  }

  const worldDemand = Object.values(totalDemandByGood).reduce((sum, value) => sum + value, 0);
  const missingDemandIds = new Set((reference?.warnings?.missingDemandCities ?? []).map((entry) => entry.cityId).filter(Boolean));
  const suspiciousCities = [];

  for (const city of cities) {
    let comparable = 0;
    let matched = 0;
    for (const good of goods) {
      const cityDemand = toNumber(city.demand?.[good.id]);
      const otherDemand = totalDemandByGood[good.id] - cityDemand;
      if (Math.abs(cityDemand) < EPSILON && Math.abs(otherDemand) < EPSILON) {
        continue;
      }

      comparable += 1;
      const tolerance = Math.max(0.05, Math.abs(otherDemand) * 0.0001);
      if (Math.abs(cityDemand - otherDemand) <= tolerance) {
        matched += 1;
      }
    }

    const totalDemand = getMapSum(city.demand);
    const mirrorRatio = comparable ? matched / comparable : 0;
    const looksMirrored = comparable >= Math.max(10, Math.floor(goods.length * 0.8))
      && mirrorRatio >= 0.98
      && totalDemand > 0
      && totalDemand >= worldDemand * 0.2;

    if (!looksMirrored) {
      continue;
    }

    suspiciousCities.push({
      cityId: city.id,
      cityName: city.name,
      totalDemand,
      mirrorRatio,
      matchedGoods: matched,
      comparableGoods: comparable,
      wasMarkedMissingDemand: missingDemandIds.has(city.id)
    });

    city.demand = {};
  }

  if (suspiciousCities.length) {
    const warningPayload = {
      suspiciousDemandMirrors: suspiciousCities
    };
    source.normalizationWarnings = {
      ...(source.normalizationWarnings ?? {}),
      ...warningPayload
    };
    reference.runtimeWarnings = {
      ...(reference.runtimeWarnings ?? {}),
      ...warningPayload
    };

    console.warn(`${MODULE_ID} | Suspicious mirrored demand detected. Resetting city demand to zero.`, suspiciousCities);
  }
}

export function normalizeEconomyDataset(rawDataset) {
  const source = foundry.utils.deepClone(rawDataset?.source ?? {});
  const { goods, aliasMap: goodAliasMap } = normalizeGoods(rawDataset?.goods);
  const { regions, aliasMap: regionAliasMap } = normalizeRegions(rawDataset?.regions, goodAliasMap);
  const { cities, aliasMap: cityAliasMap } = normalizeCities(rawDataset?.cities, goodAliasMap, regionAliasMap);
  const { materials, aliasMap: materialAliasMap } = normalizeMaterials(rawDataset?.materials, goodAliasMap, goods);
  const { gear } = normalizeGear(rawDataset?.gear, materialAliasMap, materials);
  const reference = normalizeReference(rawDataset?.reference, cityAliasMap);

  sanitizeSuspiciousDemandMirrors(cities, goods, reference, source);

  return {
    goods,
    regions,
    cities,
    materials,
    gear,
    reference,
    source
  };
}
