import { WorldMutationCoordinator } from "./world-mutation-coordinator.js";

export const DEFAULT_TERMINAL_MUTATION_LIMIT = 64;

function clone(value) {
  if (value == null) {
    return value;
  }
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function cleanId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function defaultNormalizeState(value) {
  return {
    version: 1,
    records: Array.isArray(value?.records)
      ? value.records.filter(isPlainObject).map((record) => clone(record))
      : []
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function recordsEqual(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export class DurableMutationJournalError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DurableMutationJournalError";
    this.code = code;
    Object.assign(this, details);
  }
}

/**
 * Persists small phase records and serializes mutations against one backing state.
 * The caller owns the storage format outside of the normalized `records` array.
 */
export class DurableMutationJournal {
  #coordinator;
  #limit;
  #normalizeState;
  #readState;
  #writeState;

  constructor({
    readState,
    writeState,
    normalizeState = defaultNormalizeState,
    limit = DEFAULT_TERMINAL_MUTATION_LIMIT,
    coordinator = new WorldMutationCoordinator()
  } = {}) {
    if (typeof readState !== "function" || typeof writeState !== "function") {
      throw new TypeError("readState and writeState must be functions");
    }
    if (typeof normalizeState !== "function") {
      throw new TypeError("normalizeState must be a function");
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new TypeError("limit must be a positive integer");
    }
    if (!coordinator || typeof coordinator.run !== "function") {
      throw new TypeError("coordinator must serialize mutations");
    }

    this.#readState = readState;
    this.#writeState = writeState;
    this.#normalizeState = normalizeState;
    this.#limit = limit;
    this.#coordinator = coordinator;
  }

  find(id) {
    const mutationId = this.#requireId(id);
    return this.#coordinator.run("durable-mutation-journal", async () => {
      const state = await this.#readNormalizedState();
      return clone(this.#findRecord(state, mutationId));
    });
  }

  start(record) {
    if (!isPlainObject(record)) {
      return Promise.reject(new TypeError("record must be a plain object"));
    }
    const mutationId = this.#requireId(record.id);
    const phase = this.#requirePhase(record.phase);
    return this.#coordinator.run("durable-mutation-journal", async () => {
      const state = await this.#readNormalizedState();
      const existing = this.#findRecord(state, mutationId);
      if (existing) {
        return clone(existing);
      }

      const nextRecord = {
        ...clone(record),
        id: mutationId,
        phase,
        terminal: false
      };
      return this.#persistRecord(state, nextRecord);
    });
  }

  checkpoint(id, expectedPhase, nextPhase, patch = {}) {
    const mutationId = this.#requireId(id);
    const requiredPhase = this.#requirePhase(expectedPhase);
    const targetPhase = this.#requirePhase(nextPhase);
    if (!isPlainObject(patch)) {
      return Promise.reject(new TypeError("checkpoint patch must be a plain object"));
    }

    return this.#coordinator.run("durable-mutation-journal", async () => {
      const state = await this.#readNormalizedState();
      const existing = this.#findRecord(state, mutationId);
      if (!existing) {
        throw new DurableMutationJournalError(
          "record-not-found",
          `Mutation record not found: ${mutationId}`,
          { mutationId }
        );
      }
      if (existing.terminal === true || existing.phase !== requiredPhase) {
        throw new DurableMutationJournalError(
          "phase-conflict",
          `Mutation ${mutationId} is in phase ${String(existing.phase)}, expected ${requiredPhase}`,
          {
            mutationId,
            currentPhase: existing.phase,
            expectedPhase: requiredPhase
          }
        );
      }

      const nextRecord = {
        ...clone(existing),
        ...clone(patch),
        id: mutationId,
        phase: targetPhase,
        terminal: false
      };
      return this.#persistRecord(state, nextRecord);
    });
  }

  finish(id, result) {
    const mutationId = this.#requireId(id);
    return this.#coordinator.run("durable-mutation-journal", async () => {
      const state = await this.#readNormalizedState();
      const existing = this.#findRecord(state, mutationId);
      if (!existing) {
        throw new DurableMutationJournalError(
          "record-not-found",
          `Mutation record not found: ${mutationId}`,
          { mutationId }
        );
      }
      if (existing.terminal === true) {
        return clone(existing);
      }

      const nextRecord = {
        ...clone(existing),
        terminal: true,
        result: clone(result)
      };
      return this.#persistRecord(state, nextRecord);
    });
  }

  recordTerminal(record, result) {
    if (!isPlainObject(record)) {
      return Promise.reject(new TypeError("record must be a plain object"));
    }
    const mutationId = this.#requireId(record.id);
    const phase = this.#requirePhase(record.phase);
    const fingerprint = cleanId(record.fingerprint);
    if (!fingerprint) {
      return Promise.reject(new TypeError("record fingerprint must be a non-empty string"));
    }

    return this.#coordinator.run("durable-mutation-journal", async () => {
      const state = await this.#readNormalizedState();
      const existing = this.#findRecord(state, mutationId);
      if (existing) {
        if (existing.terminal === true && cleanId(existing.fingerprint) === fingerprint) {
          return clone(existing);
        }
        throw new DurableMutationJournalError(
          "record-conflict",
          `Mutation ${mutationId} conflicts with an existing record`,
          {
            mutationId,
            currentPhase: existing.phase,
            currentFingerprint: cleanId(existing.fingerprint),
            expectedFingerprint: fingerprint
          }
        );
      }

      return this.#persistRecord(state, {
        ...clone(record),
        id: mutationId,
        phase,
        fingerprint,
        terminal: true,
        result: clone(result)
      });
    });
  }

  #requireId(value) {
    const id = cleanId(value);
    if (!id) {
      throw new TypeError("mutation id must be a non-empty string");
    }
    return id;
  }

  #requirePhase(value) {
    const phase = cleanId(value);
    if (!phase) {
      throw new TypeError("mutation phase must be a non-empty string");
    }
    return phase;
  }

  async #readNormalizedState() {
    const normalized = this.#normalizeState(await this.#readState());
    if (!isPlainObject(normalized) || !Array.isArray(normalized.records)) {
      throw new TypeError("normalizeState must return an object with a records array");
    }
    return clone(normalized);
  }

  #findRecord(state, mutationId) {
    return state.records.find((record) => cleanId(record?.id) === mutationId) ?? null;
  }

  #stateWithRecord(state, nextRecord) {
    const records = state.records
      .filter((record) => cleanId(record?.id) !== nextRecord.id)
      .map((record) => clone(record));
    records.push(clone(nextRecord));

    const nonterminal = records.filter((record) => record?.terminal !== true);
    const terminal = records.filter((record) => record?.terminal === true).slice(-this.#limit);
    return {
      ...clone(state),
      records: [...nonterminal, ...terminal]
    };
  }

  async #persistRecord(state, nextRecord) {
    const nextState = this.#stateWithRecord(state, nextRecord);
    try {
      await this.#writeState(clone(nextState));
      return clone(nextRecord);
    }
    catch (error) {
      const durableState = await this.#readNormalizedState();
      const durableRecord = this.#findRecord(durableState, nextRecord.id);
      if (durableRecord && recordsEqual(durableRecord, nextRecord)) {
        return clone(durableRecord);
      }
      throw error;
    }
  }
}
