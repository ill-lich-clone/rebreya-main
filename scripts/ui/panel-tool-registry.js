function requireString(value, label) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new TypeError(`${label} must be a non-empty string`);
  return normalized;
}

function normalizeDefinition(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Panel tool definition must be an object");
  }

  const order = Number(value.order);
  if (!Number.isFinite(order)) throw new TypeError("Panel tool order must be finite");
  if (typeof value.visible !== "function") throw new TypeError("Panel tool visible must be a function");
  if (typeof value.onChange !== "function") throw new TypeError("Panel tool onChange must be a function");

  return Object.freeze({
    name: requireString(value.name, "Panel tool name"),
    title: requireString(value.title, "Panel tool title"),
    icon: requireString(value.icon, "Panel tool icon"),
    order,
    visible: value.visible,
    onChange: value.onChange
  });
}

function definitionsEqual(left, right) {
  return left.name === right.name
    && left.title === right.title
    && left.icon === right.icon
    && left.order === right.order
    && left.visible === right.visible
    && left.onChange === right.onChange;
}

export class PanelToolRegistry {
  #moduleProvider;
  #refresh;
  #tools = new Map();

  constructor({ moduleProvider, refresh } = {}) {
    if (typeof moduleProvider !== "function") throw new TypeError("moduleProvider must be a function");
    if (typeof refresh !== "function") throw new TypeError("refresh must be a function");
    this.#moduleProvider = moduleProvider;
    this.#refresh = refresh;
  }

  register(moduleId, definition) {
    const ownerId = requireString(moduleId, "Module id");
    const ownerModule = this.#moduleProvider(ownerId);
    const ownerRuntimeLoaded = ownerModule?.api && typeof ownerModule.api === "object";
    if (ownerModule?.active !== true && !ownerRuntimeLoaded) {
      throw new Error(`Panel tool owner '${ownerId}' is not active`);
    }

    const normalized = normalizeDefinition(definition);
    const existing = this.#tools.get(normalized.name);
    if (existing) {
      if (existing.moduleId !== ownerId) {
        throw new Error(`Panel tool '${normalized.name}' is already owned by '${existing.moduleId}'`);
      }
      if (!definitionsEqual(existing.definition, normalized)) {
        throw new Error(`Panel tool '${normalized.name}' is already registered with a different definition`);
      }
      return {
        registered: false,
        unregister: () => this.unregister(ownerId, normalized.name)
      };
    }

    this.#tools.set(normalized.name, { moduleId: ownerId, definition: normalized });
    this.#refresh();
    return {
      registered: true,
      unregister: () => this.unregister(ownerId, normalized.name)
    };
  }

  unregister(moduleId, toolName) {
    const ownerId = requireString(moduleId, "Module id");
    const name = requireString(toolName, "Panel tool name");
    const existing = this.#tools.get(name);
    if (!existing || existing.moduleId !== ownerId) return false;

    this.#tools.delete(name);
    this.#refresh();
    return true;
  }

  list() {
    return [...this.#tools.values()]
      .map(({ definition }) => ({ ...definition }))
      .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
  }
}
