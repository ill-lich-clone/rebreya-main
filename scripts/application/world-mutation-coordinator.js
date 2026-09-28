import { normalizeAggregateKeys } from "./socket-command-scheduling.js";

export const MAX_COMPLETED_MUTATION_RESULTS = 256;
const NOOP_TRACE = () => {};

/**
 * Serializes world mutations by key and reuses bounded request results.
 *
 * This application service deliberately has no Foundry dependency.
 */
export class WorldMutationCoordinator {
  #completed = new Map();
  #completedLimit;
  #inFlight = new Map();
  #activeScopedCount = 0;
  #activeScopedKeys = new Set();
  #exclusiveScopedActive = false;
  #now;
  #pendingScoped = [];
  #queues = new Map();
  #trace;

  constructor({
    completedLimit = MAX_COMPLETED_MUTATION_RESULTS,
    trace = NOOP_TRACE,
    now = () => globalThis.performance?.now?.() ?? Date.now()
  } = {}) {
    if (!Number.isInteger(completedLimit) || completedLimit < 1) {
      throw new TypeError("completedLimit must be a positive integer");
    }
    this.#completedLimit = completedLimit;
    this.#trace = typeof trace === "function" ? trace : NOOP_TRACE;
    this.#now = typeof now === "function" ? now : (() => Date.now());
  }

  run(key, operation) {
    if (typeof operation !== "function") {
      throw new TypeError("operation must be a function");
    }

    const previous = this.#queues.get(key) ?? Promise.resolve();
    const result = previous
      .catch(() => undefined)
      .then(() => operation());
    const tail = result
      .catch(() => undefined)
      .finally(() => {
        if (this.#queues.get(key) === tail) {
          this.#queues.delete(key);
        }
      });

    this.#queues.set(key, tail);
    return result;
  }

  runIdempotent(key, requestId, operation) {
    return this.#runIdempotent(requestId, () => this.run(key, operation));
  }

  runScoped({ keys = [], exclusive = false, traceContext = null } = {}, operation) {
    if (typeof operation !== "function") {
      throw new TypeError("operation must be a function");
    }
    const normalizedKeys = exclusive ? Object.freeze([]) : normalizeAggregateKeys(keys);

    return new Promise((resolve, reject) => {
      const job = {
        exclusive: exclusive === true,
        keys: normalizedKeys,
        operation,
        reject,
        resolve,
        traceContext
      };
      this.#pendingScoped.push(job);
      this.#traceScoped(job, "queued");
      this.#drainScoped();
    });
  }

  runIdempotentScoped({ requestId, ...scope } = {}, operation) {
    return this.#runIdempotent(requestId, () => this.runScoped(scope, operation));
  }

  #runIdempotent(requestId, schedule) {
    const normalizedRequestId = String(requestId ?? "").trim();
    if (!normalizedRequestId) {
      throw new TypeError("requestId must be a non-empty string");
    }

    const completed = this.#completed.get(normalizedRequestId);
    if (completed) {
      return completed.ok
        ? Promise.resolve(completed.value)
        : Promise.reject(completed.error);
    }

    const inFlight = this.#inFlight.get(normalizedRequestId);
    if (inFlight) {
      return inFlight;
    }

    const result = schedule();
    this.#inFlight.set(normalizedRequestId, result);
    result.then(
      (value) => {
        this.#inFlight.delete(normalizedRequestId);
        this.#remember(normalizedRequestId, { ok: true, value });
      },
      (error) => {
        this.#inFlight.delete(normalizedRequestId);
        this.#remember(normalizedRequestId, { ok: false, error });
      }
    );
    return result;
  }

  #drainScoped() {
    if (this.#exclusiveScopedActive) return;

    let index = 0;
    while (index < this.#pendingScoped.length) {
      const job = this.#pendingScoped[index];
      if (job.exclusive) {
        if (index === 0 && this.#activeScopedCount === 0) {
          this.#pendingScoped.splice(index, 1);
          this.#startScoped(job);
        }
        return;
      }
      if (!this.#canStartScoped(job, index)) {
        index += 1;
        continue;
      }
      this.#pendingScoped.splice(index, 1);
      this.#startScoped(job);
    }
  }

  #canStartScoped(job, index) {
    if (job.keys.some((key) => this.#activeScopedKeys.has(key))) {
      return false;
    }
    for (let earlierIndex = 0; earlierIndex < index; earlierIndex += 1) {
      const earlier = this.#pendingScoped[earlierIndex];
      if (earlier.exclusive || earlier.keys.some((key) => job.keys.includes(key))) {
        return false;
      }
    }
    return true;
  }

  #startScoped(job) {
    this.#activeScopedCount += 1;
    if (job.exclusive) {
      this.#exclusiveScopedActive = true;
    }
    else {
      for (const key of job.keys) this.#activeScopedKeys.add(key);
    }
    this.#traceScoped(job, "queue-start");

    Promise.resolve()
      .then(() => job.operation())
      .then(
        (value) => {
          this.#releaseScoped(job);
          job.resolve(value);
        },
        (error) => {
          this.#releaseScoped(job);
          job.reject(error);
        }
      );
  }

  #releaseScoped(job) {
    this.#activeScopedCount -= 1;
    if (job.exclusive) {
      this.#exclusiveScopedActive = false;
    }
    else {
      for (const key of job.keys) this.#activeScopedKeys.delete(key);
    }
    this.#drainScoped();
  }

  #traceScoped(job, phase) {
    const context = job.traceContext;
    if (!context || typeof context !== "object") return;
    try {
      this.#trace({
        phase,
        command: String(context.command ?? ""),
        requestId: String(context.requestId ?? ""),
        senderId: String(context.senderId ?? ""),
        at: this.#now(),
        mode: job.exclusive ? "exclusive-mutation" : "keyed-mutation",
        keys: job.keys
      });
    }
    catch {
      // Diagnostics must never change mutation behavior.
    }
  }

  #remember(requestId, result) {
    this.#completed.set(requestId, result);
    while (this.#completed.size > this.#completedLimit) {
      const oldestRequestId = this.#completed.keys().next().value;
      this.#completed.delete(oldestRequestId);
    }
  }
}
