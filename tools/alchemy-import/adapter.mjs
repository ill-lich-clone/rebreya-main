import { canonicalCatalogId } from "../../scripts/shared/canonical-catalog-id.js";
import { ALCHEMY_COLUMNS, ALCHEMY_SHEET } from "./source.mjs";
import {
  normalizeAlchemyPriceFormula,
  optionalAlchemyText,
  parseStrictInteger,
  priceProfileForRank
} from "./parsers.mjs";

export const ALCHEMY_PRODUCT_TYPES = Object.freeze([
  "Зелье",
  "Вещество",
  "Яд (Оружейный)",
  "Яд (Поглощаемый)",
  "Яд (Вдыхаемый)",
  "Яд (Контактный)",
  "Бомба",
  "Масло",
  "Побочный продукт"
]);

const TYPE_SET = new Set(ALCHEMY_PRODUCT_TYPES);

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text || text === "—") throw new Error(`${label} is required`);
  return text;
}

function valuesByColumn(row) {
  if (!Number.isInteger(row?.rowNumber) || row.rowNumber < ALCHEMY_SHEET.dataStartRow) {
    throw new Error("Alchemy row requires a valid physical row number");
  }
  if (!Array.isArray(row?.values) || row.values.length !== ALCHEMY_COLUMNS.length) {
    throw new Error(`Alchemy row ${row.rowNumber} must contain exactly ${ALCHEMY_COLUMNS.length} values`);
  }
  for (const [index, value] of row.values.entries()) {
    if (typeof value !== "string") {
      throw new Error(`Alchemy row ${row.rowNumber} column ${ALCHEMY_COLUMNS[index]} must be a formatted string`);
    }
  }
  return Object.fromEntries(ALCHEMY_COLUMNS.map((column, index) => [column, row.values[index]]));
}

export function adaptAlchemyRow(row) {
  const cells = valuesByColumn(row);
  const sourceNumber = parseStrictInteger(cells.sourceNumber, "source number", { min: 1, max: 234 });
  const name = requiredText(cells.name, "name");
  const productType = requiredText(cells.productType, "product type");
  if (!TYPE_SET.has(productType)) throw new Error(`Unknown alchemy product type: ${productType}`);
  const rank = parseStrictInteger(cells.rank, "rank", { min: 1, max: 9 });
  const priceFormula = normalizeAlchemyPriceFormula(cells.priceFormula);
  const price = priceProfileForRank(rank);
  if (priceFormula !== price.priceFormula) {
    throw new Error(`Rank ${rank} requires price formula ${price.priceFormula}; received ${priceFormula}`);
  }
  const slug = canonicalCatalogId(name);
  return Object.freeze({
    id: `alchemy-${sourceNumber}`,
    sourceNumber,
    name,
    productType,
    priceFormula,
    priceMaximumGp: price.priceMaximumGp,
    rank,
    reagentLevel: parseStrictInteger(cells.reagentLevel, "reagent level", { min: 0, max: 99, optional: true }),
    effect: optionalAlchemyText(cells.effect),
    catalystEffect: optionalAlchemyText(cells.catalystEffect),
    aspects: Object.freeze({
      fire: parseStrictInteger(cells.fire, "fire aspect", { min: 0, max: 999, optional: true }),
      water: parseStrictInteger(cells.water, "water aspect", { min: 0, max: 999, optional: true }),
      earth: parseStrictInteger(cells.earth, "earth aspect", { min: 0, max: 999, optional: true }),
      air: parseStrictInteger(cells.air, "air aspect", { min: 0, max: 999, optional: true }),
      positive: parseStrictInteger(cells.positive, "positive aspect", { min: 0, max: 999, optional: true }),
      negative: parseStrictInteger(cells.negative, "negative aspect", { min: 0, max: 999, optional: true })
    }),
    mandatoryComponent: optionalAlchemyText(cells.mandatoryComponent),
    craftingDc: parseStrictInteger(cells.craftingDc, "crafting DC", { min: 0, max: 99, optional: true }),
    privateCatalyst: optionalAlchemyText(cells.privateCatalyst),
    activation: optionalAlchemyText(cells.activation),
    duration: optionalAlchemyText(cells.duration),
    requirements: optionalAlchemyText(cells.requirements),
    simplifiedCreation: optionalAlchemyText(cells.simplifiedCreation),
    radiusOrEmanation: optionalAlchemyText(cells.radiusOrEmanation),
    rarity: price.rarity,
    weight: price.weight,
    icon: `templates/icons/Alchemy/${sourceNumber}-${slug}.webp`,
    topDownImage: `assets/top-down/items/alchemy/${sourceNumber}-${slug}.webp`,
    sourceRef: `${ALCHEMY_SHEET.sheetTitle}!A${row.rowNumber}`
  });
}
