import { MODULE_ID } from "../constants.js";
import {
  EQUIPMENT_SIZES, getEquipmentSize, isEquipmentSize, shiftEquipmentDamage,
  inferEquipmentSize, getEquipmentSizeMultipliers
} from "../data/equipment-size-rules.js?v=1.4.393";
import { isNaturalWeapon, buildVersatileBaseDamage, getActorHandSlots, getActorHandReservations, getItemHeldHands, isItemEquipped } from "./held-items.js?v=1.5.29";
import { isJournalRecordItem } from "../data/journal-record-item.js?v=1.4.217-journal-record-items";

const ROOT = `flags.${MODULE_ID}`;
const SIZE = `${ROOT}.equipmentSize`;
const ORIGINAL = "versatileBaseDamageOriginal";
const registered = new WeakSet();
export function getHeldEquipmentWeapons(actor) {
  const slots = new Set(getActorHandSlots(actor));
  const reserved = new Set(getActorHandReservations(actor).map(row => row.handSlot));
  const items = Array.from(actor?.items?.contents ?? actor?.items?.values?.() ?? actor?.items ?? []);
  return items.filter(item => item.type === "weapon" && !isNaturalWeapon(item) && isItemEquipped(item)
    && Number(item.system?.quantity ?? 1) > 0 && getItemHeldHands(item).some(slot => slots.has(slot) && !reserved.has(slot)));
}
const clone = value => value === undefined ? undefined : structuredClone(value);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const at = (value, path) => path.split(".").reduce((node, key) => node?.[key], value);

function flatten(value, prefix = "", result = {}) {
  for (const [key, entry] of Object.entries(value ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (record(entry) && Object.keys(entry).length) flatten(entry, path, result);
    else result[path] = clone(entry);
  }
  return result;
}

function put(data, path, value) {
  const keys = path.split(".");
  let node = data;
  for (const key of keys.slice(0, -1)) node = node[key] ??= {};
  const key = keys.at(-1);
  if (key.startsWith("-=")) delete node[key.slice(2)];
  else node[key] = clone(value);
}

export function readEquipmentItemData(item) {
  const source = item?.toObject?.() ?? item?._source ?? item ?? {};
  return clone({ type: source.type, system: source.system ?? {}, flags: source.flags ?? {} });
}

export function isEquipmentSizeItem(item) {
  const flags = item?.flags?.[MODULE_ID] ?? {};
  return ["weapon", "equipment", "tool", "consumable", "container", "loot"].includes(item?.type)
    && !isNaturalWeapon(item) && !isJournalRecordItem(item) && !flags.storageCoinTemplate
    && !["currency", "coin"].includes(item?.system?.type?.value);
}

export function readEquipmentDamageFormula(part) {
  if (!part) return "";
  if (part.custom?.enabled === true) return String(part.custom.formula ?? "");
  if (typeof part.formula === "string" && part.formula.trim()) return part.formula;
  const bonus = String(part.bonus ?? "").trim();
  if (Number(part.number) > 0 && Number(part.denomination) > 0) {
    return `${part.number}d${part.denomination}${bonus ? (/^[+-]/u.test(bonus) ? bonus : `+${bonus}`) : ""}`;
  }
  return bonus;
}

function shiftPart(part, steps, diagnostics) {
  if (!part) return part;
  const formula = readEquipmentDamageFormula(part);
  if (!formula) return clone(part);
  const shifted = shiftEquipmentDamage(formula, steps);
  if (!shifted.supported) {
    if (steps) diagnostics.push({ code: "unsupported-size-damage", formula });
    return clone(part);
  }
  if (!steps) return clone(part);
  const result = clone(part), match = shifted.formula.match(/^(\d+)d(\d+)(.*)$/iu);
  if (match && part.custom?.enabled !== true) {
    result.number = Number(match[1]); result.denomination = Number(match[2]);
    result.bonus = match[3].replace(/^\s*\+\s*/u, "");
    if (result.custom) result.custom = { ...result.custom, enabled: false, formula: "" };
  }
  else {
    result.number = 0; result.denomination = null; result.bonus = "";
    result.custom = { ...result.custom, enabled: true, formula: shifted.formula };
  }
  if (Object.hasOwn(part, "formula")) result.formula = shifted.formula;
  return result;
}

function captureReference(data, size) {
  return {
    size, base: clone(data.flags?.[MODULE_ID]?.[ORIGINAL] ?? data.system?.damage?.base),
    versatile: clone(data.system?.damage?.versatile), weight: clone(data.system?.weight), price: clone(data.system?.price)
  };
}

function scaleAmount(value, multiplier) {
  if (typeof value === "number") return value * multiplier;
  if (value && Number.isFinite(Number(value.value))) return { ...clone(value), value: Number(value.value) * multiplier };
  return clone(value);
}

/** Synchronous native Item transformation. Only explicit size/damage/price/weight edits create a profile. */
export function buildEquipmentSizeUpdate(item, { size, changes = {}, source = "size" } = {}) {
  const update = flatten(changes), diagnostics = [];
  if (!isEquipmentSizeItem(item)) return { update, diagnostics };
  const data = readEquipmentItemData(item), next = clone(data);
  for (const [path, value] of Object.entries(update)) put(next, path, value);
  const oldSize = getEquipmentSize(data), nextState = next.flags?.[MODULE_ID]?.equipmentSize;
  const explicitSize = size !== undefined || (nextState?.size !== undefined && nextState.size !== oldSize);
  let desired = size ?? nextState?.size ?? oldSize;
  if (!isEquipmentSize(desired)) throw new RangeError("Неизвестный размер снаряжения.");
  const baseEdited = !equal(next.system?.damage?.base, data.system?.damage?.base);
  const alternateEdited = !equal(next.system?.damage?.versatile, data.system?.damage?.versatile);
  const priceEdited = !equal(next.system?.price, data.system?.price), weightEdited = !equal(next.system?.weight, data.system?.weight);
  const gripEdit = Object.keys(update).some(path => path.startsWith(`${ROOT}.heldHands`) || path.startsWith(`${ROOT}.${ORIGINAL}`)
    || path === `${ROOT}.-=${ORIGINAL}`);
  if ((!explicitSize && gripEdit) || (!explicitSize && !baseEdited && !alternateEdited && !priceEdited && !weightEdited)) {
    return { update, diagnostics };
  }
  const stored = data.flags?.[MODULE_ID]?.equipmentSize?.reference;
  const reference = isEquipmentSize(stored?.size) ? clone(stored) : captureReference(data, oldSize);
  const activeVersatile = data.flags?.[MODULE_ID]?.[ORIGINAL] !== undefined;
  if (!explicitSize && baseEdited) {
    desired = inferEquipmentSize(readEquipmentDamageFormula(activeVersatile ? reference.versatile : reference.base),
      reference.size, readEquipmentDamageFormula(next.system?.damage?.base)) ?? oldSize;
  }
  const steps = EQUIPMENT_SIZES.indexOf(desired) - EQUIPMENT_SIZES.indexOf(reference.size);
  const multipliers = getEquipmentSizeMultipliers(reference.size, desired);
  const write = (path, value) => {
    if (value === undefined) return;
    for (const [leaf, entry] of Object.entries(flatten({ [path]: value }))) {
      if (!equal(at(next, leaf), entry)) { update[leaf] = entry; put(next, leaf, entry); }
    }
  };
  if (!priceEdited) write("system.price", scaleAmount(reference.price, multipliers.price));
  if (!weightEdited) write("system.weight", scaleAmount(reference.weight, multipliers.weight));
  if (item.type === "weapon") {
    const base = baseEdited && !activeVersatile ? clone(next.system.damage.base) : shiftPart(reference.base, steps, diagnostics);
    const alternate = alternateEdited ? clone(next.system.damage.versatile)
      : baseEdited && activeVersatile ? clone(next.system.damage.base) : shiftPart(reference.versatile, steps, diagnostics);
    write("system.damage.versatile", alternate);
    if (activeVersatile) {
      write(`${ROOT}.${ORIGINAL}`, base);
      const projected = clone(next); projected.system.damage.base = base;
      write("system.damage.base", baseEdited ? next.system.damage.base : buildVersatileBaseDamage(projected) ?? base);
    }
    else write("system.damage.base", base);
  }
  const authorEdit = baseEdited || alternateEdited || priceEdited || weightEdited;
  write(SIZE, { version: 1, size: desired, reference: authorEdit ? captureReference(next, desired) : reference });
  return { update, diagnostics };
}

export function registerEquipmentSizeItemHooks(moduleApi, { Hooks = globalThis.Hooks } = {}) {
  if (!Hooks?.on || !moduleApi?.equipmentSizeService || registered.has(Hooks)) return false;
  registered.add(Hooks);
  Hooks.on("preUpdateItem", (item, changes, options) => {
    try { return moduleApi.equipmentSizeService.preUpdateItem(item, changes, options); }
    catch (error) { globalThis.ui?.notifications?.error?.(error.message); return false; }
  });
  return true;
}

/** Trusted detached materialization uses exactly the same Item projection, before graph fingerprints. */
export function applyEquipmentSizeToItemData(itemData, size) {
  const result = clone(itemData);
  const { update } = buildEquipmentSizeUpdate(result, { size });
  for (const [path, value] of Object.entries(update)) put(result, path, value);
  return result;
}
