import { MODULE_ID, SETTINGS_KEYS } from "../../constants.js";

const GROUP_STATE_QUEUE_KEY = `setting:${SETTINGS_KEYS.GROUP_STATE}`;

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return globalThis.foundry.utils.deepClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export class GroupStateRepository {
  #buildDefaultGroupState;
  #gameProvider;
  #mutationGateway;
  #normalizeGroupState;
  #normalizeRegistry;

  constructor({
    mutationGateway = null,
    gameProvider,
    normalizeRegistry,
    normalizeGroupState,
    buildDefaultGroupState
  }) {
    this.#mutationGateway = mutationGateway;
    this.#gameProvider = gameProvider;
    this.#normalizeRegistry = normalizeRegistry;
    this.#normalizeGroupState = normalizeGroupState;
    this.#buildDefaultGroupState = buildDefaultGroupState;
  }

  read() {
    return this.#normalizeRegistry(clone(this.#readSetting()));
  }

  readGroupIndex() {
    const registry = asObject(this.#readSetting());
    return {
      activeGroupActorId: String(registry.activeGroupActorId ?? "").trim(),
      groupActorIds: [...new Set(Object.keys(asObject(registry.groupsById))
        .map(id => id.trim()).filter(Boolean))]
    };
  }

  readCalendarState(groupActorId) {
    const id = String(groupActorId ?? "").trim();
    if (!id) return {};
    const groups = asObject(asObject(this.#readSetting()).groupsById);
    let group;
    for (const key of Object.keys(groups)) {
      if (key.trim() === id) group = groups[key];
    }
    const calendar = asObject(asObject(group).calendar);
    const state = {};
    for (const key of ["version", "isoDate", "timeOfDaySeconds"]) {
      const value = calendar[key];
      if (value !== undefined) state[key] = value;
    }
    return clone(state);
  }

  mutateRegistry(mutator, { afterCommit = null } = {}) {
    return this.#requireMutationGateway().commit(GROUP_STATE_QUEUE_KEY, async ({ assertActiveGm }) => {
      const settings = this.#requireSettings({ write: true });
      const registry = this.#normalizeRegistry(clone(settings.get(MODULE_ID, SETTINGS_KEYS.GROUP_STATE)));
      const result = await mutator(registry);
      const committedRegistry = this.#normalizeRegistry(clone(registry));

      assertActiveGm();
      await settings.set(MODULE_ID, SETTINGS_KEYS.GROUP_STATE, committedRegistry);
      assertActiveGm();
      return typeof afterCommit === "function"
        ? afterCommit(result, clone(committedRegistry))
        : result;
    });
  }

  mutateGroupState(groupActorId, mutator, { create = false, afterCommit = null } = {}) {
    const normalizedGroupActorId = String(groupActorId ?? "").trim();

    return this.mutateRegistry(async (registry) => {
      const existingGroupState = registry.groupsById[normalizedGroupActorId];
      if (!existingGroupState && !create) {
        throw new Error(`Group state not found: ${normalizedGroupActorId}`);
      }

      const groupState = existingGroupState ?? this.#normalizeGroupState(
        normalizedGroupActorId, this.#buildDefaultGroupState(normalizedGroupActorId)
      );
      registry.groupsById[normalizedGroupActorId] = groupState;

      const result = await mutator(groupState, registry);
      registry.groupsById[normalizedGroupActorId] = groupState;
      return result;
    }, { afterCommit });
  }

  #readSetting() {
    return this.#gameProvider()?.settings?.get?.(MODULE_ID, SETTINGS_KEYS.GROUP_STATE) ?? {};
  }

  #requireMutationGateway() {
    if (typeof this.#mutationGateway?.commit !== "function") {
      throw new Error("Group state mutation gateway is unavailable");
    }
    return this.#mutationGateway;
  }

  #requireSettings({ write = false } = {}) {
    const settings = this.#gameProvider()?.settings;
    if (typeof settings?.get !== "function" || (write && typeof settings?.set !== "function")) {
      throw new Error("Foundry settings API is unavailable");
    }
    return settings;
  }
}
