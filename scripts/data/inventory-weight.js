const DEFAULT_WEIGHT_CONVERSIONS = { lb: 1, tn: 2000, kg: 2.5, Mg: 2500 };

function nonnegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function pounds(value, units = "lb") {
  const conversions = globalThis.CONFIG?.DND5E?.weightUnits;
  const factor = conversions?.[units]?.conversion ?? DEFAULT_WEIGHT_CONVERSIONS[units] ?? 1;
  const poundFactor = conversions?.lb?.conversion ?? 1;
  return nonnegative(value) * factor / poundFactor;
}

function roundWeight(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function hasWeightlessContents(item) {
  const properties = item?.system?.properties;
  return item?.type === "container" && (
    properties?.has?.("weightlessContents") === true
    || (Array.isArray(properties) && properties.includes("weightlessContents"))
  );
}

function readNativeWeight(read) {
  try {
    const value = read();
    // Embedded Actor Items have synchronous getters. Detached compendium data
    // may return a Promise; it cannot be used in a synchronous Actor snapshot.
    if (value instanceof Promise) value.catch(() => {});
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  }
  catch (_error) {
    return null;
  }
}

/** Read carried weight without writing Items or counting container contents twice. */
export function buildActorInventoryWeightSnapshot(actor) {
  const items = actor?.items?.contents ?? (Array.isArray(actor?.items) ? actor.items : []);
  const byId = new Map(items.map((item) => [String(item.id ?? item._id ?? ""), item]));
  const parents = new Map();
  let nativeHierarchyValid = true;
  for (const item of items) {
    const parentId = String(item.system?.container ?? "").trim();
    const parent = parentId ? byId.get(parentId) : null;
    if (parentId && (!parent || parent.type !== "container" || parent === item)) nativeHierarchyValid = false;
    parents.set(item, parent?.type === "container" && parent !== item ? parent : null);
  }

  // Break malformed cycles only in this detached projection. Never invoke the
  // system's recursive getters on a corrupt hierarchy or mutate its documents.
  const inspected = new Set();
  for (const item of items) {
    const path = new Set();
    let current = item;
    while (current && !inspected.has(current) && !path.has(current)) {
      path.add(current);
      current = parents.get(current);
    }
    if (current && path.has(current)) {
      nativeHierarchyValid = false;
      const cycleStart = current;
      do {
        const next = parents.get(current);
        parents.set(current, null);
        current = next;
      } while (current !== cycleStart);
    }
    for (const visited of path) inspected.add(visited);
  }

  const children = new Map(items.map((item) => [item, []]));
  for (const [item, parent] of parents) if (parent) children.get(parent).push(item);
  const weights = new Map();
  const contentsWeight = (item) => {
    const nativeContents = nativeHierarchyValid
      ? readNativeWeight(() => item.system?.contentsWeight)
      : null;
    if (nativeContents !== null) return pounds(nativeContents, item.system?.weight?.units);
    const currencyWeight = readNativeWeight(() => item.system?.currencyWeight) ?? 0;
    return children.get(item).reduce((sum, child) => sum + itemWeight(child), 0)
      + pounds(currencyWeight, item.system?.weight?.units);
  };
  const itemWeight = (item) => {
    if (weights.has(item)) return weights.get(item);
    const nativeWeight = nativeHierarchyValid
      ? readNativeWeight(() => item.system?.totalWeightIn?.("lb"))
      : null;
    if (nativeWeight !== null) {
      weights.set(item, nativeWeight);
      return nativeWeight;
    }
    const ownWeight = pounds(item.system?.weight?.value, item.system?.weight?.units);
    const weight = item.type === "container"
      ? ownWeight + (hasWeightlessContents(item) ? 0 : contentsWeight(item))
      : ownWeight * nonnegative(item.system?.quantity, 1);
    weights.set(item, weight);
    return weight;
  };

  const weightLb = roundWeight(items.reduce((sum, item) => sum + (parents.get(item) ? 0 : itemWeight(item)), 0));
  const magicalContainers = items.filter(hasWeightlessContents).map((item) => {
    const capacity = item.system?.capacity?.weight;
    return {
      itemId: String(item.id ?? item._id ?? ""),
      name: String(item.name ?? ""),
      contentsWeightLb: roundWeight(contentsWeight(item)),
      capacityLb: roundWeight(pounds(capacity?.value, capacity?.units)),
      hasWeightCapacity: capacity?.value != null && Number.isFinite(Number(capacity.value))
    };
  });
  return { weightLb, magicalContainers };
}
