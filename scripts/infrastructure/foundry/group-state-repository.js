import { MODULE_ID, SETTINGS_KEYS } from "../../constants.js";

const GROUP_STATE_QUEUE_KEY = SETTINGS_KEYS.GROUP_STATE;

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return globalThis.foundry.utils.deepClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export class GroupStateRepository {
  #buildDefaultGroupState;
  #coordinator;
  #gameProvider;
  #normalizeGroupState;
  #normalizeRegistry;

  constructor({
    coordinator,
    gameProvider,
    normalizeRegistry,
    normalizeGroupState,
    buildDefaultGroupState
  }) {
    this.#coordinator = coordinator;
    this.#gameProvider = gameProvider;
    this.#normalizeRegistry = normalizeRegistry;
    this.#normalizeGroupState = normalizeGroupState;
    this.#buildDefaultGroupState = buildDefaultGroupState;
  }

  read() {
    return this.#normalizeRegistry(clone(this.#readSetting()));
  }

  mutateRegistry(mutator, { afterCommit = null } = {}) {
    return this.#coordinator.run(GROUP_STATE_QUEUE_KEY, async () => {
      const registry = this.#normalizeRegistry(clone(this.#readSetting()));
      const result = await mutator(registry);
      const committedRegistry = this.#normalizeRegistry(clone(registry));

      await this.#writeSetting(committedRegistry);
      return typeof afterCommit === "function"
        ? afterCommit(result, committedRegistry)
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

  /**
   * @deprecated Stale-unsafe whole-registry replacement for legacy GM writers only.
   */
  replaceRegistry(value) {
    const registry = this.#normalizeRegistry(clone(value));

    return this.#coordinator.run(GROUP_STATE_QUEUE_KEY, async () => {
      await this.#writeSetting(registry);
      return registry;
    });
  }

  #readSetting() {
    return this.#gameProvider()?.settings?.get?.(MODULE_ID, SETTINGS_KEYS.GROUP_STATE) ?? {};
  }

  #writeSetting(value) {
    return this.#gameProvider()?.settings?.set?.(MODULE_ID, SETTINGS_KEYS.GROUP_STATE, value);
  }
}
