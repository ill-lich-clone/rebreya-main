const TARGET_KINDS = new Set(["storage", "door"]);

function clean(value) {
  return String(value ?? "").trim();
}

function normalizePath(value) {
  return (Array.isArray(value) ? value : []).map(clean).filter(Boolean);
}

export function createTriggerTargetRef(kind, uuid, { path = [] } = {}) {
  const targetKind = clean(kind);
  const targetUuid = clean(uuid);
  if (!TARGET_KINDS.has(targetKind)) throw new TypeError("Unknown trigger target kind.");
  if (!targetUuid) throw new TypeError("Trigger target UUID is required.");
  const targetPath = normalizePath(path);
  if (targetKind === "door" && targetPath.length > 0) {
    throw new TypeError("Door trigger target path must be empty.");
  }
  Object.freeze(targetPath);
  return Object.freeze({ kind: targetKind, uuid: targetUuid, path: targetPath });
}

export class TriggerTargetCoordinator {
  constructor({ triggerService, adapters = {} } = {}) {
    if (typeof triggerService?.execute !== "function") {
      throw new TypeError("TriggerTargetCoordinator requires a trigger service.");
    }
    this.triggerService = triggerService;
    this.adapters = new Map(Object.entries(adapters));
  }

  #adapter(ref) {
    const adapter = this.adapters.get(ref?.kind);
    if (!adapter || typeof adapter.read !== "function") {
      throw new Error("Trigger target adapter is unavailable.");
    }
    return adapter;
  }

  #assertEvent(adapter, event) {
    if (!Array.isArray(adapter.allowedEvents) || !adapter.allowedEvents.includes(event)) {
      throw new Error("Целевое событие триггера недоступно.");
    }
  }

  async read(ref, options = {}) {
    return this.#adapter(ref).read(ref, options);
  }

  async saveDefinitions(ref, input = {}, options = {}) {
    const adapter = this.#adapter(ref);
    if (typeof adapter.saveDefinitions !== "function") {
      throw new Error("Сохранение конфигурации цели недоступно.");
    }
    return adapter.saveDefinitions(ref, input, options);
  }

  async resetExecutions(ref, options = {}) {
    const adapter = this.#adapter(ref);
    if (typeof adapter.resetExecutions !== "function") {
      throw new Error("Сброс срабатываний цели недоступен.");
    }
    return adapter.resetExecutions(ref, options);
  }

  async execute(ref, event, context = {}, options = {}) {
    const adapter = this.#adapter(ref);
    this.#assertEvent(adapter, event);
    const snapshot = await adapter.read(ref, options);
    if (snapshot?.enabled !== true) {
      return { allowed: true, completedChainIds: [] };
    }
    if (typeof adapter.updateRuntime !== "function") {
      throw new Error("Runtime persistence цели триггера недоступен.");
    }
    return this.triggerService.execute(event, snapshot.triggers, {
      ...context,
      targetKind: ref.kind,
      targetUuid: ref.uuid,
      persistRuntime: (_triggerContext, mutate) => adapter.updateRuntime(ref, mutate, options)
    });
  }
}
