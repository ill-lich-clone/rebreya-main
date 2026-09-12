export const QUERY_SCHEDULING = Object.freeze({ mode: "query" });
export const EXCLUSIVE_MUTATION_SCHEDULING = Object.freeze({ mode: "exclusive-mutation" });

export function keyedMutationScheduling(keys) {
  if (typeof keys !== "function") {
    throw new TypeError("Keyed scheduling requires a key resolver");
  }
  return Object.freeze({ mode: "keyed-mutation", keys });
}

export function normalizeAggregateKeys(keys) {
  if (!Array.isArray(keys)) {
    throw new TypeError("Mutation scheduling keys must be an array");
  }
  const normalized = [...new Set(
    keys
      .map((key) => String(key ?? "").trim())
      .filter(Boolean)
  )].sort();
  if (!normalized.length) {
    throw new Error("Mutation scheduling resolved no aggregate keys");
  }
  return Object.freeze(normalized);
}

export function aggregateKey(kind, identity) {
  const cleanKind = String(kind ?? "").trim();
  const cleanIdentity = String(identity ?? "").trim();
  if (!cleanKind || !cleanIdentity) {
    throw new Error("Aggregate key requires kind and identity");
  }
  return `${cleanKind}:${cleanIdentity}`;
}
