import { ALCHEMY_PRODUCT_TYPES, adaptAlchemyRow } from "./adapter.mjs";
import { priceProfileForRank } from "./parsers.mjs";

const OMITTED_SOURCE_NUMBERS = new Set([36, 52, 67, 76]);
const EXPECTED_SOURCE_NUMBERS = Object.freeze(
  Array.from({ length: 234 }, (_, index) => index + 1).filter((number) => !OMITTED_SOURCE_NUMBERS.has(number))
);
const EXPECTED_TYPE_COUNTS = Object.freeze({
  "Зелье": 109,
  "Вещество": 23,
  "Яд (Оружейный)": 7,
  "Яд (Поглощаемый)": 4,
  "Яд (Вдыхаемый)": 6,
  "Яд (Контактный)": 2,
  "Бомба": 63,
  "Масло": 15,
  "Побочный продукт": 1
});

function requireUnique(products, selector, label) {
  const seen = new Set();
  for (const product of products) {
    const value = selector(product);
    if (seen.has(value)) throw new Error(`Duplicate alchemy ${label}: ${value}`);
    seen.add(value);
  }
}

export function validateAlchemyCatalog(products) {
  if (!Array.isArray(products)) throw new Error("Alchemy catalog must be an array");
  if (products.length !== EXPECTED_SOURCE_NUMBERS.length) {
    throw new Error(`Alchemy catalog must contain exactly ${EXPECTED_SOURCE_NUMBERS.length} products`);
  }
  requireUnique(products, (product) => product?.sourceNumber, "source number");
  requireUnique(products, (product) => product?.id, "id");
  requireUnique(products, (product) => product?.name, "name");

  const sortedNumbers = products.map((product) => product.sourceNumber).sort((left, right) => left - right);
  if (JSON.stringify(sortedNumbers) !== JSON.stringify(EXPECTED_SOURCE_NUMBERS)) {
    throw new Error("Alchemy catalog source number set does not match the approved 1..234 set");
  }
  const counts = Object.fromEntries(ALCHEMY_PRODUCT_TYPES.map((type) => [type, 0]));
  for (const product of products) {
    if (!Object.hasOwn(counts, product.productType)) {
      throw new Error(`Unknown alchemy product type: ${product.productType}`);
    }
    counts[product.productType] += 1;
    const profile = priceProfileForRank(product.rank);
    if (product.id !== `alchemy-${product.sourceNumber}`) throw new Error(`Invalid alchemy id: ${product.id}`);
    if (product.priceFormula !== profile.priceFormula
      || product.priceMaximumGp !== profile.priceMaximumGp
      || product.rarity !== profile.rarity
      || product.weight !== profile.weight) {
      throw new Error(`Alchemy rank profile mismatch: ${product.id}`);
    }
    const pathPrefix = `${product.sourceNumber}-`;
    if (!product.icon.startsWith(`templates/icons/Alchemy/${pathPrefix}`)
      || !product.topDownImage.startsWith(`assets/top-down/items/alchemy/${pathPrefix}`)) {
      throw new Error(`Alchemy image path mismatch: ${product.id}`);
    }
  }
  if (JSON.stringify(counts) !== JSON.stringify(EXPECTED_TYPE_COUNTS)) {
    throw new Error(`Alchemy product type counts do not match the approved catalog: ${JSON.stringify(counts)}`);
  }
  return products;
}

export function adaptAlchemyCatalog(snapshot) {
  if (!Array.isArray(snapshot?.rows)) throw new Error("Alchemy source snapshot rows are required");
  const products = snapshot.rows.map(adaptAlchemyRow).sort((left, right) => left.sourceNumber - right.sourceNumber);
  validateAlchemyCatalog(products);
  return Object.freeze(products);
}
