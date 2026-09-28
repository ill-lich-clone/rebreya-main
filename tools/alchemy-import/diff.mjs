function stableJson(value) {
  return JSON.stringify(value);
}

function compareFields(current, next) {
  const keys = [...new Set([...Object.keys(current ?? {}), ...Object.keys(next ?? {})])].sort();
  return keys.filter((key) => stableJson(current?.[key]) !== stableJson(next?.[key]));
}

function indexBySourceNumber(products, label) {
  if (!Array.isArray(products)) throw new Error(`${label} alchemy catalog must be an array`);
  const result = new Map();
  for (const product of products) {
    if (!Number.isInteger(product?.sourceNumber)) throw new Error(`${label} alchemy product requires sourceNumber`);
    if (typeof product?.id !== "string" || !product.id) throw new Error(`${label} alchemy product requires id`);
    if (result.has(product.sourceNumber)) throw new Error(`${label} alchemy source number is duplicated: ${product.sourceNumber}`);
    result.set(product.sourceNumber, product);
  }
  return result;
}

export class AlchemyDiffGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = "AlchemyDiffGuardError";
  }
}

export function diffAlchemyCatalogs({ current, next }) {
  const currentBySource = indexBySourceNumber(current, "Current");
  const nextBySource = indexBySourceNumber(next, "Next");
  const added = [];
  const changed = [];
  const unchanged = [];
  const removed = [];
  const identityChurn = [];
  const sourceNumbers = [...new Set([...currentBySource.keys(), ...nextBySource.keys()])]
    .sort((left, right) => left - right);

  for (const sourceNumber of sourceNumbers) {
    const currentProduct = currentBySource.get(sourceNumber);
    const nextProduct = nextBySource.get(sourceNumber);
    if (!currentProduct) {
      added.push(nextProduct);
      continue;
    }
    if (!nextProduct) {
      removed.push(currentProduct);
      continue;
    }
    if (currentProduct.id !== nextProduct.id) {
      identityChurn.push({ sourceNumber, currentId: currentProduct.id, nextId: nextProduct.id });
      continue;
    }
    const fields = compareFields(currentProduct, nextProduct);
    if (fields.length) changed.push({ id: nextProduct.id, sourceNumber, fields });
    else unchanged.push(nextProduct.id);
  }

  return Object.freeze({ added, changed, unchanged, removed, identityChurn });
}

export function evaluateAlchemyDiffGuards({ diff, allowRemovals = false }) {
  if (diff.identityChurn.length) {
    throw new AlchemyDiffGuardError(`Alchemy identity churn is forbidden (${diff.identityChurn.length} records)`);
  }
  if (diff.removed.length && !allowRemovals) {
    throw new AlchemyDiffGuardError(`Alchemy removals require --allow-removals (${diff.removed.length} records)`);
  }
  return diff;
}

function recordList(records, selector = (record) => record.id) {
  return records.length ? records.map(selector).join(", ") : "none";
}

export function formatAlchemyDiffReport({ diff, mode = "dry-run" }) {
  const lines = [
    `Alchemy import ${mode}`,
    `products: +${diff.added.length} ~${diff.changed.length} =${diff.unchanged.length} -${diff.removed.length} churn:${diff.identityChurn.length}`
  ];
  if (diff.added.length) lines.push(`added: ${recordList(diff.added)}`);
  if (diff.changed.length) lines.push(`changed: ${recordList(diff.changed, (record) => `${record.id}[${record.fields.join(",")}]`)}`);
  if (diff.removed.length) lines.push(`removed: ${recordList(diff.removed)}`);
  if (diff.identityChurn.length) {
    lines.push(`identity-churn: ${recordList(diff.identityChurn, (record) => `${record.sourceNumber}:${record.currentId}->${record.nextId}`)}`);
  }
  return `${lines.join("\n")}\n`;
}
