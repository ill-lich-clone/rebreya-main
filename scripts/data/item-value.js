export class ItemValueError extends Error {
  constructor(code, details = {}) {
    super(`item-value: ${code}`);
    this.name = "ItemValueError";
    this.code = code;
    this.details = details;
  }
}

export function addItemValue(a, b) {
  if (!Number.isSafeInteger(a) || a < 0 || !Number.isSafeInteger(b) || b < 0 || !Number.isSafeInteger(a + b)) {
    throw new ItemValueError("overflow", { a, b });
  }
  return a + b;
}

function multiplyItemValue(value, quantity) {
  addItemValue(value, 0);
  const total = value * quantity;
  if (!Number.isSafeInteger(total)) throw new ItemValueError("overflow", { value, quantity });
  return total;
}

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const id = value => typeof value === "string" && value.trim().length > 0;
const invalid = details => { throw new ItemValueError("invalid-descriptor", details); };

function readComponent(descriptor, catalogReader) {
  const component = catalogReader?.resolveValueComponent?.(structuredClone(descriptor));
  if (!component || component.priceKnown !== true) throw new ItemValueError("unknown-price", { sourceId: descriptor.sourceId });
  addItemValue(component.unitValue, 0);
  if (component.upgradeProfile != null && !record(component.upgradeProfile)) invalid({ sourceId: descriptor.sourceId, field: "upgradeProfile" });
  const included = component.includedUpgradeSourceIds ?? [];
  if (!Array.isArray(included) || included.some(value => !id(value))) invalid({ field: "includedUpgradeSourceIds" });
  return { ...component, includedUpgradeSourceIds: [...included] };
}

/** R4 pricing is synchronous and pure. Portable-container traversal is reserved for R9. */
export function evaluateItemValue(descriptor, catalogReader) {
  const d = descriptor;
  if (!record(d) || d.version !== 2 || !id(d.instanceKey) || !id(d.sourceType) || !id(d.sourceId)
    || typeof d.isBroken !== "boolean" || !Number.isSafeInteger(d.quantity) || d.quantity < 1
    || !Array.isArray(d.upgrades)) invalid({ field: "host" });
  if (d.container != null) throw new ItemValueError("unsupported-container");
  if (d.upgrades.length && d.quantity !== 1) invalid({ field: "composed-quantity" });
  const keys = new Set([d.instanceKey]), slots = new Set();
  for (const upgrade of d.upgrades) {
    if (!record(upgrade) || !id(upgrade.instanceKey) || !id(upgrade.sourceId) || !record(upgrade.choices)
      || !Number.isInteger(upgrade.slotIndex) || upgrade.slotIndex < 1 || upgrade.slotIndex > 3
      || keys.has(upgrade.instanceKey) || slots.has(upgrade.slotIndex)) invalid({ field: "upgrade" });
    keys.add(upgrade.instanceKey); slots.add(upgrade.slotIndex);
  }
  const base = readComponent(d, catalogReader);
  const baseValue = multiplyItemValue(base.unitValue, d.quantity);
  const included = [...base.includedUpgradeSourceIds];
  let upgradeValue = 0;
  for (const upgrade of d.upgrades) {
    // Resolve even included components: an unknown component is not silently accepted.
    const component = readComponent({ ...upgrade, sourceType: "gear", quantity: 1, isBroken: d.isBroken }, catalogReader);
    const includedIndex = included.indexOf(upgrade.sourceId);
    if (includedIndex >= 0) included.splice(includedIndex, 1);
    else upgradeValue = addItemValue(upgradeValue, component.unitValue);
  }
  return { baseValue, upgradeValue, contentsValue: 0, totalValue: addItemValue(baseValue, upgradeValue), diagnostics: [] };
}

/** Preserve the existing UI policy, including fallback for explicit legacy zero. */
export function resolveLootgenItemValue(rawValue, fallbackGold = 0) {
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const explicit = Math.max(0, Math.floor(number(rawValue)));
  if (explicit > 0) return explicit;
  return Math.max(0, Math.floor(number(Math.round(Math.max(0, number(fallbackGold)) * 100))));
}
