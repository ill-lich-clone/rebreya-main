export class SpellAreaRuntime {
  #registry;

  constructor({ registry } = {}) {
    this.#registry = registry;
  }

  registerRecipe({ recipe, version, handlers }) {
    return this.#registry.register({
      runtime: "area",
      recipe,
      version,
      handlers
    });
  }
}
