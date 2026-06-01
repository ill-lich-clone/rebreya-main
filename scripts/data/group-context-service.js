import { MODULE_ID, REBREYA_GROUP_FLAGS, SETTINGS_KEYS } from "../constants.js";

export const GROUP_CONTEXT_ERRORS = {
  GROUP_NOT_FOUND: "Группа Rebreya не найдена.",
  INVALID_GROUP_ACTOR: "Актор должен быть группой dnd5e.",
  PLAYER_NOT_IN_GROUP: "Персонаж игрока не найден в группе Rebreya.",
  PLAYER_IN_MULTIPLE_GROUPS: "Персонажи игрока найдены в нескольких группах Rebreya."
};

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return globalThis.foundry.utils.deepClone(value);
  }

  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getActorById(actorId) {
  const actors = globalThis.game?.actors;
  if (!actors) {
    return null;
  }

  return actors.get?.(actorId)
    ?? actors.contents?.find((actor) => actor?.id === actorId)
    ?? null;
}

function isActorOwnedByCurrentUser(actor) {
  const user = globalThis.game?.user;
  if (!user || actor?.type !== "character") {
    return false;
  }

  if (typeof actor.testUserPermission === "function") {
    return actor.testUserPermission(user, "OWNER");
  }

  if (actor === user.character) {
    return Boolean(actor.isOwner ?? true);
  }

  const ownership = actor.ownership ?? actor._source?.ownership ?? {};
  return Number(ownership[user.id] ?? 0) >= 3 || Number(ownership.default ?? 0) >= 3;
}

export function buildDefaultGroupState(groupActorId, { now = Date.now() } = {}) {
  return {
    version: 1,
    groupActorId,
    initializedAt: now,
    calendar: {},
    traderState: {},
    tradeAudit: [],
    globalEventsState: {},
    craftState: {},
    downtimeState: {
      balancesByActorId: {},
      requests: [],
      checks: [],
      history: []
    },
    migration: {
      legacyInventoryMergedAt: 0,
      legacyInventoryActorId: ""
    }
  };
}

export function normalizeGroupState(groupActorId, value = {}) {
  const source = asObject(value);
  const fallback = buildDefaultGroupState(groupActorId);
  const downtimeState = asObject(source.downtimeState);
  const migration = asObject(source.migration);

  return {
    version: 1,
    groupActorId,
    initializedAt: Number(source.initializedAt) || fallback.initializedAt,
    calendar: clone(asObject(source.calendar)),
    traderState: clone(asObject(source.traderState)),
    tradeAudit: clone(asArray(source.tradeAudit)),
    globalEventsState: clone(asObject(source.globalEventsState)),
    craftState: clone(asObject(source.craftState)),
    downtimeState: {
      balancesByActorId: clone(asObject(downtimeState.balancesByActorId)),
      requests: clone(asArray(downtimeState.requests)),
      checks: clone(asArray(downtimeState.checks)),
      history: clone(asArray(downtimeState.history))
    },
    migration: {
      legacyInventoryMergedAt: Number(migration.legacyInventoryMergedAt) || 0,
      legacyInventoryActorId: cleanId(migration.legacyInventoryActorId)
    }
  };
}

export function normalizeGroupRegistry(value = {}) {
  const source = asObject(value);
  const groupsById = {};

  for (const [rawGroupActorId, rawState] of Object.entries(asObject(source.groupsById))) {
    const groupActorId = cleanId(rawState?.groupActorId) || cleanId(rawGroupActorId);
    if (groupActorId) {
      groupsById[groupActorId] = normalizeGroupState(groupActorId, rawState);
    }
  }

  return {
    version: 1,
    activeGroupActorId: cleanId(source.activeGroupActorId),
    groupsById
  };
}

export function isManagedPartyGroup(actor) {
  return actor?.type === "group"
    && actor.getFlag?.(MODULE_ID, REBREYA_GROUP_FLAGS.MANAGED) === true;
}

export function getGroupMemberActors(groupActor) {
  return asArray(groupActor?.system?.members)
    .map((member) => member?.actor)
    .filter((actor) => actor);
}

export function getGroupMemberActorIds(groupActor) {
  return getGroupMemberActors(groupActor)
    .map((actor) => cleanId(actor?.id))
    .filter((actorId) => actorId);
}

export function resolvePlayerGroupActor(groupActors = [], { userIsGM = false } = {}) {
  if (userIsGM) {
    return null;
  }

  const matchingGroups = asArray(groupActors).filter((groupActor) => {
    if (!isManagedPartyGroup(groupActor)) {
      return false;
    }

    return getGroupMemberActors(groupActor).some((memberActor) => isActorOwnedByCurrentUser(memberActor));
  });

  if (matchingGroups.length > 1) {
    throw new Error(GROUP_CONTEXT_ERRORS.PLAYER_IN_MULTIPLE_GROUPS);
  }

  if (matchingGroups.length === 0) {
    throw new Error(GROUP_CONTEXT_ERRORS.PLAYER_NOT_IN_GROUP);
  }

  return matchingGroups[0];
}

export class GroupContextService {
  getRegistry() {
    return normalizeGroupRegistry(
      globalThis.game?.settings?.get?.(MODULE_ID, SETTINGS_KEYS.GROUP_STATE) ?? {}
    );
  }

  async setRegistry(value) {
    const registry = normalizeGroupRegistry(value);
    await globalThis.game?.settings?.set?.(MODULE_ID, SETTINGS_KEYS.GROUP_STATE, registry);
    return registry;
  }

  getManagedGroupActors({ includeUnregistered = false } = {}) {
    return asArray(globalThis.game?.actors?.contents)
      .filter((actor) => actor?.type === "group")
      .filter((actor) => includeUnregistered || isManagedPartyGroup(actor));
  }

  async registerGroup(groupActorId) {
    const groupActor = this.#requireGroupActor(groupActorId);

    if (!isManagedPartyGroup(groupActor)) {
      await groupActor.setFlag?.(MODULE_ID, REBREYA_GROUP_FLAGS.MANAGED, true);
    }

    const registry = this.getRegistry();
    registry.groupsById[groupActor.id] = normalizeGroupState(
      groupActor.id,
      registry.groupsById[groupActor.id] ?? {}
    );

    if (!registry.activeGroupActorId) {
      registry.activeGroupActorId = groupActor.id;
    }

    await this.setRegistry(registry);
    return registry.groupsById[groupActor.id];
  }

  async setActiveGroup(groupActorId) {
    const groupActor = this.#requireGroupActor(groupActorId);
    const registry = this.getRegistry();

    registry.activeGroupActorId = groupActor.id;
    registry.groupsById[groupActor.id] = normalizeGroupState(
      groupActor.id,
      registry.groupsById[groupActor.id] ?? {}
    );

    await this.setRegistry(registry);
    return registry.groupsById[groupActor.id];
  }

  resolveForGroup(groupActorId) {
    const groupActor = this.#requireGroupActor(groupActorId);
    const registry = this.getRegistry();
    const groupState = normalizeGroupState(groupActor.id, registry.groupsById[groupActor.id] ?? {});
    const members = getGroupMemberActors(groupActor);
    const memberActorIds = getGroupMemberActorIds(groupActor);

    return {
      groupActor,
      groupId: groupActor.id,
      groupState,
      members,
      memberActorIds,
      canManage: Boolean(globalThis.game?.user?.isGM)
        || members.some((memberActor) => isActorOwnedByCurrentUser(memberActor))
    };
  }

  resolveForCurrentUser() {
    const user = globalThis.game?.user;

    if (user?.isGM) {
      const registry = this.getRegistry();
      if (!registry.activeGroupActorId) {
        throw new Error(GROUP_CONTEXT_ERRORS.GROUP_NOT_FOUND);
      }

      return this.resolveForGroup(registry.activeGroupActorId);
    }

    const groupActor = resolvePlayerGroupActor(this.getManagedGroupActors(), {
      userIsGM: Boolean(user?.isGM)
    });

    return this.resolveForGroup(groupActor.id);
  }

  #requireGroupActor(groupActorId) {
    const actorId = cleanId(groupActorId);
    const actor = getActorById(actorId);

    if (!actor) {
      throw new Error(GROUP_CONTEXT_ERRORS.GROUP_NOT_FOUND);
    }

    if (actor.type !== "group") {
      throw new Error(GROUP_CONTEXT_ERRORS.INVALID_GROUP_ACTOR);
    }

    return actor;
  }
}
