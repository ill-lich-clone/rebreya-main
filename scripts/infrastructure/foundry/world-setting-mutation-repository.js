import { MODULE_ID } from "../../constants.js";

function clone(value) {
  if (typeof globalThis.foundry?.utils?.deepClone === "function") {
    return globalThis.foundry.utils.deepClone(value);
  }

  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function defaultNormalize(value) {
  return isPlainObject(value)
    ? clone(value)
    : {};
}

function requireSettings(game, { write = false } = {}) {
  const settings = game?.settings;
  if (typeof settings?.get !== "function" || (write && typeof settings?.set !== "function")) {
    throw new Error("Foundry world settings are unavailable");
  }
  return settings;
}

function resolveNormalize(normalize) {
  if (normalize == null) return defaultNormalize;
  if (typeof normalize !== "function") {
    throw new TypeError("normalize must be a function");
  }
  return normalize;
}

function normalizeDetached(normalize, value) {
  return clone(normalize(clone(value)));
}

export class WorldSettingMutationRepository {
  #gameProvider;
  #mutationGateway;

  constructor({ mutationGateway, gameProvider }) {
    if (typeof mutationGateway?.commit !== "function") {
      throw new TypeError("mutationGateway must provide commit");
    }
    if (typeof gameProvider !== "function") {
      throw new TypeError("gameProvider must be a function");
    }
    this.#mutationGateway = mutationGateway;
    this.#gameProvider = gameProvider;
  }

  readObject(settingKey, { normalize } = {}) {
    const settings = requireSettings(this.#gameProvider());
    return normalizeDetached(
      resolveNormalize(normalize),
      settings.get(MODULE_ID, settingKey)
    );
  }

  mutateObject(settingKey, mutator, { normalize, afterCommit = null } = {}) {
    if (typeof mutator !== "function") {
      throw new TypeError("mutator must be a function");
    }
    if (afterCommit != null && typeof afterCommit !== "function") {
      throw new TypeError("afterCommit must be a function or null");
    }

    const normalizeObject = resolveNormalize(normalize);
    return this.#mutationGateway.commit(`setting:${settingKey}`, async ({ assertActiveGm }) => {
      const settings = requireSettings(this.#gameProvider(), { write: true });
      const current = normalizeDetached(
        normalizeObject,
        settings.get(MODULE_ID, settingKey)
      );
      const result = await mutator(current);
      const committed = normalizeDetached(normalizeObject, current);

      assertActiveGm();
      await settings.set(MODULE_ID, settingKey, clone(committed));
      assertActiveGm();

      return afterCommit ? afterCommit(result, clone(committed)) : result;
    });
  }

  replaceObject(settingKey, value, options = {}) {
    const replacement = normalizeDetached(resolveNormalize(options.normalize), value);
    return this.mutateObject(settingKey, (current) => {
      for (const key of Reflect.ownKeys(current)) {
        delete current[key];
      }
      Object.assign(current, clone(replacement));
    }, options);
  }
}
