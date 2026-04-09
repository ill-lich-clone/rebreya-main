import { MAGIC_ITEMS } from "../../magicItem.js";

const EPSILON = 1e-6;
const MIN_ITEM_PRICE_GOLD = 0.01;
const MATERIAL_STOCK_BASE = 500;
const TOOL_VALUE_SHARE_LIMIT = 0.2;

export const TRADER_RANK_VALUE_MAP = {
  1: 1000,
  2: 2500,
  3: 5000,
  4: 10000,
  5: 15000,
  6: 25000,
  7: 35000,
  8: 40000,
  9: 75000
};

const FIRST_NAMES = [
  "Аделар",
  "Айрин",
  "Альдор",
  "Альма",
  "Арден",
  "Астэр",
  "Берен",
  "Бриана",
  "Валдар",
  "Велия",
  "Гален",
  "Гвендис",
  "Дарен",
  "Делия",
  "Еллар",
  "Жанна",
  "Зорин",
  "Иллар",
  "Ирма",
  "Кайрон",
  "Кассия",
  "Лейв",
  "Лиора",
  "Марек",
  "Мирель",
  "Нейл",
  "Нерина",
  "Олвер",
  "Орлана",
  "Перрин",
  "Райла",
  "Ремус",
  "Сайлас",
  "Селеста",
  "Талис",
  "Терра",
  "Улрик",
  "Фарен",
  "Фелина",
  "Харвин",
  "Хелла",
  "Цедрик",
  "Шайна",
  "Эдрик",
  "Элмира",
  "Юстас",
  "Ярина",
  "Луций",
  "Мейра",
  "Тиан"
];

const LAST_NAMES = [
  "Авен",
  "Айст",
  "Алмир",
  "Бард",
  "Брант",
  "Вейл",
  "Воллар",
  "Гарт",
  "Грейн",
  "Дан",
  "Дарис",
  "Дорн",
  "Жерд",
  "Зарен",
  "Иваль",
  "Карн",
  "Келн",
  "Крофт",
  "Лайр",
  "Лорин",
  "Марш",
  "Морен",
  "Норт",
  "Орсин",
  "Прайд",
  "Ревис",
  "Рокар",
  "Сайр",
  "Серн",
  "Торн",
  "Урден",
  "Фолк",
  "Харт",
  "Хольм",
  "Цвейг",
  "Черн",
  "Шелт",
  "Эймс",
  "Юлмар",
  "Ярден",
  "Альби",
  "Блейк",
  "Веррес",
  "Гримм",
  "Дрейк",
  "Киран",
  "Левер",
  "Мелк",
  "Рун",
  "Стелл"
];

const ROLE_LABELS = [
  "Купец",
  "Лавочник",
  "Фактор",
  "Снабженец",
  "Поставщик",
  "Ремесленный торговец",
  "Торговый агент",
  "Хозяйственный торговец"
];

const CITY_SHOP_SLOT_BASE = 1;
const FOOD_SHOP_KEY = "food-store";
const MATERIALS_SHOP_KEY = "materials-shop";
const MAGIC_SHOP_KEY = "magic-items-shop";
const MATERIALS_SHOP_LABEL = "Лавка материалов";
const MAGIC_SHOP_LABEL = "Лавка магических предметов";

const PROFILE_SHOPS = [
  {
    key: FOOD_SHOP_KEY,
    label: "Продуктовая лавка",
    basePriority: 5,
    profileModifiers: { agrarian: 2, craft: 0, industrial: 0, port: 1, mining: 1, capital: 1, magic: 0, military: 1 },
    rarityPenalty: 0
  },
  {
    key: "hardware-store",
    label: "Скобяная лавка",
    basePriority: 5,
    profileModifiers: { agrarian: 1, craft: 2, industrial: 2, port: 1, mining: 2, capital: 1, magic: 0, military: 1 },
    rarityPenalty: 0
  },
  {
    key: "carpentry-coopering",
    label: "Столярная и бондарная",
    basePriority: 4,
    profileModifiers: { agrarian: 2, craft: 2, industrial: 1, port: 1, mining: 1, capital: 1, magic: 0, military: 0 },
    rarityPenalty: 0
  },
  {
    key: "tannery-workshop",
    label: "Кожевенная мастерская",
    basePriority: 4,
    profileModifiers: { agrarian: 2, craft: 2, industrial: 0, port: 1, mining: 1, capital: 1, magic: 0, military: 1 },
    rarityPenalty: 0
  },
  {
    key: "tailor-shop",
    label: "Портняжная лавка",
    basePriority: 4,
    profileModifiers: { agrarian: 0, craft: 1, industrial: 0, port: 1, mining: -1, capital: 2, magic: 1, military: 0 },
    rarityPenalty: 0
  },
  {
    key: "travel-shop",
    label: "Походная лавка",
    basePriority: 4,
    profileModifiers: { agrarian: 1, craft: 0, industrial: 0, port: 2, mining: 1, capital: 1, magic: 0, military: 2 },
    rarityPenalty: 0
  },
  {
    key: "stable-harness",
    label: "Конюшня и упряжь",
    basePriority: 4,
    profileModifiers: { agrarian: 2, craft: 0, industrial: -1, port: 1, mining: 1, capital: 1, magic: 0, military: 2 },
    rarityPenalty: 0
  },
  {
    key: "armory",
    label: "Оружейная лавка",
    basePriority: 4,
    profileModifiers: { agrarian: 0, craft: 1, industrial: 1, port: 1, mining: 1, capital: 1, magic: 0, military: 3 },
    rarityPenalty: 1
  },
  {
    key: "book-scribe-shop",
    label: "Книжная и писчая лавка",
    basePriority: 3,
    profileModifiers: { agrarian: -1, craft: 1, industrial: 0, port: 0, mining: -1, capital: 2, magic: 3, military: 0 },
    rarityPenalty: 1
  },
  {
    key: "alchemy-apothecary-shop",
    label: "Алхимико-аптекарская лавка",
    basePriority: 3,
    profileModifiers: { agrarian: 0, craft: 1, industrial: 1, port: 0, mining: 1, capital: 1, magic: 3, military: 1 },
    rarityPenalty: 1
  },
  {
    key: "armor-workshop",
    label: "Доспешная мастерская",
    basePriority: 3,
    profileModifiers: { agrarian: 0, craft: 1, industrial: 1, port: 0, mining: 1, capital: 1, magic: 0, military: 3 },
    rarityPenalty: 1
  },
  {
    key: "firearms-workshop",
    label: "Стрелковая мастерская",
    basePriority: 3,
    profileModifiers: { agrarian: -1, craft: 0, industrial: 3, port: 1, mining: 1, capital: 1, magic: 0, military: 3 },
    rarityPenalty: 1
  },
  {
    key: "glass-optics-workshop",
    label: "Стекольная и оптическая мастерская",
    basePriority: 2,
    profileModifiers: { agrarian: -1, craft: 1, industrial: 2, port: 2, mining: 1, capital: 1, magic: 1, military: 0 },
    rarityPenalty: 2
  },
  {
    key: "jewelry-watch-workshop",
    label: "Ювелирно-часовая мастерская",
    basePriority: 2,
    profileModifiers: { agrarian: -1, craft: 1, industrial: 0, port: 1, mining: -1, capital: 3, magic: 1, military: 0 },
    rarityPenalty: 2
  },
  {
    key: "art-salon",
    label: "Художественный салон",
    basePriority: 2,
    profileModifiers: { agrarian: -1, craft: 1, industrial: 0, port: 1, mining: -1, capital: 3, magic: 2, military: -1 },
    rarityPenalty: 2
  },
  {
    key: "transport-workshop",
    label: "Транспортная мастерская",
    basePriority: 2,
    profileModifiers: { agrarian: 0, craft: 0, industrial: 3, port: 2, mining: 2, capital: 2, magic: 0, military: 2 },
    rarityPenalty: 2
  },
  {
    key: "sapper-store",
    label: "Сапёрная лавка",
    basePriority: 1,
    profileModifiers: { agrarian: -2, craft: 0, industrial: 2, port: 0, mining: 3, capital: 0, magic: 0, military: 3 },
    rarityPenalty: 3
  },
  {
    key: "augmentation-clinic",
    label: "Клиника аугментаций",
    basePriority: 1,
    profileModifiers: { agrarian: -2, craft: 0, industrial: 3, port: 0, mining: 0, capital: 2, magic: 2, military: 1 },
    rarityPenalty: 3
  },
  {
    key: "upgrade-workshop",
    label: "Мастерская усовершенствований",
    basePriority: 1,
    profileModifiers: { agrarian: -2, craft: 1, industrial: 2, port: 0, mining: 1, capital: 2, magic: 3, military: 1 },
    rarityPenalty: 3
  }
];

const CITY_PROFILE_KEY_BY_TYPE = new Map([
  ["аграрный", "agrarian"],
  ["ремесленный", "craft"],
  ["индустриальный", "industrial"],
  ["портовый", "port"],
  ["шахтерский", "mining"],
  ["столичный", "capital"],
  ["магический", "magic"],
  ["военный", "military"]
]);

const FALLBACK_SHOP_BY_EQUIPMENT_TYPE = new Map([
  ["оружие", "Оружейная лавка"],
  ["огнестрельное оружие", "Стрелковая мастерская"],
  ["доспех", "Доспешная мастерская"],
  ["инструменты", "Скобяная лавка"],
  ["зелье", "Алхимико-аптекарская лавка"],
  ["скакуны и транспорт", "Транспортная мастерская"],
  ["обвес", "Мастерская усовершенствований"],
  ["снаряжение", "Походная лавка"]
]);

const SHOP_SUBTYPE_ALIAS_BY_LABEL = new Map([
  ["мастерская доспехов", "Доспешная мастерская"]
]);

function toNumber(value, fallback = 0) {
  const numericValue = Number(value ?? fallback);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((toNumber(value) + Number.EPSILON) * factor) / factor;
}

function createSeededRandom(seedText) {
  let hash = 1779033703 ^ seedText.length;
  for (let index = 0; index < seedText.length; index += 1) {
    hash = Math.imul(hash ^ seedText.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }

  return () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
  };
}

function shuffle(array, rng) {
  const items = [...array];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }

  return items;
}

function getTraderValue(item) {
  const explicitValue = toNumber(item.value, 0);
  if (explicitValue > EPSILON) {
    return explicitValue;
  }

  const fallbackPrice = toNumber(item.priceGoldEquivalent, 0);
  return fallbackPrice > EPSILON ? Math.max(1, roundNumber(fallbackPrice, 0)) : 1;
}

function normalizePriceText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/,/gu, ".")
    .replace(/\s+/gu, "");
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/['\u2019\u2018\u02BC\u02B9\u2032"\u201C\u201D\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function isToolGearItem(item) {
  const typeText = normalizeText(item?.equipmentType ?? "");
  const linkedToolText = normalizeText(item?.linkedTool ?? "");
  const nameText = normalizeText(item?.name ?? "");
  return typeText.includes("инстру")
    || typeText.includes("tool")
    || linkedToolText.includes("инстру")
    || linkedToolText.includes("tool")
    || nameText.includes("набор");
}

function parseGoldValueFromPriceText(value) {
  const text = normalizePriceText(value);
  if (!text) {
    return null;
  }

  const match = text.match(/(\d+(?:\.\d+)?)/u);
  if (!match) {
    return null;
  }

  const numericValue = toNumber(match[1], 0);
  if (numericValue <= 0) {
    return null;
  }

  if (text.includes("пм") || text.includes("pp")) {
    return numericValue * 10;
  }

  if (text.includes("эм") || text.includes("ep")) {
    return numericValue * 0.5;
  }

  if (text.includes("зм") || text.includes("gp")) {
    return numericValue;
  }

  if (text.includes("см") || text.includes("sp")) {
    return numericValue * 0.1;
  }

  if (text.includes("мм") || text.includes("cp")) {
    return numericValue * 0.01;
  }

  return null;
}

export function getGearBasePriceGold(item) {
  const parsedPrice = parseGoldValueFromPriceText(item.priceText);
  if (parsedPrice !== null) {
    return parsedPrice;
  }

  return toNumber(item.priceGoldEquivalent, toNumber(item.priceValue, MIN_ITEM_PRICE_GOLD));
}

function getCityRank(citySnapshot) {
  return clamp(Math.round(toNumber(citySnapshot?.rank, 0)), 0, 9);
}

function getRankBudget(rank) {
  const safeRank = clamp(Math.round(toNumber(rank, 0)), 1, 9);
  return toNumber(TRADER_RANK_VALUE_MAP[safeRank], TRADER_RANK_VALUE_MAP[1]);
}

function getCityShopSlotCount(citySnapshot) {
  return Math.max(1, CITY_SHOP_SLOT_BASE + (getCityRank(citySnapshot) * 2));
}

function getCityProfileKey(citySnapshot) {
  const normalizedCityType = normalizeText(citySnapshot?.cityType ?? "");
  return CITY_PROFILE_KEY_BY_TYPE.get(normalizedCityType) ?? null;
}

function resolveCanonicalShopSubtype(value) {
  const shopSubtype = String(value ?? "").trim();
  if (!shopSubtype) {
    return "";
  }

  const normalizedShopSubtype = normalizeText(shopSubtype);
  const directMatch = PROFILE_SHOPS.find((entry) => normalizeText(entry.label) === normalizedShopSubtype);
  if (directMatch) {
    return directMatch.label;
  }

  return SHOP_SUBTYPE_ALIAS_BY_LABEL.get(normalizedShopSubtype) ?? shopSubtype;
}

function resolveGearShopSubtype(gearItem) {
  const explicitSubtype = resolveCanonicalShopSubtype(gearItem?.shopSubtype ?? "");
  if (explicitSubtype) {
    return explicitSubtype;
  }

  const equipmentTypeKey = normalizeText(gearItem?.equipmentType ?? "");
  const fallbackSubtype = FALLBACK_SHOP_BY_EQUIPMENT_TYPE.get(equipmentTypeKey) ?? "";
  return resolveCanonicalShopSubtype(fallbackSubtype);
}

function buildShopOwner(citySnapshot, shopKey) {
  const rng = createSeededRandom(`${citySnapshot.id}::${shopKey}::owner`);
  const firstName = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
  const lastName = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)];
  const roleLabel = ROLE_LABELS[Math.floor(rng() * ROLE_LABELS.length)];
  return {
    merchantName: `${firstName} ${lastName}`,
    merchantRole: roleLabel
  };
}

function normalizeMagicSlugText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\u0451/gu, "\u0435")
    .replace(/["'`\u00AB\u00BB]/gu, "")
    .replace(/\s+/gu, " ");
}

function buildMagicSlug(value, fallback = "magic-item") {
  return normalizeMagicSlugText(value)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/gu, "")
    || fallback;
}

function buildMagicItemId(item, index) {
  return buildMagicSlug(item?.id ?? item?.name ?? `magic-item-${index + 1}`, `magic-item-${index + 1}`);
}

function getMagicBasePriceGold(item) {
  const valuePrice = toNumber(item?.value, 0);
  if (valuePrice > EPSILON) {
    return valuePrice;
  }

  const parsedCost = parseGoldValueFromPriceText(item?.costText ?? "");
  if (parsedCost !== null) {
    return parsedCost;
  }

  return MIN_ITEM_PRICE_GOLD;
}

function buildCityProfileShopRows(citySnapshot) {
  const cityRank = getCityRank(citySnapshot);
  const cityProfileKey = getCityProfileKey(citySnapshot);
  const rarityReduction = Math.floor((Math.max(1, cityRank) - 1) / 3);
  const rng = createSeededRandom(`${citySnapshot.id}::shop-priority`);

  return PROFILE_SHOPS.map((shop) => {
    const profileModifier = toNumber(shop.profileModifiers?.[cityProfileKey] ?? 0, 0);
    const effectiveRarityPenalty = Math.max(0, toNumber(shop.rarityPenalty, 0) - rarityReduction);
    const priorityScore = toNumber(shop.basePriority, 0) + profileModifier - effectiveRarityPenalty;
    return {
      ...shop,
      profileModifier,
      effectiveRarityPenalty,
      priorityScore,
      tieBreaker: rng()
    };
  });
}

function buildAvailableProfileShopKeys(model, cityRank) {
  const rows = Array.isArray(model?.gear) ? model.gear : [];
  const availableKeys = new Set();

  for (const item of rows) {
    if (toNumber(item?.rank, 0) > cityRank) {
      continue;
    }

    const shopSubtype = resolveGearShopSubtype(item);
    if (!shopSubtype) {
      continue;
    }

    const normalizedSubtype = normalizeText(shopSubtype);
    const profileShop = PROFILE_SHOPS.find((entry) => normalizeText(entry.label) === normalizedSubtype) ?? null;
    if (profileShop?.key) {
      availableKeys.add(profileShop.key);
    }
  }

  return availableKeys;
}

function selectProfileShopsForCity(model, citySnapshot) {
  const cityRank = getCityRank(citySnapshot);
  const slotCount = Math.min(PROFILE_SHOPS.length, getCityShopSlotCount(citySnapshot));
  const availableKeys = buildAvailableProfileShopKeys(model, cityRank);
  const rows = buildCityProfileShopRows(citySnapshot)
    .sort((left, right) => {
      if (right.priorityScore !== left.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }
      if (left.tieBreaker !== right.tieBreaker) {
        return left.tieBreaker - right.tieBreaker;
      }
      return left.label.localeCompare(right.label, "ru");
    });

  const selected = [];
  const selectedKeys = new Set();
  const foodShop = rows.find((shop) => shop.key === FOOD_SHOP_KEY) ?? null;
  if (foodShop) {
    selected.push(foodShop);
    selectedKeys.add(foodShop.key);
  }

  for (const row of rows) {
    if (selected.length >= slotCount) {
      break;
    }
    if (selectedKeys.has(row.key) || !availableKeys.has(row.key)) {
      continue;
    }

    selected.push(row);
    selectedKeys.add(row.key);
  }

  for (const row of rows) {
    if (selected.length >= slotCount) {
      break;
    }
    if (selectedKeys.has(row.key)) {
      continue;
    }

    selected.push(row);
    selectedKeys.add(row.key);
  }

  return selected.slice(0, slotCount);
}

export function getExpectedTraderCount(citySnapshot) {
  return getCityShopSlotCount(citySnapshot) + 2;
}

function getGoodRowByMaterialId(model, citySnapshot, materialId) {
  if (!materialId) {
    return null;
  }

  const material = model.materialById?.get(materialId) ?? null;
  const goodId = material?.linkedGoodId ?? null;
  if (!goodId) {
    return null;
  }

  return (citySnapshot.goodsRows ?? []).find((row) => row.goodId === goodId) ?? null;
}

export function getGearPriceModifier(model, citySnapshot, gearItem) {
  const row = getGoodRowByMaterialId(model, citySnapshot, gearItem.predominantMaterialId);
  const materialModifier = toNumber(row?.priceModifierPercent, 0);
  if (materialModifier > EPSILON) {
    return materialModifier;
  }

  if (materialModifier < -EPSILON) {
    return materialModifier / 2;
  }

  return 0;
}

export function getMaterialPriceModifier(model, citySnapshot, material) {
  const row = getGoodRowByMaterialId(model, citySnapshot, material.id);
  return toNumber(row?.priceModifierPercent, 0);
}

export function applyMarketPrice(basePriceGold, modifierPercent, baseWeight) {
  const safeBasePrice = Math.max(MIN_ITEM_PRICE_GOLD, toNumber(basePriceGold, MIN_ITEM_PRICE_GOLD));
  const rawPrice = safeBasePrice * (1 + toNumber(modifierPercent, 0));

  if (rawPrice >= MIN_ITEM_PRICE_GOLD - EPSILON) {
    return {
      finalPriceGold: roundNumber(rawPrice, 4),
      finalWeight: toNumber(baseWeight, 0),
      weightAdjusted: false
    };
  }

  const multiplier = rawPrice > EPSILON ? MIN_ITEM_PRICE_GOLD / rawPrice : 1;
  const safeWeight = Math.max(toNumber(baseWeight, 0), 1);
  return {
    finalPriceGold: MIN_ITEM_PRICE_GOLD,
    finalWeight: roundNumber(safeWeight * multiplier, 2),
    weightAdjusted: true
  };
}

function formatPercentLabel(value) {
  const safeValue = toNumber(value, 0);
  const sign = safeValue > 0 ? "+" : "";
  return `${sign}${roundNumber(safeValue * 100, 1)}%`;
}

function buildSeed(baseSeed, seedSalt = "") {
  const salt = String(seedSalt ?? "").trim();
  return salt ? `${baseSeed}::${salt}` : baseSeed;
}

function selectGeneralInventory(candidates, targetValue, seed) {
  if (!candidates.length || targetValue <= 0) {
    return {
      entries: [],
      totalTraderValue: 0,
      targetTraderValue: targetValue,
      totalDistinctItems: 0,
      toolTraderValue: 0
    };
  }

  const affordable = candidates.filter((item) => item.traderValue <= targetValue + EPSILON);
  if (!affordable.length) {
    return {
      entries: [],
      totalTraderValue: 0,
      targetTraderValue: targetValue,
      totalDistinctItems: 0,
      toolTraderValue: 0
    };
  }

  const minDistinct = Math.min(6, affordable.length);
  const toolValueCap = Math.max(0, targetValue * TOOL_VALUE_SHARE_LIMIT);
  const fillFloor = Math.max(
    targetValue * 0.82,
    minDistinct ? affordable.slice(0, minDistinct).reduce((sum, item) => sum + item.traderValue, 0) : 0
  );
  let bestSelection = null;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const rng = createSeededRandom(`${seed}::${attempt}`);
    const shuffled = shuffle(affordable, rng);
    const cheapPool = [...affordable].sort(
      (left, right) => left.traderValue - right.traderValue || left.name.localeCompare(right.name, "ru")
    );
    const entries = new Map();
    let totalTraderValue = 0;
    let toolTraderValue = 0;

    const canAddCandidate = (candidate, quantity = 1) => {
      if (!candidate?.isTool) {
        return true;
      }
      return toolTraderValue + (candidate.traderValue * quantity) <= toolValueCap + EPSILON;
    };

    for (const candidate of shuffle(cheapPool.slice(0, Math.max(minDistinct * 3, minDistinct)), rng)) {
      if (entries.has(candidate.id)) {
        continue;
      }

      if (totalTraderValue + candidate.traderValue > targetValue + EPSILON && entries.size >= minDistinct) {
        continue;
      }

      if (!canAddCandidate(candidate, 1)) {
        continue;
      }

      entries.set(candidate.id, { item: candidate, quantity: 1 });
      totalTraderValue += candidate.traderValue;
      if (candidate.isTool) {
        toolTraderValue += candidate.traderValue;
      }
      if (entries.size >= minDistinct) {
        break;
      }
    }

    if (entries.size < minDistinct) {
      for (const candidate of cheapPool) {
        if (entries.has(candidate.id)) {
          continue;
        }

        if (totalTraderValue + candidate.traderValue > targetValue + EPSILON && entries.size >= minDistinct) {
          continue;
        }

        if (!canAddCandidate(candidate, 1)) {
          continue;
        }

        entries.set(candidate.id, { item: candidate, quantity: 1 });
        totalTraderValue += candidate.traderValue;
        if (candidate.isTool) {
          toolTraderValue += candidate.traderValue;
        }
        if (entries.size >= minDistinct) {
          break;
        }
      }
    }

    let guard = 0;
    while (guard < 800) {
      const remaining = targetValue - totalTraderValue;
      const validChoices = shuffled.filter((candidate) => candidate.traderValue <= remaining + EPSILON && canAddCandidate(candidate, 1));
      if (!validChoices.length) {
        break;
      }

      const candidate = validChoices[Math.floor(rng() * validChoices.length)];
      const currentEntry = entries.get(candidate.id) ?? { item: candidate, quantity: 0 };
      const maxByBudget = Math.floor(remaining / candidate.traderValue) || 1;
      const maxByTools = candidate.isTool
        ? Math.floor((toolValueCap - toolTraderValue + EPSILON) / candidate.traderValue)
        : Number.POSITIVE_INFINITY;
      const maxBurst = Math.min(4, maxByBudget, maxByTools);
      if (maxBurst < 1) {
        guard += 1;
        continue;
      }
      const quantity = 1 + Math.floor(rng() * maxBurst);
      currentEntry.quantity += quantity;
      entries.set(candidate.id, currentEntry);
      totalTraderValue += candidate.traderValue * quantity;
      if (candidate.isTool) {
        toolTraderValue += candidate.traderValue * quantity;
      }

      if (totalTraderValue >= targetValue - candidate.traderValue) {
        break;
      }

      guard += 1;
    }

    const selectedEntries = Array.from(entries.values())
      .map((entry) => ({
        ...entry.item,
        quantity: entry.quantity,
        totalValue: roundNumber(entry.item.traderValue * entry.quantity, 2)
      }))
      .sort((left, right) => right.totalValue - left.totalValue || left.name.localeCompare(right.name, "ru"));

    const score = Math.abs(targetValue - totalTraderValue);
    const selection = {
      entries: selectedEntries,
      totalTraderValue: roundNumber(totalTraderValue, 2),
      targetTraderValue: roundNumber(targetValue, 2),
      totalDistinctItems: selectedEntries.length,
      toolTraderValue: roundNumber(toolTraderValue, 2),
      score,
      meetsDistinctGoal: selectedEntries.length >= minDistinct,
      reachesFloor: totalTraderValue >= fillFloor - EPSILON
    };

    if (
      !bestSelection
      || Number(selection.meetsDistinctGoal) > Number(bestSelection.meetsDistinctGoal)
      || (
        selection.meetsDistinctGoal === bestSelection.meetsDistinctGoal
        && Number(selection.reachesFloor) > Number(bestSelection.reachesFloor)
      )
      || (
        selection.meetsDistinctGoal === bestSelection.meetsDistinctGoal
        && selection.reachesFloor === bestSelection.reachesFloor
        && selection.score < bestSelection.score - EPSILON
      )
      || (
        Math.abs(selection.score - bestSelection.score) <= EPSILON
        && selection.totalDistinctItems > bestSelection.totalDistinctItems
      )
    ) {
      bestSelection = selection;
    }
  }

  return bestSelection ?? {
    entries: [],
    totalTraderValue: 0,
    targetTraderValue: targetValue,
    totalDistinctItems: 0,
    toolTraderValue: 0
  };
}

function buildProfileShopPlan(model, citySnapshot, shopRow, shopIndex, seedSalt = "") {
  const cityRank = getCityRank(citySnapshot);
  const budget = getRankBudget(cityRank);
  const owner = buildShopOwner(citySnapshot, shopRow.key);
  const selectionSeed = buildSeed(`${citySnapshot.id}::${shopRow.key}`, seedSalt);
  const targetShopSubtype = normalizeText(shopRow.label);
  const candidates = (model.gear ?? [])
    .filter((item) => toNumber(item.rank, 0) <= cityRank)
    .map((item) => {
      const resolvedShopSubtype = resolveGearShopSubtype(item);
      return {
        ...item,
        resolvedShopSubtype,
        resolvedShopSubtypeKey: normalizeText(resolvedShopSubtype),
        traderValue: getTraderValue(item),
        isTool: isToolGearItem(item)
      };
    })
    .filter((item) => item.resolvedShopSubtypeKey === targetShopSubtype)
    .filter((item) => item.traderValue > 0 && getGearBasePriceGold(item) > 0);

  const selection = selectGeneralInventory(candidates, budget, selectionSeed);
  const items = selection.entries.map((item) => {
    const modifierPercent = getGearPriceModifier(model, citySnapshot, item);
    const basePriceGold = getGearBasePriceGold(item);
    const pricing = applyMarketPrice(basePriceGold, modifierPercent, item.weight);
    return {
      sourceType: "gear",
      sourceId: item.id,
      name: item.name,
      quantity: item.quantity,
      basePriceGold,
      finalPriceGold: pricing.finalPriceGold,
      baseWeight: toNumber(item.weight, 0),
      finalWeight: pricing.finalWeight,
      weightAdjusted: pricing.weightAdjusted,
      modifierPercent,
      modifierLabel: formatPercentLabel(modifierPercent),
      traderValue: item.traderValue,
      totalValue: item.totalValue,
      rank: toNumber(item.rank, 0),
      predominantMaterialId: item.predominantMaterialId ?? null,
      predominantMaterialName: item.predominantMaterialName ?? "",
      shopSubtype: item.resolvedShopSubtype || shopRow.label
    };
  });

  return {
    traderKey: `shop-${shopRow.key}`,
    traderType: "shop",
    traderIndex: shopIndex,
    name: shopRow.label,
    roleLabel: owner.merchantName,
    merchantName: owner.merchantName,
    merchantRole: owner.merchantRole,
    shopSubtype: shopRow.label,
    shopPriorityScore: roundNumber(shopRow.priorityScore, 2),
    cityId: citySnapshot.id,
    cityName: citySnapshot.name,
    cityRank,
    items,
    totalTraderValue: selection.totalTraderValue,
    targetTraderValue: selection.targetTraderValue,
    totalDistinctItems: selection.totalDistinctItems,
    totalQuantity: items.reduce((sum, item) => sum + toNumber(item.quantity, 0), 0)
  };
}

function buildMaterialsTraderPlan(model, citySnapshot, seedSalt = "") {
  const rng = createSeededRandom(buildSeed(`${citySnapshot.id}::${MATERIALS_SHOP_KEY}`, seedSalt));
  const owner = buildShopOwner(citySnapshot, MATERIALS_SHOP_KEY);
  const items = (citySnapshot.goodsRows ?? [])
    .filter((row) => toNumber(row.surplus, 0) > EPSILON)
    .map((row) => {
      const material = model.materialByGoodId?.get(row.goodId) ?? null;
      if (!material) {
        return null;
      }

      const stockCap = MATERIAL_STOCK_BASE * (0.8 + (rng() * 0.4));
      const quantity = Math.max(1, Math.round(Math.min(toNumber(row.surplus, 0), stockCap)));
      const modifierPercent = getMaterialPriceModifier(model, citySnapshot, material);
      const pricing = applyMarketPrice(material.priceGold, modifierPercent, material.weight);

      return {
        sourceType: "material",
        sourceId: material.id,
        name: material.name,
        quantity,
        basePriceGold: toNumber(material.priceGold, MIN_ITEM_PRICE_GOLD),
        finalPriceGold: pricing.finalPriceGold,
        baseWeight: toNumber(material.weight, 1),
        finalWeight: pricing.finalWeight || toNumber(material.weight, 1),
        weightAdjusted: pricing.weightAdjusted,
        modifierPercent,
        modifierLabel: formatPercentLabel(modifierPercent),
        linkedGoodId: material.linkedGoodId ?? null,
        linkedGoodName: material.linkedGoodName ?? material.name
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.quantity - left.quantity || left.name.localeCompare(right.name, "ru"));

  return {
    traderKey: MATERIALS_SHOP_KEY,
    traderType: "materials",
    traderIndex: 0,
    name: MATERIALS_SHOP_LABEL,
    roleLabel: owner.merchantName,
    merchantName: owner.merchantName,
    merchantRole: owner.merchantRole,
    shopSubtype: MATERIALS_SHOP_LABEL,
    cityId: citySnapshot.id,
    cityName: citySnapshot.name,
    cityRank: getCityRank(citySnapshot),
    items,
    totalTraderValue: roundNumber(items.reduce((sum, item) => sum + item.quantity, 0), 0),
    targetTraderValue: MATERIAL_STOCK_BASE,
    totalDistinctItems: items.length,
    totalQuantity: items.reduce((sum, item) => sum + toNumber(item.quantity, 0), 0)
  };
}

function buildMagicCandidates(cityRank) {
  const usedIds = new Set();
  const rows = [];

  for (let index = 0; index < MAGIC_ITEMS.length; index += 1) {
    const rawItem = MAGIC_ITEMS[index];
    if (!rawItem || typeof rawItem !== "object") {
      continue;
    }

    const rank = Math.max(0, Math.round(toNumber(rawItem.rank, 0)));
    if (rank > cityRank) {
      continue;
    }

    const explicitValue = toNumber(rawItem.value, 0);
    const parsedCost = parseGoldValueFromPriceText(rawItem.costText ?? "");
    if (explicitValue <= EPSILON && parsedCost === null) {
      continue;
    }

    const baseId = buildMagicItemId(rawItem, index);
    let id = baseId;
    let duplicateIndex = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${duplicateIndex}`;
      duplicateIndex += 1;
    }
    usedIds.add(id);

    const basePriceGold = explicitValue > EPSILON ? explicitValue : Math.max(MIN_ITEM_PRICE_GOLD, parsedCost ?? 0);
    rows.push({
      id,
      name: String(rawItem.name ?? `Магический предмет ${index + 1}`).trim() || `Магический предмет ${index + 1}`,
      rank,
      description: String(rawItem.description ?? "").trim(),
      itemTypeLabel: String(rawItem.itemType ?? rawItem.type ?? "Магический предмет").trim() || "Магический предмет",
      rarity: String(rawItem.rarity ?? "").trim(),
      basePriceGold,
      traderValue: Math.max(1, roundNumber(explicitValue > EPSILON ? explicitValue : basePriceGold, 2)),
      isTool: false
    });
  }

  return rows;
}

function buildMagicShopPlan(citySnapshot, seedSalt = "") {
  const cityRank = getCityRank(citySnapshot);
  const owner = buildShopOwner(citySnapshot, MAGIC_SHOP_KEY);
  const budget = getRankBudget(cityRank);
  const selectionSeed = buildSeed(`${citySnapshot.id}::${MAGIC_SHOP_KEY}`, seedSalt);
  const candidates = buildMagicCandidates(cityRank);
  const selection = selectGeneralInventory(candidates, budget, selectionSeed);
  const items = selection.entries.map((item) => {
    const pricing = applyMarketPrice(item.basePriceGold, 0, 0);
    return {
      sourceType: "magicItem",
      sourceId: item.id,
      name: item.name,
      quantity: item.quantity,
      basePriceGold: item.basePriceGold,
      finalPriceGold: pricing.finalPriceGold,
      baseWeight: 0,
      finalWeight: 0,
      weightAdjusted: false,
      modifierPercent: 0,
      modifierLabel: formatPercentLabel(0),
      traderValue: item.traderValue,
      totalValue: item.totalValue,
      rank: item.rank,
      description: item.description,
      itemTypeLabel: item.itemTypeLabel,
      rarity: item.rarity,
      shopSubtype: MAGIC_SHOP_LABEL
    };
  });

  return {
    traderKey: MAGIC_SHOP_KEY,
    traderType: "magicItems",
    traderIndex: getCityShopSlotCount(citySnapshot) + 2,
    name: MAGIC_SHOP_LABEL,
    roleLabel: owner.merchantName,
    merchantName: owner.merchantName,
    merchantRole: owner.merchantRole,
    shopSubtype: MAGIC_SHOP_LABEL,
    cityId: citySnapshot.id,
    cityName: citySnapshot.name,
    cityRank,
    items,
    totalTraderValue: selection.totalTraderValue,
    targetTraderValue: selection.targetTraderValue,
    totalDistinctItems: selection.totalDistinctItems,
    totalQuantity: items.reduce((sum, item) => sum + toNumber(item.quantity, 0), 0)
  };
}

export function buildCityTraderPlans(model, citySnapshot, { seedSalt = "" } = {}) {
  const selectedProfileShops = selectProfileShopsForCity(model, citySnapshot);
  const plans = selectedProfileShops.map((shopRow, index) => (
    buildProfileShopPlan(model, citySnapshot, shopRow, index + 1, seedSalt)
  ));
  plans.push(buildMaterialsTraderPlan(model, citySnapshot, seedSalt));
  plans.push(buildMagicShopPlan(citySnapshot, seedSalt));
  return plans;
}

export function getTraderPlanByKey(model, citySnapshot, traderKey, options = {}) {
  return buildCityTraderPlans(model, citySnapshot, options).find((plan) => plan.traderKey === traderKey) ?? null;
}

export function buildCityTraderSlots(model, citySnapshot, actorByKey = new Map(), options = {}) {
  return buildCityTraderPlans(model, citySnapshot, options).map((plan) => {
    const actor = actorByKey.get(plan.traderKey) ?? null;
    return {
      traderKey: plan.traderKey,
      traderType: plan.traderType,
      traderIndex: plan.traderIndex,
      name: plan.name,
      roleLabel: plan.roleLabel,
      actorId: actor?.id ?? null,
      actorExists: Boolean(actor),
      totalDistinctItems: plan.totalDistinctItems,
      totalQuantity: plan.totalQuantity,
      totalTraderValue: plan.totalTraderValue,
      targetTraderValue: plan.targetTraderValue,
      cityRank: plan.cityRank,
      statusLabel: actor ? "Лавка готова" : "Создаётся по нажатию",
      statusClass: actor ? "rm-badge--good" : ""
    };
  });
}

