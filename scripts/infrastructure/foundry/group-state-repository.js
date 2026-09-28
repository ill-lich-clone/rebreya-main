import { MODULE_ID, SETTINGS_KEYS } from "../../constants.js";

const GROUP_STATE_QUEUE_KEY = `setting:${SETTINGS_KEYS.GROUP_STATE}`;

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return globalThis.foundry.utils.deepClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
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

      const groupState = this.#normalizeGroupState(
        normalizedGroupActorId,
        existingGroupState ?? this.#buildDefaultGroupState(normalizedGroupActorId)
      );
      registry.groupsById[normalizedGroupActorId] = groupState;

      const result = await mutator(groupState, registry);
      registry.groupsById[normalizedGroupActorId] = this.#normalizeGroupState(
        normalizedGroupActorId,
        groupState
      );
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
