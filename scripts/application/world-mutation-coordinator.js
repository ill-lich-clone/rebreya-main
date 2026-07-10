export const MAX_COMPLETED_MUTATION_RESULTS = 256;

/**
 * Serializes world mutations by key and reuses bounded request results.
 *
 * This application service deliberately has no Foundry dependency.
 */
export class WorldMutationCoordinator {
  #completed = new Map();
  #completedLimit;
  #inFlight = new Map();
  #queues = new Map();

  constructor({ completedLimit = MAX_COMPLETED_MUTATION_RESULTS } = {}) {
    if (!Number.isInteger(completedLimit) || completedLimit < 1) {
      throw new TypeError("completedLimit must be a positive integer");
    }
    this.#completedLimit = completedLimit;
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

    const result = this.run(key, operation);
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

  #remember(requestId, result) {
    this.#completed.set(requestId, result);
    while (this.#completed.size > this.#completedLimit) {
      const oldestRequestId = this.#completed.keys().next().value;
      this.#completed.delete(oldestRequestId);
    }
  }
}
