export const SPELL_INSTANCE_OPERATION_LEASE_STATE_KEY = "rebreya-main:spell-instance-operation-lease";

const DEFAULT_COMPLETED_LIMIT = 64;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isSerializable(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol"
    || typeof value === "bigint" || typeof value !== "object" || seen.has(value)) {
    return false;
  }
  seen.add(value);
  const values = Array.isArray(value)
    ? value
    : isPlainObject(value) ? Object.values(value) : null;
  return values !== null && values.every((entry) => isSerializable(entry, seen));
}

function requireText(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new TypeError(`${label} must be a non-empty string.`);
  return normalized;
}

function requireLimit(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError("Spell instance operation lease completedLimit must be a positive integer.");
  }
  return value;
}

function operationKey(actor, instanceId, operationId) {
  return `${requireText(actor?.uuid, "Spell instance actor UUID")}\u0000${requireText(instanceId, "Spell instance ID")}\u0000${requireText(operationId, "Parent operation ID")}`;
}

function mutationOperationId(parentOperationId, phase, token, revision) {
  return `spell-instance-lease:${parentOperationId}:${phase}:${token}:${revision}`;
}

function emptyMetadata() {
  return { completed: [], lease: null, version: 1 };
}

function metadataFrom(state) {
  const raw = state?.[SPELL_INSTANCE_OPERATION_LEASE_STATE_KEY];
  if (raw === undefined) return emptyMetadata();
  if (!isPlainObject(raw) || raw.version !== 1 || !Array.isArray(raw.completed)
    || (raw.lease !== null && !isPlainObject(raw.lease))) {
    throw new Error("Spell instance operation lease metadata is invalid.");
  }
  const completed = raw.completed.map((entry) => {
    if (!isPlainObject(entry)) throw new Error("Spell instance operation lease completion history is invalid.");
    return { operationId: requireText(entry.operationId, "Completed parent operation ID") };
  });
  let lease = null;
  if (raw.lease !== null) {
    lease = {
      ownerToken: requireText(raw.lease.ownerToken, "Spell instance operation lease owner token"),
      parentOperationId: requireText(raw.lease.parentOperationId, "Spell instance operation lease parent operation ID")
    };
  }
  return { completed, lease, version: 1 };
}

function stateWithMetadata(domainState, metadata) {
  if (!isPlainObject(domainState) || !isSerializable(domainState)) {
    throw new TypeError("Spell instance operation lease domain state must be a serializable plain object.");
  }
  const next = clone(domainState);
  delete next[SPELL_INSTANCE_OPERATION_LEASE_STATE_KEY];
  next[SPELL_INSTANCE_OPERATION_LEASE_STATE_KEY] = clone(metadata);
  return next;
}

function completed(metadata, operationId) {
  return metadata.completed.some((entry) => entry.operationId === operationId);
}

function leaseOwner(metadata, operationId, token) {
  return metadata.lease?.parentOperationId === operationId && metadata.lease.ownerToken === token;
}

/**
 * Persists an owner token before a repeated spell performs an external effect.
 * The state payload remains recipe-neutral: the reserved metadata key is the
 * only field this service owns; every other state field belongs to the recipe.
 */
export class SpellInstanceOperationLease {
  #completedLimit;
  #inFlight = new Map();
  #runtime;
  #tokenFactory;

  constructor({ runtime, tokenFactory = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, completedLimit = DEFAULT_COMPLETED_LIMIT } = {}) {
    if (!runtime || typeof runtime.readInstance !== "function" || typeof runtime.updateInstance !== "function"
      || typeof runtime.deleteInstance !== "function") {
      throw new TypeError("Spell instance operation lease requires runtime readInstance, updateInstance, and deleteInstance APIs.");
    }
    if (typeof tokenFactory !== "function") {
      throw new TypeError("Spell instance operation lease tokenFactory must be a function.");
    }
    this.#completedLimit = requireLimit(completedLimit);
    this.#runtime = runtime;
    this.#tokenFactory = tokenFactory;
  }

  reserve({ actor, instanceId, operationId } = {}) {
    const key = operationKey(actor, instanceId, operationId);
    const current = this.#inFlight.get(key);
    if (current) return current;
    const attempt = this.#reserve({ actor, instanceId, operationId }).finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, attempt);
    return attempt;
  }

  async #reserve({ actor, instanceId, operationId }) {
    const parentOperationId = requireText(operationId, "Parent operation ID");
    const record = this.#read(actor, instanceId);
    const metadata = metadataFrom(record.state);
    if (completed(metadata, parentOperationId)) return { status: "completed", record };
    if (metadata.lease) return { status: "busy", record };

    const token = requireText(this.#tokenFactory(), "Spell instance operation lease token");
    const state = stateWithMetadata(record.state, {
      ...metadata,
      lease: { ownerToken: token, parentOperationId }
    });
    try {
      const updated = await this.#runtime.updateInstance({
        actor,
        authoritative: true,
        expectedRevision: record.revision,
        instanceId,
        operationId: mutationOperationId(parentOperationId, "reserve", token, record.revision),
        state
      });
      return { status: "acquired", token, record: updated };
    }
    catch (error) {
      if (!/stale revision/u.test(String(error?.message))) throw error;
      const latest = this.#read(actor, instanceId);
      const latestMetadata = metadataFrom(latest.state);
      if (completed(latestMetadata, parentOperationId)) return { status: "completed", record: latest };
      if (latestMetadata.lease) return { status: "busy", record: latest };
      return { status: "stale", record: latest };
    }
  }

  async persist({ actor, instanceId, operationId, token, state } = {}) {
    const { metadata, record, parentOperationId, ownerToken } = this.#owned(actor, instanceId, operationId, token);
    const updated = await this.#runtime.updateInstance({
      actor,
      authoritative: true,
      expectedRevision: record.revision,
      instanceId,
      operationId: mutationOperationId(parentOperationId, "persist", ownerToken, record.revision),
      state: stateWithMetadata(state, metadata)
    });
    return { status: "persisted", token: ownerToken, record: updated };
  }

  async release({ actor, instanceId, operationId, token } = {}) {
    const { metadata, record, parentOperationId, ownerToken } = this.#owned(actor, instanceId, operationId, token);
    const updated = await this.#runtime.updateInstance({
      actor,
      authoritative: true,
      expectedRevision: record.revision,
      instanceId,
      operationId: mutationOperationId(parentOperationId, "release", ownerToken, record.revision),
      state: stateWithMetadata(record.state, { ...metadata, lease: null })
    });
    return { status: "released", token: ownerToken, record: updated };
  }

  async complete({ actor, instanceId, operationId, token } = {}) {
    const { metadata, record, parentOperationId, ownerToken } = this.#owned(actor, instanceId, operationId, token);
    const history = metadata.completed.filter((entry) => entry.operationId !== parentOperationId);
    history.push({ operationId: parentOperationId });
    const updated = await this.#runtime.updateInstance({
      actor,
      authoritative: true,
      expectedRevision: record.revision,
      instanceId,
      operationId: mutationOperationId(parentOperationId, "complete", ownerToken, record.revision),
      state: stateWithMetadata(record.state, {
        ...metadata,
        completed: history.slice(-this.#completedLimit),
        lease: null
      })
    });
    return { status: "completed", token: ownerToken, record: updated };
  }

  async delete({ actor, instanceId, operationId, token } = {}) {
    const { record, parentOperationId, ownerToken } = this.#owned(actor, instanceId, operationId, token);
    const deleted = await this.#runtime.deleteInstance({
      actor,
      authoritative: true,
      expectedRevision: record.revision,
      instanceId,
      operationId: mutationOperationId(parentOperationId, "delete", ownerToken, record.revision)
    });
    return { status: "deleted", token: ownerToken, record: deleted };
  }

  #read(actor, instanceId) {
    const normalizedInstanceId = requireText(instanceId, "Spell instance ID");
    const record = this.#runtime.readInstance({ actor, instanceId: normalizedInstanceId });
    if (!record) throw new Error(`Spell instance not found: ${normalizedInstanceId}`);
    return record;
  }

  #owned(actor, instanceId, operationId, token) {
    const parentOperationId = requireText(operationId, "Parent operation ID");
    const ownerToken = requireText(token, "Spell instance operation lease token");
    const record = this.#read(actor, instanceId);
    const metadata = metadataFrom(record.state);
    if (!leaseOwner(metadata, parentOperationId, ownerToken)) {
      throw new Error("Spell instance operation lease token does not own this active lease.");
    }
    return { metadata, record, parentOperationId, ownerToken };
  }
}
