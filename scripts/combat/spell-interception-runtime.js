export class SpellInterceptionRuntime {
  #registry;

  constructor({ registry } = {}) {
    this.#registry = registry;
  }

  registerRecipe({ recipe, version, handlers }) {
    if (!this.#registry || typeof this.#registry.register !== "function") {
      throw new TypeError("Spell runtime requires a registry with a register method.");
    }

    return this.#registry.register({
      runtime: "interception",
      recipe,
      version,
      handlers
    });
  }
}
