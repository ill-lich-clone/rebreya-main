export class SpellInterceptionRuntime {
  #registry;

  constructor({ registry } = {}) {
    this.#registry = registry;
  }

  registerRecipe({ recipe, version, handlers }) {
    return this.#registry.register({
      runtime: "interception",
      recipe,
      version,
      handlers
    });
  }
}
