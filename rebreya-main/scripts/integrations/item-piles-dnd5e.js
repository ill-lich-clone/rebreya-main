import { ITEM_PILES_MODULE_ID, MODULE_ID } from "../constants.js";

const ITEM_PILES_DND5E_MODULE_ID = "itempilesdnd5e";

const ITEM_PILES_SETTINGS = {
  ACTOR_CLASS_TYPE: "actorClassType",
  ITEM_CLASS_LOOT_TYPE: "itemClassLootType",
  ITEM_CLASS_WEAPON_TYPE: "itemClassWeaponType",
  ITEM_CLASS_EQUIPMENT_TYPE: "itemClassEquipmentType",
  ITEM_QUANTITY_ATTRIBUTE: "itemQuantityAttribute",
  ITEM_PRICE_ATTRIBUTE: "itemPriceAttribute",
  ITEM_SIMILARITIES: "itemSimilarities",
  ITEM_FILTERS: "itemFilters",
  CURRENCIES: "currencies",
  SECONDARY_CURRENCIES: "secondaryCurrencies",
  CURRENCY_DECIMAL_DIGITS: "currencyDecimalDigits"
};

const CURRENCIES = [
  {
    primary: false,
    type: "attribute",
    name: "Платиновые монеты",
    img: "",
    abbreviation: "{#} пм",
    data: { path: "system.currency.pp" },
    exchangeRate: 10
  },
  {
    primary: false,
    type: "attribute",
    name: "Золотые монеты",
    img: "",
    abbreviation: "{#} зм",
    data: { path: "system.currency.gp" },
    exchangeRate: 1
  },
  {
    primary: false,
    type: "attribute",
    name: "Серебряные монеты",
    img: "",
    abbreviation: "{#} см",
    data: { path: "system.currency.sp" },
    exchangeRate: 0.1
  },
  {
    primary: true,
    type: "attribute",
    name: "Медные монеты",
    img: "",
    abbreviation: "{#} мм",
    data: { path: "system.currency.cp" },
    exchangeRate: 0.01
  }
];

function parsePriceToGold(item) {
  const price = foundry.utils.getProperty(item, "system.price");
  if (price === null || price === undefined) {
    return 0;
  }

  if (typeof price === "number") {
    return Number.isFinite(price) ? price : 0;
  }

  if (typeof price === "string") {
    const numericValue = Number(price);
    return Number.isFinite(numericValue) ? numericValue : 0;
  }

  const value = Number(price.value ?? 0);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  switch (String(price.denomination ?? "gp").toLowerCase()) {
    case "pp":
      return value * 10;
    case "sp":
      return value * 0.1;
    case "cp":
      return value * 0.01;
    case "gp":
    default:
      return value;
  }
}

function getSettingValue(key) {
  try {
    return game.settings.get(ITEM_PILES_MODULE_ID, key);
  }
  catch (error) {
    console.warn(`${MODULE_ID} | Failed to read Item Piles setting '${key}'.`, error);
    return null;
  }
}

async function ensureSetting(key, value, predicate) {
  const currentValue = getSettingValue(key);
  if (!predicate(currentValue)) {
    return false;
  }

  await game.settings.set(ITEM_PILES_MODULE_ID, key, value);
  return true;
}

export async function ensureItemPilesDnD5eIntegration() {
  if (game.system.id !== "dnd5e") {
    return false;
  }

  if (!game.modules.get(ITEM_PILES_MODULE_ID)?.active || !game.itempiles?.API) {
    return false;
  }

  if (game.modules.get(ITEM_PILES_DND5E_MODULE_ID)?.active) {
    return false;
  }

  game.itempiles.API.addSystemIntegration({
    VERSION: game.system.version ?? "latest",
    ACTOR_CLASS_TYPE: "npc",
    ITEM_CLASS_LOOT_TYPE: "loot",
    ITEM_CLASS_WEAPON_TYPE: "weapon",
    ITEM_CLASS_EQUIPMENT_TYPE: "equipment",
    ITEM_QUANTITY_ATTRIBUTE: "system.quantity",
    ITEM_PRICE_ATTRIBUTE: "system.price",
    ITEM_SIMILARITIES: ["name", "type"],
    ITEM_FILTERS: [
      { path: "system.container", filters: "null|undefined" }
    ],
    ITEM_COST_TRANSFORMER: parsePriceToGold,
    CURRENCIES,
    SECONDARY_CURRENCIES: [],
    CURRENCY_DECIMAL_DIGITS: 1e-5
  });

  if (!game.user?.isGM) {
    return true;
  }

  const writes = [];

  writes.push(ensureSetting(
    ITEM_PILES_SETTINGS.ACTOR_CLASS_TYPE,
    "npc",
    () => true
  ));
  writes.push(ensureSetting(
    ITEM_PILES_SETTINGS.ITEM_CLASS_LOOT_TYPE,
    "loot",
    () => true
  ));
  writes.push(ensureSetting(
    ITEM_PILES_SETTINGS.ITEM_CLASS_WEAPON_TYPE,
    "weapon",
    () => true
  ));
  writes.push(ensureSetting(
    ITEM_PILES_SETTINGS.ITEM_CLASS_EQUIPMENT_TYPE,
    "equipment",
    () => true
  ));
  writes.push(ensureSetting(
    ITEM_PILES_SETTINGS.ITEM_QUANTITY_ATTRIBUTE,
    "system.quantity",
    () => true
  ));
  writes.push(ensureSetting(
    ITEM_PILES_SETTINGS.ITEM_PRICE_ATTRIBUTE,
    "system.price",
    () => true
  ));
  writes.push(ensureSetting(
    ITEM_PILES_SETTINGS.ITEM_SIMILARITIES,
    ["name", "type"],
    () => true
  ));
  writes.push(ensureSetting(
    ITEM_PILES_SETTINGS.ITEM_FILTERS,
    [{ path: "system.container", filters: "null|undefined" }],
    () => true
  ));
  writes.push(ensureSetting(
    ITEM_PILES_SETTINGS.CURRENCIES,
    CURRENCIES,
    () => true
  ));
  writes.push(ensureSetting(
    ITEM_PILES_SETTINGS.SECONDARY_CURRENCIES,
    [],
    () => true
  ));
  writes.push(ensureSetting(
    ITEM_PILES_SETTINGS.CURRENCY_DECIMAL_DIGITS,
    1e-5,
    () => true
  ));

  await Promise.allSettled(writes);
  return true;
}
