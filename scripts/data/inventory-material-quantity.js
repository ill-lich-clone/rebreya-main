import { MODULE_ID } from "../constants.js";

const FLAG = "materialQuantity";
const DENOMINATIONS = new Set(["cp", "sp", "ep", "gp", "pp"]);
const FLAG_KEYS = ["unitPriceDenomination", "unitPriceValue", "unitWeightLb", "unitsPerItem", "version"];
const clone = (value) => value === undefined ? undefined : structuredClone(value);
const flagsOf = (data) => data?.flags?.[MODULE_ID] ?? {};
const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const normalizeQuantity = (value) => Number(Number(value).toFixed(12));

function pounds(data) {
  const weight = data?.system?.weight;
  const value = Math.max(0, numberOr(weight?.value ?? weight, 0));
  const units = String(weight?.units ?? "lb").toLowerCase();
  return value * ({ kg: 2.20462, oz: 1 / 16, ton: 2000 }[units] ?? 1);
}

function closeProjection(actual, expected) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= Math.abs(expected) * 1e-8;
}

export function isInventoryMaterialItemData(data) {
  const flags = flagsOf(data);
  const sourceType = String(flags.sourceType ?? "").trim().toLowerCase();
  if (sourceType) return sourceType === "material" && Boolean(flags.sourceId || flags.materialId);
  return Boolean(flags.materialId) && !flags.gearId && !flags.magicItemId && !flags.magicId;
}

function materialState(data) {
  const state = flagsOf(data)[FLAG];
  if (state === undefined || state === null) return null;
  const nativeQuantity = data?.system?.quantity;
  const price = data?.system?.price;
  if (!isInventoryMaterialItemData(data)
    || typeof state !== "object" || Array.isArray(state)
    || Object.keys(state).sort().join("|") !== FLAG_KEYS.join("|")
    || state.version !== 1
    || !Number.isSafeInteger(nativeQuantity) || nativeQuantity < 0
    || !Number.isFinite(state.unitsPerItem) || state.unitsPerItem <= 0 || state.unitsPerItem > 1
    || !Number.isFinite(state.unitWeightLb) || state.unitWeightLb <= 0
    || !Number.isFinite(state.unitPriceValue) || state.unitPriceValue < 0
    || !DENOMINATIONS.has(state.unitPriceDenomination)
    || price?.denomination !== state.unitPriceDenomination
    || !closeProjection(pounds(data), state.unitWeightLb * state.unitsPerItem)
    || !closeProjection(Number(price?.value), state.unitPriceValue * state.unitsPerItem)) {
    throw new Error("Invalid inventory material quantity projection.");
  }
  return state;
}

export function readInventoryItemQuantity(data) {
  const state = materialState(data);
  const quantity = Math.max(0, numberOr(data?.system?.quantity, 1));
  return state ? normalizeQuantity(quantity * state.unitsPerItem) : quantity;
}

export function readInventoryItemUnitWeight(data) {
  return materialState(data)?.unitWeightLb ?? pounds(data);
}

export function readInventoryItemUnitPrice(data) {
  const state = materialState(data);
  return state
    ? { value: state.unitPriceValue, denomination: state.unitPriceDenomination }
    : {
      value: Math.max(0, numberOr(data?.system?.price?.value, 0)),
      denomination: String(data?.system?.price?.denomination ?? "gp")
    };
}

export function inventoryMaterialQuantitiesMatch(left, right) {
  return Number.isFinite(Number(left)) && Number.isFinite(Number(right))
    && normalizeQuantity(left) === normalizeQuantity(right);
}

export function buildInventoryItemQuantityPatch(data, quantity) {
  if (!Number.isFinite(quantity) || quantity < 0) throw new TypeError("Inventory quantity must be a nonnegative finite number.");
  materialState(data);
  if (!isInventoryMaterialItemData(data)) return { "system.quantity": quantity };
  const logicalQuantity = normalizeQuantity(quantity);
  if ((quantity > 0 && logicalQuantity <= 0) || logicalQuantity > Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Inventory material quantity is not representable.");
  }
  const unitWeightLb = readInventoryItemUnitWeight(data);
  const price = readInventoryItemUnitPrice(data);
  if (!(unitWeightLb > 0) || !Number.isFinite(unitWeightLb) || !DENOMINATIONS.has(price.denomination)) {
    throw new Error("Inventory material requires a positive canonical weight and valid price denomination.");
  }
  const nativeQuantity = Math.ceil(logicalQuantity);
  const unitsPerItem = nativeQuantity > 0 ? logicalQuantity / nativeQuantity : 1;
  const weight = unitWeightLb * unitsPerItem;
  if (!(weight > 0)) throw new RangeError("Inventory material quantity has an unrepresentable positive weight.");
  return {
    "system.quantity": nativeQuantity,
    "system.weight.value": weight,
    "system.weight.units": "lb",
    "system.price.value": price.value * unitsPerItem,
    "system.price.denomination": price.denomination,
    [`flags.${MODULE_ID}.${FLAG}`]: {
      version: 1, unitsPerItem, unitWeightLb,
      unitPriceValue: price.value, unitPriceDenomination: price.denomination
    }
  };
}

export function withInventoryItemQuantity(data, quantity) {
  const result = clone(data);
  const patch = buildInventoryItemQuantityPatch(data, quantity);
  result.system ??= {};
  result.system.quantity = patch["system.quantity"];
  if (isInventoryMaterialItemData(data)) {
    result.system.weight = { value: patch["system.weight.value"], units: "lb" };
    result.system.price = { value: patch["system.price.value"], denomination: patch["system.price.denomination"] };
    result.flags ??= {};
    result.flags[MODULE_ID] ??= {};
    result.flags[MODULE_ID][FLAG] = clone(patch[`flags.${MODULE_ID}.${FLAG}`]);
  }
  return result;
}

export function normalizeInventoryMaterialProjection(data) {
  const result = clone(data);
  materialState(data);
  if (!isInventoryMaterialItemData(data)) return result;
  result.system ??= {};
  result.system.quantity = readInventoryItemQuantity(data);
  result.system.weight = { value: readInventoryItemUnitWeight(data), units: "lb" };
  result.system.price = readInventoryItemUnitPrice(data);
  if (result.flags?.[MODULE_ID]) delete result.flags[MODULE_ID][FLAG];
  return result;
}

export function captureInventoryItemQuantityState(data) {
  materialState(data);
  return {
    quantity: data?.system?.quantity,
    weight: clone(data?.system?.weight),
    price: clone(data?.system?.price),
    materialQuantityFlag: clone(flagsOf(data)[FLAG] ?? null)
  };
}

export function buildInventoryItemQuantityRestorePatch(state) {
  return {
    "system.quantity": state.quantity,
    "system.weight": clone(state.weight),
    "system.price": clone(state.price),
    [state.materialQuantityFlag === null ? `flags.${MODULE_ID}.-=${FLAG}` : `flags.${MODULE_ID}.${FLAG}`]:
      clone(state.materialQuantityFlag)
  };
}
