export const SPELL_AUTOMATION_RUNTIMES = Object.freeze({
  INSTANCE: "instance",
  SUMMON: "summon",
  INTERCEPTION: "interception",
  AREA: "area"
});

export function spellAutomationKey({ runtime, recipe, version } = {}) {
  if (typeof runtime !== "string" || runtime.length === 0
    || typeof recipe !== "string" || recipe.length === 0
    || !Number.isInteger(version) || version <= 0) {
    throw new TypeError("Spell automation declarations require a non-empty runtime and recipe plus a positive integer version.");
  }

  return `${runtime}:${recipe}:v${version}`;
}

export class SpellAutomationRegistry {
  #definitions = new Map();

  register(definition) {
    const key = spellAutomationKey(definition);
    if (!definition || typeof definition !== "object" || Array.isArray(definition)
      || !definition.handlers || typeof definition.handlers !== "object" || Array.isArray(definition.handlers)) {
      throw new TypeError("Spell automation definitions require a handlers object.");
    }
    for (const handler of Object.values(definition.handlers)) {
      if (typeof handler !== "function") {
        throw new TypeError("Spell automation handlers must be functions.");
      }
    }
    if (this.#definitions.has(key)) {
      throw new Error(`Spell automation definition already registered for ${key}.`);
    }

    const registered = Object.freeze({
      ...definition,
      handlers: Object.freeze({ ...definition.handlers })
    });
    this.#definitions.set(key, registered);
    return registered;
  }

  resolve(declaration) {
    return this.#definitions.get(spellAutomationKey(declaration)) ?? null;
  }

  dispatch(eventName, declaration, context) {
    const handler = this.resolve(declaration)?.handlers[eventName];
    if (!handler) {
      return { handled: false, value: undefined };
    }

    return { handled: true, value: handler(this.resolve(declaration), context) };
  }
}
