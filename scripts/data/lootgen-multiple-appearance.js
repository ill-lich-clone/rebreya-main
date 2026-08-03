const DICE_PATTERN = /^(?<count>\d+)d(?<sides>\d+)$/u;
const MAX_DICE_COUNT = 1000;
const MAX_DIE_SIDES = 1000;
const MAX_FIXED_QUANTITY = 100000;

function positiveInteger(value, maximum) {
  const numericValue = Number(value);
  if (!Number.isSafeInteger(numericValue) || numericValue <= 0) {
    return null;
  }
  return Math.min(numericValue, maximum);
}

export function normalizeLootgenMultipleAppearance(value) {
  const source = String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("к", "d");
  const fixedQuantity = positiveInteger(source, MAX_FIXED_QUANTITY);
  if (fixedQuantity !== null && /^\d+$/u.test(source)) {
    return String(fixedQuantity);
  }

  const match = source.match(DICE_PATTERN);
  if (!match) {
    return "1";
  }

  const count = positiveInteger(match.groups.count, MAX_DICE_COUNT);
  const sides = positiveInteger(match.groups.sides, MAX_DIE_SIDES);
  return count !== null && sides !== null ? `${count}d${sides}` : "1";
}

export function rollLootgenMultipleAppearance(value, random = Math.random) {
  const formula = normalizeLootgenMultipleAppearance(value);
  const match = formula.match(DICE_PATTERN);
  if (!match) {
    return Number(formula);
  }

  const count = Number(match.groups.count);
  const sides = Number(match.groups.sides);
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const roll = Math.min(0.9999999999999999, Math.max(0, Number(random()) || 0));
    total += 1 + Math.floor(roll * sides);
  }
  return total;
}
