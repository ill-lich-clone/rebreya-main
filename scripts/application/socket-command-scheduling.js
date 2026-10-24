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
  const resources = new Set();
  for (const value of keys) {
    const key = String(value ?? "").trim();
    if (!key) continue;
    const separator = key.indexOf(":"), kind = key.slice(0, separator), identity = key.slice(separator + 1);
    resources.add(kind === "actor" ? aggregateKey(kind, identity) : key);
    let actorUuid = kind === "group" ? identity : kind === "actor" ? identity : "";
    if (kind === "document") {
      actorUuid = identity.match(/^(Actor\.[^.]+|Scene\.[^.]+\.Token\.[^.]+\.Actor\.[^.]+)(?:\.|$)/)?.[1] ?? "";
    }
    if (actorUuid) {
      resources.add(aggregateKey("actor", actorUuid));
      const tokenUuid = actorUuid.match(/^(Scene\.[^.]+\.Token\.[^.]+)\.Actor\.[^.]+$/)?.[1];
      if (tokenUuid) resources.add(aggregateKey("document", tokenUuid));
    }
  }
  const normalized = [...resources].sort();
  if (!normalized.length) {
    throw new Error("Mutation scheduling resolved no aggregate keys");
  }
  return Object.freeze(normalized);
}

export function aggregateKey(kind, identity) {
  const cleanKind = String(kind ?? "").trim();
  let cleanIdentity = String(identity ?? "").trim();
  if (!cleanKind || !cleanIdentity) {
    throw new Error("Aggregate key requires kind and identity");
  }
  if (cleanKind === "actor" && /^Actor\.[^.]+$/.test(cleanIdentity)) cleanIdentity = cleanIdentity.slice(6);
  return `${cleanKind}:${cleanIdentity}`;
}

export function normalizeSocketScheduling(policy, {
  allowImplicitExclusive = true,
  command = ""
} = {}) {
  if (policy == null) {
    if (allowImplicitExclusive) return EXCLUSIVE_MUTATION_SCHEDULING;
    throw new TypeError(`Socket command ${String(command).trim() || "<unknown>"} requires scheduling`);
  }
  if (policy.mode === "query") return QUERY_SCHEDULING;
  if (policy.mode === "exclusive-mutation") return EXCLUSIVE_MUTATION_SCHEDULING;
  if (policy.mode === "keyed-mutation" && typeof policy.keys === "function") {
    return Object.isFrozen(policy) ? policy : keyedMutationScheduling(policy.keys);
  }
  throw new TypeError(`Invalid scheduling policy for socket command ${String(command).trim() || "<unknown>"}`);
}

export function resolveSocketScheduling(policy, payload, context) {
  const normalized = normalizeSocketScheduling(policy);
  if (normalized.mode === "query") {
    return Object.freeze({ mode: "query", keys: Object.freeze([]), exclusive: false });
  }
  if (normalized.mode === "exclusive-mutation") {
    return Object.freeze({
      mode: "exclusive-mutation",
      keys: Object.freeze([]),
      exclusive: true
    });
  }
  return Object.freeze({
    mode: "keyed-mutation",
    keys: normalizeAggregateKeys(normalized.keys(payload, context)),
    exclusive: false
  });
}
