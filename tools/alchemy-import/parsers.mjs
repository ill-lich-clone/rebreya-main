const PRICE_PROFILES = Object.freeze(new Map([
  [1, Object.freeze({ priceFormula: "(1d6+1) * 5", priceMaximumGp: 35, rarity: "common", weight: 1 })],
  [2, Object.freeze({ priceFormula: "(1d6+1) * 40", priceMaximumGp: 280, rarity: "uncommon", weight: 2 })],
  [3, Object.freeze({ priceFormula: "(1d6+1) * 50", priceMaximumGp: 350, rarity: "uncommon", weight: 3 })],
  [4, Object.freeze({ priceFormula: "(1d6+1) * 400", priceMaximumGp: 2800, rarity: "rare", weight: 4 })],
  [5, Object.freeze({ priceFormula: "(1d6+1) * 500", priceMaximumGp: 3500, rarity: "rare", weight: 5 })],
  [6, Object.freeze({ priceFormula: "(1d8+1) * 4000", priceMaximumGp: 36000, rarity: "veryRare", weight: 6 })],
  [7, Object.freeze({ priceFormula: "(1d8+1) * 5000", priceMaximumGp: 45000, rarity: "veryRare", weight: 7 })],
  [8, Object.freeze({ priceFormula: "2d6 * 10000", priceMaximumGp: 120000, rarity: "veryRare", weight: 8 })],
  [9, Object.freeze({ priceFormula: "2d6 * 12500", priceMaximumGp: 150000, rarity: "legendary", weight: 9 })]
]));

export function parseStrictInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  const text = String(value ?? "").trim();
  if (optional && (!text || text === "—")) return null;
  if (!/^-?\d+$/u.test(text)) throw new Error(`${label} must be a strict integer`);
  const result = Number(text);
  if (!Number.isSafeInteger(result) || result < min || result > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return result;
}

export function optionalAlchemyText(value) {
  const text = String(value ?? "").trim();
  return !text || text === "—" ? null : text;
}

export function normalizeAlchemyPriceFormula(value) {
  const compact = String(value ?? "")
    .trim()
    .replaceAll("×", "*")
    .replace(/\s+/gu, "");
  const rolledPlusOne = compact.match(/^\((1d[68])\+1\)\*(\d+)$/u);
  if (rolledPlusOne) return `(${rolledPlusOne[1]}+1) * ${Number(rolledPlusOne[2])}`;
  const twoDice = compact.match(/^(2d6)\*(\d+)$/u);
  if (twoDice) return `${twoDice[1]} * ${Number(twoDice[2])}`;
  throw new Error(`Invalid alchemy price formula: ${value}`);
}

export function priceProfileForRank(rank) {
  const profile = PRICE_PROFILES.get(rank);
  if (!profile) throw new Error(`Unsupported alchemy rank: ${rank}`);
  return profile;
}
