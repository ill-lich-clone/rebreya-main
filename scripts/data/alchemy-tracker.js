import { MODULE_ID } from "../constants.js";

const ALCHEMY_TYPES = new Set([
  "Зелье", "Масло", "Вещество", "Бомба", "Побочный продукт",
  "Яд (Вдыхаемый)", "Яд (Контактный)", "Яд (Оружейный)", "Яд (Поглощаемый)"
]);

export function getAlchemyInventoryEntries(items = []) {
  const entries = [];
  for (const item of items) {
    const flags = item?.flags?.[MODULE_ID] ?? {};
    const number = Number(flags.sourceNumber);
    const rank = Number(flags.rank);
    const quantity = Number(item?.system?.quantity);
    if (item?.type !== "consumable" || flags.managed !== true || flags.sourceType !== "alchemyProduct"
      || !Number.isInteger(number) || number < 1 || number > 234
      || flags.alchemyProductId !== `alchemy-${number}` || !ALCHEMY_TYPES.has(flags.productType)
      || !Number.isInteger(rank) || rank < 1 || rank > 9
      || !Number.isInteger(quantity) || quantity <= 0) continue;
    const kind = flags.productType === "Зелье" && number >= 77 && number <= 85 ? "healing" : "utility";
    entries.push({ kind, productId: flags.alchemyProductId, name: String(item?.name ?? flags.alchemyProductId), rank, quantity });
  }
  return entries;
}

export function calculateAlchemyInventoryTotals(items = []) {
  return getAlchemyInventoryEntries(items).reduce((totals, entry) => {
    totals[entry.kind] += entry.rank * entry.quantity;
    return totals;
  }, { healing: 0, utility: 0 });
}
