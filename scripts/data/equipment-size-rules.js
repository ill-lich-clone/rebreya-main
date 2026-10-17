import { MODULE_ID } from "../constants.js";

export const EQUIPMENT_SIZES = Object.freeze(["tiny", "sm", "med", "lg", "huge", "grg"]);
export const EQUIPMENT_SIZE_LABELS = Object.freeze({
  tiny: "Крошечный", sm: "Маленький", med: "Средний", lg: "Большой", huge: "Огромный", grg: "Громадный"
});
const SMALL_DICE = ["0", "1", "1d2", "1d3", "1d4"];
const FACES = [6, 8, 10, 12];
const FOOTPRINTS = [0.5, 1, 1, 2, 3, 4];

export function isEquipmentSize(size) { return EQUIPMENT_SIZES.includes(size); }

export function getEquipmentSize(item) {
  const state = item?.getFlag?.(MODULE_ID, "equipmentSize") ?? item?.flags?.[MODULE_ID]?.equipmentSize;
  return isEquipmentSize(state?.size) ? state.size : "med";
}

function sizeIndex(size) {
  const index = EQUIPMENT_SIZES.indexOf(size);
  if (index < 0) throw new RangeError(`Неизвестный размер: ${size}`);
  return index;
}

function parseDamage(formula) {
  const match = String(formula ?? "").trim().match(/^((\d+)[dк](\d+)|[01])((?:\s*[+-]\s*(?:\d+(?:\.\d+)?|@[a-z_][\w.]*))*)$/iu);
  if (!match) return null;
  const atom = match[1].toLowerCase().replace("к", "d");
  let index = SMALL_DICE.indexOf(atom);
  if (index < 0) {
    const count = Number(match[2]), faces = FACES.indexOf(Number(match[3]));
    const power = Math.log2(count);
    if (!Number.isSafeInteger(count) || !Number.isInteger(power) || faces < 0) return null;
    index = 5 + power * 4 + faces;
  }
  return { index, suffix: match[4] };
}

function diceAt(index) {
  if (index < SMALL_DICE.length) return SMALL_DICE[index];
  const count = 2 ** Math.floor((index - 5) / 4);
  return Number.isSafeInteger(count) ? `${count}d${FACES[(index - 5) % 4]}` : null;
}

export function shiftEquipmentDamage(formula, steps) {
  const parsed = parseDamage(formula);
  if (!parsed || !Number.isSafeInteger(steps)) return { formula, supported: false };
  const atom = diceAt(Math.max(0, parsed.index + steps));
  return atom === null ? { formula, supported: false } : { formula: `${atom}${parsed.suffix}`, supported: true };
}

export function inferEquipmentSize(referenceFormula, referenceSize, nextFormula) {
  const next = parseDamage(nextFormula);
  if (!next || !isEquipmentSize(referenceSize)) return null;
  const matches = EQUIPMENT_SIZES.filter((_, index) => {
    const shifted = shiftEquipmentDamage(referenceFormula, index - sizeIndex(referenceSize));
    return shifted.supported && parseDamage(shifted.formula)?.index === next.index;
  });
  return matches.length === 1 ? matches[0] : null;
}

export function getEquipmentSizeMultipliers(fromSize, toSize) {
  const steps = sizeIndex(toSize) - sizeIndex(fromSize);
  return { price: 1.5 ** steps, weight: 2 ** steps };
}

export function getCreatureTokenFootprint(size) {
  const dimension = FOOTPRINTS[sizeIndex(size)];
  return { width: dimension, height: dimension };
}

export function getWeaponSizeUse(actor, item) {
  const actorSize = isEquipmentSize(actor?.system?.traits?.size) ? actor.system.traits.size : "med";
  const weaponSize = getEquipmentSize(item);
  const properties = item?.system?.properties;
  const heavy = properties?.has?.("hvy") === true || properties?.includes?.("hvy") === true || properties?.hvy === true;
  const allowed = sizeIndex(weaponSize) <= sizeIndex(actorSize)
    || (actorSize === "sm" && weaponSize === "med" && !heavy);
  return { improvised: !allowed, reason: allowed ? null : "weapon-too-large" };
}
