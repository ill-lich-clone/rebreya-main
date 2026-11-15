import { MODULE_ID, SETTINGS_KEYS } from "../../constants.js?v=1.5.90";

const GROUP_STATE_QUEUE_KEY = `setting:${SETTINGS_KEYS.GROUP_STATE}`;
const GROUP_CLOCK_SETTING_ID = `${MODULE_ID}.${SETTINGS_KEYS.GROUP_CLOCK_STATE}`;

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return globalThis.foundry.utils.deepClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function findGroupKey(groups, groupActorId) {
  return Object.keys(groups).findLast(key => key.trim() === groupActorId);
}

function copyClock(calendar) {
  const state = {};
  for (const key of ["version", "isoDate", "timeOfDaySeconds"]) {
    const value = calendar[key];
    if (value !== undefined) state[key] = value;
  }
  return clone(state);
}

function effectiveClock(calendar, clocks, id) {
  return {
    ...copyClock(calendar),
    ...copyClock(asObject(Object.hasOwn(clocks, id) ? clocks[id] : null))
  };
}

function applyClocks(registry, clocks) {
  const groups = asObject(registry.groupsById);
  for (const [id, clock] of Object.entries(clocks)) {
    if (Object.hasOwn(groups, id)) {
      groups[id].calendar = { ...groups[id].calendar, ...copyClock(asObject(clock)) };
    }
  }
  return registry;
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
    const { registry, clocks } = this.#readSnapshot();
    return applyClocks(this.#normalizeRegistry(clone(registry)), clocks);
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
    const { registry, clocks } = this.#readSnapshot();
    const groups = asObject(registry.groupsById);
    const key = findGroupKey(groups, id);
    if (key === undefined) return {};
    return effectiveClock(asObject(asObject(groups[key]).calendar), clocks, id);
  }

  mutateCalendarState(groupActorId, updateClock) {
    const id = String(groupActorId ?? "").trim();
    return this.#requireMutationGateway().commit(GROUP_STATE_QUEUE_KEY, async ({ assertActiveGm }) => {
      const settings = this.#requireSettings({ write: true });
      const { registry, revision, generation, clocks } = this.#readSnapshot(settings);
      const groups = asObject(registry.groupsById);
      const key = id && findGroupKey(groups, id);
      if (!key) throw new Error(`Group state not found: ${id}`);

      const group = asObject(groups[key]);
      const calendar = asObject(group.calendar);
      const current = effectiveClock(calendar, clocks, id);
      const next = copyClock(updateClock(clone(current)));
      assertActiveGm();
      if (revision) {
        await settings.set(MODULE_ID, SETTINGS_KEYS.GROUP_CLOCK_STATE, {
          revision,
          generation,
          clocksByGroup: { ...clocks, [id]: { ...current, ...copyClock(next) } }
        });
      } else {
        await settings.set(MODULE_ID, SETTINGS_KEYS.GROUP_STATE, {
          ...registry,
          groupsById: { ...groups, [key]: { ...group, calendar: { ...calendar, ...next } } }
        });
      }
      assertActiveGm();
      return next;
    });
  }

  mutateRegistry(mutator, { afterCommit = null } = {}) {
    return this.#requireMutationGateway().commit(GROUP_STATE_QUEUE_KEY, async ({ assertActiveGm }) => {
      const settings = this.#requireSettings({ write: true });
      const { registry, revision, generation, clocks } = this.#readSnapshot(settings);
      const draft = applyClocks(this.#normalizeRegistry(clone(registry)), clocks);
      const result = await mutator(draft);
      const committedRegistry = this.#normalizeRegistry(clone(draft));
      const nextGeneration = revision ? generation + 1 : generation;

      assertActiveGm();
      // Flush the matching clocks and invalidate their old snapshot in the same document update.
      const persistedRegistry = nextGeneration
        ? { ...committedRegistry, calendarClockGeneration: nextGeneration }
        : committedRegistry;
      await settings.set(MODULE_ID, SETTINGS_KEYS.GROUP_STATE, persistedRegistry);
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

  #readSnapshot(settings = this.#gameProvider()?.settings) {
    const document = settings?.settings?.has?.(GROUP_CLOCK_SETTING_ID)
      ? settings.get(MODULE_ID, SETTINGS_KEYS.GROUP_STATE, { document: true })
      : null;
    const modifiedTime = document?._stats?.modifiedTime;
    const revision = document?.id && Number.isFinite(modifiedTime) ? `${document.id}:${modifiedTime}` : null;
    const registry = asObject(revision ? document.value : settings?.get?.(MODULE_ID, SETTINGS_KEYS.GROUP_STATE));
    const generation = Number.isSafeInteger(registry.calendarClockGeneration) ? registry.calendarClockGeneration : 0;
    const store = revision ? asObject(settings.get(MODULE_ID, SETTINGS_KEYS.GROUP_CLOCK_STATE)) : null;
    const clocks = store?.revision === revision && store?.generation === generation ? asObject(store.clocksByGroup) : {};
    return { registry, revision, generation, clocks };
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
