export const LONG_REST_HISTORY_LIMIT = 32;

export const LONG_REST_STEP_STATUS = Object.freeze({
  COMPLETED: "completed",
  SKIPPED: "skipped",
  FAILED: "failed"
});

function cleanString(value) {
  return String(value ?? "").trim();
}

function defaultIdFactory() {
  return globalThis.foundry?.utils?.randomID?.()
    ?? globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function escapeHtml(value) {
  const escape = globalThis.foundry?.utils?.escapeHTML;
  if (typeof escape === "function") {
    return escape(String(value ?? ""));
  }
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function errorMessage(error) {
  return cleanString(error?.message ?? error) || "Unknown long-rest step error";
}

function clone(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export class LongRestPipelineService {
  constructor(options = {}) {
    this.options = options;
    this._steps = new Map();
    this._actorQueues = new Map();
    this._seenResults = new WeakMap();
    this._recentRuns = [];
    this._abortController = new AbortController();
  }

  registerStep(definition = {}) {
    const id = cleanString(definition.id);
    if (!id) {
      throw new TypeError("Long-rest step requires id");
    }
    if (typeof definition.run !== "function") {
      throw new TypeError(`Long-rest step ${id} requires run`);
    }
    if (this._steps.has(id)) {
      throw new Error(`Long-rest step ${id} is already registered`);
    }

    const order = Number(definition.order ?? 500);
    if (!Number.isFinite(order)) {
      throw new TypeError(`Long-rest step ${id} requires finite order`);
    }

    this._steps.set(id, Object.freeze({
      ...definition,
      id,
      order
    }));
    return this;
  }

  shutdown(reason = "shutdown") {
    if (!this._abortController.signal.aborted) {
      this._abortController.abort(reason);
    }
  }

  enqueue(actor, result = {}, config = {}) {
    const duplicate = result && typeof result === "object"
      ? this._seenResults.get(result)
      : null;
    if (duplicate) {
      return duplicate;
    }

    const actorKey = cleanString(actor?.uuid ?? actor?.id) || actor || "unknown";
    const previous = this._actorQueues.get(actorKey) ?? Promise.resolve();
    let current;
    current = previous
      .catch(() => undefined)
      .then(() => this.run(actor, result, config))
      .then((runResult) => {
        this.#rememberRun(runResult);
        return runResult;
      })
      .finally(() => {
        if (this._actorQueues.get(actorKey) === current) {
          this._actorQueues.delete(actorKey);
        }
      });
    this._actorQueues.set(actorKey, current);
    if (result && typeof result === "object") {
      this._seenResults.set(result, current);
    }
    return current;
  }

  getRecentRuns() {
    return clone(this._recentRuns);
  }

  async run(actor, result = {}, config = {}) {
    const runId = cleanString(this.options.idFactory?.() ?? defaultIdFactory());
    const actorUuid = cleanString(actor?.uuid ?? actor?.id);
    const baseContext = Object.freeze({
      actor,
      result,
      config,
      runId
    });
    const eligible = [];

    for (const step of this._steps.values()) {
      const applies = typeof step.isEligible === "function"
        ? await step.isEligible(baseContext)
        : true;
      if (applies !== false) {
        eligible.push(step);
      }
    }

    eligible.sort((left, right) => (
      left.order - right.order
      || left.id.localeCompare(right.id)
    ));

    const interactiveStates = new Map();
    for (const step of eligible) {
      interactiveStates.set(
        step.id,
        typeof step.interactive === "function"
          ? await step.interactive(baseContext) === true
          : step.interactive === true
      );
    }
    const interactiveTotal = [...interactiveStates.values()]
      .filter(Boolean)
      .length;
    const steps = [];
    let interactiveCurrent = 0;
    for (const step of eligible) {
      const interactive = interactiveStates.get(step.id) === true;
      if (interactive) {
        interactiveCurrent += 1;
      }
      const label = typeof step.label === "function"
        ? cleanString(await step.label(baseContext))
        : cleanString(step.label) || step.id;
      const progress = this.#createProgress({
        current: interactive ? interactiveCurrent : 0,
        total: interactiveTotal,
        label
      });
      const startedAt = this.#now();
      try {
        if (
          typeof step.isEligible === "function"
          && await step.isEligible(baseContext) === false
        ) {
          steps.push({
            id: step.id,
            status: LONG_REST_STEP_STATUS.SKIPPED,
            durationMs: this.#durationSince(startedAt)
          });
          continue;
        }
        const outcome = await step.run({
          ...baseContext,
          progress,
          signal: this._abortController.signal
        });
        steps.push({
          id: step.id,
          status: outcome?.status === LONG_REST_STEP_STATUS.SKIPPED
            ? LONG_REST_STEP_STATUS.SKIPPED
            : LONG_REST_STEP_STATUS.COMPLETED,
          durationMs: this.#durationSince(startedAt)
        });
      }
      catch (error) {
        const message = errorMessage(error);
        steps.push({
          id: step.id,
          status: LONG_REST_STEP_STATUS.FAILED,
          durationMs: this.#durationSince(startedAt),
          error: message
        });
        this.options.logger?.error?.(
          `Long-rest step ${step.id} failed`,
          { actorUuid, runId, stepId: step.id, error }
        );
      }
    }

    const failedCount = steps.filter(
      (step) => step.status === LONG_REST_STEP_STATUS.FAILED
    ).length;
    if (failedCount > 0) {
      this.options.notifyError?.(
        `Rebreya: ошибок в цепочке продолжительного отдыха: ${failedCount}.`
      );
    }

    return {
      runId,
      actorUuid,
      status: failedCount > 0 ? "completed-with-errors" : LONG_REST_STEP_STATUS.COMPLETED,
      steps
    };
  }

  #createProgress({ current, total, label }) {
    const text = (nextLabel = label, substep = "") => {
      const suffix = cleanString(substep);
      return `Шаг ${current}/${total} · ${cleanString(nextLabel) || label}`
        + (suffix ? ` · ${suffix}` : "");
    };
    return Object.freeze({
      current,
      total,
      title: text,
      header: (nextLabel = label, substep = "") => (
        `<p class="rebreya-long-rest-progress"><strong>`
        + `${escapeHtml(text(nextLabel, substep))}`
        + "</strong></p>"
      )
    });
  }

  #now() {
    return Number(this.options.now?.() ?? globalThis.performance?.now?.() ?? Date.now());
  }

  #durationSince(startedAt) {
    return Math.max(0, this.#now() - startedAt);
  }

  #rememberRun(runResult) {
    this._recentRuns.push(clone(runResult));
    if (this._recentRuns.length > LONG_REST_HISTORY_LIMIT) {
      this._recentRuns.splice(0, this._recentRuns.length - LONG_REST_HISTORY_LIMIT);
    }
  }
}
