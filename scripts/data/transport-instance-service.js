import {
  MODULE_ID,
  REBREYA_GROUP_FLAGS,
  TRANSPORT_COMPENDIUM_ID
} from "../constants.js";

export const TRANSPORT_IMPORT_COMMAND = "group.transport.importActor";
export const TRANSPORT_UPDATE_STATE_COMMAND = "group.transport.updateActorState";

const TRANSPORT_CONDITIONS = new Set(["operational", "damaged", "broken"]);
const TRANSPORT_UUID_PATTERN = new RegExp(
  `^Compendium\\.${TRANSPORT_COMPENDIUM_ID.replaceAll(".", "\\.")}\\.Actor\\.lchtransport\\d{4}$`,
  "u"
);
const IMPORT_KEYS = Object.freeze(["groupActorId", "sourceActorUuid"]);
const STATE_KEYS = Object.freeze(["actorId", "groupActorId", "patch"]);
const STATE_PATCH_KEYS = Object.freeze([
  "condition",
  "hpCurrent",
  "reserveCapacity",
  "reserveCurrent"
]);
const OBSERVER_OWNERSHIP = 2;

function clone(value) {
  if (globalThis.foundry?.utils?.deepClone) {
    return globalThis.foundry.utils.deepClone(value);
  }
  return value == null ? value : structuredClone(value);
}

function cleanId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasExactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function isSafeId(value) {
  const clean = cleanId(value);
  return clean.length > 0
    && clean.length <= 128
    && !["__proto__", "prototype", "constructor"].includes(clean);
}

function isNumericInput(value, { optional = false } = {}) {
  if (optional && (value == null || value === "")) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string" || !value.trim()) return false;
  return Number.isFinite(Number(value.replace(",", ".")));
}

function nonNegativeNumber(value, fallback = 0, label = "Значение") {
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const number = normalized == null || normalized === "" ? fallback : Number(normalized);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} должно быть числом.`);
  }
  if (number < 0) {
    throw new Error(`${label} не может быть отрицательным.`);
  }
  return number;
}

function optionalNonNegativeNumber(value, label = "Вместимость") {
  if (value == null || value === "") return null;
  return nonNegativeNumber(value, 0, label);
}

function senderOwnsActor(sender, actor) {
  if (!sender || !actor) return false;
  if (typeof actor.testUserPermission === "function") {
    return actor.testUserPermission(sender, "OWNER");
  }
  const ownership = actor.ownership ?? actor._source?.ownership ?? {};
  return Number(ownership[sender.id] ?? 0) >= 3
    || Number(ownership.default ?? 0) >= 3;
}

function isManagedGroup(groupActor) {
  return groupActor?.type === "group"
    && groupActor.getFlag?.(MODULE_ID, REBREYA_GROUP_FLAGS.MANAGED) === true;
}

function reserveUnitFromTransport(transport = {}) {
  return cleanId(
    transport.instanceState?.reserveUnit
    ?? transport.consumption?.unit
    ?? transport.consumptionUnit
    ?? ""
  );
}

export function normalizeTransportInstanceState(value = {}, { reserveUnit = "" } = {}) {
  const condition = cleanId(value.condition || "operational");
  if (!TRANSPORT_CONDITIONS.has(condition)) {
    throw new Error("Неизвестное состояние транспорта.");
  }
  const reserveCapacity = optionalNonNegativeNumber(
    value.reserveCapacity,
    "Вместимость топлива или корма"
  );
  const reserveCurrent = nonNegativeNumber(
    value.reserveCurrent,
    0,
    "Запас топлива или корма"
  );
  if (reserveCapacity != null && reserveCurrent > reserveCapacity) {
    throw new Error("Запас топлива или корма не может превышать вместимость.");
  }
  return {
    condition,
    reserveCurrent,
    reserveCapacity,
    reserveUnit: cleanId(reserveUnit)
  };
}

export function validateTransportImportPayload(payload) {
  return hasExactKeys(payload, IMPORT_KEYS)
    && isSafeId(payload.groupActorId)
    && TRANSPORT_UUID_PATTERN.test(cleanId(payload.sourceActorUuid));
}

export function validateTransportStatePayload(payload) {
  return hasExactKeys(payload, STATE_KEYS)
    && isSafeId(payload.groupActorId)
    && isSafeId(payload.actorId)
    && hasExactKeys(payload.patch, STATE_PATCH_KEYS)
    && TRANSPORT_CONDITIONS.has(cleanId(payload.patch.condition))
    && isNumericInput(payload.patch.hpCurrent)
    && isNumericInput(payload.patch.reserveCurrent)
    && isNumericInput(payload.patch.reserveCapacity, { optional: true });
}

export function registerTransportInstanceCommands(commandBus, service) {
  if (typeof commandBus?.register !== "function") {
    throw new TypeError("Transport command bus is required");
  }
  if (!service) throw new TypeError("Transport instance service is required");

  commandBus.register(TRANSPORT_IMPORT_COMMAND, {
    validate: validateTransportImportPayload,
    authorize: (payload, { sender } = {}) => service.canManageGroup(payload.groupActorId, sender),
    execute: (payload, { sender } = {}) => service.importIntoGroup(payload, { sender })
  });
  commandBus.register(TRANSPORT_UPDATE_STATE_COMMAND, {
    validate: validateTransportStatePayload,
    authorize: (payload, { sender } = {}) => service.canManageGroup(payload.groupActorId, sender),
    execute: (payload, { sender } = {}) => service.updateInstanceState(payload, { sender })
  });
}

export class TransportInstanceService {
  constructor(moduleApi, options = {}) {
    if (!moduleApi?.groupContextService) {
      throw new TypeError("Transport instance service requires the group context service");
    }
    this.moduleApi = moduleApi;
    this.options = options;
  }

  canManageGroup(groupActorId, sender = null) {
    try {
      const actualSender = sender ?? this.options.gameProvider?.()?.user ?? globalThis.game?.user;
      if (!actualSender) return false;
      const context = this.moduleApi.groupContextService.resolveForGroup(groupActorId);
      if (!isManagedGroup(context?.groupActor)) return false;
      if (actualSender.isGM === true) return true;
      return (context.members ?? []).some((actor) => (
        actor?.type === "character" && senderOwnsActor(actualSender, actor)
      ));
    }
    catch (_error) {
      return false;
    }
  }

  async importIntoGroup(payload, { sender } = {}) {
    if (!validateTransportImportPayload(payload)) {
      throw new Error("Некорректный запрос импорта транспорта.");
    }
    const groupContext = this.#resolveAuthorizedGroup(payload.groupActorId, sender);
    if ((groupContext.members ?? []).some((member) => this.#isInstanceForGroup(member, groupContext.groupId))) {
      throw new Error("В группе уже есть конкретный транспорт Ребреи.");
    }
    const fromUuid = this.options.fromUuid ?? globalThis.fromUuid;
    if (typeof fromUuid !== "function") {
      throw new TypeError("fromUuid is required to import transport");
    }
    const source = await fromUuid(payload.sourceActorUuid);
    this.#assertManagedTransportSource(source, payload.sourceActorUuid);

    const Actor = this.options.actorProvider?.() ?? globalThis.Actor;
    if (typeof Actor?.create !== "function") {
      throw new TypeError("Actor.create is required to import transport");
    }
    const data = this.#buildWorldInstanceData(source, groupContext.groupActor.id);
    const actor = await Actor.create(data, { renderSheet: false, keepId: false });
    try {
      await groupContext.groupActor.system?.addMember?.(actor);
      const role = source.getFlag?.(MODULE_ID, "transport")?.defaultGroupRole === "mount"
        ? "mount"
        : "transport";
      await this.moduleApi.groupContextService.mutateGroupState(groupContext.groupId, (groupState) => {
        groupState.members = groupState.members && typeof groupState.members === "object"
          ? groupState.members
          : {};
        groupState.members[actor.id] = {
          ...(groupState.members[actor.id] ?? {}),
          role
        };
        groupState.transportState = {
          ...(groupState.transportState ?? {}),
          activeTransportId: `member:${actor.id}`
        };
        return {
          role,
          activeTransportId: groupState.transportState.activeTransportId
        };
      });
      return {
        actorId: actor.id,
        actorUuid: actor.uuid,
        groupActorId: groupContext.groupId,
        role
      };
    }
    catch (error) {
      const cleanupErrors = [];
      try {
        await groupContext.groupActor.system?.removeMember?.(actor.id);
      }
      catch (rollbackError) {
        cleanupErrors.push(rollbackError);
      }
      try {
        await actor.delete?.();
      }
      catch (rollbackError) {
        cleanupErrors.push(rollbackError);
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          `${error?.message || "Transport import failed"}; rollback cleanup failed`
        );
      }
      throw error;
    }
  }

  async updateInstanceState(payload, { sender } = {}) {
    if (!validateTransportStatePayload(payload)) {
      throw new Error("Некорректный запрос изменения транспорта.");
    }
    const groupContext = this.#resolveAuthorizedGroup(payload.groupActorId, sender);
    const actor = (groupContext.members ?? []).find((member) => member?.id === payload.actorId);
    if (!actor || actor.type !== "vehicle") {
      throw new Error("Транспорт не найден в выбранной группе.");
    }

    const hpMax = Math.max(0, Number(actor.system?.attributes?.hp?.max) || 0);
    const hpCurrent = nonNegativeNumber(payload.patch.hpCurrent, 0, "Текущие хиты");
    if (hpMax > 0 && hpCurrent > hpMax) {
      throw new Error("Текущие хиты не могут превышать максимум.");
    }
    const transport = actor.getFlag?.(MODULE_ID, "transport")
      ?? actor.flags?.[MODULE_ID]?.transport
      ?? {};
    if (!this.#isInstanceForGroup(actor, groupContext.groupId)) {
      throw new Error("Выбранный актёр не является транспортом Ребреи этой группы.");
    }
    const instanceState = normalizeTransportInstanceState(payload.patch, {
      reserveUnit: reserveUnitFromTransport(transport)
    });
    await actor.update({
      "system.attributes.hp.value": hpCurrent,
      [`flags.${MODULE_ID}.transport.instanceState`]: instanceState
    });
    return {
      groupActorId: groupContext.groupId,
      actorId: actor.id,
      instanceState,
      hpCurrent
    };
  }

  #resolveAuthorizedGroup(groupActorId, sender) {
    const actualSender = sender ?? this.options.gameProvider?.()?.user ?? globalThis.game?.user;
    const context = this.moduleApi.groupContextService.resolveForGroup(groupActorId);
    if (!isManagedGroup(context?.groupActor)) {
      throw new Error("Целевой актёр не является управляемой группой Ребреи.");
    }
    if (!this.canManageGroup(groupActorId, actualSender)) {
      throw new Error("Нет прав на изменение транспорта этой группы.");
    }
    return context;
  }

  #isInstanceForGroup(actor, groupActorId) {
    const transport = actor?.getFlag?.(MODULE_ID, "transport")
      ?? actor?.flags?.[MODULE_ID]?.transport
      ?? null;
    return actor?.type === "vehicle"
      && transport?.instance === true
      && Boolean(cleanId(transport?.sourceId))
      && Boolean(cleanId(transport?.sourceActorUuid))
      && cleanId(transport?.groupActorId) === cleanId(groupActorId);
  }

  #assertManagedTransportSource(source, expectedUuid) {
    const managed = source?.getFlag?.(MODULE_ID, "managed")
      ?? source?.flags?.[MODULE_ID]?.managed;
    const sourceId = cleanId(
      source?.getFlag?.(MODULE_ID, "sourceId")
      ?? source?.flags?.[MODULE_ID]?.sourceId
    );
    if (
      source?.type !== "vehicle"
      || source?.pack !== TRANSPORT_COMPENDIUM_ID
      || cleanId(source?.uuid) !== cleanId(expectedUuid)
      || managed !== true
      || !sourceId
    ) {
      throw new Error("Источник не является управляемым транспортом Ребреи.");
    }
  }

  #buildWorldInstanceData(source, groupActorId) {
    const data = clone(source.toObject?.() ?? source);
    delete data._id;
    delete data.id;
    delete data.folder;
    delete data.pack;
    delete data.sort;

    const moduleFlags = clone(data.flags?.[MODULE_ID] ?? {});
    delete moduleFlags.managed;
    const sourceTransport = clone(moduleFlags.transport ?? {});
    const idFactory = this.options.idFactory
      ?? (() => globalThis.foundry?.utils?.randomID?.() ?? crypto.randomUUID());
    const instanceId = cleanId(idFactory()) || crypto.randomUUID();
    const reserveUnit = reserveUnitFromTransport(sourceTransport);
    moduleFlags.transport = {
      ...sourceTransport,
      instance: true,
      instanceId,
      sourceActorUuid: source.uuid,
      groupActorId,
      instanceState: normalizeTransportInstanceState({}, { reserveUnit })
    };
    data.flags = {
      ...(clone(data.flags) ?? {}),
      [MODULE_ID]: moduleFlags
    };
    data.ownership = { default: OBSERVER_OWNERSHIP };
    data.prototypeToken = {
      ...(clone(data.prototypeToken) ?? {}),
      actorLink: true
    };
    data._stats = {
      ...(clone(data._stats) ?? {}),
      compendiumSource: source.uuid
    };
    return data;
  }
}
